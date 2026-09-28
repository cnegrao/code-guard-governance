import "server-only";

import { asIsoTimestamp } from "@council/canonical-contracts";
import {
  AUTHORIZATION_RESULT,
  type ReconciliationAuthorizationPort,
  type ReconciliationAuthorizationRequest,
  type ReconciliationAuthorizationResult,
} from "@council/governance-review";

/**
 * M16-S0.3.3C-R1: verified-principal-bound authorization bridge for the
 * closed reconciliation domain gate (invokeObjectReconciliation /
 * invokeRelationshipReconciliation). This ALLOW/DENY decision is NOT the
 * authoritative write authority — it exists only because the frozen
 * governance-review domain contract requires an AuthorizationDecision (ALLOW
 * or DENY) as part of every reconciliation invocation's own audit trail. It
 * binds ONLY to the already-verified session identity (organisation, HUMAN
 * actor reference) already carried by the request the domain package itself
 * built; it never reads current persisted role, JWT role, or email. No
 * policyReference is set: this ALLOW is not backed by any current-role
 * policy, and inventing one would misrepresent an L14/legacy-policy
 * authority that does not exist here.
 *
 * The durable, authoritative decision is
 * record_authorized_reconciliation_governed_v1's own transactional
 * require_governed_write_eligibility_v1 check (GV006 if the actor is not a
 * current persisted GOVERNANCE_ADMIN) — if that fails, nothing commits,
 * regardless of what this bridge returned.
 */
export function createVerifiedPrincipalReconciliationAuthorizationPort(context: {
  readonly organisationId: string;
  readonly actorReference: string;
}): ReconciliationAuthorizationPort {
  return {
    authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
      if (
        request.organisationId !== context.organisationId ||
        request.actor.authorityKind !== "HUMAN" ||
        request.actor.actorReference !== context.actorReference
      ) {
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
      };
    },
  };
}
