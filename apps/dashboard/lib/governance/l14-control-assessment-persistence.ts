import "server-only";
import {
  controlAssessmentReasonCode, decideControlAssessmentProposalFingerprint, submitControlAssessmentProposalFingerprint,
} from "@council/governance-review";
import type {
  L14ControlAssessmentCommandResult, L14ControlAssessmentProposalContent, L14GovernanceOutcome, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1C.5 server-only persistence adapter for the two CONTROL_ASSESSMENT RPCs
 * (l14_submit_control_assessment_proposal_v1, l14_decide_control_assessment_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The assessed subject is the exact control applicability state id, passed verbatim; the target, control definition
 *   version and pinned CONTROL_DEFINITION state are resolved by PostgreSQL from that immutable state (never sent).
 * - The outcome is the closed five-value vocabulary (WAIVED is refused by the mirror and by PostgreSQL); validUntil is
 *   mandatory on VALIDATE. No score, finding, waiver, scanner match or LLM output is read or sent here.
 * - Every fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch) and decides authority itself.
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1C.5.
 */

type Row = Record<string, unknown>;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});

const nullable = <T>(value: unknown) => (value ?? null) as T | null;
type Result = L14ControlAssessmentCommandResult;

function toResult(data: unknown): Result {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 control assessment RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as Result["commandKind"],
    subjectKind: row.subject_kind as Result["subjectKind"],
    outcome: row.outcome as Result["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<Result["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<NonNullable<Result["denyReason"]>>(row.deny_reason),
    expectationKind: nullable<NonNullable<Result["expectationKind"]>>(row.expectation_kind),
    expectedCurrentStateId: nullable<string>(row.expected_current_state_id),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    controlApplicabilityStateId: nullable<string>(row.control_applicability_state_id),
    controlDefinitionId: nullable<string>(row.control_definition_id),
    controlDefinitionVersionId: nullable<string>(row.control_definition_version_id),
    contentHash: nullable<string>(row.content_hash),
    assessmentOutcome: nullable<NonNullable<Result["assessmentOutcome"]>>(row.assessment_outcome),
    factStateId: nullable<string>(row.fact_state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    predecessorStateId: nullable<string>(row.predecessor_state_id),
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

export interface SubmitControlAssessmentProposalInput {
  readonly commandId: string;
  /** The exact applicability state, closed outcome, temporal intent (mandatory validUntil) and (REVOKE) exact target state. */
  readonly proposal: L14ControlAssessmentProposalContent;
  /** Correction link to an earlier proposal of the same fact key (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitControlAssessmentProposal(principal: GovernanceWritePrincipal,
  input: SubmitControlAssessmentProposalInput) {
  const fingerprint = submitControlAssessmentProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_control_assessment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_control_applicability_state_id: input.proposal.controlApplicabilityStateId,
    p_assessment_outcome: input.proposal.assessmentOutcome,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_requested_valid_until: input.proposal.requestedValidUntil,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideControlAssessmentProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14ControlAssessmentProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (no assessment of the applicability state yet); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decideControlAssessmentProposal(principal: GovernanceWritePrincipal,
  input: DecideControlAssessmentProposalInput) {
  const fingerprint = decideControlAssessmentProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_control_assessment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: controlAssessmentReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
