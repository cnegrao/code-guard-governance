import "server-only";
import { NextResponse } from "next/server";

/**
 * M16-S0.3.3C: thrown by every production persistence call site that invokes a
 * *_governed_v1 DB write wrapper, in place of a bare Error, so the exact SQLSTATE
 * PostgREST returned (GV001-GV006, 55P03, or any other code) survives up to the
 * route/service boundary for security classification — without ever exposing the
 * DETAIL/raw DB message to the client. `.message` is constructed exactly the same
 * way the legacy adapters already did, so every existing business-error
 * string/regex match against `.message` elsewhere in this codebase (workspace
 * -commands.ts, decision-commands.ts, technical-fact-persistence.ts's own
 * FIELD_STALE_SOURCE/FIELD_STALE_POLICY rewriting, etc.) is unaffected.
 */
export class GovernedWriteError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string | null) {
    super(message);
    this.name = "GovernedWriteError";
    this.code = code ?? undefined;
  }
}

interface GovernedWriteHttpMapping {
  readonly status: number;
  readonly body: { readonly error: string };
  readonly retryAfterSeconds?: number;
}

// Frozen mapping (M16-S0.3.3C §10). GV004/GV005 indicate an authoritative-state
// inconsistency the application itself cannot resolve — infrastructure, never a
// client-fixable 4xx business conflict, so they map to 500, not 409.
const GV_HTTP_MAPPING: Readonly<Record<string, GovernedWriteHttpMapping>> = Object.freeze({
  GV001: { status: 401, body: { error: "Not authenticated" } },
  GV002: { status: 401, body: { error: "Not authenticated" } },
  GV003: { status: 403, body: { error: "You are not authorized to perform this action." } },
  GV006: { status: 403, body: { error: "You are not authorized to perform this action." } },
  GV004: { status: 500, body: { error: "Unable to process this action." } },
  GV005: { status: 500, body: { error: "Unable to process this action." } },
});

/**
 * Classifies a governed-write security/infrastructure SQLSTATE into its frozen
 * HTTP response, or returns undefined when `error` is not a GovernedWriteError,
 * or carries no code, or the code is not one of the recognized GV*-or-55P03 ones —
 * the caller's own existing business-error handling decides in that case,
 * deliberately unchanged. An unrecognized code (including plain infrastructure
 * failures) falls through to the caller's own generic 500, never 409.
 */
export function mapGovernedWriteSecurityError(error: unknown): GovernedWriteHttpMapping | undefined {
  if (!(error instanceof GovernedWriteError) || !error.code) return undefined;
  if (error.code === "55P03") {
    return { status: 503, body: { error: "Unable to process this action. Please retry." }, retryAfterSeconds: 1 };
  }
  return GV_HTTP_MAPPING[error.code];
}

/** True for a GovernedWriteError whose code this classifier recognizes as security/infra —
 * used by callers that must rethrow it past their own business-error handling, unconverted. */
export function isGovernedWriteSecurityError(error: unknown): boolean {
  return mapGovernedWriteSecurityError(error) !== undefined;
}

/** Route-level convenience: the exact NextResponse for a recognized security/infra
 * failure, or undefined (meaning: fall through to the route's own handling). */
export function governedWriteErrorResponse(error: unknown): NextResponse | undefined {
  const mapping = mapGovernedWriteSecurityError(error);
  if (!mapping) return undefined;
  const response = NextResponse.json(mapping.body, { status: mapping.status });
  if (mapping.retryAfterSeconds !== undefined) response.headers.set("Retry-After", String(mapping.retryAfterSeconds));
  return response;
}
