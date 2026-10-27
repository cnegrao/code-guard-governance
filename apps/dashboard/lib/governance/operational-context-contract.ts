import "server-only";
import { createHash } from "node:crypto";
import type { SemanticSpace } from "./semantic-context-retrieval";

export const operationalDbReasons = ["EXECUTION_BUDGET_REQUIRED", "SCAN_BOUND", "NO_COMPATIBLE_REPRESENTATIONS",
  "SOURCE_UNAVAILABLE", "SOURCE_CHANGED", "INVALID_SOURCE_SUPPORT", "CONTENT_BOUND", "RESPONSE_BOUND"] as const;
export type OperationalUnavailableReason = typeof operationalDbReasons[number];
export class OperationalAuthorizationError extends Error {
  constructor() { super("Operational semantic access denied"); this.name = "OperationalAuthorizationError"; }
}
export class OperationalInputError extends Error {
  constructor(readonly reason: "INVALID_QUERY_EMBEDDING" | "INVALID_OPTIONS") {
    super("Invalid operational semantic input"); this.name = "OperationalInputError";
  }
}
export class OperationalTransportError extends Error {
  constructor(readonly reason: "QUERY_TIMEOUT" | "TRANSPORT_ERROR" | "INTERNAL_ERROR" | "MALFORMED_RESULT") {
    super("Operational semantic acquisition failed"); this.name = "OperationalTransportError";
  }
}

const hashPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** PostgreSQL output form, independent of version/variant; never canonicalize identity input. */
export const isCanonicalOperationalUuid = (x: unknown): x is string =>
  typeof x === "string" && x.length === 36 && uuidPattern.test(x);
const control = /[\u0000-\u001f\u007f-\u009f]/;
const spaceKeys = ["projection_schema_version", "provider_id", "model_id", "model_version", "dimension"] as const;
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const closed = (x: Record<string, unknown>, keys: readonly string[]) =>
  Reflect.ownKeys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
/** A3 storage CHECK under COLLATE "C", not the future SAFE writer policy. */
export const isOperationalStorageText = (x: unknown, max = 512): x is string => typeof x === "string" &&
  Buffer.byteLength(x, "utf8") >= 1 && Buffer.byteLength(x, "utf8") <= max &&
  /[^\t\n\v\f\r ]/.test(x) && !control.test(x) && Buffer.from(x, "utf8").toString("utf8") === x;
const text = isOperationalStorageText;
// C-collation lower(btrim(...)): ASCII case and SPACE only, with an absolute end assertion.
const unspecifiedIdentity = (x: string) => /^ *(?:latest|default|unknown) *(?![\s\S])/i.test(x);
export const operationalAgentTypes: readonly string[] = Object.freeze([
  "autonomous", "assistive", "supervisory", "gateway", "orchestrator", "retrieval", "classifier",
]);
const instant = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const fail = (): never => { throw new OperationalTransportError("MALFORMED_RESULT"); };
const eq = (a: unknown, b: unknown) => { if (a !== b) fail(); };

export function frameOperationalIdentity(parts: readonly (string | number)[]) {
  return parts.map(part => { const value = String(part); return `${Buffer.byteLength(value, "utf8")}:${value}`; }).join("");
}
export function operationalIdentity(parts: readonly (string | number)[]) {
  return createHash("sha256").update(frameOperationalIdentity(parts), "utf8").digest("hex");
}
export interface OperationalProjectionInput {
  agent_code_label: string; agent_name_label: string; agent_type: string; business_domain_label: string | null;
  description_disposition: "WITHHELD" | "PROJECTED"; description_text: string | null;
  related_system_state: "ABSENT" | "PRESENT_SAME_TENANT";
  related_system_record_id: string | null; related_system_code_label: string | null; related_system_name_label: string | null;
}
export function buildOperationalDocument(value: OperationalProjectionInput) {
  validateOperationalProjection(value);
  const lines = [`Agent: ${value.agent_name_label}`, `Code: ${value.agent_code_label}`, `Type: ${value.agent_type}`];
  if (value.business_domain_label !== null) lines.push(`Business domain: ${value.business_domain_label}`);
  if (value.related_system_state === "PRESENT_SAME_TENANT")
    lines.push(`Related system: ${value.related_system_name_label} (${value.related_system_code_label})`);
  if (value.description_disposition === "PROJECTED") lines.push(`Description: ${value.description_text}`);
  const result = lines.join("\n");
  if (result.endsWith("\n") || result.includes("\r")) fail();
  return result;
}

