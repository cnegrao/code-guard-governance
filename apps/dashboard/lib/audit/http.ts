import "server-only";
import { NextResponse } from "next/server";
import { SessionAuthenticationError } from "../auth";
import { LedgerReadAuthorizationError, LedgerReadUnavailableError } from "../governance/ledger-read";

// Audit responses are session-bound and must not enter a shared/browser cache.
export function auditJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function auditReadError(error: unknown) {
  if (error instanceof SessionAuthenticationError) return auditJson({ error: "Not authenticated" }, 401);
  if (error instanceof LedgerReadAuthorizationError) return auditJson({ error: "Ledger access denied" }, 403);
  if (error instanceof RangeError) return auditJson({ error: "Invalid audit request" }, 400);
  if (error instanceof LedgerReadUnavailableError) return auditJson({ error: "Ledger reading temporarily unavailable" }, 503);
  return auditJson({ error: "Audit request failed" }, 500);
}
