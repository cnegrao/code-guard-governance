import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";

import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { getWorkspaceSummary } from "@/lib/governance/workspace-query";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const summary = await getWorkspaceSummary(asOrganisationId(orgId));
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    console.error("governance workspace summary query failed", error);
    return NextResponse.json({ error: "Unable to load the governance workspace summary." }, { status: 500 });
  }
}
