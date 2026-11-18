import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import type * as AgentService from '../services/agents';
import type { useAgents } from '../hooks/useAgents';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const FOREIGN_OWNER = '44444444-4444-4444-8444-444444444444';
const LEVELS = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_loop'];
const HISTORY = [...LEVELS, 'l4_human_in_charge', null, undefined, '', 'UNKNOWN', 'unrecognized'];
type Row = Record<string, any>;
type Call = { table: string; filters: Row; excluded: Row; insert?: Row; range?: number[]; order?: string };
let rows: Row[];
let organisationId = ORG_A;
let denyAuth = false;
let denyRead = false;
let denyWrite = false;
let ownerActive = true;
const calls: Call[] = [];
class AuthError extends Error {}

function record(org: string, id: string, level: unknown): Row {
  return { agent_id: id, agent_code: `AG-${id}`, name: 'Same name', organisation_id: org,
    owner_user_id: USER, status: 'registered', agent_type: 'assistive', risk_level: 'low', oversight_level: level,
    cg_ag_007_oversight: true, approved_for_production: true,
    external_refs: { oversight: { effectiveLevel: 'l4_human_in_charge', authority: 'AUTHORITATIVE' },
      ledger_payload: { oversight_level: 'l3_human_approval' }, controlStates: { cg_ag_007_oversight: 'passed' } },
    oversight: { effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED' }, future_secret: 'PRIVATE_SENTINEL' };
}

// Real handlers -> services -> repositories -> in-memory transport. No hosted client.
const db = { from(table: string) {
  const call: Call = { table, filters: {}, excluded: {} }; calls.push(call);
  const query = {
    select() { return query; },
    eq(key: string, value: unknown) { call.filters[key] = value; return query; },
    neq(key: string, value: unknown) { call.excluded[key] = value; return query; },
    order(key: string) { call.order = key; return query; },
    throwOnError() { return query; },
    insert(value: Row) { call.insert = structuredClone(value); return query; },
    async range(start: number, end: number) {
      assert.equal(call.filters.organisation_id, organisationId);
      assert.equal(table, 'agents');
      if (denyRead) throw Error('READ_DENIED');
      call.range = [start, end];
      const found = rows.filter(row => Object.entries(call.filters).every(([k, v]) => row[k] === v)
        && Object.entries(call.excluded).every(([k, v]) => row[k] !== v));
      return { data: found.slice(start, end + 1), count: found.length };
    },
    async maybeSingle() {
      assert.equal(table, 'governance_users');
      assert.deepEqual(call.filters, { user_id: call.filters.user_id, organisation_id: organisationId, status: 'active' });
      if (denyRead) throw Error('READ_DENIED');
      return { data: ownerActive && call.filters.user_id === USER ? { user_id: USER } : null };
    },
    async single() {
      assert.equal(table, 'agents'); assert.ok(call.insert);
      assert.equal(call.insert.organisation_id, organisationId); assert.equal(call.insert.created_by, USER);
      if (denyWrite) return { data: null, error: { message: 'WRITE_DENIED' } };
      const saved = { ...record(organisationId, `new-${rows.length}`, call.insert.oversight_level), ...call.insert };
      rows.push(saved); return { data: saved, error: null };
    },
  };
  return query;
} };
let route: typeof import('../app/api/agents/route');
before(async () => {
  mock.module('../lib/db', { namedExports: { db: { write: db } } });
  mock.module('../lib/auth', { namedExports: {
    requireVerifiedGovernancePrincipal: async () => { if (denyAuth) throw new AuthError(); return { organisationId, userId: USER }; },
    SessionAuthenticationError: AuthError,
  } });
  mock.method(globalThis, 'fetch', async () => { throw Error('Network prohibited'); });
  route = await import('../app/api/agents/route');
});
beforeEach(() => {
  rows = HISTORY.map((level, i) => record(ORG_A, `a-${i}`, level));
  rows.push(record(ORG_B, 'b-0', 'l4_human_in_loop'), { ...record(ORG_A, 'retired', 'l3_human_approval'), status: 'decommissioned' });
  organisationId = ORG_A; denyAuth = false; denyRead = false; denyWrite = false; ownerActive = true; calls.length = 0;
});
const request = (body?: Row, query = '') => new Request(`http://fixture/api/agents?organisationId=${ORG_B}&${query}`, {
  method: body ? 'POST' : 'GET', headers: { 'x-codeguard-org': ORG_B }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const input = (): Row => ({ agent_code: 'NEW-1', name: 'Same name', description: 'Manual record', agent_type: 'assistive',
  risk_level: 'low', ai_act_risk_class: 'minimal', owner_user_id: USER, oversight_level: 'l2_human_review',
  organisation_id: ORG_B, created_by: FOREIGN_OWNER, oversight: { effectiveLevel: 'l4_human_in_charge', evidenceStatus: 'VERIFIED' },
  external_refs: { oversight: { authority: 'AUTHORITATIVE' } }, cg_ag_007_oversight: true });
function contained(agent: Row, stored: Row) {
  assert.equal(agent.oversight_level, 'UNKNOWN');
  assert.deepEqual(agent.oversight, {
    effectiveLevel: 'UNKNOWN', evidenceStatus: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    recordedLevel: typeof stored.oversight_level === 'string' ? stored.oversight_level : null,
    source: { table: 'gov_repo.agents', field: 'oversight_level', organisationId: stored.organisation_id, agentId: stored.agent_id },
  });
  for (const key of ['agent_id', 'agent_code', 'name', 'organisation_id', 'owner_user_id', 'approved_for_production']) {
    assert.equal(agent[key], stored[key]);
  }
  assert.doesNotMatch(JSON.stringify(agent), /external_refs|cg_ag_|ledger_payload|PRIVATE_SENTINEL/);
}

test('GET contains all historical variants and favourable/injected evidence, without changing history', async () => {
  const original = structuredClone(rows);
  const response = await route.GET(request()); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.total, HISTORY.length); assert.equal(body.agents.length, HISTORY.length);
  body.agents.forEach((agent: Row, i: number) => contained(agent, rows[i]));
  assert.equal(body.legacyRiskAuthority, 'LEGACY / NON-AUTHORITATIVE');
  assert.deepEqual(body.legacyRiskFields, ['risk_level', 'ai_act_risk_class']);
  assert.deepEqual(rows, original); assert.ok(calls.every(call => !call.insert));
});

test('GET preserves pagination/count/filters, empty results and verified tenant scope for same-name agents', async () => {
  const body = await (await route.GET(request(undefined, 'page=2&limit=2&risk=low&status=registered&type=assistive'))).json();
  assert.equal(body.total, HISTORY.length); assert.equal(body.agents.length, 2);
  contained(body.agents[0], rows[2]); contained(body.agents[1], rows[3]);
  assert.deepEqual(calls[0].filters, { organisation_id: ORG_A, risk_level: 'low', status: 'registered', agent_type: 'assistive' });
  assert.deepEqual(calls[0].excluded, { status: 'decommissioned' });
  assert.deepEqual(calls[0].range, [2, 3]); assert.equal(calls[0].order, 'created_at');
  assert.equal(body.legacyRiskFilter, 'low');
  organisationId = ORG_B;
  const foreign = await (await route.GET(request())).json();
  assert.equal(foreign.total, 1); contained(foreign.agents[0], rows[HISTORY.length]);
  rows = [];
  const empty = await (await route.GET(request())).json(); assert.deepEqual(empty.agents, []); assert.equal(empty.total, 0);
});

test('POST preserves each explicitly selected legacy level in storage but responds UNKNOWN with exact provenance', async () => {
  for (const level of LEVELS) {
    const original = structuredClone(rows);
    const response = await route.POST(request({ ...input(), oversight_level: level })); assert.equal(response.status, 201);
    const { agent } = await response.json(); const saved = rows.at(-1)!; contained(agent, saved);
    assert.equal(saved.oversight_level, level); assert.deepEqual(rows.slice(0, -1), original);
    const inserted = calls.at(-1)!.insert!;
    assert.equal(inserted.oversight_level, level); assert.equal(inserted.organisation_id, ORG_A); assert.equal(inserted.created_by, USER);
    assert.ok(!('oversight' in inserted)); assert.ok(!('external_refs' in inserted)); assert.ok(!('cg_ag_007_oversight' in inserted));
  }
});

test('POST cannot rely on database defaults: absent, empty, unknown and invalid levels fail before persistence', async () => {
  const original = structuredClone(rows);
  for (const level of [undefined, null, '', 'UNKNOWN', 'unrecognized', 'l4_human_in_charge', 2, { effectiveLevel: 'l2_human_review' }]) {
    const response = await route.POST(request({ ...input(), oversight_level: level }));
    assert.equal(response.status, 400); assert.ok(!('agent' in await response.json()));
  }
  assert.deepEqual(calls, []); assert.deepEqual(rows, original);
});

test('authentication, owner admission and read/write failures remain fail closed', async () => {
  denyAuth = true;
  assert.equal((await route.GET(request())).status, 401);
  assert.equal((await route.POST(request(input()))).status, 401); assert.deepEqual(calls, [] as Call[]);
  denyAuth = false;
  for (const candidate of [{ ...input(), owner_user_id: FOREIGN_OWNER }, { ...input(), owner_user_id: undefined }]) {
    assert.equal((await route.POST(request(candidate))).status, 400);
  }
  ownerActive = false; assert.equal((await route.POST(request(input()))).status, 400); ownerActive = true;
  assert.ok(calls.every(call => !call.insert));
  denyRead = true;
  const denied = await route.GET(request()); assert.equal(denied.status, 500); assert.ok(!('agents' in await denied.json()));
  denyRead = false; denyWrite = true; const original = structuredClone(rows);
  const failed = await route.POST(request(input())); assert.equal(failed.status, 400); assert.ok(!('agent' in await failed.json()));
  assert.deepEqual(rows, original);
});

test('service and hook contracts expose only UNKNOWN effective oversight', () => {
  function contracts(list: Awaited<ReturnType<typeof AgentService.listAgents>>, created: Awaited<ReturnType<typeof AgentService.registerAgent>>,
    hook: ReturnType<typeof useAgents>) {
    const levels: 'UNKNOWN'[] = [list.agents[0].oversight_level, created.oversight_level, hook.agents[0].oversight_level];
    const evidence: 'NOT_EVIDENCED' = created.oversight.evidenceStatus;
    return { levels, evidence };
  }
  assert.equal(typeof contracts, 'function');
});
