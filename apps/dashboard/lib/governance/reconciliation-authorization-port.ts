import "server-only";

import { asIsoTimestamp } from "@council/canonical-contracts";
import {
  AUTHORIZATION_RESULT,
  type ReconciliationAuthorizationPort,
  type ReconciliationAuthorizationRequest,
  type ReconciliationAuthorizationResult,
} from "@council/governance-review";

/**
 * Reconciliation & Materialization Workspace V1 — the dashboard's first
 * implementation of governance-review's ReconciliationAuthorizationPort
 * (packages/governance-review/src/reconciliation-authorization.ts). Before
 * this milestone no adapter existed at all: invokeObjectReconciliation /
 * invokeRelationshipReconciliation fail closed (AuthorizationPortRequiredError)
 * without one.
 *
 * This mirrors the exact authority ceiling apps/dashboard/lib/governance/
 * workspace-actions.ts already established for the review-state machine
 * (hasGovernanceReviewAuthority: sessionRole === "org_admin", verified
 * server-side from the trusted x-codeguard-role header) — no new RBAC model
 * is invented here, and building one is out of this milestone's scope.
 *
 * decision-commands.ts calls hasGovernanceReviewAuthority itself BEFORE ever
 * constructing this Port, so by the time authorize() runs, the actor is
 * already known to hold governance-reviewer authority — this Port exists so
 * the domain gate's own defense-in-depth checks (organisationId/action/
 * subject/actorReference exact-match, reconciliation-invocation.ts:210-240)
 * still run against a real, faithful ALLOW rather than a bypassed call.
 */
export function createSessionReconciliationAuthorizationPort(session: {
  readonly organisationId: string;
  readonly actorReference: string;
}): ReconciliationAuthorizationPort {
  return {
    authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
      // Defense in depth: even though the caller already verified session
      // authority before constructing this Port, a request scoped to a
      // different organisation or actor than the session that built this
      // Port is never granted here either.
      if (request.organisationId !== session.organisationId || request.actor.actorReference !== session.actorReference) {
        return {
          authorizationDecisionId: `authz:denied:${request.organisationId}:${Date.now()}`,
          result: AUTHORIZATION_RESULT.DENY,
          organisationId: request.organisationId,
          actorReference: request.actor.actorReference,
          subject: request.subject,
          requestedAction: request.requestedAction,
          evaluatedAt: asIsoTimestamp(new Date().toISOString()),
        };
      }

      return {
        authorizationDecisionId: `authz:${request.organisationId}:${request.subject.subjectKind === "CANDIDATE" ? request.subject.candidateId : request.subject.candidateMergeId}:${request.requestedAction}:${Date.now()}`,
        result: AUTHORIZATION_RESULT.ALLOW,
        organisationId: request.organisationId,
        actorReference: request.actor.actorReference,
        subject: request.subject,
        requestedAction: request.requestedAction,
        evaluatedAt: asIsoTimestamp(new Date().toISOString()),
        policyReference: "GOVERNANCE_REVIEWER_ROLE_V1",
      };
    },
  };
}
