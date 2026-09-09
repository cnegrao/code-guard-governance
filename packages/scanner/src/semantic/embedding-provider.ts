import { createHash } from "node:crypto";

import type { SemanticContentFingerprint } from "@council/canonical-contracts";

import type { SemanticContentProjection } from "./content-projection";

export interface EmbeddingResult {
  readonly vector: readonly number[];
}

/**
 * Provider-independent embedding boundary (roadmap milestone 4, §11). No
 * production implementation is included by this milestone — no live
 * external embedding API call is authorized. Implementations must never
 * couple canonical contracts or callers to one vendor (OpenAI, Anthropic,
 * Google, Cohere, Voyage, Azure, Bedrock, Ollama, or any other) — this
 * interface is the only thing callers depend on.
 */
export interface EmbeddingProviderPort {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimension: number;
  embed(
    projection: SemanticContentProjection,
    contentFingerprint: SemanticContentFingerprint,
  ): Promise<EmbeddingResult>;
}

/**
 * TEST-ONLY deterministic embedding provider. It is NOT a real semantic
 * embedding model and MUST NEVER be presented as, or persisted as, a
 * production embedding — its vector is derived purely from the content
 * fingerprint's own hash bytes, carries zero real semantic meaning, and
 * exists only to prove the SemanticRepresentation pipeline end-to-end
 * without a live external API call (none is authorized by this milestone).
 */
export class TestOnlyDeterministicEmbeddingProvider implements EmbeddingProviderPort {
  readonly providerId = "TEST_ONLY_DETERMINISTIC";
  readonly modelId = "test-only-hash-embedding";
  readonly modelVersion = "v1";
  readonly dimension: number;

  constructor(dimension = 8) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new TypeError("TestOnlyDeterministicEmbeddingProvider dimension must be a positive integer");
    }
    this.dimension = dimension;
  }

  async embed(
    _projection: SemanticContentProjection,
    contentFingerprint: SemanticContentFingerprint,
  ): Promise<EmbeddingResult> {
    const digest = createHash("sha256").update(contentFingerprint.value).digest();
    const vector: number[] = [];
    for (let i = 0; i < this.dimension; i += 1) {
      const byte = digest[i % digest.length];
      vector.push((byte / 255) * 2 - 1);
    }
    return { vector: Object.freeze(vector) };
  }
}
