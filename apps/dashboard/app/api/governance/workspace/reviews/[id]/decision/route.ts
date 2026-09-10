import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";

import { getOrgId, getSessionContext, getUserId } from "@/lib/session";
import { asReviewSubjectId } from "@/lib/governance/workspace-query";
import { getGovernanceDecisionDetail } from "@/lib/governance/decision-query";
import { submitReconciliationDecision, type RequestedReconciliationOutcome } from "@/lib/governance/decision-commands";

const VALID_OUTCOMES = new Set<string>(["CREATE_NEW", "MATCH_EXISTING", "REJECT", "DEFER"]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = await getOrgId();
    const { id } = await params;

    const detail = await getGovernanceDecisionDetail(asOrganisationId(orgId), asReviewSubjectId(id));
    if (!detail) {
      return NextResponse.json({ error: "Review subject not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("governance decision detail query failed", error);
    return NextResponse.json({ error: "Unable to load reconciliation decision detail." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = await getOrgId();
    const userId = await getUserId();
    const { role } = await getSessionContext();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { requestedOutcome?: unknown; matchCanonicalObjectId?: unknown; matchCanonicalRelationshipId?: unknown; reasonCode?: unknown }
      | null;

    const requestedOutcome = typeof body?.requestedOutcome === "string" ? body.requestedOutcome : undefined;
    if (!requestedOutcome || !VALID_OUTCOMES.has(requestedOutcome)) {
      return NextResponse.json({ error: "A valid requestedOutcome is required." }, { status: 400 });
    }
    const matchCanonicalObjectId =
      typeof body?.matchCanonicalObjectId === "string" ? body.matchCanonicalObjectId : undefined;
    const reasonCode = typeof body?.reasonCode === "string" ? body.reasonCode : "";

    const outcome = await submitReconciliationDecision({
      organisationId: asOrganisationId(orgId),
      actorUserId: userId,
      sessionRole: role,
      reviewSubjectId: asReviewSubjectId(id),
      requestedOutcome: requestedOutcome as RequestedReconciliationOutcome,
      matchCanonicalObjectId,
      matchCanonicalRelationshipId: typeof body?.matchCanonicalRelationshipId === "string" ? body.matchCanonicalRelationshipId : undefined,
      reasonCode,
    });

    switch (outcome.kind) {
      case "APPLIED":
      case "REPLAYED":
        return NextResponse.json({
          outcome: outcome.kind,
          reconciliationDecisionId: outcome.reconciliationDecisionId,
          requestedOutcome: outcome.outcome,
        });
      case "NOT_FOUND":
        return NextResponse.json({ error: "Review subject not found." }, { status: 404 });
      case "FORBIDDEN":
        return NextResponse.json({ error: outcome.message }, { status: 403 });
      case "NOT_READY":
        return NextResponse.json(
          { error: "This review subject is not ready for reconciliation.", outcome: "NOT_READY", reason: outcome.reason },
          { status: 409 },
        );
      case "INVALID_REQUEST":
        return NextResponse.json({ error: outcome.message }, { status: 400 });
      case "PERSISTENCE_CONFLICT":
        return NextResponse.json({ error: outcome.message }, { status: 409 });
      default:
        return NextResponse.json({ error: "Unable to process this reconciliation decision." }, { status: 500 });
    }
  } catch (error) {
    console.error("governance reconciliation decision submission failed", error);
    return NextResponse.json({ error: "Unable to process this reconciliation decision." }, { status: 500 });
  }
}
