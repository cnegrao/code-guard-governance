import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { jwtVerify, SignJWT } from "jose";
import { NextRequest } from "next/server";
import {
  GOVERNANCE_SESSION_MAX_AGE_SECONDS, requireJwtSecret, SESSION_AUDIENCE,
  SESSION_COOKIE_NAME, SESSION_ISSUER, signToken, verifyGovernanceSessionToken,
} from "../lib/auth/session-token";
import { parseCredentialEpochMillis } from "../lib/auth/credential-epoch";

const secret = "e2ec329fb4ac90812f819a0b8936de51";
const now = 1_790_208_000;
const identity = { sub: "user-1", org: "org-1", email: "user@example.invalid", role: "user" };
// Exact DB-authored password_changed_at text (microseconds + offset preserved verbatim).
const epoch = "2026-09-25T11:59:58.123456+00:00";
const signing = { ...identity, credentialEpoch: epoch };
const previousSecret = process.env.JWT_SECRET;
let cookie: string | undefined;
let headerReads = 0;
let orgReads: string[] = [];
let repositoryFailure = false;
let cookieFailure = false;
const forged = new Headers({
  "x-codeguard-user": "attacker", "x-codeguard-user-id": "attacker",
  "x-codeguard-org": "attacker-org", "x-codeguard-org-id": "attacker-org",
  "x-codeguard-email": "attacker@example.invalid", "x-codeguard-role": "org_admin",
});
let auth: typeof import("../lib/auth");
let me: typeof import("../app/api/auth/me/route");
let navigation: typeof import("../middleware");

before(async () => {
  mock.timers.enable({ apis: ["Date"], now: now * 1000 });
  mock.module("next/headers", { namedExports: {
    cookies: async () => {
      if (cookieFailure) throw new Error("private-internal-detail");
      return { get: (name: string) => name === SESSION_COOKIE_NAME && cookie ? { value: cookie } : undefined };
    },
    headers: async () => { headerReads++; return forged; },
  } });
  mock.module("@/repositories/organisations", { namedExports: {
    getOrg: async (id: string) => { if (repositoryFailure) throw new Error("private-database-detail"); orgReads.push(id); return { organisation_id: id, name: "Acme", external_refs: {} }; },
  } });
  auth = await import("../lib/auth");
  me = await import("../app/api/auth/me/route");
  navigation = await import("../middleware");
});
beforeEach(() => { process.env.JWT_SECRET = secret; cookie = undefined; headerReads = 0; orgReads = []; repositoryFailure = false; cookieFailure = false; });
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  mock.timers.reset();
});

async function token(changes: Record<string, unknown> = {}, algorithm = "HS256", key = secret) {
  return new SignJWT({ ...identity, credential_epoch: epoch, iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, iat: now, exp: now + 3600, ...changes })
    .setProtectedHeader({ alg: algorithm }).sign(new TextEncoder().encode(key));
}

test("verified cookie yields identity and timestamps, with role/email only informational", async () => {
  cookie = await token();
  const principal = await auth.requireVerifiedGovernancePrincipal();
  assert.deepEqual(principal, { userId: identity.sub, organisationId: identity.org, credentialEpoch: epoch,
    issuedAtSeconds: now, expiresAtSeconds: now + 3600, informational: { email: identity.email, role: "user" } });
  assert.equal("role" in principal, false);
  assert.equal("permissions" in principal, false);
  assert.equal(headerReads, 0);
});

test("missing cookie and forged identity headers cannot authenticate or cause a tenant read", async () => {
  await assert.rejects(auth.requireVerifiedGovernancePrincipal, /Not authenticated/);
  assert.equal((await me.GET()).status, 401);
  assert.deepEqual(orgReads, []);
  assert.equal(headerReads, 0);
});

test("/api/auth/me ignores conflicting caller identity headers and uses the verified cookie", async () => {
  cookie = await token();
  const response = await me.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: { user_id: "user-1", email: identity.email },
    org: { organisation_id: "org-1", name: "Acme", industry: "other" } });
  assert.deepEqual(orgReads, ["org-1"]);
  assert.equal(headerReads, 0);
});

