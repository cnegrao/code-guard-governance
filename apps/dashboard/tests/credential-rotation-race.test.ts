import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { compare as realCompare, hash as realHash, hashSync } from 'bcryptjs';
import { decodeJwt } from 'jose';
import * as canonicalTokens from '../lib/auth/session-token';
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from '../lib/auth/errors';

const base = Date.parse('2026-09-25T12:00:00Z');
const e1 = '2026-09-25T12:00:00.000001Z';
const e2 = '2026-09-25T12:00:00.000002Z';
const h1 = hashSync('old-password', 4), h2 = hashSync('new-password', 4);
const identity = { user_id: 'user-1', organisation_id: 'org-1', email: 'user@example.invalid', full_name: 'User',
  role_ids: ['admin'], status: 'active', password_changed_at: '2099-01-01T00:00:00Z' };
let currentEpoch: unknown, currentHash: string | null, issuerNow: number;
let rotation: 'none' | 'bcrypt' | 'sign';
let failure: string;
let events: string[], signedTokens: string[], verifiedHashes: string[];
let filters: Array<{ user: string | null; epoch: string | null }>;
let service: typeof import('../services/auth');
let persistence: typeof import('../lib/auth/persistence');
let loginRoute: typeof import('../app/api/auth/login/route');
let signupRoute: typeof import('../app/api/auth/signup/route');
const rotate = () => { currentEpoch = e2; currentHash = `bcrypt:${h2}`; events.push('rotation'); };

mock.module('bcryptjs', { namedExports: {
  hash: realHash,
  compare: async (password: string, hash: string) => {
    const valid = await realCompare(password, hash);
    verifiedHashes.push(hash);
    events.push(valid ? 'password-valid' : 'password-invalid');
    // The captured old hash verified successfully, but a concurrent rotation
    // commits before verification returns to the service.
    if (rotation === 'bcrypt') rotate();
    return valid;
  },
} });
mock.module('../lib/auth/session-token', { namedExports: {
  ...canonicalTokens,
  signToken: async (payload: canonicalTokens.SessionSigningInput) => {
    events.push('sign');
    if (rotation === 'sign') rotate();
    const token = await canonicalTokens.signToken(payload);
    signedTokens.push(token);
    events.push('signed');
    return token;
  },
} });
before(async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  process.env.JWT_SECRET = '47c3f401051650368c778cda576f64dd3';
  // Run the real Supabase client, persistence, bcrypt, service and route layers.
  // Only HTTP transport and the points where a competing rotation occurs are fixtures.
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://example.invalid', 'all network is intercepted');
    const table = url.pathname.split('/').at(-1), select = url.searchParams.get('select');
    if (table === 'governance_users' && select === 'external_id,password_changed_at') {
      events.push('credential-read');
      assert.equal(url.searchParams.get('user_id'), `eq.${identity.user_id}`);
      if (failure === 'read-network') throw new Error('PRIVATE read transport');
      if (failure === 'read-db') return Response.json({ code: 'XX000', message: 'PRIVATE read DB' }, { status: 400 });
      if (failure === 'read-missing') return Response.json([]);
      return Response.json([{ external_id: currentHash, password_changed_at: currentEpoch }]);
    }
    if (table === 'governance_users' && select === 'user_id') {
      events.push('post-sign-check');
      assert.ok(signedTokens.length > 0, 'epoch recheck must run AFTER signing completes');
      filters.push({ user: url.searchParams.get('user_id'), epoch: url.searchParams.get('password_changed_at') });
      if (failure === 'check-network') throw new Error('PRIVATE recheck transport');
      if (failure === 'check-db') return Response.json({ code: 'XX000', message: 'PRIVATE recheck DB' }, { status: 400 });
      return Response.json(failure !== 'check-missing' && url.searchParams.get('user_id') === `eq.${identity.user_id}` &&
        url.searchParams.get('password_changed_at') === `eq.${currentEpoch}` ? [{ user_id: identity.user_id }] : []);
    }
    if (table === 'governance_users' && select?.includes('email')) return Response.json(identity);
    if (table === 'organisations') return Response.json([{ organisation_id: identity.organisation_id, legal_name: 'Org', is_active: true }]);
    if (table === 'governance_roles') return Response.json([{ role_id: 'admin', role_code: 'GOVERNANCE_ADMIN', is_system_role: true }]);
    if (table === 'signup_legacy') return Response.json([{ ...identity, organisation_name: 'Org', role_id: 'admin',
      role_code: 'GOVERNANCE_ADMIN', password_changed_at: currentEpoch }]);
    throw new Error(`Unexpected fixture request: ${table}/${select}`);
  });
  service = await import('../services/auth');
  persistence = await import('../lib/auth/persistence');
  loginRoute = await import('../app/api/auth/login/route');
  signupRoute = await import('../app/api/auth/signup/route');
  mock.method(Date, 'now', () => issuerNow);
});
beforeEach(() => {
  currentEpoch = e1; currentHash = `bcrypt:${h1}`; issuerNow = base + 2000;
  rotation = 'none'; failure = ''; events = []; signedTokens = []; filters = []; verifiedHashes = [];
});
const signupInput = { email: identity.email, password: 'old-password', fullName: 'User', orgName: 'Org', industry: 'other' };
const issue = (kind: string) => kind === 'login' ? service.login(identity.email, 'old-password') : service.signup(signupInput);
const rejected = (status: number) => (error: unknown) => {
  assert.ok(error instanceof AuthPublicError);
  assert.equal(error.status, status);
  assert.equal(error.message, status === 401 ? INVALID_CREDENTIALS_MESSAGE : GENERIC_AUTH_ERROR_MESSAGE);
  return true;
};

