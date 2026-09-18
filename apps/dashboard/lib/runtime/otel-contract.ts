import type {
  IsoTimestamp, OrganisationId, RuntimeCanonicalTarget, RuntimeObservation,
  RuntimeObservationId, RuntimeObservationKind, RuntimeSubjectBinding,
  RuntimeTargetKind, SourceConnectionId, SourceSystemId,
} from '@council/canonical-contracts';

export const OTEL_ADAPTER_SEMVER = '1.0.0';
export const OTEL_MAPPING_SEMVER = '1.0.0';
export const OTEL_RUNTIME_SCHEMA_SEMVER = '1.0.0';
export const OTEL_ADAPTER_VERSION = `govia-otel-span/${OTEL_ADAPTER_SEMVER}` as const;
export const OTEL_MAPPING_VERSION = `govia.runtime/${OTEL_MAPPING_SEMVER}` as const;
export const OTEL_RUNTIME_SCHEMA_VERSION = `runtime-observation/${OTEL_RUNTIME_SCHEMA_SEMVER}` as const;
/** GOVIA_OTEL_SPAN method revision, independent of adapter/mapping/schema versions. */
export const OTEL_METHOD_VERSION = '1.0.0';
export const OTEL_TRACE_REVISION = '1.41.0';
export const OTEL_HTTP_REVISION = '1.29.0';

/** Internal snapshot DTO, NOT OTLP or SDK SpanData. No name, events or baggage. */
export interface SupportedOtelSpan {
  readonly traceId: string;
  readonly spanId: string;
  /** Omission means unknown; explicit null means the source establishes no parent. */
  readonly parentSpanId?: string | null;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano?: string;
  readonly sourceObservedTimeUnixNano?: string;
  readonly status: { readonly code: 0 | 1 | 2 };
  readonly instrumentationScope: { readonly name: string; readonly version: string };
  readonly resource: {
    readonly 'govia.producer.id': string;
    readonly 'telemetry.sdk.name': string;
    readonly 'telemetry.sdk.version': string;
    readonly 'govia.deployment.reference'?: string;
    readonly 'govia.artifact.sha256'?: string;
  };
  readonly attributes: {
    readonly 'govia.observation.kind': RuntimeObservationKind;
    readonly 'govia.operation': RuntimeObservation['operation'];
    readonly 'govia.target.provider'?: string;
    readonly 'govia.target.reference'?: string;
    readonly 'govia.model.reported'?: string;
    readonly 'govia.usage.input_tokens'?: number;
    readonly 'govia.usage.output_tokens'?: number;
    readonly 'govia.usage.total_tokens'?: number;
    readonly 'govia.error.code'?: string;
    readonly 'govia.mcp.transport'?: 'STDIO' | 'STREAMABLE_HTTP' | 'SERVER_SENT_EVENTS';
    readonly 'govia.mcp.tool'?: string;
    readonly 'govia.mcp.result'?: 'SUCCESS' | 'ERROR';
    readonly 'govia.api.protocol'?: 'HTTP' | 'GRPC' | 'GRAPHQL' | 'WEBSOCKET' | 'EVENT';
    readonly 'http.request.method'?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    readonly 'http.response.status_code'?: number;
  };
  /** Only the V1 sampled flag (0/1); does not establish a sampling rate. */
  readonly traceFlags?: 0 | 1;
  readonly droppedAttributesCount?: number;
  readonly droppedEventsCount?: number;
  readonly droppedLinksCount?: number;
}

export const OTEL_COMMON_ATTRIBUTES = Object.freeze([
  'govia.observation.kind', 'govia.operation', 'govia.error.code',
] as const);
const targetKeys = ['govia.target.provider', 'govia.target.reference'] as const;
export const OTEL_KIND_ATTRIBUTES = Object.freeze({
  EXECUTION: Object.freeze([...OTEL_COMMON_ATTRIBUTES]),
  MODEL_CALL: Object.freeze([...OTEL_COMMON_ATTRIBUTES, ...targetKeys, 'govia.model.reported',
    'govia.usage.input_tokens', 'govia.usage.output_tokens', 'govia.usage.total_tokens']),
  TOOL_CALL: Object.freeze([...OTEL_COMMON_ATTRIBUTES, ...targetKeys]),
  MCP_CALL: Object.freeze([...OTEL_COMMON_ATTRIBUTES, ...targetKeys, 'govia.mcp.transport', 'govia.mcp.tool', 'govia.mcp.result']),
  API_CALL: Object.freeze([...OTEL_COMMON_ATTRIBUTES, ...targetKeys, 'govia.api.protocol', 'http.request.method', 'http.response.status_code']),
});

/** Subset of M14.2 runtime_fact that this mapping can emit. */
export type OtelSupportedFact = 'END_TIME' | 'SOURCE_TIME' | 'PARENT' | 'TARGET' | 'CANONICAL_TARGET'
  | 'EXACT_BINDING' | 'OUTCOME' | 'DURATION' | 'ERROR' | 'TOKENS' | 'SAMPLING' | 'DROPPED_COUNTS' | 'PROTOCOL';

export interface ApprovedOtelTarget {
  readonly kind: RuntimeTargetKind;
  readonly providerCode: string;
  readonly sourceReference: string;
  /** Already independently verified tenant-local mapping, never telemetry proof. */
  readonly verifiedCanonical?: RuntimeCanonicalTarget<RuntimeTargetKind>;
}

/** Trusted orchestration only. This API does not authenticate or load configuration.
 * The caller supplies the immutable, already-authorized M14.2 source snapshot and
 * already-verified binding/mapping records. Never construct this from telemetry.
 * Admission, existence, activation, quota and replay remain M14.2 responsibilities.
 */
export interface OtelAdapterContext {
  readonly organisationId: OrganisationId;
  readonly connectionId: SourceConnectionId;
  readonly sourceSystemId: SourceSystemId;
  readonly providerCode: string;
  readonly sourceConfigurationVersion: string;
  readonly observationId: RuntimeObservationId;
  readonly receivedAt: IsoTimestamp;
  readonly producerIdentity: string;
  readonly instrumentation: RuntimeObservation['provenance']['instrumentation'];
  readonly supportedKinds: readonly RuntimeObservationKind[];
  readonly supportedFacts: readonly OtelSupportedFact[];
  readonly approvedTargets: readonly ApprovedOtelTarget[];
  readonly approvedModels: readonly string[];
  readonly approvedTools: readonly string[];
  readonly approvedDeployments: readonly { readonly reference: string; readonly artifactDigest: string }[];
  readonly verifiedBinding?: Extract<RuntimeSubjectBinding, { state: 'EXACT' }>;
}

export type OtelAdapterError = 'OTEL_INPUT_INVALID' | 'OTEL_SEMANTICS_UNSUPPORTED' | 'OTEL_TRACE_ID_INVALID'
  | 'OTEL_SPAN_ID_INVALID' | 'OTEL_PARENT_INVALID' | 'OTEL_TIME_INVALID' | 'OTEL_SOURCE_MISMATCH'
  | 'OTEL_COORDINATE_REJECTED' | 'OTEL_BINDING_INVALID' | 'OTEL_TARGET_INVALID'
  | 'OTEL_FACT_UNSUPPORTED' | 'OTEL_DOMAIN_INVALID';
export type OtelAdapterResult =
  | { readonly state: 'ACCEPTED'; readonly observation: RuntimeObservation }
  | { readonly state: 'REJECTED'; readonly code: OtelAdapterError };
