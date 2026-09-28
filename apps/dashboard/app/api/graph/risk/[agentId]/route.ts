import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as graphService from "@/services/graph";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { agentId } = await params;

    const paths = await graphService.getRiskPropagation(orgId, agentId);

    return NextResponse.json({ agent_id: agentId, paths });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load risk propagation" },
      { status: 500 }
    );
  }
}