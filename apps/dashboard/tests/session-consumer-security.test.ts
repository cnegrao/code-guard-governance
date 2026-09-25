import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { SignJWT } from "jose";
import { signToken, SESSION_AUDIENCE, SESSION_ISSUER, SESSION_COOKIE_NAME } from "../lib/auth/session-token";

const org = "11111111-1111-1111-1111-111111111111";
const foreign = "22222222-2222-2222-2222-222222222222";
const secret = "47c3f401051650368c778cda576f64dd3";
const actor = "user-1";
const forged = { "x-codeguard-user": "attacker", "x-codeguard-user-id": "attacker",
  "x-codeguard-org": foreign, "x-codeguard-org-id": foreign,
  "x-codeguard-role": "org_admin", "x-codeguard-email": "attacker@example.invalid" };
let cookie: string | undefined;
let user: { user_id: string; organisation_id: string; status: string; role_ids: string[] } | null;
let roles: Array<{ role_id: string; role_code: string; is_system_role: boolean }>;
let activeOrg = true;
let databaseError = false;
let missingOrg = false;
let writeFailure: unknown;
let queryLog: Array<{ table: string; select: string; filters: Array<[string, unknown]> }>;
let reads: string[];
let writes: Array<{ organisationId: string; actorUserId?: string; actorReference?: string; currentRole: string }>;
let headerReads = 0;
let agents: typeof import("../app/api/agents/route");
let execution: typeof import("../app/api/governance/workspace/execution-context/route");
let technical: typeof import("../app/api/governance/workspace/technical-facts/route");
let review: typeof import("../app/api/governance/workspace/reviews/[id]/route");
let decision: typeof import("../app/api/governance/workspace/reviews/[id]/decision/route");
let materialize: typeof import("../app/api/governance/workspace/reviews/[id]/materialize/route");
let passport: typeof import("../lib/governance/passport-session");
let authorization: typeof import("../lib/auth/current-authorization");
let me: typeof import("../app/api/auth/me/route");

before(async () => {
  process.env.JWT_SECRET = secret;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  process.env.SUPABASE_ANON_KEY = "fixture-anon-key";
  mock.module("next/headers", { namedExports: {
    cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && cookie ? { value: cookie } : undefined }),
    headers: async () => { headerReads++; return new Headers(forged); },
  } });
  mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("NOT_FOUND"); } } });
  // Real auth persistence and resolver run against a mock transport. No database.
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://example.invalid", "all network is intercepted");
    const table = url.pathname.split("/").at(-1)!;
    assert.ok(["governance_users", "organisations", "governance_roles"].includes(table));
    queryLog.push({ table, select: url.searchParams.get("select") ?? "",
      filters: [...url.searchParams].filter(([key]) => key !== "select").map(([key, value]) => [key, value.replace(/^eq\./, "")]) });
    const organisation = { organisation_id: org, legal_name: "Acme", is_active: activeOrg };
    const data = table === "governance_users" ? (user ? [user] : []) : table === "organisations"
      ? (missingOrg ? [] : [organisation]) : roles;
    return Response.json(databaseError ? { message: "private-db-detail" } : data,
      { status: databaseError ? 400 : 200 });
  });
  const record = async (ctx: (typeof writes)[number]) => { if (writeFailure) throw writeFailure; writes.push(ctx); return { kind: "APPLIED", subject: { state: "CONFIRMED" }, result: {} }; };
  const read = async (tenant: string) => { reads.push(tenant); return []; };
  mock.module("@/services/agents", { namedExports: { listAgents: read } });
  mock.module("@/lib/governance/execution-context-review", { namedExports: {
    executionReviewQueue: read, submitExecutionDecision: async (_input: unknown, ctx: (typeof writes)[number]) => record(ctx),
  } });
  mock.module("@/lib/governance/multivendor-exchange", { namedExports: {
    technicalFieldReviewQueue: read, submitTechnicalFieldDecision: async (_input: unknown, ctx: (typeof writes)[number]) => record(ctx),
  } });
  mock.module("@/lib/governance/workspace-query", { namedExports: {
    asReviewSubjectId: (id: string) => id,
    getReviewSubjectDetail: async (tenant: string) => { reads.push(tenant); return { state: "PROPOSED" }; },
  } });
  mock.module("@/lib/governance/workspace-commands", { namedExports: { workspaceCommands: {
    proposeReview: record, confirmReview: record, certifyReview: record, rejectReview: record,
  } } });
  mock.module("@/lib/governance/decision-query", { namedExports: { getGovernanceDecisionDetail: read } });
  mock.module("@/lib/governance/decision-commands", { namedExports: { submitReconciliationDecision: record, triggerMaterialization: record } });
  agents = await import("../app/api/agents/route");
  execution = await import("../app/api/governance/workspace/execution-context/route");
  technical = await import("../app/api/governance/workspace/technical-facts/route");
  review = await import("../app/api/governance/workspace/reviews/[id]/route");
  decision = await import("../app/api/governance/workspace/reviews/[id]/decision/route");
  materialize = await import("../app/api/governance/workspace/reviews/[id]/materialize/route");
  passport = await import("../lib/governance/passport-session");
  authorization = await import("../lib/auth/current-authorization");
  me = await import("../app/api/auth/me/route");
});

