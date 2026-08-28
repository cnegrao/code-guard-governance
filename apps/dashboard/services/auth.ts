import { signLegacyToken } from "@/lib/auth/token";
import * as orgRepo from "@/repositories/organisations";
import * as userRepo from "@/repositories/users";
import type { LegacyAuthResult } from "@/types/auth";

export async function signup(input: {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
  industry: string;
}): Promise<LegacyAuthResult> {
  const org = await orgRepo.createOrg({
    name: input.orgName,
    industry: input.industry,
  });

  const user = await userRepo.createUser({
    email: input.email,
    fullName: input.fullName,
    orgId: org.organisation_id,
    password: input.password,
  });

  const token = await signLegacyToken({
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
        industry: (org.external_refs as Record<string, string>)?.industry_profile ?? "other",
      },
    },
  };
}

export async function login(
  email: string,
  password: string
): Promise<LegacyAuthResult> {
  const user = await userRepo.findUserByEmail(email);
  if (!user) throw new Error("Invalid email or password");
  if (user.status !== "active") throw new Error("Account is not active");

  const valid = await userRepo.verifyPassword(user.user_id, password);
  if (!valid) throw new Error("Invalid email or password");

  const org = await orgRepo.getOrg(user.organisation_id);
  if (!org) throw new Error("Organisation not found");

  const token = await signLegacyToken({
    sub: user.user_id,
    org: user.organisation_id,
    email: user.email,
    role: user.role_ids?.length ? "org_admin" : "user",
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
        industry: (org.external_refs as Record<string, string>)?.industry_profile ?? "other",
      },
    },
  };
}
