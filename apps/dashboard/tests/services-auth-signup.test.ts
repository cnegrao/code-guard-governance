import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";

interface MockState {
  signupResult: {
    user_id: string;
    email: string;
    full_name: string;
    organisation_id: string;
    organisation_name: string;
    role_id: string;
    role_code: string;
  } | null;
  signupError: Error | null;
  roleRows: Array<{ role_id: string; role_code: string; is_system_role: boolean }>;
  signupCalls: number;
  roleLookupCalls: number;
}

const state: MockState = {
  signupResult: null,
  signupError: null,
  roleRows: [],
  signupCalls: 0,
  roleLookupCalls: 0,
};

mock.module("@/lib/auth/persistence", {
  namedExports: {
    canonicalizeEmail: (e: string) => e.trim().toLowerCase(),
    findUserIdentityForAuth: async () => {
      throw new Error("findUserIdentityForAuth should not be called from signup tests");
    },
    verifyPasswordForAuth: async () => {
      throw new Error("verifyPasswordForAuth should not be called from signup tests");
    },
    verifyPasswordDummyWork: async () => {},
    resolveRoleCodesForAuth: async () => {
      state.roleLookupCalls += 1;
      return state.roleRows;
    },
    getOrganisationForAuth: async () => {
      throw new Error("getOrganisationForAuth should not be called from signup tests");
    },
    signupLegacyAtomic: async () => {
      state.signupCalls += 1;
      if (state.signupError) throw state.signupError;
      return state.signupResult;
    },
  },
});

let authService: typeof import("../services/auth");

before(async () => {
  authService = await import("@/services/auth");
});

function resetState() {
  state.signupResult = null;
  state.signupError = null;
  state.roleRows = [];
  state.signupCalls = 0;
  state.roleLookupCalls = 0;
}

const SIGNUP_INPUT = {
  email: "founder@example.com",
  password: "correct-password",
  fullName: "Founder",
  orgName: "Acme Corp",
  industry: "other",
};

test("signup: atomic persistence completes and is re-verified before token signing", async () => {
  resetState();
  state.signupResult = {
    user_id: "user-1",
    email: "founder@example.com",
    full_name: "Founder",
    organisation_id: "org-1",
    organisation_name: "Acme Corp",
    role_id: "role-1",
    role_code: "GOVERNANCE_ADMIN",
  };
  state.roleRows = [{ role_id: "role-1", role_code: "GOVERNANCE_ADMIN", is_system_role: true }];

  const result = await authService.signup(SIGNUP_INPUT);

  assert.equal(state.signupCalls, 1);
  assert.equal(state.roleLookupCalls, 1, "signup must re-verify the role via a privileged lookup, not trust role_code blindly");
  assert.ok(result.session);
  assert.equal(result.jwtRole, "org_admin");

  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
  );
  const { payload } = await jwtVerify(result.session!.token, secret);
  assert.equal(payload.role, "org_admin");
});

test("signup: DB failure produces no token and propagates a sanitized public error", async () => {
  resetState();
  const { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } = await import("@/lib/auth/errors");
  state.signupError = new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);

  await assert.rejects(() => authService.signup(SIGNUP_INPUT), (err: unknown) => {
    assert.ok(err instanceof AuthPublicError);
    assert.equal(err.message, GENERIC_AUTH_ERROR_MESSAGE);
    assert.equal(err.status, 500);
    return true;
  });
  assert.equal(state.roleLookupCalls, 0, "no role lookup or token should happen when persistence fails");
});

test("signup: fails closed to non-admin if the returned role cannot be re-verified as a system role", async () => {
  resetState();
  state.signupResult = {
    user_id: "user-2",
    email: "notadmin@example.com",
    full_name: "Not Admin",
    organisation_id: "org-2",
    organisation_name: "Acme Corp",
    role_id: "role-2",
    role_code: "GOVERNANCE_ADMIN",
  };
  // Simulates a race/anomaly where the privileged lookup no longer confirms
  // is_system_role — the app must never trust the RPC's role_code string alone.
  state.roleRows = [{ role_id: "role-2", role_code: "GOVERNANCE_ADMIN", is_system_role: false }];

  const result = await authService.signup(SIGNUP_INPUT);
  assert.equal(result.jwtRole, "user");
});
