import { assertLegacyAuthConfigured } from "@/lib/auth";
import { resolveLegacyJwtRole } from "@/lib/auth/legacy-role";
import { signLegacyToken } from "@/lib/auth/token";
import * as orgRepo from "@/repositories/organisations";
import {
  findRoleByCode,
  resolveRoleCodesByIds,
} from "@/repositories/roles";
import * as userRepo from "@/repositories/users";
import {
  executeLegacyLogin,
  LegacyLoginRoleResolutionError,
} from "@/services/legacy-login";
import {
  executeLegacySignup,
  LegacySignupRoleUnavailableError,
} from "@/services/legacy-signup";
import type { LegacyAuthResult } from "@/types/auth";

export {
  LegacyLoginRoleResolutionError,
  LegacySignupRoleUnavailableError,
};

export async function signup(input: {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
  industry: string;
}): Promise<LegacyAuthResult> {
  return executeLegacySignup(input, {
    assertAuthConfigured: assertLegacyAuthConfigured,
    findRoleByCode,
    createOrg: orgRepo.createOrg,
    createUser: userRepo.createUser,
    signToken: signLegacyToken,
  });
}

export async function login(
  email: string,
  password: string
): Promise<LegacyAuthResult> {
  return executeLegacyLogin(email, password, {
    findUserByEmail: userRepo.findUserByEmail,
    verifyPassword: userRepo.verifyPassword,
    getOrg: orgRepo.getOrg,
    resolveRoleCodesByIds,
    resolveLegacyJwtRole,
    signToken: signLegacyToken,
  });
}
