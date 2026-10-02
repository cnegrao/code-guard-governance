import { db } from "@/lib/db";

export async function getUsersByOrg(orgId: string): Promise<
  Array<{
    user_id: string;
    email: string;
    full_name: string;
    status: string;
  }>
> {
  const { data } = await db.write
    .from("governance_users")
    .select("user_id, email, full_name, status")
    .eq("organisation_id", orgId)
    .eq("status", "active").throwOnError();

  return data ?? [];
}