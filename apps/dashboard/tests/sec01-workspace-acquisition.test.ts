import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';

const principal = { organisationId: '22222222-2222-4222-8222-222222222222', actorUserId: '33333333-3333-4333-8333-333333333333',
  issuedAtSeconds: 1800000000, expiresAtSeconds: 1800003600, credentialEpoch: '2026-09-25T00:00:00.000001Z' };
const empty = () => ({ organisation_id: principal.organisationId, objects: [], subjects: [], page: 1, page_size: 12 });
const object = (id: string, kind = 'AGENT') => ({ organisation_id: principal.organisationId, canonical_object_id: id, kind });
const subject = (id: string) => ({ id, facts: [], risks: { overlay_status: 'UNKNOWN', items: [] } });
let body: unknown, error: unknown, status: number, calls: { name: string; args: unknown; method: string }[];
let read: typeof import('../lib/workspace/executive-query');
let pause: Promise<void> | undefined;
before(async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push({ name: new URL(request.url).pathname, args: JSON.parse(await request.text()), method: request.method });
    if (pause) await pause;
    return Response.json(error ?? body, { status });
  });
  read = await import('../lib/workspace/executive-query');
});
beforeEach(() => { body = empty(); error = null; status = 200; calls = []; pause = undefined; });

test('one POST binds all five verified principal fields, including empty estates; no independent privileged reads', async () => {
  const model = await read.getExecutiveWorkspace(principal);
  assert.equal(model.agentCount, 0); assert.equal(model.objectCount, 0); assert.equal(model.attentionCoverage, 'NO_AGENTS');
  assert.deepEqual(calls, [{ name: '/rest/v1/rpc/read_executive_workspace_v1', method: 'POST', args: {
    p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.actorUserId,
    p_verified_session_iat: principal.issuedAtSeconds, p_verified_session_exp: principal.expiresAtSeconds,
    p_verified_credential_epoch: principal.credentialEpoch, p_page: 1,
  } }]);
});
test('the complete model remains withheld while transaction completion is pending', async () => {
  let release!: () => void;
  pause = new Promise(resolve => { release = resolve; });
  let fulfilled = false;
  const pending = read.getExecutiveWorkspace(principal).then(model => { fulfilled = true; return model; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fulfilled, false); release(); assert.equal((await pending).agentCount, 0);
});
for (const code of ['GV001', 'GV002', 'GV003', 'GV004', 'GV005', 'GV010', '42501', '28000', '28P01', 'PGRST301']) {
  test(`explicit ${code} refusal aborts instead of returning UNKNOWN or counts`, async () => {
    body = { ...empty(), objects: [object('secret-agent')] }; error = { code, message: 'private detail' }; status = 400;
    await assert.rejects(read.getExecutiveWorkspace(principal), e => e instanceof read.ExecutiveAuthorizationError && !e.message.includes('private'));
    assert.equal(calls.length, 1);
  });
}
for (const deniedStatus of [401, 403]) test(`HTTP ${deniedStatus} with no SQLSTATE is explicit refusal`, async () => {
  status = deniedStatus; error = { message: 'private' };
  await assert.rejects(read.getExecutiveWorkspace(principal), read.ExecutiveAuthorizationError);
});
for (const code of ['55P03', '40001', '40P01', '57014', '08006', 'XX000']) test(`${code} transaction failure discards all data`, async () => {
  status = 400; error = { code, message: 'private' };
  await assert.rejects(read.getExecutiveWorkspace(principal), /^Error: EXECUTIVE_ACQUISITION_FAILED$/);
});
test('successful empty projections retain business UNKNOWN, while Agent counts are known', async () => {
  body = { ...empty(), objects: [object('agent'), object('tool', 'TOOL')], subjects: [subject('agent')] };
  const model = await read.getExecutiveWorkspace(principal);
  assert.equal(model.agentCount, 1); assert.equal(model.objectCount, 2); assert.equal(model.unknownRiskSubjects, 1);
  assert.equal(model.failedRiskReads, 0); assert.equal(model.failedControlReads, 0);
});
test('page membership uses byte ordering, clamps in transaction, and validates the exact returned page', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `agent:${String(i).padStart(2, '0')}`);
  body = { ...empty(), page: 3, objects: ids.map(id => object(id)), subjects: [subject(ids[24])] };
  const model = await read.getExecutiveWorkspace(principal, '9999999');
  assert.equal(model.page, 3); assert.equal(model.agentCount, 25); assert.equal(model.pageFirst, 25);
  assert.deepEqual(model.subjects.map(s => s.id), [ids[24]]);
});
for (const page of ['0', '-1', '1.5', '1;select', '10000000', ['2'], undefined]) test(`invalid page ${String(page)} defaults before the RPC`, async () => {
  await read.getExecutiveWorkspace(principal, page);
  assert.equal((calls[0].args as { p_page: number }).p_page, 1);
});
for (const [name, make] of Object.entries({
  tenant: () => ({ ...empty(), organisation_id: 'foreign' }),
  rowTenant: () => ({ ...empty(), objects: [{ ...object('a'), organisation_id: 'foreign' }] }),
  duplicate: () => ({ ...empty(), objects: [object('a'), object('a')], subjects: [subject('a')] }),
  kind: () => ({ ...empty(), objects: [object('a', 'AI_SYSTEM')] }),
  missing: () => ({ ...empty(), objects: [object('a')] }),
  foreignSubject: () => ({ ...empty(), objects: [object('a')], subjects: [subject('b')] }),
  page: () => ({ ...empty(), page: 2 }),
  pageSize: () => ({ ...empty(), page_size: 24 }),
  facts: () => ({ ...empty(), objects: [object('a')], subjects: [{ ...subject('a'), facts: [{}] }] }),
  risks: () => ({ ...empty(), objects: [object('a')], subjects: [{ ...subject('a'), risks: { overlay_status: 'PRESENT', items: [] } }] }),
})) test(`${name} contract violation rejects the whole model`, async () => {
  body = make(); await assert.rejects(read.getExecutiveWorkspace(principal));
});
