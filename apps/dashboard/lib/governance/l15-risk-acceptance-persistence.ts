import 'server-only';
import { decideRiskAcceptanceProposalFingerprint, riskAcceptanceReasonCode, submitRiskAcceptanceProposalFingerprint } from '@council/governance-review';
import type {
  L14GovernanceOutcome, L15RiskAcceptanceCommandResult, L15RiskAcceptanceCurrentState, L15RiskAcceptanceProposalContent,
  L15RiskAcceptanceReadRequest, L15RiskAcceptanceReadResult, L15RiskAcceptanceSupport,
} from '@council/canonical-contracts';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from './persistence';
import { GovernedWriteError } from './governed-write-errors';

/** Server-only transport. Verified principal only; DB recomputes fingerprints, dependency validity and policy authority. */
const principalArgs = (p: GovernanceWritePrincipal) => ({ p_verified_organisation_id: p.organisationId,
  p_verified_actor_user_id: p.actorUserId, p_verified_session_iat: p.issuedAtSeconds,
  p_verified_session_exp: p.expiresAtSeconds, p_verified_credential_epoch: p.credentialEpoch });
const supportArgs = (s: L15RiskAcceptanceSupport) => ({ p_support_status: s.status,
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
export interface SubmitRiskAcceptanceProposalInput {
  readonly commandId: string; readonly proposal: L15RiskAcceptanceProposalContent;
  readonly priorProposalId: string | null; readonly support: L15RiskAcceptanceSupport;
}
export async function submitRiskAcceptanceProposal(principal: GovernanceWritePrincipal, input: SubmitRiskAcceptanceProposalInput): Promise<L15RiskAcceptanceCommandResult> {
  const p = input.proposal;
  const fingerprint = submitRiskAcceptanceProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    proposal: p, priorProposalId: input.priorProposalId, support: input.support });
  const row = await rpc('l15_submit_risk_acceptance_proposal_v1', { ...principalArgs(principal), ...supportArgs(input.support),
    p_command_id: input.commandId, p_intent: p.intent, p_source_class: p.sourceClass,
    p_residual_assessment_state_id: p.residualAssessmentStateId,
    p_requested_effective_from: p.requestedEffectiveFrom, p_requested_valid_until: p.requestedValidUntil,
    p_expected_current_state_id: p.expectedCurrentStateId, p_target_state_id: p.targetStateId,
    p_prior_proposal_id: input.priorProposalId, p_caller_fingerprint: fingerprint });
  return Object.freeze(camel(row)) as unknown as L15RiskAcceptanceCommandResult;
}
export interface DecideRiskAcceptanceProposalInput {
  readonly commandId: string; readonly proposalId: string; readonly proposal: L15RiskAcceptanceProposalContent;
  readonly outcome: L14GovernanceOutcome; readonly expectedCurrentStateId: string | null; readonly support: L15RiskAcceptanceSupport;
}
export async function decideRiskAcceptanceProposal(principal: GovernanceWritePrincipal, input: DecideRiskAcceptanceProposalInput): Promise<L15RiskAcceptanceCommandResult> {
  const fingerprint = decideRiskAcceptanceProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId, ...input });
  const row = await rpc('l15_decide_risk_acceptance_proposal_v1', { ...principalArgs(principal), ...supportArgs(input.support),
    p_command_id: input.commandId, p_proposal_id: input.proposalId, p_outcome: input.outcome,
    p_reason_code: riskAcceptanceReasonCode(input.outcome), p_expected_current_state_id: input.expectedCurrentStateId, p_caller_fingerprint: fingerprint });
  return Object.freeze(camel(row)) as unknown as L15RiskAcceptanceCommandResult;
}
export async function readRiskAcceptance(principal: GovernanceWritePrincipal, input: L15RiskAcceptanceReadRequest): Promise<L15RiskAcceptanceReadResult> {
  const row = await rpc('l15_read_risk_acceptance_v1', { ...principalArgs(principal), p_residual_assessment_state_id: input.residualAssessmentStateId,
    p_effective_at: input.effectiveAt, p_recorded_cutoff: input.recordedCutoff });
  const base = { effectiveAt: row.effective_at as string, recordedCutoff: row.recorded_cutoff as string };
  if (row.acceptance_status === 'UNKNOWN') return Object.freeze({ ...base, status: 'UNKNOWN', resolution: row.resolution,
    failingDependency: row.dependency_kind ? { kind: row.dependency_kind, stateId: row.dependency_id } : null,
    current: null }) as L15RiskAcceptanceReadResult;
  if (row.acceptance_status !== 'ACCEPTED' || row.resolution !== 'CURRENT' || !row.current_state) {
    throw new GovernedWriteError('l15_read_risk_acceptance_v1 returned an invalid current state');
  }
  return Object.freeze({ ...base, status: 'ACCEPTED' as const, resolution: 'CURRENT', failingDependency: null,
    current: Object.freeze(camel(row.current_state as Record<string, unknown>)) as unknown as L15RiskAcceptanceCurrentState });
}
