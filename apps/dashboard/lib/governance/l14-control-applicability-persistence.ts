import "server-only";
import {
  decideControlApplicabilityProposalFingerprint, controlApplicabilityReasonCode, submitControlApplicabilityProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L14ControlApplicabilityCommandResult, L14ControlApplicabilityProposalContent, L14ControlApplicabilityTarget,
  L14ControlDefinitionDependency, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1C.4 server-only persistence adapter for the two CONTROL_APPLICABILITY RPCs
 * (l14_submit_control_applicability_proposal_v1, l14_decide_control_applicability_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The target is the closed discriminated union (exact canonical object kind + id, or exact relationship id + relationship
 *   state id) passed verbatim; a relationship type is never sent (PostgreSQL resolves it for authorization scope only).
 * - The control dependency is the exact control definition id + version id + content hash + pinned VALIDATED
 *   CONTROL_DEFINITION state, passed verbatim; PostgreSQL resolves the hash against the admitted tuple and the state against
 *   the S1B.6 resolver. Nothing is resolved from a control code / title, a CG-AG id, a cg_* flag, the latest version, a
 *   scanner match or an LLM (none of which is read here).
 * - Every fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch) and decides authority itself.
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1C.4.
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
type Result = L14ControlApplicabilityCommandResult;

function targetOf(row: Row): L14ControlApplicabilityTarget | null {
  if (row.target_type === "CANONICAL_OBJECT") {
    return Object.freeze({ targetType: "CANONICAL_OBJECT", targetCanonicalKind: row.target_canonical_kind,
      targetCanonicalObjectId: row.target_canonical_object_id }) as L14ControlApplicabilityTarget;
  }
  if (row.target_type === "RELATIONSHIP_STATE") {
    return Object.freeze({ targetType: "RELATIONSHIP_STATE", relationshipId: row.target_relationship_id,
      relationshipStateId: row.target_relationship_state_id }) as L14ControlApplicabilityTarget;
  }
  return null;
}

function dependencyOf(row: Row): L14ControlDefinitionDependency | null {
  if (row.control_definition_id == null) return null;
  return Object.freeze({ controlDefinitionId: row.control_definition_id as string,
    controlDefinitionVersionId: row.control_definition_version_id as string, contentHash: row.content_hash as string,
    controlDefinitionValidatedStateId: row.control_definition_validated_state_id as string });
}

function toResult(data: unknown): Result {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 control applicability RPC returned no durable result");
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
    target: targetOf(row),
    dependency: dependencyOf(row),
    applicability: nullable<NonNullable<Result["applicability"]>>(row.applicability),
    factStateId: nullable<string>(row.fact_state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    predecessorStateId: nullable<string>(row.predecessor_state_id),
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

/** The closed union as the five exact RPC target operands (the inactive branch is always NULL). */
function targetArgs(target: L14ControlApplicabilityTarget) {
  return target.targetType === "CANONICAL_OBJECT"
    ? { p_target_type: target.targetType, p_target_canonical_kind: target.targetCanonicalKind,
        p_target_canonical_object_id: target.targetCanonicalObjectId, p_target_relationship_id: null,
        p_target_relationship_state_id: null }
    : { p_target_type: target.targetType, p_target_canonical_kind: null, p_target_canonical_object_id: null,
        p_target_relationship_id: target.relationshipId, p_target_relationship_state_id: target.relationshipStateId };
}

export interface SubmitControlApplicabilityProposalInput {
  readonly commandId: string;
  /** The exact target, exact control definition dependency, outcome, temporal intent and (REVOKE) exact target state. */
  readonly proposal: L14ControlApplicabilityProposalContent;
  /** Correction link to an earlier proposal of the same fact key (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitControlApplicabilityProposal(principal: GovernanceWritePrincipal,
  input: SubmitControlApplicabilityProposalInput) {
  const fingerprint = submitControlApplicabilityProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  const d = input.proposal.dependency;
  return call("l14_submit_control_applicability_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    ...targetArgs(input.proposal.target),
    p_control_definition_id: d.controlDefinitionId,
    p_control_definition_version_id: d.controlDefinitionVersionId,
    p_content_hash: d.contentHash,
    p_control_definition_validated_state_id: d.controlDefinitionValidatedStateId,
    p_applicability: input.proposal.applicability,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_requested_effective_to: input.proposal.requestedEffectiveTo,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideControlApplicabilityProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14ControlApplicabilityProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (no state of the exact fact key yet); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decideControlApplicabilityProposal(principal: GovernanceWritePrincipal,
  input: DecideControlApplicabilityProposalInput) {
  const fingerprint = decideControlApplicabilityProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_control_applicability_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: controlApplicabilityReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
