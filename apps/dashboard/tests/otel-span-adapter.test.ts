import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock, test } from 'node:test';
import {
  asCanonicalObjectId, asExternalId, asObjectSourceMappingId, asOrganisationId, asRuntimeDeploymentBindingId,
  asSourceConnectionId, runtimeKnown as known, type RuntimeObservation, type RuntimeSubjectBinding,
} from '@council/canonical-contracts';
import { validatePersistedRuntimeObservation, validateRuntimeObservation } from '@council/governance-review';
import { adaptOtelSpan } from '../lib/runtime/otel-span-adapter';
import {
  OTEL_ADAPTER_SEMVER, OTEL_ADAPTER_VERSION, OTEL_MAPPING_SEMVER, OTEL_MAPPING_VERSION,
  OTEL_METHOD_VERSION, OTEL_RUNTIME_SCHEMA_SEMVER, OTEL_RUNTIME_SCHEMA_VERSION, type SupportedOtelSpan,
} from '../lib/runtime/otel-contract';
import { runtimeFromRow, runtimeToRow } from '../lib/governance/runtime-row';
import { otelContext, otelSpan } from './helpers/otel-fixtures';

// Mutable objects are confined to adversarial tests, never a domain transport.
type Attack = Record<string, any>;
const attack = (kind: RuntimeObservation['kind'] = 'EXECUTION'): Attack => structuredClone(otelSpan(kind));
const adapt = (input: unknown, context = otelContext()) => adaptOtelSpan(context, input as SupportedOtelSpan);
function accepted(input: unknown = otelSpan(), context = otelContext()): RuntimeObservation {
  const result = adapt(input, context);
  assert.equal(result.state, 'ACCEPTED');
  if (result.state !== 'ACCEPTED') throw new Error('FIXTURE_REJECTED');
  return result.observation;
}
function rejected(input: unknown, code?: string, context = otelContext()): void {
  const result = adapt(input, context);
  assert.equal(result.state, 'REJECTED');
  if (result.state === 'REJECTED' && code) assert.equal(result.code, code);
}

for (const kind of otelContext().supportedKinds) test(`OTel maps ${kind} to the unchanged closed domain and row codec`, () => {
  const observation = accepted(otelSpan(kind));
  assert.equal(observation.kind, kind); assert.ok(Object.isFrozen(observation));
  assert.deepEqual(validateRuntimeObservation(observation), observation);
  const persisted = validatePersistedRuntimeObservation(runtimeFromRow({ ...runtimeToRow(observation), recorded_at: otelContext().receivedAt }));
  assert.deepEqual({ ...persisted, recordedAt: observation.recordedAt }, observation);
  assert.equal(observation.binding.state, 'UNRESOLVED');
  if (observation.kind !== 'EXECUTION') assert.equal(observation.target.canonical.state, 'UNKNOWN');
});

test('qualified version identifiers stay linked to persisted semantic provenance and the independent method version', () => {
  const observation = accepted();
  const { provenance } = validatePersistedRuntimeObservation(runtimeFromRow({
    ...runtimeToRow(observation), recorded_at: otelContext().receivedAt,
  }));
  assert.equal(provenance.adapterVersion, OTEL_ADAPTER_SEMVER);
  assert.equal(provenance.mappingVersion, OTEL_MAPPING_SEMVER);
  assert.equal(provenance.schemaVersion, OTEL_RUNTIME_SCHEMA_SEMVER);
  assert.equal(OTEL_ADAPTER_VERSION, `govia-otel-span/${provenance.adapterVersion}`);
  assert.equal(OTEL_MAPPING_VERSION, `govia.runtime/${provenance.mappingVersion}`);
  assert.equal(OTEL_RUNTIME_SCHEMA_VERSION, `runtime-observation/${provenance.schemaVersion}`);
  assert.deepEqual(provenance.method, { code: 'GOVIA_OTEL_SPAN', version: OTEL_METHOD_VERSION });
});

