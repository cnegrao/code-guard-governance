/** Test-dashboard observability only. Never accepts credentials, tokens,
 * cookies, signing keys or arbitrary request/header objects as log values. */
type Stage = "alias-redirect" | "alias-post-refused" | "cookie-issued" | "cookie-missing" | "middleware-jwt-invalid" | "middleware-jwt-verified" | "node-jwt-verified" | "review-detail";
export function recordE1Authentication(stage: Stage, details: { path?: string; evidenceCount?: number; assertionCount?: number } = {}): void {
  if (process.env.NODE_ENV !== "development" || process.env.GOVIA_E1_AUTH_DIAGNOSTICS !== "1" ||
      process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3101") return;
  console.info("[govia-e1-auth]", JSON.stringify({ stage, ...details }));
}
