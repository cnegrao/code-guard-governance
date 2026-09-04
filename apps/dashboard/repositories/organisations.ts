import { db } from "@/lib/db";

export async function getOrg(orgId: string): Promise<{
  organisation_id: string;
  name: string;
  code: string;
  external_refs: Record<string, unknown>;
} | null> {
  const { data } = await db.read
    .from("organisations")
    .select("organisation_id, legal_name, org_code")
    .eq("organisation_id", orgId)
    .single();

  if (!data) return null;
  return {
    organisation_id: (data as any).organisation_id,
    name: (data as any).legal_name ?? "",
    code: (data as any).org_code ?? "",
    external_refs: {},
  };
}
