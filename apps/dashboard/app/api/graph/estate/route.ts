import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as graphService from "@/services/graph";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const data = await graphService.getEstate(orgId);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load estate" },
      { status: 500 }
    );
  }
}