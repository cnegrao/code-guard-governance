import { createHash } from "node:crypto";

import {
  asSemanticRepresentationId,
  createSemanticRepresentation,
  semanticRepresentationSubjectKey,
  type SemanticRepresentation,
  type SemanticRepresentationSubjectReference,
  type SemanticRepresentationSupport,
} from "@council/canonical-contracts";

import {
  SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
  buildSemanticContentProjection,
  computeSemanticContentFingerprint,
  type SemanticContentProjectionInput,
} from "./content-projection";
import type { EmbeddingProviderPort } from "./embedding-provider";

export interface BuildSemanticRepresentationInput {
  readonly subject: SemanticRepresentationSubjectReference;
  readonly projection: SemanticContentProjectionInput;
  readonly provider: EmbeddingProviderPort;
  readonly support: SemanticRepresentationSupport;
  readonly generatedAt: string;
}

function canonicalizeParts(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/**
 * Builds one immutable SemanticRepresentation snapshot (roadmap milestone 4,
 * §7/§19). representationId is content-addressed — deterministic across
 * subject + projection schema version + content fingerprint + embedding
 * provider/model/version + dimension — so re-running generation with
 * unchanged inputs reproduces the identical id. Idempotent persistence
 * (same id -> replay, not a duplicate row) is the persistence layer's own
 * responsibility (see @council/governance-review's
 * SemanticRepresentationPersistencePort); this function only guarantees the
 * id itself is stable and that a genuinely changed input (different
 * content, model, provider, or dimension) always produces a different id.
 */
export async function buildSemanticRepresentation(
  input: BuildSemanticRepresentationInput,
): Promise<SemanticRepresentation> {
  const projection = buildSemanticContentProjection(input.projection);
  const contentFingerprint = computeSemanticContentFingerprint(projection);
  const { vector } = await input.provider.embed(projection, contentFingerprint);

  const representationId = asSemanticRepresentationId(
    canonicalizeParts([
      semanticRepresentationSubjectKey(input.subject),
      SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
      contentFingerprint.value,
      input.provider.providerId,
      input.provider.modelId,
      input.provider.modelVersion,
      String(input.provider.dimension),
    ]),
  );

  return createSemanticRepresentation({
    representationId,
    organisationId: input.subject.organisationId,
    subject: input.subject,
    projectionSchemaVersion: SEMANTIC_CONTENT_PROJECTION_SCHEMA_VERSION,
    contentFingerprint,
    embeddingProvider: {
      providerId: input.provider.providerId,
      modelId: input.provider.modelId,
      modelVersion: input.provider.modelVersion,
      dimension: input.provider.dimension,
    },
    vector,
    support: input.support,
    generatedAt: input.generatedAt,
  });
}
