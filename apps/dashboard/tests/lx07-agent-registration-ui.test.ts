import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, mock, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { signToken, SESSION_COOKIE_NAME } from '../lib/auth/session-token';

const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const ACTOR = randomUUID();
const OWNER = randomUUID();
const FOREIGN = randomUUID();
type Row = Record<string, any>;
type Call = { table: string; fields?: string; filters: Row; insert?: Row };
type Element = React.ReactElement<Record<string, any>>;
const state: unknown[] = [];
const calls: Call[] = [];
const navigation: string[] = [];
const responses: Array<{ status: number; body: Row }> = [];
const payloads: Row[] = [];
let cursor = 0;
let cookie: string | undefined;
let users: Row[];
let saved: Row[];
let readFailure = false;
let writeFailure = false;
let Form: typeof import('../components/agents/AgentForm').AgentForm;
let Page: typeof import('../app/(dashboard)/agents/new/page').default;
let route: typeof import('../app/api/agents/route');

// Existing test pattern: real page, cookie/JWT auth, schema, service, repositories
// and DTO; only Next's cookie/navigation adapters and DB transport are replaced.
const db = { from(table: string) {
  const call: Call = { table, filters: {} }; calls.push(call);
  const query = {
    select(fields: string) { call.fields = fields; return query; },
    eq(key: string, value: unknown) { call.filters[key] = value; return query; },
    neq() { return query; }, order() { return query; }, throwOnError() { return query; },
    insert(value: Row) { call.insert = structuredClone(value); return query; },
    async read() {
      if (readFailure) throw Error('READ_DENIED');
      assert.equal(table, 'governance_users');
      assert.ok([ORG, OTHER_ORG].includes(call.filters.organisation_id));
      assert.equal(call.filters.status, 'active');
      return users.filter(user => Object.entries(call.filters).every(([key, value]) => user[key] === value));
    },
    then(resolve: (value: { data: Row[] }) => unknown, reject: (reason: unknown) => unknown) {
      return query.read().then(data => resolve({ data }), reject);
    },
    async maybeSingle() { return { data: (await query.read())[0] ?? null }; },
    async single() {
      assert.equal(table, 'agents'); assert.ok(call.insert);
      if (writeFailure) return { data: null, error: { message: 'WRITE_DENIED' } };
      const data = { ...call.insert, agent_id: randomUUID(), status: 'registered' };
      saved.push(data); return { data, error: null };
    },
    async range() {
      const data = saved.filter(row => row.organisation_id === call.filters.organisation_id);
      return { data, count: data.length };
    },
  };
  return query;
} };

