import { createHash } from 'node:crypto';
import type { L15ResidualRiskAssessmentProposalContent as Proposal, L15RiskAssessmentSupport, L14GovernanceOutcome } from '@council/canonical-contracts';
import { checkRiskAssessmentProposal, riskAssessmentReasonCode, riskAssessmentSupportParts } from './l15-risk-assessment.ts';
import { canonicalUuid, L14ContractError } from './l14-authority-policy.ts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';

/** Mirror only; PostgreSQL recomputes identity and validates every dependency at decision coordinates. */
export function residualRiskAssessmentPinParts(p: Proposal): string[] {
  if (p.assessmentBasis !== 'RESIDUAL') throw new L14ContractError('ASSESSMENT_BASIS_NOT_EXECUTABLE');
  const required = (id: string) => canonicalUuid(id, 'RESIDUAL_REQUIRED_PIN_MISSING');
  const set = (ids: readonly string[]) => {
    if (!Array.isArray(ids)) throw new L14ContractError('RESIDUAL_PIN_SET_MALFORMED');
    const normalized = ids.map(id => canonicalUuid(id, 'RESIDUAL_PIN_SET_MALFORMED')).sort();
    if (new Set(normalized).size !== ids.length) throw new L14ContractError('RESIDUAL_PIN_SET_MALFORMED');
    return [String(normalized.length), ...normalized];
  };
  return ['RESIDUAL_PINS_V1', required(p.inherentAssessmentStateId), required(p.methodologyValidatedStateId),
    'TREATMENTS', ...set(p.treatmentStateIds), 'CONTROL_ASSESSMENTS', ...set(p.controlAssessmentStateIds)];
}
export function checkResidualRiskAssessmentProposal(p: Proposal) {
  checkRiskAssessmentProposal({ ...p, assessmentBasis: 'INHERENT' });
  residualRiskAssessmentPinParts(p);
}
const hash = (parts: string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const expected = (id: string | null) => id === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(id)];
const target = (p: Proposal) => p.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(p.targetStateId)];
const content = (p: Proposal) => [canonicalUuid(p.governedRiskStateId), p.assessmentBasis, canonicalUuid(p.methodologyId),
  canonicalUuid(p.methodologyVersionId), p.methodologyContentHash,
  ...(p.assessmentOutcome === null ? ['NO_ASSESSMENT_OUTCOME'] : ['ASSESSMENT_OUTCOME', p.assessmentOutcome]),
  ...(p.likelihoodLevelCode === null ? ['NO_LIKELIHOOD_LEVEL'] : ['LIKELIHOOD_LEVEL', p.likelihoodLevelCode]),
  ...(p.impactLevelCode === null ? ['NO_IMPACT_LEVEL'] : ['IMPACT_LEVEL', p.impactLevelCode]),
  ...(p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]),
  ...(p.requestedValidUntil === null ? ['NO_VALID_UNTIL'] : ['VALID_UNTIL', p.requestedValidUntil])];
export interface SubmitResidualRiskAssessmentFingerprintInput {
  readonly organisationId: string; readonly actorUserId: string; readonly proposal: Proposal;
  readonly priorProposalId: string | null; readonly support: L15RiskAssessmentSupport;
}
export function submitResidualRiskAssessmentProposalFingerprint(i: SubmitResidualRiskAssessmentFingerprintInput) {
  const p = i.proposal;
  checkResidualRiskAssessmentProposal(p);
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    'RISK_ASSESSMENT', p.intent, p.sourceClass, ...content(p), ...expected(p.expectedCurrentStateId), ...target(p),
    ...(i.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(i.priorProposalId)]),
    ...residualRiskAssessmentPinParts(p), ...riskAssessmentSupportParts(i.support)]);
}
export interface DecideResidualRiskAssessmentFingerprintInput extends Omit<SubmitResidualRiskAssessmentFingerprintInput, 'priorProposalId'> {
  readonly outcome: L14GovernanceOutcome; readonly proposalId: string; readonly expectedCurrentStateId: string | null;
}
export function decideResidualRiskAssessmentProposalFingerprint(i: DecideResidualRiskAssessmentFingerprintInput) {
  const p = i.proposal;
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    i.outcome, riskAssessmentReasonCode(i.outcome), canonicalUuid(i.proposalId), 'RISK_ASSESSMENT', p.intent, p.sourceClass,
    ...content(p), ...target(p), ...expected(i.expectedCurrentStateId), ...residualRiskAssessmentPinParts(p), ...riskAssessmentSupportParts(i.support)]);
}
