import "server-only";
import {
  admitMethodologyVersionFingerprint, admitScenarioVersionFingerprint, decideRegistryProposalFingerprint,
  l15RegistryReasonCode, methodologyContentHash, scenarioContentHash, submitRegistryProposalFingerprint,
  validityMaximumInterval,
} from "@council/governance-review";
import type {
  L14GovernanceOutcome, L15MethodologyVersionContent, L15RegistryAdmitExpectation, L15RegistryCommandResult,
  L15RegistryProposalContent, L15RegistrySourceClass, L15RegistrySupport, L15ScenarioDefinitionVersionContent,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M17-S2 server-only persistence adapter for the six L15 registry RPCs (RISK_SCENARIO_DEFINITION / RISK_METHODOLOGY:
 * l15_admit_{scenario,methodology}_version_v1, l15_submit_{scenario,methodology}_proposal_v1,
 * l15_decide_{scenario,methodology}_proposal_v1).
 *
 * - Identity / session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim; PostgreSQL re-derives the
 *   verified ACTIVE human, current roles and the effective Authority Policy in-RPC. service_role is transport, not authority.
 * - Identity and version ids are opaque caller-supplied UUIDs passed verbatim; nothing is derived from a code, domain,
 *   scanner rule, CG-AG id or label.
 * - Content hashes and fingerprints are assertions (preflight UX): PostgreSQL recomputes them (GV010 / GV008 on mismatch).
 * - SYSTEM_SEED is provenance only and stays human-mediated; nothing here can validate or authorize anything.
 * - A DENY is a durable result (outcome DENIED), never an error. No HTTP route or UI consumes this adapter in S2.
 */

type Row = Record<string, unknown>;
type Result = L15RegistryCommandResult;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});
const nullable = <T>(value: unknown) => (value ?? null) as T | null;

function toResult(data: unknown, identityColumn: string, versionColumn: string): Result {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L15 registry RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as Result["commandKind"],
    subjectKind: row.subject_kind as Result["subjectKind"],
    outcome: row.outcome as Result["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: nullable<string>(row.authorization_decision_id),
    authorizationResult: nullable<NonNullable<Result["authorizationResult"]>>(row.authorization_result),
    denyReason: nullable<string>(row.deny_reason),
    attemptedContentHash: nullable<string>(row.attempted_content_hash),
    expectationKind: nullable<NonNullable<Result["expectationKind"]>>(row.expectation_kind),
    expectedLatestVersionId: nullable<string>(row.expected_latest_version_id),
    expectedCurrentStateId: nullable<string>(row.expected_current_state_id),
    proposalId: nullable<string>(row.proposal_id),
    governanceDecisionId: nullable<string>(row.governance_decision_id),
    identityId: nullable<string>(row[identityColumn]),
    versionId: nullable<string>(row[versionColumn]),
    predecessorVersionId: nullable<string>(row.predecessor_version_id),
    contentHash: nullable<string>(row.content_hash),
    stateId: nullable<string>(row.state_id),
    stateKind: nullable<NonNullable<Result["stateKind"]>>(row.state_kind),
    effectiveFrom: nullable<string>(row.effective_from),
    recordedAt: row.recorded_at as string,
  });
}

const REGISTRY = {
  RISK_SCENARIO_DEFINITION: { short: "scenario", identity: "scenario_definition_id", version: "scenario_definition_version_id" },
  RISK_METHODOLOGY: { short: "methodology", identity: "methodology_id", version: "methodology_version_id" },
} as const;

async function call(subjectKind: keyof typeof REGISTRY, name: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return toResult(data, REGISTRY[subjectKind].identity, REGISTRY[subjectKind].version);
}

interface AdmitBase {
  readonly commandId: string;
  readonly identityId: string;
  readonly versionId: string;
  /** EXPECTED_NONE = root version (creates the stable identity); EXPECTED_CURRENT = the exact latest admitted version. */
  readonly expectation: L15RegistryAdmitExpectation;
  readonly sourceClass: L15RegistrySourceClass;
}

const admitArgs = (principal: GovernanceWritePrincipal, input: AdmitBase, identity: string, version: string) => ({
  ...principalArgs(principal),
  p_command_id: input.commandId,
  [`p_${identity}`]: input.identityId,
  [`p_${version}`]: input.versionId,
  p_expectation_kind: input.expectation.kind,
  p_expected_latest_version_id: input.expectation.kind === "EXPECTED_CURRENT" ? input.expectation.latestVersionId : null,
  p_source_class: input.sourceClass,
});

export interface AdmitScenarioVersionInput extends AdmitBase { readonly content: L15ScenarioDefinitionVersionContent }

