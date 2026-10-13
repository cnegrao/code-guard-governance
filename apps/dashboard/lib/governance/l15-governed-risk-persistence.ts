import "server-only";
import {
  decideGovernedRiskProposalFingerprint, governedRiskReasonCode, submitGovernedRiskProposalFingerprint,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L15GovernedRiskClosureReason, L15GovernedRiskCommandResult, L15GovernedRiskProposalContent,
  L15GovernedRiskResolverRequest, L15GovernedRiskResolverResult, L15GovernedRiskSubject, L15GovernedRiskSupport,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M17-S3 server-only persistence adapter for the three GOVERNED_RISK RPCs (l15_submit_governed_risk_proposal_v1,
 * l15_decide_governed_risk_proposal_v1, l15_read_governed_risk_v1).
 *
 * - Identity / session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim; PostgreSQL re-derives the
 *   verified ACTIVE human, current roles and the effective Authority Policy in-RPC. service_role is transport, not authority.
 * - The caller never supplies a risk domain, score, likelihood, impact, rating, lifecycle, owner, title, description or
 *   rationale: no such argument exists. PostgreSQL derives the domain from the pinned scenario version and resolves the
 *   exact subject (relationship type of the exact triple) itself.
 * - Fingerprints are assertions (preflight UX): PostgreSQL recomputes them (GV008 on mismatch).
 * - A DENY is a durable result (outcome DENIED), never an error. No HTTP route or UI consumes this adapter in S3.
 */

type Row = Record<string, unknown>;
type Result = L15GovernedRiskCommandResult;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});
const nullable = <T>(value: unknown) => (value ?? null) as T | null;
const firstRow = (data: unknown) => (Array.isArray(data) ? data[0] : data) as Row | undefined;

const subjectArgs = (subject: L15GovernedRiskSubject) => ({
  p_subject_type: subject.subjectType,
  p_subject_canonical_kind: subject.subjectType === "CANONICAL_OBJECT" ? subject.canonicalKind : null,
  p_subject_canonical_object_id: subject.subjectType === "CANONICAL_OBJECT" ? subject.canonicalObjectId : null,
  p_subject_relationship_id: subject.subjectType === "RELATIONSHIP_STATE" ? subject.relationshipId : null,
  p_subject_relationship_state_id: subject.subjectType === "RELATIONSHIP_STATE" ? subject.relationshipStateId : null,
});

function subjectOf(row: Row): L15GovernedRiskSubject | null {
  if (row.subject_type === "CANONICAL_OBJECT") {
    return { subjectType: "CANONICAL_OBJECT", canonicalKind: row.subject_canonical_kind as never,
      canonicalObjectId: row.subject_canonical_object_id as string };
  }
  if (row.subject_type === "RELATIONSHIP_STATE") {
    return { subjectType: "RELATIONSHIP_STATE", relationshipId: row.subject_relationship_id as string,
      relationshipStateId: row.subject_relationship_state_id as string };
  }
  return null;
}

