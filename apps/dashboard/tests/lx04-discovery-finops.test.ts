import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { enrichAgent as realEnrich, enrichSummary } from '../../../packages/scanner/src/codeguard/enrichment';
import { analyseFinOps } from '../../../packages/scanner/src/codeguard/enrichment/finops';
import { FINOPS_FLAG_RULES } from '../../../packages/scanner/src/l15/finops-signal-adapter';

// Keep detection, classification, enrichment, repository intelligence, graph and lineage real.
// Mock only the external ports; the ledger writer still builds its real principal-bound RPC.
const source = new Map([
  ['src/worker.ts', `import OpenAI from 'openai';
    async function load(ids) { for (const id of ids) { await client.get(id); } }
    const rows = await db.select('*'); openai.chat.completions.create({});`],
  ['src/idle.ts', `import OpenAI from 'openai'; const x = 1;`],
]);
const boundary = {
  kind: 'HEURISTIC', authority: 'QUARANTINED', observedCostState: 'UNKNOWN', evidenceState: 'NOT_EVIDENCED',
};
const events: Array<Record<string, any>> = [];
const indexed: Array<{ org: string; repository: string }> = [];
let denyAuth = false;
let failEnrichment = false;
let inflateEstimate = false;
let failLedger = false;
let providerCalls = 0;
let post: typeof import('../app/api/discovery/scan/route').POST;
class AuthError extends Error {}

before(async () => {
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => {
      if (denyAuth) throw new AuthError();
      return { organisationId: 'org', userId: 'actor', issuedAtSeconds: 100, expiresAtSeconds: 200, credentialEpoch: '2026-10-20T00:00:00.123456Z' };
    }, SessionAuthenticationError: AuthError,
  } });
  mock.module('../lib/discovery/providers', { namedExports: { getProvider: () => {
    providerCalls++;
    return {
      fetchFiles: async () => [...source.keys()].map(path => ({ path, name: path.split('/').at(-1)!, type: 'file' })),
      fetchFileContent: async (_owner: string, _repo: string, path: string) => source.get(path) ?? '',
    };
  } } });
  mock.module('@council/scanner/codeguard/enrichment', { namedExports: {
    enrichAgent: async (...args: Parameters<typeof realEnrich>) => {
      if (failEnrichment) throw Error('ENRICHMENT_UNAVAILABLE_SENTINEL');
      const result = await realEnrich(...args);
      if (inflateEstimate) {
        result.finops.monthlyCostEstimate = 987654321;
        result.finops.costRisk = 'critical';
        result.finops.costHotspots = ['FINANCIAL_CLAIM_SENTINEL $987654321/mo'];
        for (const item of result.finops.breakdown) item.estimatedMonthly = 123456789;
      }
      return result;
    }, enrichSummary,
  } });
  mock.module('../services/coding-memory', { namedExports: {
    indexRepoIntelligence: async (org: string, repository: string) => { indexed.push({ org, repository }); return 0; },
    indexAgentCode: async (org: string, repository: string) => { indexed.push({ org, repository }); return 0; },
  } });
  mock.module('../lib/db', { namedExports: { db: { write: {
    rpc: async (name: string, args: Record<string, any>) => {
      assert.equal(name, 'ledger_append_v2'); events.push(args);
      return failLedger ? { data: null, error: { message: 'PRIVATE_DB_SENTINEL' } }
        : { data: '44444444-4444-4444-8444-444444444444', error: null };
    },
    from: () => { throw Error('No legacy inventory or other table writes permitted'); },
  } } } });
  post = (await import('../app/api/discovery/scan/route')).POST;
});

function request() {
  return new Request('http://fixture/api/discovery/scan', { method: 'POST', body: JSON.stringify({
    provider: 'github', owner: 'fixture', repo: 'test', branch: 'pinned-branch',
    organisationId: 'spoof', actorUserId: 'spoof', monthlyCostEstimate: 0, observedCostState: 'OBSERVED',
  }) });
}

function assertMarkedCosts(value: any) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['monthlyCostEstimate', 'estimatedMonthly'].includes(key)) {
      assert.equal(typeof child, 'number'); assert.deepEqual(value.costEvidence, boundary);
    }
    if (key === 'costRisk' || key === 'costHotspots') assert.deepEqual(value.costEvidence, boundary);
    if (key === 'monthly_cost_estimate') {
      assert.equal(typeof child, 'number'); assert.deepEqual(value.monthly_cost_estimate_evidence, boundary);
    }
    assertMarkedCosts(child);
  }
}

