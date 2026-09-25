import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import {
  requireJwtSecret, SESSION_ALGORITHM, SESSION_COOKIE_NAME,
  GOVERNANCE_SESSION_MAX_AGE_SECONDS, verifyGovernanceSessionToken,
  type SessionPayload, type VerifiedGovernancePrincipal,
} from "./auth/session-token";

export { signToken, type SessionPayload } from "./auth/session-token";

export async function requireVerifiedGovernancePrincipal(): Promise<VerifiedGovernancePrincipal> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new Error("Not authenticated");
  return verifyGovernanceSessionToken(token);
}

/** DEFERRED_TO_S0.2: legacy Passport/M13 reader, not the M16 principal.
 * Retains historical claim compatibility until those consumers migrate.
 * In particular, its role claim is NOT current governance authorization. */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, requireJwtSecret(), {
      algorithms: [SESSION_ALGORITHM],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function setTokenCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${GOVERNANCE_SESSION_MAX_AGE_SECONDS}; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}
