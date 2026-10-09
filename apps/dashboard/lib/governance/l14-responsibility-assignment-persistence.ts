import "server-only";
import {
  decideResponsibilityAssignmentProposalFingerprint, responsibilityReasonCode, submitResponsibilityAssignmentProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L14ResponsibilityAssignmentCommandResult, L14ResponsibilityAssignmentProposalContent, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1C.1 server-only persistence adapter for the two RESPONSIBILITY_ASSIGNMENT RPCs
 * (l14_submit_responsibility_assignment_proposal_v1, l14_decide_responsibility_assignment_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The target is the exact canonical object id + kind and the Party is its opaque governancePartyId + the exact pinned
 *   VALIDATED Party state, passed verbatim; nothing is resolved from a name, label, profile, directory mapping,
 *   governance user or legacy owner field (none of which is read here). No PII is ever sent.
 * - Every fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch) and decides authority itself.
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1C.1.
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
type Result = L14ResponsibilityAssignmentCommandResult;

function toResult(data: unknown): Result {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 responsibility assignment RPC returned no durable result");
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
    targetKind: nullable<NonNullable<Result["targetKind"]>>(row.target_kind),
    targetCanonicalObjectId: nullable<string>(row.target_canonical_object_id),
    responsibilityRole: nullable<NonNullable<Result["responsibilityRole"]>>(row.responsibility_role),
    governancePartyId: nullable<string>(row.governance_party_id),
    partyValidatedStateId: nullable<string>(row.party_validated_state_id),
    factStateId: nullable<string>(row.fact_state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    effectiveFrom: nullable<string>(row.effective_from),
    effectiveTo: nullable<string>(row.effective_to),
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface SubmitResponsibilityAssignmentProposalInput {
  readonly commandId: string;
  /** The exact fact key, the exact pinned VALIDATED Party state, temporal intent and (REVOKE) exact target state. */
  readonly proposal: L14ResponsibilityAssignmentProposalContent;
  /** Correction link to an earlier proposal of the same fact key (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitResponsibilityAssignmentProposal(principal: GovernanceWritePrincipal,
  input: SubmitResponsibilityAssignmentProposalInput) {
  const fingerprint = submitResponsibilityAssignmentProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_responsibility_assignment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_target_kind: input.proposal.targetKind,
    p_target_canonical_object_id: input.proposal.targetCanonicalObjectId,
    p_responsibility_role: input.proposal.responsibilityRole,
    p_governance_party_id: input.proposal.governancePartyId,
    p_party_validated_state_id: input.proposal.partyValidatedStateId,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_requested_effective_to: input.proposal.requestedEffectiveTo,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideResponsibilityAssignmentProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14ResponsibilityAssignmentProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (no state of the exact fact key yet); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decideResponsibilityAssignmentProposal(principal: GovernanceWritePrincipal,
  input: DecideResponsibilityAssignmentProposalInput) {
  const fingerprint = decideResponsibilityAssignmentProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_responsibility_assignment_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: responsibilityReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
