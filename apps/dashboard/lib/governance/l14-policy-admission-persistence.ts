import "server-only";
import { admitGovernancePolicyFingerprint, admitPolicyVersionFingerprint, policyVersionContentHash } from "@council/governance-review";
import type {
  L14GovernancePolicyDescriptor, L14PolicyAdmissionCommandResult, L14PolicyDescriptor, L14SourceClass, L14Support,
} from "@council/canonical-contracts";
import { privilegedDb } from "./persistence";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";
import { GovernedWriteError } from "./governed-write-errors";

/**
 * M16-S1B.3 server-only persistence adapter for the three policy content admission RPCs
 * (l14_admit_governance_policy_v1, l14_admit_policy_version_v1, l14_read_policy_descriptors_v1).
 *
 * - Identity/session authority is ONLY the five GovernanceWritePrincipal values, passed verbatim.
 *   No organisation, actor, role or email is ever taken from the caller's input.
 * - The caller never supplies a policy_id to an identity ADMIT, nor a version_id / number / label,
 *   an owner or a change_summary to a version ADMIT: PostgreSQL mints / writes them.
 * - The TypeScript content hash and fingerprint are assertions: PostgreSQL recomputes both
 *   (GV010 CONTENT_HASH_MISMATCH / GV008 on mismatch).
 * - Every DB failure is rethrown as GovernedWriteError carrying the exact SQLSTATE. A DENY is a
 *   durable result returned with outcome DENIED, never an error.
 * - The descriptor read returns admitted descriptors only (never a content body) with the CURRENT governed
 *   POLICY_VERSION validation condition (S1B.4: NOT_VALIDATED | VALIDATED | REVOKED).
 * - No HTTP route consumes this adapter in S1B.3.
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

function toResult(data: unknown): L14PolicyAdmissionCommandResult {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new GovernedWriteError("L14 policy admission RPC returned no durable result");
  return Object.freeze({
    replay: row.replay as boolean,
    commandId: row.command_id as string,
    commandKind: row.command_kind as L14PolicyAdmissionCommandResult["commandKind"],
    subjectKind: row.subject_kind as "POLICY_VERSION",
    outcome: row.outcome as L14PolicyAdmissionCommandResult["outcome"],
    commandFingerprint: row.command_fingerprint as string,
    authorizationDecisionId: row.authorization_decision_id as string,
    authorizationResult: row.authorization_result as L14PolicyAdmissionCommandResult["authorizationResult"],
    denyReason: nullable<NonNullable<L14PolicyAdmissionCommandResult["denyReason"]>>(row.deny_reason),
    attemptedContentHash: row.attempted_content_hash as string,
    expectationKind: row.expectation_kind as L14PolicyAdmissionCommandResult["expectationKind"],
    expectedLatestVersionId: nullable<string>(row.expected_latest_version_id),
    policyId: nullable<string>(row.policy_id),
    versionId: nullable<string>(row.version_id),
    versionNumber: nullable<number>(row.version_number),
    versionLabel: nullable<string>(row.version_label),
    contentHash: nullable<string>(row.content_hash),
    recordedAt: row.recorded_at as string,
  });
}

function toDescriptor(row: Row): L14PolicyDescriptor {
  return Object.freeze({
    policyId: row.policy_id as string,
    policyCode: row.policy_code as string,
    title: row.title as string,
    policyType: row.policy_type as L14PolicyDescriptor["policyType"],
    policyAdmissionAuthorizationDecisionId: row.policy_admission_authorization_decision_id as string,
    policyRecordedAt: row.policy_recorded_at as string,
    versionId: nullable<string>(row.version_id),
    versionNumber: nullable<number>(row.version_number),
    versionLabel: nullable<string>(row.version_label),
    contentHash: nullable<string>(row.content_hash),
    versionAdmissionAuthorizationDecisionId: nullable<string>(row.version_admission_authorization_decision_id),
    versionRecordedAt: nullable<string>(row.version_recorded_at),
    validationState: row.validation_state as L14PolicyDescriptor["validationState"],
    validationStateId: nullable<string>(row.validation_state_id),
    validationEffectiveFrom: nullable<string>(row.validation_effective_from),
    latestValidationStateId: nullable<string>(row.latest_validation_state_id),
  });
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new GovernedWriteError(`${name} failed: ${error.message}`, error.code);
  return data;
}

export interface AdmitGovernancePolicyInput {
  readonly commandId: string;
  readonly descriptor: L14GovernancePolicyDescriptor;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export async function admitGovernancePolicy(principal: GovernanceWritePrincipal, input: AdmitGovernancePolicyInput) {
  const fingerprint = admitGovernancePolicyFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, descriptor: input.descriptor,
    sourceClass: input.sourceClass, support: input.support,
  });
  return toResult(await rpc("l14_admit_governance_policy_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_expectation_kind: "EXPECTED_NONE",
    p_policy_code: input.descriptor.policyCode,
    p_title: input.descriptor.title,
    p_policy_type: input.descriptor.policyType,
    p_source_class: input.sourceClass,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  }));
}

export interface AdmitPolicyVersionInput {
  readonly commandId: string;
  /** An M16-admitted policy of the principal's organisation (a legacy-only policy is rejected). */
  readonly policyId: string;
  /** null = expected-none (the first admitted version); otherwise the exact latest admitted version. */
  readonly expectedLatestVersionId: string | null;
  /** Exact content; hashed over its UTF-8 bytes with no normalization. */
  readonly contentMarkdown: string;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export async function admitPolicyVersion(principal: GovernanceWritePrincipal, input: AdmitPolicyVersionInput) {
  const contentHash = policyVersionContentHash(input.contentMarkdown);
  const fingerprint = admitPolicyVersionFingerprint({
    organisationId: principal.organisationId, actorUserId: principal.actorUserId, policyId: input.policyId,
    expectedLatestVersionId: input.expectedLatestVersionId, contentHash, sourceClass: input.sourceClass, support: input.support,
  });
  return toResult(await rpc("l14_admit_policy_version_v1", {
    ...principalArgs(principal),
    p_command_id: input.commandId,
    p_policy_id: input.policyId,
    p_expected_latest_version_id: input.expectedLatestVersionId,
    p_content_markdown: input.contentMarkdown,
    p_content_hash: contentHash,
    p_source_class: input.sourceClass,
    p_support_status: input.support.status,
    p_support_evidence_ids: [...input.support.evidenceIds],
    p_caller_fingerprint: fingerprint,
  }));
}

/** S1B2-I1 controlled descriptor read: the verified tenant's M16-admitted policies / versions only. */
export async function readPolicyDescriptors(principal: GovernanceWritePrincipal, input: { readonly policyId: string | null } = { policyId: null }) {
  const data = await rpc("l14_read_policy_descriptors_v1", { ...principalArgs(principal), p_policy_id: input.policyId });
  return Object.freeze((Array.isArray(data) ? data as Row[] : []).map(toDescriptor));
}