/** Validate only the stored fields used by GOVIA_OPERATIONAL_CONTEXT_V1. Preserve their bytes. */
function validateOperationalProjection(value: unknown): asserts value is OperationalProjectionInput {
  if (!record(value)) throw new OperationalTransportError("MALFORMED_RESULT");
  if (!text(value.agent_code_label) || !text(value.agent_name_label) || typeof value.agent_type !== "string" ||
      !operationalAgentTypes.includes(value.agent_type) ||
      (value.business_domain_label !== null && !text(value.business_domain_label))) fail();
  if (value.description_disposition === "WITHHELD" ? value.description_text !== null :
      value.description_disposition !== "PROJECTED" || !text(value.description_text, 1024)) fail();
  if (value.related_system_state === "ABSENT") {
    if ([value.related_system_record_id, value.related_system_code_label, value.related_system_name_label].some(x => x !== null)) fail();
  } else if (value.related_system_state === "PRESENT_SAME_TENANT") {
    if (!isCanonicalOperationalUuid(value.related_system_record_id) || !text(value.related_system_code_label) ||
        !text(value.related_system_name_label)) fail();
  } else fail();
}

export interface OperationalContextResult {
  readonly contract_version: "GOVIA_SR2_OPERATIONAL_CONTEXT_READ_V1";
  readonly observed_at: string; readonly embedding_space: SemanticSpace; readonly record_family: "LEGACY_AGENT_RECORD";
  readonly algorithm: "EXACT_COSINE_V1"; readonly selection_policy: "EXPLICIT_ADMITTED_HEAD_IN_EXACT_SPACE_V1";
  readonly authorization_semantics: "AUTHORIZATION_AS_OF_ACQUISITION_SNAPSHOT";
  readonly coverage: "BOUNDED_CURRENT_OPERATIONAL_HEADS"; readonly authority: "DERIVED_ANALYTICAL_NON_AUTHORITATIVE";
  readonly source_classification: "LEGACY_OPERATIONAL_RECORD_NON_CANONICAL";
  readonly canonical_decision: false; readonly governed_relationships: false; readonly assurance: false;
  readonly status: "SEMANTIC_CONTEXT_AVAILABLE" | "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE" | "SEMANTIC_CONTEXT_UNAVAILABLE";
  readonly reason: OperationalUnavailableReason | null; readonly hits: readonly Record<string, unknown>[];
}
function parseSpace(x: unknown): SemanticSpace {
  if (!record(x) || !closed(x, spaceKeys) || !spaceKeys.slice(0, 4).every(k => text(x[k]) &&
      !unspecifiedIdentity(String(x[k]))) ||
      !Number.isInteger(x.dimension) || Number(x.dimension) < 1 || Number(x.dimension) > 16000) return fail();
  return { projection_schema_version: String(x.projection_schema_version), provider_id: String(x.provider_id),
    model_id: String(x.model_id), model_version: String(x.model_version), dimension: Number(x.dimension) };
}
const sameSpace = (a: SemanticSpace, b: SemanticSpace) => spaceKeys.every(k => a[k] === b[k]);
function validateHit(hit: unknown, org: string, expectedSpace: SemanticSpace, expectedRank: number) {
  const hitKeys = ["subject_id", "source_record_id", "observation", "projection", "current_source", "representation_id",
    "embedding_space", "authority", "source_classification", "canonical_decision", "governed_relationships", "assurance", "retrieval_relevance"];
  if (!record(hit)) throw new OperationalTransportError("MALFORMED_RESULT");
  const h: Record<string, unknown>=hit;
  if (!closed(h, hitKeys) || !hashPattern.test(String(h.subject_id)) ||
      !isCanonicalOperationalUuid(h.source_record_id) || !hashPattern.test(String(h.representation_id)) ||
      h.authority !== "DERIVED_ANALYTICAL_NON_AUTHORITATIVE" || h.source_classification !== "LEGACY_OPERATIONAL_RECORD_NON_CANONICAL" ||
      h.canonical_decision !== false || h.governed_relationships !== false || h.assurance !== false) fail();
  const sourceId = String(h.source_record_id), subjectId = String(h.subject_id);
  eq(subjectId, operationalIdentity(["GOVIA_SR2_OPERATIONAL_SUBJECT_V1", org, "LEGACY_AGENT_RECORD", sourceId]));
  const space = parseSpace(h.embedding_space); if (!sameSpace(space, expectedSpace)) fail();
  if (!record(h.observation)) throw new OperationalTransportError("MALFORMED_RESULT");
  const observation: Record<string, unknown> = h.observation;
  if (!closed(observation, ["observation_id", "source_descriptor_recipe", "source_descriptor_fingerprint",
      "acquisition_method", "observed_at", "recorded_at"]) || !hashPattern.test(String(observation.observation_id)) ||
      observation.source_descriptor_recipe !== "GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1" ||
      !hashPattern.test(String(observation.source_descriptor_fingerprint)) || !instant(observation.observed_at) || !instant(observation.recorded_at) ||
      Date.parse(String(observation.observed_at)) > Date.parse(String(observation.recorded_at))) fail();
  if (!record(observation.acquisition_method)) throw new OperationalTransportError("MALFORMED_RESULT");
  const method: Record<string, unknown> = observation.acquisition_method;
  if (!closed(method, ["code", "version"]) || !text(method.code) || !text(method.version) ||
      unspecifiedIdentity(String(method.version))) fail();
  if (!record(h.projection)) throw new OperationalTransportError("MALFORMED_RESULT");
  const projection: Record<string, unknown> = h.projection;
  const projectionKeys = ["projection_id", "projection_schema_version", "document_recipe", "handling_recipe", "agent_code_label",
    "agent_name_label", "agent_type", "business_domain_label", "description_disposition", "description_text", "related_system_state",
    "related_system_record_id", "related_system_code_label", "related_system_name_label", "source_data_classification"];
  if (!closed(projection, projectionKeys) || !hashPattern.test(String(projection.projection_id)) ||
      projection.projection_schema_version !== expectedSpace.projection_schema_version || projection.document_recipe !== "GOVIA_OPERATIONAL_CONTEXT_V1" ||
      projection.source_data_classification !== "UNTRUSTED_SOURCE_DATA" ||
      !record(projection.handling_recipe) || !closed(projection.handling_recipe, ["id", "version"]) ||
      projection.handling_recipe.id !== "GOVIA_SR2_OPERATIONAL_HANDLING_V1" || projection.handling_recipe.version !== "1") fail();
  validateOperationalProjection(projection);
  const related = projection.related_system_state;
  const expectedProjection = operationalIdentity(["GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1", "1", org, sourceId, subjectId,
    expectedSpace.projection_schema_version, "GOVIA_SR2_OPERATIONAL_HANDLING_V1", "1", "GOVIA_OPERATIONAL_CONTEXT_V1",
    String(projection.agent_code_label), String(projection.agent_name_label), String(projection.agent_type),
    projection.business_domain_label === null ? "BUSINESS_DOMAIN_ABSENT" : "BUSINESS_DOMAIN_PRESENT", String(projection.business_domain_label ?? ""),
    String(projection.description_disposition), String(projection.description_text ?? ""), String(related),
    String(projection.related_system_record_id ?? ""), String(projection.related_system_code_label ?? ""), String(projection.related_system_name_label ?? "")]);
  eq(projection.projection_id, expectedProjection);
  const expectedObservation = operationalIdentity(["GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1", org, sourceId, subjectId,
    String(observation.source_descriptor_recipe), String(observation.source_descriptor_fingerprint), String(method.code), String(method.version),
    "GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1", "1", expectedSpace.projection_schema_version, expectedProjection,
    "GOVIA_SR2_OPERATIONAL_HANDLING_V1", "1", "GOVIA_OPERATIONAL_CONTEXT_V1"]);
  eq(observation.observation_id, expectedObservation);
  eq(h.representation_id, operationalIdentity(["GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1", org, sourceId,
    expectedObservation, expectedSpace.projection_schema_version, expectedSpace.provider_id, expectedSpace.model_id,
    expectedSpace.model_version, expectedSpace.dimension]));
  if (!record(h.current_source)) throw new OperationalTransportError("MALFORMED_RESULT");
  const current: Record<string, unknown> = h.current_source;
  if (!closed(current, ["agent_status", "status_authority", "related_system_decommissioned", "related_system_state_authority"]) ||
      !["active", "approved"].includes(String(current.agent_status)) || current.status_authority !== "LEGACY_NON_AUTHORITATIVE" ||
      current.related_system_state_authority !== "LEGACY_NON_AUTHORITATIVE" ||
      (related === "ABSENT" ? current.related_system_decommissioned !== null : typeof current.related_system_decommissioned !== "boolean")) fail();
  if (!record(h.retrieval_relevance)) throw new OperationalTransportError("MALFORMED_RESULT");
  const relevance: Record<string, unknown> = h.retrieval_relevance;
  if (!closed(relevance, ["kind", "rank", "policy_version"]) || relevance.kind !== "RETRIEVAL_RANK_ONLY" ||
      relevance.rank !== expectedRank || relevance.policy_version !== "EXACT_COSINE_V1") fail();
  buildOperationalDocument(projection as unknown as OperationalProjectionInput);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  } return value;
}
export function parseOperationalContextResult(value: unknown, expectedOrg: string, expectedSpace: SemanticSpace,
  requestedLimit: number): OperationalContextResult {
  const keys = ["contract_version", "observed_at", "embedding_space", "record_family", "algorithm", "selection_policy",
    "authorization_semantics", "coverage", "authority", "source_classification", "canonical_decision", "governed_relationships",
    "assurance", "status", "reason", "hits"];
  if (!record(value)) throw new OperationalTransportError("MALFORMED_RESULT");
  const result: Record<string, unknown>=value;
  if (!closed(result, keys) || result.contract_version !== "GOVIA_SR2_OPERATIONAL_CONTEXT_READ_V1" || !instant(result.observed_at) ||
      result.record_family !== "LEGACY_AGENT_RECORD" || result.algorithm !== "EXACT_COSINE_V1" ||
      result.selection_policy !== "EXPLICIT_ADMITTED_HEAD_IN_EXACT_SPACE_V1" || result.authorization_semantics !== "AUTHORIZATION_AS_OF_ACQUISITION_SNAPSHOT" ||
      result.coverage !== "BOUNDED_CURRENT_OPERATIONAL_HEADS" || result.authority !== "DERIVED_ANALYTICAL_NON_AUTHORITATIVE" ||
      result.source_classification !== "LEGACY_OPERATIONAL_RECORD_NON_CANONICAL" || result.canonical_decision !== false ||
      result.governed_relationships !== false || result.assurance !== false || !Array.isArray(result.hits)) fail();
  const hits=result.hits as unknown[];const space = parseSpace(result.embedding_space); if (!sameSpace(space, expectedSpace)) fail();
  if (result.status === "SEMANTIC_CONTEXT_AVAILABLE") {
    if (result.reason !== null || hits.length < 1 || hits.length > requestedLimit) fail();
    const seen={subject_id:new Set<string>(),source_record_id:new Set<string>(),observation_id:new Set<string>(),representation_id:new Set<string>()};
    hits.forEach((entry, index) => {
      const hit=record(entry)?entry:fail(),observation=record(hit.observation)?hit.observation:fail();
      const ids={subject_id:String(hit.subject_id),source_record_id:String(hit.source_record_id),
        observation_id:String(observation.observation_id),representation_id:String(hit.representation_id)};
      for(const key of Object.keys(seen) as (keyof typeof seen)[]){if(seen[key].has(ids[key]))fail();seen[key].add(ids[key]);}
      validateHit(entry, expectedOrg, expectedSpace, index + 1);
    });
  } else if (result.status === "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE") {
    if (result.reason !== null || hits.length) fail();
  } else if (result.status === "SEMANTIC_CONTEXT_UNAVAILABLE") {
    if (!operationalDbReasons.includes(result.reason as OperationalUnavailableReason) || hits.length) fail();
  } else fail();
  return deepFreeze(value as unknown as OperationalContextResult);
}
