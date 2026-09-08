import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";

import { getSessionContext, getOrgId } from "@/lib/session";
import { asReviewSubjectId } from "@/lib/governance/workspace-query";
import { triggerMaterialization } from "@/lib/governance/decision-commands";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = await getOrgId();
    const { role } = await getSessionContext();
    const { id } = await params;

    const outcome = await triggerMaterialization({
      organisationId: asOrganisationId(orgId),
      sessionRole: role,
      reviewSubjectId: asReviewSubjectId(id),
    });

    switch (outcome.kind) {
      case "APPLIED":
      case "REPLAYED":
        return NextResponse.json({ outcome: outcome.kind, result: outcome.result });
      case "NOT_APPLICABLE":
        return NextResponse.json({ outcome: "NOT_APPLICABLE", reason: outcome.reason }, { status: 409 });
      case "NOT_FOUND":
        return NextResponse.json({ error: "Review subject not found." }, { status: 404 });
      case "FORBIDDEN":
        return NextResponse.json({ error: outcome.message }, { status: 403 });
      case "NOT_READY":
        return NextResponse.json({ error: outcome.message, outcome: "NOT_READY" }, { status: 409 });
      case "PERSISTENCE_CONFLICT":
        return NextResponse.json({ error: outcome.message }, { status: 409 });
      default:
        return NextResponse.json({ error: "Unable to materialize this decision." }, { status: 500 });
    }
  } catch (error) {
    console.error("governance materialization trigger failed", error);
    return NextResponse.json({ error: "Unable to materialize this decision." }, { status: 500 });
  }
}
