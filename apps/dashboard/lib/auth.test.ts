import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  assertLegacyAuthConfigured,
  createLegacySessionResponse,
  getAuthContextFromToken,
} from "./auth";
import {
  getRequiredJwtSecret,
  LegacyAuthConfigurationError,
  signLegacyToken,
  verifyLegacyToken,
} from "./auth/token";
import type { LegacyAuthResult } from "@/types/auth";

const TEST_SECRET = "test-only-legacy-jwt-secret";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";

describe("legacy authentication token boundary", () => {
  let previousSecret: string | undefined;

  before(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
  });

  after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it("fails closed when JWT_SECRET is absent", async () => {
    delete process.env.JWT_SECRET;

    assert.throws(
      () => getRequiredJwtSecret(),
      LegacyAuthConfigurationError
    );
    assert.throws(
      () => assertLegacyAuthConfigured(),
      LegacyAuthConfigurationError
    );
    assert.equal(await verifyLegacyToken("untrusted-token"), null);

    process.env.JWT_SECRET = TEST_SECRET;
  });

  it("rejects an invalid token", async () => {
    assert.equal(await verifyLegacyToken("not-a-jwt"), null);
  });

  it("rejects an expired token", async () => {
    const { SignJWT } = await import("jose");
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: USER_ID,
      org: ORGANISATION_ID,
      email: "user@example.com",
      role: "org_admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(getRequiredJwtSecret());

    assert.equal(await verifyLegacyToken(token), null);
  });

  it("rejects a structurally malformed payload", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({
      sub: "not-a-uuid",
      org: ORGANISATION_ID,
      email: "not-an-email",
      role: "",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getRequiredJwtSecret());

    assert.equal(await verifyLegacyToken(token), null);
  });

  it("creates AuthContext only from validated legacy claims", async () => {
    const token = await signLegacyToken({
      sub: USER_ID,
      org: ORGANISATION_ID,
      email: "user@example.com",
      role: "org_admin",
    });

    assert.deepEqual(await getAuthContextFromToken(token), {
      userId: USER_ID,
      organisationId: ORGANISATION_ID,
      email: "user@example.com",
      role: {
        source: "LEGACY",
        value: "org_admin",
      },
    });
  });

  it("does not expose the token in login JSON", async () => {
    const result = buildAuthResult();
    const response = createLegacySessionResponse(result);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { session: result.session });
    assert.equal("token" in body.session, false);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  });

  it("does not expose the token in signup JSON", async () => {
    const result = buildAuthResult();
    const response = createLegacySessionResponse(result, 201);
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(body, { session: result.session });
    assert.equal("token" in body.session, false);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  });
});

function buildAuthResult(): LegacyAuthResult {
  return {
    token: "server-only-token",
    session: {
      user: {
        user_id: USER_ID,
        email: "user@example.com",
        full_name: "Test User",
      },
      org: {
        organisation_id: ORGANISATION_ID,
        name: "Test Organisation",
        industry: "other",
      },
    },
  };
}