test('unsupported semantics, generic spans and handoffs have no EXECUTION fallback', () => {
  for (const kind of ['HANDOFF', 'OTHER', 'UNKNOWN_KIND', 'CLIENT', undefined, '__proto__']) {
    const input = attack(); input.attributes['govia.observation.kind'] = kind;
    rejected(input, 'OTEL_SEMANTICS_UNSUPPORTED');
  }
  for (const operation of ['HANDOFF', 'arbitrary-name', 'INVOKE', undefined]) {
    const input = attack(); input.attributes['govia.operation'] = operation;
    rejected(input, 'OTEL_SEMANTICS_UNSUPPORTED');
  }
  rejected(otelSpan(), 'OTEL_SEMANTICS_UNSUPPORTED', { ...otelContext(), supportedKinds: ['MODEL_CALL'] });
});

test('trace/span validation is strict nonzero lowercase hexadecimal', () => {
  for (const [field, length, code] of [['traceId', 32, 'OTEL_TRACE_ID_INVALID'], ['spanId', 16, 'OTEL_SPAN_ID_INVALID']] as const) {
    for (const value of ['0'.repeat(length), 'A'.repeat(length), 'a'.repeat(length - 1), 'g'.repeat(length), 123, null]) {
      rejected({ ...otelSpan(), [field]: value }, code);
    }
  }
});

