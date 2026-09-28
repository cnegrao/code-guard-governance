import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  GOVERNANCE_SESSION_MAX_AGE_SECONDS, verifyGovernanceSessionToken,
  type SessionPayload, type VerifiedGovernancePrincipal,
} from "./auth/session-token";

export type { SessionPayload, SessionSigningInput } from "./auth/session-token";

// M16-S0.3.3D: signToken (the credential/token-issuance capability) is
// deliberately NOT re-exported from this broad barrel. Production code that
// legitimately issues a session token imports it narrowly from
// "@/lib/auth/session-token" (see lib/auth/session-issuance.ts) — never
// through this general-purpose auth surface, which every route/module in the
// app already imports for unrelated reasons (requireVerifiedGovernancePrincipal,
// SessionAuthenticationError, etc.). Narrowing the import path means a
// broader set of call sites can no longer casually mint a session token.

export class SessionAuthenticationError extends Error {
  constructor() { super("Not authenticated"); }
}

export async function requireVerifiedGovernancePrincipal(): Promise<VerifiedGovernancePrincipal> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new SessionAuthenticationError();
  try { return await verifyGovernanceSessionToken(token); }
  catch { throw new SessionAuthenticationError(); }
}

/** Compatibility only: identical strict verification; role/email are display
 * data, never authorization. Production routes use the principal directly. */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const principal = await verifyGovernanceSessionToken(token);
    return { sub: principal.userId, org: principal.organisationId,
      email: principal.informational.email ?? "", role: principal.informational.role ?? "" };
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
