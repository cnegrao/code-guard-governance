import { NextResponse } from "next/server";
import { getOrgId } from "@/lib/session";
import { updateSystemSchema } from "@/lib/validation";
import * as systemService from "@/services/systems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getOrgId();
    const { id } = await params;

    const system = await systemService.getSystem(orgId, id);
    if (!system) {
      return NextResponse.json({ error: "System not found" }, { status: 404 });
    }

    const compliance = await systemService.getCompliance(orgId, id);
    const metric = systemService.computeComplianceMetric(compliance);
    const gaps = systemService.getGapLabels(compliance);

    return NextResponse.json({
      ...system,
      compliance,
      compliance_metric: metric,
      compliance_score: metric.value,
      compliance_gaps: gaps,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch system" },
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
    const input = updateSystemSchema.parse(body);

    const system = await systemService.updateSystem(orgId, id, input);

    return NextResponse.json({ system });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update system" },
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

    await systemService.assessCompliance(orgId, id, body);

    const compliance = await systemService.getCompliance(orgId, id);
    const metric = systemService.computeComplianceMetric(compliance);
    const gaps = systemService.getGapLabels(compliance);

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
