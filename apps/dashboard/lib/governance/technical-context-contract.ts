import "server-only";
import { createHash } from "node:crypto";
import type { SemanticSpace } from "./semantic-context-retrieval";
import type { ResolvedTechnicalScope } from "./technical-context-scope";

export class TechnicalAuthorizationError extends Error {
  constructor() { super("Technical context access denied"); this.name = "TechnicalAuthorizationError"; }
}
export class TechnicalInputError extends Error {
  constructor(readonly reason: "INVALID_QUERY_EMBEDDING" | "INVALID_OPTIONS" | "INVALID_SCOPE") {
    super("Invalid technical context input"); this.name = "TechnicalInputError";
  }
}
export class TechnicalTransportError extends Error {
  constructor(readonly reason: "QUERY_TIMEOUT" | "TRANSPORT_ERROR" | "INTERNAL_ERROR" | "MALFORMED_RESULT") {
    super("Technical context acquisition failed"); this.name = "TechnicalTransportError";
  }
}
export const technicalDbReasons = ["EXECUTION_BUDGET_REQUIRED", "SCOPE_REQUIRED", "REVISION_UNAVAILABLE", "CAPTURE_INCOMPLETE",
  "SCAN_BOUND", "NO_COMPATIBLE_REPRESENTATIONS", "SOURCE_UNAVAILABLE", "INVALID_SOURCE_SUPPORT", "CONTENT_WITHHELD",
  "PROVENANCE_BOUND", "CONTENT_BOUND", "RESPONSE_BOUND"] as const;
export type DbReason = typeof technicalDbReasons[number];
const fail = (): never => { throw new TechnicalTransportError("MALFORMED_RESULT"); };
type Context = { instants: bigint[] };
type Parser<T> = (value: unknown, context: Context) => T;
type Parsed<P> = P extends Parser<infer T> ? T : never;
const literal = <const T extends string | number | boolean | null>(expected: T): Parser<T> => value => value === expected ? expected : fail();
const enumeration = <const T extends readonly string[]>(values: T): Parser<T[number]> => value =>
  typeof value === "string" && values.includes(value) ? value as T[number] : fail();
/** A1/A2 storage text under COLLATE "C". Controls are restricted separately for paths. */
export const isTechnicalStorageText = (value: unknown, max = 512): value is string => typeof value === "string" &&
  Buffer.byteLength(value, "utf8") >= 1 && Buffer.byteLength(value, "utf8") <= max &&
  /[^\t\n\v\f\r ]/.test(value) && !value.includes("\u0000") && Buffer.from(value, "utf8").toString("utf8") === value;
const text = (max: number): Parser<string> => value => isTechnicalStorageText(value, max) ? value : fail();
const scalar = text(512);
const identityScalar: Parser<string> = (value, context) => {
  const result = scalar(value, context);
  // SQL lower(btrim(...)) in C collation only folds ASCII and strips SPACE.
  if (/^ *(?:latest|default|unknown) *(?![\s\S])/i.test(result)) fail();
  return result;
};
const pattern = (expression: RegExp): Parser<string> => value => typeof value === "string" && expression.test(value) ? value : fail();
const hash = pattern(/^[0-9a-f]{64}$/);
const uuid = pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const integer = (min: number, max: number): Parser<number> => value =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
const decimal = (positive: boolean): Parser<string> => value => typeof value === "string" &&
  (positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/).test(value) &&
  value.length <= 19 && BigInt(value) <= BigInt("9223372036854775807") ? value : fail();
const path: Parser<string> = (value, context) => {
  const result = text(1024)(value, context);
  return /(^\/|\/$|\/\/|(^|\/)\.{1,2}(\/|$)|[\\:?#\u0000-\u001f\u007f-\u009f])/.test(result) ? fail() : result;
};
const directory: Parser<string> = (value, context) => value === "." ? "." : path(value, context);
const nullable = <T>(parser: Parser<T>): Parser<T | null> => (value, context) => value === null ? null : parser(value, context);
const array = <T>(parser: Parser<T>, max = 20, min = 0): Parser<readonly T[]> => (value, context) => {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1) return fail();
  return value.map(item => parser(item, context));
};
function object<const S extends Record<string, Parser<unknown>>>(schema: S): Parser<{ readonly [K in keyof S]: Parsed<S[K]> }> {
  return (value, context) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== Object.keys(schema).length ||
        !Object.keys(schema).every(key => Object.hasOwn(value, key))) fail();
    return Object.fromEntries(Object.entries(schema).map(([key, parser]) =>
      [key, parser((value as Record<string, unknown>)[key], context)])) as { readonly [K in keyof S]: Parsed<S[K]> };
  };
}
/** Calendar validation preserves the microsecond string. Epoch transport never passes through Date. */
function micros(value: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
  if (!match || match[1] === "0000") return fail();
  const millis = Date.parse(value.slice(0, 19) + ".000Z");
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) return fail();
  return BigInt(millis) * BigInt(1000) + BigInt(match[7]);
}
const instant: Parser<string> = (value, context) => {
  if (typeof value !== "string") return fail();
  context.instants.push(micros(value)); return value;
};
const recipe = object({ id: identityScalar, version: identityScalar });
const space = object({ projection_schema_version: identityScalar, provider_id: identityScalar, model_id: identityScalar,
  model_version: identityScalar, dimension: integer(1, 16000) });