for (const [name, value] of Object.entries({ missing: undefined, empty: "", whitespace: " ".repeat(40),
  fallback: "fallback-dev-secret-change-in-production", repositoryExample: "change-me-to-a-random-64-char-hex-string",
  placeholder: "placeholder-jwt-secret-for-production-only", example: "example-secret-for-the-application-123456",
  short: secret.slice(0, 31), repeated: "a".repeat(32),
})) {
  test(`secret ${name} fails closed in signing, strict and legacy verification, and /me`, async () => {
    cookie = await token();
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;
    assert.throws(requireJwtSecret, /^Error: JWT_SECRET must be/);
    await assert.rejects(signToken(signing), /^Error: JWT_SECRET must be/);
    await assert.rejects(auth.requireVerifiedGovernancePrincipal, /Not authenticated/);
    assert.equal(await auth.verifyToken(cookie), null);
    assert.equal((await me.GET()).status, 401);
    assert.deepEqual(orgReads, []);
  });
}

test("secret size is measured in UTF-8 bytes; 32-byte and larger keys work", async () => {
  for (const key of [secret, secret + "42", "áβ漢".repeat(5)]) {
    process.env.JWT_SECRET = key;
    assert.ok(requireJwtSecret().byteLength >= 32);
    assert.equal((await verifyGovernanceSessionToken(await signToken(signing))).userId, "user-1");
  }
});

const invalidClaims: Array<[string, Record<string, unknown>]> = [
  ["issuer mismatch", { iss: "attacker" }], ["missing issuer", { iss: undefined }],
  ["audience mismatch", { aud: "attacker" }], ["missing audience", { aud: undefined }],
  ["audience list", { aud: [SESSION_AUDIENCE, "attacker"] }],
  ["expired", { exp: now - 1 }], ["expiration boundary", { exp: now }],
  ["future nbf", { nbf: now + 1 }], ["future iat", { iat: now + 1 }],
  ["over eight hours despite future exp", { iat: now - GOVERNANCE_SESSION_MAX_AGE_SECONDS - 1 }],
  ["legacy token", { iss: undefined, aud: undefined, iat: undefined }],
  // credential_epoch is REQUIRED: tokens without it (all pre-S0.3.2R tokens) fail closed.
  ["missing credential_epoch", { credential_epoch: undefined }],
  ...[null, "", " ", "not-a-date", "123", 1790208000, 1790208000.5, true, [], {}, [epoch], { epoch },
    "2026-09-25T11:59:58.123456", "2026-09-25T11:59:58", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-09-25T25:00:00Z", "2026-09-25T11:59:58.1234567Z", "2026-09-25T11:59:58Z junk", " " + epoch, epoch + " ",
    "infinity", "-infinity", "epoch", "2026-09-25T11:59:58+0000",
  ].map((value): [string, Record<string, unknown>] => [`credential_epoch=${JSON.stringify(value)}`, { credential_epoch: value }]),
];
for (const claim of ["sub", "org"]) {
  for (const value of [undefined, null, "", " ", " padded ", "line\nbreak", 123, [], {}, "x".repeat(257)]) {
    invalidClaims.push([`${claim}=${JSON.stringify(value)}`, { [claim]: value }]);
  }
}
for (const claim of ["iat", "exp", "nbf"]) {
  for (const value of [null, "123", 1.5, -1, Number.MAX_SAFE_INTEGER + 1, [], {}]) {
    invalidClaims.push([`${claim}=${JSON.stringify(value)}`, { [claim]: value }]);
  }
  if (claim !== "nbf") invalidClaims.push([`missing ${claim}`, { [claim]: undefined }]);
}
for (const [name, changes] of invalidClaims) {
  test(`rejects ${name}`, async () => {
    cookie = await token(changes);
    assert.equal(await auth.verifyToken(cookie), null);
    assert.equal(await auth.getSession(), null);
    await assert.rejects(auth.requireVerifiedGovernancePrincipal);
    assert.equal((await me.GET()).status, 401);
    assert.deepEqual(orgReads, []);
  });
}

