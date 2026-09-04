import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

interface MockState {
  behavior: "success" | "throw";
  error: unknown;
  session: {
    token: string;
    user: { user_id: string; email: string; full_name: string };
    org: { organisation_id: string; name: string; industry: string };
  } | null;
}

const state: MockState = { behavior: "success", error: null, session: null };

mock.module("@/services/auth", {
  namedExports: {
    login: async () => {
      if (state.behavior === "throw") throw state.error;
      return { success: true, session: state.session, jwtRole: "user", roleSource: "LEGACY", resolvedRoleCodes: [], userOrganisationId: null };
    },
    signup: async () => {
      throw new Error("signup should not be called from login route tests");
    },
    INVALID_CREDENTIALS_MESSAGE: "Invalid email or password",
    ACCOUNT_INACTIVE_MESSAGE: "Account is not active",
  },
});

let POST: typeof import("../app/api/auth/login/route").POST;

before(async () => {
  ({ POST } = await import("@/app/api/auth/login/route"));
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("login route: successful login never puts the token in the JSON body and sets an HttpOnly cookie", async () => {
  state.behavior = "success";
  state.session = {
    token: "super-secret-jwt-token",
    user: { user_id: "u1", email: "a@example.com", full_name: "A" },
    org: { organisation_id: "o1", name: "Acme", industry: "other" },
  };

  const res = await POST(makeRequest({ email: "a@example.com", password: "correct-password" }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(json).includes("super-secret-jwt-token"), false, "token must never appear in the JSON body");
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.ok(setCookie.includes("super-secret-jwt-token"));
  assert.ok(/HttpOnly/i.test(setCookie), "session cookie must be HttpOnly");
});

test("login route: unknown-credential and bad-password errors produce an identical public response", async () => {
  const { AuthPublicError, INVALID_CREDENTIALS_MESSAGE } = await import("@/lib/auth/errors");

  state.behavior = "throw";
  state.error = new AuthPublicError(INVALID_CREDENTIALS_MESSAGE, 401);
  const unknownRes = await POST(makeRequest({ email: "nobody@example.com", password: "x" }));
  const unknownJson = await unknownRes.json();

  state.error = new AuthPublicError(INVALID_CREDENTIALS_MESSAGE, 401);
  const badPwRes = await POST(makeRequest({ email: "a@example.com", password: "wrong" }));
  const badPwJson = await badPwRes.json();

  assert.equal(unknownRes.status, badPwRes.status);
  assert.deepEqual(unknownJson, badPwJson);
});

test("login route: unexpected internal exception produces a sanitized generic response, never raw error.message", async () => {
  state.behavior = "throw";
  state.error = new Error("relation \"governance_users\" does not exist: connection to postgres://internal-host failed");

  const res = await POST(makeRequest({ email: "a@example.com", password: "x" }));
  const json = await res.json();

  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(json).includes("postgres://"), false);
  assert.equal(JSON.stringify(json).includes("governance_users"), false);
  assert.equal(json.error, "Unable to process your request. Please try again later.");
});

test("login route: invalid request body is rejected with a validation message, not a 500", async () => {
  const res = await POST(makeRequest({ email: "not-an-email", password: "" }));
  assert.equal(res.status, 400);
});
