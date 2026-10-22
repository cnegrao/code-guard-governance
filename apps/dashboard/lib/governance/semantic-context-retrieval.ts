import "server-only";
import type { VerifiedGovernancePrincipal } from "../auth/session-token";
import type { CanonicalObjectKind, DiscoveryCandidateKind } from "@council/canonical-contracts";

export interface SemanticSpace {
  readonly projection_schema_version: string;
  readonly provider_id: string;
  readonly model_id: string;
  readonly model_version: string;
  readonly dimension: number;
}
export const QUERY_RECIPE = "GOVERNANCE_SUBJECT_QUERY_V1" as const;
export const DOCUMENT_RECIPE = "GOVIA_SEMANTIC_CONTENT_V1" as const;
const admittedQueries = new WeakSet<object>();
declare const trustedQuery: unique symbol;
export interface QueryEmbeddingIdentity {
  readonly [trustedQuery]: true;
  readonly space: SemanticSpace;
  readonly query_recipe: typeof QUERY_RECIPE;
  readonly vector: readonly number[];
}
export interface QueryEmbeddingProviderPort {
  embedQuestion(question: string, signal: AbortSignal): Promise<{ space: SemanticSpace; query_recipe: string; vector: readonly number[] }>;
}
export interface QueryEmbeddingConfiguration {
  readonly space: SemanticSpace;
  readonly query_recipe: typeof QUERY_RECIPE;
  /** Server operator must pin and verify an actual provider revision. No alias resolution. */
  readonly model_version_verified: true;
}
export type UnavailableReason = "NO_COMPATIBLE_REPRESENTATIONS" | "SCAN_BOUND" | "PROVENANCE_BOUND" |
  "RESPONSE_BOUND" | "INVALID_REPRESENTATION_SUPPORT" | "EXECUTION_BUDGET_REQUIRED" |
  "PROVIDER_NOT_CONFIGURED" | "PROVIDER_FAILURE" | "INVALID_QUERY_EMBEDDING";
export class SemanticAuthorizationError extends Error {
  constructor() { super("Semantic access denied"); this.name = "SemanticAuthorizationError"; }
}
export class SemanticTransportError extends Error {
  constructor(readonly reason: "QUERY_TIMEOUT" | "TRANSPORT_ERROR" | "INTERNAL_ERROR" | "MALFORMED_RESULT") {
    super("Semantic acquisition failed"); this.name = "SemanticTransportError";
  }
}
export class InvalidQueryEmbeddingError extends Error {
  constructor() { super("Invalid query embedding"); this.name = "InvalidQueryEmbeddingError"; }
}
const scalar = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && Buffer.byteLength(x, "utf8") <= 512;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
const spaceKeys = ["projection_schema_version", "provider_id", "model_id", "model_version", "dimension"] as const;
function copySpace(x: unknown): SemanticSpace {
  if (!record(x) || !spaceKeys.slice(0, 4).every(k => scalar(x[k]) && !["latest", "default", "unknown"].includes(String(x[k]).trim().toLowerCase())) ||
      !Number.isInteger(x.dimension) || Number(x.dimension) < 1 || Number(x.dimension) > 16000) throw new InvalidQueryEmbeddingError();
  return Object.freeze(Object.fromEntries(spaceKeys.map(k => [k, x[k]])) as unknown as SemanticSpace);
}
const sameSpace = (a: SemanticSpace, b: SemanticSpace) => spaceKeys.every(k => a[k] === b[k]);
function validVector(v: readonly number[], dimension: number) {
  if (!Array.isArray(v) || v.length !== dimension || v.some(n => typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(Math.fround(n))) ||
    !Number.isFinite(v.reduce((n, x) => n + x * x, 0)) || v.every(n => Math.fround(n) === 0)) throw new InvalidQueryEmbeddingError();
}
/** Server configuration and provider are captured; the returned function accepts QUESTION TEXT only.
 * No production provider is configured or called by this module. */