test("algorithm mismatch, unsigned, wrong-key and malformed tokens are rejected", async () => {
  const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(identity)).toString("base64url")}.`;
  for (const value of [await token({}, "HS384"), await token({}, "HS256", secret + "wrong"), unsigned, "not-a-jwt"]) {
    cookie = value;
    await assert.rejects(auth.requireVerifiedGovernancePrincipal);
    assert.equal((await me.GET()).status, 401);
  }
  assert.deepEqual(orgReads, []);
});

test("exactly eight hours and current nbf accepted; malformed display claims confer nothing", async () => {
  const principal = await verifyGovernanceSessionToken(await token({
    iat: now - GOVERNANCE_SESSION_MAX_AGE_SECONDS, nbf: now, email: {}, role: ["org_admin"],
  }));
  assert.equal(principal.issuedAtSeconds, now - GOVERNANCE_SESSION_MAX_AGE_SECONDS);
  assert.deepEqual(principal.informational, {});
});

test("canonical issuance pins the documented claims and cookie lifetime", async () => {
  assert.equal(SESSION_ISSUER, "codeguard-governance");
  assert.equal(SESSION_AUDIENCE, "codeguard-dashboard");
  const issued = await auth.signToken({ ...signing, iss: "attacker", aud: "attacker", iat: 1, exp: now + 999999, credential_epoch: "attacker" } as typeof signing);
  const { payload, protectedHeader } = await jwtVerify(issued, new TextEncoder().encode(secret), {
    algorithms: ["HS256"], issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE, currentDate: new Date(now * 1000),
  });
  assert.equal(protectedHeader.alg, "HS256");
  // credential_epoch is the exact DB text from the signing input; a caller-supplied claim cannot override it.
  assert.deepEqual(payload, { ...identity, credential_epoch: epoch, iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, iat: now, exp: now + 28800 });
  cookie = issued;
  assert.equal((await me.GET()).status, 200);
  assert.match(auth.setTokenCookie(issued), /HttpOnly; Path=\/; Max-Age=28800; SameSite=Lax/);
  await assert.rejects(auth.signToken({ ...signing, org: " " }), /Invalid session identity/);
});

test("signToken requires an exact zoned DB credential epoch and never invents one", async () => {
  for (const value of [undefined, null, "", "not-a-date", "123", "2026-09-25T11:59:58", "2026-02-30T00:00:00Z", 1790208000, new Date(now * 1000)]) {
    await assert.rejects(signToken({ ...identity, credentialEpoch: value } as never), /^Error: Invalid session credential epoch$/);
  }
  await assert.rejects(signToken(identity as never), /^Error: Invalid session credential epoch$/);
});

test("credential epoch text survives sign and verify verbatim (microsecond precision, offset, T/space forms)", async () => {
  for (const value of ["2026-09-25T11:59:58.000001+00:00", "2026-09-25T11:59:58.999999Z", "2026-09-25 11:59:58.123456+00:00",
    "2026-09-25T08:59:58.5-03:00", "2026-09-25T11:59:58+00:00"]) {
    const principal = await verifyGovernanceSessionToken(await signToken({ ...identity, credentialEpoch: value }));
    assert.equal(principal.credentialEpoch, value);
    assert.equal((await auth.verifyToken(await signToken({ ...identity, credentialEpoch: value })))?.sub, "user-1");
  }
  assert.ok(parseCredentialEpochMillis("2026-09-25T11:59:58.000001+00:00") > parseCredentialEpochMillis("2026-09-25T11:59:58+00:00"), "sub-millisecond digits retained");
  assert.ok(parseCredentialEpochMillis("2026-09-25T11:59:58.000002+00:00") > parseCredentialEpochMillis("2026-09-25T11:59:58.000001+00:00"));
});

test("credential_epoch is authenticated session metadata only: not derived from iat, not exposed as authorization", async () => {
  const principal = await verifyGovernanceSessionToken(await token({ iat: now - 10, credential_epoch: "2020-01-01T00:00:00.000001+00:00" }));
  assert.equal(principal.credentialEpoch, "2020-01-01T00:00:00.000001+00:00");
  assert.equal(principal.issuedAtSeconds, now - 10);
  assert.equal("permissions" in principal, false);
});

test("middleware gates navigation with strict sessions and emits no identity headers", async () => {
  const request = (value?: string) => new NextRequest("https://attacker-host.invalid/dashboard", {
    headers: { ...Object.fromEntries(forged), ...(value ? { cookie: `${SESSION_COOKIE_NAME}=${value}` } : {}) },
  });
  const response = await navigation.middleware(request(await token()));
  assert.equal(response.status, 200);
  assert.equal([...response.headers.keys()].some(key => key.startsWith("x-codeguard-")), false);
  for (const value of [undefined, await token({ iss: undefined }), await token({ iat: now - 28801 })]) {
    assert.equal((await navigation.middleware(request(value))).status, 307);
  }
  const valid = await token();
  delete process.env.JWT_SECRET;
  assert.equal((await navigation.middleware(request(valid))).status, 307);
});


test("/api/auth/me returns sanitized 500 for repository failure after valid authentication", async () => {
  cookie = await token();
  repositoryFailure = true;
  const response = await me.GET();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load account" });
});

test("/api/auth/me distinguishes an unexpected cookie infrastructure error from authentication denial", async () => {
  cookieFailure = true;
  const response = await me.GET();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load account" });
  assert.deepEqual(orgReads, []);
});
