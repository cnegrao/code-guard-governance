import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as dashboardService from "@/services/dashboard";
import * as orgRepo from "@/repositories/organisations";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    if (!orgId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const org = await orgRepo.getOrg(orgId);
    const industry = (org?.external_refs as Record<string, string>)?.industry_profile ?? "other";

    const summary = await dashboardService.getSummary(orgId, industry);

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}