before(async () => {
  Object.assign(globalThis, { React });
  process.env.JWT_SECRET = '947a5df38b610eec51357a42b76da790264f8103e9d57cb6c4fb82ca60e138bd';
  mock.module('react', { namedExports: { ...React,
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
  } });
  mock.module('next/headers', { namedExports: {
    cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && cookie ? { value: cookie } : undefined }),
  } });
  mock.module('next/navigation', { namedExports: {
    useRouter: () => ({ push: (url: string) => navigation.push(url), back() {} }),
    redirect: (url: string) => { throw Error(`REDIRECT:${url}`); },
  } });
  mock.module('../lib/db', { namedExports: { db: { write: db } } });
  Form = (await import('../components/agents/AgentForm')).AgentForm;
  Page = (await import('../app/(dashboard)/agents/new/page')).default;
  route = await import('../app/api/agents/route');
  mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(url, '/api/agents', 'all fetches must stay in the local test dispatcher');
    assert.equal(init?.method, 'POST'); payloads.push(JSON.parse(String(init?.body)));
    const response = await route.POST(request(payloads.at(-1)!));
    responses.push({ status: response.status, body: await response.clone().json() }); return response;
  });
});
async function session(org = ORG) {
  return signToken({ sub: ACTOR, org, role: 'user', email: 'actor@fixture.invalid', credentialEpoch: '2026-11-18T00:00:00.000001+00:00' });
}
beforeEach(async () => {
  cookie = await session();
  users = [
    { user_id: OWNER, full_name: 'Eligible owner', email: 'private@fixture.invalid', status: 'active', organisation_id: ORG, secret: 'PRIVATE_SENTINEL' },
    { user_id: ACTOR, full_name: 'Inactive actor', status: 'suspended', organisation_id: ORG },
    { user_id: FOREIGN, full_name: 'Foreign owner', status: 'active', organisation_id: OTHER_ORG },
  ];
  saved = []; readFailure = false; writeFailure = false; state.length = 0; cursor = 0;
  calls.length = 0; navigation.length = 0; responses.length = 0; payloads.length = 0;
});
function request(body: Row) {
  return new Request(`http://fixture/api/agents?organisationId=${OTHER_ORG}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-codeguard-org': OTHER_ORG, 'x-codeguard-user': FOREIGN }, body: JSON.stringify(body) });
}
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
async function formFromPage() {
  const page = await Page(); const element = elements(page).find(element => element.type === Form);
  assert.ok(element); return element.props as Parameters<typeof Form>[0];
}
function render(props: Parameters<typeof Form>[0]) { cursor = 0; return Form(props) as Element; }
function change(props: Parameters<typeof Form>[0], label: string, value: string) {
  const field = elements(render(props)).find(element => element.props.label === label || element.type === label);
  assert.ok(field, label); field.props.onChange({ target: { value } });
}
function fill(props: Parameters<typeof Form>[0], owner: string = OWNER) {
  change(props, 'Agent Code', 'TEST-REG'); change(props, 'Name', 'Registration fixture');
  change(props, 'textarea', 'Synthetic registration');
  change(props, 'Historical oversight label (unverified)', 'l2_human_review');
  if (owner) change(props, 'Responsible owner', owner);
}
async function submit(props: Parameters<typeof Form>[0]) { await render(props).props.onSubmit({ preventDefault() {} }); }
function contained(agent: Row) {
  assert.equal(agent.oversight_level, 'UNKNOWN');
  assert.deepEqual(agent.oversight, { effectiveLevel: 'UNKNOWN', evidenceStatus: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    recordedLevel: 'l2_human_review', source: { table: 'gov_repo.agents', field: 'oversight_level', organisationId: ORG, agentId: saved[0].agent_id } });
}

test('authenticated page offers only active same-organisation owners with minimal client props', async () => {
  const props = await formFromPage();
  assert.deepEqual(props.owners, [{ user_id: OWNER, full_name: 'Eligible owner' }]);
  assert.deepEqual(calls[0].filters, { organisation_id: ORG, status: 'active' });
  assert.equal(calls[0].fields, 'user_id, email, full_name, status');
  assert.doesNotMatch(JSON.stringify(props), /PRIVATE_SENTINEL|email|Foreign owner|Inactive actor/);
  const html = renderToStaticMarkup(render(props));
  assert.match(html, /Responsible owner/); assert.match(html, /<option value="" selected="">Select a responsible owner/);
  const field = elements(render(props)).find(element => element.props.name === 'owner_user_id')!;
  assert.equal(field.props.required, true); assert.equal(field.props['aria-label'], 'Responsible owner');
});

test('actual form -> authenticated POST -> service -> repository persistence -> response/list keeps owner and LX07 containment', async () => {
  const props = await formFromPage(); fill(props); await submit(props);
  assert.equal(payloads.length, 1); assert.equal(payloads[0].owner_user_id, OWNER);
  assert.equal(responses[0].status, 201); assert.equal(saved.length, 1);
  assert.equal(saved[0].owner_user_id, OWNER); assert.notEqual(OWNER, ACTOR);
  assert.equal(saved[0].organisation_id, ORG); assert.equal(saved[0].created_by, ACTOR);
  assert.equal(saved[0].name, 'Registration fixture'); assert.equal(saved[0].description, 'Synthetic registration');
  assert.equal(saved[0].oversight_level, 'l2_human_review'); contained(responses[0].body.agent);
  assert.deepEqual(calls[1].filters, { user_id: OWNER, organisation_id: ORG, status: 'active' });
  assert.deepEqual(navigation, [`/agents/${saved[0].agent_id}`]);
  const list = await (await route.GET(new Request('http://fixture/api/agents'))).json();
  assert.equal(list.total, 1); contained(list.agents[0]);
});

test('missing/foreign form choices and an empty organisation cannot submit or fabricate an owner', async () => {
  const props = await formFromPage(); fill(props, ''); await submit(props);
  assert.equal(payloads.length, 0); assert.match(renderToStaticMarkup(render(props)), /Choose an active responsible owner/);
  change(props, 'Responsible owner', FOREIGN); await submit(props); assert.equal(payloads.length, 0);
  users = []; state.length = 0;
  const empty = await formFromPage(); fill(empty, ''); await submit(empty);
  const html = renderToStaticMarkup(render(empty)); assert.match(html, /No active owners available/);
  assert.ok(elements(render(empty)).find(element => element.props.type === 'submit')!.props.disabled);
  assert.equal(payloads.length, 0); assert.deepEqual(saved, []);
});

test('owner suspended or moved after page load is rejected again by the real service before insert', async () => {
  for (const mutation of ['suspended', 'moved']) {
    state.length = 0; users[0].status = 'active'; users[0].organisation_id = ORG;
    const props = await formFromPage(); fill(props);
    if (mutation === 'suspended') users[0].status = 'suspended'; else users[0].organisation_id = OTHER_ORG;
    await submit(props);
    assert.equal(responses.at(-1)!.status, 400); assert.ok(!('agent' in responses.at(-1)!.body));
    assert.match(renderToStaticMarkup(render(props)), /Owner not found, not active, or not in your organisation/);
  }
  assert.deepEqual(saved, []); assert.equal(navigation.length, 0); assert.ok(calls.every(call => !call.insert));
});

test('missing/invalid sessions deny page and POST before reads; tenant is always bound by the signed cookie', async () => {
  for (const token of [undefined, 'invalid-token']) {
    cookie = token; await assert.rejects(formFromPage(), /REDIRECT:\/login/);
    assert.equal((await route.POST(request({}))).status, 401);
  }
  assert.equal(calls.length, 0);
  cookie = await session(OTHER_ORG); const props = await formFromPage();
  assert.deepEqual(props.owners, [{ user_id: FOREIGN, full_name: 'Foreign owner' }]);
  const body = { agent_code: 'FORGED', name: 'Forgery fixture', description: 'Synthetic', agent_type: 'assistive',
    risk_level: 'low', ai_act_risk_class: 'minimal', oversight_level: 'l2_human_review', owner_user_id: OWNER,
    organisation_id: ORG, created_by: OWNER };
  assert.equal((await route.POST(request(body))).status, 400);
  assert.deepEqual(calls.at(-1)!.filters, { user_id: OWNER, organisation_id: OTHER_ORG, status: 'active' });
  assert.deepEqual(saved, []);
});

test('owner lookup and write failures remain visible and prevent success navigation', async () => {
  readFailure = true; await assert.rejects(formFromPage(), /READ_DENIED/); readFailure = false;
  const props = await formFromPage(); fill(props); writeFailure = true; await submit(props);
  assert.equal(responses[0].status, 400); assert.ok(!('agent' in responses[0].body));
  assert.match(renderToStaticMarkup(render(props)), /WRITE_DENIED/);
  assert.deepEqual(saved, []); assert.equal(navigation.length, 0);
});