test('POST preserves technical findings and identities while every public cost location remains quarantined', async () => {
  let baseline: any;
  for (inflateEstimate of [false, true]) {
    events.length = 0; indexed.length = 0;
    const response = await post(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.classified.length >= 2, 'real detection found both source files');
    assert.equal(body.result.repository, 'fixture/test');
    assert.equal(body.result.branch, 'pinned-branch');
    assert.equal(body.authority, 'OPERATIONAL_LEGACY');
    assert.equal(body.governedIngestion, 'NOT_ACTIVE');
    assert.equal(body.inventoryStored, 0);
    assert.equal(body.legacyInventoryWrite, 'STOPPED_M17_S0_D12');
    assertMarkedCosts(body);
    for (const classified of body.classified) {
      const result = body.result.agentsDiscovered.find((a: any) => a.name === classified.name && a.filePath === classified.filePath);
      assert.ok(result);
      assert.deepEqual(result.enrichment, classified.enrichment);
      assert.equal(result.framework, classified.framework);
      assert.deepEqual(result.evidence, classified.evidence);
      const raw = analyseFinOps(source.get(result.filePath)!);
      for (const rule of Object.values(FINOPS_FLAG_RULES)) assert.equal(result.enrichment.finops[rule.flag], raw[rule.flag]);
      assert.equal(result.enrichment.finops.monthlyCostEstimate, inflateEstimate ? 987654321 : raw.monthlyCostEstimate);
      assert.equal(result.enrichment.summary.monthly_cost_estimate, result.enrichment.finops.monthlyCostEstimate);
      assert.equal(result.enrichment.finops.costEvidence.observedCostState, 'UNKNOWN');
      assert.equal(result.enrichment.complianceExposure, 'none');
      assert.doesNotMatch(classified.classification.reasoning.join('\n'), /\$|\/mo|FinOps risk:|987654321|FINANCIAL_CLAIM_SENTINEL/);
      const event = events.find(e => e.p_event_type === 'inventory.discovery.agent.detected' && e.p_payload.agent_name === classified.name)!;
      assert.deepEqual(event.p_payload.classification.reasoning, classified.classification.reasoning);
      assert.equal(event.p_payload.classification.riskLevel, undefined);
      assert.equal(event.p_payload.classification.aiActRiskClass, undefined);
    }
    assert.ok(body.classified.some((a: any) => Object.values(FINOPS_FLAG_RULES).every(rule => a.enrichment.finops[rule.flag])));
    assert.ok(events.some(e => e.p_event_type === 'inventory.discovery.scan.completed'));
    const ledgerText = JSON.stringify(events);
    assert.doesNotMatch(ledgerText, /monthlyCostEstimate|monthly_cost_estimate|estimatedMonthly|costRisk|costHotspots|costEvidence|breakdown|\$|\/mo|987654321|FINANCIAL_CLAIM_SENTINEL/);
    assert.ok(events.every(e => e.p_verified_actor_user_id === 'actor' && e.p_verified_organisation_id === 'org' &&
      e.p_verified_session_iat === 100 && e.p_verified_session_exp === 200 && e.p_verified_credential_epoch === '2026-10-20T00:00:00.123456Z'));
    assert.ok(events.every(e => e.p_payload.authority === 'OPERATIONAL_LEGACY' && e.p_payload.governedIngestion === 'NOT_ACTIVE'));
    assert.equal(indexed.length, 2);
    assert.ok(indexed.every(i => i.org === 'org' && i.repository === 'repo_fixture_test'));
    const classifications = body.classified.map((a: any) => a.classification);
    if (!inflateEstimate) baseline = classifications;
    else assert.deepEqual(classifications, baseline, 'no estimate promotion through another classification field');
  }
  inflateEstimate = false;
});

test('enrichment failure adds neither fabricated costs nor financial reasoning to fallback outputs or ledger', async () => {
  failEnrichment = true;
  try {
    events.length = 0;
    const response = await post(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.classified.length >= 2);
    assert.ok(body.classified.every((a: any) => a.enrichment === undefined));
    assert.ok(body.result.agentsDiscovered.every((a: any) => a.enrichment === undefined));
    assert.doesNotMatch(JSON.stringify([body, events]), /monthlyCostEstimate|monthly_cost_estimate|estimatedMonthly|costRisk|FINANCIAL_CLAIM_SENTINEL|ENRICHMENT_UNAVAILABLE_SENTINEL|\$|\/mo/);
  } finally { failEnrichment = false; }
});

test('auth and ledger failures still deny before source access; caller-supplied cost and identity are not trusted', async () => {
  events.length = 0; indexed.length = 0; providerCalls = 0;
  denyAuth = true;
  try {
    assert.equal((await post(request())).status, 401);
    assert.equal(events.length, 0);
    assert.equal(providerCalls, 0);
  } finally { denyAuth = false; }
  failLedger = true;
  try {
    const response = await post(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Ledger recording unavailable' });
    assert.equal(events.length, 1);
    assert.equal(events[0].p_organisation_id, 'org');
    assert.equal(providerCalls, 0);
    assert.equal(indexed.length, 0);
  } finally { failLedger = false; }
});
