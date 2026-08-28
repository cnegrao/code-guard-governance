import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getRequiredJwtSecret,
  LEGACY_SESSION_COOKIE_NAME,
  verifyLegacyToken,
} from "@/lib/auth/token";
import type { AuthContext, LegacyAuthResult } from "@/types/auth";

export function assertLegacyAuthConfigured(): void {
  getRequiredJwtSecret();
}

export async function getAuthContextFromToken(
  token: string | undefined
): Promise<AuthContext | null> {
  if (!token) return null;

  const payload = await verifyLegacyToken(token);
  if (!payload) return null;

  return {
    userId: payload.sub,
    organisationId: payload.org,
    email: payload.email,
    role: {
      source: "LEGACY",
      value: payload.role,
    },
  };
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  return getAuthContextFromToken(token);
}

export function setTokenCookie(token: string): string {
  return `${LEGACY_SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

export function createLegacySessionResponse(
  result: LegacyAuthResult,
  status: number = 200
): NextResponse {
  const response = NextResponse.json({ session: result.session }, { status });
  response.headers.set("Set-Cookie", setTokenCookie(result.token));
  return response;
}