test('credential verification returns only valid + exact epoch from one hash/epoch snapshot', async () => {
  assert.deepEqual(await persistence.verifyPasswordForAuth(identity.user_id, 'old-password'), { valid: true, passwordChangedAt: e1 });
  assert.deepEqual(events, ['credential-read', 'password-valid']);
  assert.deepEqual(verifiedHashes, [h1]);
});
test('login rejects an old hash that verifies successfully while credentials rotate', async () => {
  rotation = 'bcrypt';
  await assert.rejects(issue('login'), rejected(401));
  assert.deepEqual(events, ['credential-read', 'password-valid', 'rotation', 'sign', 'signed', 'post-sign-check']);
  assert.deepEqual(verifiedHashes, [h1], 'the revoked credential really passed bcrypt');
  // The old-epoch token is distinguishable from the rotated credential only by the exact epoch text:
  // same millisecond, iat beyond floor(E2); the bound claim differs from E2 by one microsecond.
  assert.equal(decodeJwt(signedTokens[0]).credential_epoch, e1);
  assert.notEqual(decodeJwt(signedTokens[0]).credential_epoch, e2);
  assert.ok(decodeJwt(signedTokens[0]).iat! > Math.floor(Date.parse(e2) / 1000), 'the formerly exploitable token was internally created');
  assert.equal(Date.parse(e1), Date.parse(e2), 'a millisecond-only comparison would miss this rotation');
  assert.deepEqual(filters, [{ user: `eq.${identity.user_id}`, epoch: `eq.${e1}` }]);
});
for (const kind of ['login', 'signup']) {
  test(`${kind}: unchanged verified/RPC epoch succeeds, identity lookup epoch is not used`, async () => {
    const result = await issue(kind);
    assert.equal(result.session?.token, signedTokens[0]);
    assert.equal(decodeJwt(signedTokens[0]).credential_epoch, e1, 'token binds the exact DB epoch used for the credential');
    assert.equal((await canonicalTokens.verifyGovernanceSessionToken(signedTokens[0])).credentialEpoch, e1);
    assert.deepEqual(filters, [{ user: `eq.${identity.user_id}`, epoch: `eq.${e1}` }]);
    assert.ok(events.indexOf('post-sign-check') > events.indexOf('signed'));
  });
  test(`${kind}: one-microsecond rotation during signing discards the signed token`, async () => {
    rotation = 'sign';
    await assert.rejects(issue(kind), rejected(401));
    assert.equal(signedTokens.length, 1);
    assert.deepEqual(filters, [{ user: `eq.${identity.user_id}`, epoch: `eq.${e1}` }]);
  });
  test(`${kind} HTTP route: rotated credential exposes neither token nor Set-Cookie`, async () => {
    rotation = 'sign';
    const request = new Request('https://example.invalid/api/auth/' + kind, { method: 'POST',
      body: JSON.stringify(kind === 'login' ? { email: identity.email, password: 'old-password' } : signupInput) });
    const response = await (kind === 'login' ? loginRoute : signupRoute).POST(request);
    assert.equal(response.status, 401);
    assert.equal(signedTokens.length, 1);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: INVALID_CREDENTIALS_MESSAGE });
  });
  for (const mode of ['check-missing', 'check-db', 'check-network']) {
    test(`${kind}: post-sign ${mode} fails closed without exposing private details`, async t => {
      failure = mode;
      if (mode.endsWith('network')) t.mock.timers.enable({ apis: ['setTimeout'] });
      const pending = assert.rejects(issue(kind), rejected(mode === 'check-missing' ? 401 : 500));
      if (mode.endsWith('network')) {
        // Real bcrypt yields via the event loop. Advance only retry timers after
        // signing; no real backoff sleeps and no substitution of bcrypt results.
        for (let i = 0; i < 1000 && !signedTokens.length; i++) await new Promise<void>(resolve => setImmediate(resolve));
        assert.ok(signedTokens.length, 'signing must be reached before advancing recheck retries');
        for (let i = 0; i < 30; i++) {
          for (let j = 0; j < 30; j++) await Promise.resolve();
          t.mock.timers.tick(1000);
        }
      }
      await pending;
      assert.equal(signedTokens.length, 1);
    });
  }
}
for (const mode of ['read-missing', 'read-db', 'read-network', 'epoch-null', 'epoch-missing', 'epoch-invalid', 'hash-missing', 'wrong-password']) {
  test(`login credential read: ${mode} never signs`, async t => {
    failure = mode;
    if (mode === 'epoch-null') currentEpoch = null;
    if (mode === 'epoch-missing') currentEpoch = undefined;
    if (mode === 'epoch-invalid') currentEpoch = 'not-a-timestamp';
    if (mode === 'hash-missing') currentHash = null;
    if (mode === 'wrong-password') currentHash = `bcrypt:${h2}`;
    if (mode === 'read-network') t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = assert.rejects(issue('login'), rejected(['read-missing', 'hash-missing', 'wrong-password'].includes(mode) ? 401 : 500));
    if (mode === 'read-network') {
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 30; j++) await Promise.resolve();
        t.mock.timers.tick(1000);
      }
    }
    await pending;
    assert.deepEqual(signedTokens, []);
    assert.deepEqual(filters, []);
  });
}
