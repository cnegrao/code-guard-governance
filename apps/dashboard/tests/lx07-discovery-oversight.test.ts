import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { detectAgents as realDetect } from '../../../packages/scanner/src/codeguard/agent-detector';
import { enrichAgent as realEnrich, enrichSummary } from '../../../packages/scanner/src/codeguard/enrichment';

let failEnrichment = false;
let denyAuth = false;
let invalidSuggestion = false;
let critical = false;
let failLedger = false;
const events: Array<Record<string, any>> = [];
const indexed: Array<{ org: string; repository: string; agents?: any[] }> = [];
const source = new Map([
  ['src/workflow.py', 'from "langgraph" import StateGraph'],
  ['.claude/skills/demo/SKILL.md', 'instructions'],
]);
let post: typeof import('../app/api/discovery/scan/route').POST;
class AuthError extends Error {}

before(async () => {
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => {
      if (denyAuth) throw new AuthError();
      return { organisationId: 'org', userId: 'actor', issuedAtSeconds: 100, expiresAtSeconds: 200, credentialEpoch: '2026-10-20T00:00:00.123456Z' };
    }, SessionAuthenticationError: AuthError,
  } });
  mock.module('../lib/discovery/providers', { namedExports: { getProvider: () => ({
    fetchFiles: async () => [...source.keys()].map(path => ({ path, name: path.split('/').at(-1)!, type: 'file' })),
    fetchFileContent: async (_owner: string, _repo: string, path: string) => source.get(path) ?? '',
  }) } });
  mock.module('@council/scanner/codeguard/agent-detector', { namedExports: { detectAgents: async (...args: Parameters<typeof realDetect>) => {
    const agents = await realDetect(...args);
    return invalidSuggestion ? agents.map(agent => ({ ...agent, suggestedOversightLevel: { secret: 'INVALID_SENTINEL' } })) : agents;
  } } });
  mock.module('@council/scanner/codeguard/enrichment', { namedExports: {
    enrichAgent: async (...args: Parameters<typeof realEnrich>) => {
      if (failEnrichment) throw Error('unavailable');
      const result = await realEnrich(...args);
      return critical ? { ...result, governancePriority: 'critical' } : result;
    }, enrichSummary,
  } });
  mock.module('@council/scanner/codeguard/repo-intelligence', { namedExports: { generateRepoIntelligence: async () => ({ domains: [], services: [], frameworks: [], entrypoints: [], businessCapabilities: [] }) } });
  mock.module('@council/scanner/codeguard/repo-knowledge-graph', { namedExports: { buildKnowledgeGraph: () => ({ nodes: [], edges: [] }) } });
  mock.module('@council/scanner/codeguard/enrichment/cross-file-lineage', { namedExports: { traceCrossFileLineage: () => ({ totalFlows: 0 }) } });
  mock.module('../services/coding-memory', { namedExports: {
    indexRepoIntelligence: async (org: string, repository: string) => { indexed.push({ org, repository }); return 0; },
    indexAgentCode: async (org: string, repository: string, agents: any[]) => { indexed.push({ org, repository, agents }); return 0; },
  } });
  mock.module('../lib/db', { namedExports: { db: { write: {
    rpc: async (name: string, args: Record<string, any>) => {
      assert.equal(name, 'ledger_append_v2'); events.push(args);
      return failLedger ? { data: null, error: { message: 'PRIVATE' } } : { data: '44444444-4444-4444-8444-444444444444', error: null };
    },
    from: () => { throw Error('No table writes permitted'); },
  } } } });
  post = (await import('../app/api/discovery/scan/route')).POST;
});

function request() {
  return new Request('http://fixture/api/discovery/scan', { method: 'POST', body: JSON.stringify({
    provider: 'github', owner: 'fixture', repo: 'test', branch: 'pinned-branch', organisationId: 'spoof', actorUserId: 'spoof',
    oversightLevel: 'l4_human_in_charge', oversightEvidence: { authority: 'AUTHORITATIVE' },
  }) });
}