test('missing parent stays UNKNOWN; only explicit no-parent establishes ROOT; references need no lookup', () => {
  assert.deepEqual(accepted().parent, { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' });
  assert.deepEqual(accepted({ ...otelSpan(), parentSpanId: null }).parent, { state: 'ROOT' });
  assert.deepEqual(accepted({ ...otelSpan(), parentSpanId: 'd'.repeat(16) }).parent, { state: 'SPAN_REFERENCE', parentSpanId: 'd'.repeat(16) });
  for (const value of ['0'.repeat(16), 'b'.repeat(16), '', false]) rejected({ ...otelSpan(), parentSpanId: value }, 'OTEL_PARENT_INVALID');
});

test('partial spans do not invent completion, source-observed time, duration or recording', () => {
  const o = accepted();
  for (const value of [o.endedAtUnixNano, o.sourceObservedAtUnixNano, o.duration, o.recordedAt]) {
    assert.deepEqual(value, { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' });
  }
  assert.equal(o.receivedAt, otelContext().receivedAt);
  assert.equal(o.startedAtUnixNano, otelSpan().startTimeUnixNano);
});

test('supported END_TIME remains KNOWN when DURATION is unsupported', () => {
  const endTimeUnixNano = '9223372036854775807';
  const observation = accepted({ ...otelSpan(), endTimeUnixNano }, {
    ...otelContext(), supportedFacts: ['END_TIME'],
  });
  assert.deepEqual(observation.endedAtUnixNano, known(endTimeUnixNano));
  assert.deepEqual(observation.duration, { state: 'UNKNOWN', reason: 'UNSUPPORTED' });
});

test('all timestamp paths preserve full signed-bigint nanos through JSON and the frozen row codec', () => {
  const o = accepted({ ...otelSpan(), startTimeUnixNano: '1', endTimeUnixNano: '9223372036854775807', sourceObservedTimeUnixNano: '9223372036854775806' });
  assert.deepEqual(o.endedAtUnixNano, known('9223372036854775807'));
  assert.deepEqual(o.sourceObservedAtUnixNano, known('9223372036854775806'));
  assert.equal(o.duration.state, 'KNOWN');
  if (o.duration.state === 'KNOWN') assert.equal(o.duration.value.value, '9223372036854775806');
  const row = JSON.parse(JSON.stringify(runtimeToRow(o)));
  const roundTrip = validatePersistedRuntimeObservation(runtimeFromRow({ ...row, recorded_at: o.receivedAt }));
  assert.deepEqual({ ...roundTrip, recordedAt: o.recordedAt }, o);
  for (const field of ['startTimeUnixNano', 'endTimeUnixNano', 'sourceObservedTimeUnixNano']) {
    for (const value of [9223372036854775807, '9223372036854775808', '-1', '1.1', '01', null]) {
      rejected({ ...otelSpan(), [field]: value }, 'OTEL_TIME_INVALID');
    }
  }
  rejected({ ...otelSpan(), startTimeUnixNano: undefined }, 'OTEL_TIME_INVALID');
  rejected({ ...otelSpan(), endTimeUnixNano: '1' }, 'OTEL_TIME_INVALID');
});

test('OTel UNSET is never implicit success; OK/ERROR require source outcome support', () => {
  assert.equal(accepted({ ...otelSpan(), endTimeUnixNano: '1789675200000000002' }).outcome.state, 'UNKNOWN');
  for (const [code, status, outcome] of [[0, 'UNSET', 'UNKNOWN'], [1, 'OK', 'SUCCESS'], [2, 'ERROR', 'ERROR']] as const) {
    const o = accepted({ ...otelSpan(), status: { code } });
    assert.equal(o.sourceStatus, status); assert.equal(o.outcome.state, outcome);
    const restricted = accepted({ ...otelSpan(), status: { code } }, { ...otelContext(), supportedFacts: [] });
    assert.equal(restricted.sourceStatus, status); assert.equal(restricted.outcome.state, 'UNKNOWN');
  }
  rejected({ ...otelSpan(), status: { code: 3 } });
});

test('HTTP and MCP outcomes have explicit bases and reject contradictory results', () => {
  for (const [code, outcome] of [[100, 'UNKNOWN'], [204, 'SUCCESS'], [302, 'UNKNOWN'], [404, 'FAILURE'], [503, 'FAILURE']] as const) {
    const input = attack('API_CALL'); Object.assign(input.attributes, { 'govia.api.protocol': 'HTTP', 'http.request.method': 'GET', 'http.response.status_code': code });
    assert.equal(accepted(input).outcome.state, outcome);
    input.status.code = 2; assert.deepEqual(accepted(input).outcome, { state: 'ERROR', basis: 'OTEL_STATUS' });
    if (code >= 400) { input.status.code = 1; rejected(input, 'OTEL_DOMAIN_INVALID'); }
  }
  for (const result of ['SUCCESS', 'ERROR']) {
    const input = attack('MCP_CALL'); Object.assign(input.attributes, { 'govia.mcp.transport': 'STDIO', 'govia.mcp.tool': 'tool-v1', 'govia.mcp.result': result });
    assert.deepEqual(accepted(input).outcome, { state: result === 'SUCCESS' ? 'SUCCESS' : 'FAILURE', basis: 'DIRECT_RESULT' });
    input.status.code = result === 'SUCCESS' ? 2 : 1; rejected(input, 'OTEL_DOMAIN_INVALID');
  }
  const invalid = attack('API_CALL'); invalid.attributes['http.response.status_code'] = 200;
  rejected(invalid, 'OTEL_DOMAIN_INVALID');
});

test('error categories are closed; unsupported text stays UNKNOWN without inference', () => {
  const input = attack(); input.status.code = 2;
  input.attributes['govia.error.code'] = 'DEADLINE_EXCEEDED';
  assert.deepEqual(accepted(input).error, known({ category: 'TIMEOUT', code: 'DEADLINE_EXCEEDED' }));
  input.attributes['govia.error.code'] = 'some timeout text';
  assert.deepEqual(accepted(input).error, { state: 'UNKNOWN', reason: 'UNSUPPORTED' });
  input.attributes['govia.error.code'] = 'DEADLINE_EXCEEDED'; input.status.code = 1;
  rejected(input, 'OTEL_DOMAIN_INVALID');
});

test('tokens are independent facts, missing differs from zero, and no cost is estimated', () => {
  const input = attack('MODEL_CALL');
  let o = accepted(input); assert.equal(o.kind, 'MODEL_CALL');
  if (o.kind === 'MODEL_CALL') assert.equal(o.tokens.input.state, 'UNKNOWN');
  Object.assign(input.attributes, { 'govia.usage.input_tokens': 0, 'govia.usage.output_tokens': 7, 'govia.usage.total_tokens': 3, 'govia.model.reported': 'model-v1' });
  o = accepted(input);
  if (o.kind === 'MODEL_CALL') {
    assert.deepEqual(o.tokens, { unit: 'TOKEN', input: known(0), output: known(7), total: known(3) });
    assert.equal(o.cost.supplied.state, 'UNKNOWN'); assert.equal(o.cost.derived.state, 'UNKNOWN');
  }
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', NaN, Infinity]) {
    input.attributes['govia.usage.input_tokens'] = value; rejected(input);
  }
});

test('sampling flag and bounded dropped counts do not invent sampling configuration', () => {
  for (const flag of [0, 1]) {
    const o = accepted({ ...otelSpan(), traceFlags: flag, droppedAttributesCount: 0, droppedEventsCount: 2, droppedLinksCount: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(o.coverage.sampled, known(flag === 1)); assert.equal(o.coverage.sampling.state, 'UNKNOWN');
    assert.deepEqual(o.coverage.droppedAttributes, known(0));
  }
  rejected({ ...otelSpan(), traceFlags: 2 });
  rejected({ ...otelSpan(), droppedLinksCount: Number.MAX_SAFE_INTEGER + 1 });
});

test('tenant, connection and source configuration come exclusively from trusted orchestration', () => {
  const input = attack(); Object.assign(input, { organisationId: 'foreign', connectionId: 'foreign', sourceConfigurationVersion: 'foreign', binding: { state: 'EXACT' } });
  Object.assign(input.resource, { organisationId: 'foreign', connectionId: 'foreign', 'service.name': 'foreign', 'agentVersionId': 'foreign' });
  const o = accepted(input); assert.equal(o.organisationId, otelContext().organisationId);
  assert.equal(o.sourceConnection.connectionId, otelContext().connectionId); assert.equal(o.sourceConfigurationVersion, otelContext().sourceConfigurationVersion);
  assert.equal(o.binding.state, 'UNRESOLVED');
  const other = accepted(input, { ...otelContext(), organisationId: asOrganisationId('14300000-0917-4143-8143-000000000003'), connectionId: asSourceConnectionId('another') });
  assert.equal(other.sourceEventKey, o.sourceEventKey);
  assert.notEqual(other.organisationId, o.organisationId); assert.notEqual(other.sourceConnection.connectionId, o.sourceConnection.connectionId);
  input.resource['govia.producer.id'] = 'another'; rejected(input, 'OTEL_SOURCE_MISMATCH');
});

function exactBinding(): Extract<RuntimeSubjectBinding, { state: 'EXACT' }> {
  const context = otelContext();
  return { state: 'EXACT', agentVersion: { organisationId: context.organisationId, objectId: asCanonicalObjectId('version-v1'), kind: 'AGENT_VERSION' },
    coordinates: { producerIdentity: context.producerIdentity, deploymentReference: known('release-v1'), artifactDigest: known('c'.repeat(64)) },
    proof: { organisationId: context.organisationId, connectionId: context.connectionId,
      deploymentBindingId: asRuntimeDeploymentBindingId('binding-v1'), method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' } };
}

test('only trusted verified binding matching the observed approved release can become EXACT', () => {
  const input = attack(); Object.assign(input.resource, { 'govia.deployment.reference': 'release-v1', 'govia.artifact.sha256': 'c'.repeat(64) });
  input.binding = exactBinding(); input.agentVersionId = 'version-v1';
  assert.equal(accepted(input).binding.state, 'UNRESOLVED');
  const context = { ...otelContext(), verifiedBinding: exactBinding() };
  assert.deepEqual(accepted(input, context).binding, exactBinding());
  rejected(otelSpan(), 'OTEL_BINDING_INVALID', context);
  for (const mutate of [
    (b: Attack) => { b.agentVersion.organisationId = 'foreign'; },
    (b: Attack) => { b.proof.connectionId = 'foreign'; },
    (b: Attack) => { b.coordinates.artifactDigest.value = 'd'.repeat(64); },
    (b: Attack) => { b.proof.method = 'UNPROVEN'; },
  ]) {
    const binding = structuredClone(exactBinding()); mutate(binding);
    rejected(input, undefined, { ...otelContext(), verifiedBinding: binding });
  }
});

test('trusted EXACT adapter binding survives the frozen row codec and persisted validation exactly', () => {
  const verifiedBinding = exactBinding();
  const span = otelSpan();
  const observation = accepted({ ...span, resource: { ...span.resource,
    'govia.deployment.reference': 'release-v1', 'govia.artifact.sha256': 'c'.repeat(64),
  } }, { ...otelContext(), verifiedBinding });
  assert.deepEqual(observation.binding, verifiedBinding);
  const recordedAt = '2026-09-18T00:00:00.000Z'; // Synthetic database-owned timestamp; no database call.
  const persisted = validatePersistedRuntimeObservation(runtimeFromRow({
    ...runtimeToRow(observation), recorded_at: recordedAt,
  }));
  assert.equal(persisted.binding.state, 'EXACT');
  if (persisted.binding.state !== 'EXACT') throw new Error('EXACT_BINDING_LOST');
  assert.deepEqual(persisted.binding.agentVersion, verifiedBinding.agentVersion);
  assert.deepEqual(persisted.binding.coordinates, verifiedBinding.coordinates);
  assert.deepEqual(persisted.binding.proof, verifiedBinding.proof);
  assert.equal(persisted.binding.proof.deploymentBindingId, verifiedBinding.proof.deploymentBindingId);
  assert.equal(persisted.binding.proof.organisationId, verifiedBinding.proof.organisationId);
  assert.equal(persisted.binding.proof.connectionId, verifiedBinding.proof.connectionId);
  assert.equal(persisted.binding.proof.method, verifiedBinding.proof.method);
  assert.equal(persisted.binding.proof.version, verifiedBinding.proof.version);
  assert.deepEqual(persisted.recordedAt, known(recordedAt));
  assert.deepEqual({ ...persisted, recordedAt: observation.recordedAt }, observation);
});

test('observed target confers no canonical identity or relationship; trusted mapping remains independently scoped', () => {
  const context = otelContext(); const input = attack('MODEL_CALL');
  input.attributes['canonicalObjectId'] = 'model-canonical'; input.relationships = ['USES_MODEL'];
  const o = accepted(input); assert.ok(!('relationships' in o));
  if (o.kind === 'MODEL_CALL') assert.equal(o.target.canonical.state, 'UNKNOWN');
  const canonical = { canonicalObject: { organisationId: context.organisationId, objectId: asCanonicalObjectId('model-canonical'), kind: 'MODEL' as const },
    proof: { method: 'EXACT_SOURCE_COORDINATES_V1' as const, version: '1.0.0' as const, mappingId: asObjectSourceMappingId('mapping'), providerCode: 'fixture',
      sourceObject: { connectionId: asSourceConnectionId('catalog'), externalType: 'model', externalId: asExternalId('model-v1') } } };
  const approvedTargets = [{ ...context.approvedTargets[0], verifiedCanonical: canonical }];
  const exact = accepted(input, { ...context, approvedTargets });
  if (exact.kind === 'MODEL_CALL') assert.deepEqual(exact.target.canonical, known(canonical));
  canonical.canonicalObject.organisationId = asOrganisationId('foreign');
  rejected(input, 'OTEL_TARGET_INVALID', { ...context, approvedTargets });
});

test('per-kind extraction ignores irrelevant attributes and refuses unapproved safe-looking coordinates', () => {
  const input = attack();
  Object.defineProperty(input.attributes, 'govia.target.reference', { get() { throw new Error('MUST_NOT_READ'); } });
  Object.defineProperty(input.attributes, 'govia.usage.input_tokens', { get() { throw new Error('MUST_NOT_READ'); } });
  accepted(input);
  const model = attack('MODEL_CALL'); model.attributes['govia.target.reference'] = 'unapproved-but-valid';
  rejected(model, 'OTEL_COORDINATE_REJECTED');
  model.attributes['govia.target.reference'] = 'https://example.invalid/path'; rejected(model, 'OTEL_COORDINATE_REJECTED');
});

test('missing source identity, mismatched instrumentation and unsupported facts fail closed', () => {
  for (const field of ['govia.producer.id', 'telemetry.sdk.name', 'telemetry.sdk.version']) {
    const input = attack(); delete input.resource[field]; rejected(input);
  }
  const input = attack(); input.instrumentationScope.version = '2.0.0'; rejected(input, 'OTEL_SOURCE_MISMATCH');
  rejected({ ...otelSpan(), endTimeUnixNano: '1789675200000000002' }, 'OTEL_FACT_UNSUPPORTED', { ...otelContext(), supportedFacts: [] });
  rejected(otelSpan('MODEL_CALL'), 'OTEL_FACT_UNSUPPORTED', { ...otelContext(), supportedFacts: [] });
});

test('excluded hostile content never reaches observation, errors, serialization, logs or hash inputs', () => {
  const hostile = ['Authorization: Bearer SYNTHETIC_ONLY', 'sk-SYNTHETIC_ONLY_123456789', 'api_key=SYNTHETIC_ONLY',
    'eyJSYNTHETIC.payload.signature', 'password=SYNTHETIC_ONLY', 'https://user:SYNTHETIC_ONLY@example.invalid/path',
    'PROMPT_SYNTHETIC_ONLY', 'COMPLETION_SYNTHETIC_ONLY', 'TOOL_ARGUMENTS_SYNTHETIC_ONLY', 'TOOL_RESULTS_SYNTHETIC_ONLY',
    'EXCEPTION_SYNTHETIC_ONLY', 'STACK_SYNTHETIC_ONLY', 'BAGGAGE_SYNTHETIC_ONLY', '-----BEGIN PRIVATE KEY----- SYNTHETIC_ONLY'];
  let logCalls = 0;
  const mocks = (['log', 'warn', 'error', 'debug', 'info'] as const).map(method => mock.method(console, method, () => { logCalls++; }));
  try {
    const baseline = JSON.stringify(accepted(otelSpan('MODEL_CALL')));
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    for (const value of hostile) {
      const input = attack('MODEL_CALL');
      Object.assign(input, { name: value, baggage: value, events: [{ message: value, stack: value }], headers: value, toJSON: () => { throw new Error(value); } });
      Object.assign(input.status, { message: value, description: value });
      Object.assign(input.resource, { 'service.name': value, 'host.name': value, 'cloud.region': value, 'deployment.environment': value });
      Object.assign(input.attributes, { prompt: value, completion: value, 'gen_ai.input.messages': value, 'gen_ai.output.messages': value,
        'http.request.header.authorization': value, 'http.request.body': value, 'http.response.body': value,
        cookies: value, Authorization: value, 'api.key': value, 'access.token': value, 'client.secret': value,
        'tool.arguments': value, 'tool.results': value,
        'exception.message': value, 'exception.stacktrace': value, 'url.full': value, 'govia.cost.amount': value });
      const serialized = JSON.stringify(accepted(input));
      // Boolean assertions prevent accidental raw echo even if sanitization regresses.
      assert.ok(serialized === baseline, 'Excluded content changed safe output');
      assert.ok(!serialized.includes(value), 'Excluded content leaked');
      assert.equal(hash(serialized), hash(baseline)); // Hash only the sanitized observation.
      input.resource['govia.producer.id'] = value;
      const result = adapt(input);
      assert.equal(result.state, 'REJECTED'); assert.ok(!JSON.stringify(result).includes(value), 'Error echoed content');
      input.resource['govia.producer.id'] = 'fixture-producer'; input.attributes['govia.target.reference'] = value;
      const targetResult = adapt(input); assert.equal(targetResult.state, 'REJECTED');
      assert.ok(!JSON.stringify(targetResult).includes(value), 'Target error echoed content');
    }
    assert.equal(logCalls, 0);
  } finally { mocks.forEach(item => item.mock.restore()); }
});

test('excluded getters are untouched; allowed accessors/prototypes/reflection failures return value-free errors', () => {
  const input = attack(); let reads = 0;
  for (const key of ['name', 'events', 'baggage', 'toJSON']) Object.defineProperty(input, key, { get() { reads++; throw new Error('SYNTHETIC_ONLY'); } });
  accepted(input); assert.equal(reads, 0);
  Object.defineProperty(input, 'traceId', { get() { reads++; throw new Error('SYNTHETIC_ONLY'); } });
  rejected(input, 'OTEL_INPUT_INVALID'); assert.equal(reads, 0);
  rejected(Object.create(otelSpan()), 'OTEL_INPUT_INVALID');
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('SYNTHETIC_ONLY'); } });
  assert.deepEqual(adapt(proxy), { state: 'REJECTED', code: 'OTEL_INPUT_INVALID' });
  rejected(null); rejected([]);
});

test('accepted observation is deeply isolated from subsequent input/context mutation', () => {
  const input = attack('MODEL_CALL'); const context = structuredClone(otelContext());
  const o = accepted(input, context); const before = JSON.stringify(o);
  input.attributes['govia.target.reference'] = 'changed'; (context as Attack).providerCode = 'changed';
  assert.equal(JSON.stringify(o), before); assert.ok(Object.isFrozen(o.provenance.instrumentation));
});

test('the entire supported operation vocabulary is explicit and wrong-kind operations reject', () => {
  const supported = {
    EXECUTION: ['GOVERNANCE_ANSWER', 'RUNTIME_EXECUTION'], MODEL_CALL: ['CHAT_COMPLETION', 'EMBEDDING'], TOOL_CALL: ['INVOKE'],
    MCP_CALL: ['tools/call', 'resources/read', 'prompts/get', 'ping', 'initialize'], API_CALL: ['REQUEST'],
  };
  for (const kind of otelContext().supportedKinds) {
    for (const operation of supported[kind]) {
      const input = attack(kind); input.attributes['govia.operation'] = operation;
      assert.equal(accepted(input).operation, operation);
    }
    const input = attack(kind); input.attributes['govia.operation'] = 'HANDOFF'; rejected(input, 'OTEL_SEMANTICS_UNSUPPORTED');
  }
});

test('protocol fields remain closed and MCP tool reference requires tools/call', () => {
  for (const [kind, key, value] of [
    ['API_CALL', 'http.request.method', '_OTHER'], ['API_CALL', 'http.response.status_code', 600],
    ['API_CALL', 'govia.api.protocol', 'OTHER'], ['MCP_CALL', 'govia.mcp.transport', 'OTHER'],
    ['MCP_CALL', 'govia.mcp.result', 'arbitrary result'], ['MCP_CALL', 'govia.mcp.tool', 'unapproved'],
  ] as const) {
    const input = attack(kind); input.attributes[key] = value; rejected(input);
  }
  const input = attack('MCP_CALL'); input.attributes['govia.operation'] = 'ping'; input.attributes['govia.mcp.tool'] = 'tool-v1';
  rejected(input, 'OTEL_DOMAIN_INVALID');
});

test('explicit maximum start/end/source timestamps and zero counts remain exact', () => {
  const max = '9223372036854775807';
  const o = accepted({ ...otelSpan(), startTimeUnixNano: max, endTimeUnixNano: max, sourceObservedTimeUnixNano: max });
  assert.equal(o.startedAtUnixNano, max);
  if (o.duration.state === 'KNOWN') assert.equal(o.duration.value.value, '0'); else assert.fail('Missing supported duration');
  const input = attack('MODEL_CALL'); input.attributes['govia.usage.total_tokens'] = 0;
  const model = accepted(input);
  if (model.kind === 'MODEL_CALL') {
    assert.equal(model.tokens.input.state, 'UNKNOWN'); assert.equal(model.tokens.output.state, 'UNKNOWN');
    assert.deepEqual(model.tokens.total, known(0));
  }
});

test('resource labels never establish observed principal, environment or network', () => {
  const input = attack(); Object.assign(input.resource, { 'service.name': 'production', 'deployment.environment': 'PRODUCTION',
    'cloud.region': 'us-east-1', 'host.name': 'host-v1', 'network.local.address': '127.0.0.1', principal: 'admin' });
  const o = accepted(input);
  for (const value of Object.values(o.context)) assert.deepEqual(value, { state: 'UNKNOWN', reason: 'UNSUPPORTED' });
  assert.ok(!('authorization' in o)); assert.ok(!('grant' in o));
});

test('bounded work excludes arbitrary trees and rejects malformed admitted metadata', () => {
  const input = attack(); const cycle: Attack = {}; cycle.self = cycle;
  input.baggage = cycle; input.attributes.ignored = cycle;
  accepted(input);
  input.instrumentationScope.name = 'a'.repeat(257); rejected(input);
  rejected(otelSpan(), 'OTEL_INPUT_INVALID', { ...otelContext(), approvedModels: Array(129).fill('model-v1') });
  const target = attack('MODEL_CALL'); delete target.attributes['govia.target.provider']; rejected(target);
  const deployment = attack(); deployment.resource['govia.deployment.reference'] = 'release-v1'; rejected(deployment);
});

test('ambiguous approved target records reject rather than selecting a canonical mapping by order', () => {
  const context = otelContext();
  rejected(otelSpan('MODEL_CALL'), 'OTEL_TARGET_INVALID', { ...context, approvedTargets: [context.approvedTargets[0], context.approvedTargets[0]] });
});
