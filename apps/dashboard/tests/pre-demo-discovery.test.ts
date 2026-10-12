import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
let failStorage = false;
const tableWrites: string[] = [];
const events: Array<Record<string, any>> = [];
let post: typeof import('../app/api/discovery/scan/route').POST;
before(async () => {
  mock.module('../lib/auth', { namedExports: { requireVerifiedGovernancePrincipal: async () => ({ organisationId: 'org', userId: 'actor' }), SessionAuthenticationError: class extends Error {} } });
  mock.module('../lib/discovery/providers', { namedExports: { getProvider: () => ({ fetchFiles: async () => [], fetchFileContent: async () => 'source' }) } });
  mock.module('@council/scanner/codeguard/agent-detector', { namedExports: { detectAgents: async () => [{ name: 'candidate', filePath: 'agent.ts', framework: 'fixture', evidence: [], agentType: 'assistive', suggestedRiskLevel: 'low', suggestedOversightLevel: 'l2_human_review' }] } });
  mock.module('@council/scanner/codeguard/system-detector', { namedExports: { groupAgentsIntoLSystems: () => [] } });
  mock.module('@council/scanner/codeguard/classifier', { namedExports: { classifyAgent: () => ({}) } });
  mock.module('@council/scanner/codeguard/enrichment', { namedExports: { enrichAgent: async () => { throw Error('No enrichment evidence'); }, enrichSummary: () => ({}) } });
  mock.module('@council/scanner/codeguard/repo-intelligence', { namedExports: { generateRepoIntelligence: async () => ({ domains: [], services: [], frameworks: [], entrypoints: [], businessCapabilities: [] }) } });
  mock.module('@council/scanner/codeguard/repo-knowledge-graph', { namedExports: { buildKnowledgeGraph: () => ({ nodes: [], edges: [] }) } });
  mock.module('@council/scanner/codeguard/enrichment/cross-file-lineage', { namedExports: { traceCrossFileLineage: () => ({ totalFlows: 0 }) } });
  mock.module('../services/coding-memory', { namedExports: { indexRepoIntelligence: async () => 0, indexAgentCode: async () => 0 } });
  mock.module('../lib/db', { namedExports: { db: { write: {
    rpc: async (name: string, args: Record<string, any>) => { assert.equal(name, 'ledger_append'); events.push(args); return { error: null }; },
    from: (table: string) => {
      // M17-S0 / D-12: the scan route writes no table at all (the legacy risk-bearing agents insert is stopped).
      tableWrites.push(table);
      if (failStorage) throw Error('denied');
      throw Error(`unexpected table access: ${table}`);
    },
  } } } });
  post = (await import('../app/api/discovery/scan/route')).POST;
});
test('Discovery reports inventory honestly (no legacy risk-bearing write, M17-S0 D-12), without canonical authority', async () => {
  for (failStorage of [false, true]) {
    events.length = 0;
    const response = await post(new Request('http://fixture/api/discovery/scan', { method: 'POST', body: JSON.stringify({ provider: 'github', owner: 'fixture', repo: 'test' }) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authority, 'OPERATIONAL_LEGACY'); assert.equal(body.governedIngestion, 'NOT_ACTIVE');
    assert.equal(body.registered, undefined); assert.equal(body.discovered, 1);
    assert.equal(body.inventoryStored, 0); assert.equal(body.inventoryErrors, 0); assert.deepEqual(tableWrites, []);
    assert.equal(body.legacyInventoryWrite, 'STOPPED_M17_S0_D12');
    assert.ok(events.every(e => e.p_payload.authority === 'OPERATIONAL_LEGACY'));
    assert.ok(events.every(e => !/approved|activated|materialized/.test(e.p_event_type)));
  }
});
