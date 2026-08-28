import type { AuthContext } from "@/types/auth";
import {
  PERMISSIONS,
  type AuthorizationPolicy,
  type Permission,
} from "./types";

const USER_PERMISSIONS = [
  "portfolio:read",
  "agents:read",
  "systems:read",
  "graph:read",
] as const satisfies readonly Permission[];

/**
 * LEGACY AND TRANSITIONAL authorization adapter.
 *
 * This provisional mapping does not represent the definitive RBAC model:
 * - the role embedded in the legacy JWT can be stale;
 * - role_ids.length does not identify a real role;
 * - governance_roles is not translated by this adapter;
 * - this adapter must be removed when 3NF memberships and role assignments exist.
 */
export class LegacyRoleAuthorizationAdapter implements AuthorizationPolicy {
  async permissionsFor(
    context: AuthContext
  ): Promise<ReadonlySet<Permission>> {
    const role = context.role as { source?: unknown; value?: unknown };

    if (role.source !== "LEGACY") return new Set<Permission>();
    if (role.value === "org_admin") return new Set<Permission>(PERMISSIONS);
    if (role.value === "user") return new Set<Permission>(USER_PERMISSIONS);

    return new Set<Permission>();
  }
}
