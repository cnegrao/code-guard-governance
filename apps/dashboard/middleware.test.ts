import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { getAuthContextFromToken } from "./lib/auth";
import {
  getRequiredJwtSecret,
  LEGACY_SESSION_COOKIE_NAME,
  signLegacyToken,
} from "./lib/auth/token";
import { isPublicPath, middleware } from "./middleware";

const TEST_SECRET = "test-only-legacy-jwt-secret";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";

describe("authentication middleware", () => {
  let previousSecret: string | undefined;

  before(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
  });

  after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it("allows only the explicitly public paths", () => {
    assert.equal(isPublicPath("/login"), true);
    assert.equal(isPublicPath("/signup"), true);
    assert.equal(isPublicPath("/api/auth/login"), true);
    assert.equal(isPublicPath("/api/auth/signup"), true);
    assert.equal(isPublicPath("/onboarding"), false);
    assert.equal(isPublicPath("/api/auth/login-extra"), false);
    assert.equal(isPublicPath("/api/auth/me"), false);
  });

  it("keeps an exact public route accessible without a session", async () => {
    const response = await middleware(requestFor("/api/auth/login"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  it("protects a similar route that is not explicitly public", async () => {
    const response = await middleware(requestFor("/api/auth/login-extra"));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Not authenticated" });
  });

  it("returns JSON 401 for /api/auth/me without a session", async () => {
    const response = await middleware(requestFor("/api/auth/me"));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Not authenticated" });
  });

  it("returns JSON 401 for an invalid API token", async () => {
    const response = await middleware(
      requestFor("/api/agents", "invalid-token")
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Not authenticated" });
  });

  it("returns JSON 401 for an expired API token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(validClaims())
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(getRequiredJwtSecret());

    const response = await middleware(requestFor("/api/agents", token));
    assert.equal(response.status, 401);
  });

  it("returns JSON 401 for a malformed API token payload", async () => {
    const token = await new SignJWT({
      ...validClaims(),
      org: "not-a-uuid",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getRequiredJwtSecret());

    const response = await middleware(requestFor("/api/agents", token));
    assert.equal(response.status, 401);
  });

  it("ignores forged identity headers and emits none in the response", async () => {
    const token = await signLegacyToken(validClaims());
    const request = requestFor("/api/agents", token, {
      "x-codeguard-user": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "x-codeguard-org": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "x-codeguard-email": "attacker@example.com",
      "x-codeguard-role": "super_admin",
    });

    const response = await middleware(request);
    const context = await getAuthContextFromToken(
      request.cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value
    );

    assert.equal(response.status, 200);
    assert.deepEqual(context, {
      userId: USER_ID,
      organisationId: ORGANISATION_ID,
      email: "user@example.com",
      role: {
        source: "LEGACY",
        value: "org_admin",
      },
    });
    assert.equal(response.headers.get("x-codeguard-user"), null);
    assert.equal(response.headers.get("x-codeguard-org"), null);
    assert.equal(response.headers.get("x-codeguard-email"), null);
    assert.equal(response.headers.get("x-codeguard-role"), null);
  });

  it("redirects an unauthenticated protected page to login", async () => {
    const response = await middleware(requestFor("/dashboard"));

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "http://localhost/login");
  });
});

function validClaims() {
  return {
    sub: USER_ID,
    org: ORGANISATION_ID,
    email: "user@example.com",
    role: "org_admin",
  };
}

function requestFor(
  pathname: string,
  token?: string,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const headers = new Headers(extraHeaders);
  if (token) {
    headers.set("cookie", `${LEGACY_SESSION_COOKIE_NAME}=${token}`);
  }

  return new NextRequest(`http://localhost${pathname}`, { headers });
}
