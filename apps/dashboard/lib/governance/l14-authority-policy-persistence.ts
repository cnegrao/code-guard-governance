import "server-only";
import {
  admitAuthorityPolicyVersionFingerprint, authorityPolicyReasonCode, decideProposalFingerprint, submitProposalFingerprint,
  type L14AuthorityPolicyProposalContent,
} from "@council/governance-review";
import type {
  L14AuthorityPolicyRule, L14CommandResult, L14GovernanceOutcome, L14SourceClass, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1A.1 server-only persistence adapter for the three L14 Authority Policy RPCs.
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim
 *   (credentialEpoch is never round-tripped through a JS Date). No JWT role/email is sent.
 * - The TypeScript fingerprint is an assertion: PostgreSQL recomputes it and rejects a mismatch
 *   (GV008). PostgreSQL remains the sole authority for hashes, authorization and state.
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE
 *   (GV001-GV005, GV007-GV010, 55P03, ...) for future route mapping. A DENY is not an error:
 *   it is a durable result returned with outcome DENIED.
 * - No HTTP route consumes this adapter in S1A.1.
 */

type Row = Record<string, unknown>;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});

const ruleTransport = (rule: L14AuthorityPolicyRule) => ({
  roleId: rule.roleId, permission: rule.permission, requestedAction: rule.requestedAction,
  sourceClass: rule.sourceClass, sourceDisposition: rule.sourceDisposition, scopeTag: rule.scopeTag,
  scopeCanonicalKind: rule.scopeCanonicalKind, scopeCanonicalObjectId: rule.scopeCanonicalObjectId,
  scopeRelationshipType: rule.scopeRelationshipType, scopeRelationshipId: rule.scopeRelationshipId,
  scopeRelationshipStateId: rule.scopeRelationshipStateId, allowSelfValidation: rule.allowSelfValidation,
  allowFutureDating: rule.allowFutureDating, allowBackdating: rule.allowBackdating,
});

function toResult(data: unknown): L14CommandResult {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as L14CommandResult["commandKind"],
    outcome: row.outcome as L14CommandResult["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: (row.authorization_decision_id ?? null) as string | null,
    authorizationResult: (row.authorization_result ?? null) as L14CommandResult["authorizationResult"],
    denyReason: (row.deny_reason ?? null) as L14CommandResult["denyReason"],
    proposalId: (row.proposal_id ?? null) as string | null,
    governanceDecisionId: (row.governance_decision_id ?? null) as string | null,
    authorityPolicyId: (row.authority_policy_id ?? null) as string | null,
    versionId: (row.version_id ?? null) as string | null,
    contentHash: (row.content_hash ?? null) as string | null,
    stateId: (row.state_id ?? null) as string | null,
    effectiveFrom: (row.effective_from ?? null) as string | null,
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<L14CommandResult> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface AdmitAuthorityPolicyVersionInput {
  readonly commandId: string;
  /** null = explicit expected-none (the first organisation-local Authority Policy). */
  readonly expected: { readonly authorityPolicyId: string; readonly latestVersionId: string } | null;
  readonly sourceClass: L14SourceClass;
  readonly rules: readonly L14AuthorityPolicyRule[];
  readonly support: L14Support;
}

export function admitAuthorityPolicyVersion(principal: GovernanceWritePrincipal, input: AdmitAuthorityPolicyVersionInput) {
  const fingerprint = admitAuthorityPolicyVersionFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, expected: input.expected,
    sourceClass: input.sourceClass, rules: input.rules, support: input.support,
  });
  return call("l14_admit_authority_policy_version_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_expected_authority_policy_id: input.expected?.authorityPolicyId ?? null,
    p_expected_latest_version_id: input.expected?.latestVersionId ?? null,
    p_source_class: input.sourceClass,
    p_rules: input.rules.map(ruleTransport),
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface SubmitAuthorityPolicyProposalInput {
  readonly commandId: string;
  readonly proposal: L14AuthorityPolicyProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitAuthorityPolicyProposal(principal: GovernanceWritePrincipal, input: SubmitAuthorityPolicyProposalInput) {
  const fingerprint = submitProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_subject_kind: input.proposal.subjectKind,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_authority_policy_id: input.proposal.authorityPolicyId,
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

export interface DecideAuthorityPolicyProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14AuthorityPolicyProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideAuthorityPolicyProposal(principal: GovernanceWritePrincipal, input: DecideAuthorityPolicyProposalInput) {
  const fingerprint = decideProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_authority_policy_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: authorityPolicyReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
