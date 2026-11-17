import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { projectAgentDetail } from '../lib/agent-detail-dto';
import type { Agent } from '../types/agents';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ID_A = '33333333-3333-4333-8333-333333333333';
const ID_B = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const LEVELS = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop', 'l4_human_in_charge', null, undefined, '', 'UNKNOWN', 'unrecognized'];
type Row = Record<string, any>;
let rows: Row[];
let organisationId = ORG_A;
let denyAuth = false;
let denyRead = false;
const calls: Array<{ table: string; filters: Record<string, unknown>; update?: Row }> = [];
class AuthError extends Error {}

function record(org: string, id: string, level: unknown): Row {
  return { agent_id: id, agent_code: `AG-${id}`, name: 'Same name', description: 'Historical record', version: 'v1',
    organisation_id: org, owner_user_id: USER, status: 'registered', oversight_level: level,
    cg_ag_007_oversight: true, cg_ag_012_autonomous_governed: true,
    external_refs: { oversight: { effectiveLevel: 'l4_human_in_charge', authority: 'AUTHORITATIVE' },
      ledger_payload: { oversight_level: 'l3_human_approval' }, controlStates: { cg_ag_007_oversight: 'passed' } },
    oversight: { effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED' }, future_secret: 'PRIVATE_SENTINEL' };
}

// Local in-memory query transport only. Real route, service and repository execute;
// every query must bind the verified tenant, with no hosted client or egress.
const db = { from(table: string) {
  const call: typeof calls[number] = { table, filters: {} }; calls.push(call);
  const query = {
    select() { return query; },
    eq(key: string, value: unknown) { call.filters[key] = value; return query; },
    update(value: Row) { call.update = value; return query; },
    throwOnError() { return query; },
    async maybeSingle() {
      assert.equal(call.filters.organisation_id, organisationId);
      if (denyRead) throw Error('READ_DENIED');
      if (table === 'governance_users') {
        assert.equal(call.filters.user_id, USER);
        return { data: { full_name: `Owner ${organisationId}`, email: 'owner@fixture.invalid' } };
      }
      assert.equal(table, 'agents');
      assert.ok(call.filters.agent_id, 'detail reads must bind the exact agent');
      const found = rows.find(row => Object.entries(call.filters).every(([key, value]) => row[key] === value));
      if (found && call.update) Object.assign(found, call.update);
      return { data: found ?? null, error: null };
    },
    async single() { return query.maybeSingle(); },
  };
  return query;
} };
let route: typeof import('../app/api/agents/[id]/route');
before(async () => {
  mock.module('../lib/db', { namedExports: { db: { write: db } } });
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => { if (denyAuth) throw new AuthError(); return { organisationId, userId: USER }; },
    SessionAuthenticationError: AuthError,
  } });
  route = await import('../app/api/agents/[id]/route');
});
beforeEach(() => {
  rows = [record(ORG_A, ID_A, 'l1_automated'), record(ORG_B, ID_B, 'l4_human_in_loop')];
  organisationId = ORG_A; denyAuth = false; denyRead = false; calls.length = 0;
});
const context = (id = ID_A) => ({ params: Promise.resolve({ id }) });
const request = () => new Request('http://fixture/api/agents/id?organisationId=spoof', { headers: { 'x-codeguard-org': ORG_B } });

function contained(agent: any, level: unknown, org = ORG_A, id = ID_A) {
  assert.equal(agent.oversight_level, 'UNKNOWN');
  assert.deepEqual(agent.oversight, {
    effectiveLevel: 'UNKNOWN', evidenceStatus: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    recordedLevel: typeof level === 'string' ? level : null,
    source: { table: 'gov_repo.agents', field: 'oversight_level', organisationId: org, agentId: id },
  });
  assert.equal(agent.agent_id, id); assert.equal(agent.organisation_id, org);
  assert.equal(agent.name, 'Same name'); assert.equal(agent.owner_user_id, USER);
  assert.ok(!('external_refs' in agent)); assert.ok(!('cg_ag_007_oversight' in agent));
  assert.ok(!JSON.stringify(agent).includes('PRIVATE_SENTINEL'));
}

test('DTO rejects injected evidence and isolates repeated projections without mutating history', () => {
  for (const level of [...LEVELS, 4, { secret: 'PRIVATE_SENTINEL' }]) {
    const row = record(ORG_A, ID_A, level); const original = structuredClone(row);
    const first = projectAgentDetail(row as Agent); contained(first, level);
    first.oversight.effectiveLevel = 'UNKNOWN'; first.oversight.recordedLevel = 'changed client copy';
    contained(projectAgentDetail(row as Agent), level);
    assert.deepEqual(row, original);
  }
});

test('GET preserves L1-L4/missing/unknown history but favourable manual flags and payloads never prove supervision', async () => {
  for (const level of LEVELS) {
    rows[0].oversight_level = level; const original = structuredClone(rows);
    const response = await route.GET(request(), context());
    assert.equal(response.status, 200);
    const body = await response.json(); contained(body.agent, level);
    assert.equal(body.owner_name, `Owner ${ORG_A}`);
    assert.equal(body.owner_email, 'owner@fixture.invalid');
    assert.equal(body.legacy_control_states.cg_ag_007_oversight, 'passed');
    assert.equal(body.legacy_control_authority, 'LEGACY_NON_AUTHORITATIVE');
    assert.deepEqual(rows, original); assert.ok(calls.every(call => !call.update));
  }
});

test('verified organisation and exact agent identity survive same-name tenants and spoofed request scope', async () => {
  contained((await (await route.GET(request(), context())).json()).agent, 'l1_automated');
  const prior = calls.length;
  assert.equal((await route.GET(request(), context(ID_B))).status, 404);
  assert.equal(calls.length, prior + 1, 'foreign agent does not trigger owner/control reads');
  organisationId = ORG_B;
  const response = await route.GET(request(), context(ID_B)); assert.equal(response.status, 200);
  contained((await response.json()).agent, 'l4_human_in_loop', ORG_B, ID_B);
});

test('unauthenticated requests make no queries; missing and denied reads never fabricate detail', async () => {
  denyAuth = true;
  assert.equal((await route.GET(request(), context())).status, 401); assert.equal(calls.length, 0);
  denyAuth = false; rows = [];
  assert.equal((await route.GET(request(), context())).status, 404);
  denyRead = true;
  const response = await route.GET(request(), context()); assert.equal(response.status, 500);
  assert.ok(!('agent' in await response.json()));
});

test('PUT response also contains effective UNKNOWN while preserving the recorded label and unrelated history', async () => {
  const originalRefs = structuredClone(rows[0].external_refs);
  const response = await route.PUT(new Request('http://fixture/api/agents/id', { method: 'PUT', body: JSON.stringify({
    description: 'Edited', oversight_level: 'l3_human_approval',
    oversight: { effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED' },
  }) }), context());
  assert.equal(response.status, 200);
  contained((await response.json()).agent, 'l3_human_approval');
  assert.equal(rows[0].oversight_level, 'l3_human_approval');
  assert.equal(rows[0].description, 'Edited'); assert.deepEqual(rows[0].external_refs, originalRefs);
  assert.deepEqual(calls.filter(call => call.update).map(call => call.update), [{ description: 'Edited', oversight_level: 'l3_human_approval' }]);
});
