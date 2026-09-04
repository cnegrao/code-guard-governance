import "server-only";

export const LEGACY_ROLE_SOURCE = "LEGACY";

export interface LegacyRole {
  code: string;
  source: typeof LEGACY_ROLE_SOURCE;
  jwtRole: string;
  permissions: string[];
}

export interface PermissionCheck {
  domain: string;
  resource: string;
  action: string;
}

const SYSTEM_ADMIN_ROLE_CODE = "GOVERNANCE_ADMIN";
const JWT_ROLE_ORG_ADMIN = "org_admin";
const JWT_ROLE_USER = "user";

const WILDCARD_TOKEN = "*";
const PERMISSION_PATTERN = /^([^.]+)\.([^.]+)\.([^.]+)$/;

function parsePermission(permission: string): PermissionCheck | null {
  const match = permission.match(PERMISSION_PATTERN);
  if (!match) return null;
  return {
    domain: match[1],
    resource: match[2],
    action: match[3],
  };
}

function permissionMatches(required: PermissionCheck, granted: string): boolean {
  const parsed = parsePermission(granted);
  if (!parsed) return false;

  if (parsed.domain !== WILDCARD_TOKEN && parsed.domain !== required.domain) {
    return false;
  }
  if (parsed.resource !== WILDCARD_TOKEN && parsed.resource !== required.resource) {
    return false;
  }
  if (parsed.action !== WILDCARD_TOKEN && parsed.action !== required.action) {
    return false;
  }

  return true;
}

export interface LegacyRoleRecord {
  role_code: string;
  is_system_role: boolean;
}

/**
 * Admin elevation requires persisted evidence of BOTH the exact role_code
 * AND is_system_role === true. A client/caller-provided boolean is never
 * sufficient on its own — is_system_role must originate from a privileged
 * persistence lookup (see resolveRoleCodesForAuth). Anything else fails closed.
 */
export function resolveLegacyJwtRole(roles: LegacyRoleRecord[]): string {
  if (!roles || roles.length === 0) {
    return JWT_ROLE_USER;
  }

  const hasVerifiedSystemAdmin = roles.some(
    (role) => role.role_code === SYSTEM_ADMIN_ROLE_CODE && role.is_system_role === true
  );
  if (hasVerifiedSystemAdmin) {
    return JWT_ROLE_ORG_ADMIN;
  }

  return JWT_ROLE_USER;
}

export interface ResolvedRoleSet {
  roleCodes: string[];
  permissions: string[];
  jwtRole: string;
  source: typeof LEGACY_ROLE_SOURCE;
}

export interface RoleResolverInput {
  roleIdsFromUser: string[];
  resolvedRoles: Array<{
    role_id: string;
    role_code: string;
    is_system_role: boolean;
    permissions?: string[] | null;
  }>;
}

export function resolveRoleSetFailClosed(input: RoleResolverInput): ResolvedRoleSet {
  const { roleIdsFromUser, resolvedRoles } = input;

  if (!roleIdsFromUser || roleIdsFromUser.length === 0) {
    return {
      roleCodes: [],
      permissions: [],
      jwtRole: JWT_ROLE_USER,
      source: LEGACY_ROLE_SOURCE,
    };
  }

  const requestedIdSet = new Set(roleIdsFromUser);
  const resolvedIdSet = new Set(resolvedRoles.map(r => r.role_id));

  for (const id of requestedIdSet) {
    if (!resolvedIdSet.has(id)) {
      return {
        roleCodes: [],
        permissions: [],
        jwtRole: JWT_ROLE_USER,
        source: LEGACY_ROLE_SOURCE,
      };
    }
  }

  const roleCodes: string[] = [];
  const matchedRoles: LegacyRoleRecord[] = [];
  const allPermissions: string[] = [];

  for (const role of resolvedRoles) {
    if (requestedIdSet.has(role.role_id)) {
      roleCodes.push(role.role_code);
      matchedRoles.push({ role_code: role.role_code, is_system_role: role.is_system_role });
      if (role.permissions && Array.isArray(role.permissions)) {
        allPermissions.push(...role.permissions);
      }
    }
  }

  return {
    roleCodes,
    permissions: [...new Set(allPermissions)],
    jwtRole: resolveLegacyJwtRole(matchedRoles),
    source: LEGACY_ROLE_SOURCE,
  };
}

export class LegacyRoleAuthorizationAdapter {
  readonly source = LEGACY_ROLE_SOURCE;
  private readonly permissions: readonly string[];
  private readonly roleCodes: readonly string[];
  private readonly jwtRole: string;

  constructor(resolved: ResolvedRoleSet) {
    this.permissions = Object.freeze([...resolved.permissions]);
    this.roleCodes = Object.freeze([...resolved.roleCodes]);
    this.jwtRole = resolved.jwtRole;
  }

  getJwtRole(): string {
    return this.jwtRole;
  }

  getRoleCodes(): readonly string[] {
    return this.roleCodes;
  }

  hasPermission(domain: string, resource: string, action: string): boolean {
    const required: PermissionCheck = { domain, resource, action };

    for (const perm of this.permissions) {
      if (permissionMatches(required, perm)) {
        return true;
      }
    }

    return false;
  }

  isSystemAdmin(): boolean {
    // jwtRole can only be JWT_ROLE_ORG_ADMIN via a verified role_code +
    // is_system_role === true check in resolveLegacyJwtRole — checking
    // roleCodes alone would trust an unverified code match.
    return this.jwtRole === JWT_ROLE_ORG_ADMIN;
  }

  hasAnyElevatedRole(): boolean {
    return this.jwtRole === JWT_ROLE_ORG_ADMIN;
  }
}

export function createLegacyAuthAdapter(
  roleIdsFromUser: string[],
  resolvedRoles: Array<{
    role_id: string;
    role_code: string;
    is_system_role: boolean;
    permissions?: string[] | null;
  }>
): LegacyRoleAuthorizationAdapter {
  const resolved = resolveRoleSetFailClosed({
    roleIdsFromUser,
    resolvedRoles,
  });
  return new LegacyRoleAuthorizationAdapter(resolved);
}

export { SYSTEM_ADMIN_ROLE_CODE, JWT_ROLE_ORG_ADMIN, JWT_ROLE_USER };