const scope = object({ repository_id: hash, snapshot_id: hash, revision_scheme: enumeration(["GIT_SHA1_V1", "GIT_SHA256_V1"]),
  full_revision: pattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/), manifest_fingerprint: hash, manifest_entry_count: decimal(false) });
const byteRange = object({ start: integer(0, 524287), end: integer(1, 524288) });
const lineRange = object({ start: integer(1, 524288), end: integer(1, 524288) });
const manifestLocator = object({ kind: literal("SNAPSHOT_MANIFEST"), manifest_fingerprint: hash });
const fileLocator = object({ kind: literal("FILE_DESCRIPTOR"), locator_id: hash, entry_id: hash, relative_path: path,
  source_fingerprint: hash, decoding_id: literal("SOURCE_DESCRIPTOR_V1"), chunker: object({ id: literal("FILE_DESCRIPTOR_V1"), version: literal("1") }) });
const regionLocator = object({ kind: enumeration(["CODE_REGION", "DOCUMENTATION_REGION"]), locator_id: hash, entry_id: hash,
  relative_path: path, source_fingerprint: hash, byte_range: byteRange, line_range: lineRange,
  decoding_id: literal("UTF8_STRICT_V1"), chunker: recipe });
const symbolLocator = object({ kind: literal("CODE_SYMBOL"), locator_id: hash, entry_id: hash, relative_path: path,
  source_fingerprint: hash, byte_range: byteRange, line_range: lineRange, decoding_id: literal("UTF8_STRICT_V1"),
  language_id: identityScalar, parser: recipe, qualified_symbol_key: scalar });
type Locator = Parsed<typeof manifestLocator> | Parsed<typeof fileLocator> | Parsed<typeof regionLocator> | Parsed<typeof symbolLocator>;
const locator: Parser<Locator> = (value, context) => {
  const kind = value && typeof value === "object" ? (value as { kind?: unknown }).kind : null;
  if (kind === "SNAPSHOT_MANIFEST") return manifestLocator(value, context);
  if (kind === "FILE_DESCRIPTOR") return fileLocator(value, context);
  if (kind === "CODE_SYMBOL") return symbolLocator(value, context);
  return regionLocator(value, context);
};
const subject = object({ family: enumeration(["REPOSITORY_SNAPSHOT", "REPOSITORY_CHUNK", "CODE_SYMBOL"]), id: hash,
  source_fingerprint: hash, locator });
const method = object({ code: enumeration(["PARSED", "MANIFEST_OBSERVED", "LOCKFILE_OBSERVED", "FILENAME_HEURISTIC", "STRUCTURAL_SUMMARY"]),
  version: identityScalar, limitations: array(scalar) });
const itemBasis = { item_key: hash, grounding_set_id: hash,
  scope_kind: enumeration(["ITEM_GROUNDING_V1", "PACKAGE_MEMBERS_V1", "MODULE_MEMBERS_V1", "SERVICE_MEMBERS_V1", "REPOSITORY_SELECTION_V1"]),
  anchor_subject_id: hash, method, payload_fingerprint: hash };
const moduleItem = object({ ...itemBasis, kind: literal("MODULE_DESCRIPTOR"), module_key: scalar,
  module_kind: enumeration(["PACKAGE", "DIRECTORY", "NAMESPACE"]), directory_label: directory, module_name: scalar });
const serviceItem = object({ ...itemBasis, kind: literal("SERVICE_DESCRIPTOR"), service_key: scalar, service_name: scalar,
  service_kind: enumeration(["LIBRARY", "APPLICATION", "WORKER", "API"]), capabilities: array(scalar) });
const dependencyItem = object({ ...itemBasis, kind: literal("DEPENDENCY_DESCRIPTOR"),
  ecosystem: enumeration(["NPM", "PYPI", "MAVEN", "NUGET", "CARGO", "GO", "UNAVAILABLE"]), dependency_name: scalar, resolution_key: scalar,
  dependency_role: enumeration(["RUNTIME", "DEVELOPMENT", "PEER", "OPTIONAL", "BUILD"]), observed_specification: nullable(scalar), resolved_version: nullable(scalar) });
const configurationItem = object({ ...itemBasis, kind: literal("CONFIGURATION_DESCRIPTOR"), configuration_key: scalar,
  value_type: enumeration(["BOOLEAN", "INTEGER", "DECIMAL", "STRING", "LIST", "MAP", "NULL"]),
  safe_value_code: enumeration(["ENABLED", "DISABLED", "REQUIRED", "OPTIONAL", "UNSPECIFIED"]) });
const summaryItem = object({ ...itemBasis, kind: literal("TECHNICAL_SUMMARY"), summary_text: text(1024), coverage: literal("COMPLETE_DECLARED_SOURCE_SET_V1") });
const domainItem = object({ ...itemBasis, kind: literal("DOMAIN_OBSERVATION"), domain_key: scalar, label: scalar, structural_description: scalar });
const agentItem = object({ ...itemBasis, kind: literal("AGENT_DESCRIPTOR"), descriptor_key: scalar, observed_role: scalar, behaviors: array(scalar) });
const entrypointItem = object({ ...itemBasis, kind: literal("ENTRYPOINT_DESCRIPTOR"), entrypoint_key: scalar,
  entrypoint_kind: enumeration(["FUNCTION", "COMMAND", "HTTP_ROUTE", "PROCESS", "MODULE_INITIALIZER"]), safe_signature: nullable(scalar), invocation_shape: array(scalar) });
