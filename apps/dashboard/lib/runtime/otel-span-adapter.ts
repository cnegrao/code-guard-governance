import {
  asRuntimeSpanId, asRuntimeTraceId, asRuntimeUnixNano, runtimeKnown as known,
  runtimeUnknown as unknown, type RuntimeAvailability, type RuntimeError,
  type RuntimeObservation, type RuntimeObservationKind, type RuntimeOutcome,
  type RuntimeSubjectBinding, type RuntimeTargetKind,
} from '@council/canonical-contracts';
import { validateRuntimeObservation } from '@council/governance-review';
import {
  OTEL_ADAPTER_SEMVER, OTEL_HTTP_REVISION, OTEL_KIND_ATTRIBUTES, OTEL_MAPPING_SEMVER,
  OTEL_METHOD_VERSION, OTEL_RUNTIME_SCHEMA_SEMVER, OTEL_TRACE_REVISION,
  type OtelAdapterContext, type OtelAdapterError, type OtelAdapterResult,
  type OtelSupportedFact, type SupportedOtelSpan,
} from './otel-contract';

const missing = () => unknown('NOT_SUPPLIED');
const unsupported = () => unknown('UNSUPPORTED');
const operations = Object.freeze({
  EXECUTION: ['GOVERNANCE_ANSWER', 'RUNTIME_EXECUTION'], MODEL_CALL: ['CHAT_COMPLETION', 'EMBEDDING'],
  TOOL_CALL: ['INVOKE'], MCP_CALL: ['tools/call', 'resources/read', 'prompts/get', 'ping', 'initialize'], API_CALL: ['REQUEST'],
});
const errors: Readonly<Record<string, RuntimeError['category']>> = Object.freeze({
  DEADLINE_EXCEEDED: 'TIMEOUT', OPERATION_CANCELLED: 'CANCELLED', CONNECTION_FAILED: 'TRANSPORT',
  HTTP_ERROR: 'PROTOCOL', INVALID_RESPONSE: 'PROTOCOL', PROVIDER_REJECTED: 'PROVIDER', OPERATION_FAILED: 'APPLICATION',
});

/** Only a metadata snapshot enters here. All reads are own data descriptors on
 * fixed paths. No traversal/serialization of raw attributes, getters or toJSON;
 * no logs, hashes, callbacks, persistence or canonical writes. Executable JS
 * proxies are not a transport format; thrown reflection errors are value-free.
 */
