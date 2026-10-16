import "server-only";
import {
  decideResidualRiskAssessmentProposalFingerprint, riskAssessmentReasonCode, submitResidualRiskAssessmentProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L15ResidualRiskAssessmentReadResult, L15ResidualRiskAssessmentProposalContent, L15RiskAssessmentCommandResult,
  L15RiskAssessmentSupport,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/** S6 server-only residual adapter: verified principal, exact pins and existing assessment decision RPC. */

type Row = Record<string, unknown>;
type Result = L15RiskAssessmentCommandResult;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});
const nullable = <T>(value: unknown) => (value ?? null) as T | null;
const firstRow = (data: unknown) => (Array.isArray(data) ? data[0] : data) as Row | undefined;

function toResult(data: unknown): Result {
  const row = firstRow(data);
  if (!row) throw new GovernedWriteError("RISK_ASSESSMENT RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as Result["commandKind"],
    subjectKind: "RISK_ASSESSMENT",
    outcome: row.outcome as Result["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<Result["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<string>(row.deny_reason),
    expectationKind: nullable<NonNullable<Result["expectationKind"]>>(row.expectation_kind),
    expectedCurrentStateId: nullable<string>(row.expected_current_state_id),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    governedRiskStateId: nullable<string>(row.governed_risk_state_id),
    assessmentBasis: nullable<NonNullable<Result["assessmentBasis"]>>(row.assessment_basis),
    methodology: row.methodology_id ? {
      methodologyId: row.methodology_id as string,
      methodologyVersionId: row.methodology_version_id as string,
      methodologyContentHash: row.methodology_content_hash as string,
    } : null,
    assessmentOutcome: nullable<NonNullable<Result["assessmentOutcome"]>>(row.assessment_outcome),
    likelihoodLevelCode: nullable<string>(row.likelihood_level_code),
    impactLevelCode: nullable<string>(row.impact_level_code),
    ratingBand: nullable<NonNullable<Result["ratingBand"]>>(row.rating_band),
    requestedValidUntil: nullable<string>(row.requested_valid_until),
    stateId: nullable<string>(row.state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    predecessorStateId: nullable<string>(row.predecessor_state_id),
    methodologyValidatedStateId: nullable<string>(row.methodology_validated_state_id),
    effectiveFrom: nullable<string>(row.effective_from),
    validUntil: nullable<string>(row.valid_until),
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

const supportArgs = (support: L15RiskAssessmentSupport) => ({
  p_support_status: support.status,
  p_support_tags: support.entries.map(e => e.tag),
  p_support_target_ids: support.entries.map(e => e.targetId),
});

export interface SubmitResidualRiskAssessmentProposalInput {
  readonly commandId: string;
  readonly proposal: L15ResidualRiskAssessmentProposalContent;
  readonly priorProposalId: string | null;
  /** Hypotheses / signals / rank-0 evidence cited as provenance only (never authority, never a dependency pin). */
  readonly support: L15RiskAssessmentSupport;
}

export async function submitResidualRiskAssessmentProposal(principal: GovernanceWritePrincipal, input: SubmitResidualRiskAssessmentProposalInput) {
  const p = input.proposal;
  const fingerprint = submitResidualRiskAssessmentProposalFingerprint({ organisationId: principal.organisationId,
    actorUserId: principal.actorUserId, proposal: p, priorProposalId: input.priorProposalId, support: input.support });
  return call("l15_submit_risk_assessment_proposal_v2", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: p.intent,
    p_source_class: p.sourceClass,
    p_governed_risk_state_id: p.governedRiskStateId,
    p_assessment_basis: p.assessmentBasis,
    p_inherent_assessment_state_id: p.inherentAssessmentStateId,
    p_methodology_validated_state_id: p.methodologyValidatedStateId,
    p_treatment_state_ids: [...p.treatmentStateIds],
    p_control_assessment_state_ids: [...p.controlAssessmentStateIds],
    p_methodology_id: p.methodologyId,
    p_methodology_version_id: p.methodologyVersionId,
    p_methodology_content_hash: p.methodologyContentHash,
    p_assessment_outcome: p.assessmentOutcome,
    p_likelihood_level_code: p.likelihoodLevelCode,
    p_impact_level_code: p.impactLevelCode,
    p_requested_effective_from: p.requestedEffectiveFrom,
    p_requested_valid_until: p.requestedValidUntil,
    p_expected_current_state_id: p.expectedCurrentStateId,
    p_target_state_id: p.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideResidualRiskAssessmentProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L15ResidualRiskAssessmentProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the key); otherwise the exact head state. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15RiskAssessmentSupport;
}

export async function decideResidualRiskAssessmentProposal(principal: GovernanceWritePrincipal, input: DecideResidualRiskAssessmentProposalInput) {
  const fingerprint = decideResidualRiskAssessmentProposalFingerprint({ organisationId: principal.organisationId,
    actorUserId: principal.actorUserId, outcome: input.outcome, proposalId: input.proposalId, proposal: input.proposal,
    expectedCurrentStateId: input.expectedCurrentStateId, support: input.support });
  return call("l15_decide_risk_assessment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: riskAssessmentReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}

export async function readResidualRiskAssessment(principal: GovernanceWritePrincipal, request: {
  readonly governedRiskStateId: string; readonly effectiveAt: string | null; readonly recordedCutoff: string | null;
}): Promise<L15ResidualRiskAssessmentReadResult> {
  const { data, error } = await privilegedDb.rpc('l15_read_risk_assessment_v2', {
    ...principalArgs(principal), p_governed_risk_state_id: request.governedRiskStateId, p_assessment_basis: 'RESIDUAL',
    p_effective_at: request.effectiveAt, p_recorded_cutoff: request.recordedCutoff,
  });
  if (error) throw new GovernedWriteError(error.message, error.code);
  const r = firstRow(data);
  if (!r) throw new GovernedWriteError('Residual read returned no row');
  return Object.freeze({ status: r.assessment_status, resolution: r.resolution, dependencyKind: r.dependency_kind,
    dependencyId: r.dependency_id, causeKind: r.cause_kind, causeId: r.cause_id, causeResolution: r.cause_resolution,
    effectiveAt: r.effective_at, recordedCutoff: r.recorded_cutoff,
    current: r.current_state }) as L15ResidualRiskAssessmentReadResult;
}
