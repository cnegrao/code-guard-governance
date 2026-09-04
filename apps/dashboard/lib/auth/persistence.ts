import "server-only";
import { createClient } from "@supabase/supabase-js";
import { compare, hash } from "bcryptjs";
import { AuthPublicError, EMAIL_EXISTS_MESSAGE, GENERIC_AUTH_ERROR_MESSAGE } from "./errors";

const BCRYPT_ROUNDS = 12;

const DUMMY_BCRYPT_HASH = "$2a$12$ABCDEFGHIJKLMNOPQRSTUVabcdefghijklmnopqrstuvwxyz12345";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL");
const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const privilegedDb = createClient(supabaseUrl, supabaseServiceRoleKey, {
  db: { schema: "gov_repo" },
  global: {
    headers: {
      "x-codeguard-client": "governance-os-auth-privileged",
    },
  },
});

function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function extractBcryptHash(externalId: string | null): string | null {
  if (!externalId?.startsWith("bcrypt:")) return null;
  return externalId.slice(7);
}

export interface UserIdentityForAuth {
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  status: string;
  role_ids: string[];
}

export async function findUserIdentityForAuth(
  email: string
): Promise<UserIdentityForAuth | null> {
  const canonicalEmail = canonicalizeEmail(email);

  const { data } = await privilegedDb
    .from("governance_users")
    .select("user_id, email, full_name, organisation_id, status, role_ids")
    .eq("email", canonicalEmail)
    .single();

  return data;
}

export async function verifyPasswordForAuth(
  userId: string,
  password: string
): Promise<boolean> {
  const { data } = await privilegedDb
    .from("governance_users")
    .select("external_id")
    .eq("user_id", userId)
    .single();

  const storedHash = extractBcryptHash(data?.external_id);
  if (!storedHash) {
    await compare(password, DUMMY_BCRYPT_HASH);
    return false;
  }

  return compare(password, storedHash);
}

export async function verifyPasswordDummyWork(password: string): Promise<void> {
  await compare(password, DUMMY_BCRYPT_HASH);
}

export function isDummyHashValid(): boolean {
  return DUMMY_BCRYPT_HASH.startsWith("$2a$12$") ||
         DUMMY_BCRYPT_HASH.startsWith("$2b$12$") ||
         DUMMY_BCRYPT_HASH.startsWith("$2y$12$");
}

export interface RoleCodeForAuth {
  role_id: string;
  role_code: string;
  is_system_role: boolean;
}

export async function resolveRoleCodesForAuth(
  roleIds: string[]
): Promise<RoleCodeForAuth[]> {
  if (!roleIds || roleIds.length === 0) {
    return [];
  }

  const { data } = await privilegedDb
    .from("governance_roles")
    .select("role_id, role_code, is_system_role")
    .in("role_id", roleIds);

  return data ?? [];
}

export interface OrganisationForAuth {
  organisation_id: string;
  name: string;
  is_active: boolean;
}

export async function getOrganisationForAuth(
  orgId: string
): Promise<OrganisationForAuth | null> {
  const { data } = await privilegedDb
    .from("organisations")
    .select("organisation_id, legal_name, is_active")
    .eq("organisation_id", orgId)
    .single();

  if (!data) return null;

  return {
    organisation_id: data.organisation_id,
    name: (data as any).legal_name || "",
    is_active: data.is_active,
  };
}

export interface SignupLegacyResult {
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  organisation_name: string;
  role_id: string;
  role_code: string;
}

export async function signupLegacyAtomic(input: {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
}): Promise<SignupLegacyResult> {
  const canonicalEmail = canonicalizeEmail(input.email);
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

  // org_code is generated entirely inside gov_repo.signup_legacy — the
  // application supplies business signup data only and has no authority
  // over the organisation's persisted identity attributes. Industry is
  // intentionally NOT sent: canonical gov_repo.organisations has no column
  // for it, so this RPC does not accept or persist an industry value. See
  // the migration's ORGANISATION INDUSTRY PROFILE comment for the rationale.
  const { data, error } = await privilegedDb.rpc("signup_legacy", {
    p_email: canonicalEmail,
    p_password_hash: `bcrypt:${passwordHash}`,
    p_full_name: input.fullName,
    p_org_name: input.orgName,
  });

  if (error) {
    if (error.code === "23505" && error.message?.includes("governance_users_email_unique")) {
      throw new AuthPublicError(EMAIL_EXISTS_MESSAGE, 409);
    }
    throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
  }

  if (!data) {
    throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
  }

  const result = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    user_id: result.user_id as string,
    email: result.email as string,
    full_name: result.full_name as string,
    organisation_id: result.organisation_id as string,
    organisation_name: result.organisation_name as string,
    role_id: result.role_id as string,
    role_code: result.role_code as string,
  };
}

export { canonicalizeEmail };
