import { jwtVerify, SignJWT } from "jose";
import { CREDENTIAL_EPOCH_CLAIM, parseCredentialEpochMillis } from "./credential-epoch";

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

/** Everything signToken needs. `credentialEpoch` is the exact DB-authored
 * governance_users.password_changed_at text of the credential that established
 * the session; it is never derived from, or rounded to, any JWT timestamp. */
export interface SessionSigningInput extends SessionPayload {
  credentialEpoch: string;
}

/** Authentication only. S0.3 must evaluate credential freshness and current
 * persisted eligibility separately, using these verified timestamps/identities.
 * `credentialEpoch` is authenticated session metadata: freshness is decided only
 * by exact equality against the locked DB row (S0.3.3 passes it to the helper). */
export interface VerifiedGovernancePrincipal {
  readonly userId: string;
  readonly organisationId: string;
  readonly credentialEpoch: string;
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

export async function signToken(payload: SessionSigningInput): Promise<string> {
  const secret = requireJwtSecret();
  if (!isIdentity(payload.sub) || !isIdentity(payload.org)) {
    throw new Error("Invalid session identity");
  }
  if (!Number.isFinite(parseCredentialEpochMillis(payload.credentialEpoch))) {
    throw new Error("Invalid session credential epoch");
  }
  const now = Math.floor(Date.now() / 1000);
  // Copy only the supported claims; callers cannot override reserved claims.
  return new SignJWT({
    org: payload.org, email: payload.email, role: payload.role,
    // Exact DB text, verbatim: no Date round-trip, no rounding, no iat derivation.
    [CREDENTIAL_EPOCH_CLAIM]: payload.credentialEpoch,
  })
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
    requiredClaims: ["sub", "org", "iat", "exp", "iss", "aud", CREDENTIAL_EPOCH_CLAIM],
    currentDate: new Date(now * 1000),
    clockTolerance: 0,
  });
  const credentialEpoch = payload[CREDENTIAL_EPOCH_CLAIM];
  if (!isIdentity(payload.sub) || !isIdentity(payload.org) ||
      typeof credentialEpoch !== "string" || !Number.isFinite(parseCredentialEpochMillis(credentialEpoch)) ||
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
    credentialEpoch,
    issuedAtSeconds: payload.iat,
    expiresAtSeconds: payload.exp,
    informational: Object.freeze({
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.role === "string" ? { role: payload.role } : {}),
    }),
  });
}
