import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  LEGACY_SESSION_COOKIE_NAME,
  verifyLegacyToken,
} from "@/lib/auth/token";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/api/auth/login",
  "/api/auth/signup",
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function rejectUnauthenticated(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  if (!token) return rejectUnauthenticated(request);

  const session = await verifyLegacyToken(token);
  if (!session) return rejectUnauthenticated(request);

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
