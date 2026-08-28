export interface ResolvedGovernanceRole {
  roleId: string;
  roleCode: string;
}

export class RolesRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolesRepositoryError";
  }
}

interface RolesQueryResult {
  data: unknown;
  error: unknown | null;
}

interface RolesQueryPort {
  findByCode(roleCode: string): Promise<RolesQueryResult>;
  findByIds(roleIds: readonly string[]): Promise<RolesQueryResult>;
}

/**
 * Transitional bridge for the legacy governance_users.role_ids uuid[] field.
 *
 * The array is not a 3NF role-assignment model. It will be replaced by the
 * membership -> role_assignment -> governance_role relationship. This
 * repository only resolves existing UUID references while that migration is
 * pending; it does not make authorization decisions.
 */

const databaseRoleQueries: RolesQueryPort = {
  async findByCode(roleCode) {
    const { db } = await import("@/lib/db");
    return db.read
      .from("governance_roles")
      .select("role_id, role_code")
      .eq("role_code", roleCode)
      .limit(2);
  },

  async findByIds(roleIds) {
    const { db } = await import("@/lib/db");
    return db.read
      .from("governance_roles")
      .select("role_id, role_code")
      .in("role_id", [...roleIds]);
  },
};

export async function findRoleByCode(
  roleCode: string,
  queries: RolesQueryPort = databaseRoleQueries
): Promise<ResolvedGovernanceRole | null> {
  const result = await queries.findByCode(roleCode);
  const roles = readRoles(result, "find governance role by code");

  if (roles.length === 0) return null;
  if (roles.length !== 1) {
    throw new RolesRepositoryError("Governance role code is ambiguous");
  }

  return roles[0];
}

export async function resolveRoleCodesByIds(
  roleIds: Iterable<string> | null | undefined,
  queries: RolesQueryPort = databaseRoleQueries
): Promise<string[]> {
  const uniqueRoleIds = uniqueValues(roleIds);
  if (uniqueRoleIds.length === 0) return [];

  const result = await queries.findByIds(uniqueRoleIds);
  const roles = readRoles(result, "resolve governance role codes");

  return [...new Set(roles.map((role) => role.roleCode))].sort();
}

function uniqueValues(
  values: Iterable<string> | null | undefined
): string[] {
  if (!values) return [];
  if (typeof values === "string") return [values];
  return [...new Set(values)];
}

function readRoles(
  result: RolesQueryResult,
  operation: string
): ResolvedGovernanceRole[] {
  if (result.error) {
    throw new RolesRepositoryError(`Failed to ${operation}`);
  }
  if (!Array.isArray(result.data)) {
    throw new RolesRepositoryError(`Invalid result while attempting to ${operation}`);
  }

  return result.data.map(readRole);
}

function readRole(value: unknown): ResolvedGovernanceRole {
  if (!value || typeof value !== "object") {
    throw new RolesRepositoryError("Invalid governance role result");
  }

  const row = value as Record<string, unknown>;
  if (typeof row.role_id !== "string" || typeof row.role_code !== "string") {
    throw new RolesRepositoryError("Invalid governance role result");
  }

  return {
    roleId: row.role_id,
    roleCode: row.role_code,
  };
}
