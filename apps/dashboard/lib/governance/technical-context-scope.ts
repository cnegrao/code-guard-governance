import "server-only";
import type { VerifiedGovernancePrincipal } from "../auth/session-token";

declare const technicalScope: unique symbol;
const scopes = new WeakSet<object>();
const hash = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface ResolvedTechnicalScope {
  readonly [technicalScope]: true;
  readonly organisation_id: string;
  readonly repository_id: string;
  readonly snapshot_id: string;
}
export interface TechnicalScopeConfiguration {
  readonly bindings: readonly {
    readonly selection_key: string;
    readonly organisation_id: string;
    readonly repository_id: string;
    readonly snapshot_id: string;
  }[];
}
export const isResolvedTechnicalScope = (value: unknown): value is ResolvedTechnicalScope =>
  value !== null && typeof value === "object" && scopes.has(value);

/** Captures operator-owned exact bindings. Selectors never construct resource/tenant IDs. */
export function createTechnicalScopeSource(configuration: TechnicalScopeConfiguration) {
  if (!configuration || Reflect.ownKeys(configuration).length !== 1 || !Array.isArray(configuration.bindings))
    throw new TypeError("Invalid technical scope configuration");
  const bindings = new Map<string, ResolvedTechnicalScope>();
  for (const binding of configuration.bindings) {
    if (!binding || Reflect.ownKeys(binding).length !== 4 ||
        !["selection_key", "organisation_id", "repository_id", "snapshot_id"].every(k => Object.hasOwn(binding, k)) ||
        typeof binding.selection_key !== "string" || !binding.selection_key.trim() ||
        Buffer.byteLength(binding.selection_key, "utf8") > 512 || typeof binding.organisation_id !== "string" || !uuid.test(binding.organisation_id) ||
        typeof binding.repository_id !== "string" || !hash.test(binding.repository_id) || typeof binding.snapshot_id !== "string" ||
        !hash.test(binding.snapshot_id)) throw new TypeError("Invalid technical scope configuration");
    const key = JSON.stringify([binding.organisation_id, binding.selection_key]);
    if (bindings.has(key)) throw new TypeError("Duplicate technical scope binding");
    const scope = Object.freeze({ organisation_id: binding.organisation_id, repository_id: binding.repository_id,
      snapshot_id: binding.snapshot_id }) as ResolvedTechnicalScope;
    scopes.add(scope); bindings.set(key, scope);
  }
  return (principal: VerifiedGovernancePrincipal, selectionKey: string):
    { readonly scope: ResolvedTechnicalScope } | { readonly unavailable: "SCOPE_REQUIRED" } => {
    if (!principal || typeof principal.organisationId !== "string" || !uuid.test(principal.organisationId) ||
        typeof selectionKey !== "string") return Object.freeze({ unavailable: "SCOPE_REQUIRED" as const });
    const scope = bindings.get(JSON.stringify([principal.organisationId, selectionKey]));
    return scope ? Object.freeze({ scope }) : Object.freeze({ unavailable: "SCOPE_REQUIRED" as const });
  };
}
