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
