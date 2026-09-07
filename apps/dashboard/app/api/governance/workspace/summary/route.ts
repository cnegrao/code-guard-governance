import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";

import { getOrgId } from "@/lib/session";
import { getWorkspaceSummary } from "@/lib/governance/workspace-query";

export async function GET() {
  try {
    const orgId = await getOrgId();
    const summary = await getWorkspaceSummary(asOrganisationId(orgId));
    return NextResponse.json(summary);
  } catch (error) {
    console.error("governance workspace summary query failed", error);
    return NextResponse.json({ error: "Unable to load the governance workspace summary." }, { status: 500 });
  }
}
