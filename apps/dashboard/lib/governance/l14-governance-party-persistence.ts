import "server-only";
import {
  admitGovernancePartyFingerprint, decideGovernancePartyProposalFingerprint, governancePartyReasonCode,
  submitGovernancePartyProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L14GovernancePartyCommandResult, L14GovernancePartyKind, L14GovernancePartyProposalContent,
  L14SourceClass, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1B.1 server-only persistence adapter for the three GovernanceParty RPCs.
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No JWT role/email is sent.
 * - The caller never supplies a governance_party_id to ADMIT: PostgreSQL mints it and the durable
 *   result returns it (a replay returns the SAME id).
 * - No PII is ever sent: the directory/profile surface has no RPC and no application access.
 * - The TypeScript fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch).
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route consumes this adapter in S1B.1.
 */

type Row = Record<string, unknown>;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});

function toResult(data: unknown): L14GovernancePartyCommandResult {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 GovernanceParty RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as L14GovernancePartyCommandResult["commandKind"],
    subjectKind: row.subject_kind as "GOVERNANCE_PARTY",
    outcome: row.outcome as L14GovernancePartyCommandResult["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: (row.authorization_decision_id ?? null) as string | null,
    authorizationResult: (row.authorization_result ?? null) as L14GovernancePartyCommandResult["authorizationResult"],
    denyReason: (row.deny_reason ?? null) as L14GovernancePartyCommandResult["denyReason"],
    proposalId: (row.proposal_id ?? null) as string | null,
    governanceDecisionId: (row.governance_decision_id ?? null) as string | null,
    governancePartyId: (row.governance_party_id ?? null) as string | null,
    partyKind: (row.party_kind ?? null) as L14GovernancePartyCommandResult["partyKind"],
    registryStateId: (row.registry_state_id ?? null) as string | null,
    stateKind: (row.state_kind ?? null) as L14GovernancePartyCommandResult["stateKind"],
    effectiveFrom: (row.effective_from ?? null) as string | null,
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<L14GovernancePartyCommandResult> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface AdmitGovernancePartyInput {
  readonly commandId: string;
  readonly partyKind: L14GovernancePartyKind;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export function admitGovernanceParty(principal: GovernanceWritePrincipal, input: AdmitGovernancePartyInput) {
  const fingerprint = admitGovernancePartyFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, partyKind: input.partyKind,
    sourceClass: input.sourceClass, support: input.support,
  });
  return call("l14_admit_governance_party_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_expectation_kind: "EXPECTED_NONE",
    p_party_kind: input.partyKind,
    p_source_class: input.sourceClass,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface SubmitGovernancePartyProposalInput {
  readonly commandId: string;
  readonly proposal: L14GovernancePartyProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitGovernancePartyProposal(principal: GovernanceWritePrincipal, input: SubmitGovernancePartyProposalInput) {
  const fingerprint = submitGovernancePartyProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_governance_party_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_governance_party_id: input.proposal.governancePartyId,
    p_party_kind: input.proposal.partyKind,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideGovernancePartyProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14GovernancePartyProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the Party). */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideGovernancePartyProposal(principal: GovernanceWritePrincipal, input: DecideGovernancePartyProposalInput) {
  const fingerprint = decideGovernancePartyProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_governance_party_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: governancePartyReasonCode(input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