export function adaptOtelSpan(context: OtelAdapterContext, input: SupportedOtelSpan): OtelAdapterResult {
  let failure: OtelAdapterError = 'OTEL_INPUT_INVALID';
  const reject = (code: OtelAdapterError): never => { failure = code; throw undefined; };
  const read = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('OTEL_INPUT_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!('value' in descriptor)) reject('OTEL_INPUT_INVALID');
    return descriptor.value;
  };
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) reject('OTEL_INPUT_INVALID');
    return value as string;
  };
  // A syntax guard is only an additional restriction. Every free-text coordinate
  // must ALSO match a trusted exact allowlist; no generic URL/path redaction.
  const reference = (value: unknown): string => {
    const result = text(value);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(result) ||
      /(?:sk[-_]|gh[pousr]_|AKIA|eyJ|password|secret|authorization|bearer|cookie|api[-_]?key|access[-_]?token)/i.test(result)) {
      reject('OTEL_COORDINATE_REJECTED');
    }
    return result;
  };
  const nano = (value: unknown): string => {
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value) ||
      BigInt(value) > BigInt('9223372036854775807')) reject('OTEL_TIME_INVALID');
    return value as string;
  };
  const count = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) reject('OTEL_INPUT_INVALID');
    return value as number;
  };
  const optional = <T>(value: unknown, parse: (value: unknown) => T): RuntimeAvailability<T> =>
    value === undefined ? missing() : known(parse(value));
  const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
    if (typeof value !== 'string' || !values.includes(value as T)) reject('OTEL_SEMANTICS_UNSUPPORTED');
    return value as T;
  };
  const fact = (name: OtelSupportedFact, present: boolean): void => {
    if (present && !context.supportedFacts.includes(name)) reject('OTEL_FACT_UNSUPPORTED');
  };
  try {
    for (const list of [context.supportedKinds, context.supportedFacts, context.approvedTargets,
      context.approvedModels, context.approvedTools, context.approvedDeployments]) {
      if (!Array.isArray(list) || list.length > 128) reject('OTEL_INPUT_INVALID');
    }
    const attributes = read(input, 'attributes');
    const kind = choice(read(attributes, 'govia.observation.kind'), Object.keys(operations) as RuntimeObservationKind[]);
    if (!context.supportedKinds.includes(kind)) reject('OTEL_SEMANTICS_UNSUPPORTED');
    const attribute = (key: string): unknown => {
      if (!(OTEL_KIND_ATTRIBUTES[kind] as readonly string[]).includes(key)) reject('OTEL_INPUT_INVALID');
      return read(attributes, key);
    };
    const operation = choice(attribute('govia.operation'), operations[kind]);
    const trace = read(input, 'traceId'); const span = read(input, 'spanId');
    if (typeof trace !== 'string' || !/^[a-f0-9]{32}$/.test(trace) || trace === '0'.repeat(32)) reject('OTEL_TRACE_ID_INVALID');
    if (typeof span !== 'string' || !/^[a-f0-9]{16}$/.test(span) || span === '0'.repeat(16)) reject('OTEL_SPAN_ID_INVALID');
    const traceId = asRuntimeTraceId(trace as string); const spanId = asRuntimeSpanId(span as string);
    const parentValue = read(input, 'parentSpanId');
    let parent: RuntimeObservation['parent'] = missing();
    if (parentValue === null) parent = { state: 'ROOT' };
    else if (parentValue !== undefined) {
      if (typeof parentValue !== 'string' || !/^[a-f0-9]{16}$/.test(parentValue) ||
        parentValue === '0'.repeat(16) || parentValue === spanId) reject('OTEL_PARENT_INVALID');
      parent = { state: 'SPAN_REFERENCE', parentSpanId: asRuntimeSpanId(parentValue as string) };
    }
    fact('PARENT', parent.state !== 'UNKNOWN');
    const start = asRuntimeUnixNano(nano(read(input, 'startTimeUnixNano')));
    const end = optional(read(input, 'endTimeUnixNano'), nano);
    const sourceTime = optional(read(input, 'sourceObservedTimeUnixNano'), nano);
    if (end.state === 'KNOWN' && BigInt(end.value) < BigInt(start)) reject('OTEL_TIME_INVALID');
    fact('END_TIME', end.state === 'KNOWN'); fact('SOURCE_TIME', sourceTime.state === 'KNOWN');

    const resource = read(input, 'resource'); const scope = read(input, 'instrumentationScope');
    const producer = reference(read(resource, 'govia.producer.id'));
    const instrumentation = {
      name: reference(read(scope, 'name')), version: reference(read(scope, 'version')),
      sdkName: reference(read(resource, 'telemetry.sdk.name')), sdkVersion: reference(read(resource, 'telemetry.sdk.version')),
    };
    if (producer !== context.producerIdentity || Object.entries(instrumentation).some(([key, value]) =>
      value !== context.instrumentation[key as keyof typeof instrumentation])) reject('OTEL_SOURCE_MISMATCH');
    const deploymentRaw = read(resource, 'govia.deployment.reference');
    const artifactRaw = read(resource, 'govia.artifact.sha256');
    let deployment: RuntimeAvailability<string> = missing(); let artifact: RuntimeAvailability<string> = missing();
    if (deploymentRaw !== undefined || artifactRaw !== undefined) {
      const referenceValue = reference(deploymentRaw);
      if (typeof artifactRaw !== 'string' || !/^[a-f0-9]{64}$/.test(artifactRaw) ||
        !context.approvedDeployments.some(item => item.reference === referenceValue && item.artifactDigest === artifactRaw)) reject('OTEL_COORDINATE_REJECTED');
      deployment = known(referenceValue); artifact = known(artifactRaw as string);
    }
    const coordinates = { producerIdentity: producer, deploymentReference: deployment, artifactDigest: artifact };
    let binding: RuntimeSubjectBinding = { state: 'UNRESOLVED', coordinates,
      reason: deployment.state === 'KNOWN' ? 'NO_EXACT_MAPPING' : 'MISSING_REVISION_EVIDENCE' };
    if (context.verifiedBinding !== undefined) {
      const verified = context.verifiedBinding;
      if (verified.state !== 'EXACT' || verified.agentVersion.organisationId !== context.organisationId ||
        verified.proof.organisationId !== context.organisationId || verified.proof.connectionId !== context.connectionId ||
        verified.coordinates.producerIdentity !== producer || deployment.state !== 'KNOWN' || artifact.state !== 'KNOWN' ||
        verified.coordinates.deploymentReference.state !== 'KNOWN' || verified.coordinates.deploymentReference.value !== deployment.value ||
        verified.coordinates.artifactDigest.state !== 'KNOWN' || verified.coordinates.artifactDigest.value !== artifact.value) reject('OTEL_BINDING_INVALID');
      fact('EXACT_BINDING', true);
      binding = { state: 'EXACT', coordinates, agentVersion: verified.agentVersion, proof: verified.proof };
    }
    const statusCode = read(read(input, 'status'), 'code');
    if (statusCode !== 0 && statusCode !== 1 && statusCode !== 2) reject('OTEL_INPUT_INVALID');
    const sourceStatus = statusCode === 0 ? 'UNSET' : statusCode === 1 ? 'OK' : 'ERROR';
    let outcome: RuntimeOutcome = sourceStatus === 'UNSET' ? missing() :
      { state: sourceStatus === 'OK' ? 'SUCCESS' : 'ERROR', basis: 'OTEL_STATUS' };
    if (!context.supportedFacts.includes('OUTCOME')) outcome = unsupported();
    const errorRaw = attribute('govia.error.code');
    let error: RuntimeAvailability<RuntimeError> = errorRaw === undefined ? missing() : unsupported();
    if (typeof errorRaw === 'string' && Object.hasOwn(errors, errorRaw)) {
      fact('ERROR', true);
      error = known({ category: errors[errorRaw], code: errorRaw } as RuntimeError);
    }
    const evidence = { organisationId: context.organisationId, connectionId: context.connectionId, observationId: context.observationId };
    const traceFlags = read(input, 'traceFlags');
    if (traceFlags !== undefined && traceFlags !== 0 && traceFlags !== 1) reject('OTEL_INPUT_INVALID');
    fact('SAMPLING', traceFlags !== undefined);
    const droppedAttributes = optional(read(input, 'droppedAttributesCount'), count);
    const droppedEvents = optional(read(input, 'droppedEventsCount'), count);
    const droppedLinks = optional(read(input, 'droppedLinksCount'), count);
    fact('DROPPED_COUNTS', [droppedAttributes, droppedEvents, droppedLinks].some(value => value.state === 'KNOWN'));
    const duration = end.state === 'KNOWN' && context.supportedFacts.includes('DURATION') ? known({
      value: (BigInt(end.value) - BigInt(start)).toString(), unit: 'NANOSECOND', basis: 'START_END_DIFFERENCE',
      method: { code: 'START_END_DIFFERENCE', version: '1.0.0' },
    }) : end.state === 'KNOWN' ? unsupported() : missing();
    const common = {
      observationId: context.observationId, organisationId: context.organisationId,
      sourceConnection: { connectionId: context.connectionId, sourceSystemId: context.sourceSystemId },
      sourceSystemId: context.sourceSystemId, providerCode: context.providerCode,
      sourceConfigurationVersion: context.sourceConfigurationVersion, sourceEventKey: `${traceId}:${spanId}`,
      traceId, spanId, parent, startedAtUnixNano: start, endedAtUnixNano: end, sourceObservedAtUnixNano: sourceTime,
      receivedAt: context.receivedAt, recordedAt: missing(), binding, sourceStatus, duration, error,
      context: { principal: unsupported(), environment: unsupported(), network: unsupported() },
      provenance: { trustState: 'OBSERVED', evidence, method: { code: 'GOVIA_OTEL_SPAN', version: OTEL_METHOD_VERSION },
        adapterVersion: OTEL_ADAPTER_SEMVER, schemaVersion: OTEL_RUNTIME_SCHEMA_SEMVER, mappingVersion: OTEL_MAPPING_SEMVER, instrumentation,
        conventions: { coreTraceRevision: OTEL_TRACE_REVISION, http: kind === 'API_CALL' ? known(OTEL_HTTP_REVISION) : unsupported(),
          genai: unsupported(), mcp: unsupported() } },
      coverage: { sampling: unsupported(), sampled: traceFlags === undefined ? missing() : known(traceFlags === 1),
        droppedAttributes, droppedEvents, droppedLinks, collectionScope: 'OPERATION_ONLY',
        limitations: ['PARTIAL_COLLECTION', 'MISSING_PARENT_POSSIBLE', 'DELIVERY_NOT_GUARANTEED', 'CLOCK_UNCERTAINTY', 'CROSS_SOURCE_OVERLAP_POSSIBLE'] },
    };
    const approvedReference = (value: unknown, approved: readonly string[]): string => {
      const safe = reference(value);
      if (!approved.includes(safe)) reject('OTEL_COORDINATE_REJECTED');
      return safe;
    };
    const target = (targetKind: RuntimeTargetKind) => {
      const providerRaw = attribute('govia.target.provider'); const referenceRaw = attribute('govia.target.reference');
      if (providerRaw === undefined && referenceRaw === undefined) return { observed: missing(), canonical: missing() };
      const providerCode = reference(providerRaw); const sourceReference = reference(referenceRaw);
      const matches = context.approvedTargets.filter(item => item.kind === targetKind && item.providerCode === providerCode && item.sourceReference === sourceReference);
      if (matches.length === 0) reject('OTEL_COORDINATE_REJECTED');
      if (matches.length !== 1) reject('OTEL_TARGET_INVALID');
      fact('TARGET', true);
      const canonical = matches[0].verifiedCanonical;
      if (canonical && (canonical.canonicalObject.organisationId !== context.organisationId || canonical.canonicalObject.kind !== targetKind ||
        canonical.proof.providerCode !== providerCode || canonical.proof.sourceObject.externalId !== sourceReference)) reject('OTEL_TARGET_INVALID');
      fact('CANONICAL_TARGET', canonical !== undefined);
      return { observed: known({ kind: targetKind, providerCode, sourceReference }), canonical: canonical ? known(canonical) : missing() };
    };
    let variant: object;
    switch (kind) {
      case 'EXECUTION': variant = { executionScope: 'OPERATION' }; break;
      case 'MODEL_CALL': {
        const reportedModel = optional(attribute('govia.model.reported'), value => approvedReference(value, context.approvedModels));
        fact('TARGET', reportedModel.state === 'KNOWN');
        const tokens = { unit: 'TOKEN', input: optional(attribute('govia.usage.input_tokens'), count),
          output: optional(attribute('govia.usage.output_tokens'), count), total: optional(attribute('govia.usage.total_tokens'), count) };
        fact('TOKENS', [tokens.input, tokens.output, tokens.total].some(value => value.state === 'KNOWN'));
        variant = { target: target('MODEL'), reportedModel, tokens, cost: { supplied: unsupported(), derived: unsupported() } }; break;
      }
      case 'TOOL_CALL': variant = { target: target('TOOL') }; break;
      case 'MCP_CALL': {
        const transport = optional(attribute('govia.mcp.transport'), value => choice(value, ['STDIO', 'STREAMABLE_HTTP', 'SERVER_SENT_EVENTS']));
        const toolReference = optional(attribute('govia.mcp.tool'), value => approvedReference(value, context.approvedTools));
        const protocolResult = optional(attribute('govia.mcp.result'), value => choice(value, ['SUCCESS', 'ERROR']));
        fact('PROTOCOL', [transport, toolReference, protocolResult].some(value => value.state === 'KNOWN'));
        if ((sourceStatus === 'OK' && protocolResult.state === 'KNOWN' && protocolResult.value === 'ERROR') ||
          (sourceStatus === 'ERROR' && protocolResult.state === 'KNOWN' && protocolResult.value === 'SUCCESS')) reject('OTEL_DOMAIN_INVALID');
        if (sourceStatus === 'UNSET' && protocolResult.state === 'KNOWN' && context.supportedFacts.includes('OUTCOME')) {
          outcome = { state: protocolResult.value === 'SUCCESS' ? 'SUCCESS' : 'FAILURE', basis: 'DIRECT_RESULT' };
        }
        variant = { target: target('MCP_SERVER'), transport, toolReference, protocolResult }; break;
      }
      case 'API_CALL': {
        const protocol = optional(attribute('govia.api.protocol'), value => choice(value, ['HTTP', 'GRPC', 'GRAPHQL', 'WEBSOCKET', 'EVENT']));
        const httpMethod = optional(attribute('http.request.method'), value => choice(value, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']));
        const httpStatusCode = optional(attribute('http.response.status_code'), value => {
          const code = count(value); if (code < 100 || code > 599) reject('OTEL_INPUT_INVALID'); return code;
        });
        common.provenance.conventions.http = httpMethod.state === 'KNOWN' || httpStatusCode.state === 'KNOWN'
          ? known(OTEL_HTTP_REVISION) : unsupported();
        fact('PROTOCOL', [protocol, httpMethod, httpStatusCode].some(value => value.state === 'KNOWN'));
        if (httpStatusCode.state === 'KNOWN') {
          const code = httpStatusCode.value;
          if (sourceStatus === 'OK' && code >= 400) reject('OTEL_DOMAIN_INVALID');
          if (sourceStatus === 'UNSET' && context.supportedFacts.includes('OUTCOME')) {
            if (code >= 200 && code < 300) outcome = { state: 'SUCCESS', basis: 'HTTP_STATUS' };
            else if (code >= 400) outcome = { state: 'FAILURE', basis: 'HTTP_STATUS' };
          }
        }
        variant = { target: target('API'), protocol, httpMethod, httpStatusCode }; break;
      }
    }
    // Only freshly extracted safe metadata reaches the unchanged domain validator.
    failure = 'OTEL_DOMAIN_INVALID';
    const observation = validateRuntimeObservation({ ...common, kind, operation, outcome, ...variant });
    return Object.freeze({ state: 'ACCEPTED', observation });
  } catch {
    // Never echo exception text (including hostile traps), values, paths or causes.
    return Object.freeze({ state: 'REJECTED', code: failure });
  }
}
