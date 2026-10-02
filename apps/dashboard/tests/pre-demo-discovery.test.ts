import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
let failStorage = false;
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
      assert.equal(table, 'agents', 'only operational inventory can be written');
      const q = { insert: (row: Record<string, unknown>) => { assert.equal(row.organisation_id, 'org'); assert.equal(row.status, 'pending_registration'); return q; },
        select: () => q, throwOnError: () => q, single: async () => { if (failStorage) throw Error('denied'); return { data: { agent_id: 'inventory' } }; } };
      return q;
    },
  } } } });
  post = (await import('../app/api/discovery/scan/route')).POST;
});
test('Discovery reports stored inventory honestly, including storage failure, without canonical authority', async () => {
  for (failStorage of [false, true]) {
    events.length = 0;
    const response = await post(new Request('http://fixture/api/discovery/scan', { method: 'POST', body: JSON.stringify({ provider: 'github', owner: 'fixture', repo: 'test' }) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authority, 'OPERATIONAL_LEGACY'); assert.equal(body.governedIngestion, 'NOT_ACTIVE');
    assert.equal(body.registered, undefined); assert.equal(body.discovered, 1);
    assert.equal(body.inventoryStored, failStorage ? 0 : 1); assert.equal(body.inventoryErrors, failStorage ? 1 : 0);
    assert.ok(events.every(e => e.p_payload.authority === 'OPERATIONAL_LEGACY'));
    assert.ok(events.every(e => !/approved|activated|materialized/.test(e.p_event_type)));
  }
});
