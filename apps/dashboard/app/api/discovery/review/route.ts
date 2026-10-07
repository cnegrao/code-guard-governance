import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();

    const { data: agents } = await db.write
      .from("agents")
      .select("agent_id, agent_code, name, agent_type, risk_level, status, external_refs, created_at, business_domain")
      .eq("organisation_id", orgId)
      .eq("status", "pending_registration")
      .not("external_refs", "is", null)
      .order("created_at", { ascending: false }).throwOnError();

    const discovered = (agents as Array<Record<string, unknown>>) ?? [];

    const { data: approved } = await db.write
      .from("agents")
      .select("agent_id, agent_code, name, agent_type, risk_level, status, external_refs")
      .eq("organisation_id", orgId)
      .in("status", ["registered", "active"])
      .not("external_refs", "is", null)
      .order("created_at", { ascending: false })
      .limit(20).throwOnError();

    return NextResponse.json({
      authority: "OPERATIONAL_LEGACY",
      governedIngestion: "NOT_ACTIVE",
      pending: discovered,
      pendingCount: discovered.length,
      inventory: (approved as Array<Record<string, unknown>>) ?? [],
      inventoryCount: (approved as Array<Record<string, unknown>>)?.length ?? 0,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function PUT() {
  try {
    await requireVerifiedGovernancePrincipal();
    return NextResponse.json({ status: "DISABLED", authority: "OPERATIONAL_LEGACY",
      error: "Inventory discovery cannot approve, activate or validate canonical governance. Use governed human review." }, { status: 409 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json({ error: "Inventory action unavailable" }, { status: 500 });
  }
}
