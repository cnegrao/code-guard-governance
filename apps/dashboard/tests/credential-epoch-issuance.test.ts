import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { decodeJwt } from 'jose';
import { signToken as canonicalSignToken, verifyGovernanceSessionToken } from '../lib/auth/session-token';
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from '../lib/auth/errors';

const base = Date.parse('2026-09-25T12:00:00Z');
let epoch: unknown;
let signedAt: number[];
let service: typeof import('../services/auth');
const identity = { user_id: 'user-1', organisation_id: 'org-1', email: 'user@example.invalid', full_name: 'User' };
mock.module('../lib/auth/session-token', { namedExports: {
  signToken: async (payload: Parameters<typeof canonicalSignToken>[0]) => {
    signedAt.push(Date.now());
    return canonicalSignToken(payload);
  },
} });
mock.module('@/lib/auth/persistence', { namedExports: {
  canonicalizeEmail: (s: string) => s.trim().toLowerCase(),
  findUserIdentityForAuth: async () => ({ ...identity, status: 'active', role_ids: ['admin'], password_changed_at: epoch }),
  verifyPasswordForAuth: async () => ({ valid: true, passwordChangedAt: epoch }),
  isCredentialEpochCurrentForAuth: async () => true,
  verifyPasswordDummyWork: async () => {},
  getOrganisationForAuth: async () => ({ organisation_id: 'org-1', name: 'Org', is_active: true }),
  resolveRoleCodesForAuth: async () => [{ role_id: 'admin', role_code: 'GOVERNANCE_ADMIN', is_system_role: true }],
  signupLegacyAtomic: async () => ({ ...identity, organisation_name: 'Org', role_id: 'admin', role_code: 'GOVERNANCE_ADMIN', password_changed_at: epoch }),
} });
before(async () => {
  process.env.JWT_SECRET = '47c3f401051650368c778cda576f64dd3';
  service = await import('../services/auth');
});
beforeEach(() => { epoch = new Date(base + 550).toISOString(); signedAt = []; });
// Drain the service's persistence/check awaits without real sleeps.
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
const issue = (kind: string) => kind === 'login' ? service.login(identity.email, 'password') :
  service.signup({ email: identity.email, password: 'password', fullName: 'User', orgName: 'Org', industry: 'other' });

for (const kind of ['login', 'signup']) {
  for (const ahead of [350, 4999, 5000]) {
    test(`${kind}: waits at current/bounded future epoch (${ahead}ms); strict canonical iat`, async t => {
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: base + 200 });
      epoch = new Date(base + 200 + ahead).toISOString();
      const eligible = (Math.floor(Date.parse(epoch as string) / 1000) + 1) * 1000;
      const pending = issue(kind);
      await flush();
      assert.deepEqual(signedAt, []);
      t.mock.timers.tick(eligible - (base + 200) - 1);
      await flush();
      assert.deepEqual(signedAt, [], 'never call signToken before the guard succeeds');
      t.mock.timers.tick(1);
      const result = await pending;
      assert.deepEqual(signedAt, [eligible]);
      const claims = decodeJwt(result.session!.token);
      assert.ok(claims.iat! > Math.floor(Date.parse(epoch as string) / 1000));
      assert.deepEqual(Object.keys(claims).sort(), ['aud', 'email', 'exp', 'iat', 'iss', 'org', 'role', 'sub']);
      assert.equal(claims.iss, 'codeguard-governance');
      assert.equal(claims.aud, 'codeguard-dashboard');
      assert.equal(claims.exp! - claims.iat!, 28800);
      assert.equal((await verifyGovernanceSessionToken(result.session!.token)).issuedAtSeconds, eligible / 1000);
    });
  }
  for (const invalid of [undefined, null, '', 'not-a-date', 'infinity', '123', '2026-02-30T00:00:00Z',
    '2026-09-25T12:00:00', '2026-09-25T12:00:05.200001Z', new Date(base + 5201).toISOString()]) {
    test(`${kind}: invalid/missing/over-skew epoch ${String(invalid)} fails before signing`, async t => {
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: base + 200 });
      epoch = invalid;
      await assert.rejects(issue(kind), error => {
        assert.ok(error instanceof AuthPublicError);
        assert.equal(error.status, 500);
        assert.equal(error.message, GENERIC_AUTH_ERROR_MESSAGE);
        return true;
      });
      assert.deepEqual(signedAt, []);
    });
  }
  test(`${kind}: past epoch signs immediately with internally generated iat`, async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: base + 200 });
    epoch = new Date(base - 1).toISOString();
    await issue(kind);
    assert.deepEqual(signedAt, [base + 200]);
  });
  test(`${kind}: timer wakes after a backward wall-clock step; signer waits for the rechecked boundary`, async t => {
    // Keep the timer clock separate from Date.now so a scheduled timer can fire
    // while the backend wall clock has moved backward. No production clock seam.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let wallClock = base + 200;
    t.mock.method(Date, 'now', () => wallClock);
    const pending = issue(kind);
    await flush();
    wallClock = base + 100;
    t.mock.timers.tick(800);
    await flush();
    assert.deepEqual(signedAt, [], 'first wakeup is too early under the new wall clock');
    wallClock = base + 999;
    t.mock.timers.tick(899);
    await flush();
    assert.deepEqual(signedAt, []);
    wallClock = base + 1000;
    t.mock.timers.tick(1);
    await pending;
    assert.deepEqual(signedAt, [base + 1000]);
  });
}
