import type { ApiProtocolFamily, CanonicalObjectIdentity, McpTransport, SourceConnectionReference, SourceObjectIdentity } from './contracts.ts';
import type { ExecutionPrincipalReference } from './execution-context.ts';
import type { IsoTimestamp, ObjectSourceMappingId, OrganisationId, SourceConnectionId, SourceSystemId } from './identifiers.ts';

/** M14.1 values only. A valid shape proves neither admission nor durable canonical identity. */
export const RUNTIME_OBSERVATION_KINDS = Object.freeze(['EXECUTION', 'MODEL_CALL', 'TOOL_CALL', 'MCP_CALL', 'API_CALL'] as const);
export type RuntimeObservationKind = typeof RUNTIME_OBSERVATION_KINDS[number];
export const RUNTIME_UNKNOWN_REASONS = Object.freeze(['NOT_SUPPLIED', 'UNSUPPORTED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE'] as const);
export type RuntimeUnknownReason = typeof RUNTIME_UNKNOWN_REASONS[number];
export interface RuntimeUnknown { readonly state: 'UNKNOWN'; readonly reason: RuntimeUnknownReason }
export interface RuntimeKnown<T> { readonly state: 'KNOWN'; readonly value: T }
export type RuntimeAvailability<T> = RuntimeKnown<T> | RuntimeUnknown;

declare const runtimeValueBrand: unique symbol;
type RuntimeValue<Name extends string> = string & { readonly [runtimeValueBrand]: Name };
export type RuntimeObservationId = RuntimeValue<'RuntimeObservationId'>;
export type RuntimeDeploymentBindingId = RuntimeValue<'RuntimeDeploymentBindingId'>;
export type RuntimeTraceId = RuntimeValue<'RuntimeTraceId'>;
export type RuntimeSpanId = RuntimeValue<'RuntimeSpanId'>;
export type RuntimeUnixNano = RuntimeValue<'RuntimeUnixNano'>;
export type RuntimeDurationNano = RuntimeValue<'RuntimeDurationNano'>;
export type RuntimeDecimal = RuntimeValue<'RuntimeDecimal'>;

export interface RuntimeEvidenceReference {
  readonly organisationId: OrganisationId;
  readonly connectionId: SourceConnectionId;
  readonly observationId: RuntimeObservationId;
}
export interface RuntimeCoordinates {
  readonly producerIdentity: string;
  readonly deploymentReference: RuntimeAvailability<string>;
  readonly artifactDigest: RuntimeAvailability<string>;
}
export type RuntimeSubjectBinding =
  | { readonly state: 'EXACT'; readonly agentVersion: CanonicalObjectIdentity<'AGENT_VERSION'>;
      readonly coordinates: RuntimeCoordinates;
      readonly proof: { readonly organisationId: OrganisationId; readonly connectionId: SourceConnectionId;
        readonly deploymentBindingId: RuntimeDeploymentBindingId;
        readonly method: 'VERIFIED_RELEASE_ASSOCIATION_V1'; readonly version: '1.0.0' } }
  | { readonly state: 'UNRESOLVED'; readonly coordinates: RuntimeCoordinates;
      readonly reason: 'MISSING_REVISION_EVIDENCE' | 'NO_EXACT_MAPPING' | 'AMBIGUOUS_MAPPING' | 'UNSUPPORTED_BINDING_PROOF' };

