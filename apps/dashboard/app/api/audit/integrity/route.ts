import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as auditService from "@/services/audit";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const integrity = await auditService.getIntegrity(orgId);
    return NextResponse.json(integrity);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to verify integrity" },
      { status: 500 }
    );
  }
}