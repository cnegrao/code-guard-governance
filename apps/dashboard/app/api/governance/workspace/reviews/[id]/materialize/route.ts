import { resolveCurrentGovernanceRole } from "@/lib/auth/current-authorization";
import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";

import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { asReviewSubjectId } from "@/lib/governance/workspace-query";
import { triggerMaterialization } from "@/lib/governance/decision-commands";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    const { organisationId: orgId } = principal;
    const role = await resolveCurrentGovernanceRole(principal);
    if (role !== "org_admin") return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    const { id } = await params;

    const outcome = await triggerMaterialization({
      organisationId: asOrganisationId(orgId),
      currentRole: role,
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
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    console.error("governance materialization trigger failed", error);
    return NextResponse.json({ error: "Unable to materialize this decision." }, { status: 500 });
  }
}
