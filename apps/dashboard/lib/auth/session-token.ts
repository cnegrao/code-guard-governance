import { jwtVerify, SignJWT } from "jose";

// Application-owned contract: never derived from a request or environment URL.
export const SESSION_ISSUER = "codeguard-governance";
export const SESSION_AUDIENCE = "codeguard-dashboard";
export const SESSION_ALGORITHM = "HS256";
export const SESSION_COOKIE_NAME = "codeguard-token";
export const GOVERNANCE_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  sub: string;
  org: string;
  /** Display compatibility only; not current authorization eligibility. */
  email: string;
  /** Legacy display claim; never an M16 permission basis. */
  role: string;
}

/** Authentication only. S0.3 must evaluate credential freshness and current
 * persisted eligibility separately, using these verified timestamps/identities. */
export interface VerifiedGovernancePrincipal {
  readonly userId: string;
  readonly organisationId: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
  readonly informational: {
    readonly email?: string;
    readonly role?: string;
  };
}

/** Shared by ALL application session signing and verification, including legacy
 * readers. Validate on each use so missing/rotated configuration fails closed. */
export function requireJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const bytes = new TextEncoder().encode(secret);
  const normalized = secret?.trim().toLowerCase() ?? "";
  if (!normalized || bytes.byteLength < 32 ||
      normalized === "fallback-dev-secret-change-in-production" ||
      normalized === "change-me-to-a-random-64-char-hex-string" ||
      /example|placeholder|change[-_ ]?me|replace[-_ ]?me|your[-_ ]?(jwt[-_ ]?)?secret/.test(normalized) ||
      /^(.)\1+$/.test(normalized)) {
    throw new Error("JWT_SECRET must be a non-placeholder secret of at least 32 bytes");
  }
  return bytes;
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value);
}

function isNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function signToken(payload: SessionPayload): Promise<string> {
  const secret = requireJwtSecret();
  if (!isIdentity(payload.sub) || !isIdentity(payload.org)) {
    throw new Error("Invalid session identity");
  }
  const now = Math.floor(Date.now() / 1000);
  // Copy only the supported claims; callers cannot override reserved claims.
  return new SignJWT({ org: payload.org, email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: SESSION_ALGORITHM })
    .setSubject(payload.sub)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + GOVERNANCE_SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

/** Verify actual cookie bytes; no headers, request identity or configurable
 * issuer/audience accepted. Legacy tokens intentionally fail this boundary. */
export async function verifyGovernanceSessionToken(token: string): Promise<VerifiedGovernancePrincipal> {
  const secret = requireJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [SESSION_ALGORITHM],
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
    requiredClaims: ["sub", "org", "iat", "exp", "iss", "aud"],
    currentDate: new Date(now * 1000),
    clockTolerance: 0,
  });
  if (!isIdentity(payload.sub) || !isIdentity(payload.org) ||
      payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE ||
      !isNumericDate(payload.iat) || !isNumericDate(payload.exp) ||
      payload.iat > now || payload.exp <= now || payload.exp <= payload.iat ||
      now - payload.iat > GOVERNANCE_SESSION_MAX_AGE_SECONDS ||
      (payload.nbf !== undefined &&
        (!isNumericDate(payload.nbf) || payload.nbf > now || payload.nbf >= payload.exp))) {
    throw new Error("Invalid governance session claims");
  }
  return Object.freeze({
    userId: payload.sub,
    organisationId: payload.org,
    issuedAtSeconds: payload.iat,
    expiresAtSeconds: payload.exp,
    informational: Object.freeze({
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.role === "string" ? { role: payload.role } : {}),
    }),
  });
}