const collection = <T>(item: Parser<T>, singleton = false) => nullable(object({ collection_fingerprint: hash, items: array(item, singleton ? 1 : 20, singleton ? 1 : 0) }));
const facets = object({ modules: collection(moduleItem), services: collection(serviceItem), dependencies: collection(dependencyItem),
  configurations: collection(configurationItem), summary: collection(summaryItem, true), domains: collection(domainItem),
  agents: collection(agentItem), entrypoints: collection(entrypointItem) });
const fragment = object({ ordinal: integer(1, 4), kind: enumeration(["SIGNATURE", "STRUCTURAL_STATEMENT", "CALL_DESCRIPTOR", "IMPORT_DESCRIPTOR", "DOCUMENTATION_SUMMARY"]),
  source_subject_id: hash, projected_text: text(1024), projection_mark: literal("CONTENT_PROJECTED"), untrusted_source: literal(true) });
const protectedContent = object({ structural_summary: text(1024), literal_handling: literal("REMOVED_OR_TYPED_V1"),
  projection_mark: literal("CONTENT_PROJECTED"), untrusted_source: literal(true), fragments: array(fragment, 4), facets });
const projection = object({ projection_id: hash, projection_fingerprint: hash, source_fingerprint: hash, projection_schema_version: identityScalar,
  document_recipe: literal("GOVIA_TECHNICAL_CONTEXT_V1"), record_contract: literal("GOVIA_SR2_TYPED_PROJECTION_RECORD_V1"),
  // AVAILABLE mirrors the RPC disclosure bound; SQL storage permits 1024 independently.
  extraction_recipe: recipe, handling_recipe: recipe, content_class: literal("PROTECTED_CONTEXT_V1"), safe_label: scalar, safe_description: scalar,
  primary_source_set_id: hash, admission_basis_set_fingerprint: hash, admission_record_set_fingerprint: hash,
  admitted_at: instant, recorded_at: instant, protected: protectedContent });
const disclosure = object({ purpose: literal("TECHNICAL_CONTEXT_HYDRATION_V1"), profile_id: identityScalar, profile_version: identityScalar,
  profile_fingerprint: hash, profile_recorded_at: instant, profile_head_revision: decimal(true), admission_recipe: recipe, policy_profile: recipe,
  handling_recipe: recipe, required_projection_schema_version: identityScalar, document_recipe: literal("GOVIA_TECHNICAL_CONTEXT_V1") });
const entry = object({ entry_id: hash, relative_path: path, entry_kind: literal("REGULAR_FILE"), payload_kind: literal("BLOB_BYTES_V1"),
  provider_object_id: pattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/), raw_sha256: hash, source_fingerprint: hash,
  byte_length: integer(0, 524288), encoding_id: literal("UTF8_STRICT_V1"), line_count: integer(0, 524288) });
const sourceSet = object({ source_set_id: hash, manifest_fingerprint: hash,
  scope_kind: enumeration(["ITEM_GROUNDING_V1", "PACKAGE_MEMBERS_V1", "MODULE_MEMBERS_V1", "SERVICE_MEMBERS_V1", "REPOSITORY_SELECTION_V1"]),
  anchor_subject_id: hash, scope_key: scalar, selector: recipe, member_count: integer(1, 20), membership_fingerprint: hash,
  coverage: enumeration(["DECLARED_SET_ONLY", "ENTIRE_SNAPSHOT_MANIFEST"]), completeness: literal("COMPLETE_DECLARED_SET_V1"),
  limitations: array(scalar), member_subject_ids: array(hash, 20, 1) });
const admission = object({ source_admission_id: hash, evaluation_id: uuid, admission_basis_fingerprint: hash, capture_id: uuid,
  capture_observed_at: instant, admission_recipe: recipe, policy_profile: recipe, outcome: literal("PROTECTED_ELIGIBLE"),
  content_class: literal("PROTECTED_CONTEXT_V1"), reason_code: literal("NONE"), protected_eligible: literal(true), evaluated_at: instant, recorded_at: instant });
const admissionBinding = object({ entry_id: hash, historical: admission, current: admission, current_head_revision: decimal(true) });
const capture = object({ capture_id: uuid, method: object({ code: literal("CAPTURE_AT_IMMUTABLE_REVISION_V1"), version: identityScalar }),
  observed_at: instant, captured_at: instant, recorded_at: instant });
const support = object({ source_subjects: array(subject, 20, 1), entries: array(entry, 20, 1), source_sets: array(sourceSet, 20, 1),
  admissions: array(admissionBinding, 20, 1), captures: array(capture, 20, 1) });
const limitations = ["NO_GOVERNANCE_CONCLUSION", "BOUNDED_RECORDED_COVERAGE_ONLY", "NO_LIVE_SOURCE_FETCH", "NO_LIVE_REVISION_COMPARISON",
  "CURRENT_DISCLOSURE_IS_NOT_EGRESS_AUTHORIZATION", "UNTRUSTED_SOURCE_DATA"] as const;