test('real classifier survives enrichment, critical enrichment, fallback and invalid content in both response projections and ledger', async () => {
  for (const mode of ['enriched', 'critical', 'fallback', 'invalid'] as const) {
    failEnrichment = mode === 'fallback'; critical = mode === 'critical'; invalidSuggestion = mode === 'invalid';
    events.length = 0; indexed.length = 0;
    const response = await post(request());
    assert.equal(response.status, 200, mode);
    const body = await response.json();
    assert.equal(body.result.repository, 'fixture/test');
    assert.equal(body.result.branch, 'pinned-branch');
    assert.equal(body.authority, 'OPERATIONAL_LEGACY');
    assert.equal(body.governedIngestion, 'NOT_ACTIVE');
    assert.equal(body.inventoryStored, 0);
    assert.equal(body.legacyInventoryWrite, 'STOPPED_M17_S0_D12');
    assert.equal(body.classified.length, 2);
    assert.deepEqual(body.result.agentsDiscovered.map((a: any) => [a.name, a.filePath]), body.classified.map((a: any) => [a.name, a.filePath]));
    for (const agent of body.classified) {
      const summary = body.result.agentsDiscovered.find((a: any) => a.filePath === agent.filePath);
      assert.equal(agent.classification.oversightLevel, 'UNKNOWN');
      assert.equal(summary.oversightLevel, 'UNKNOWN');
      assert.deepEqual(summary.oversight, agent.classification.oversight);
      assert.equal(summary.oversight.evidenceState, 'NOT_EVIDENCED');
      assert.equal(summary.oversight.authority, 'NON_AUTHORITATIVE');
      assert.equal(summary.oversight.source.filePath, agent.filePath);
      assert.equal(summary.oversight.recommendation.authority, 'NON_AUTHORITATIVE');
      assert.equal(summary.oversight.recommendation.level, critical ? 'l3_human_approval' : 'l2_human_review');
      assert.equal(agent.suggestedOversightAuthority, 'NON_AUTHORITATIVE');
      assert.equal(summary.suggestedOversightAuthority, 'NON_AUTHORITATIVE');
      assert.equal(summary.suggestedOversightLevel, invalidSuggestion ? 'UNKNOWN' : agent.suggestedOversightLevel);
      assert.equal(Boolean(agent.enrichment), !failEnrichment);
      const event = events.find(e => e.p_event_type === 'inventory.discovery.agent.detected' && e.p_payload.agent_name === agent.name)!;
      assert.equal(event.p_payload.classification.oversightLevel, 'UNKNOWN');
      assert.deepEqual(event.p_payload.classification.oversight, summary.oversight);
      assert.equal(event.p_payload.classification.riskLevel, undefined);
      assert.equal(event.p_payload.classification.aiActRiskClass, undefined);
    }
    assert.ok(!JSON.stringify(body).includes('INVALID_SENTINEL'));
    assert.ok(events.every(e => e.p_verified_actor_user_id === 'actor' && e.p_verified_organisation_id === 'org' &&
      e.p_verified_session_iat === 100 && e.p_verified_session_exp === 200 && e.p_verified_credential_epoch === '2026-10-20T00:00:00.123456Z'));
    assert.ok(indexed.every(i => i.org === 'org' && i.repository === 'repo_fixture_test'));
    assert.ok(indexed[1].agents!.every(a => !('classification' in a)));
  }
});

test('authentication and ledger failure stay fail-closed before scanning', async () => {
  events.length = 0; indexed.length = 0; denyAuth = true;
  assert.equal((await post(request())).status, 401);
  assert.equal(events.length, 0); assert.equal(indexed.length, 0);
  denyAuth = false; failLedger = true;
  const response = await post(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Ledger recording unavailable' });
  assert.equal(events.length, 1); assert.equal(indexed.length, 0);
  failLedger = false;
});