export function createQueryEmbeddingSource(configuration?: QueryEmbeddingConfiguration, provider?: QueryEmbeddingProviderPort) {
  const config = configuration && Object.freeze({ ...configuration, space: copySpace(configuration.space) });
  return async (question: string): Promise<{ query: QueryEmbeddingIdentity } | { unavailable: UnavailableReason }> => {
    if (typeof question !== "string" || !question.trim() || Buffer.byteLength(question, "utf8") > 8192) throw new RangeError("Invalid semantic question");
    if (!config || !provider) return { unavailable: "PROVIDER_NOT_CONFIGURED" };
    if (!config.model_version_verified || config.query_recipe !== QUERY_RECIPE || config.space.projection_schema_version !== DOCUMENT_RECIPE)
      return { unavailable: "INVALID_QUERY_EMBEDDING" };
    let output;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      output = await Promise.race([provider.embedQuestion(question, abort.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("Embedding timeout")); }, 5000); })]);
    } catch { return { unavailable: "PROVIDER_FAILURE" }; }
    finally { clearTimeout(timer); }
    try {
      const space = copySpace(output.space);
      if (!sameSpace(space, config.space) || output.query_recipe !== config.query_recipe) throw new InvalidQueryEmbeddingError();
      validVector(output.vector, space.dimension);
      const query = Object.freeze({ space, query_recipe: QUERY_RECIPE, vector: Object.freeze([...output.vector]) }) as QueryEmbeddingIdentity;
      admittedQueries.add(query);
      return { query };
    } catch { return { unavailable: "INVALID_QUERY_EMBEDDING" }; }
  };
}
export type SemanticSubject = { readonly family: "CANONICAL_OBJECT"; readonly id: string; readonly kind: CanonicalObjectKind } |
  { readonly family: "NORMALIZED_CANDIDATE"; readonly id: string; readonly kind: DiscoveryCandidateKind };
export interface AssertionReference { assertion_id: string; method_code: string; method_version: string | null; trust_state: "INFERRED" | "DECLARED" | "IMPORTED" | "OBSERVED" | "VALIDATED"; observed_at: string; recorded_at: string }
export interface EvidenceReference { evidence_id: string; handling: "HASH_ONLY" | "REDACTED" | "NON_SENSITIVE"; content_hash: string; captured_at: string }
const boundary = Object.freeze({ source: "SEMANTIC_GOVERNANCE_CONTEXT", authority: "DERIVED_ANALYTICAL_NON_AUTHORITATIVE", derivation: "SEMANTIC_MATCH",
  canonical_decision: false, governed_relationships: false, assurance: false } as const);
const limitations = Object.freeze(["NO_GOVERNANCE_CONCLUSION", "SOURCE_FRESHNESS_UNKNOWN", "ORIGINAL_EMBEDDING_DOCUMENT_UNAVAILABLE"] as const);
export interface SemanticRetrievalHit extends Readonly<typeof boundary> {
  readonly representation_id: string;
  readonly subject: SemanticSubject;
  readonly embedding_space: SemanticSpace;
  readonly fingerprint: { algorithm: string; schema_version: string; value: string };
  readonly generated_at: string; readonly created_at: string;
  readonly selection_policy: "LATEST_RECORDED_IN_EXACT_SPACE_V1";
  readonly source_freshness: "UNKNOWN";
  readonly retrieval_relevance: { kind: "RETRIEVAL_RANK_ONLY"; rank: number; policy_version: "EXACT_COSINE_V1" };
  readonly provenance: { assertions: AssertionReference[]; evidence: EvidenceReference[] };
  readonly content_projection: { kind: "SUBJECT_REFERENCE_ONLY_V1"; subject_kind: SemanticSubject["family"]; subject_kind_code: DiscoveryCandidateKind; subject_id: string; original_embedding_content: "NOT_STORED" };
  readonly limitations: typeof limitations;
}
interface ResultBasis { readonly embedding_space: SemanticSpace; readonly algorithm: "EXACT_COSINE_V1";
  readonly selection_policy: "LATEST_RECORDED_IN_EXACT_SPACE_V1"; readonly coverage: "BOUNDED_RECORDED_REPRESENTATIONS_ONLY" }
export type SemanticRetrievalResult = ResultBasis & (
  { readonly status: "SEMANTIC_CONTEXT_AVAILABLE"; readonly reason: null; readonly hits: readonly SemanticRetrievalHit[] } |
  { readonly status: "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE"; readonly reason: null; readonly hits: readonly [] } |
  { readonly status: "SEMANTIC_CONTEXT_UNAVAILABLE"; readonly reason: UnavailableReason; readonly hits: readonly [] });
export interface SemanticRetrievalOptions { readonly limit: number; readonly threshold: number; readonly policy_version: "EXACT_COSINE_V1" }
/** A server-owned SQL pool, supplied by the composition root. No connection URL or tenant comes from a browser.
 * A dedicated transaction is needed to set the actual deadline before RPC execution.
 * Structurally compatible with a pg client; SR1 adds no provider/pool activation. */
