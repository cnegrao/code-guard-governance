import "server-only";

import { asIsoTimestamp } from "@council/canonical-contracts";
import {
  AUTHORIZATION_RESULT,
  type ReconciliationAuthorizationPort,
  type ReconciliationAuthorizationRequest,
  type ReconciliationAuthorizationResult,
} from "@council/governance-review";

import { hasGovernanceReviewAuthority } from "./workspace-actions";

/** Existing reviewer ceiling, derived from current persisted role assignments
 * at the HTTP boundary. Bind that result to the verified actor and tenant.
 * No JWT role or request metadata is an authorization input. This remains
 * pre-M16 authorization; transactional L14 eligibility belongs to S0.3. */
export function createCurrentRoleReconciliationAuthorizationPort(context: {
  readonly organisationId: string;
  readonly actorReference: string;
  readonly currentRole: string;
}): ReconciliationAuthorizationPort {
  return {
    authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
      if (!hasGovernanceReviewAuthority(context.currentRole) || request.organisationId !== context.organisationId || request.actor.actorReference !== context.actorReference) {
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
