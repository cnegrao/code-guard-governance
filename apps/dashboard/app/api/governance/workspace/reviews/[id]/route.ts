import { NextResponse } from "next/server";
import { asOrganisationId } from "@council/canonical-contracts";
import { REVIEW_STATE, type ReviewState } from "@council/governance-review";

import { getOrgId, getSessionContext, getUserId } from "@/lib/session";
import { asReviewSubjectId, getReviewSubjectDetail } from "@/lib/governance/workspace-query";
import { deriveAllowedGovernanceActions, hasGovernanceReviewAuthority } from "@/lib/governance/workspace-actions";
import { workspaceCommands, type GovernanceActionName } from "@/lib/governance/workspace-commands";

const VALID_STATES = new Set<string>(Object.values(REVIEW_STATE));

const ACTION_HANDLERS: Record<GovernanceActionName, keyof typeof workspaceCommands> = {
  PROPOSE: "proposeReview",
  CONFIRM: "confirmReview",
  CERTIFY: "certifyReview",
  REJECT: "rejectReview",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = await getOrgId();
    const { role } = await getSessionContext();
    const { id } = await params;

    const detail = await getReviewSubjectDetail(asOrganisationId(orgId), asReviewSubjectId(id));
    if (!detail) {
      return NextResponse.json({ error: "Review subject not found." }, { status: 404 });
    }

    const allowedActions = deriveAllowedGovernanceActions(detail.state, hasGovernanceReviewAuthority(role));
    return NextResponse.json({ ...detail, allowedActions });
  } catch (error) {
    console.error("governance workspace detail query failed", error);
    return NextResponse.json({ error: "Unable to load this review subject." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const orgId = await getOrgId();
    const userId = await getUserId();
    const { role } = await getSessionContext();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; expectedState?: unknown; reasonCode?: unknown }
      | null;

    const action = typeof body?.action === "string" ? body.action : undefined;
    if (!action || !(action in ACTION_HANDLERS)) {
      return NextResponse.json({ error: "A valid action is required." }, { status: 400 });
    }

    const expectedState = typeof body?.expectedState === "string" ? body.expectedState : undefined;
    if (!expectedState || !VALID_STATES.has(expectedState)) {
      return NextResponse.json({ error: "A valid expectedState is required." }, { status: 400 });
    }

    const reasonCode = typeof body?.reasonCode === "string" ? body.reasonCode : undefined;

    const handlerName = ACTION_HANDLERS[action as GovernanceActionName];
    const outcome = await workspaceCommands[handlerName]({
      organisationId: asOrganisationId(orgId),
      actorUserId: userId,
      sessionRole: role,
      reviewSubjectId: asReviewSubjectId(id),
      expectedState: expectedState as ReviewState,
      reasonCode,
    });

    switch (outcome.kind) {
      case "APPLIED":
      case "REPLAYED":
        return NextResponse.json({ outcome: outcome.kind, state: outcome.subject.state });
      case "NOT_FOUND":
        return NextResponse.json({ error: "Review subject not found." }, { status: 404 });
      case "FORBIDDEN":
        return NextResponse.json({ error: "You are not authorized to perform this action." }, { status: 403 });
      case "STALE_REVIEW_SUBJECT":
        return NextResponse.json(
          {
            error: "This review subject changed since it was loaded.",
            outcome: "STALE_REVIEW_SUBJECT",
            currentState: outcome.currentState,
          },
          { status: 409 },
        );
      case "INVALID_TRANSITION":
        return NextResponse.json({ error: "That action is not currently available." }, { status: 409 });
      case "PERSISTENCE_CONFLICT":
        return NextResponse.json({ error: "Unable to record the governance decision. Please retry." }, { status: 409 });
      default:
        return NextResponse.json({ error: "Unable to process this action." }, { status: 500 });
    }
  } catch (error) {
    console.error("governance workspace action failed", error);
    return NextResponse.json({ error: "Unable to process this action." }, { status: 500 });
  }
}