export async function admitScenarioDefinitionVersion(principal: GovernanceWritePrincipal, input: AdmitScenarioVersionInput) {
  const fingerprint = admitScenarioVersionFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    identityId: input.identityId, versionId: input.versionId, expectation: input.expectation, sourceClass: input.sourceClass,
    content: input.content });
  return call("RISK_SCENARIO_DEFINITION", "l15_admit_scenario_version_v1", {
    ...admitArgs(principal, input, "scenario_definition_id", "scenario_definition_version_id"),
    p_risk_domain: input.content.riskDomain,
    p_subject_kinds: [...input.content.subjectKinds],
    p_reference_namespaces: input.content.references.map(r => r.namespace),
    p_reference_codes: input.content.references.map(r => r.code),
    p_content_hash: scenarioContentHash(input.content),
    p_caller_fingerprint: fingerprint,
  });
}

export interface AdmitMethodologyVersionInput extends AdmitBase { readonly content: L15MethodologyVersionContent }

export async function admitMethodologyVersion(principal: GovernanceWritePrincipal, input: AdmitMethodologyVersionInput) {
  const fingerprint = admitMethodologyVersionFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    identityId: input.identityId, versionId: input.versionId, expectation: input.expectation, sourceClass: input.sourceClass,
    content: input.content });
  const c = input.content;
  return call("RISK_METHODOLOGY", "l15_admit_methodology_version_v1", {
    ...admitArgs(principal, input, "methodology_id", "methodology_version_id"),
    p_likelihood_level_codes: c.likelihoodScale.map(l => l.levelCode),
    p_likelihood_ordinals: c.likelihoodScale.map(l => l.ordinal),
    p_likelihood_definition_namespaces: c.likelihoodScale.map(l => l.definition.namespace),
    p_likelihood_definition_codes: c.likelihoodScale.map(l => l.definition.code),
    p_impact_level_codes: c.impactScale.map(l => l.levelCode),
    p_impact_ordinals: c.impactScale.map(l => l.ordinal),
    p_impact_definition_namespaces: c.impactScale.map(l => l.definition.namespace),
    p_impact_definition_codes: c.impactScale.map(l => l.definition.code),
    p_matrix_likelihood_level_codes: c.ratingMatrix.map(m => m.likelihoodLevelCode),
    p_matrix_impact_level_codes: c.ratingMatrix.map(m => m.impactLevelCode),
    p_matrix_rating_bands: c.ratingMatrix.map(m => m.ratingBand),
    p_assessment_validity_maximum: validityMaximumInterval(c.assessmentValidityMaximum),
    p_content_hash: methodologyContentHash(c),
    p_caller_fingerprint: fingerprint,
  });
}

const supportArgs = (support: L15RegistrySupport) => ({
  p_support_status: support.status,
  p_support_tags: support.entries.map(e => e.tag),
  p_support_target_ids: support.entries.map(e => e.targetId),
});

export interface SubmitRegistryProposalInput {
  readonly commandId: string;
  /** Pins the exact admitted (identity, version, content hash) tuple; subjectKind selects the registry. */
  readonly proposal: L15RegistryProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L15RegistrySupport;
}

export async function submitRegistryProposal(principal: GovernanceWritePrincipal, input: SubmitRegistryProposalInput) {
  const registry = REGISTRY[input.proposal.subjectKind];
  const fingerprint = submitRegistryProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    proposal: input.proposal, priorProposalId: input.priorProposalId, support: input.support });
  return call(input.proposal.subjectKind, `l15_submit_${registry.short}_proposal_v1`, {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_intent: input.proposal.intent,
    p_source_class: input.proposal.sourceClass,
    [`p_${registry.identity}`]: input.proposal.identityId,
    [`p_${registry.version}`]: input.proposal.versionId,
    p_content_hash: input.proposal.contentHash,
    p_requested_effective_from: input.proposal.requestedEffectiveFrom,
    p_target_state_id: input.proposal.targetStateId,
    p_prior_proposal_id: input.priorProposalId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}

export interface DecideRegistryProposalInput {
  readonly commandId: string;
  readonly proposalId: string;
  readonly proposal: L15RegistryProposalContent;
  readonly outcome: L14GovernanceOutcome;
  /** null = explicit expected-none (first VALIDATE of the exact tuple); otherwise the exact lineage tail. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15RegistrySupport;
}

export async function decideRegistryProposal(principal: GovernanceWritePrincipal, input: DecideRegistryProposalInput) {
  const registry = REGISTRY[input.proposal.subjectKind];
  const fingerprint = decideRegistryProposalFingerprint({ organisationId: principal.organisationId, actorUserId: principal.actorUserId,
    outcome: input.outcome, proposalId: input.proposalId, proposal: input.proposal,
    expectedCurrentStateId: input.expectedCurrentStateId, support: input.support });
  return call(input.proposal.subjectKind, `l15_decide_${registry.short}_proposal_v1`, {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_reason_code: l15RegistryReasonCode(input.proposal.subjectKind, input.outcome),
    p_expected_current_state_id: input.expectedCurrentStateId,
    ...supportArgs(input.support),
    p_caller_fingerprint: fingerprint,
  });
}
