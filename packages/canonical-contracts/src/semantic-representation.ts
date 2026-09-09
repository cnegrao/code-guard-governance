/**
 * Semantic Intelligence Foundation V1 (roadmap milestone 4, L6/L7).
 *
 * Pure contracts only, matching this package's own invariant (see
 * ./index.ts): no persistence, Supabase, crypto/hashing, embedding-provider
 * runtime, or scanner runtime. A SemanticRepresentation is DERIVED
 * ANALYTICAL STATE — never canonical identity, never a CanonicalObjectKind,
 * never governance authority. See GOVIA-L0L16-CIA-v1.0.md §1 (L7) and §7C.
 *
 * Frozen invariants this file exists to protect:
 *   SEMANTIC REPRESENTATION != CANONICAL IDENTITY
 *   VECTOR SCORE != CANONICAL MERGE AUTHORITY
 *   EMBEDDING IS NEVER CANONICAL OBJECT IDENTITY
 *   TENANT A REPRESENTATION != TENANT B REPRESENTATION
 */

import type { CanonicalObjectKind, DiscoveryCandidateKind } from "./contracts.ts";
import type {
  CanonicalObjectId,
  EvidenceId,
  NormalizedCandidateId,
  OrganisationId,
  SemanticRepresentationId,
  SourceAssertionId,
} from "./identifiers.ts";

/**
 * Closed subject family. A representation always attaches to an
 * already-durable identity — never a free-form path/display-name string.
 */
export const SEMANTIC_REPRESENTATION_SUBJECT_KIND = {
  CANONICAL_OBJECT: "CANONICAL_OBJECT",
  NORMALIZED_CANDIDATE: "NORMALIZED_CANDIDATE",
} as const;
export type SemanticRepresentationSubjectKind =
  (typeof SEMANTIC_REPRESENTATION_SUBJECT_KIND)[keyof typeof SEMANTIC_REPRESENTATION_SUBJECT_KIND];

/**
 * A canonical-object subject and a normalized-candidate subject are
 * deliberately distinct and never silently converted into one another: a
 * representation generated pre-reconciliation (candidate) is never migrated
 * to look like a post-reconciliation (canonical object) representation
 * merely because reconciliation later succeeds. A fresh representation may
 * always be generated for the canonical object once it exists.
 */
export type SemanticRepresentationSubjectReference =
  | {
      readonly subjectKind: "CANONICAL_OBJECT";
      readonly organisationId: OrganisationId;
      readonly canonicalObjectId: CanonicalObjectId;
      readonly canonicalObjectKind: CanonicalObjectKind;
    }
  | {
      readonly subjectKind: "NORMALIZED_CANDIDATE";
      readonly organisationId: OrganisationId;
      readonly candidateId: NormalizedCandidateId;
      readonly candidateKind: DiscoveryCandidateKind;
    };

/** Stable, deterministic key for a subject reference — for grouping/lookup only, never persisted as identity in place of the reference's own fields. */
export function semanticRepresentationSubjectKey(
  subject: SemanticRepresentationSubjectReference,
): string {
  return subject.subjectKind === "CANONICAL_OBJECT"
    ? JSON.stringify([
        "CANONICAL_OBJECT",
        subject.organisationId,
        subject.canonicalObjectId,
        subject.canonicalObjectKind,
      ])
    : JSON.stringify([
        "NORMALIZED_CANDIDATE",
        subject.organisationId,
        subject.candidateId,
        subject.candidateKind,
      ]);
}

declare const semanticContentFingerprintBrand: unique symbol;

/**
 * Content-integrity digest of the exact semantic-content projection used to
 * produce a representation. Deliberately provides no hashing algorithm of
 * its own (same idiom as BehaviorFingerprint/TechnicalFingerprint in
 * ./contracts.ts) — the scanner/generation layer computes `value`; this
 * package only types and validates the result. It never identifies a
 * technical configuration or canonical/runtime identity, credential, or raw
 * content.
 */
export type SemanticContentFingerprint = Readonly<{
  readonly algorithm: string;
  readonly schemaVersion: string;
  readonly value: string;
}> & {
  readonly [semanticContentFingerprintBrand]: "SemanticContentFingerprint";
};

export function createSemanticContentFingerprint(
  draft: Readonly<{
    readonly algorithm: string;
    readonly schemaVersion: string;
    readonly value: string;
  }>,
): SemanticContentFingerprint {
  for (const [field, value] of [
    ["algorithm", draft.algorithm],
    ["schemaVersion", draft.schemaVersion],
    ["value", draft.value],
  ] as const) {
    if (value.trim().length === 0) {
      throw new TypeError(`Semantic content fingerprint ${field} must be a non-empty string`);
    }
  }

  return Object.freeze({
    algorithm: draft.algorithm,
    schemaVersion: draft.schemaVersion,
    value: draft.value,
  }) as SemanticContentFingerprint;
}