export type RuntimeTargetKind = 'MODEL' | 'TOOL' | 'MCP_SERVER' | 'API';
export interface RuntimeObservedTarget<K extends RuntimeTargetKind> {
  readonly kind: K;
  readonly providerCode: string;
  /**
   * M14.1 performs conservative structural validation only. Source-specific
   * admission MUST apply exact allowlisting later; URL-shaped strings passing
   * this validator are not thereby approved runtime target coordinates.
   */
  readonly sourceReference: string;
}
export interface RuntimeCanonicalTarget<K extends RuntimeTargetKind> {
  readonly canonicalObject: CanonicalObjectIdentity<K>;
  readonly proof: { readonly method: 'EXACT_SOURCE_COORDINATES_V1'; readonly version: '1.0.0';
    readonly mappingId: ObjectSourceMappingId; readonly sourceObject: SourceObjectIdentity; readonly providerCode: string };
}
export interface RuntimeTarget<K extends RuntimeTargetKind> {
  readonly observed: RuntimeAvailability<RuntimeObservedTarget<K>>;
  readonly canonical: RuntimeAvailability<RuntimeCanonicalTarget<K>>;
}
export type RuntimeParent = RuntimeUnknown | { readonly state: 'ROOT' }
  | { readonly state: 'SPAN_REFERENCE'; readonly parentSpanId: RuntimeSpanId };
/**
 * ERROR: execution/transport/protocol/provider error prevented a normal successful result.
 * FAILURE: operation completed sufficiently to report an explicit non-success
 * application/protocol result. OTel ERROR maps to ERROR; supported HTTP non-success
 * maps to FAILURE. DIRECT_RESULT follows these source-specific semantics.
 */
export type RuntimeOutcome = RuntimeUnknown
  | { readonly state: 'SUCCESS' | 'ERROR' | 'FAILURE'; readonly basis: 'OTEL_STATUS' | 'HTTP_STATUS' | 'DIRECT_RESULT' };
export interface RuntimeDuration {
  readonly value: RuntimeDurationNano;
  readonly unit: 'NANOSECOND';
  readonly basis: 'MEASURED' | 'START_END_DIFFERENCE';
  readonly method: { readonly code: string; readonly version: string };
}
export type RuntimeError =
  | { readonly category: 'TIMEOUT'; readonly code: 'DEADLINE_EXCEEDED' }
  | { readonly category: 'CANCELLED'; readonly code: 'OPERATION_CANCELLED' }
  | { readonly category: 'TRANSPORT'; readonly code: 'CONNECTION_FAILED' }
  | { readonly category: 'PROTOCOL'; readonly code: 'HTTP_ERROR' | 'INVALID_RESPONSE' }
  | { readonly category: 'PROVIDER'; readonly code: 'PROVIDER_REJECTED' }
  | { readonly category: 'APPLICATION'; readonly code: 'OPERATION_FAILED' };

/**
 * Input, output and total are independently source-reported facts. M14.1 neither
 * infers total nor assumes total = input + output across providers. Source adapters
 * MUST enforce provider-defined consistency: the future OpenAI adapter must check
 * prompt_tokens + completion_tokens = total_tokens when all three are supplied.
 */
export interface RuntimeTokenUsage {
  readonly unit: 'TOKEN';
  readonly input: RuntimeAvailability<number>;
  readonly output: RuntimeAvailability<number>;
  readonly total: RuntimeAvailability<number>;
}
export interface RuntimeSuppliedCost {
  readonly kind: 'SUPPLIED'; readonly amount: RuntimeDecimal; readonly currency: string;
  readonly scope: { readonly kind: 'SINGLE_CALL'; readonly observationId: RuntimeObservationId };
  readonly source: { readonly evidence: RuntimeEvidenceReference; readonly chargeReference: string };
}
export interface RuntimeDerivedCost {
  readonly kind: 'DERIVED'; readonly amount: RuntimeDecimal; readonly currency: string;
  readonly scope: { readonly kind: 'SINGLE_CALL'; readonly observationId: RuntimeObservationId };
  readonly pricing: {
    readonly sourceReference: string; readonly version: string;
    readonly effectiveFrom: IsoTimestamp; readonly effectiveUntil: RuntimeAvailability<IsoTimestamp>;
    readonly providerCode: string; readonly modelReference: string; readonly serviceTier: string;
    readonly inputRate: RuntimeDecimal; readonly outputRate: RuntimeDecimal; readonly rateUnit: 'PER_MILLION_TOKENS';
    readonly inputCoverage: 'ALL_INPUT_TOKENS'; readonly outputCoverage: 'ALL_OUTPUT_TOKENS';
    readonly adjustments: 'NONE_APPLICABLE';
  };
  readonly usageInputs: { readonly unit: 'TOKEN'; readonly input: number; readonly output: number };
  readonly calculation: { readonly method: 'FLAT_TWO_BUCKET_TOKEN_TARIFF'; readonly version: '1.0.0';
    readonly rounding: 'HALF_EVEN'; readonly decimalPlaces: 9; readonly roundingStage: 'FINAL_SUM' };
}
/**
 * SUPPLIED and DERIVED are independent bases for the same observation, never summed
 * or treated as duplicate spend. Their currencies may differ; direct comparison or
 * aggregation across currencies requires an explicit governed FX/normalization basis.
 * M14.1 has no FX/normalization. Source-specific admission/pricing may require equal
 * currencies. No cost is generated here; domain validation verifies declared DERIVED amounts.
 */
