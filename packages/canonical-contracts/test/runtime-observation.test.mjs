import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRuntimeObservation, runtimeKnown as known, runtimeUnknown as unknown,
  asRuntimeObservationId, asRuntimeDeploymentBindingId, asRuntimeTraceId, asRuntimeSpanId,
  asRuntimeUnixNano, asRuntimeDurationNano, asRuntimeDecimal, RUNTIME_OBSERVATION_KINDS,
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE,
} from '../src/index.ts';

const id = '11111111-1111-4111-8111-111111111111';
const trace = 'a'.repeat(32);
const span = 'b'.repeat(16);
const missing = () => unknown('NOT_SUPPLIED');
const evidence = () => ({ organisationId: 'tenant-a', connectionId: 'runtime-a', observationId: id });
const coordinates = () => ({ producerIdentity: 'governance-answer', deploymentReference: missing(), artifactDigest: missing() });
const target = kind => ({ observed: known({ kind, providerCode: 'provider', sourceReference: 'model-v1' }), canonical: missing() });
function fixture(kind = 'MODEL_CALL') {
  const common = {
    observationId: id, organisationId: 'tenant-a', sourceConnection: { connectionId: 'runtime-a', sourceSystemId: 'system-a' },
    sourceSystemId: 'system-a', providerCode: 'provider', sourceConfigurationVersion: '1',
    sourceEventKey: `${trace}:${span}`, traceId: trace, spanId: span, parent: { state: 'ROOT' },
    startedAtUnixNano: '1789516800000000001', endedAtUnixNano: missing(), sourceObservedAtUnixNano: missing(),
    receivedAt: '2026-09-16T00:00:00.000Z', recordedAt: missing(),
    binding: { state: 'UNRESOLVED', coordinates: coordinates(), reason: 'MISSING_REVISION_EVIDENCE' },
    sourceStatus: 'UNSET', outcome: missing(), duration: missing(), error: missing(),
    context: { principal: missing(), environment: missing(), network: missing() },
    provenance: { trustState: 'OBSERVED', evidence: evidence(), method: { code: 'MANUAL_SPAN', version: '1.0.0' },
      adapterVersion: '1.0.0', schemaVersion: '1.0.0', mappingVersion: '1.0.0',
      instrumentation: { name: 'govia.governance-answer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
      conventions: { coreTraceRevision: '1.41.0', http: unknown('UNSUPPORTED'), genai: unknown('UNSUPPORTED'), mcp: unknown('UNSUPPORTED') } },
    coverage: { sampling: known({ mode: 'ALWAYS_ON', rate: 1 }), sampled: known(true), droppedAttributes: missing(),
      droppedEvents: missing(), droppedLinks: missing(), collectionScope: 'OPERATION_ONLY', limitations: ['PARTIAL_COLLECTION'] },
  };
  const variants = {
    EXECUTION: { operation: 'GOVERNANCE_ANSWER', executionScope: 'OPERATION' },
    MODEL_CALL: { operation: 'CHAT_COMPLETION', target: target('MODEL'), reportedModel: missing(),
      tokens: { unit: 'TOKEN', input: missing(), output: missing(), total: missing() }, cost: { supplied: missing(), derived: missing() } },
    TOOL_CALL: { operation: 'INVOKE', target: target('TOOL') },
    MCP_CALL: { operation: 'tools/call', target: target('MCP_SERVER'), transport: known('STDIO'), toolReference: missing(), protocolResult: missing() },
    API_CALL: { operation: 'REQUEST', target: target('API'), protocol: known('HTTP'), httpMethod: known('POST'), httpStatusCode: missing() },
  };
  return structuredClone({ ...common, kind, ...variants[kind] });
}
const supplied = () => ({ kind: 'SUPPLIED', amount: '0.000001000', currency: 'USD',
  scope: { kind: 'SINGLE_CALL', observationId: id }, source: { evidence: evidence(), chargeReference: 'charge-1' } });
const derived = () => ({ kind: 'DERIVED', amount: '0.000001000', currency: 'USD', scope: { kind: 'SINGLE_CALL', observationId: id },
  pricing: { sourceReference: 'tariff', version: '1', effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: missing(),
    providerCode: 'provider', modelReference: 'model-v1', serviceTier: 'standard', inputRate: '0.10', outputRate: '0.20',
    rateUnit: 'PER_MILLION_TOKENS', inputCoverage: 'ALL_INPUT_TOKENS', outputCoverage: 'ALL_OUTPUT_TOKENS', adjustments: 'NONE_APPLICABLE' },
  usageInputs: { unit: 'TOKEN', input: 2, output: 4 },
  calculation: { method: 'FLAT_TWO_BUCKET_TOKEN_TARIFF', version: '1.0.0', rounding: 'HALF_EVEN', decimalPlaces: 9, roundingStage: 'FINAL_SUM' } });

for (const kind of RUNTIME_OBSERVATION_KINDS) test(`closed ${kind} contract`, () => {
  const input = fixture(kind);
  const result = createRuntimeObservation(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.provenance.instrumentation));
  assert.ok(Object.isFrozen(result.coverage.limitations));
  input.coverage.limitations.push('CLOCK_UNCERTAINTY');
  assert.deepEqual(result.coverage.limitations, ['PARTIAL_COLLECTION']);
});
test('UNKNOWN reasons are closed; zero and false can be explicitly KNOWN', () => {
  for (const reason of ['NOT_SUPPLIED', 'UNSUPPORTED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE']) {
    assert.deepEqual(unknown(reason), { state: 'UNKNOWN', reason });
    assert.ok(Object.isFrozen(unknown(reason)));
  }
  assert.deepEqual(known(0), { state: 'KNOWN', value: 0 });
  assert.deepEqual(known(false), { state: 'KNOWN', value: false });
  assert.throws(() => unknown('MISSING'), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
});
test('token counts preserve supplied zero and missing total without inference', () => {
  const input = fixture(); input.tokens.input = known(0); input.tokens.output = known(3);
  assert.deepEqual(createRuntimeObservation(input).tokens, input.tokens);
});
test('EXACT has a version reference and separately scoped immutable proof', () => {
  const input = fixture();
  input.binding = { state: 'EXACT', coordinates: { ...coordinates(), deploymentReference: known('deployment-1'), artifactDigest: known('c'.repeat(64)) },
    agentVersion: { organisationId: 'tenant-a', objectId: 'version-1', kind: 'AGENT_VERSION' },
    proof: { organisationId: 'tenant-a', connectionId: 'runtime-a', deploymentBindingId: 'binding-1', method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' } };
  assert.deepEqual(createRuntimeObservation(input).binding, input.binding);
  for (const key of ['proof', 'agentVersion']) {
    const bad = structuredClone(input); delete bad.binding[key];
    assert.throws(() => createRuntimeObservation(bad), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  }
});
test('independent canonical target proof remains distinct from observed coordinates', () => {
  const input = fixture();
  input.target.canonical = known({ canonicalObject: { organisationId: 'tenant-a', objectId: 'canonical-model', kind: 'MODEL' },
    proof: { method: 'EXACT_SOURCE_COORDINATES_V1', version: '1.0.0', mappingId: 'mapping-1', providerCode: 'provider',
      sourceObject: { connectionId: 'catalog-1', externalType: 'model', externalId: 'model-v1' } } });
  assert.deepEqual(createRuntimeObservation(input).target, input.target);
  const bad = structuredClone(input); delete bad.target.canonical.value.proof;
  assert.throws(() => createRuntimeObservation(bad), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
});
test('supplied and derived costs preserve decimal strings and distinct bases', () => {
  const input = fixture(); input.cost = { supplied: known(supplied()), derived: known(derived()) };
  assert.deepEqual(createRuntimeObservation(input).cost, input.cost);
  for (const key of ['pricing', 'usageInputs', 'calculation', 'scope', 'currency']) {
    const bad = structuredClone(input); delete bad.cost.derived.value[key];
    assert.throws(() => createRuntimeObservation(bad), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  }
});
test('direct context shapes require runtime support without grants', () => {
  const input = fixture(); const support = { evidence: evidence(), method: { code: 'DIRECT_RUNTIME_MEASUREMENT', version: '1' } };
  input.context = {
    principal: known({ value: { kind: 'WORKLOAD_IDENTITY', providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload' }, support }),
    environment: known({ value: 'TEST', support }), network: known({ networkReference: 'network-1', vpcReference: missing(), support }),
  };
  assert.deepEqual(createRuntimeObservation(input).context, input.context);
});
test('branded value constructors are lossless and bounded', () => {
  for (const [fn, value] of [[asRuntimeObservationId, id], [asRuntimeDeploymentBindingId, 'binding-1'], [asRuntimeTraceId, trace],
    [asRuntimeSpanId, span], [asRuntimeUnixNano, '1789516800000000001'], [asRuntimeDurationNano, '0'], [asRuntimeDecimal, '12.340000000']]) assert.equal(fn(value), value);
  for (const [fn, value] of [[asRuntimeObservationId, 'not-a-uuid'], [asRuntimeTraceId, '0'.repeat(32)], [asRuntimeSpanId, '0'.repeat(16)],
    [asRuntimeUnixNano, 1789516800000000001], [asRuntimeDurationNano, '-1'], [asRuntimeDecimal, '1e-9'], [asRuntimeDeploymentBindingId, 'Authorization:secret']]) {
    assert.throws(() => fn(value), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  }
});

for (const [name, mutate] of [
  ['extra attributes', o => { o.attributes = {}; }],
  ['nested metadata', o => { o.provenance.metadata = {}; }],
  ['malformed trace', o => { o.traceId = 'zz'; }],
  ['zero trace', o => { o.traceId = '0'.repeat(32); }],
  ['malformed span', o => { o.spanId = 'bb'; }],
  ['zero span', o => { o.spanId = '0'.repeat(16); }],
  ['numeric nanos', o => { o.startedAtUnixNano = 42; }],
  ['missing start', o => { delete o.startedAtUnixNano; }],
  ['negative tokens', o => { o.tokens.input = known(-1); }],
  ['fractional tokens', o => { o.tokens.input = known(1.5); }],
  ['unsafe tokens', o => { o.tokens.input = known(Number.MAX_SAFE_INTEGER + 1); }],
  ['negative duration', o => { o.duration = known({ value: '-1', unit: 'NANOSECOND', basis: 'MEASURED', method: { code: 'clock', version: '1' } }); }],
  ['UNRESOLVED canonical subject', o => { o.binding.agentVersion = { organisationId: 'tenant-a', objectId: 'v', kind: 'AGENT_VERSION' }; }],
  ['wrong target kind', o => { o.target.observed.value.kind = 'API'; }],
  ['wrong operation', o => { o.operation = 'HANDOFF'; }],
  ['unknown reason', o => { o.outcome.reason = 'UNKNOWN_ERROR'; }],
  ['unknown with value', o => { o.tokens.total.value = 0; }],
  ['known without value', o => { o.tokens.input = { state: 'KNOWN' }; }],
  ['unknown source status', o => { o.sourceStatus = 'SUCCESS'; }],
  ['error message', o => { o.error = known({ category: 'APPLICATION', code: 'OPERATION_FAILED', message: 'private-content' }); }],
  ['invalid error code', o => { o.error = known({ category: 'TIMEOUT', code: 'OPERATION_FAILED' }); }],
  ['estimated cost', o => { o.cost.supplied = known({ ...supplied(), kind: 'ESTIMATED' }); }],
  ['negative cost', o => { o.cost.supplied = known({ ...supplied(), amount: '-0.01' }); }],
  ['numeric cost', o => { o.cost.supplied = known({ ...supplied(), amount: 0.01 }); }],
  ['incomplete tariff', o => { const d = derived(); delete d.pricing.version; o.cost.derived = known(d); }],
  ['invalid rounding', o => { const d = derived(); d.calculation.rounding = 'GUESS'; o.cost.derived = known(d); }],
  ['invalid calendar date', o => { o.receivedAt = '2026-02-30T00:00:00.000Z'; }],
  ['unsupported schema', o => { o.provenance.schemaVersion = '2.0.0'; }],
  ['false GenAI support', o => { o.provenance.conventions.genai = known('1.0'); }],
  ['unsafe URL', o => { o.target.observed.value.sourceReference = 'https://secret@host/path?token=private'; }],
  ['credential-like reference', o => { o.binding.coordinates.producerIdentity = 'sk-123456789secret'; }],
]) test(`reject ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
});
for (const kind of ['HANDOFF', 'HANDOFF_CALL', 'MULTI_AGENT_TRANSFER', 'OTHER', 'CUSTOM', 'UNKNOWN_KIND', 'toString']) test(`unsupported kind ${kind}`, () => {
  assert.throws(() => createRuntimeObservation({ ...fixture(), kind }), { message: 'RUNTIME_KIND_UNSUPPORTED' });
});
for (const value of [undefined, null, false, 0, '']) test(`implicit UNKNOWN rejected: ${String(value)}`, () => {
  const input = fixture(); input.tokens.total = value;
  assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
});
for (const field of ['prompt', 'completion', 'requestBody', 'responseBody', 'toolArguments', 'toolResult', 'headers', 'cookies',
  'Authorization', 'apiKey', 'authToken', 'clientSecret', 'privateKey', 'baggage', 'rawException', 'stackTrace']) test(`no content field ${field}`, () => {
  assert.throws(() => createRuntimeObservation({ ...fixture(), [field]: 'PRIVATE-SENTINEL' }), error => {
    assert.equal(error.message, 'RUNTIME_OBSERVATION_SHAPE_INVALID'); assert.ok(!error.message.includes('PRIVATE-SENTINEL')); return true;
  });
});
test('accessors at discriminants, nested values and arrays are never invoked', () => {
  for (const location of ['kind', 'tokens', 'array']) {
    const input = fixture(); let calls = 0;
    const descriptor = { enumerable: true, get() { calls++; throw new Error('PRIVATE-SENTINEL'); } };
    if (location === 'kind') Object.defineProperty(input, 'kind', descriptor);
    if (location === 'tokens') Object.defineProperty(input.tokens, 'input', descriptor);
    if (location === 'array') Object.defineProperty(input.coverage.limitations, '0', descriptor);
    assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' }); assert.equal(calls, 0);
  }
});
test('symbols, hidden fields, custom prototypes, cycles and sparse arrays fail closed', () => {
  for (const mutate of [
    o => { o[Symbol('secret')] = 'secret'; }, o => { Object.defineProperty(o, 'secret', { value: 'secret' }); },
    o => { Object.setPrototypeOf(o, { secret: 'secret' }); }, o => { o.error = o; },
    o => { o.coverage.limitations = new Array(1); }, o => { o.coverage.limitations.extra = 'secret'; },
    o => { o.tokens = new Date(); },
  ]) { const input = fixture(); mutate(input); assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' }); }
});
test('EXECUTION cannot carry a target or model usage', () => {
  for (const extra of [{ target: target('MODEL') }, { tokens: fixture().tokens }, { cost: fixture().cost }]) {
    assert.throws(() => createRuntimeObservation({ ...fixture('EXECUTION'), ...extra }), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  }
});
for (const [name, construct] of [['UnixNano', asRuntimeUnixNano], ['DurationNano', asRuntimeDurationNano]]) {
  for (const value of ['0', '9223372036854775807']) test(`${name} preserves bounded value ${value}`, () => {
    assert.equal(construct(value), value);
  });
  for (const value of ['9223372036854775808', '999999999999999999999999999999']) test(`${name} rejects overflow ${value}`, () => {
    assert.throws(() => construct(value), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  });
}

for (const field of ['startedAtUnixNano', 'endedAtUnixNano', 'sourceObservedAtUnixNano', 'duration']) {
  test(`observation enforces exact nano bounds for ${field}`, () => {
    for (const value of ['0', '9223372036854775807', '9223372036854775808', '999999999999999999999999999999']) {
      const input = fixture();
      input[field] = field === 'duration'
        ? known({ value, unit: 'NANOSECOND', basis: 'MEASURED', method: { code: 'clock', version: '1' } })
        : field === 'startedAtUnixNano' ? value : known(value);
      if (value === '0' || value === '9223372036854775807') assert.deepEqual(createRuntimeObservation(input)[field], input[field]);
      else assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
    }
  });
}

test('a structurally accepted URL-shaped reference still requires source-specific admission', () => {
  const input = fixture(); input.target.observed.value.sourceReference = 'https://example.test/model';
  assert.deepEqual(createRuntimeObservation(input).target, input.target);
  assert.deepEqual(createRuntimeObservation(input).target.canonical, missing());
});

test('hostile Proxy get cannot synthesize accepted data or execute access side effects', () => {
  const input = fixture(); let calls = 0;
  // A direct-read copier would see forged valid tokens; descriptors expose invalid data.
  input.tokens = new Proxy({ unit: 'TOKEN', input: null, output: missing(), total: missing() }, {
    get(target, key) {
      calls++;
      input.sourceStatus = 'OK';
      if (key === 'input') return known(1);
      throw new Error('PRIVATE-PROXY-GET');
    },
  });
  assert.throws(() => createRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  assert.equal(calls, 0); assert.equal(input.sourceStatus, 'UNSET');
});

for (const trap of ['ownKeys', 'getOwnPropertyDescriptor']) test(`hostile Proxy ${trap} fails without leaking exception text or accepting side effects`, () => {
  const input = fixture(); let calls = 0; let accepted;
  input.tokens = new Proxy(input.tokens, {
    [trap]() {
      calls++; input.sourceStatus = 'OK';
      throw new Error(`PRIVATE-PROXY-${trap}`);
    },
  });
  assert.throws(() => { accepted = createRuntimeObservation(input); }, error => {
    assert.equal(error.message, 'RUNTIME_OBSERVATION_SHAPE_INVALID');
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes('PRIVATE-PROXY'));
    return true;
  });
  assert.equal(calls, 1); assert.equal(accepted, undefined);
  // JavaScript traps can mutate their own input; no such mutation becomes accepted output.
  assert.equal(input.sourceStatus, 'OK');
});

test('canonical taxonomies remain frozen', () => {
  assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.equal(GOVERNED_RELATIONSHIP_TYPE.HANDOFF_TO, 'HANDOFF_TO');
});
