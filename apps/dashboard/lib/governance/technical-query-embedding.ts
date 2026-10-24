import "server-only";
import type { SemanticSpace } from "./semantic-context-retrieval";

export const TECHNICAL_QUERY_RECIPE = "TECHNICAL_CONTEXT_QUERY_V1" as const;
export const TECHNICAL_DOCUMENT_RECIPE = "GOVIA_TECHNICAL_CONTEXT_V1" as const;
declare const technicalQuery: unique symbol;
const admitted = new WeakSet<object>();
export interface TechnicalQueryEmbeddingIdentity {
  readonly [technicalQuery]: true;
  readonly space: SemanticSpace;
  readonly query_recipe: typeof TECHNICAL_QUERY_RECIPE;
  readonly vector: readonly number[];
}
export interface TechnicalQueryEmbeddingProviderPort {
  embedQuestion(question: string, signal: AbortSignal): Promise<{
    space: SemanticSpace; query_recipe: string; vector: readonly number[];
  }>;
}
export interface TechnicalQueryEmbeddingConfiguration {
  readonly space: SemanticSpace;
  readonly document_recipe: typeof TECHNICAL_DOCUMENT_RECIPE;
  readonly query_recipe: typeof TECHNICAL_QUERY_RECIPE;
  readonly model_version_verified: true;
}
export type TechnicalQuerySourceResult = { readonly query: TechnicalQueryEmbeddingIdentity } |
  { readonly unavailable: "PROVIDER_NOT_CONFIGURED" | "PROVIDER_FAILURE" | "INVALID_QUERY_EMBEDDING" };
const spaceKeys = ["projection_schema_version", "provider_id", "model_id", "model_version", "dimension"] as const;
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const closed = (x: Record<string, unknown>, keys: readonly string[]) =>
  Reflect.ownKeys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const scalar = (x: unknown): x is string => typeof x === "string" && !!x.trim() &&
  Buffer.byteLength(x, "utf8") <= 512 && Buffer.from(x, "utf8").toString("utf8") === x &&
  !["latest", "default", "unknown"].includes(x.trim().toLowerCase());
function space(value: unknown): SemanticSpace {
  if (!object(value) || !closed(value, spaceKeys) || !spaceKeys.slice(0, 4).every(k => scalar(value[k])) ||
      !Number.isInteger(value.dimension) || Number(value.dimension) < 1 || Number(value.dimension) > 16000)
    throw new TypeError("Invalid technical embedding configuration");
  return Object.freeze({ projection_schema_version: String(value.projection_schema_version), provider_id: String(value.provider_id),
    model_id: String(value.model_id), model_version: String(value.model_version), dimension: Number(value.dimension) });
}
/** Membership cannot be obtained by copying a query, by a TS cast, or through SR1. */
export const isAdmittedTechnicalQuery = (value: unknown): value is TechnicalQueryEmbeddingIdentity =>
  object(value) && admitted.has(value);

/** Dormant port. Future composition must revalidate principal/egress before calling it.
 * Only question text and cancellation reach the injected provider; A2 supplies no provider. */
export function createTechnicalQueryEmbeddingSource(configuration?: TechnicalQueryEmbeddingConfiguration,
  provider?: TechnicalQueryEmbeddingProviderPort) {
  let configured: SemanticSpace | undefined;
  if (configuration) {
    if (!object(configuration) || !closed(configuration, ["space", "document_recipe", "query_recipe", "model_version_verified"]) ||
        configuration.document_recipe !== TECHNICAL_DOCUMENT_RECIPE || configuration.query_recipe !== TECHNICAL_QUERY_RECIPE ||
        configuration.model_version_verified !== true) throw new TypeError("Invalid technical embedding configuration");
    configured = space(configuration.space);
  }
  return async (question: string): Promise<TechnicalQuerySourceResult> => {
    if (typeof question !== "string" || !question.trim() || Buffer.byteLength(question, "utf8") > 8192 ||
        Buffer.from(question, "utf8").toString("utf8") !== question) throw new RangeError("Invalid technical question");
    if (!configured || !provider) return Object.freeze({ unavailable: "PROVIDER_NOT_CONFIGURED" as const });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: unknown;
    try {
      response = await Promise.race([
        Promise.resolve().then(() => provider.embedQuestion(question, controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error("Technical embedding timeout"));
        }, 5000); }),
      ]);
    } catch { return Object.freeze({ unavailable: "PROVIDER_FAILURE" as const }); }
    finally { clearTimeout(timer); }
    try {
      if (!object(response) || !closed(response, ["space", "query_recipe", "vector"]) ||
          response.query_recipe !== TECHNICAL_QUERY_RECIPE) throw new TypeError();
      const exact = space(response.space);
      if (!spaceKeys.every(k => exact[k] === configured[k]) || !Array.isArray(response.vector) ||
          response.vector.length !== exact.dimension) throw new TypeError();
      const vector: number[] = [];
      let nonzero = false;
      for (const n of response.vector) {
        if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(Math.fround(n))) throw new TypeError();
        const f32 = Math.fround(n); nonzero ||= f32 !== 0; vector.push(f32);
      }
      if (!nonzero) throw new TypeError();
      const query = Object.freeze({ space: exact, query_recipe: TECHNICAL_QUERY_RECIPE,
        vector: Object.freeze(vector) }) as TechnicalQueryEmbeddingIdentity;
      admitted.add(query);
      return Object.freeze({ query });
    } catch { return Object.freeze({ unavailable: "INVALID_QUERY_EMBEDDING" as const }); }
  };
}
