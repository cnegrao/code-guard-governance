import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { updateSystemSchema } from "@/lib/validation";
import * as systemService from "@/services/systems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;

    const system = await systemService.getSystem(orgId, id);
    if (!system) {
      return NextResponse.json({ error: "System not found" }, { status: 404 });
    }

    const compliance = await systemService.getCompliance(orgId, id);
    const score = systemService.computeScore(compliance);
    const gaps = systemService.getGapLabels(compliance);

    return NextResponse.json({
      ...system,
      compliance,
      compliance_score: score,
      compliance_gaps: gaps,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;
    const body = await request.json();
    const input = updateSystemSchema.parse(body);

    const system = await systemService.updateSystem(orgId, id, input);

    return NextResponse.json({ system });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const { id } = await params;
    const body = await request.json();

    await systemService.assessCompliance(orgId, id, body);

    const compliance = await systemService.getCompliance(orgId, id);
    const score = systemService.computeScore(compliance);
    const gaps = systemService.getGapLabels(compliance);

    return NextResponse.json({ compliance, compliance_score: score, compliance_gaps: gaps });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assess compliance" },
      { status: 400 }
    );
  }
}