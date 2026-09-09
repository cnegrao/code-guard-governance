import { createHash } from "node:crypto";
import type { SemanticContentFingerprint } from "@council/canonical-contracts";
import type { SemanticContentProjection } from "../../src/semantic/content-projection";
import type { EmbeddingProviderPort, EmbeddingResult } from "../../src/semantic/embedding-provider";

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
