import 'server-only';
import { asIsoTimestamp, type OrganisationId, type FieldReconciliationDecision } from '@council/canonical-contracts';
import { purviewInbound, PURVIEW_ADAPTER } from '@council/scanner';
import { intakeInboundExchange, reconcileTechnicalFact, compareTechnicalFact, evaluateFieldAuthority, stableCandidateContent } from '@council/governance-review';
import { configuredTechnicalConnection, technicalFactPersistence, createGovernedTechnicalFactPersistence, listTechnicalFactProposalIds, technicalFieldDecisionHistory, startExchangeAcquisitionRun } from './technical-fact-persistence';
import { discoveryIntakePersistence } from './discovery-intake-persistence';
import { governanceReviewPersistence } from './persistence';
import { materializationPersistence } from './materialization';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';

/** Server-only fixture/transport entry point. No HTTP or credentials in adapter.
 *
 * DORMANT (M16-S0.3.3A/D): passes `review: governanceReviewPersistence` (the
 * UNGOVERNED port, bound to the raw `gov_repo.apply_review_transition` RPC)
 * into `intakeInboundExchange`'s DETERMINISTIC_RULE proposal path. S0.3.3D
 * revoked service_role EXECUTE on that raw RPC entirely, so this path is no
 * longer callable through the current DB boundary at all. This function has
 * zero active production callers (no route imports it) and is NOT
 * ACTIVATABLE as-is. It must not be wired to a route, and `review` must not
 * be silently redirected through a HUMAN `createGoverned*` wrapper, until a
 * future, explicit, owner-controlled machine write boundary is designed and
 * approved. */
export async function importAzureSqlCatalog(json: string, organisationId: OrganisationId, connectionId: string) {
  const trusted = await configuredTechnicalConnection(organisationId,connectionId);
  return intakeInboundExchange(purviewInbound(json,trusted,asIsoTimestamp(new Date().toISOString())),trusted,PURVIEW_ADAPTER,{
    intake:{...discoveryIntakePersistence,startAcquisitionRun:startExchangeAcquisitionRun},review:governanceReviewPersistence,materialization:materializationPersistence,facts:technicalFactPersistence,
    async assertConfiguredConnection(context) {
      if (stableCandidateContent(context) !== stableCandidateContent(await configuredTechnicalConnection(context.organisationId,context.connection.connectionId))) throw new TypeError('TRUSTED_CONNECTION_MISMATCH');
    },
  });
}
export async function technicalFieldReviewQueue(org: OrganisationId) {
  return Promise.all((await listTechnicalFactProposalIds(org)).map(async id => {
    const context = await technicalFactPersistence.getReviewContext(org,id);
    return { ...context, comparison:compareTechnicalFact(context), policy:evaluateFieldAuthority(context.proposal,context.policies,context.policyHeads),decisions:await technicalFieldDecisionHistory(org,id),
      isCurrentSource:context.observations.some(o=>o.observationId===context.currentSourceObservationId&&o.snapshotId===context.currentSourceSnapshotId) };
  }));
}
export type ReviewedFieldDecision = Omit<FieldReconciliationDecision,'organisationId'|'actor'|'decidedAt'>;
// M16-S0.3.3C-R1: current-role authority is NOT decided here. The sole write
// authority is record_technical_field_decision_governed_v1's own
// transactional require_governed_write_eligibility_v1 check (GV006
// otherwise); the authorize callback below enforces ONLY deterministic
// organisation/HUMAN-actor identity binding.
export async function submitTechnicalFieldDecision(input: ReviewedFieldDecision, context: {organisationId:OrganisationId;actorReference:string;writePrincipal:GovernanceWritePrincipal}) {
  const previous = await technicalFactPersistence.getDecision(context.organisationId,input.decisionId);
  const decision: FieldReconciliationDecision = { ...input,organisationId:context.organisationId,
    actor:{authorityKind:'HUMAN',actorReference:context.actorReference},decidedAt:previous?.decision.decidedAt ?? asIsoTimestamp(new Date().toISOString()) };
  return reconcileTechnicalFact(decision,createGovernedTechnicalFactPersistence(context.writePrincipal),{authorize:d=> d.organisationId===context.organisationId &&
    d.actor.authorityKind==='HUMAN' && d.actor.actorReference===context.actorReference});
}
