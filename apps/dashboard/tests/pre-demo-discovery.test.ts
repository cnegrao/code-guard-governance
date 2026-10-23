import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
let failStorage = false;
let failLedger: 'error' | 'throw' | 'missing' | null = null;
const tableWrites: string[] = [];
const events: Array<Record<string, any>> = [];
let post: typeof import('../app/api/discovery/scan/route').POST;
before(async () => {
  mock.module('../lib/auth', { namedExports: { requireVerifiedGovernancePrincipal: async () => ({ organisationId: 'org', userId: 'actor', issuedAtSeconds: 100, expiresAtSeconds: 200, credentialEpoch: '2026-10-20T00:00:00.123456Z' }), SessionAuthenticationError: class extends Error {} } });
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
    rpc: async (name: string, args: Record<string, any>) => {
      assert.equal(name, 'ledger_append_v2'); events.push(args);
      if (failLedger === 'throw') throw Error('PRIVATE_DB_DETAIL');
      return { data: failLedger === 'missing' ? null : '44444444-4444-4444-8444-444444444444', error: failLedger === 'error' ? { message: 'PRIVATE_DB_DETAIL' } : null };
    },
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
    assert.ok(events.every(e => e.p_verified_actor_user_id === 'actor' && e.p_verified_organisation_id === 'org' &&
      e.p_verified_session_iat === 100 && e.p_verified_session_exp === 200 && e.p_verified_credential_epoch === '2026-10-20T00:00:00.123456Z'));
  }
});

test('Discovery ledger errors/transport failure/missing receipt fail closed with sanitized 503 and no legacy retry', async () => {
  for (failLedger of ['error', 'throw', 'missing'] as const) {
    events.length = 0;
    const response = await post(new Request('http://fixture/api/discovery/scan', { method: 'POST', body: JSON.stringify({ provider: 'github', owner: 'fixture', repo: 'test', organisationId: 'spoof', actorUserId: 'spoof' }) }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Ledger recording unavailable' });
    assert.equal(events.length, 1); assert.equal(events[0].p_organisation_id, 'org');
    assert.equal(events[0].p_actor_user_id, undefined);
  }
  failLedger = null;
});
