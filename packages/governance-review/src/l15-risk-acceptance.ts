import { createHash } from 'node:crypto';
import type { L14GovernanceOutcome, L15RiskAcceptanceProposalContent, L15RiskAcceptanceSupport } from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { canonicalUuid, L14ContractError } from './l14-authority-policy.ts';
import { governedRiskSupportParts } from './l15-governed-risk.ts';

/** Pure command framing. PostgreSQL resolves exact dependencies, time and authority. */
export const riskAcceptanceSupportParts = governedRiskSupportParts;
const fail = (message: string): never => { throw new L14ContractError(message); };
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const hash = (p: string[]) => createHash('sha256').update(frameIdentity(p), 'utf8').digest('hex');
export function riskAcceptanceReasonCode(outcome: L14GovernanceOutcome): string {
  const suffix = { VALIDATE: 'VALIDATED', REJECT: 'REJECTED', DEFER: 'DEFERRED', REVOKE: 'REVOKED' }[outcome];
  return suffix ? `RISK_ACCEPTANCE_${suffix}` : fail('DECISION_VOCABULARY_INVALID');
}
export function checkRiskAcceptanceProposal(p: L15RiskAcceptanceProposalContent): void {
  if (!['VALIDATE', 'REVOKE'].includes(p?.intent)) fail('PROPOSAL_VOCABULARY_UNKNOWN');
  if (p.sourceClass !== 'LOCAL_HUMAN') fail('SOURCE_NOT_ADMISSIBLE');
  canonicalUuid(p.residualAssessmentStateId, 'RESIDUAL_PIN_REQUIRED');
  for (const id of [p.expectedCurrentStateId, p.targetStateId]) if (id !== null) canonicalUuid(id);
  if (p.intent === 'VALIDATE' && (p.requestedValidUntil === null || p.targetStateId !== null)) fail('ACCEPTANCE_CONTENT_INVALID');
  if (p.intent === 'REVOKE' && (p.requestedValidUntil !== null || p.targetStateId === null || p.expectedCurrentStateId !== p.targetStateId)) fail('REVOCATION_CONTENT_INVALID');
  for (const t of [p.requestedEffectiveFrom, p.requestedValidUntil]) if (t !== null && !instant.test(t)) fail('EFFECTIVE_INSTANT_NOT_CANONICAL');
  if (p.requestedEffectiveFrom !== null && p.requestedValidUntil !== null && p.requestedValidUntil <= p.requestedEffectiveFrom) fail('EFFECTIVE_INTERVAL_INVALID');
}
const expected = (id: string | null) => id === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(id)];
const target = (id: string | null) => id === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(id)];
const content = (p: L15RiskAcceptanceProposalContent) => [canonicalUuid(p.residualAssessmentStateId),
  ...(p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]),
  ...(p.requestedValidUntil === null ? ['NO_VALID_UNTIL'] : ['VALID_UNTIL', p.requestedValidUntil])];
export interface L15SubmitRiskAcceptanceFingerprintInput {
  readonly organisationId: string; readonly actorUserId: string; readonly proposal: L15RiskAcceptanceProposalContent;
  readonly priorProposalId: string | null; readonly support: L15RiskAcceptanceSupport;
}
export function submitRiskAcceptanceProposalFingerprint(i: L15SubmitRiskAcceptanceFingerprintInput): string {
  checkRiskAcceptanceProposal(i.proposal);
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    'RISK_ACCEPTANCE', i.proposal.intent, i.proposal.sourceClass, ...content(i.proposal), ...expected(i.proposal.expectedCurrentStateId),
    ...target(i.proposal.targetStateId), ...(i.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(i.priorProposalId)]),
    ...riskAcceptanceSupportParts(i.support)]);
}
export interface L15DecideRiskAcceptanceFingerprintInput {
  readonly organisationId: string; readonly actorUserId: string; readonly proposal: L15RiskAcceptanceProposalContent;
  readonly proposalId: string; readonly outcome: L14GovernanceOutcome; readonly expectedCurrentStateId: string | null;
  readonly support: L15RiskAcceptanceSupport;
}
export function decideRiskAcceptanceProposalFingerprint(i: L15DecideRiskAcceptanceFingerprintInput): string {
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    i.outcome, riskAcceptanceReasonCode(i.outcome), canonicalUuid(i.proposalId), 'RISK_ACCEPTANCE', i.proposal.intent, i.proposal.sourceClass,
    ...content(i.proposal), ...target(i.proposal.targetStateId), ...expected(i.expectedCurrentStateId), ...riskAcceptanceSupportParts(i.support)]);
}
