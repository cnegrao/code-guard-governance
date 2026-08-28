/**
 * LEGACY bridge from already-resolved role codes to the temporary JWT role.
 *
 * This is not the definitive RBAC model. GOVERNANCE_ADMIN is used only as a
 * transitional marker for the tenant-scoped `org_admin` legacy claim; it does
 * not imply platform or global administrator authority. Future authorization
 * will use 3NF memberships and role assignments. This mapping must not be used
 * to migrate assignments automatically into that future model.
 */

const LEGACY_ADMIN_ROLE_CODE = "GOVERNANCE_ADMIN";

export type LegacyJwtRole = "org_admin" | "user";

export function resolveLegacyJwtRole(
  roleCodes: Iterable<string> | null | undefined
): LegacyJwtRole {
  if (!roleCodes) return "user";

  if (typeof roleCodes === "string") {
    return roleCodes === LEGACY_ADMIN_ROLE_CODE ? "org_admin" : "user";
  }

  for (const roleCode of roleCodes) {
    if (roleCode === LEGACY_ADMIN_ROLE_CODE) return "org_admin";
  }

  return "user";
}
