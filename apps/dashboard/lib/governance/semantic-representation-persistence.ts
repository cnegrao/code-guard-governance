import "server-only";

import type {
  SemanticRepresentationPersistencePort,
  SemanticRepresentationRecordInput,
  SemanticRepresentationRecordResult,
} from "@council/governance-review";

import { privilegedDb } from "./persistence";

/**
 * Semantic Intelligence Foundation V1 (roadmap milestone 4, L6/L7) —
 * server-only Supabase adapter. Mirrors
 * agent-version-technical-profile-persistence.ts: the sole caller of the
 * privileged gov_repo.record_semantic_representation RPC, SECURITY INVOKER
 * and service_role-only, reusing the same privileged client. Unlike the
 * technical-profile adapter, there is no separate materialize step — a
 * SemanticRepresentation carries zero canonical authority, so recording it
 * is the entire lifecycle.
 */

interface RecordRow {
  replay: boolean;
  representation_id: string;
}

export const semanticRepresentationPersistence: SemanticRepresentationPersistencePort = {
  async recordSemanticRepresentation(
    input: SemanticRepresentationRecordInput,
  ): Promise<SemanticRepresentationRecordResult> {
    const subject = input.subject;
    const { data, error } = await privilegedDb.rpc("record_semantic_representation", {
      p_organisation_id: input.organisationId,
      p_representation_id: input.representationId,
      p_subject_kind: subject.subjectKind,
      p_subject_canonical_object_id: subject.subjectKind === "CANONICAL_OBJECT" ? subject.canonicalObjectId : null,
      p_subject_canonical_object_kind: subject.subjectKind === "CANONICAL_OBJECT" ? subject.canonicalObjectKind : null,
      p_subject_candidate_id: subject.subjectKind === "NORMALIZED_CANDIDATE" ? subject.candidateId : null,
      p_subject_candidate_kind: subject.subjectKind === "NORMALIZED_CANDIDATE" ? subject.candidateKind : null,
      p_projection_schema_version: input.projectionSchemaVersion,
      p_content_fingerprint_algorithm: input.contentFingerprintAlgorithm,
      p_content_fingerprint_schema_version: input.contentFingerprintSchemaVersion,
      p_content_fingerprint_value: input.contentFingerprintValue,
      p_embedding_provider_id: input.embeddingProvider.providerId,
      p_embedding_model_id: input.embeddingProvider.modelId,
      p_embedding_model_version: input.embeddingProvider.modelVersion,
      p_embedding_dimension: input.embeddingProvider.dimension,
      p_embedding: [...input.vector],
      p_assertion_ids: [...input.support.assertionIds],
      p_evidence_ids: [...input.support.evidenceIds],
      p_generated_at: input.generatedAt,
    });
    if (error) throw new Error(`record_semantic_representation failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as RecordRow;

    return { replay: row.replay, representationId: row.representation_id };
  },
};
