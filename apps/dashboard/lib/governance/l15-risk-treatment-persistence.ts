import 'server-only';
import { decideRiskTreatmentProposalFingerprint, riskTreatmentReasonCode, submitRiskTreatmentProposalFingerprint } from '@council/governance-review';
import type {
  L14GovernanceOutcome, L15RiskTreatmentCommandResult, L15RiskTreatmentCurrentState, L15RiskTreatmentProposalContent,
  L15RiskTreatmentReadRequest, L15RiskTreatmentReadResult, L15RiskTreatmentSupport,
} from '@council/canonical-contracts';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from './persistence';
import { GovernedWriteError } from './governed-write-errors';

/** Server-only transport. Verified principal only; DB recomputes fingerprints, dependency validity and policy authority. */
const principalArgs = (p: GovernanceWritePrincipal) => ({ p_verified_organisation_id: p.organisationId,
  p_verified_actor_user_id: p.actorUserId, p_verified_session_iat: p.issuedAtSeconds,
  p_verified_session_exp: p.expiresAtSeconds, p_verified_credential_epoch: p.credentialEpoch });
const supportArgs = (s: L15RiskTreatmentSupport) => ({ p_support_status: s.status,
  p_support_tags: s.entries.map(e => e.tag), p_support_target_ids: s.entries.map(e => e.targetId) });
const camel = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
  [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
async function rpc(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) throw new GovernedWriteError(`${name} returned no row`);
  return row;
}
export interface SubmitRiskTreatmentProposalInput {
  readonly commandId: string; readonly proposal: L15RiskTreatmentProposalContent;
  readonly priorProposalId: string | null; readonly support: L15RiskTreatmentSupport;
}
export async function submitRiskTreatmentProposal(principal: GovernanceWritePrincipal, input: SubmitRiskTreatmentProposalInput): Promise<L15RiskTreatmentCommandResult> {
  const p = input.proposal;
  const fingerprint = submitRiskTreatmentProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    proposal: p, priorProposalId: input.priorProposalId, support: input.support });
  const row = await rpc('l15_submit_risk_treatment_proposal_v1', { ...principalArgs(principal), ...supportArgs(input.support),
    p_command_id: input.commandId, p_intent: p.intent, p_source_class: p.sourceClass,
    p_governed_risk_state_id: p.governedRiskStateId, p_treatment_option: p.treatmentOption, p_treatment_ordinal_key: p.treatmentOrdinalKey,
    p_responsible_governance_party_id: p.responsibleGovernancePartyId, p_party_validated_state_id: p.partyValidatedStateId,
    p_implementation_status: p.implementationStatus, p_target_implementation_date: p.targetImplementationDate,
    p_treatment_revocation_reason: p.treatmentRevocationReason, p_control_definition_version_ids: [...p.controlDefinitionVersionIds],
    p_requested_effective_from: p.requestedEffectiveFrom, p_requested_effective_to: p.requestedEffectiveTo,
    p_expected_current_state_id: p.expectedCurrentStateId, p_target_state_id: p.targetStateId,
    p_prior_proposal_id: input.priorProposalId, p_caller_fingerprint: fingerprint });
  return Object.freeze(camel(row)) as unknown as L15RiskTreatmentCommandResult;
}
export interface DecideRiskTreatmentProposalInput {
  readonly commandId: string; readonly proposalId: string; readonly proposal: L15RiskTreatmentProposalContent;
  readonly outcome: L14GovernanceOutcome; readonly expectedCurrentStateId: string | null; readonly support: L15RiskTreatmentSupport;
}
export async function decideRiskTreatmentProposal(principal: GovernanceWritePrincipal, input: DecideRiskTreatmentProposalInput): Promise<L15RiskTreatmentCommandResult> {
  const fingerprint = decideRiskTreatmentProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId, ...input });
  const row = await rpc('l15_decide_risk_treatment_proposal_v1', { ...principalArgs(principal), ...supportArgs(input.support),
    p_command_id: input.commandId, p_proposal_id: input.proposalId, p_outcome: input.outcome,
    p_reason_code: riskTreatmentReasonCode(input.outcome), p_expected_current_state_id: input.expectedCurrentStateId, p_caller_fingerprint: fingerprint });
  return Object.freeze(camel(row)) as unknown as L15RiskTreatmentCommandResult;
}
export async function readRiskTreatment(principal: GovernanceWritePrincipal, input: L15RiskTreatmentReadRequest): Promise<L15RiskTreatmentReadResult> {
  const row = await rpc('l15_read_risk_treatment_v1', { ...principalArgs(principal), p_governed_risk_state_id: input.governedRiskStateId,
    p_treatment_option: input.treatmentOption, p_treatment_ordinal_key: input.treatmentOrdinalKey,
    p_effective_at: input.effectiveAt, p_recorded_cutoff: input.recordedCutoff });
  const base = { effectiveAt: row.effective_at as string, recordedCutoff: row.recorded_cutoff as string };
  if (row.treatment_status === 'UNKNOWN') return Object.freeze({ ...base, status: 'UNKNOWN', resolution: row.resolution,
    failingDependency: row.dependency_kind ? { kind: row.dependency_kind, stateId: row.dependency_id } : null,
    current: null }) as L15RiskTreatmentReadResult;
  if (!['PLANNED', 'IMPLEMENTED'].includes(row.treatment_status as string) || row.resolution !== 'CURRENT' || !row.current_state) {
    throw new GovernedWriteError('l15_read_risk_treatment_v1 returned an invalid current state');
  }
  return Object.freeze({ ...base, status: row.treatment_status as 'PLANNED' | 'IMPLEMENTED', resolution: 'CURRENT', failingDependency: null,
    current: Object.freeze(camel(row.current_state as Record<string, unknown>)) as unknown as L15RiskTreatmentCurrentState });
}
