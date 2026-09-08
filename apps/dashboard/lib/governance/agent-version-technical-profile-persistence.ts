import "server-only";

import type {
  AgentVersionTechnicalProfileMaterializationInput,
  AgentVersionTechnicalProfileMaterializationResult,
  AgentVersionTechnicalProfilePersistencePort,
  AgentVersionTechnicalProfileProposalInput,
  AgentVersionTechnicalProfileProposalResult,
} from "@council/governance-review";

import { privilegedDb } from "./persistence";

/**
 * Technical Profile Persistence V1 (ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1)
 * — server-only Supabase adapter, first instance scoped to
 * AgentVersionTechnicalProfile only. Mirrors materialization.ts exactly:
 * the sole caller of the privileged gov_repo.record_agent_version_technical_profile_proposal
 * / gov_repo.materialize_agent_version_technical_profile RPCs, both SECURITY
 * INVOKER and service_role-only, reusing the same privileged client.
 */

interface ProposalRow {
  replay: boolean;
  proposal_id: string;
}

interface MaterializationRow {
  replay: boolean;
  status: "APPLIED";
  canonical_object_id: string;
}

export const agentVersionTechnicalProfilePersistence: AgentVersionTechnicalProfilePersistencePort = {
  async recordAgentVersionTechnicalProfileProposal(
    input: AgentVersionTechnicalProfileProposalInput,
  ): Promise<AgentVersionTechnicalProfileProposalResult> {
    const { data, error } = await privilegedDb.rpc("record_agent_version_technical_profile_proposal", {
      p_organisation_id: input.organisationId,
      p_proposal_id: input.proposalId,
      p_agent_version_candidate_id: input.agentVersionCandidateId,
      p_behavior_fingerprint_algorithm: input.behaviorFingerprintAlgorithm,
      p_behavior_fingerprint_schema_version: input.behaviorFingerprintSchemaVersion,
      p_behavior_fingerprint_value: input.behaviorFingerprintValue,
      p_build_reference: input.buildReference ?? null,
      p_runtime_framework_reference: input.runtimeFrameworkReference ?? null,
      p_entrypoint_reference: input.entrypointReference ?? null,
      p_configuration_reference: input.configurationReference ?? null,
      p_behavior_fingerprint_assertion_ids: [...input.support.behaviorFingerprint.assertionIds],
      p_behavior_fingerprint_evidence_ids: [...input.support.behaviorFingerprint.evidenceIds],
      p_build_reference_assertion_ids: [...input.support.buildReference.assertionIds],
      p_build_reference_evidence_ids: [...input.support.buildReference.evidenceIds],
      p_runtime_framework_reference_assertion_ids: [...input.support.runtimeFrameworkReference.assertionIds],
      p_runtime_framework_reference_evidence_ids: [...input.support.runtimeFrameworkReference.evidenceIds],
      p_entrypoint_reference_assertion_ids: [...input.support.entrypointReference.assertionIds],
      p_entrypoint_reference_evidence_ids: [...input.support.entrypointReference.evidenceIds],
      p_configuration_reference_assertion_ids: [...input.support.configurationReference.assertionIds],
      p_configuration_reference_evidence_ids: [...input.support.configurationReference.evidenceIds],
      p_contract_version: input.contractVersion,
    });
    if (error) throw new Error(`record_agent_version_technical_profile_proposal failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as ProposalRow;

    return { replay: row.replay, proposalId: row.proposal_id };
  },

  async materializeAgentVersionTechnicalProfile(
    input: AgentVersionTechnicalProfileMaterializationInput,
  ): Promise<AgentVersionTechnicalProfileMaterializationResult> {
    const { data, error } = await privilegedDb.rpc("materialize_agent_version_technical_profile", {
      p_organisation_id: input.organisationId,
      p_canonical_object_id: input.canonicalObjectId,
      p_proposal_id: input.proposalId,
      p_occurred_at: input.occurredAt,
    });
    if (error) throw new Error(`materialize_agent_version_technical_profile failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as MaterializationRow;

    return {
      replay: row.replay,
      status: row.status,
      canonicalObjectId: row.canonical_object_id,
    };
  },
};
