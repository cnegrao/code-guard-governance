import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session";
import * as dashboardService from "@/services/dashboard";
import * as orgRepo from "@/repositories/organisations";

export async function GET() {
  try {
    const { organisationId } = await getSessionContext();

    const org = await orgRepo.getOrg(organisationId);
    const industry = (org?.external_refs as Record<string, string>)?.industry_profile ?? "other";

    const summary = await dashboardService.getSummary(organisationId, industry);

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
