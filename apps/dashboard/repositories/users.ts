import { db } from "@/lib/db";

export async function findUserByEmail(email: string): Promise<{
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  status: string;
  role_ids: string[];
} | null> {
  const { data } = await db.read
    .from("governance_users")
    .select("user_id, email, full_name, organisation_id, status, role_ids")
    .eq("email", email)
    .single();

  return data;
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