export interface SemanticSqlClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
export interface SemanticSqlPool { connect(): Promise<SemanticSqlClient> }
export interface SemanticRetrievalPort {
  retrieveSemanticContext(principal: VerifiedGovernancePrincipal, query: QueryEmbeddingIdentity, options: SemanticRetrievalOptions): Promise<SemanticRetrievalResult>;
}
const kinds = ["AGENT", "AGENT_VERSION", "MODEL", "TOOL", "MCP_SERVER", "API", "PROMPT", "KNOWLEDGE_BASE", "DATA_ASSET", "DATA_ELEMENT", "SKILL"];
function malformed(): never { throw new SemanticTransportError("MALFORMED_RESULT"); }
function freeze<T>(x: T): T {
  if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
}
function safeRecord(x: unknown) { if (!record(x)) malformed(); return x; }
function resultSpace(x: unknown) { try { return copySpace(x); } catch { return malformed(); } }
function strings(x: Record<string, unknown>, keys: string[]) { if (!keys.every(k => scalar(x[k]))) malformed(); }
function projection(x: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.map(k => [k, x[k]])); }
function parseHit(value: unknown, space: SemanticSpace, rank: number): SemanticRetrievalHit {
  const x = safeRecord(value), subject = safeRecord(x.subject), fingerprint = safeRecord(x.fingerprint), relevance = safeRecord(x.retrieval_relevance),
    provenance = safeRecord(x.provenance), content = safeRecord(x.content_projection);
  strings(x, ["representation_id"]); strings(subject, ["id", "kind"]); strings(fingerprint, ["algorithm", "schema_version", "value"]);
  if (!["CANONICAL_OBJECT", "NORMALIZED_CANDIDATE"].includes(String(subject.family)) ||
    !(subject.family === "CANONICAL_OBJECT" ? kinds : [...kinds, "RELATIONSHIP"]).includes(String(subject.kind)) ||
    !sameSpace(resultSpace(x.embedding_space), space) || !instant(x.generated_at) || !instant(x.created_at) ||
    Date.parse(x.generated_at) > Date.now() || Date.parse(x.created_at) > Date.now() ||
    x.selection_policy !== "LATEST_RECORDED_IN_EXACT_SPACE_V1" || x.source_freshness !== "UNKNOWN" ||
    relevance.kind !== "RETRIEVAL_RANK_ONLY" || relevance.rank !== rank || relevance.policy_version !== "EXACT_COSINE_V1" ||
    Object.entries(boundary).some(([k, v]) => x[k] !== v) || !Array.isArray(x.limitations) ||
    JSON.stringify(x.limitations) !== JSON.stringify(limitations) || content.kind !== "SUBJECT_REFERENCE_ONLY_V1" ||
    content.subject_kind !== subject.family || content.subject_kind_code !== subject.kind || content.subject_id !== subject.id ||
    content.original_embedding_content !== "NOT_STORED" || !Array.isArray(provenance.assertions) || !Array.isArray(provenance.evidence) ||
    provenance.assertions.length + provenance.evidence.length < 1 || provenance.assertions.length + provenance.evidence.length > 100) malformed();
  const assertions = provenance.assertions.map(v => {
    const a = safeRecord(v); strings(a, ["assertion_id", "method_code"]);
    if (!(a.method_version === null || scalar(a.method_version)) || !["INFERRED", "DECLARED", "IMPORTED", "OBSERVED", "VALIDATED"].includes(String(a.trust_state)) ||
      !instant(a.observed_at) || !instant(a.recorded_at)) malformed();
    return projection(a, ["assertion_id", "method_code", "method_version", "trust_state", "observed_at", "recorded_at"]) as unknown as AssertionReference;
  });
  const evidence = provenance.evidence.map(v => {
    const e = safeRecord(v); strings(e, ["evidence_id", "content_hash"]);
    if (!["HASH_ONLY", "REDACTED", "NON_SENSITIVE"].includes(String(e.handling)) || !instant(e.captured_at)) malformed();
    return projection(e, ["evidence_id", "handling", "content_hash", "captured_at"]) as unknown as EvidenceReference;
  });
  for (const ids of [assertions.map(a => a.assertion_id), evidence.map(e => e.evidence_id)])
    if (new Set(ids).size !== ids.length || ids.some((id, i) => i > 0 && Buffer.compare(Buffer.from(ids[i - 1]), Buffer.from(id)) >= 0)) malformed();
  return { ...boundary, representation_id: x.representation_id as string, subject: projection(subject, ["family", "id", "kind"]) as unknown as SemanticSubject,
    embedding_space: space, fingerprint: projection(fingerprint, ["algorithm", "schema_version", "value"]) as SemanticRetrievalHit["fingerprint"],
    generated_at: x.generated_at as string, created_at: x.created_at as string, selection_policy: "LATEST_RECORDED_IN_EXACT_SPACE_V1", source_freshness: "UNKNOWN",
    retrieval_relevance: { kind: "RETRIEVAL_RANK_ONLY", rank, policy_version: "EXACT_COSINE_V1" }, provenance: { assertions, evidence },
    content_projection: { kind: "SUBJECT_REFERENCE_ONLY_V1", subject_kind: subject.family as SemanticSubject["family"], subject_kind_code: subject.kind as DiscoveryCandidateKind,
      subject_id: subject.id as string, original_embedding_content: "NOT_STORED" }, limitations };
}
const dbReasons = ["NO_COMPATIBLE_REPRESENTATIONS", "SCAN_BOUND", "PROVENANCE_BOUND", "RESPONSE_BOUND", "INVALID_REPRESENTATION_SUPPORT", "EXECUTION_BUDGET_REQUIRED"];
function parseResult(value: unknown, space: SemanticSpace, limit: number): SemanticRetrievalResult {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 262144) malformed();
  const x = safeRecord(value);
  if (!sameSpace(resultSpace(x.embedding_space), space) || x.algorithm !== "EXACT_COSINE_V1" || x.selection_policy !== "LATEST_RECORDED_IN_EXACT_SPACE_V1" ||
    x.coverage !== "BOUNDED_RECORDED_REPRESENTATIONS_ONLY" || !Array.isArray(x.hits) || x.hits.length > limit) malformed();
  const basis = { embedding_space: space, algorithm: "EXACT_COSINE_V1" as const, selection_policy: "LATEST_RECORDED_IN_EXACT_SPACE_V1" as const,
    coverage: "BOUNDED_RECORDED_REPRESENTATIONS_ONLY" as const };
  if (x.status === "SEMANTIC_CONTEXT_UNAVAILABLE" && dbReasons.includes(String(x.reason)) && x.hits.length === 0)
    return { ...basis, status: x.status, reason: x.reason as UnavailableReason, hits: [] };
  if (x.status === "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE" && x.reason === null && x.hits.length === 0)
    return { ...basis, status: x.status, reason: null, hits: [] };
  if (x.status !== "SEMANTIC_CONTEXT_AVAILABLE" || x.reason !== null || x.hits.length === 0) malformed();
  const hits = x.hits.map((h, i) => parseHit(h, space, i + 1));
  if (new Set(hits.map(h => JSON.stringify(h.subject))).size !== hits.length || new Set(hits.map(h => h.representation_id)).size !== hits.length) malformed();
  return { ...basis, status: x.status, reason: null, hits };
}
export function createSemanticRetrievalAdapter(pool: SemanticSqlPool): SemanticRetrievalPort {
  return { async retrieveSemanticContext(principal, query, options) {
    if (!principal || !uuid.test(principal.userId) || !uuid.test(principal.organisationId) || !instant(principal.credentialEpoch) ||
      !Number.isSafeInteger(principal.issuedAtSeconds) || !Number.isSafeInteger(principal.expiresAtSeconds)) throw new SemanticAuthorizationError();
    if (!query || !admittedQueries.has(query)) throw new InvalidQueryEmbeddingError();
    if (!options || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20 || !Number.isFinite(options.threshold) ||
      options.threshold < -1 || options.threshold > 1 || options.policy_version !== "EXACT_COSINE_V1") throw new RangeError("Invalid semantic options");
    const params = [principal.organisationId, principal.userId, principal.issuedAtSeconds, principal.expiresAtSeconds, principal.credentialEpoch,
      `[${query.vector.join(",")}]`, query.space.provider_id, query.space.model_id, query.space.model_version, query.space.dimension,
      query.space.projection_schema_version, options.limit, options.threshold];
    let client: SemanticSqlClient | undefined, committed = false, destroy = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      const response = await client.query("SELECT gov_repo.semantic_context_search_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result", params);
      if (response.rows.length !== 1) malformed();
      const result = parseResult(response.rows[0].result, query.space, options.limit);
      await client.query("COMMIT"); committed = true;
      return freeze(result);
    } catch (error) {
      if (error instanceof SemanticTransportError || error instanceof InvalidQueryEmbeddingError) throw error;
      const code = record(error) ? error.code : undefined;
      if (typeof code === "string" && (/^GV00[1-5]$/.test(code) || code === "55P03")) throw new SemanticAuthorizationError();
      if (code === "22023" || code === "22P02" || code === "22003" || code === "22000") throw new InvalidQueryEmbeddingError();
      throw new SemanticTransportError(code === "57014" ? "QUERY_TIMEOUT" : code ? "INTERNAL_ERROR" : "TRANSPORT_ERROR");
    } finally {
      if (client && !committed) { try { await client.query("ROLLBACK"); } catch { destroy = true; } }
      client?.release(destroy);
    }
  } };
}