const hit = object({ source: literal("REPOSITORY_TECHNICAL_CONTEXT"), authority: literal("DERIVED_ANALYTICAL_NON_AUTHORITATIVE"),
  derivation: literal("SEMANTIC_MATCH"), canonical_decision: literal(false), governed_relationships: literal(false), assurance: literal(false),
  representation_id: hash, repository: object({ repository_id: hash, safe_label: scalar }), snapshot: scope, subject, projection,
  embedding_space: space, representation_provenance: object({ capture_id: uuid, capture_observed_at: instant, generated_at: instant, indexed_at: instant, recorded_at: instant }),
  disclosure, support, currentness: object({ state: literal("HISTORICAL_AT_REQUESTED_REVISION"), checked_at: instant, comparison_target: literal(null) }),
  retrieval_relevance: object({ kind: literal("RETRIEVAL_RANK_ONLY"), rank: integer(1, 20), policy_version: literal("EXACT_COSINE_V1") }),
  limitations: array(enumeration(limitations), 6, 6) });
const result = object({ contract_version: literal("GOVIA_SR2_TECHNICAL_CONTEXT_READ_V1"), observed_at: instant, embedding_space: space, scope: nullable(scope),
  algorithm: literal("EXACT_COSINE_V1"), selection_policy: literal("EXACT_SNAPSHOT_LATEST_PROJECTION_IN_SPACE_V1"),
  authorization_semantics: literal("AUTHORIZATION_AS_OF_HYDRATION_SNAPSHOT"), coverage: literal("BOUNDED_RECORDED_REPRESENTATIONS_AT_EXACT_SNAPSHOT"),
  status: enumeration(["SEMANTIC_CONTEXT_AVAILABLE", "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE", "SEMANTIC_CONTEXT_UNAVAILABLE"]),
  reason: nullable(enumeration(technicalDbReasons)), hits: array(hit) });

export type TechnicalContextHit = Parsed<typeof hit>;
export type TechnicalSubject = Parsed<typeof subject>;
export type TechnicalScope = Parsed<typeof scope>;
export type TechnicalProjection = Parsed<typeof projection>;
export type TechnicalDisclosure = Parsed<typeof disclosure>;
export type TechnicalSupport = Parsed<typeof support>;
export type TechnicalAdmission = Parsed<typeof admission>;
export type TechnicalEntry = Parsed<typeof entry>;
export type TechnicalSourceSet = Parsed<typeof sourceSet>;
export type TechnicalCapture = Parsed<typeof capture>;
type ResultBasis = Omit<Parsed<typeof result>, "status" | "reason" | "hits">;
export type TechnicalContextResult = ResultBasis & (
  { readonly status: "SEMANTIC_CONTEXT_AVAILABLE"; readonly reason: null; readonly hits: readonly TechnicalContextHit[] } |
  { readonly status: "NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE"; readonly reason: null; readonly hits: readonly [] } |
  { readonly status: "SEMANTIC_CONTEXT_UNAVAILABLE"; readonly reason: DbReason; readonly hits: readonly [] });

