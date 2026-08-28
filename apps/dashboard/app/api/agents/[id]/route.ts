import { NextResponse } from "next/server";
import { getOrgId } from "@/lib/session";
import { updateAgentSchema } from "@/lib/validation";
import * as agentService from "@/services/agents";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getOrgId();
    const { id } = await params;

    const agent = await agentService.getAgent(orgId, id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const compliance = await agentService.getCompliance(orgId, id);
    const metric = agentService.computeComplianceMetric(compliance);
    const gaps = agentService.getGapLabels(compliance);

    return NextResponse.json({
      ...agent,
      compliance,
      compliance_metric: metric,
      compliance_score: metric.value,
      compliance_gaps: gaps,
    });
  } catch (error) {
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
    const orgId = await getOrgId();
    const { id } = await params;
    const body = await request.json();
    const input = updateAgentSchema.parse(body);

    const agent = await agentService.updateAgent(orgId, id, input);

    return NextResponse.json({ agent });
  } catch (error) {
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
    const orgId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    await agentService.assessCompliance(orgId, id, body);

    const compliance = await agentService.getCompliance(orgId, id);
    const metric = agentService.computeComplianceMetric(compliance);
    const gaps = agentService.getGapLabels(compliance);

    return NextResponse.json({
      compliance,
      compliance_metric: metric,
      compliance_score: metric.value,
      compliance_gaps: gaps,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assess compliance" },
      { status: 400 }
    );
  }
}
