import { SESSION_COOKIE_NAME, verifyGovernanceSessionToken } from "@/lib/auth/session-token";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordE1Authentication } from "@/lib/auth/e1-diagnostics";

const PUBLIC_PATHS = ["/login", "/signup", "/onboarding", "/api/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Host-only cookies are intentionally not shared between localhost and
  // 127.0.0.1. Canonicalise E1 navigation before rendering the login form.
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_APP_URL === "http://localhost:3101" &&
      request.headers.get("host") === "127.0.0.1:3101") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      recordE1Authentication("alias-post-refused", { path: pathname });
      return NextResponse.json({ error: "Use http://localhost:3101/login before submitting credentials." }, { status: 409 });
    }
    recordE1Authentication("alias-redirect", { path: pathname });
    return NextResponse.redirect(new URL(pathname + request.nextUrl.search, "http://localhost:3101"));
  }

  const isPublic = pathname === "/accept-invitation" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    recordE1Authentication("cookie-missing", { path: pathname });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    // Navigation only. APIs must resolve their own verified principal.
    await verifyGovernanceSessionToken(token);
    recordE1Authentication("middleware-jwt-verified", { path: pathname });
    return NextResponse.next();
  } catch {
    recordE1Authentication("middleware-jwt-invalid", { path: pathname });
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
