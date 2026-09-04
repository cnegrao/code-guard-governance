import { signToken } from "@/lib/auth";
import {
  findUserIdentityForAuth,
  verifyPasswordForAuth,
  verifyPasswordDummyWork,
  resolveRoleCodesForAuth,
  getOrganisationForAuth,
  signupLegacyAtomic,
  canonicalizeEmail,
  type UserIdentityForAuth,
} from "@/lib/auth/persistence";
import {
  resolveRoleSetFailClosed,
  LEGACY_ROLE_SOURCE,
  type ResolvedRoleSet,
} from "@/lib/auth/legacy-authorization";
import { AuthPublicError, INVALID_CREDENTIALS_MESSAGE, ACCOUNT_INACTIVE_MESSAGE } from "@/lib/auth/errors";
import type { AuthSession } from "@/types/auth";

export interface LoginResult {
  success: boolean;
  session: AuthSession | null;
  jwtRole: string;
  roleSource: string;
  resolvedRoleCodes: string[];
  userOrganisationId: string | null;
}

export interface SignupResult {
  success: boolean;
  session: AuthSession | null;
  jwtRole: string;
  roleSource: string;
}

async function buildAuthSession(
  userIdentity: UserIdentityForAuth,
  org: { organisation_id: string; name: string; is_active: boolean },
  resolvedRoles: ResolvedRoleSet,
  industryProfile: string
): Promise<AuthSession> {
  const jwtRole = resolvedRoles.jwtRole;

  const token = await signToken({
    sub: userIdentity.user_id,
    org: userIdentity.organisation_id,
    email: userIdentity.email,
    role: jwtRole,
  });

  return {
    token,
    user: {
      user_id: userIdentity.user_id,
      email: userIdentity.email,
      full_name: userIdentity.full_name,
    },
    org: {
      organisation_id: org.organisation_id,
      name: org.name,
      industry: industryProfile,
    },
  };
}

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  const normalizedEmail = canonicalizeEmail(email);

  const userIdentity = await findUserIdentityForAuth(normalizedEmail);

  if (!userIdentity) {
    await verifyPasswordDummyWork(password);
    throw new AuthPublicError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const passwordValid = await verifyPasswordForAuth(userIdentity.user_id, password);

  if (!passwordValid) {
    throw new AuthPublicError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  if (userIdentity.status !== "active") {
    throw new AuthPublicError(ACCOUNT_INACTIVE_MESSAGE, 401);
  }

  const org = await getOrganisationForAuth(userIdentity.organisation_id);

  if (!org) {
    throw new AuthPublicError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  if (!org.is_active) {
    throw new AuthPublicError(ACCOUNT_INACTIVE_MESSAGE, 401);
  }

  const roleCodes = await resolveRoleCodesForAuth(userIdentity.role_ids);

  const resolvedRoles = resolveRoleSetFailClosed({
    roleIdsFromUser: userIdentity.role_ids,
    resolvedRoles: roleCodes.map((r) => ({
      role_id: r.role_id,
      role_code: r.role_code,
      is_system_role: r.is_system_role,
    })),
  });

  const session = await buildAuthSession(
    userIdentity,
    org,
    resolvedRoles,
    "other"
  );

  return {
    success: true,
    session,
    jwtRole: resolvedRoles.jwtRole,
    roleSource: LEGACY_ROLE_SOURCE,
    resolvedRoleCodes: resolvedRoles.roleCodes,
    userOrganisationId: userIdentity.organisation_id,
  };
}

export async function signup(input: {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
  industry: string;
}): Promise<SignupResult> {
  // industry is deliberately NOT passed to signupLegacyAtomic: canonical
  // gov_repo.organisations has no column for it, so the Auth persistence
  // RPC does not pretend to persist it. It is used below only to build the
  // immediate application-level signup session.
  const result = await signupLegacyAtomic({
    email: input.email,
    password: input.password,
    fullName: input.fullName,
    orgName: input.orgName,
  });

  // Defense-in-depth: re-verify admin elevation via the same privileged
  // persistence lookup used by login, rather than trusting the RPC's
  // role_code string directly. Fails closed to a non-admin role otherwise.
  const roleCodes = await resolveRoleCodesForAuth([result.role_id]);
  const resolvedRoles = resolveRoleSetFailClosed({
    roleIdsFromUser: [result.role_id],
    resolvedRoles: roleCodes.map((r) => ({
      role_id: r.role_id,
      role_code: r.role_code,
      is_system_role: r.is_system_role,
    })),
  });

  const token = await signToken({
    sub: result.user_id,
    org: result.organisation_id,
    email: result.email,
    role: resolvedRoles.jwtRole,
  });

  return {
    success: true,
    session: {
      token,
      user: {
        user_id: result.user_id,
        email: result.email,
        full_name: result.full_name,
      },
      org: {
        organisation_id: result.organisation_id,
        name: result.organisation_name,
        industry: input.industry,
      },
    },
    jwtRole: resolvedRoles.jwtRole,
    roleSource: LEGACY_ROLE_SOURCE,
  };
}

export { INVALID_CREDENTIALS_MESSAGE, ACCOUNT_INACTIVE_MESSAGE };
