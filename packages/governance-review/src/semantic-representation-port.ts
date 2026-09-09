import type {
  EmbeddingProviderMetadata,
  OrganisationId,
  SemanticRepresentationSubjectReference,
  SemanticRepresentationSupport,
} from "@council/canonical-contracts";

/**
 * Semantic Intelligence Foundation V1 (roadmap milestone 4, L6/L7).
 *
 * Narrow persistence boundary (Port/Repository pattern), the same shape as
 * AgentVersionTechnicalProfilePersistencePort: this package never
 * implements durable storage itself, never talks to Supabase/Postgres
 * directly. A trusted server-only adapter (see apps/dashboard) implements
 * this interface.
 *
 * Unlike AgentVersionTechnicalProfile, a SemanticRepresentation carries
 * ZERO canonical authority and is never enriched in place — it is a single,
 * immutable, content-addressed snapshot. There is therefore no separate
 * proposal/materialize governance gate here: recording a representation
 * never creates, mutates, certifies, or reconciles anything. The only
 * requirement enforced by the persistence layer is that the subject
 * (an already-durable canonical object or normalized candidate) actually
 * exists in this organisation before the row is written.
 *
 * SEMANTIC REPRESENTATION != CANONICAL IDENTITY. VECTOR SCORE != CANONICAL
 * MERGE AUTHORITY. Recording a representation never invokes reconciliation
 * or materialization of any kind.
 */
export interface SemanticRepresentationRecordInput {
  readonly organisationId: OrganisationId;
  /** Content-addressed by the caller: identical inputs always reproduce the identical id, so a reused id always replays. */
  readonly representationId: string;
  readonly subject: SemanticRepresentationSubjectReference;
  readonly projectionSchemaVersion: string;
  readonly contentFingerprintAlgorithm: string;
  readonly contentFingerprintSchemaVersion: string;
  readonly contentFingerprintValue: string;
  readonly embeddingProvider: EmbeddingProviderMetadata;
  readonly vector: readonly number[];
  readonly support: SemanticRepresentationSupport;
  readonly generatedAt: string;
}

export interface SemanticRepresentationRecordResult {
  readonly replay: boolean;
  readonly representationId: string;
}

export interface SemanticRepresentationPersistencePort {
  /**
   * Durably persists one immutable SemanticRepresentation snapshot plus its
   * assertion/evidence support. Verifies the referenced subject
   * (CanonicalObject or NormalizedCandidate) exists in this organisation
   * before writing; never creates, mutates, certifies, or reconciles a
   * canonical object or relationship of any kind. Idempotent on
   * representationId: a reused id whose stored content matches the new call
   * replays; a reused id with different content fails closed rather than
   * silently discarding either value.
   */
  recordSemanticRepresentation(
    input: SemanticRepresentationRecordInput,
  ): Promise<SemanticRepresentationRecordResult>;
}