async function session(role = "user") {
  return signToken({ sub: actor, org, role, email: "user@example.invalid" });
}
beforeEach(async () => {
  process.env.JWT_SECRET = secret;
  cookie = await session();
  user = { user_id: actor, organisation_id: org, status: "active", role_ids: ["admin-role"] };
  roles = [{ role_id: "admin-role", role_code: "GOVERNANCE_ADMIN", is_system_role: true }];
  activeOrg = true; databaseError = false; missingOrg = false; writeFailure = undefined;
  queryLog = []; reads = []; writes = []; headerReads = 0;
});
const request = (body?: unknown, method = "POST") => new Request(`https://example.invalid/api/test?organisationId=${foreign}&actor=${forged["x-codeguard-user"]}`, {
  method, headers: forged, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = () => ({ params: Promise.resolve({ id: "review-1" }) });
const privileged: Array<[string, () => Promise<Response>]> = [
  ["execution POST", () => execution.POST(request({ decisionId: "d1" }))],
  ["technical POST", () => technical.POST(request({ observationIds: [] }))],
  ["review PUT", () => review.PUT(request({ action: "CONFIRM", expectedState: "PROPOSED", actorUserId: "attacker", organisationId: foreign, role: "org_admin" }, "PUT"), params())],
  ["decision POST", () => decision.POST(request({ requestedOutcome: "CREATE_NEW", reasonCode: "REVIEW", actorUserId: "attacker", organisationId: foreign, role: "org_admin" }), params())],
  ["materialize POST", () => materialize.POST(request(), params())],
];

test("direct tenant, review, execution and Passport reads ignore all forged identity headers", async () => {
  assert.equal((await agents.GET(request(undefined, "GET"))).status, 200);
  assert.equal((await review.GET(request(undefined, "GET"), params())).status, 200);
  assert.equal((await execution.GET()).status, 200);
  assert.equal((await technical.GET()).status, 200);
  assert.equal(await passport.passportOrganisation(), org);
  assert.deepEqual(reads, [org, org, org, org]);
  assert.equal(headerReads, 0);
});

test("/me with real repository distinguishes data-client error from missing authentication", async () => {
  assert.equal((await me.GET()).status, 200);
  assert.deepEqual(queryLog[0].filters, [["organisation_id", org]]);
  databaseError = true;
  const response = await me.GET();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load account" });
  cookie = undefined; queryLog = [];
  assert.equal((await me.GET()).status, 401);
  assert.deepEqual(queryLog, []);
});

for (const [name, invoke] of privileged) {
  test(`${name}: JWT user plus current admin permits only verified tenant/actor`, async () => {
    assert.equal((await invoke()).status, 200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].organisationId, org);
    assert.equal(writes[0].currentRole, "org_admin");
    if (!name.startsWith("materialize")) assert.equal(writes[0].actorUserId ?? writes[0].actorReference, actor);
    assert.deepEqual(queryLog[0].filters, [["user_id", actor], ["organisation_id", org]]);
    assert.equal(headerReads, 0);
  });
  test(`${name}: stale JWT admin and forged admin header cannot override current non-admin`, async () => {
    cookie = await session("org_admin"); roles = [];
    assert.equal((await invoke()).status, 403); assert.deepEqual(writes, []);
  });
  test(`${name}: foreign organisation or different user's role state never authorizes`, async () => {
    for (const identity of [{ user_id: actor, organisation_id: foreign }, { user_id: "another-user", organisation_id: org }]) {
      user = { ...user!, ...identity };
      assert.equal((await invoke()).status, 403);
    }
    assert.deepEqual(writes, []);
  });
  test(`${name}: role revocation after one request is honored on the next request`, async () => {
    assert.equal((await invoke()).status, 200);
    user!.role_ids = [];
    assert.equal((await invoke()).status, 403);
    assert.equal(writes.length, 1);
  });
}

test("review allowedActions follows current persistence, never informational JWT role", async () => {
  cookie = await session("org_admin"); roles = [];
  const denied = await (await review.GET(request(undefined, "GET"), params())).json();
  assert.equal(denied.allowedActions.canConfirm, false);
  cookie = await session("user"); roles = [{ role_id: "admin-role", role_code: "GOVERNANCE_ADMIN", is_system_role: true }];
  const allowed = await (await review.GET(request(undefined, "GET"), params())).json();
  assert.equal(allowed.allowedActions.canConfirm, true);
});

test("current-role resolver rejects missing, inactive, unresolved and non-system admin records", async () => {
  const principal = { userId: actor, organisationId: org };
  user = null; assert.equal(await authorization.resolveCurrentGovernanceRole(principal), "user");
  user = { user_id: actor, organisation_id: org, status: "suspended", role_ids: ["admin-role"] };
  assert.equal(await authorization.resolveCurrentGovernanceRole(principal), "user");
  user.status = "active"; activeOrg = false;
  assert.equal(await authorization.resolveCurrentGovernanceRole(principal), "user");
  activeOrg = true; roles[0].is_system_role = false;
  assert.equal(await authorization.resolveCurrentGovernanceRole(principal), "user");
  roles[0].is_system_role = true; user.role_ids.push("missing-role");
  assert.equal(await authorization.resolveCurrentGovernanceRole(principal), "user");
  databaseError = true;
  await assert.rejects(authorization.resolveCurrentGovernanceRole(principal), /Unable to resolve/);
});

for (const mode of ["missing", "legacy", "old", "issuer", "audience"]) {
  test(`direct readers and privileged routes reject ${mode} session without middleware`, async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: actor, org, role: "org_admin", iat: now, exp: now + 3600,
      iss: SESSION_ISSUER, aud: SESSION_AUDIENCE } as Record<string, unknown>;
    if (mode === "legacy") { delete claims.iss; delete claims.aud; delete claims.iat; }
    if (mode === "old") claims.iat = now - 28801;
    if (mode === "issuer") claims.iss = "wrong";
    if (mode === "audience") claims.aud = "wrong";
    cookie = mode === "missing" ? undefined : await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(secret));
    assert.equal((await agents.GET(request(undefined, "GET"))).status, 401);
    assert.equal((await execution.GET()).status, 401);
    assert.equal((await technical.GET()).status, 401);
    assert.equal((await review.GET(request(undefined, "GET"), params())).status, 401);
    for (const [, invoke] of privileged) assert.equal((await invoke()).status, 401);
    await assert.rejects(passport.passportOrganisation(), /NOT_FOUND/);
    assert.deepEqual(reads, []); assert.deepEqual(writes, []); assert.deepEqual(queryLog, []);
  });
}

