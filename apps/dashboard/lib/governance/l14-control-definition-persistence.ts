import "server-only";
import {
  admitControlDefinitionVersionFingerprint, controlDefinitionContentHash, controlDefinitionReasonCode,
  decideControlDefinitionProposalFingerprint, submitControlDefinitionProposalFingerprint,
} from "@council/governance-review";
import type {
  L14ControlDefinitionAdmitExpectation, L14ControlDefinitionCommandResult, L14ControlDefinitionProposalContent,
  L14ControlDefinitionVersionContent, L14GovernanceOutcome, L14SourceClass, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1B.6 server-only persistence adapter for the three CONTROL_DEFINITION registry RPCs
 * (l14_admit_control_definition_version_v1, l14_submit_control_definition_proposal_v1,
 * l14_decide_control_definition_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - Both ids are opaque caller-supplied UUIDs passed verbatim; nothing is derived from the control code, title,
 *   description or any CG-AG id / flag / score (none of which is read here).
 * - The content hash and every fingerprint are assertions: PostgreSQL recomputes them (GV010 / GV008 on mismatch).
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1B.6.
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
type Result = L14ControlDefinitionCommandResult;

function toResult(data: unknown): Result {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 control definition RPC returned no durable result");
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
    attemptedContentHash: nullable<string>(row.attempted_content_hash),
    expectationKind: nullable<NonNullable<Result["expectationKind"]>>(row.expectation_kind),
    expectedLatestVersionId: nullable<string>(row.expected_latest_version_id),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    controlDefinitionId: nullable<string>(row.control_definition_id),
    controlDefinitionVersionId: nullable<string>(row.control_definition_version_id),
    predecessorVersionId: nullable<string>(row.predecessor_version_id),
    contentHash: nullable<string>(row.content_hash),
    registryStateId: nullable<string>(row.registry_state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    effectiveFrom: nullable<string>(row.effective_from),
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface AdmitControlDefinitionVersionInput {
  readonly commandId: string;
  readonly controlDefinitionId: string;
  readonly controlDefinitionVersionId: string;
  /** EXPECTED_NONE = first version (creates the stable identity); EXPECTED_CURRENT = the exact latest admitted version. */
  readonly expectation: L14ControlDefinitionAdmitExpectation;
  readonly content: L14ControlDefinitionVersionContent;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export async function admitControlDefinitionVersion(principal: GovernanceWritePrincipal, input: AdmitControlDefinitionVersionInput) {
  const fingerprint = admitControlDefinitionVersionFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    controlDefinitionId: input.controlDefinitionId, controlDefinitionVersionId: input.controlDefinitionVersionId,
    expectation: input.expectation, content: input.content, sourceClass: input.sourceClass, support: input.support,
  });
  return call("l14_admit_control_definition_version_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_control_definition_id: input.controlDefinitionId,
    p_control_definition_version_id: input.controlDefinitionVersionId,
    p_expectation_kind: input.expectation.kind,
    p_expected_latest_version_id: input.expectation.kind === "EXPECTED_CURRENT" ? input.expectation.latestVersionId : null,
    p_control_code: input.content.controlCode,
    p_title: input.content.title,
    p_description: input.content.description,
    p_content_hash: controlDefinitionContentHash(input.content),
    p_source_class: input.sourceClass,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface SubmitControlDefinitionProposalInput {
  readonly commandId: string;
  /** Pins the exact admitted (identity, version, content hash) tuple. */
  readonly proposal: L14ControlDefinitionProposalContent;
  /** Correction link to an earlier proposal of the same exact tuple (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitControlDefinitionProposal(principal: GovernanceWritePrincipal, input: SubmitControlDefinitionProposalInput) {
  const fingerprint = submitControlDefinitionProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_control_definition_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_control_definition_id: input.proposal.controlDefinitionId,
    p_control_definition_version_id: input.proposal.controlDefinitionVersionId,
    p_content_hash: input.proposal.contentHash,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideControlDefinitionProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14ControlDefinitionProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the exact tuple); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decideControlDefinitionProposal(principal: GovernanceWritePrincipal, input: DecideControlDefinitionProposalInput) {
  const fingerprint = decideControlDefinitionProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_control_definition_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: controlDefinitionReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
