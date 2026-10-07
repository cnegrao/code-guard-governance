import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    return NextResponse.json({ status: "NOT_ASSESSED", organisationId: orgId,
      error: "Regulatory report export is unavailable: legacy heuristics do not establish governed compliance certification." }, { status: 409 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json({ error: "Report unavailable" }, { status: 500 });
  }
}
