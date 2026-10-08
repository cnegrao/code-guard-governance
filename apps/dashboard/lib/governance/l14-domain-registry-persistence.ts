import "server-only";
import {
  admitDomainFingerprint, decideDomainProposalFingerprint, domainReasonCode, submitDomainProposalFingerprint,
} from "@council/governance-review";
import type {
  L14DomainCommandResult, L14DomainProposalContent, L14DomainSubject, L14GovernanceOutcome, L14SourceClass, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1B.5 server-only persistence adapter for the three BUSINESS_DOMAIN / INFORMATION_DOMAIN registry RPCs
 * (l14_admit_domain_v1, l14_submit_domain_proposal_v1, l14_decide_domain_proposal_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The subject is the existing L6 domain identity (kind + id, verbatim): no id is minted, no label is sent.
 * - The TypeScript fingerprint is an assertion: PostgreSQL recomputes it (GV008 on mismatch).
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - No HTTP route or UI consumes this adapter in S1B.5.
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

function toResult(data: unknown): L14DomainCommandResult {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 domain registry RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as L14DomainCommandResult["commandKind"],
    subjectKind: row.subject_kind as L14DomainCommandResult["subjectKind"],
    outcome: row.outcome as L14DomainCommandResult["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<L14DomainCommandResult["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<NonNullable<L14DomainCommandResult["denyReason"]>>(row.deny_reason),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    domainId: nullable<string>(row.domain_id),
    registryStateId: nullable<string>(row.registry_state_id),
    stateKind: nullable<NonNullable<L14DomainCommandResult["stateKind"]>>(row.state_kind),
    effectiveFrom: nullable<string>(row.effective_from),
    recordedAt: row.recorded_at as string,
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<L14DomainCommandResult> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data);
}

export interface AdmitDomainInput {
  readonly commandId: string;
  /** The existing L6 identity (kind + id) admitted into the tenant registry. */
  readonly subject: L14DomainSubject;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export async function admitDomain(principal: GovernanceWritePrincipal, input: AdmitDomainInput) {
  const fingerprint = admitDomainFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, subjectKind: input.subject.subjectKind,
    domainId: input.subject.domainId, sourceClass: input.sourceClass, support: input.support,
  });
  return call("l14_admit_domain_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_expectation_kind: "EXPECTED_NONE",
    p_subject_kind: input.subject.subjectKind,
    p_domain_id: input.subject.domainId,
    p_source_class: input.sourceClass,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface SubmitDomainProposalInput {
  readonly commandId: string;
  readonly proposal: L14DomainProposalContent;
  /** Correction link to an earlier proposal of the same exact domain (required after a terminal decision). */
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export async function submitDomainProposal(principal: GovernanceWritePrincipal, input: SubmitDomainProposalInput) {
  const fingerprint = submitDomainProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, proposal: input.proposal,
    priorProposalId: input.priorProposalId, support: input.support,
  });
  return call("l14_submit_domain_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    p_subject_kind: input.proposal.subjectKind,
    p_domain_id: input.proposal.domainId,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideDomainProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L14DomainProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the exact domain); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export async function decideDomainProposal(principal: GovernanceWritePrincipal, input: DecideDomainProposalInput) {
  const fingerprint = decideDomainProposalFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, outcome: input.outcome,
    proposalId: input.proposalId, proposal: input.proposal, expectedCurrentStateId: input.expectedCurrentStateId,
    support: input.support,
  });
  return call("l14_decide_domain_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: domainReasonCode(input.proposal.subjectKind, input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  });
}
