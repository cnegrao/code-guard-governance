import { createHash } from 'node:crypto';
import { validateTechnicalFact, isTechnicalField, sourceObjectIdentityKey, type TechnicalFactProposal, type TechnicalFactObservation, type TechnicalFactTransport, type FieldAuthorityPolicy, type FieldAuthorityPolicyHead, type FieldReconciliationDecision, type GovernedTechnicalFieldState, type CanonicalObjectIdentity, type DataObjectKind, type OrganisationId, type TrustedInboundConnection, type NormalizedObjectCandidate } from '@council/canonical-contracts';
import { normalizedObjectIdentity, stableCandidateContent } from './canonical-endpoint-resolution.ts';

export function factDigest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function bindTechnicalFact(context: TrustedInboundConnection, transport: TechnicalFactTransport,
  candidate: NormalizedObjectCandidate, parent?: NormalizedObjectCandidate,
  trustState: 'IMPORTED' | 'DECLARED' = 'IMPORTED'): TechnicalFactProposal {
  validateTechnicalFact(transport.fact);
  if (!['IMPORTED','DECLARED'].includes(trustState) || transport.candidateId !== candidate.candidateId || transport.fact.objectKind !== candidate.candidateKind ||
      candidate.sourceObject.connectionId !== context.connection.connectionId ||
      context.connection.sourceSystemId !== context.sourceSystem.sourceSystemId || !context.organisationId ||
      !transport.support.assertionIds.length || !transport.support.evidenceIds.length ||
      transport.support.assertionIds.some(id => !candidate.assertionIds.includes(id)) ||
      transport.support.evidenceIds.some(id => !candidate.evidenceIds.includes(id))) throw new TypeError('FACT_BINDING_MISMATCH');
  const identity = normalizedObjectIdentity(candidate, parent);
  return Object.freeze({ ...transport, proposalId: `fact:${factDigest([context.organisationId,
    context.sourceSystem.sourceSystemId, sourceObjectIdentityKey(candidate.sourceObject), identity,
    transport.fact.objectKind, transport.fact.field, transport.fact.value, trustState])}`,
    organisationId: context.organisationId, sourceSystem: context.sourceSystem,
    sourceObject: candidate.sourceObject, normalizedObjectIdentity: identity, trustState });
}
export function factObservation(proposal: TechnicalFactProposal, observedAt: TechnicalFactObservation['observedAt']): TechnicalFactObservation {
  const support = { assertionIds: [...new Set(proposal.support.assertionIds)].sort(), evidenceIds: [...new Set(proposal.support.evidenceIds)].sort() };
  return { observationId: `fact-observation:${factDigest([proposal.proposalId, proposal.candidateId, support])}`,
    organisationId: proposal.organisationId, proposalId: proposal.proposalId, candidateId: proposal.candidateId, support, observedAt };
}
export function evaluateFieldAuthority(proposal: TechnicalFactProposal, policies: readonly FieldAuthorityPolicy[], heads: readonly FieldAuthorityPolicyHead[]): FieldAuthorityPolicy | undefined {
  const localHeads = heads.filter(h => h.organisationId === proposal.organisationId);
  if (new Set(localHeads.map(h => h.policyId)).size !== localHeads.length) throw new TypeError('FIELD_POLICY_HEAD_AMBIGUOUS');
  const currentPolicies = localHeads.map(h => {
    const versions = policies.filter(p => p.organisationId === h.organisationId && p.policyId === h.policyId && p.version === h.version);
    if (!h.policyId || !h.version || versions.length !== 1) throw new TypeError('FIELD_POLICY_HEAD_INVALID');
    return versions[0];
  });
  const matches = currentPolicies.filter(p => p.objectKind === proposal.fact.objectKind &&
    p.field === proposal.fact.field && p.sourceSystemId === proposal.sourceSystem.sourceSystemId &&
    p.providerCode === proposal.sourceSystem.provider.providerCode && (!p.connectionId || p.connectionId === proposal.sourceObject.connectionId));
  if (matches.length > 1) throw new TypeError('FIELD_POLICY_AMBIGUOUS');
  const policy = matches[0];
  if (policy && (!policy.policyId || !policy.version || !isTechnicalField(policy.objectKind, policy.field) ||
      !['AUTHORITATIVE','CONTRIBUTING','NON_AUTHORITATIVE'].includes(policy.disposition) ||
      (policy.deterministicRule && (!policy.deterministicRule.code || !policy.deterministicRule.version)))) throw new TypeError('INVALID_FIELD_POLICY');
  return policy;
}
export interface FieldReviewContext {
  readonly proposal: TechnicalFactProposal;
  readonly observations: readonly TechnicalFactObservation[];
  readonly canonicalObjects: readonly CanonicalObjectIdentity<DataObjectKind>[];
  readonly policies: readonly FieldAuthorityPolicy[];
  readonly policyHeads: readonly FieldAuthorityPolicyHead[];
  readonly current?: GovernedTechnicalFieldState;
  readonly currentSourceObservationId: string;
  readonly currentSourceSnapshotId: string;
}
export class StaleFieldDecisionError extends Error {
  readonly code = 'FIELD_STALE_SOURCE';
  constructor() { super('FIELD_STALE_SOURCE'); }
}
export class StaleFieldPolicyError extends Error {
  readonly code = 'FIELD_STALE_POLICY';
  constructor() { super('FIELD_STALE_POLICY'); }
}
export function resolveFactObject(context: FieldReviewContext): CanonicalObjectIdentity<DataObjectKind> | undefined {
  if (context.canonicalObjects.length > 1) throw new TypeError('FACT_MAPPING_AMBIGUOUS');
  const object = context.canonicalObjects[0];
  if (object && (object.organisationId !== context.proposal.organisationId || object.kind !== context.proposal.fact.objectKind || !object.objectId)) throw new TypeError('FACT_MAPPING_CONTEXT_MISMATCH');
  if (context.current && (!object || context.current.organisationId !== object.organisationId ||
    context.current.canonicalObject.objectId !== object.objectId || context.current.fact.objectKind !== object.kind ||
    context.current.fact.field !== context.proposal.fact.field)) throw new TypeError('FIELD_STATE_CONTEXT_MISMATCH');
  return object;
}
export function compareTechnicalFact(context: FieldReviewContext) {
  const object = resolveFactObject(context);
  const { proposal, current } = context;
  validateTechnicalFact(proposal.fact);
  if (!object) return { status: 'UNMAPPED' as const };
  if (!current) return { status: 'SOURCE_ONLY' as const };
  validateTechnicalFact(current.fact);
  if (proposal.fact.value === current.fact.value) return { status: 'AGREEMENT' as const };
  return { status: 'CONFLICT' as const, conflictId: `field-conflict:${factDigest([proposal.organisationId,
    object.objectId, proposal.fact.objectKind, proposal.fact.field, [current.fact.value, proposal.fact.value].sort()])}` };
}
export interface FieldDecisionAuthorizationPort {
  authorize(decision: FieldReconciliationDecision): Promise<boolean> | boolean;
}
export interface TechnicalFactPersistencePort {
  recordProposal(proposal: TechnicalFactProposal, observation: TechnicalFactObservation): Promise<void>;
  getReviewContext(organisationId: OrganisationId, proposalId: string): Promise<FieldReviewContext>;
  getDecision(organisationId: OrganisationId, decisionId: string): Promise<{ readonly decision: FieldReconciliationDecision; readonly stateId?: string } | undefined>;
  /** Transaction repeats mapping/policy/support/current-state checks and appends decision/state atomically. */
  recordDecision(decision: FieldReconciliationDecision): Promise<{ readonly replay: boolean; readonly stateId?: string }>;
}
export async function reconcileTechnicalFact(decision: FieldReconciliationDecision, port: TechnicalFactPersistencePort,
  authorization: FieldDecisionAuthorizationPort): Promise<{ readonly replay: boolean; readonly stateId?: string }> {
  if (!authorization || !await authorization.authorize(decision)) throw new TypeError('FIELD_AUTHORIZATION_DENIED');
  const previous = await port.getDecision(decision.organisationId, decision.decisionId);
  if (previous) {
    if (stableCandidateContent(previous.decision) !== stableCandidateContent(decision)) throw new TypeError('FIELD_DECISION_REPLAY_CONFLICT');
    return { replay: true, ...(previous.stateId ? { stateId: previous.stateId } : {}) };
  }
  const ctx = await port.getReviewContext(decision.organisationId, decision.proposalId);
  if (!decision.expectedSourceObservationId || decision.expectedSourceObservationId !== ctx.currentSourceObservationId ||
      !decision.expectedSourceSnapshotId || decision.expectedSourceSnapshotId !== ctx.currentSourceSnapshotId ||
      !decision.observationIds.includes(decision.expectedSourceObservationId) ||
      !ctx.observations.some(o=>o.observationId===decision.expectedSourceObservationId && o.snapshotId===decision.expectedSourceSnapshotId)) throw new StaleFieldDecisionError();
  if (decision.expectedCurrentStateId !== ctx.current?.stateId) throw new TypeError('FIELD_STALE_STATE');
  const object = resolveFactObject(ctx);
  const policy = evaluateFieldAuthority(ctx.proposal, ctx.policies, ctx.policyHeads);
  if (decision.policyId !== policy?.policyId || decision.policyVersion !== policy?.version) throw new StaleFieldPolicyError();
  if (!object || ctx.proposal.organisationId !== decision.organisationId || ctx.proposal.proposalId !== decision.proposalId ||
    decision.canonicalObject.organisationId !== decision.organisationId || object.objectId !== decision.canonicalObject.objectId ||
    object.kind !== decision.canonicalObject.kind || decision.field !== ctx.proposal.fact.field ||
    !['ACCEPT_PROPOSED','KEEP_CURRENT','DEFER','REJECT_PROPOSED'].includes(decision.outcome) ||
    !decision.decisionId || !Number.isFinite(Date.parse(decision.decidedAt)) ||
    !decision.observationIds.length || new Set(decision.observationIds).size !== decision.observationIds.length ||
    decision.observationIds.some(id => !ctx.observations.some(o => o.observationId === id && o.proposalId === decision.proposalId &&
      o.organisationId === decision.organisationId && o.support.assertionIds.length && o.support.evidenceIds.length))) throw new TypeError('FIELD_DECISION_CONTEXT_MISMATCH');
  // Replay is checked by the transaction before the expected-current guard; it never reapplies a decision.
  if (decision.outcome === 'ACCEPT_PROPOSED' && (!policy || policy.disposition === 'NON_AUTHORITATIVE')) throw new TypeError('FIELD_NOT_AUTHORITATIVE');
  if (decision.actor.authorityKind === 'HUMAN') {
    if (!decision.actor.actorReference.trim()) throw new TypeError('FIELD_ACTOR_REQUIRED');
  } else if (decision.actor.authorityKind === 'DETERMINISTIC_RULE') {
    if (decision.outcome !== 'ACCEPT_PROPOSED' || policy?.disposition !== 'AUTHORITATIVE' ||
      !policy.deterministicRule || policy.deterministicRule.code !== decision.actor.ruleCode ||
      policy.deterministicRule.version !== decision.actor.ruleVersion || compareTechnicalFact(ctx).status === 'CONFLICT') throw new TypeError('FIELD_MACHINE_AUTHORITY_FORBIDDEN');
  } else throw new TypeError('FIELD_ACTOR_REQUIRED');
  return port.recordDecision(decision);
}
