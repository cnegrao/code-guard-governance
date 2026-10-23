import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { org, id, foreign, principal, integrity, event } from './helpers/audit-v2-fixtures';

let data: unknown, error: unknown, thrown: unknown, authError: unknown;
const calls: { name: string; args: Record<string, unknown> }[] = [];
class SessionAuthenticationError extends Error {}
let verify: typeof import('../app/api/audit/integrity/route').GET;
let list: typeof import('../app/api/audit/events/route').GET;
let detail: typeof import('../app/api/audit/events/[id]/route').GET;
before(async () => {
  mock.module('../lib/auth', { namedExports: { SessionAuthenticationError, requireVerifiedGovernancePrincipal: async () => {
    if (authError) throw authError; return principal;
  } } });
  mock.module('../lib/db', { namedExports: { db: { write: { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); if (thrown) throw thrown; return { data, error };
  } } } } });
  verify = (await import('../app/api/audit/integrity/route')).GET;
  list = (await import('../app/api/audit/events/route')).GET;
  detail = (await import('../app/api/audit/events/[id]/route')).GET;
});
beforeEach(() => { data = null; error = null; thrown = null; authError = null; calls.length = 0; });
const request = (query = '') => new Request(`http://localhost/api/audit/events${query}`);
const byId = (handle: string) => detail(request(), { params: Promise.resolve({ id: handle }) });
function assertPrincipal() {
  for (const { args } of calls) assert.deepEqual(Object.fromEntries(Object.entries(args).filter(([k]) => k.startsWith('p_verified') || k === 'p_organisation_id')), {
    p_verified_organisation_id: org, p_verified_actor_user_id: id, p_verified_session_iat: 100, p_verified_session_exp: 200,
    p_verified_credential_epoch: principal.credentialEpoch, p_organisation_id: org,
  });
}
test('integrity preserves all status/history axes at HTTP 200 through the real closed adapter; private no-store', async () => {
  for (const status of ['VALID', 'BROKEN', 'UNKNOWN', 'EMPTY'] as const) for (const history of ['LEGACY_GLOBAL_ONLY', 'NO_LEGACY_ENTRIES', 'UNKNOWN'] as const) {
    data = { ...integrity(status, history), entry_hash: 'private', entry_sequence: 9876 };
    const res = await verify(); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await res.json(), integrity(status, history));
  }
  data = null; assert.equal((await (await verify()).json()).status, 'UNKNOWN');
  assert.ok(calls.every(c => c.name === 'ledger_tenant_verify_v2')); assertPrincipal();
});
test('first page, opaque next cursor and exact type use full principal; closed response has no aggregate/global fields', async () => {
  const page = { organisation_id: org, events: [event()], next_cursor: `V2:${id}` };
  data = { ...page, total: 999, totalPages: 20, events: [{ ...event(), entry_hash: 'private', previous_hash: 'private', entry_sequence: 9876 }] };
  assert.deepEqual(await (await list(request())).json(), page);
  await list(request(`?limit=1&cursor=V2%3A${id}&event_type=a.b`));
  assert.deepEqual(calls.map(c => c.name), ['ledger_tenant_events_v2', 'ledger_tenant_events_v2']);
  assert.deepEqual([calls[1].args.p_limit, calls[1].args.p_cursor, calls[1].args.p_event_type], [1, `V2:${id}`, 'a.b']); assertPrincipal();
});
test('malformed/unsupported/duplicate list parameters are 400 with no RPC, including numeric cursors', async () => {
  for (const query of ['?cursor=123', '?cursor=V2:bad', '?limit=0', '?limit=101', '?limit=NaN', '?limit=', '?limit=1.5', '?limit=1&limit=2',
    '?page=1', '?total=3', '?search=x', '?subject_type=x', '?actor_id=x', '?date_from=x', '?date_to=x', `?organisation_id=${foreign}`, `?event_type=${'x'.repeat(121)}`]) {
    const res = await list(request(query)); assert.equal(res.status, 400, query); assert.deepEqual(await res.json(), { error: 'Invalid audit request' });
  }
  assert.equal(calls.length, 0);
});
test('foreign and nonexistent cursor errors have identical sanitized 400; no fallback', async () => {
  error = { code: '22023', message: 'private foreign cursor identity' };
  const a = await list(request(`?cursor=V2:${foreign}`)), b = await list(request(`?cursor=V2:${id}`));
  assert.equal(a.status, 400); assert.equal(b.status, 400); assert.deepEqual(await a.json(), await b.json());
  assert.deepEqual(calls.map(c => c.name), ['ledger_tenant_events_v2', 'ledger_tenant_events_v2']);
});
test('V2 and legacy detail preserve payload authority; foreign/nonexistent are identical 404', async () => {
  for (const kind of ['V2', 'LEGACY'] as const) {
    data = { ...event(kind), entry_hash: 'private', previous_hash: 'private', entry_sequence: 9876 };
    const res = await byId(`${kind}:${id}`); assert.equal(res.status, 200); assert.deepEqual(await res.json(), { event: event(kind) });
    assert.deepEqual([calls.at(-1)?.args.p_kind, calls.at(-1)?.args.p_event_id], [kind, id]);
    data = null;
    const a = await byId(`${kind}:${foreign}`), b = await byId(`${kind}:${id}`);
    assert.equal(a.status, 404); assert.equal(b.status, 404); assert.deepEqual(await a.json(), await b.json());
  }
  assert.ok(calls.every(c => c.name === 'ledger_tenant_event_v2')); assertPrincipal();
});
test('numeric old links, partial parses and malformed handles cannot call any repository/RPC', async () => {
  for (const handle of ['123', '123abc', `V2:${id}:123`, `OTHER:${id}`, 'V2:123', `v2:${id}`, `V2%3A${id}`]) assert.equal((await byId(handle)).status, 400);
  assert.equal(calls.length, 0);
});
test('all routes distinguish auth 401, eligibility 403, DB validation 400, unavailable 503 and sanitized unexpected 500', async () => {
  const routes = [() => verify(), () => list(request()), () => byId(`V2:${id}`)];
  authError = new SessionAuthenticationError('private cookie');
  for (const route of routes) { const res = await route(); assert.equal(res.status, 401); assert.deepEqual(await res.json(), { error: 'Not authenticated' }); }
  assert.equal(calls.length, 0); authError = null;
  for (const code of ['GV001', 'GV002', 'GV003', 'GV004', '22023', 'XX000', '42501', '57014']) {
    error = { code, message: 'private DB text' };
    for (const route of routes) { const res = await route(); assert.equal(res.status, code.startsWith('GV') ? 403 : code === '22023' ? 400 : 503); assert.doesNotMatch(JSON.stringify(await res.json()), /private/); }
  }
  error = null; thrown = new Error('private transport');
  for (const route of routes) assert.equal((await route()).status, 503);
  thrown = null; authError = new Error('private server');
  for (const route of routes) { const res = await route(); assert.equal(res.status, 500); assert.deepEqual(await res.json(), { error: 'Audit request failed' }); }
  assert.ok(calls.every(c => ['ledger_tenant_verify_v2', 'ledger_tenant_events_v2', 'ledger_tenant_event_v2'].includes(c.name)));
});
test('foreign/malformed DB envelopes cannot escape as tenant events or positive assurance', async () => {
  data = { ...integrity(), organisation_id: foreign }; assert.equal((await (await verify()).json()).status, 'UNKNOWN');
  data = { organisation_id: foreign, events: [event()], next_cursor: null }; assert.equal((await list(request())).status, 503);
  data = { ...event(), organisation_id: foreign }; assert.equal((await byId(`V2:${id}`)).status, 503);
});
