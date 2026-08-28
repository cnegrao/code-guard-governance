import type { LegacyJwtRole } from "@/lib/auth/legacy-role";
import type { LegacyAuthResult } from "@/types/auth";

export interface LegacyLoginDependencies {
  findUserByEmail: typeof import("@/repositories/users").findUserByEmail;
  verifyPassword: typeof import("@/repositories/users").verifyPassword;
  getOrg: typeof import("@/repositories/organisations").getOrg;
  resolveRoleCodesByIds: typeof import("@/repositories/roles").resolveRoleCodesByIds;
  resolveLegacyJwtRole: typeof import("@/lib/auth/legacy-role").resolveLegacyJwtRole;
  signToken: typeof import("@/lib/auth/token").signLegacyToken;
}

export class LegacyLoginRoleResolutionError extends Error {
  constructor() {
    super("Legacy login role resolution is unavailable");
    this.name = "LegacyLoginRoleResolutionError";
  }
}

export async function executeLegacyLogin(
  email: string,
  password: string,
  dependencies: LegacyLoginDependencies
): Promise<LegacyAuthResult> {
  const user = await dependencies.findUserByEmail(email);
  if (!user) throw new Error("Invalid email or password");
  if (user.status !== "active") throw new Error("Account is not active");

  const valid = await dependencies.verifyPassword(user.user_id, password);
  if (!valid) throw new Error("Invalid email or password");

  const org = await dependencies.getOrg(user.organisation_id);
  if (!org) throw new Error("Organisation not found");

  const role = await resolveLoginRole(user.role_ids, dependencies);

  const token = await dependencies.signToken({
    sub: user.user_id,
    org: user.organisation_id,
    email: user.email,
    role,
  });

  return {
    token,
    session: {
      user: {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
      },
      org: {
        organisation_id: org.organisation_id,
        name: org.name,
        industry:
          (org.external_refs as Record<string, string>)?.industry_profile ??
          "other",
      },
    },
  };
}

async function resolveLoginRole(
  roleIds: Iterable<string> | null | undefined,
  dependencies: LegacyLoginDependencies
): Promise<LegacyJwtRole> {
  try {
    const roleCodes = await dependencies.resolveRoleCodesByIds(roleIds);
    return dependencies.resolveLegacyJwtRole(roleCodes);
  } catch {
    throw new LegacyLoginRoleResolutionError();
  }
}