const frame = (parts: readonly (string | number)[]) => parts.map(value => { const s = String(value); return `${Buffer.byteLength(s, "utf8")}:${s}`; }).join("");
const seal = (tag: string, ...parts: (string | number)[]) => createHash("sha256").update(frame([`GOVIA_SR2_${tag}_V1`, ...parts]), "utf8").digest("hex");
const optional = (value: string | number | null) => value === null ? ["0", ""] : ["1", String(value)];
const list = (values: readonly string[]): (string | number)[] => [values.length, ...values];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ordered = (values: readonly string[]) => { if (values.some((v, i) => i > 0 && values[i - 1] >= v)) fail(); };
const eq = (a: unknown, b: unknown) => { if (a !== b) fail(); };
const timeOrder = (...times: string[]) => { if (times.some((value, i) => i > 0 && micros(times[i - 1]) > micros(value))) fail(); };
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function validateSubject(s: TechnicalSubject, org: string, revision: TechnicalScope, entries: ReadonlyMap<string, TechnicalEntry>) {
  const keys = [org, revision.repository_id, revision.snapshot_id], l = s.locator;
  let entryId: string | null = null, manifest: string | null = null, chunk: string | null = null, symbol: string | null = null;
  if (l.kind === "SNAPSHOT_MANIFEST") {
    eq(s.family, "REPOSITORY_SNAPSHOT"); eq(l.manifest_fingerprint, revision.manifest_fingerprint);
    eq(s.source_fingerprint, revision.manifest_fingerprint); manifest = l.manifest_fingerprint;
  } else {
    const e = entries.get(l.entry_id); if (!e) return fail();
    eq(l.relative_path, e.relative_path); eq(l.source_fingerprint, e.source_fingerprint); eq(s.source_fingerprint, e.source_fingerprint);
    entryId = l.entry_id;
    if (l.kind === "CODE_SYMBOL") {
      eq(s.family, "CODE_SYMBOL"); symbol = l.locator_id;
      eq(symbol, seal("SYMBOL_LOCATOR", ...keys, entryId, l.source_fingerprint, l.language_id, l.parser.id, l.parser.version,
        l.qualified_symbol_key, l.byte_range.start, l.byte_range.end, l.line_range.start, l.line_range.end, l.decoding_id));
    } else {
      eq(s.family, "REPOSITORY_CHUNK"); chunk = l.locator_id;
      eq(chunk, seal("CHUNK_LOCATOR", ...keys, entryId, l.source_fingerprint, l.kind,
        ...optional(l.kind === "FILE_DESCRIPTOR" ? null : l.byte_range.start),
        ...optional(l.kind === "FILE_DESCRIPTOR" ? null : l.byte_range.end),
        ...optional(l.kind === "FILE_DESCRIPTOR" ? null : l.line_range.start),
        ...optional(l.kind === "FILE_DESCRIPTOR" ? null : l.line_range.end), l.decoding_id, l.chunker.id, l.chunker.version));
    }
    if (l.kind !== "FILE_DESCRIPTOR" && (l.byte_range.start >= l.byte_range.end || l.byte_range.end > e.byte_length ||
        l.line_range.start > l.line_range.end || l.line_range.end > e.line_count)) fail();
  }
  eq(s.id, seal("SUBJECT", ...keys, s.family, s.source_fingerprint, ...optional(entryId), ...optional(manifest), ...optional(chunk), ...optional(symbol)));
}
function validateHit(h: TechnicalContextHit, org: string, revision: TechnicalScope, expectedSpace: SemanticSpace, rank: number) {
  const keys = [org, revision.repository_id, revision.snapshot_id], p = h.projection, d = h.disclosure, r = h.representation_provenance;
  if (!same(h.snapshot, revision) || !same(h.embedding_space, expectedSpace) || !same(h.limitations, limitations)) fail();
  eq(h.repository.repository_id, revision.repository_id); eq(h.retrieval_relevance.rank, rank);
  eq(h.currentness.checked_at, r.capture_observed_at);
  eq(p.source_fingerprint, h.subject.source_fingerprint); eq(p.projection_schema_version, expectedSpace.projection_schema_version);
  eq(p.projection_id, seal("PROJECTION", ...keys, h.subject.id, p.projection_schema_version, p.projection_fingerprint));
  eq(h.representation_id, seal("REPRESENTATION", ...keys, h.subject.id, p.projection_id, p.projection_schema_version,
    p.projection_fingerprint, expectedSpace.provider_id, expectedSpace.model_id, expectedSpace.model_version, expectedSpace.dimension));
  eq(d.required_projection_schema_version, p.projection_schema_version);
  if (!same(d.handling_recipe, p.handling_recipe)) fail();
  eq(d.profile_fingerprint, seal("DISCLOSURE_PROFILE", org, revision.repository_id, d.purpose, d.profile_id, d.profile_version,
    d.admission_recipe.id, d.admission_recipe.version, d.policy_profile.id, d.policy_profile.version, d.handling_recipe.id,
    d.handling_recipe.version, d.required_projection_schema_version, d.document_recipe));
  const entries = new Map(h.support.entries.map(e => [e.entry_id, e]));
  const subjects = new Map(h.support.source_subjects.map(s => [s.id, s]));
  const sets = new Map(h.support.source_sets.map(s => [s.source_set_id, s]));
  const captures = new Map(h.support.captures.map(c => [c.capture_id, c]));
  ordered(h.support.entries.map(e => e.entry_id)); ordered(h.support.source_subjects.map(s => s.id));
  ordered(h.support.source_sets.map(s => s.source_set_id)); ordered(h.support.admissions.map(a => a.entry_id));
  ordered(h.support.captures.map(c => c.capture_id));
  for (const e of entries.values()) {
    if (e.provider_object_id.length !== (revision.revision_scheme === "GIT_SHA1_V1" ? 40 : 64) || /^0+$/.test(e.provider_object_id) ||
        (e.byte_length === 0 ? e.line_count !== 0 : e.line_count < 1 || e.line_count > e.byte_length)) fail();
    eq(e.source_fingerprint, seal("SOURCE_BLOB", e.payload_kind, e.raw_sha256, e.byte_length));
    eq(e.entry_id, seal("SOURCE_ENTRY", ...keys, e.relative_path, e.entry_kind, e.provider_object_id, e.source_fingerprint, e.encoding_id, e.line_count));
  }
  for (const c of captures.values()) timeOrder(c.observed_at, c.captured_at, c.recorded_at);
  const representationCapture = captures.get(r.capture_id);
  if (!representationCapture) return fail();
  eq(representationCapture.observed_at, r.capture_observed_at);
  timeOrder(r.capture_observed_at, r.generated_at, r.indexed_at, r.recorded_at);
  timeOrder(p.admitted_at, p.recorded_at); timeOrder(p.admitted_at, r.generated_at);
  validateSubject(h.subject, org, revision, entries);
  for (const s of subjects.values()) {
    if (s.family === "REPOSITORY_SNAPSHOT") fail();
    validateSubject(s, org, revision, entries);
  }
  if (h.subject.family !== "REPOSITORY_SNAPSHOT" && !same(subjects.get(h.subject.id), h.subject)) fail();
  const primary = sets.get(p.primary_source_set_id);
  if (!primary || !same(primary.member_subject_ids, h.support.source_subjects.map(s => s.id))) return fail();
  const usedEntries = new Set<string>();
  for (const s of subjects.values()) {
    if (s.locator.kind === "SNAPSHOT_MANIFEST") return fail();
    usedEntries.add(s.locator.entry_id);
  }
  if (usedEntries.size !== entries.size || [...entries.keys()].some(id => !usedEntries.has(id))) fail();
  const selectors = { ITEM_GROUNDING_V1: "GOVIA_ITEM_SOURCE_MANIFEST_V1", PACKAGE_MEMBERS_V1: "GOVIA_PACKAGE_SOURCE_MANIFEST_V1",
    MODULE_MEMBERS_V1: "GOVIA_MODULE_SOURCE_MANIFEST_V1", SERVICE_MEMBERS_V1: "GOVIA_SERVICE_SOURCE_MANIFEST_V1",
    REPOSITORY_SELECTION_V1: "GOVIA_REPOSITORY_SOURCE_MANIFEST_V1" } as const;
  for (const set of sets.values()) {
    ordered(set.member_subject_ids); eq(set.member_subject_ids.length, set.member_count);
    eq(set.manifest_fingerprint, revision.manifest_fingerprint); eq(set.selector.id, selectors[set.scope_kind]);
    const members = set.member_subject_ids.map(id => { const s = subjects.get(id); if (!s || s.locator.kind === "SNAPSHOT_MANIFEST") return fail(); return s; });
    const anchor = set.anchor_subject_id === h.subject.id ? h.subject : subjects.get(set.anchor_subject_id);
    if (!anchor) return fail();
    if (set.scope_kind === "REPOSITORY_SELECTION_V1") eq(anchor.family, "REPOSITORY_SNAPSHOT");
    else if (anchor.family === "REPOSITORY_SNAPSHOT" || !set.member_subject_ids.includes(anchor.id) ||
        (set.scope_kind === "PACKAGE_MEMBERS_V1" && anchor.locator.kind !== "FILE_DESCRIPTOR")) fail();
    if (set.coverage === "ENTIRE_SNAPSHOT_MANIFEST" && (set.scope_kind !== "REPOSITORY_SELECTION_V1" ||
        BigInt(members.length) !== BigInt(revision.manifest_entry_count) || new Set(members.map(s =>
          s.locator.kind === "SNAPSHOT_MANIFEST" ? fail() : s.locator.entry_id)).size !== members.length ||
        members.some(s => s.locator.kind !== "FILE_DESCRIPTOR"))) fail();
    const memberParts = members.flatMap(s => s.locator.kind === "SNAPSHOT_MANIFEST" ? fail() : [s.id, s.locator.entry_id, s.source_fingerprint]);
    eq(set.membership_fingerprint, seal("SOURCE_SET_MEMBERS", set.member_count, ...memberParts));
    eq(set.source_set_id, seal("SOURCE_SET", ...keys, set.manifest_fingerprint, set.scope_kind, set.anchor_subject_id, set.scope_key,
      set.selector.id, set.selector.version, set.member_count, set.membership_fingerprint, set.coverage, set.completeness, ...list(set.limitations)));
  }
  const usedCaptures = new Set([r.capture_id]);
  const nativeCaptures = new Set<string>();
  const basis: (string | number)[] = [h.support.admissions.length], records: (string | number)[] = [h.support.admissions.length];
  const completeRefs = new Set<string>(), nativeRefs = new Set<string>();
  const reference = (type: string, ...ids: string[]) => completeRefs.add(frame([type, ...ids]));
  const nativeReference = (type: string, ...ids: string[]) => nativeRefs.add(frame([type, ...ids]));
  reference("SUBJECT", h.subject.id); nativeReference("SUBJECT", h.subject.id);
  for (const s of subjects.values()) { reference("SUBJECT", s.id); nativeReference("SUBJECT", s.id); }
  for (const e of entries.values()) reference("ENTRY", e.entry_id);
  for (const set of sets.values()) { reference("SET", set.source_set_id); nativeReference("SET", set.source_set_id); }
  if (h.support.admissions.length !== entries.size || h.support.admissions.some(a => !entries.has(a.entry_id))) fail();
  for (const binding of h.support.admissions) {
    const a = binding.historical, current = binding.current;
    basis.push(binding.entry_id, a.admission_basis_fingerprint);
    records.push(binding.entry_id, a.source_admission_id, a.admission_basis_fingerprint, a.outcome);
    for (const adm of [a, current]) {
      if (!same(adm.admission_recipe, d.admission_recipe) || !same(adm.policy_profile, d.policy_profile)) fail();
      const c = captures.get(adm.capture_id); if (!c) return fail();
      eq(c.observed_at, adm.capture_observed_at); timeOrder(adm.capture_observed_at, adm.evaluated_at, adm.recorded_at);
      eq(adm.admission_basis_fingerprint, seal("ADMISSION_BASIS", ...keys, binding.entry_id, adm.admission_recipe.id,
        adm.admission_recipe.version, adm.policy_profile.id, adm.policy_profile.version, adm.outcome, ...optional(adm.content_class), adm.reason_code, "1"));
      eq(adm.source_admission_id, seal("SOURCE_ADMISSION", ...keys, binding.entry_id, adm.evaluation_id, adm.admission_basis_fingerprint));
      usedCaptures.add(adm.capture_id); reference("ADMISSION", binding.entry_id, adm.source_admission_id);
    }
    eq(a.admission_basis_fingerprint, current.admission_basis_fingerprint);
    nativeCaptures.add(a.capture_id); nativeReference("ADMISSION", binding.entry_id, a.source_admission_id);
  }
  if (captures.size !== usedCaptures.size || [...captures.keys()].some(id => !usedCaptures.has(id))) fail();
  for (const c of captures.values()) reference("CAPTURE", c.capture_id);
  for (const id of nativeCaptures) nativeReference("CAPTURE", id);
  reference("PROJECTION", p.projection_id); reference("REPRESENTATION", h.representation_id); reference("DISCLOSURE_PROFILE", d.profile_fingerprint);
  if (nativeRefs.size > 99 || completeRefs.size > 100) fail();
  eq(p.admitted_at, h.support.admissions.map(a => a.historical.evaluated_at).sort().at(-1));
  eq(p.admission_basis_set_fingerprint, seal("ADMISSION_BASES", ...basis));
  eq(p.admission_record_set_fingerprint, seal("ADMISSION_RECORDS", ...records));
  let humanBytes = 0;
  const count = (...values: readonly (string | null)[]) => { for (const v of values) if (v !== null) humanBytes += Buffer.byteLength(v, "utf8"); };
  count(h.repository.safe_label, p.safe_label, p.safe_description, p.protected.structural_summary);
  const locatorText = (s: TechnicalSubject) => { if (s.locator.kind !== "SNAPSHOT_MANIFEST") count(s.locator.relative_path);
    if (s.locator.kind === "CODE_SYMBOL") count(s.locator.qualified_symbol_key); };
  locatorText(h.subject); h.support.source_subjects.forEach(locatorText);
  h.support.entries.forEach(e => count(e.relative_path)); h.support.source_sets.forEach(s => count(...s.limitations));
  const content: (string | number)[] = [p.record_contract, p.projection_schema_version, p.document_recipe, p.extraction_recipe.id,
    p.extraction_recipe.version, p.handling_recipe.id, p.handling_recipe.version, p.content_class, p.primary_source_set_id,
    p.admission_basis_set_fingerprint, p.safe_label, p.safe_description, "1", p.protected.structural_summary,
    p.protected.literal_handling, p.protected.projection_mark, "1"];
  const usedSets = new Set([p.primary_source_set_id]);
  for (const collection of Object.values(p.protected.facets)) {
    if (collection === null) { content.push("0"); continue; }
    ordered(collection.items.map(i => i.item_key));
    const collectionParts: (string | number)[] = [];
    // Empty collections still have a fixed kind from their declared field, resolved below.
    for (const item of collection.items) {
      const grounding = sets.get(item.grounding_set_id);
      if (!grounding || grounding.scope_kind !== item.scope_kind || grounding.anchor_subject_id !== item.anchor_subject_id) return fail();
      usedSets.add(item.grounding_set_id);
      if (item.kind === "TECHNICAL_SUMMARY" ? item.scope_kind === "ITEM_GROUNDING_V1" : item.scope_kind !== "ITEM_GROUNDING_V1") fail();
      if ((h.subject.family === "CODE_SYMBOL" && ["DEPENDENCY_DESCRIPTOR", "CONFIGURATION_DESCRIPTOR"].includes(item.kind)) ||
          (h.subject.locator.kind === "DOCUMENTATION_REGION" && (!["DOMAIN_OBSERVATION", "TECHNICAL_SUMMARY"].includes(item.kind) || item.method.code !== "STRUCTURAL_SUMMARY"))) fail();
      let natural: (string | number)[], payload: (string | number)[], methods: readonly string[];
      switch (item.kind) {
        case "MODULE_DESCRIPTOR": natural = [item.module_kind, item.module_key]; payload = [item.module_key, item.module_kind, item.directory_label, item.module_name];
          methods = ["PARSED", "MANIFEST_OBSERVED", "FILENAME_HEURISTIC"]; count(item.module_key, item.directory_label, item.module_name); break;
        case "SERVICE_DESCRIPTOR": natural = [item.service_kind, item.service_key]; payload = [item.service_key, item.service_name, item.service_kind, ...list(item.capabilities)];
          methods = ["PARSED", "MANIFEST_OBSERVED", "FILENAME_HEURISTIC"]; count(item.service_key, item.service_name, ...item.capabilities); break;
        case "DEPENDENCY_DESCRIPTOR": natural = [item.ecosystem, item.dependency_name, item.dependency_role, item.resolution_key];
          payload = [item.ecosystem, item.dependency_name, item.resolution_key, item.dependency_role, ...optional(item.observed_specification), ...optional(item.resolved_version)];
          methods = ["MANIFEST_OBSERVED", "LOCKFILE_OBSERVED", "FILENAME_HEURISTIC"];
          if (item.method.code === "MANIFEST_OBSERVED" ? item.observed_specification === null || item.resolved_version !== null || item.ecosystem === "UNAVAILABLE" :
              item.method.code === "LOCKFILE_OBSERVED" ? item.resolved_version === null || item.ecosystem === "UNAVAILABLE" :
              item.observed_specification !== null || item.resolved_version !== null || item.resolution_key !== "UNRESOLVED") fail();
          count(item.dependency_name, item.resolution_key, item.observed_specification, item.resolved_version); break;
        case "CONFIGURATION_DESCRIPTOR": natural = [item.configuration_key]; payload = [item.configuration_key, item.value_type, item.safe_value_code];
          methods = ["PARSED", "MANIFEST_OBSERVED"]; count(item.configuration_key); break;
        case "TECHNICAL_SUMMARY": natural = [item.grounding_set_id]; payload = [item.summary_text, item.coverage];
          methods = ["STRUCTURAL_SUMMARY"]; count(item.summary_text); break;
        case "DOMAIN_OBSERVATION": natural = [item.domain_key]; payload = [item.domain_key, item.label, item.structural_description];
          methods = ["PARSED", "STRUCTURAL_SUMMARY", "FILENAME_HEURISTIC"]; count(item.domain_key, item.label, item.structural_description); break;
        case "AGENT_DESCRIPTOR": natural = [item.descriptor_key]; payload = [item.descriptor_key, item.observed_role, ...list(item.behaviors)];
          methods = ["PARSED", "MANIFEST_OBSERVED", "FILENAME_HEURISTIC"]; count(item.descriptor_key, item.observed_role, ...item.behaviors); break;
        case "ENTRYPOINT_DESCRIPTOR": natural = [item.entrypoint_kind, item.entrypoint_key]; payload = [item.entrypoint_key, item.entrypoint_kind, ...optional(item.safe_signature), ...list(item.invocation_shape)];
          methods = ["PARSED", "MANIFEST_OBSERVED"]; count(item.entrypoint_key, item.safe_signature, ...item.invocation_shape); break;
      }
      if (!methods.includes(item.method.code)) fail(); count(...item.method.limitations);
      eq(item.item_key, seal("FACET_ITEM", ...keys, h.subject.id, item.kind, item.anchor_subject_id, ...natural));
      eq(item.payload_fingerprint, seal("FACET_PAYLOAD", item.kind, item.item_key, item.grounding_set_id, item.scope_kind,
        item.anchor_subject_id, item.method.code, item.method.version, ...list(item.method.limitations), ...payload));
      collectionParts.push(item.item_key, item.payload_fingerprint);
    }
    const names = ["modules", "services", "dependencies", "configurations", "summary", "domains", "agents", "entrypoints"] as const;
    const kinds = ["MODULE_DESCRIPTOR", "SERVICE_DESCRIPTOR", "DEPENDENCY_DESCRIPTOR", "CONFIGURATION_DESCRIPTOR", "TECHNICAL_SUMMARY", "DOMAIN_OBSERVATION", "AGENT_DESCRIPTOR", "ENTRYPOINT_DESCRIPTOR"];
    const index = names.findIndex(name => p.protected.facets[name] === collection);
    eq(collection.collection_fingerprint, seal("FACET_COLLECTION", kinds[index], collection.items.length, ...collectionParts));
    content.push("1", collection.items.length, collection.collection_fingerprint);
  }
  if (sets.size !== usedSets.size || [...sets.keys()].some(id => !usedSets.has(id))) fail();
  p.protected.fragments.forEach((fragment, index) => {
    eq(fragment.ordinal, index + 1); if (!subjects.has(fragment.source_subject_id)) fail();
    count(fragment.projected_text);
    content.push(fragment.ordinal, fragment.kind, fragment.source_subject_id, fragment.projected_text, fragment.projection_mark, "1");
  });
  if (humanBytes > 4096) fail();
  eq(p.projection_fingerprint, seal("PROJECTION_CONTENT", ...content));
  if (p.source_fingerprint === p.projection_fingerprint) fail();
}