export interface RuntimeCost {
  readonly supplied: RuntimeAvailability<RuntimeSuppliedCost>;
  readonly derived: RuntimeAvailability<RuntimeDerivedCost>;
}
export interface RuntimeDirectSupport {
  readonly evidence: RuntimeEvidenceReference;
  readonly method: { readonly code: 'DIRECT_RUNTIME_MEASUREMENT'; readonly version: string };
}
export interface RuntimeContextObservations {
  readonly principal: RuntimeAvailability<{ readonly value: ExecutionPrincipalReference; readonly support: RuntimeDirectSupport }>;
  readonly environment: RuntimeAvailability<{ readonly value: 'DEVELOPMENT' | 'TEST' | 'STAGING' | 'PRODUCTION'; readonly support: RuntimeDirectSupport }>;
  readonly network: RuntimeAvailability<{ readonly networkReference: string; readonly vpcReference: RuntimeAvailability<string>; readonly support: RuntimeDirectSupport }>;
}
export interface RuntimeCoverage {
  readonly sampling: RuntimeAvailability<{ readonly mode: 'ALWAYS_ON' | 'TRACE_RATIO'; readonly rate: number }>;
  readonly sampled: RuntimeAvailability<boolean>;
  readonly droppedAttributes: RuntimeAvailability<number>;
  readonly droppedEvents: RuntimeAvailability<number>;
  readonly droppedLinks: RuntimeAvailability<number>;
  readonly collectionScope: 'OPERATION_ONLY' | 'PARTIAL_TRACE';
  readonly limitations: readonly ('PARTIAL_COLLECTION' | 'MISSING_PARENT_POSSIBLE' | 'DELIVERY_NOT_GUARANTEED' | 'CLOCK_UNCERTAINTY' | 'CROSS_SOURCE_OVERLAP_POSSIBLE')[];
}
export interface RuntimeObservationEnvelope {
  readonly observationId: RuntimeObservationId;
  /** Supplied by trusted orchestration. Validation is not authentication. */
  readonly organisationId: OrganisationId;
  readonly sourceConnection: SourceConnectionReference;
  readonly sourceSystemId: SourceSystemId;
  readonly providerCode: string;
  readonly sourceConfigurationVersion: string;
  readonly sourceEventKey: string;
  readonly traceId: RuntimeTraceId;
  readonly spanId: RuntimeSpanId;
  readonly parent: RuntimeParent;
  readonly startedAtUnixNano: RuntimeUnixNano;
  readonly endedAtUnixNano: RuntimeAvailability<RuntimeUnixNano>;
  readonly sourceObservedAtUnixNano: RuntimeAvailability<RuntimeUnixNano>;
  readonly receivedAt: IsoTimestamp;
  /** UNKNOWN/NOT_SUPPLIED before persistence; only the future database assigns a known value. */
  readonly recordedAt: RuntimeAvailability<IsoTimestamp>;
  readonly binding: RuntimeSubjectBinding;
  readonly sourceStatus: 'UNSET' | 'OK' | 'ERROR';
  readonly outcome: RuntimeOutcome;
  readonly duration: RuntimeAvailability<RuntimeDuration>;
  readonly error: RuntimeAvailability<RuntimeError>;
  readonly context: RuntimeContextObservations;
  readonly provenance: {
    readonly trustState: 'OBSERVED'; readonly evidence: RuntimeEvidenceReference;
    readonly method: { readonly code: string; readonly version: string };
    readonly adapterVersion: '1.0.0'; readonly schemaVersion: '1.0.0'; readonly mappingVersion: '1.0.0';
    readonly instrumentation: { readonly name: string; readonly version: string; readonly sdkName: string; readonly sdkVersion: string };
    readonly conventions: { readonly coreTraceRevision: '1.41.0'; readonly http: RuntimeAvailability<'1.29.0'>;
      readonly genai: RuntimeUnknown; readonly mcp: RuntimeUnknown };
  };
  readonly coverage: RuntimeCoverage;
}
export type RuntimeObservation = RuntimeObservationEnvelope & (
  | { readonly kind: 'EXECUTION'; readonly operation: 'GOVERNANCE_ANSWER' | 'RUNTIME_EXECUTION'; readonly executionScope: 'OPERATION' }
  | { readonly kind: 'MODEL_CALL'; readonly operation: 'CHAT_COMPLETION' | 'EMBEDDING'; readonly target: RuntimeTarget<'MODEL'>;
      readonly reportedModel: RuntimeAvailability<string>; readonly tokens: RuntimeTokenUsage; readonly cost: RuntimeCost }
  | { readonly kind: 'TOOL_CALL'; readonly operation: 'INVOKE'; readonly target: RuntimeTarget<'TOOL'> }
  | { readonly kind: 'MCP_CALL'; readonly operation: 'tools/call' | 'resources/read' | 'prompts/get' | 'ping' | 'initialize';
      readonly target: RuntimeTarget<'MCP_SERVER'>; readonly transport: RuntimeAvailability<Exclude<McpTransport, 'UNKNOWN' | 'OTHER'>>;
      readonly toolReference: RuntimeAvailability<string>; readonly protocolResult: RuntimeAvailability<'SUCCESS' | 'ERROR'> }
  | { readonly kind: 'API_CALL'; readonly operation: 'REQUEST'; readonly target: RuntimeTarget<'API'>;
      readonly protocol: RuntimeAvailability<Exclude<ApiProtocolFamily, 'UNKNOWN' | 'OTHER'>>;
      readonly httpMethod: RuntimeAvailability<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'>;
      readonly httpStatusCode: RuntimeAvailability<number> }
);

