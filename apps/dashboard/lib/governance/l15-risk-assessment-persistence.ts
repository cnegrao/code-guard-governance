import "server-only";
import {
  decideRiskAssessmentProposalFingerprint, riskAssessmentReasonCode, submitRiskAssessmentProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L15CurrentRiskAssessmentLineage, L15InherentRiskAssessmentProposalContent, L15RiskAssessmentCommandResult,
  L15RiskAssessmentReadRequest, L15RiskAssessmentReadResult, L15RiskAssessmentSupport,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M17-S4 server-only persistence adapter for the three RISK_ASSESSMENT RPCs (l15_submit_risk_assessment_proposal_v1,
 * l15_decide_risk_assessment_proposal_v1, l15_read_risk_assessment_v1).
 *
 * - Identity / session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim; PostgreSQL re-derives the
 *   verified ACTIVE human, current roles and the effective Authority Policy in-RPC. service_role is transport, not authority.
 * - The caller never supplies a rating band, score, weight, percentage, domain, subject or scenario: no such argument exists.
 *   PostgreSQL proves level membership in the pinned methodology scales, derives the band from the exact pinned rating cell,
 *   enforces the validity maximum and resolves the exact governed-risk / methodology dependencies itself.
 * - Fingerprints are assertions (preflight UX): PostgreSQL recomputes them (GV008 on mismatch).
 * - A DENY is a durable result (outcome DENIED), never an error. No HTTP route or UI consumes this adapter in S4.
 */

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

export interface SubmitRiskAssessmentProposalInput {
  readonly commandId: string;
  readonly proposal: L15InherentRiskAssessmentProposalContent;
  readonly priorProposalId: string | null;
  /** Hypotheses / signals / rank-0 evidence cited as provenance only (never authority, never a dependency pin). */
  readonly support: L15RiskAssessmentSupport;
}

export async function submitRiskAssessmentProposal(principal: GovernanceWritePrincipal, input: SubmitRiskAssessmentProposalInput) {
  const p = input.proposal;
  const fingerprint = submitRiskAssessmentProposalFingerprint({ organisationId: principal.organisationId,
    actorUserId: principal.actorUserId, proposal: p, priorProposalId: input.priorProposalId, support: input.support });
  return call("l15_submit_risk_assessment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: p.intent,
    p_source_class: p.sourceClass,
    p_governed_risk_state_id: p.governedRiskStateId,
    p_assessment_basis: p.assessmentBasis,
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

export interface DecideRiskAssessmentProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L15InherentRiskAssessmentProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the key); otherwise the exact head state. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15RiskAssessmentSupport;
}

export async function decideRiskAssessmentProposal(principal: GovernanceWritePrincipal, input: DecideRiskAssessmentProposalInput) {
  const fingerprint = decideRiskAssessmentProposalFingerprint({ organisationId: principal.organisationId,
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

/**
 * Exact bitemporal read of one assessment key (exact governed-risk state + INHERENT) — read only. UNKNOWN carries no
 * assessment content at all (never LOW, never a default level / band); INSUFFICIENT_EVIDENCE and RATED carry the exact current
 * lineage.
 */
export async function readRiskAssessment(principal: GovernanceWritePrincipal, request: L15RiskAssessmentReadRequest):
  Promise<L15RiskAssessmentReadResult> {
  const { data, error } = await privilegedDb.rpc("l15_read_risk_assessment_v1", {
    ...principalArgs(principal),
    p_governed_risk_state_id: request.governedRiskStateId,
    p_assessment_basis: request.assessmentBasis,
    p_effective_at: request.effectiveAt,
    p_recorded_cutoff: request.recordedCutoff,
  });
  if (error) throw new GovernedWriteError(`l15_read_risk_assessment_v1 failed: ${error.message}`, error.code);
  const row = firstRow(data);
  if (!row) throw new GovernedWriteError("l15_read_risk_assessment_v1 returned no row");
  const base = {
    effectiveAt: row.effective_at as string,
    recordedCutoff: row.recorded_cutoff as string,
    governedRiskStateId: row.governed_risk_state_id as string,
    assessmentBasis: "INHERENT" as const,
  };
  if (row.assessment_status === "UNKNOWN") {
    return Object.freeze({ ...base, status: "UNKNOWN", resolution: row.resolution as never, current: null });
  }
  const current: L15CurrentRiskAssessmentLineage = Object.freeze({
    stateId: row.state_id as string,
    methodology: {
      methodologyId: row.methodology_id as string,
      methodologyVersionId: row.methodology_version_id as string,
      methodologyContentHash: row.methodology_content_hash as string,
      methodologyValidatedStateId: row.methodology_validated_state_id as string,
    },
    effectiveFrom: row.effective_from as string,
    validUntil: row.valid_until as string,
    recordedAt: row.recorded_at as string,
    predecessorStateId: nullable<string>(row.predecessor_state_id),
    proposalId: row.proposal_id as string,
    governanceDecisionId: row.governance_decision_id as string,
    authorizationDecisionId: row.authorization_decision_id as string,
    authorityPolicyId: row.authority_policy_id as string,
    authorityPolicyVersionId: row.authority_policy_version_id as string,
    authorityPolicyContentHash: row.authority_policy_content_hash as string,
    sourceClass: "LOCAL_HUMAN",
    supportStatus: row.support_status as "NONE" | "PRESENT",
  });
  if (row.assessment_status === "INSUFFICIENT_EVIDENCE") {
    return Object.freeze({ ...base, status: "INSUFFICIENT_EVIDENCE", resolution: "CURRENT", current });
  }
  if (row.assessment_status !== "RATED") throw new GovernedWriteError("l15_read_risk_assessment_v1 returned an unknown status");
  return Object.freeze({ ...base, status: "RATED", resolution: "CURRENT", likelihoodLevelCode: row.likelihood_level_code as string,
    impactLevelCode: row.impact_level_code as string, ratingBand: row.rating_band as never, current });
}
