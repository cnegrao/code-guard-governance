import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { createAgentSchema } from "@/lib/validation";
import * as agentService from "@/services/agents";
import { LEGACY_RISK_LABEL } from "@/lib/legacy-risk";

export async function GET(request: Request) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { searchParams } = new URL(request.url);

    const agents = await agentService.listAgents(orgId, {
      risk_level: searchParams.get("risk") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      agent_type: searchParams.get("type") ?? undefined,
      page: Number(searchParams.get("page")) || 1,
      limit: Number(searchParams.get("limit")) || 20,
    });

    // agents[].risk_level / ai_act_risk_class and the ?risk= filter are LEGACY labels (M17-S0): never governed risk.
    return NextResponse.json({ ...agents, legacyRiskAuthority: LEGACY_RISK_LABEL,
      legacyRiskFields: ["risk_level", "ai_act_risk_class"], legacyRiskFilter: searchParams.get("risk") ?? null });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch agents" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { organisationId: orgId, userId } = await requireVerifiedGovernancePrincipal();
    const body = await request.json();
    const input = createAgentSchema.parse(body);

    const agent = await agentService.registerAgent(orgId, userId, input);

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create agent" },
      { status: 400 }
    );
  }
}