function invalid(): never { throw new TypeError('RUNTIME_OBSERVATION_SHAPE_INVALID'); }
type Check = (value: unknown) => void;
const choice = (...values: readonly (string | number | boolean)[]): Check => value => { if (!values.includes(value as never)) invalid(); };
const pattern = (expression: RegExp): Check => value => { if (typeof value !== 'string' || !expression.test(value)) invalid(); };
const count: Check = value => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); };
const reference: Check = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value) ||
    /(?:-----BEGIN|eyJ[A-Za-z0-9_-]+\.|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]+|AKIA[A-Z0-9]{16})/.test(value) ||
    /^(?:bearer|basic|password|client[-_]?secret|api[-_]?key|authorization|cookie|access[-_]?token):/i.test(value)) invalid();
};
const uuid = pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const trace: Check = value => { pattern(/^[a-f0-9]{32}$/)(value); if (value === '0'.repeat(32)) invalid(); };
const span: Check = value => { pattern(/^[a-f0-9]{16}$/)(value); if (value === '0'.repeat(16)) invalid(); };
// Lossless strings within the V1 signed-bigint-compatible persistence range.
const nano: Check = value => {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > BigInt('9223372036854775807')) invalid();
};
const decimal = pattern(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/);
const instant: Check = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
};

/** Copy own data descriptors before inspecting discriminants. Never invokes getters/toJSON. */
function copyData(value: unknown): unknown {
  const seen = new Set<object>();
  let budget = 4096;
  function copy(item: unknown, depth: number): unknown {
    if (--budget < 0 || depth > 24) invalid();
    if (typeof item === 'string') { if (item.length > 256) invalid(); return item; }
    if (typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return item; }
    if (!item || typeof item !== 'object' || seen.has(item)) invalid();
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) invalid();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 128) invalid();
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (typeof key !== 'string') invalid();
      const descriptor = descriptors[key];
      if (!('value' in descriptor) || (!descriptor.enumerable && !(array && key === 'length'))) invalid();
      if (array && key === 'length') continue;
      if (key === '__proto__' || (array && !/^(?:0|[1-9][0-9]*)$/.test(key))) invalid();
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    if (array && (keys.length - 1 !== descriptors.length.value || (result as unknown[]).length !== descriptors.length.value)) invalid();
    seen.delete(item);
    return Object.freeze(result);
  }
  // Even hostile reflection traps must not expose a caller-controlled exception message.
  try { return copy(value, 0); } catch { return invalid(); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
const shape = (fields: Readonly<Record<string, Check>>): Check => value => {
  const item = object(value);
  if (Object.keys(item).length !== Object.keys(fields).length || Object.keys(item).some(key => !Object.hasOwn(fields, key))) invalid();
  for (const [key, check] of Object.entries(fields)) { if (!Object.hasOwn(item, key)) invalid(); check(item[key]); }
};
const unknownValue = shape({ state: choice('UNKNOWN'), reason: choice(...RUNTIME_UNKNOWN_REASONS) });
const available = (check: Check): Check => value => {
  if (object(value).state === 'UNKNOWN') unknownValue(value);
  else shape({ state: choice('KNOWN'), value: check })(value);
};
const method = shape({ code: reference, version: reference });
const evidence = shape({ organisationId: reference, connectionId: reference, observationId: uuid });
const coordinates = shape({ producerIdentity: reference, deploymentReference: available(reference), artifactDigest: available(pattern(/^[a-f0-9]{64}$/)) });
const canonical = (kind: string) => shape({ organisationId: reference, objectId: reference, kind: choice(kind) });
const binding: Check = value => {
  if (object(value).state === 'EXACT') shape({ state: choice('EXACT'), agentVersion: canonical('AGENT_VERSION'), coordinates,
    proof: shape({ organisationId: reference, connectionId: reference, deploymentBindingId: reference,
      method: choice('VERIFIED_RELEASE_ASSOCIATION_V1'), version: choice('1.0.0') }) })(value);
  else shape({ state: choice('UNRESOLVED'), coordinates, reason: choice('MISSING_REVISION_EVIDENCE', 'NO_EXACT_MAPPING', 'AMBIGUOUS_MAPPING', 'UNSUPPORTED_BINDING_PROOF') })(value);
};
const target = (kind: RuntimeTargetKind): Check => shape({
  observed: available(shape({ kind: choice(kind), providerCode: reference, sourceReference: reference })),
  canonical: available(shape({ canonicalObject: canonical(kind), proof: shape({ method: choice('EXACT_SOURCE_COORDINATES_V1'), version: choice('1.0.0'),
    mappingId: reference, providerCode: reference, sourceObject: shape({ connectionId: reference, externalType: reference, externalId: reference }) }) })),
});
const parent: Check = value => {
  switch (object(value).state) {
    case 'UNKNOWN': return unknownValue(value);
    case 'ROOT': return shape({ state: choice('ROOT') })(value);
    default: return shape({ state: choice('SPAN_REFERENCE'), parentSpanId: span })(value);
  }
};
const outcome: Check = value => object(value).state === 'UNKNOWN' ? unknownValue(value)
  : shape({ state: choice('SUCCESS', 'ERROR', 'FAILURE'), basis: choice('OTEL_STATUS', 'HTTP_STATUS', 'DIRECT_RESULT') })(value);
const errorValue: Check = value => {
  const codes: Readonly<Record<string, readonly string[]>> = { TIMEOUT: ['DEADLINE_EXCEEDED'], CANCELLED: ['OPERATION_CANCELLED'],
    TRANSPORT: ['CONNECTION_FAILED'], PROTOCOL: ['HTTP_ERROR', 'INVALID_RESPONSE'], PROVIDER: ['PROVIDER_REJECTED'], APPLICATION: ['OPERATION_FAILED'] };
  const category = object(value).category;
  if (typeof category !== 'string' || !Object.hasOwn(codes, category)) invalid();
  shape({ category: choice(category), code: choice(...codes[category]) })(value);
};
const tokenUsage = shape({ unit: choice('TOKEN'), input: available(count), output: available(count), total: available(count) });
const costScope = shape({ kind: choice('SINGLE_CALL'), observationId: uuid });
const suppliedCost = shape({ kind: choice('SUPPLIED'), amount: decimal, currency: pattern(/^[A-Z]{3}$/), scope: costScope,
  source: shape({ evidence, chargeReference: reference }) });
const derivedCost = shape({ kind: choice('DERIVED'), amount: decimal, currency: pattern(/^[A-Z]{3}$/), scope: costScope,
  pricing: shape({ sourceReference: reference, version: reference, effectiveFrom: instant, effectiveUntil: available(instant), providerCode: reference,
    modelReference: reference, serviceTier: reference, inputRate: decimal, outputRate: decimal, rateUnit: choice('PER_MILLION_TOKENS'),
    inputCoverage: choice('ALL_INPUT_TOKENS'), outputCoverage: choice('ALL_OUTPUT_TOKENS'), adjustments: choice('NONE_APPLICABLE') }),
  usageInputs: shape({ unit: choice('TOKEN'), input: count, output: count }),
  calculation: shape({ method: choice('FLAT_TWO_BUCKET_TOKEN_TARIFF'), version: choice('1.0.0'), rounding: choice('HALF_EVEN'), decimalPlaces: choice(9), roundingStage: choice('FINAL_SUM') }),
});
const directSupport = shape({ evidence, method: shape({ code: choice('DIRECT_RUNTIME_MEASUREMENT'), version: reference }) });
const context = shape({
  principal: available(shape({ value: shape({ kind: choice('SERVICE_ACCOUNT', 'OAUTH_CLIENT', 'MANAGED_IDENTITY', 'WORKLOAD_IDENTITY', 'USER_DELEGATED'),
    providerCode: reference, authorityReference: reference, principalReference: reference }), support: directSupport })),
  environment: available(shape({ value: choice('DEVELOPMENT', 'TEST', 'STAGING', 'PRODUCTION'), support: directSupport })),
  network: available(shape({ networkReference: reference, vpcReference: available(reference), support: directSupport })),
});
const coverage = shape({
  sampling: available(shape({ mode: choice('ALWAYS_ON', 'TRACE_RATIO'), rate: value => { if (typeof value !== 'number' || value < 0 || value > 1) invalid(); } })),
  sampled: available(choice(true, false)), droppedAttributes: available(count), droppedEvents: available(count), droppedLinks: available(count),
  collectionScope: choice('OPERATION_ONLY', 'PARTIAL_TRACE'), limitations: value => {
    if (!Array.isArray(value) || value.length > 5 || new Set(value).size !== value.length) invalid();
    value.forEach(choice('PARTIAL_COLLECTION', 'MISSING_PARENT_POSSIBLE', 'DELIVERY_NOT_GUARANTEED', 'CLOCK_UNCERTAINTY', 'CROSS_SOURCE_OVERLAP_POSSIBLE'));
  },
});
const common = {
  observationId: uuid, organisationId: reference, sourceConnection: shape({ connectionId: reference, sourceSystemId: reference }),
  sourceSystemId: reference, providerCode: reference, sourceConfigurationVersion: reference,
  sourceEventKey: pattern(/^[a-f0-9]{32}:[a-f0-9]{16}$/), traceId: trace, spanId: span, parent,
  startedAtUnixNano: nano, endedAtUnixNano: available(nano), sourceObservedAtUnixNano: available(nano), receivedAt: instant, recordedAt: available(instant),
  binding, sourceStatus: choice('UNSET', 'OK', 'ERROR'), outcome,
  duration: available(shape({ value: nano, unit: choice('NANOSECOND'), basis: choice('MEASURED', 'START_END_DIFFERENCE'), method })),
  error: available(errorValue), context, coverage,
  provenance: shape({ trustState: choice('OBSERVED'), evidence, method, adapterVersion: choice('1.0.0'), schemaVersion: choice('1.0.0'), mappingVersion: choice('1.0.0'),
    instrumentation: shape({ name: reference, version: reference, sdkName: reference, sdkVersion: reference }),
    conventions: shape({ coreTraceRevision: choice('1.41.0'), http: available(choice('1.29.0')), genai: unknownValue, mcp: unknownValue }) }),
};
const variants: Readonly<Record<RuntimeObservationKind, Readonly<Record<string, Check>>>> = {
  EXECUTION: { operation: choice('GOVERNANCE_ANSWER', 'RUNTIME_EXECUTION'), executionScope: choice('OPERATION') },
  MODEL_CALL: { operation: choice('CHAT_COMPLETION', 'EMBEDDING'), target: target('MODEL'), reportedModel: available(reference), tokens: tokenUsage,
    cost: shape({ supplied: available(suppliedCost), derived: available(derivedCost) }) },
  TOOL_CALL: { operation: choice('INVOKE'), target: target('TOOL') },
  MCP_CALL: { operation: choice('tools/call', 'resources/read', 'prompts/get', 'ping', 'initialize'), target: target('MCP_SERVER'),
    transport: available(choice('STDIO', 'STREAMABLE_HTTP', 'SERVER_SENT_EVENTS')), toolReference: available(reference), protocolResult: available(choice('SUCCESS', 'ERROR')) },
  API_CALL: { operation: choice('REQUEST'), target: target('API'), protocol: available(choice('HTTP', 'GRPC', 'GRAPHQL', 'WEBSOCKET', 'EVENT')),
    httpMethod: available(choice('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
    httpStatusCode: available(value => { count(value); if ((value as number) < 100 || (value as number) > 599) invalid(); }) },
};

export function runtimeUnknown(reason: RuntimeUnknownReason): RuntimeUnknown {
  choice(...RUNTIME_UNKNOWN_REASONS)(reason);
  return Object.freeze({ state: 'UNKNOWN', reason });
}
export function runtimeKnown<T>(value: T): RuntimeKnown<T> {
  if (value === '') invalid();
  return Object.freeze({ state: 'KNOWN', value: copyData(value) as T });
}
export function asRuntimeObservationId(value: string): RuntimeObservationId { uuid(value); return value as RuntimeObservationId; }
export function asRuntimeDeploymentBindingId(value: string): RuntimeDeploymentBindingId { reference(value); return value as RuntimeDeploymentBindingId; }
export function asRuntimeTraceId(value: string): RuntimeTraceId { trace(value); return value as RuntimeTraceId; }
export function asRuntimeSpanId(value: string): RuntimeSpanId { span(value); return value as RuntimeSpanId; }
export function asRuntimeUnixNano(value: string): RuntimeUnixNano { nano(value); return value as RuntimeUnixNano; }
export function asRuntimeDurationNano(value: string): RuntimeDurationNano { nano(value); return value as RuntimeDurationNano; }
export function asRuntimeDecimal(value: string): RuntimeDecimal { decimal(value); return value as RuntimeDecimal; }

/** Structural constructor only; cross-field semantics are owned by governance-review. No raw telemetry input. */
export function createRuntimeObservation(value: unknown): RuntimeObservation {
  const copied = object(copyData(value));
  if (typeof copied.kind !== 'string' || !Object.hasOwn(variants, copied.kind)) throw new TypeError('RUNTIME_KIND_UNSUPPORTED');
  const kind = copied.kind as RuntimeObservationKind;
  shape({ ...common, kind: choice(kind), ...variants[kind] })(copied);
  return copied as unknown as RuntimeObservation;
}
