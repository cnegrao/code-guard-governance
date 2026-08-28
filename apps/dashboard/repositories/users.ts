import { db } from "@/lib/db";
import { hash, compare } from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function createUser(input: {
  email: string;
  fullName: string;
  orgId: string;
  password: string;
  roleIds: readonly string[];
}): Promise<{
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  status: string;
  role_ids: string[];
}> {
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

  const { data, error } = await db.write
    .from("governance_users")
    .insert({
      email: input.email,
      full_name: input.fullName,
      organisation_id: input.orgId,
      status: "active",
      role_ids: [...input.roleIds],
      external_id: `bcrypt:${passwordHash}`,
    })
    .select("user_id, email, full_name, organisation_id, status, role_ids")
    .single();

  if (error) {
    if (error.message?.includes("duplicate") || error.code === "23505") {
      throw new Error("A user with this email already exists");
    }
    throw new Error(`Failed to create user: ${error.message}`);
  }
  return data;
}

export async function findUserByEmail(email: string): Promise<{
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  status: string;
  role_ids: string[];
  external_id: string | null;
} | null> {
  const { data } = await db.read
    .from("governance_users")
    .select("user_id, email, full_name, organisation_id, status, role_ids, external_id")
    .eq("email", email)
    .single();

  return data;
}

export async function verifyPassword(
  userId: string,
  password: string
): Promise<boolean> {
  const { data } = await db.read
    .from("governance_users")
    .select("external_id")
    .eq("user_id", userId)
    .single();

  const stored = data?.external_id;
  if (!stored?.startsWith("bcrypt:")) return false;

  const hashValue = stored.slice(7);
  return compare(password, hashValue);
}

export async function getUsersByOrg(orgId: string): Promise<
  Array<{
    user_id: string;
    email: string;
    full_name: string;
    status: string;
  }>
> {
  const { data } = await db.read
    .from("governance_users")
    .select("user_id, email, full_name, status")
    .eq("organisation_id", orgId)
    .eq("status", "active");

  return data ?? [];
}
