import { createHash } from 'node:crypto';
import {
  L15_RISK_TREATMENT_OPTIONS, L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES, L15_RISK_TREATMENT_REVOCATION_REASONS,
  type L14GovernanceOutcome, type L15RiskTreatmentProposalContent, type L15RiskTreatmentSupport,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { canonicalUuid, L14ContractError } from './l14-authority-policy.ts';
import { governedRiskSupportParts } from './l15-governed-risk.ts';

/** Pure command-framing mirror only. PostgreSQL independently validates and computes authority/fingerprints. */
export const riskTreatmentSupportParts = governedRiskSupportParts;
const fail = (message: string): never => { throw new L14ContractError(message); };
const within = (values: readonly string[], x: unknown) => typeof x === 'string' && values.includes(x);
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const hash = (p: string[]) => createHash('sha256').update(frameIdentity(p), 'utf8').digest('hex');
export function riskTreatmentReasonCode(outcome: L14GovernanceOutcome): string {
  const suffix = { VALIDATE: 'VALIDATED', REJECT: 'REJECTED', DEFER: 'DEFERRED', REVOKE: 'REVOKED' }[outcome];
  return suffix ? `RISK_TREATMENT_${suffix}` : fail('DECISION_VOCABULARY_INVALID');
}
export function checkRiskTreatmentProposal(p: L15RiskTreatmentProposalContent): void {
  if (!within(['VALIDATE', 'REVOKE'], p?.intent) || !within(['LOCAL_HUMAN', 'SYSTEM_SEED', 'SOURCE_CONNECTION'], p?.sourceClass)) fail('PROPOSAL_VOCABULARY_UNKNOWN');
  if ((p.sourceClass as string) !== 'LOCAL_HUMAN') fail(`${p.sourceClass}_NOT_ADMISSIBLE`);
  if (!within(L15_RISK_TREATMENT_OPTIONS, p.treatmentOption)) fail('TREATMENT_OPTION_UNKNOWN');
  if (typeof p.treatmentOrdinalKey !== 'string' || p.treatmentOrdinalKey.length < 1 || p.treatmentOrdinalKey.length > 500 || p.treatmentOrdinalKey !== p.treatmentOrdinalKey.trim()) fail('TREATMENT_ORDINAL_KEY_INVALID');
  for (const id of [p.governedRiskStateId, p.responsibleGovernancePartyId, p.partyValidatedStateId]) canonicalUuid(id, 'DEPENDENCY_PIN_REQUIRED');
  if (p.implementationStatus !== null && !within(L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES, p.implementationStatus)) fail('IMPLEMENTATION_STATUS_UNKNOWN');
  if (p.treatmentRevocationReason !== null && !within(L15_RISK_TREATMENT_REVOCATION_REASONS, p.treatmentRevocationReason)) fail('TREATMENT_REVOCATION_REASON_UNKNOWN');
  if (p.intent === 'VALIDATE' && (p.implementationStatus === null || p.treatmentRevocationReason !== null || p.targetStateId !== null)) fail('TREATMENT_CONTENT_INVALID');
  if (p.intent === 'VALIDATE' && p.implementationStatus === 'IMPLEMENTED' && p.expectedCurrentStateId === null) fail('IMPLEMENTATION_PREDECESSOR_REQUIRED');
  if (p.intent === 'REVOKE' && (p.implementationStatus !== null || p.targetImplementationDate !== null || p.requestedEffectiveTo !== null || p.treatmentRevocationReason === null || p.targetStateId === null || p.expectedCurrentStateId !== p.targetStateId)) fail('REVOCATION_CONTENT_INVALID');
  if (!Array.isArray(p.controlDefinitionVersionIds) || new Set(p.controlDefinitionVersionIds.map(id => canonicalUuid(id))).size !== p.controlDefinitionVersionIds.length) fail('CONTROL_PINS_MALFORMED');
  if (p.treatmentOption !== 'MITIGATE' && p.controlDefinitionVersionIds.length) fail('CONTROL_PINS_NOT_PERMITTED');
  if (p.targetImplementationDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(p.targetImplementationDate) || new Date(p.targetImplementationDate).toISOString().slice(0, 10) !== p.targetImplementationDate)) fail('TARGET_DATE_INVALID');
  for (const t of [p.requestedEffectiveFrom, p.requestedEffectiveTo]) if (t !== null && !instant.test(t)) fail('EFFECTIVE_INSTANT_NOT_CANONICAL');
  if (p.requestedEffectiveFrom !== null && p.requestedEffectiveTo !== null && p.requestedEffectiveTo <= p.requestedEffectiveFrom) fail('EFFECTIVE_INTERVAL_INVALID');
}
const expected = (id: string | null) => id === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(id)];
const target = (id: string | null) => id === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(id)];
const content = (p: L15RiskTreatmentProposalContent) => [canonicalUuid(p.governedRiskStateId), p.treatmentOption, p.treatmentOrdinalKey,
  canonicalUuid(p.responsibleGovernancePartyId), canonicalUuid(p.partyValidatedStateId), p.implementationStatus ?? 'NO_IMPLEMENTATION_STATUS',
  p.targetImplementationDate ?? 'NO_TARGET_DATE', p.treatmentRevocationReason ?? 'NO_REVOCATION_REASON', String(p.controlDefinitionVersionIds.length),
  ...p.controlDefinitionVersionIds.map(id => canonicalUuid(id)).sort(),
  ...(p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]),
  ...(p.requestedEffectiveTo === null ? ['NO_EFFECTIVE_TO'] : ['EFFECTIVE_TO', p.requestedEffectiveTo])];
export interface L15SubmitRiskTreatmentFingerprintInput {
  readonly organisationId: string; readonly actorUserId: string; readonly proposal: L15RiskTreatmentProposalContent;
  readonly priorProposalId: string | null; readonly support: L15RiskTreatmentSupport;
}
export function submitRiskTreatmentProposalFingerprint(i: L15SubmitRiskTreatmentFingerprintInput): string {
  checkRiskTreatmentProposal(i.proposal);
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    'RISK_TREATMENT', i.proposal.intent, i.proposal.sourceClass, ...content(i.proposal), ...expected(i.proposal.expectedCurrentStateId),
    ...target(i.proposal.targetStateId), ...(i.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(i.priorProposalId)]),
    ...riskTreatmentSupportParts(i.support)]);
}
export interface L15DecideRiskTreatmentFingerprintInput {
  readonly organisationId: string; readonly actorUserId: string; readonly proposal: L15RiskTreatmentProposalContent;
  readonly proposalId: string; readonly outcome: L14GovernanceOutcome; readonly expectedCurrentStateId: string | null;
  readonly support: L15RiskTreatmentSupport;
}
export function decideRiskTreatmentProposalFingerprint(i: L15DecideRiskTreatmentFingerprintInput): string {
  // The DB resolves the predecessor's persisted VALIDATED + PLANNED status.
  if (i.outcome === 'VALIDATE' && i.proposal.implementationStatus === 'IMPLEMENTED'
    && (i.proposal.expectedCurrentStateId === null || i.expectedCurrentStateId === null)) fail('IMPLEMENTATION_PREDECESSOR_REQUIRED');
  return hash(['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', canonicalUuid(i.organisationId), canonicalUuid(i.actorUserId),
    i.outcome, riskTreatmentReasonCode(i.outcome), canonicalUuid(i.proposalId), 'RISK_TREATMENT', i.proposal.intent, i.proposal.sourceClass,
    ...content(i.proposal), ...target(i.proposal.targetStateId), ...expected(i.expectedCurrentStateId), ...riskTreatmentSupportParts(i.support)]);
}
