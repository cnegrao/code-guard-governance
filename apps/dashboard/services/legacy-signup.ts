import { z } from "zod";
import type { LegacyAuthResult } from "@/types/auth";

const GOVERNANCE_ADMIN_ROLE_CODE = "GOVERNANCE_ADMIN";
const roleIdSchema = z.string().uuid();

export interface LegacySignupInput {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
  industry: string;
}

export interface LegacySignupDependencies {
  assertAuthConfigured(): void;
  findRoleByCode: typeof import("@/repositories/roles").findRoleByCode;
  createOrg: typeof import("@/repositories/organisations").createOrg;
  createUser: typeof import("@/repositories/users").createUser;
  signToken: typeof import("@/lib/auth/token").signLegacyToken;
}

export class LegacySignupRoleUnavailableError extends Error {
  constructor() {
    super("Legacy signup role is unavailable");
    this.name = "LegacySignupRoleUnavailableError";
  }
}

export async function executeLegacySignup(
  input: LegacySignupInput,
  dependencies: LegacySignupDependencies
): Promise<LegacyAuthResult> {
  dependencies.assertAuthConfigured();

  const adminRole = await findRequiredSignupAdminRole(dependencies);

  const org = await dependencies.createOrg({
    name: input.orgName,
    industry: input.industry,
  });

  const user = await dependencies.createUser({
    email: input.email,
    fullName: input.fullName,
    orgId: org.organisation_id,
    password: input.password,
    roleIds: [adminRole.roleId],
  });

  if (!user.role_ids.includes(adminRole.roleId)) {
    throw new LegacySignupRoleUnavailableError();
  }

  const token = await dependencies.signToken({
    sub: user.user_id,
    org: org.organisation_id,
    email: user.email,
    role: "org_admin",
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

async function findRequiredSignupAdminRole(
  dependencies: LegacySignupDependencies
) {
  try {
    const role = await dependencies.findRoleByCode(GOVERNANCE_ADMIN_ROLE_CODE);
    if (
      !role ||
      role.roleCode !== GOVERNANCE_ADMIN_ROLE_CODE ||
      !roleIdSchema.safeParse(role.roleId).success
    ) {
      throw new LegacySignupRoleUnavailableError();
    }
    return role;
  } catch {
    throw new LegacySignupRoleUnavailableError();
  }
}
