import 'server-only';
import { asIsoTimestamp, type OrganisationId, type FieldReconciliationDecision } from '@council/canonical-contracts';
import { purviewInbound, PURVIEW_ADAPTER } from '@council/scanner';
import { intakeInboundExchange, reconcileTechnicalFact, compareTechnicalFact, evaluateFieldAuthority, stableCandidateContent } from '@council/governance-review';
import { configuredTechnicalConnection, technicalFactPersistence, listTechnicalFactProposalIds, technicalFieldDecisionHistory, startExchangeAcquisitionRun } from './technical-fact-persistence';
import { discoveryIntakePersistence } from './discovery-intake-persistence';
import { governanceReviewPersistence } from './persistence';
import { materializationPersistence } from './materialization';
import { hasGovernanceReviewAuthority } from './workspace-actions';

/** Server-only fixture/transport entry point. No HTTP or credentials in adapter. */
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
export async function submitTechnicalFieldDecision(input: ReviewedFieldDecision, context: {organisationId:OrganisationId;actorReference:string;currentRole:string}) {
  if (!hasGovernanceReviewAuthority(context.currentRole)) throw new TypeError('FIELD_AUTHORIZATION_DENIED');
  const previous = await technicalFactPersistence.getDecision(context.organisationId,input.decisionId);
  const decision: FieldReconciliationDecision = { ...input,organisationId:context.organisationId,
    actor:{authorityKind:'HUMAN',actorReference:context.actorReference},decidedAt:previous?.decision.decidedAt ?? asIsoTimestamp(new Date().toISOString()) };
  return reconcileTechnicalFact(decision,technicalFactPersistence,{authorize:d=> d.organisationId===context.organisationId &&
    d.actor.authorityKind==='HUMAN' && d.actor.actorReference===context.actorReference && hasGovernanceReviewAuthority(context.currentRole)});
}