export function parseTechnicalContextResult(value: unknown, expectedPrincipalOrg: string, expectedScope: ResolvedTechnicalScope,
  expectedQuerySpace: SemanticSpace, limit: number): TechnicalContextResult {
  try {
    if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 262144) return fail();
    const context: Context = { instants: [] }, x = result(value, context), expectedSpace = space(expectedQuerySpace, context);
    if (!same(x.embedding_space, expectedSpace) || x.hits.length > limit || expectedScope.organisation_id !== expectedPrincipalOrg) fail();
    const observed = micros(x.observed_at);
    if (observed > BigInt(Date.now() + 5000) * BigInt(1000) || context.instants.some(time => time > observed)) fail();
    if (x.scope) {
      eq(x.scope.repository_id, expectedScope.repository_id); eq(x.scope.snapshot_id, expectedScope.snapshot_id);
      if (x.scope.full_revision.length !== (x.scope.revision_scheme === "GIT_SHA1_V1" ? 40 : 64) || /^0+$/.test(x.scope.full_revision)) fail();
      eq(x.scope.snapshot_id, seal("SNAPSHOT", expectedPrincipalOrg, x.scope.repository_id, x.scope.revision_scheme,
        x.scope.full_revision, x.scope.manifest_fingerprint));
    }
    if (x.status === "SEMANTIC_CONTEXT_UNAVAILABLE") {
      if (x.reason === null || x.hits.length || (x.scope === null) !== technicalDbReasons.slice(0, 3).includes(x.reason as typeof technicalDbReasons[0])) fail();
    } else {
      if (x.reason !== null || x.scope === null || (x.status === "SEMANTIC_CONTEXT_AVAILABLE" ? !x.hits.length : !!x.hits.length)) fail();
      const revision = x.scope; if (!revision) return fail();
      const subjectIds = new Set<string>(), representations = new Set<string>();
      x.hits.forEach((h, i) => {
        if (subjectIds.has(h.subject.id) || representations.has(h.representation_id)) fail();
        subjectIds.add(h.subject.id); representations.add(h.representation_id);
        validateHit(h, expectedPrincipalOrg, revision, x.embedding_space, i + 1);
      });
    }
    return freeze(x) as TechnicalContextResult;
  } catch (error) {
    if (error instanceof TechnicalTransportError) throw error;
    return fail();
  }
}
