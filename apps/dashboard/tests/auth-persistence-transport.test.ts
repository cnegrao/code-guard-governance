import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { hashSync } from 'bcryptjs';
import { AuthPublicError } from '../lib/auth/errors';

const org = { organisation_id: 'org-1', legal_name: 'Acme exact name', is_active: true };
const user = { user_id: 'user-1', organisation_id: 'org-1', email: 'user@example.invalid', full_name: 'User',
  status: 'active', role_ids: ['admin'], password_changed_at: '2026-01-01T00:00:00Z' };
const hash = `bcrypt:${hashSync('correct', 4)}`;
let orgRows: typeof org[], failure: string | undefined, transportFailure: boolean;
let persistence: typeof import('../lib/auth/persistence');
let authorization: typeof import('../lib/auth/current-authorization');
let service: typeof import('../services/auth');
let selections: string[];
before(async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  process.env.JWT_SECRET = '47c3f401051650368c778cda576f64dd3';
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://example.invalid', 'no network may escape this test');
    const table = url.pathname.split('/').at(-1);
    if (transportFailure) throw new Error('PRIVATE network credential');
    if (table === failure) return Response.json({ code: 'XX000', message: 'PRIVATE database credential' }, { status: 500 });
    const select = url.searchParams.get('select') ?? '';
    selections.push(select);
    if (table === 'organisations') return Response.json(orgRows);
    if (table === 'governance_roles') return Response.json([{ role_id: 'admin', role_code: 'GOVERNANCE_ADMIN', is_system_role: true }]);
    if (table === 'signup_legacy') return Response.json([{ ...user, organisation_name: org.legal_name, role_id: 'admin', role_code: 'GOVERNANCE_ADMIN' }]);
    if (table === 'governance_users') return Response.json(select === 'external_id,password_changed_at'
      ? [{ external_id: hash, password_changed_at: user.password_changed_at }]
      : select.includes('email') ? user : [user]);
    throw new Error('Unexpected transport request');
  });
  persistence = await import('../lib/auth/persistence');
  authorization = await import('../lib/auth/current-authorization');
  service = await import('../services/auth');
});
beforeEach(() => { orgRows = [{ ...org }]; failure = undefined; transportFailure = false; selections = []; });
test('organisation transport: zero rows returns null', async () => {
  orgRows = [];
  assert.equal(await persistence.getOrganisationForAuth('org-1'), null);
});
test('organisation transport: one row returns exact mapped result', async () => {
  assert.deepEqual(await persistence.getOrganisationForAuth('org-1'), { organisation_id: org.organisation_id, name: org.legal_name, is_active: true });
});
for (const mode of ['database', 'transport', 'multiple rows']) {
  test(`organisation transport: ${mode} failure throws sanitized infrastructure error`, async t => {
    if (mode === 'database') failure = 'organisations';
    if (mode === 'transport') {
      transportFailure = true;
      t.mock.timers.enable({ apis: ['setTimeout'] });
    }
    if (mode === 'multiple rows') orgRows.push(org);
    const checked = assert.rejects(persistence.getOrganisationForAuth('org-1'), { message: 'Unable to resolve governance organisation' });
    if (mode === 'transport') {
      // Supabase retries network errors with backoff; exercise retries logically.
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 20; j++) await Promise.resolve();
        t.mock.timers.tick(1000);
      }
    }
    await checked;
  });
}
for (const mode of ['missing', 'inactive']) {
  test(`login and current-role resolver: ${mode} organisation means 401/non-admin`, async () => {
    orgRows = mode === 'missing' ? [] : [{ ...org, is_active: false }];
    await assert.rejects(service.login(user.email, 'correct'), error => error instanceof AuthPublicError && error.status === 401);
    assert.equal(await authorization.resolveCurrentGovernanceRole({ userId: user.user_id, organisationId: user.organisation_id }), 'user');
  });
}
for (const table of ['governance_users', 'organisations', 'governance_roles']) {
  test(`current authorization: ${table} failure remains typed infrastructure failure`, async () => {
    failure = table;
    await assert.rejects(authorization.resolveCurrentGovernanceRole({ userId: user.user_id, organisationId: user.organisation_id }),
      error => error instanceof authorization.CurrentAuthorizationInfrastructureError && !error.message.includes('PRIVATE'));
    if (table !== 'governance_users') await assert.rejects(service.login(user.email, 'correct'),
      error => error instanceof Error && !(error instanceof AuthPublicError) && !error.message.includes('PRIVATE'));
  });
}
test('login selects DB epoch and signup maps the exact DB epoch', async () => {
  assert.equal((await persistence.findUserIdentityForAuth(user.email))?.password_changed_at, user.password_changed_at);
  assert.ok(selections.some(s => s.includes('password_changed_at')));
  assert.equal((await persistence.signupLegacyAtomic({ email: user.email, password: 'correct', fullName: 'User', orgName: 'Acme' })).password_changed_at, user.password_changed_at);
});
