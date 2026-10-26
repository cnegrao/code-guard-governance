import "server-only";
import type { SemanticSpace } from "./semantic-context-retrieval";

export const OPERATIONAL_QUERY_RECIPE = "OPERATIONAL_CONTEXT_QUERY_V1" as const;
export const OPERATIONAL_DOCUMENT_RECIPE = "GOVIA_OPERATIONAL_CONTEXT_V1" as const;
export const OPERATIONAL_QUERY_SEMANTICS = "RAW_QUESTION_UNCHANGED_V1" as const;
declare const operationalQuery: unique symbol;
const admitted = new WeakSet<object>();

export interface OperationalQueryEmbeddingIdentity {
  readonly [operationalQuery]: true;
  readonly space: SemanticSpace;
  readonly query_recipe: typeof OPERATIONAL_QUERY_RECIPE;
  readonly vector: readonly number[];
}
export interface OperationalQueryEmbeddingProviderPort {
  embedQuestion(question: string, signal: AbortSignal): Promise<{
    space: SemanticSpace; query_recipe: string; vector: readonly number[];
  }>;
}
export interface OperationalQueryEmbeddingConfiguration {
  readonly space: SemanticSpace;
  readonly document_recipe: typeof OPERATIONAL_DOCUMENT_RECIPE;
  readonly query_recipe: typeof OPERATIONAL_QUERY_RECIPE;
  readonly query_semantics: typeof OPERATIONAL_QUERY_SEMANTICS;
  readonly model_version_verified: true;
}
export type OperationalQuerySourceResult = { readonly query: OperationalQueryEmbeddingIdentity } |
  { readonly unavailable: "PROVIDER_NOT_CONFIGURED" | "PROVIDER_FAILURE" | "INVALID_QUERY_EMBEDDING" };

const spaceKeys = ["projection_schema_version", "provider_id", "model_id", "model_version", "dimension"] as const;
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const closed = (x: Record<string, unknown>, keys: readonly string[]) =>
  Reflect.ownKeys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const scalar = (x: unknown): x is string => typeof x === "string" && !!x.trim() &&
  Buffer.byteLength(x, "utf8") <= 512 && Buffer.from(x, "utf8").toString("utf8") === x &&
  !/[\u0000-\u001f\u007f]/.test(x) && !["latest", "default", "unknown"].includes(x.trim().toLowerCase());
function copySpace(value: unknown): SemanticSpace {
  if (!object(value) || !closed(value, spaceKeys) || !spaceKeys.slice(0, 4).every(k => scalar(value[k])) ||
      !Number.isInteger(value.dimension) || Number(value.dimension) < 1 || Number(value.dimension) > 16000)
    throw new TypeError("Invalid operational embedding configuration");
  return Object.freeze({ projection_schema_version: String(value.projection_schema_version), provider_id: String(value.provider_id),
    model_id: String(value.model_id), model_version: String(value.model_version), dimension: Number(value.dimension) });
}
export const isAdmittedOperationalQuery = (value: unknown): value is OperationalQueryEmbeddingIdentity =>
  object(value) && admitted.has(value);

/** Dormant source: composition and provider qualification remain future work. The question is passed byte-for-byte. */
export function createOperationalQueryEmbeddingSource(configuration?: OperationalQueryEmbeddingConfiguration,
  provider?: OperationalQueryEmbeddingProviderPort) {
  let configured: SemanticSpace | undefined;
  if (configuration) {
    if (!object(configuration) || !closed(configuration,
      ["space", "document_recipe", "query_recipe", "query_semantics", "model_version_verified"]) ||
      configuration.document_recipe !== OPERATIONAL_DOCUMENT_RECIPE || configuration.query_recipe !== OPERATIONAL_QUERY_RECIPE ||
      configuration.query_semantics !== OPERATIONAL_QUERY_SEMANTICS || configuration.model_version_verified !== true)
      throw new TypeError("Invalid operational embedding configuration");
    configured = copySpace(configuration.space);
  }
  return async (question: string): Promise<OperationalQuerySourceResult> => {
    if (typeof question !== "string" || !question.trim() || Buffer.byteLength(question, "utf8") > 8192 ||
        Buffer.from(question, "utf8").toString("utf8") !== question) throw new RangeError("Invalid operational question");
    if (!configured || !provider) return Object.freeze({ unavailable: "PROVIDER_NOT_CONFIGURED" as const });
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let response: unknown;
    try {
      response = await Promise.race([Promise.resolve().then(() => provider.embedQuestion(question, controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error("Operational embedding timeout"));
        }, 5000); })]);
    } catch { return Object.freeze({ unavailable: "PROVIDER_FAILURE" as const }); }
    finally { clearTimeout(timer); }
    try {
      if (!object(response) || !closed(response, ["space", "query_recipe", "vector"]) ||
          response.query_recipe !== OPERATIONAL_QUERY_RECIPE) throw new TypeError();
      const exact = copySpace(response.space);
      if (!spaceKeys.every(k => exact[k] === configured![k]) || !Array.isArray(response.vector) || response.vector.length !== exact.dimension)
        throw new TypeError();
      const vector: number[] = []; let nonzero = false;
      for (const n of response.vector) {
        if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(Math.fround(n))) throw new TypeError();
        const f32 = Math.fround(n); nonzero ||= f32 !== 0; vector.push(f32);
      }
      if (!nonzero) throw new TypeError();
      const query = Object.freeze({ space: exact, query_recipe: OPERATIONAL_QUERY_RECIPE,
        vector: Object.freeze(vector) }) as OperationalQueryEmbeddingIdentity;
      admitted.add(query); return Object.freeze({ query });
    } catch { return Object.freeze({ unavailable: "INVALID_QUERY_EMBEDDING" as const }); }
  };
}
