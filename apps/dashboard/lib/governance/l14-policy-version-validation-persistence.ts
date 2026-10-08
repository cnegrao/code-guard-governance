import "server-only";
import {
  decidePolicyVersionProposalFingerprint, policyVersionReasonCode, submitPolicyVersionProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L14PolicyVersionProposalContent, L14PolicyVersionValidationCommandResult, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1B.4 server-only persistence adapter for the two POLICY_VERSION governance RPCs
 * (l14_submit_policy_version_proposal_v1, l14_decide_policy_version_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The subject is the exact admitted tuple (policy id + version id + content hash); PostgreSQL
 *   verifies it against the S1B.3 admission lineage, including its source class.
 * - The TypeScript fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch).
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1B.4.
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

function toResult(data: unknown): L14PolicyVersionValidationCommandResult {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 POLICY_VERSION RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as L14PolicyVersionValidationCommandResult["commandKind"],
    subjectKind: row.subject_kind as "POLICY_VERSION",
    outcome: row.outcome as L14PolicyVersionValidationCommandResult["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<L14PolicyVersionValidationCommandResult["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<NonNullable<L14PolicyVersionValidationCommandResult["denyReason"]>>(row.deny_reason),
    proposalId: row.proposal_id as string,
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    policyId: row.policy_id as string,
    versionId: row.version_id as string,
    contentHash: row.content_hash as string,
    registryStateId: nullable<string>(row.registry_state_id),
    stateKind: nullable<NonNullable<L14PolicyVersionValidationCommandResult["stateKind"]>>(row.state_kind),
    effectiveFrom: nullable<string>(row.effective_from),
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<L14PolicyVersionValidationCommandResult> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface SubmitPolicyVersionProposalInput {
  readonly commandId: string;
  readonly proposal: L14PolicyVersionProposalContent;
  /** Correction link to an earlier proposal of the same exact tuple (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitPolicyVersionProposal(principal: GovernanceWritePrincipal, input: SubmitPolicyVersionProposalInput) {
  const fingerprint = submitPolicyVersionProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_policy_version_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_policy_id: input.proposal.policyId,
    p_version_id: input.proposal.versionId,
    p_content_hash: input.proposal.contentHash,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecidePolicyVersionProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14PolicyVersionProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the exact tuple); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decidePolicyVersionProposal(principal: GovernanceWritePrincipal, input: DecidePolicyVersionProposalInput) {
  const fingerprint = decidePolicyVersionProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_policy_version_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: policyVersionReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