/**
 * Provider-independent embedding boundary metadata. Never couples canonical
 * contracts to one vendor (OpenAI, Anthropic, Google, Cohere, Voyage,
 * Azure, Bedrock, Ollama, or any other).
 */
export interface EmbeddingProviderMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimension: number;
}

/** Provenance only, never a semantic value. At least one assertion or evidence id is required. */
export interface SemanticRepresentationSupport {
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
}

/**
 * DERIVED ANALYTICAL STATE. A SemanticRepresentation is never a
 * CanonicalObjectKind, never certified, never reconciled, and never confers
 * canonical authority of any kind. Similarity, clustering, and
 * possible-match decisioning over these representations belong to a later
 * milestone (L8) and are explicitly out of scope for this type.
 */
export interface SemanticRepresentation {
  readonly representationId: SemanticRepresentationId;
  readonly organisationId: OrganisationId;
  readonly subject: SemanticRepresentationSubjectReference;
  readonly projectionSchemaVersion: string;
  readonly contentFingerprint: SemanticContentFingerprint;
  readonly embeddingProvider: EmbeddingProviderMetadata;
  readonly vector: readonly number[];
  readonly support: SemanticRepresentationSupport;
  readonly generatedAt: string;
}

export class SemanticRepresentationDimensionMismatchError extends Error {
  constructor(declared: number, actual: number) {
    super(
      `Embedding vector length (${actual}) does not match declared provider dimension (${declared}); refusing to silently truncate or pad`,
    );
    this.name = "SemanticRepresentationDimensionMismatchError";
  }
}

/**
 * Validates and freezes a SemanticRepresentation draft. Fails closed on a
 * dimension mismatch (never truncates/pads) and on a non-finite vector
 * component. Performs no hashing, no I/O, no provider calls, and never
 * derives representationId itself — representationId is expected to be
 * content-addressed by the caller (same idiom as NormalizedCandidateId /
 * AgentVersionTechnicalProfile's proposalId elsewhere in this codebase).
 */
export function createSemanticRepresentation(
  draft: Readonly<{
    readonly representationId: SemanticRepresentationId;
    readonly organisationId: OrganisationId;
    readonly subject: SemanticRepresentationSubjectReference;
    readonly projectionSchemaVersion: string;
    readonly contentFingerprint: SemanticContentFingerprint;
    readonly embeddingProvider: EmbeddingProviderMetadata;
    readonly vector: readonly number[];
    readonly support: SemanticRepresentationSupport;
    readonly generatedAt: string;
  }>,
): SemanticRepresentation {
  if (draft.support.assertionIds.length === 0 && draft.support.evidenceIds.length === 0) {
    throw new TypeError("SEMANTIC_REPRESENTATION_SUPPORT_REQUIRED");
  }
  if (draft.organisationId !== draft.subject.organisationId) {
    throw new TypeError("SemanticRepresentation organisationId must match its subject's organisationId");
  }
  if (draft.projectionSchemaVersion.trim().length === 0) {
    throw new TypeError("SemanticRepresentation projectionSchemaVersion must be a non-empty string");
  }
  if (!Number.isInteger(draft.embeddingProvider.dimension) || draft.embeddingProvider.dimension <= 0) {
    throw new TypeError("SemanticRepresentation embeddingProvider.dimension must be a positive integer");
  }
  if (draft.vector.length !== draft.embeddingProvider.dimension) {
    throw new SemanticRepresentationDimensionMismatchError(draft.embeddingProvider.dimension, draft.vector.length);
  }
  for (const component of draft.vector) {
    if (!Number.isFinite(component)) {
      throw new TypeError("SemanticRepresentation vector must contain only finite numbers");
    }
  }

  return Object.freeze({
    representationId: draft.representationId,
    organisationId: draft.organisationId,
    subject: draft.subject,
    projectionSchemaVersion: draft.projectionSchemaVersion,
    contentFingerprint: draft.contentFingerprint,
    embeddingProvider: Object.freeze({ ...draft.embeddingProvider }),
    vector: Object.freeze([...draft.vector]),
    support: Object.freeze({
      assertionIds: Object.freeze([...draft.support.assertionIds]),
      evidenceIds: Object.freeze([...draft.support.evidenceIds]),
    }),
    generatedAt: draft.generatedAt,
  });
}