// S0.2 LOW regression: unknown failures must never default to business conflict.
for (const [name, invoke] of privileged.slice(0, 2)) {
  for (const mode of ['missing organisation', 'inactive organisation', 'database failure', 'runtime failure', 'non-Error failure', 'private diagnostic containing business code']) {
    test(`${name}: ${mode} preserves the auth/infrastructure taxonomy`, async () => {
      if (mode === 'missing organisation') missingOrg = true;
      if (mode === 'inactive organisation') activeOrg = false;
      if (mode === 'database failure') databaseError = true;
      if (mode === 'runtime failure') writeFailure = new Error('PRIVATE database details');
      if (mode === 'non-Error failure') writeFailure = { private: 'PRIVATE runtime details' };
      if (mode === 'private diagnostic containing business code') writeFailure = new Error('PRIVATE FIELD_STALE_SOURCE EXECUTION_STALE_SOURCE');
      const response = await invoke();
      assert.equal(response.status, mode.includes('organisation') ? 403 : 500);
      assert.doesNotMatch(await response.text(), /PRIVATE|private-db-detail/);
      assert.equal(writes.length, 0);
    });
  }
  const codes = name.startsWith('execution')
    ? ['EXECUTION_STALE_SOURCE', 'EXECUTION_STALE_POLICY', 'EXECUTION_STALE_STATE', 'EXECUTION_REPLAY_CONFLICT', 'EXECUTION_DECISION_INVALID']
    : ['FIELD_STALE_SOURCE', 'FIELD_STALE_POLICY', 'FIELD_STALE_STATE', 'FIELD_DECISION_REPLAY_CONFLICT'];
  for (const code of codes) {
    test(`${name}: known business ${code} remains 409`, async () => {
      writeFailure = new Error(code);
      const response = await invoke();
      assert.equal(response.status, 409);
      if (code === 'FIELD_STALE_SOURCE' || code === 'FIELD_STALE_POLICY') assert.equal((await response.json()).code, code);
    });
  }
}
