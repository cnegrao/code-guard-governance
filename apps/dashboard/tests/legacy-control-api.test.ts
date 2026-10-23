import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

// Real handlers -> services -> repositories -> Supabase transport. The only
// replacements are the verified principal, DB HTTP transport and LX03 graph.
const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
type Row = Record<string, unknown>;
let rows: Record<string, Row>;
const writes: { table: string; body: Row }[] = [];
const reads: URL[] = [];
let gapRows: Row[] = [];
const client = createClient('https://fixture.invalid', 'fixture-service', {
  db: { schema: 'gov_repo' }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').at(-1)!;
    const method = init?.method ?? 'GET';
    if (url.pathname.includes('/rpc/')) {
      reads.push(url);
      assert.equal(table, 'agent_compliance_gaps');
      assert.equal(JSON.parse(String(init?.body)).p_organisation_id, ORG);
      return Response.json(gapRows);
    }
    if (method === 'POST' || method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      writes.push({ table, body: structuredClone(body) });
      Object.assign(rows[table], body);
    } else reads.push(url);
    if (method !== 'POST') assert.equal(url.searchParams.get('organisation_id'), `eq.${ORG}`);
    else assert.equal(rows[table].organisation_id, ORG);
    const single = new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object');
    const row = rows[table];
    const result = single ? row ?? null : row ? [row] : [];
    // Intentionally return every raw field even on a narrow SELECT: allowlisting
    // must hold independently of the query, including future database columns.
    return Response.json(result, { headers: { 'content-range': row ? '0-0/1' : '*/0' } });
  } },
});
let agents: typeof import('../app/api/agents/route');
let agent: typeof import('../app/api/agents/[id]/route');
let systems: typeof import('../app/api/systems/route');
let system: typeof import('../app/api/systems/[id]/route');
let dashboard: typeof import('../app/api/dashboard/summary/route');
const context = { params: Promise.resolve({ id: ID }) };
const request = (method = 'GET', body?: Row) => new Request('http://fixture/api/inventory', {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
});
before(async () => {
  mock.module('../lib/db', { namedExports: { db: { write: client } } });
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => ({ organisationId: ORG, userId: USER }),
    SessionAuthenticationError: class extends Error {},
  } });
  mock.module('../services/knowledge-graph', { namedExports: {
    getUnifiedGraph: async () => ({ nodes: [], agentCount: 0 }), isAgentNode: () => false,
  } });
  agents = await import('../app/api/agents/route'); agent = await import('../app/api/agents/[id]/route');
  systems = await import('../app/api/systems/route'); system = await import('../app/api/systems/[id]/route');
  dashboard = await import('../app/api/dashboard/summary/route');
});
beforeEach(() => {
  reads.length = 0; writes.length = 0;
  gapRows = [];
  const unsafe = { compliance_score: 100, compliance: 'COMPLIANT', compliance_gaps: [],
    control_score: 100, coverage: 100, readiness: 'READY', future_column: 'must not escape',
    external_refs: { retained: 'preserve', controlStates: {} } };
  rows = {
    agents: { ...structuredClone(unsafe), agent_id: ID, agent_code: 'AG-1', name: 'Agent fixture', description: 'Manual fixture',
      agent_type: 'assistive', risk_level: 'low', ai_act_risk_class: 'minimal', oversight_level: 'l2_human_review',
      owner_user_id: USER, organisation_id: ORG, status: 'registered', cg_ag_001_registered: true },
    ai_systems: { ...structuredClone(unsafe), system_id: ID, system_code: 'SYS-1', name: 'System fixture',
      description: 'Manual fixture', intended_purpose: 'Test fixture', risk_class: 'minimal', owner_user_id: USER,
      organisation_id: ORG, status: 'registered', cg_sys_001_registered: true },
    governance_users: { user_id: USER, full_name: 'Fixture owner', email: 'fixture@example.invalid' },
    organisations: { organisation_id: ORG, legal_name: 'Fixture' },
  };
});
const forbidden = /^(?:compliance(?:_score|_gaps)?|complianceRate|cgSysComplianceRate|evidenceCoverage|control_score|coverage|readiness|future_column|external_refs)$/;
function safe(value: unknown, inStates = false) {
  if (Array.isArray(value)) return value.forEach(v => safe(v, inStates));
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.doesNotMatch(key, forbidden);
    if (!inStates) assert.doesNotMatch(key, /^cg_(ag|sys)_|^controlStates$/);
    safe(nested, key === 'legacy_control_states');
  }
}
async function body(response: Response, status = 200) {
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); safe(value); return value;
}
function envelope(value: Row) {
  assert.equal(value.legacy_control_authority, 'LEGACY_NON_AUTHORITATIVE');
  assert.match(String(value.legacy_control_limitation), /Legacy\/manual records.*not a compliance or assurance determination/);
  assert.ok(Array.isArray(value.legacy_control_gaps));
  assert.ok(value.legacy_control_states && typeof value.legacy_control_states === 'object');
}

