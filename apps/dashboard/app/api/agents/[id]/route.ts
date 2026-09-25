import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { updateAgentSchema } from "@/lib/validation";
import * as agentService from "@/services/agents";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;

    const agent = await agentService.getAgent(orgId, id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const compliance = await agentService.getCompliance(orgId, id);
    const score = agentService.computeScore(compliance);
    const gaps = agentService.getGapLabels(compliance);

    return NextResponse.json({
      ...agent,
      compliance,
      compliance_score: score,
      compliance_gaps: gaps,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch agent" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;
    const body = await request.json();
    const input = updateAgentSchema.parse(body);

    const agent = await agentService.updateAgent(orgId, id, input);

    return NextResponse.json({ agent });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update agent" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;
    const body = await request.json();

    await agentService.assessCompliance(orgId, id, body);

    const compliance = await agentService.getCompliance(orgId, id);
    const score = agentService.computeScore(compliance);
    const gaps = agentService.getGapLabels(compliance);

    return NextResponse.json({ compliance, compliance_score: score, compliance_gaps: gaps });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assess compliance" },
      { status: 400 }
    );
  }
}