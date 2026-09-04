import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";

interface MockState {
  user: {
    user_id: string;
    email: string;
    full_name: string;
    organisation_id: string;
    status: string;
    role_ids: string[];
  } | null;
  passwordValid: boolean;
  org: { organisation_id: string; name: string; is_active: boolean } | null;
  roleRows: Array<{ role_id: string; role_code: string; is_system_role: boolean }>;
  dummyWorkCalls: number;
}

const state: MockState = {
  user: null,
  passwordValid: false,
  org: null,
  roleRows: [],
  dummyWorkCalls: 0,
};

mock.module("@/lib/auth/persistence", {
  namedExports: {
    canonicalizeEmail: (e: string) => e.trim().toLowerCase(),
    findUserIdentityForAuth: async () => state.user,
    verifyPasswordForAuth: async () => state.passwordValid,
    verifyPasswordDummyWork: async () => {
      state.dummyWorkCalls += 1;
    },
    resolveRoleCodesForAuth: async () => state.roleRows,
    getOrganisationForAuth: async () => state.org,
    signupLegacyAtomic: async () => {
      throw new Error("signupLegacyAtomic should not be called from login tests");
    },
  },
});

let authService: typeof import("../services/auth");

before(async () => {
  authService = await import("@/services/auth");
});

function resetState() {
  state.user = null;
  state.passwordValid = false;
  state.org = null;
  state.roleRows = [];
  state.dummyWorkCalls = 0;
}

const BASE_USER = {
  user_id: "user-1",
  email: "admin@example.com",
  full_name: "Admin User",
  organisation_id: "org-1",
  status: "active",
  role_ids: ["role-1"],
};

const BASE_ORG = { organisation_id: "org-1", name: "Acme", is_active: true };

test("login: valid principal flow returns a session with token, user, and org", async () => {
  resetState();
  state.user = { ...BASE_USER };
  state.passwordValid = true;
  state.org = { ...BASE_ORG };
  state.roleRows = [{ role_id: "role-1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }];

  const result = await authService.login("admin@example.com", "correct-password");

  assert.equal(result.success, true);
  assert.ok(result.session);
  assert.equal(typeof result.session!.token, "string");
  assert.equal(result.session!.user.user_id, "user-1");
  assert.equal(result.session!.org.organisation_id, "org-1");
  assert.equal(result.jwtRole, "org_admin");
});

test("login: unknown user rejects with invalid credentials and still runs dummy bcrypt work", async () => {
  resetState();
  state.user = null;

  await assert.rejects(
    () => authService.login("nobody@example.com", "whatever"),
    /Invalid email or password/
  );
  assert.equal(state.dummyWorkCalls, 1, "dummy bcrypt work must execute for unknown users (timing-attack mitigation)");
});

test("login: wrong password rejects with invalid credentials (no token issued)", async () => {
  resetState();
  state.user = { ...BASE_USER };
  state.passwordValid = false;

  await assert.rejects(
    () => authService.login("admin@example.com", "wrong-password"),
    /Invalid email or password/
  );
});

test("login: inactive user rejects with account inactive", async () => {
  resetState();
  state.user = { ...BASE_USER, status: "suspended" };
  state.passwordValid = true;

  await assert.rejects(
    () => authService.login("admin@example.com", "correct-password"),
    /Account is not active/
  );
});

test("login: missing organisation rejects with invalid credentials", async () => {
  resetState();
  state.user = { ...BASE_USER };
  state.passwordValid = true;
  state.org = null;

  await assert.rejects(
    () => authService.login("admin@example.com", "correct-password"),
    /Invalid email or password/
  );
});

test("login: inactive organisation rejects with account inactive", async () => {
  resetState();
  state.user = { ...BASE_USER };
  state.passwordValid = true;
  state.org = { ...BASE_ORG, is_active: false };

  await assert.rejects(
    () => authService.login("admin@example.com", "correct-password"),
    /Account is not active/
  );
});

test("login: persisted user organisation_id is the sole JWT organisation source", async () => {
  resetState();
  state.user = { ...BASE_USER, organisation_id: "org-persisted-123" };
  state.passwordValid = true;
  state.org = { organisation_id: "org-persisted-123", name: "Acme", is_active: true };
  state.roleRows = [];

  const result = await authService.login("admin@example.com", "correct-password");
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
  );
  const { payload } = await jwtVerify(result.session!.token, secret);

  assert.equal(payload.org, "org-persisted-123");
  // login() takes only (email, password) — there is no request-supplied
  // organisation parameter that could override the persisted value.
  assert.equal(authService.login.length, 2);
});

test("login: no role_ids.length elevation — user with roles but empty role_ids gets non-admin jwtRole", async () => {
  resetState();
  state.user = { ...BASE_USER, role_ids: [] };
  state.passwordValid = true;
  state.org = { ...BASE_ORG };
  state.roleRows = [{ role_id: "role-1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }];

  const result = await authService.login("admin@example.com", "correct-password");
  assert.equal(result.jwtRole, "user");
});