function toResult(data: unknown): Result {
  const row = firstRow(data);
  if (!row) throw new GovernedWriteError("GOVERNED_RISK RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as Result["commandKind"],
    subjectKind: "GOVERNED_RISK",
    outcome: row.outcome as Result["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<Result["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<string>(row.deny_reason),
    expectationKind: nullable<NonNullable<Result["expectationKind"]>>(row.expectation_kind),
    expectedCurrentStateId: nullable<string>(row.expected_current_state_id),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    subject: subjectOf(row),
    subjectRelationshipType: nullable<NonNullable<Result["subjectRelationshipType"]>>(row.subject_relationship_type),
    scenario: row.scenario_definition_id ? {
      scenarioDefinitionId: row.scenario_definition_id as string,
      scenarioDefinitionVersionId: row.scenario_definition_version_id as string,
      scenarioContentHash: row.scenario_content_hash as string,
    } : null,
    riskDomain: nullable<NonNullable<Result["riskDomain"]>>(row.risk_domain),
    closureReason: nullable<L15GovernedRiskClosureReason>(row.closure_reason),
    stateId: nullable<string>(row.state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    predecessorStateId: nullable<string>(row.predecessor_state_id),
    scenarioValidatedStateId: nullable<string>(row.scenario_validated_state_id),
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

const supportArgs = (support: L15GovernedRiskSupport) => ({
  p_support_status: support.status,
  p_support_tags: support.entries.map(e => e.tag),
  p_support_target_ids: support.entries.map(e => e.targetId),
});

export interface SubmitGovernedRiskProposalInput {
  readonly commandId: string;
  readonly proposal: L15GovernedRiskProposalContent;
  readonly priorProposalId: string | null;
  /** Hypotheses / signals / rank-0 evidence cited as provenance only (never authority). */
  readonly support: L15GovernedRiskSupport;
}

export async function submitGovernedRiskProposal(principal: GovernanceWritePrincipal, input: SubmitGovernedRiskProposalInput) {
  const p = input.proposal;
  const fingerprint = submitGovernedRiskProposalFingerprint({ organisationId: principal.organisationId,
    actorUserId: principal.actorUserId, proposal: p, priorProposalId: input.priorProposalId, support: input.support });
  return call("l15_submit_governed_risk_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: p.intent,
    p_source_class: p.sourceClass,
    ...subjectArgs(p.subject),
    p_scenario_definition_id: p.scenarioDefinitionId,
    p_scenario_definition_version_id: p.scenarioDefinitionVersionId,
    p_scenario_content_hash: p.scenarioContentHash,
    p_requested_effective_from: p.requestedEffectiveFrom,
    p_requested_effective_to: p.requestedEffectiveTo,
    p_expected_current_state_id: p.expectedCurrentStateId,
    p_target_state_id: p.targetStateId,
    p_closure_reason: p.closureReason,
    p_prior_proposal_id: input.priorProposalId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideGovernedRiskProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L15GovernedRiskProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** REVOKE only (must equal the proposal's); null for VALIDATE / REJECT / DEFER. */
  readonly closureReason: L15GovernedRiskClosureReason | null;
  /** null = explicit expected-none (first VALIDATE of the logical key); otherwise the exact head state. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15GovernedRiskSupport;
}

export async function decideGovernedRiskProposal(principal: GovernanceWritePrincipal, input: DecideGovernedRiskProposalInput) {
  const fingerprint = decideGovernedRiskProposalFingerprint({ organisationId: principal.organisationId,
    actorUserId: principal.actorUserId, outcome: input.outcome, proposalId: input.proposalId, proposal: input.proposal,
    closureReason: input.closureReason, expectedCurrentStateId: input.expectedCurrentStateId, support: input.support });
  return call("l15_decide_governed_risk_proposal_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: governedRiskReasonCode(input.outcome),
    p_closure_reason: input.closureReason,
    p_expected_current_state_id: input.expectedCurrentStateId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}

/** Exact bitemporal read of one logical key with its lineage pins and O44 support currency (read only). */
export async function readGovernedRisk(principal: GovernanceWritePrincipal, request: L15GovernedRiskResolverRequest):
  Promise<L15GovernedRiskResolverResult> {
  const { data, error } = await privilegedDb.rpc("l15_read_governed_risk_v1", {
    ...principalArgs(principal),
    ...subjectArgs(request.subject),
    p_scenario_definition_id: request.scenarioDefinitionId,
    p_effective_at: request.effectiveAt,
    p_recorded_cutoff: request.recordedCutoff,
  });
  if (error) throw new GovernedWriteError(`l15_read_governed_risk_v1 failed: ${error.message}`, error.code);
  const row = firstRow(data);
  if (!row) throw new GovernedWriteError("l15_read_governed_risk_v1 returned no row");
  return Object.freeze({
    resolution: row.resolution as L15GovernedRiskResolverResult["resolution"],
    effectiveAt: row.effective_at as string,
    recordedCutoff: row.recorded_cutoff as string,
    stateId: nullable<string>(row.state_id),
    stateKind: nullable<NonNullable<L15GovernedRiskResolverResult["stateKind"]>>(row.state_kind),
    riskDomain: nullable<NonNullable<L15GovernedRiskResolverResult["riskDomain"]>>(row.risk_domain),
    scenarioDefinitionVersionId: nullable<string>(row.scenario_definition_version_id),
    scenarioContentHash: nullable<string>(row.scenario_content_hash),
    scenarioValidatedStateId: nullable<string>(row.scenario_validated_state_id),
    predecessorStateId: nullable<string>(row.predecessor_state_id),
    revokesStateId: nullable<string>(row.revokes_state_id),
    closureReason: nullable<L15GovernedRiskClosureReason>(row.closure_reason),
    effectiveFrom: nullable<string>(row.effective_from),
    effectiveTo: nullable<string>(row.effective_to),
    recordedAt: nullable<string>(row.recorded_at),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorityPolicyId: nullable<string>(row.authority_policy_id),
    authorityPolicyVersionId: nullable<string>(row.authority_policy_version_id),
    authorityPolicyContentHash: nullable<string>(row.authority_policy_content_hash),
    sourceClass: nullable<NonNullable<L15GovernedRiskResolverResult["sourceClass"]>>(row.source_class),
    support: row.support_currency ? {
      supportCurrency: row.support_currency as never,
      supportLinkCount: Number(row.support_link_count),
      degradedLinkCount: Number(row.degraded_link_count),
      failingLinkId: nullable<string>(row.failing_link_id),
      failingReason: nullable<never>(row.failing_reason),
      failingUpstreamLinkId: nullable<string>(row.failing_upstream_link_id),
    } : null,
  });
}