for (const family of ['agent', 'system'] as const) {
  const table = family === 'agent' ? 'agents' : 'ai_systems';
  const prefix = family === 'agent' ? 'cg_ag_' : 'cg_sys_';
  const first = `${prefix}001_registered`;
  const second = `${prefix}002_owner`;
  const third = family === 'agent' ? 'cg_ag_003_model_reg' : 'cg_sys_003_risk_classified';
  for (const mode of ['mixed', 'all-pass', 'all-not-assessed', 'no-stored-states'] as const) {
    test(`${family} GET detail ${mode}: bounded manual envelope, no aggregate or raw flags`, async () => {
      const states: Record<string, string> = mode === 'mixed' ? { [first]: 'passed', [second]: 'failed', [third]: 'waived' }
        : mode === 'all-pass' ? { [first]: 'passed', [second]: 'passed', [third]: 'passed' }
        : mode === 'all-not-assessed' ? { [first]: 'not_assessed', [second]: 'not_assessed' } : {};
      // Fill all known keys through the repository's established default rules.
      if (mode === 'all-pass') {
        const repo = family === 'agent' ? await import('../repositories/agents') : await import('../repositories/systems');
        const defaults = 'getAgentCompliance' in repo ? await repo.getAgentCompliance(ORG, ID) : await repo.getSystemCompliance(ORG, ID);
        for (const key of Object.keys(defaults)) states[key] = 'passed';
      }
      rows[table][first] = false;
      rows[table].external_refs = { retained: 'preserve', controlStates: states };
      const value = await body(await (family === 'agent' ? agent : system).GET(request(), context));
      envelope(value); assert.equal(value[family].name, rows[table].name);
      assert.equal(value.owner_name, 'Fixture owner');
      if (mode === 'mixed') {
        assert.equal(value.legacy_control_states[second], 'failed');
        assert.equal(value.legacy_control_states[third], 'waived');
        assert.equal(value.legacy_control_gaps.length, 1);
      } else {
        assert.deepEqual(value.legacy_control_gaps, []);
        if (mode === 'all-pass') assert.ok(Object.values(value.legacy_control_states).every(v => v === 'passed'));
        else assert.ok(Object.values(value.legacy_control_states).every(v => v === 'not_assessed'));
      }
      assert.deepEqual(writes, [], 'read must not change legacy persistence');
    });
  }
  test(`${family} GET list / POST / PUT all pass the same public allowlist`, async () => {
    const collection = family === 'agent' ? agents : systems;
    const detail = family === 'agent' ? agent : system;
    const list = await body(await collection.GET(request()));
    assert.equal(list[family === 'agent' ? 'agents' : 'systems'][0].name, rows[table].name);
    const created = await body(await collection.POST(request('POST', rows[table])), 201);
    assert.equal(created[family].name, rows[table].name);
    const updated = await body(await detail.PUT(request('PUT', { name: 'Edited fixture' }), context));
    assert.equal(updated[family].name, 'Edited fixture');
    assert.deepEqual((rows[table].external_refs as Row).controlStates, {});
    assert.ok(!('external_refs' in writes.at(-1)!.body), 'PUT keeps underlying legacy records');
  });
  test(`${family} PATCH preserves recorded waived/failed/pass/unassessed states and legacy boolean write mapping`, async () => {
    const detail = family === 'agent' ? agent : system;
    for (const state of ['waived', 'failed', 'passed', 'not_assessed']) {
      const value = await body(await detail.PATCH(request('PATCH', { [first]: state }), context));
      envelope(value); assert.equal(value.legacy_control_states[first], state);
      assert.equal(rows[table][first], state === 'passed' || state === 'waived');
      assert.deepEqual(rows[table].external_refs, { retained: 'preserve', controlStates: { [first]: state } });
      assert.deepEqual(Object.keys(value).sort(), ['legacy_control_authority', 'legacy_control_gaps', 'legacy_control_limitation', 'legacy_control_states']);
    }
    const saved = structuredClone(rows[table]);
    const response = await detail.PATCH(request('PATCH', { [first]: 'COMPLIANT' }), context);
    assert.equal(response.status, 400); assert.deepEqual(rows[table], saved);
    assert.ok(writes.every(write => write.table === table), 'no canonical or ledger writes');
  });
  test(`${family} legacy boolean fallback remains a bounded recorded pass`, async () => {
    const value = await body(await (family === 'agent' ? agent : system).GET(request(), context));
    envelope(value); assert.equal(value.legacy_control_states[first], 'passed');
  });
}
test('Dashboard serialized summary omits all three aggregates and old gap aliases', async () => {
  const value = await body(await dashboard.GET());
  assert.equal(value.legacyControlAuthority, 'LEGACY_NON_AUTHORITATIVE');
  assert.deepEqual(value.legacyControlGaps, []); assert.equal(value.totalLegacyControlGaps, 0);
  assert.ok(!('totalGovernanceGaps' in value)); assert.ok(!('topGaps' in value));
  // Only the two retained gap-count/list RPCs remain; no coverage query or graph ratio.
  assert.equal(reads.filter(url => url.pathname.endsWith('/rpc/agent_compliance_gaps')).length, 2);
});
test('Dashboard legacy gap rows are bounded even if the RPC returns additional legacy fields', async () => {
  gapRows = [{ agent_code: 'AG-1', agent_name: 'Fixture', risk_level: 'low', total_gaps: 2, owner_name: 'Owner',
    cg_ag_001_registered: false, compliance_score: 100, complianceRate: 100,
    cgSysComplianceRate: 100, evidenceCoverage: 100, external_refs: { controlStates: { fake: 'passed' } } }];
  const value = await body(await dashboard.GET());
  assert.equal(value.totalLegacyControlGaps, 2);
  assert.deepEqual(value.legacyControlGaps, [{ agent_code: 'AG-1', agent_name: 'Fixture', risk_level: 'low', total_gaps: 2, owner_name: 'Owner' }]);
});
