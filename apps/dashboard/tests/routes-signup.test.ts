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
      throw new Error("login should not be called from signup route tests");
    },
    signup: async () => {
      if (state.behavior === "throw") throw state.error;
      return { success: true, session: state.session, jwtRole: "org_admin", roleSource: "LEGACY" };
    },
    INVALID_CREDENTIALS_MESSAGE: "Invalid email or password",
    ACCOUNT_INACTIVE_MESSAGE: "Account is not active",
  },
});

let POST: typeof import("../app/api/auth/signup/route").POST;

before(async () => {
  ({ POST } = await import("@/app/api/auth/signup/route"));
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  email: "founder@example.com",
  password: "correct-password",
  fullName: "Founder",
  orgName: "Acme Corp",
  industry: "other",
};

test("signup route: successful signup never puts the token in the JSON body and sets an HttpOnly cookie", async () => {
  state.behavior = "success";
  state.session = {
    token: "super-secret-jwt-token",
    user: { user_id: "u1", email: "founder@example.com", full_name: "Founder" },
    org: { organisation_id: "o1", name: "Acme Corp", industry: "other" },
  };

  const res = await POST(makeRequest(VALID_BODY));
  const json = await res.json();

  assert.equal(res.status, 201);
  assert.equal(JSON.stringify(json).includes("super-secret-jwt-token"), false);
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.ok(setCookie.includes("super-secret-jwt-token"));
  assert.ok(/HttpOnly/i.test(setCookie));
});

test("signup route: email-exists error is sanitized and returns 409, without raw DB detail", async () => {
  const { AuthPublicError, EMAIL_EXISTS_MESSAGE } = await import("@/lib/auth/errors");
  state.behavior = "throw";
  state.error = new AuthPublicError(EMAIL_EXISTS_MESSAGE, 409);

  const res = await POST(makeRequest(VALID_BODY));
  const json = await res.json();

  assert.equal(res.status, 409);
  assert.equal(json.error, EMAIL_EXISTS_MESSAGE);
});

test("signup route: unexpected internal exception (e.g. org_code collision) produces a sanitized generic response", async () => {
  state.behavior = "throw";
  state.error = new Error(
    'duplicate key value violates unique constraint "organisations_org_code_unique" DETAIL: Key (org_code)=(ACMECORP_1A2B3C4D) already exists.'
  );

  const res = await POST(makeRequest(VALID_BODY));
  const json = await res.json();

  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(json).includes("org_code"), false);
  assert.equal(JSON.stringify(json).includes("organisations_org_code_unique"), false);
  assert.equal(json.error, "Unable to process your request. Please try again later.");
});

test("signup route: invalid request body is rejected with a validation message, not a 500", async () => {
  const res = await POST(makeRequest({ ...VALID_BODY, email: "not-an-email" }));
  assert.equal(res.status, 400);
});
