import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';

/**
 * M17-S1 F-S0-4: Coding Memory (derived retrieval memory that feeds Talk to Governance / LLM context) never carries the
 * scanner heuristic risk classification as risk truth — neither in new chunks nor through legacy chunks on any read path.
 */
let mod: typeof import('../services/coding-memory');
const stored: Array<{ summary: string; metadata: Record<string, unknown> }> = [];
let searchRows: Array<Record<string, unknown>> = [];
let repoRows: Array<Record<string, unknown>> = [];
const RISK = /\b(risk(Level| level)?|suggestedRiskLevel)\b\s*[:=]?\s*(critical|high|medium|low|minimal|limited|unacceptable)/i;

before(async () => {
  mock.module('@/lib/llm', { namedExports: { getLLMProvider: () => ({ available: true, generateEmbedding: async () => [0.1, 0.2] }) } });
  mock.module('@/repositories/coding-memory', { namedExports: {
    storeChunk: async (_org: string, _repo: string, chunk: { summary: string; metadata: Record<string, unknown> }) => { stored.push(chunk); return 'id'; },
    searchSimilar: async () => ({ chunks: searchRows }),
    getRepositoryMemory: async () => repoRows,
  } });
  mod = await import('../services/coding-memory');
});

const repoIntel = {
  repositoryName: 'repo', summary: 'Repository summary', trustZone: 'internal', languages: [], frameworks: [], confidence: 80,
  businessCapabilities: [], domains: [], services: [], modules: [], dependencies: [], entrypoints: [],
  agents: [{ name: 'Planner', framework: 'langgraph', agentType: 'planner', riskLevel: 'critical', filePath: 'src/agent.ts' }],
} as never;
const agent = { name: 'Planner', framework: 'langgraph', agentType: 'planner', suggestedRiskLevel: 'high', isAutonomous: true,
  confidence: 0.9, filePath: 'src/agent.ts', evidence: ['uses tools'] } as never;

test('new chunks carry no riskLevel / suggestedRiskLevel and no "Risk: ..." text', async () => {
  const chunks = [...mod.chunkRepoIntelligence(repoIntel), ...mod.chunkAgentCode(agent, 'line one of code\nline two of code')];
  for (const chunk of chunks) {
    assert.doesNotMatch(chunk.summary, RISK, chunk.summary);
    assert.ok(!('riskLevel' in chunk.metadata) && !('suggestedRiskLevel' in chunk.metadata), JSON.stringify(chunk.metadata));
  }
  const agentChunk = chunks.find(c => c.symbol_type === 'agent');
  assert.equal(agentChunk?.summary, 'AI Agent: Planner (langgraph, planner) at src/agent.ts');
  stored.length = 0;
  await mod.indexRepoIntelligence('org', 'repo', repoIntel);
  await mod.indexAgentCode('org', 'repo', [agent], async () => 'const x = 1; // agent code');
  assert.ok(stored.length > 0);
  for (const chunk of stored) {
    assert.doesNotMatch(chunk.summary, RISK);
    assert.ok(!Object.keys(chunk.metadata).some(k => /risk/i.test(k)), JSON.stringify(chunk.metadata));
  }
});

test('legacy chunks indexed before S1 never reach the LLM retrieval context as risk truth', async () => {
  searchRows = [
    { symbol_type: 'agent', symbol_name: 'Planner', path: 'agent:src/agent.ts', similarity: 0.9,
      summary: 'AI Agent: Planner (langgraph, planner, risk: critical) at src/agent.ts', metadata: { riskLevel: 'critical' } },
    { symbol_type: 'agent_code', symbol_name: 'Planner', path: 'src/agent.ts', similarity: 0.8,
      summary: 'langgraph agent: Planner. Type: planner, Risk: high. Evidence: uses tools', metadata: { riskLevel: 'high' } },
  ];
  const context = await mod.semanticSearch('org', 'which agents are risky?');
  assert.ok(context.includes('AI Agent: Planner (langgraph, planner) at src/agent.ts'));
  assert.doesNotMatch(context, RISK);
  assert.doesNotMatch(context, /critical|\bhigh\b/i);
  repoRows = searchRows.map(r => ({ ...r, memory_id: 'm' }));
  const memory = await mod.getRepositoryMemory('org', 'repo');
  for (const chunk of memory) {
    assert.doesNotMatch(chunk.summary, RISK);
    assert.ok(!('riskLevel' in chunk.metadata));
  }
});

test('the memory API route reads through the sanitizing service, never the raw repository', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../app/api/discovery/memory/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getRepositoryMemory\(orgId, repositoryId\)/);
  assert.doesNotMatch(route, /codingMemoryRepo/);
  const service = readFileSync(new URL('../services/coding-memory.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(service.replace(/\/\*\*[\s\S]*?\*\//g, ''), /agent\.(riskLevel|suggestedRiskLevel)/);
});
