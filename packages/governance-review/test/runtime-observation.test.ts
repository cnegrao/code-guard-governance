import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  asOrganisationId, asSourceConnectionId, asSourceSystemId, asIsoTimestamp, asCanonicalObjectId, asObjectSourceMappingId, asExternalId,
  asRuntimeObservationId, asRuntimeTraceId, asRuntimeSpanId, asRuntimeUnixNano, asRuntimeDurationNano, asRuntimeDecimal, asRuntimeDeploymentBindingId,
  runtimeKnown as known, runtimeUnknown as unknown, type RuntimeObservation, type RuntimeObservationEnvelope,
  type RuntimeObservationKind, type RuntimeSubjectBinding, type RuntimeDerivedCost,
} from '@council/canonical-contracts';
import { validateRuntimeObservation } from '../src/index.ts';
import * as runtimeDomain from '../src/runtime-observation.ts';

const org = asOrganisationId('tenant-a');
const connectionId = asSourceConnectionId('runtime-a');
const id = asRuntimeObservationId('11111111-1111-4111-8111-111111111111');
const missing = () => unknown('NOT_SUPPLIED');
const evidence = () => ({ organisationId: org, connectionId, observationId: id });
function fixture(kind: RuntimeObservationKind = 'MODEL_CALL'): RuntimeObservation {
  const traceId = asRuntimeTraceId('a'.repeat(32)); const spanId = asRuntimeSpanId('b'.repeat(16));
  const common: RuntimeObservationEnvelope = {
    observationId: id, organisationId: org, sourceConnection: { connectionId, sourceSystemId: asSourceSystemId('system') },
    sourceSystemId: asSourceSystemId('system'), providerCode: 'provider', sourceConfigurationVersion: '1', sourceEventKey: `${traceId}:${spanId}`,
    traceId, spanId, parent: { state: 'ROOT' }, startedAtUnixNano: asRuntimeUnixNano('1789516800000000001'),
    endedAtUnixNano: missing(), sourceObservedAtUnixNano: missing(), receivedAt: asIsoTimestamp('2026-09-16T00:00:00.000Z'), recordedAt: missing(),
    binding: { state: 'UNRESOLVED', coordinates: { producerIdentity: 'producer', deploymentReference: missing(), artifactDigest: missing() }, reason: 'MISSING_REVISION_EVIDENCE' },
    sourceStatus: 'UNSET', outcome: missing(), duration: missing(), error: missing(),
    context: { principal: missing(), environment: missing(), network: missing() },
    provenance: { trustState: 'OBSERVED', evidence: evidence(), method: { code: 'MANUAL_SPAN', version: '1.0.0' },
      adapterVersion: '1.0.0', schemaVersion: '1.0.0', mappingVersion: '1.0.0',
      instrumentation: { name: 'govia.producer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
      conventions: { coreTraceRevision: '1.41.0', http: missing(), genai: unknown('UNSUPPORTED'), mcp: unknown('UNSUPPORTED') } },
    coverage: { sampling: known({ mode: 'ALWAYS_ON', rate: 1 }), sampled: known(true), droppedAttributes: missing(), droppedEvents: missing(),
      droppedLinks: missing(), collectionScope: 'OPERATION_ONLY', limitations: ['PARTIAL_COLLECTION'] },
  };
  switch (kind) {
    case 'EXECUTION': return { ...common, kind, operation: 'GOVERNANCE_ANSWER', executionScope: 'OPERATION' };
    case 'MODEL_CALL': return { ...common, kind, operation: 'CHAT_COMPLETION',
      target: { observed: known({ kind: 'MODEL', providerCode: 'provider', sourceReference: 'requested-model' }), canonical: missing() }, reportedModel: missing(),
      tokens: { unit: 'TOKEN', input: missing(), output: missing(), total: missing() }, cost: { supplied: missing(), derived: missing() } };
    case 'TOOL_CALL': return { ...common, kind, operation: 'INVOKE', target: { observed: missing(), canonical: missing() } };
    case 'MCP_CALL': return { ...common, kind, operation: 'tools/call', target: { observed: missing(), canonical: missing() }, transport: known('STDIO'), toolReference: missing(), protocolResult: missing() };
    case 'API_CALL': return { ...common, kind, operation: 'REQUEST', target: { observed: missing(), canonical: missing() }, protocol: known('HTTP'), httpMethod: known('GET'), httpStatusCode: missing() };
  }
}
function exact(): RuntimeSubjectBinding {
  return { state: 'EXACT', agentVersion: { organisationId: org, objectId: asCanonicalObjectId('version'), kind: 'AGENT_VERSION' },
    coordinates: { producerIdentity: 'producer', deploymentReference: known('deployment'), artifactDigest: known('c'.repeat(64)) },
    proof: { organisationId: org, connectionId, deploymentBindingId: asRuntimeDeploymentBindingId('binding'), method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' } };
}
function derived(): RuntimeDerivedCost {
  return { kind: 'DERIVED', amount: asRuntimeDecimal('0.000001'), currency: 'USD', scope: { kind: 'SINGLE_CALL', observationId: id },
    pricing: { sourceReference: 'tariff', version: '1', effectiveFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), effectiveUntil: missing(),
      providerCode: 'provider', modelReference: 'reported-model', serviceTier: 'standard', inputRate: asRuntimeDecimal('0.10'), outputRate: asRuntimeDecimal('0.20'),
      rateUnit: 'PER_MILLION_TOKENS', inputCoverage: 'ALL_INPUT_TOKENS', outputCoverage: 'ALL_OUTPUT_TOKENS', adjustments: 'NONE_APPLICABLE' },
    usageInputs: { unit: 'TOKEN', input: 2, output: 4 }, calculation: { method: 'FLAT_TWO_BUCKET_TOKEN_TARIFF', version: '1.0.0', rounding: 'HALF_EVEN', decimalPlaces: 9, roundingStage: 'FINAL_SUM' } };
}
function modelWithCost(): RuntimeObservation {
  const base = fixture(); assert.equal(base.kind, 'MODEL_CALL'); if (base.kind !== 'MODEL_CALL') throw new Error('TEST_FIXTURE_INVALID');
  return { ...base, reportedModel: known('reported-model'), tokens: { unit: 'TOKEN', input: known(2), output: known(4), total: missing() },
    cost: { supplied: known({ kind: 'SUPPLIED', amount: asRuntimeDecimal('0.000002'), currency: 'USD', scope: { kind: 'SINGLE_CALL', observationId: id },
      source: { evidence: evidence(), chargeReference: 'charge' } }), derived: known(derived()) } };
}
// Mutable unknown transport copies are deliberately used only for adversarial inputs.
type AttackInput = Record<string, any>;
const mutable = (value: RuntimeObservation = fixture()): AttackInput => structuredClone(value);
for (const kind of ['EXECUTION', 'MODEL_CALL', 'TOOL_CALL', 'MCP_CALL', 'API_CALL'] as const) test(`validate ${kind} without fabrication`, () => {
  const input = fixture(kind); const result = validateRuntimeObservation(input);
  assert.deepEqual(result, input); assert.ok(Object.isFrozen(result)); assert.equal(result.binding.state, 'UNRESOLVED');
  assert.equal(result.outcome.state, 'UNKNOWN'); assert.equal(result.sourceStatus, 'UNSET');
});
test('EXACT support is accepted structurally without resolving or granting authority', () => {
  const result = validateRuntimeObservation({ ...fixture(), binding: exact() });
  assert.equal(result.binding.state, 'EXACT'); assert.ok(!('authorization' in result));
});
test('observed target does not create canonical target', () => {
  const result = validateRuntimeObservation(fixture()); assert.equal(result.kind, 'MODEL_CALL');
  if (result.kind === 'MODEL_CALL') assert.deepEqual(result.target.canonical, missing());
});
test('exact target coordinates and proof are independently scoped', () => {
  const input = mutable(); input.target.canonical = known({ canonicalObject: { organisationId: org, objectId: asCanonicalObjectId('model'), kind: 'MODEL' },
    proof: { method: 'EXACT_SOURCE_COORDINATES_V1', version: '1.0.0', mappingId: asObjectSourceMappingId('mapping'), providerCode: 'provider',
      sourceObject: { connectionId: asSourceConnectionId('catalog'), externalType: 'model', externalId: asExternalId('requested-model') } } });
  assert.deepEqual(validateRuntimeObservation(input), input);
  for (const mutate of [(o: AttackInput) => { o.target.canonical.value.canonicalObject.organisationId = 'foreign'; },
    (o: AttackInput) => { o.target.canonical.value.proof.sourceObject.externalId = 'different'; },
    (o: AttackInput) => { o.target.canonical.value.proof.providerCode = 'different'; },
    (o: AttackInput) => { o.target.observed = missing(); }]) {
    const bad = structuredClone(input); mutate(bad);
    assert.throws(() => validateRuntimeObservation(bad), { message: 'RUNTIME_TARGET_INVALID' });
  }
});
test('nanosecond interval validates without float rounding or clock inference', () => {
  const input = { ...fixture(), endedAtUnixNano: known(asRuntimeUnixNano('1789516800000000002')),
    sourceObservedAtUnixNano: known(asRuntimeUnixNano('1')),
    receivedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
    duration: known({ value: asRuntimeDurationNano('1'), unit: 'NANOSECOND' as const, basis: 'START_END_DIFFERENCE' as const, method: { code: 'difference', version: '1' } }) };
  assert.deepEqual(validateRuntimeObservation(input), input);
});
test('supported status and direct outcomes do not collapse UNSET', () => {
  for (const [sourceStatus, state, basis] of [['OK', 'SUCCESS', 'OTEL_STATUS'], ['ERROR', 'ERROR', 'OTEL_STATUS'],
    ['UNSET', 'SUCCESS', 'DIRECT_RESULT'], ['UNSET', 'FAILURE', 'DIRECT_RESULT'], ['UNSET', 'ERROR', 'DIRECT_RESULT']]) {
    const result = validateRuntimeObservation({ ...fixture(), sourceStatus, outcome: { state, basis } });
    assert.equal(result.sourceStatus, sourceStatus); assert.equal(result.outcome.state, state);
  }
  for (const [status, state] of [[200, 'SUCCESS'], [404, 'FAILURE'], [503, 'FAILURE']] as const) {
    const result = validateRuntimeObservation({ ...fixture('API_CALL'), httpStatusCode: known(status), outcome: { state, basis: 'HTTP_STATUS' } });
    assert.equal(result.sourceStatus, 'UNSET'); assert.equal(result.outcome.state, state);
  }
});
test('supplied costs and verified derived bases coexist without cost generation or total inference', () => {
  const input = modelWithCost(); const result = validateRuntimeObservation(input); assert.deepEqual(result, input);
  if (result.kind === 'MODEL_CALL') { assert.deepEqual(result.tokens.total, missing()); assert.ok(Object.isFrozen(result.cost.derived)); }
});
test('zero counts remain KNOWN and measured duration does not manufacture an end', () => {
  const input = mutable(); input.tokens.input = known(0); input.tokens.output = known(0);
  input.duration = known({ value: '0', unit: 'NANOSECOND', basis: 'MEASURED', method: { code: 'clock', version: '1' } });
  assert.deepEqual(validateRuntimeObservation(input), input);
});
test('unresolved reasons remain explicit, with no parent inheritance', () => {
  for (const reason of ['MISSING_REVISION_EVIDENCE', 'NO_EXACT_MAPPING', 'AMBIGUOUS_MAPPING', 'UNSUPPORTED_BINDING_PROOF']) {
    const input = mutable(); input.binding.reason = reason; input.parent = { state: 'SPAN_REFERENCE', parentSpanId: 'd'.repeat(16) };
    assert.deepEqual(validateRuntimeObservation(input).binding, input.binding);
  }
});
test('source identity stays distinct across connections; receipt never replaces it', () => {
  const input = mutable(); const another = mutable(); another.sourceConnection.connectionId = 'runtime-b'; another.provenance.evidence.connectionId = 'runtime-b';
  another.receivedAt = '2026-09-17T00:00:00.000Z';
  const a = validateRuntimeObservation(input); const b = validateRuntimeObservation(another);
  assert.equal(a.sourceEventKey, b.sourceEventKey); assert.notEqual(a.sourceConnection.connectionId, b.sourceConnection.connectionId);
});

for (const [name, mutate, code] of [
  ['foreign evidence tenant', (o: AttackInput) => { o.provenance.evidence.organisationId = 'foreign'; }, 'RUNTIME_REFERENCE_INVALID'],
  ['foreign evidence connection', (o: AttackInput) => { o.provenance.evidence.connectionId = 'foreign'; }, 'RUNTIME_REFERENCE_INVALID'],
  ['foreign source system', (o: AttackInput) => { o.sourceSystemId = 'foreign'; }, 'RUNTIME_SOURCE_MISMATCH'],
  ['wrong event key', (o: AttackInput) => { o.sourceEventKey = `${'c'.repeat(32)}:${o.spanId}`; }, 'RUNTIME_EVENT_IDENTITY_INVALID'],
  ['self parent', (o: AttackInput) => { o.parent = { state: 'SPAN_REFERENCE', parentSpanId: o.spanId }; }, 'RUNTIME_EVENT_IDENTITY_INVALID'],
  ['foreign AgentVersion', (o: AttackInput) => { o.binding = structuredClone(exact()); o.binding.agentVersion.organisationId = 'foreign'; }, 'RUNTIME_BINDING_INVALID'],
  ['foreign proof tenant', (o: AttackInput) => { o.binding = structuredClone(exact()); o.binding.proof.organisationId = 'foreign'; }, 'RUNTIME_BINDING_INVALID'],
  ['foreign proof source', (o: AttackInput) => { o.binding = structuredClone(exact()); o.binding.proof.connectionId = 'foreign'; }, 'RUNTIME_BINDING_INVALID'],
  ['EXACT missing artifact', (o: AttackInput) => { o.binding = structuredClone(exact()); o.binding.coordinates.artifactDigest = missing(); }, 'RUNTIME_BINDING_INVALID'],
  ['EXACT missing deployment', (o: AttackInput) => { o.binding = structuredClone(exact()); o.binding.coordinates.deploymentReference = missing(); }, 'RUNTIME_BINDING_INVALID'],
  ['invalid interval', (o: AttackInput) => { o.endedAtUnixNano = known('1789516800000000000'); }, 'RUNTIME_TIME_INVALID'],
  ['derived duration without end', (o: AttackInput) => { o.duration = known({ value: '1', unit: 'NANOSECOND', basis: 'START_END_DIFFERENCE', method: { code: 'difference', version: '1' } }); }, 'RUNTIME_TIME_INVALID'],
  ['inaccurate duration', (o: AttackInput) => { o.endedAtUnixNano = known('1789516800000000002'); o.duration = known({ value: '2', unit: 'NANOSECOND', basis: 'START_END_DIFFERENCE', method: { code: 'difference', version: '1' } }); }, 'RUNTIME_TIME_INVALID'],
  ['UNSET success inference', (o: AttackInput) => { o.outcome = { state: 'SUCCESS', basis: 'OTEL_STATUS' }; }, 'RUNTIME_OUTCOME_INVALID'],
  ['absent error success inference', (o: AttackInput) => { o.outcome = { state: 'SUCCESS', basis: 'NO_ERROR' }; }, 'RUNTIME_OBSERVATION_SHAPE_INVALID'],
  ['success with error', (o: AttackInput) => { o.sourceStatus = 'ERROR'; o.outcome = { state: 'SUCCESS', basis: 'DIRECT_RESULT' }; }, 'RUNTIME_OUTCOME_INVALID'],
  ['success with known error', (o: AttackInput) => { o.error = known({ category: 'TIMEOUT', code: 'DEADLINE_EXCEEDED' }); o.outcome = { state: 'SUCCESS', basis: 'DIRECT_RESULT' }; }, 'RUNTIME_OUTCOME_INVALID'],
  ['MODEL HTTP basis', (o: AttackInput) => { o.outcome = { state: 'SUCCESS', basis: 'HTTP_STATUS' }; }, 'RUNTIME_OUTCOME_INVALID'],
  ['invalid sampling rate', (o: AttackInput) => { o.coverage.sampling = known({ mode: 'ALWAYS_ON', rate: 0.5 }); }, 'RUNTIME_COVERAGE_INVALID'],
] as const) test(`domain rejects ${name}`, () => {
  const input = mutable(); mutate(input); assert.throws(() => validateRuntimeObservation(input), { message: code });
});
for (const [name, mutate] of [
  ['missing usage', (o: AttackInput) => { o.tokens.input = missing(); }],
  ['mismatched usage', (o: AttackInput) => { o.cost.derived.value.usageInputs.input = 9; }],
  ['wrong provider', (o: AttackInput) => { o.cost.derived.value.pricing.providerCode = 'different'; }],
  ['wrong model', (o: AttackInput) => { o.cost.derived.value.pricing.modelReference = 'different'; }],
  ['unknown reported model', (o: AttackInput) => { o.reportedModel = missing(); }],
  ['future tariff', (o: AttackInput) => { o.cost.derived.value.pricing.effectiveFrom = '2027-01-01T00:00:00.000Z'; }],
  ['expired tariff', (o: AttackInput) => { o.cost.derived.value.pricing.effectiveUntil = known('2026-09-15T00:00:00.000Z'); }],
  ['reversed tariff interval', (o: AttackInput) => { o.cost.derived.value.pricing.effectiveUntil = known('2026-08-01T00:00:00.000Z'); }],
  ['other charge scope', (o: AttackInput) => { o.cost.supplied.value.scope.observationId = '22222222-2222-4222-8222-222222222222'; }],
] as const) test(`cost rejects ${name}`, () => {
  const input = mutable(modelWithCost()); mutate(input); assert.throws(() => validateRuntimeObservation(input), { message: 'RUNTIME_COST_INVALID' });
});
test('protocol mismatches and missing HTTP outcome support reject', () => {
  for (const patch of [{ protocol: known('GRPC'), httpStatusCode: known(200) },
    { httpStatusCode: known(404), outcome: { state: 'SUCCESS', basis: 'HTTP_STATUS' } },
    { outcome: { state: 'SUCCESS', basis: 'HTTP_STATUS' } }]) assert.throws(() => validateRuntimeObservation({ ...fixture('API_CALL'), ...patch }), /RUNTIME_(PROTOCOL|OUTCOME)_INVALID/);
  assert.throws(() => validateRuntimeObservation({ ...fixture('MCP_CALL'), operation: 'ping', toolReference: known('tool') }), { message: 'RUNTIME_PROTOCOL_INVALID' });
});
test('domain boundary rejects getters without invoking them or echoing content', () => {
  const input = mutable(); let invoked = false;
  Object.defineProperty(input.binding, 'state', { enumerable: true, get() { invoked = true; throw new Error('PRIVATE'); } });
  assert.throws(() => validateRuntimeObservation(input), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' }); assert.equal(invoked, false);
});
test('no persistence, canonical mutation, resolver, grants or drift API in this module', () => {
  assert.deepEqual(Object.keys(runtimeDomain), ['validateRuntimeObservation']);
  const source = readFileSync(new URL('../src/runtime-observation.ts', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]), ['@council/canonical-contracts']);
  const input = mutable(); const before = structuredClone(input); validateRuntimeObservation(input); assert.deepEqual(input, before);
  for (const extra of [{ authorization: 'ALLOWED' }, { grant: true }, { canonicalRelationship: 'USES_MODEL' }, { drift: true }, { executionSnapshot: {} }]) {
    assert.throws(() => validateRuntimeObservation({ ...input, ...extra }), { message: 'RUNTIME_OBSERVATION_SHAPE_INVALID' });
  }
});

test('pre-persistence recordedAt accepts only UNKNOWN(NOT_SUPPLIED)', () => {
  assert.deepEqual(validateRuntimeObservation(fixture()).recordedAt, missing());
  for (const recordedAt of [known('2019-01-01T00:00:00.000Z'), known('2027-01-01T00:00:00.000Z'),
    unknown('UNSUPPORTED'), unknown('INSUFFICIENT_EVIDENCE'), unknown('NOT_APPLICABLE')]) {
    assert.throws(() => validateRuntimeObservation({ ...fixture(), recordedAt }), { message: 'RUNTIME_TIME_INVALID' });
  }
});

test('generic tokens preserve independent supplied facts without imposing provider-specific sums', () => {
  const input = mutable(); input.tokens = { unit: 'TOKEN', input: known(2), output: known(4), total: known(9) };
  const result = validateRuntimeObservation(input); assert.equal(result.kind, 'MODEL_CALL');
  if (result.kind !== 'MODEL_CALL') return;
  assert.deepEqual(result.tokens, input.tokens);
  assert.deepEqual(result.cost, { supplied: missing(), derived: missing() });
  input.tokens.input = missing(); input.tokens.output = missing();
  const partial = validateRuntimeObservation(input);
  if (partial.kind === 'MODEL_CALL') assert.deepEqual(partial.tokens, input.tokens);
});

test('independent cost bases may use different currencies and are never summed or normalized', () => {
  const input = mutable(modelWithCost()); input.cost.supplied.value.currency = 'EUR';
  const result = validateRuntimeObservation(input); assert.equal(result.kind, 'MODEL_CALL');
  if (result.kind !== 'MODEL_CALL') return;
  assert.deepEqual(result.cost, input.cost);
  assert.deepEqual(Object.keys(result.cost).sort(), ['derived', 'supplied']);
  assert.deepEqual(result.tokens.total, missing());
});

for (const [name, inputTokens, outputTokens, inputRate, outputRate, amount, incorrect] of [
  ['exact decimal rates', 2, 4, '0.10', '0.20', '0.000001000', '0.000001001'],
  ['below midpoint', 1, 0, '0.000499999', '0', '0', '0.000000001'],
  ['midpoint to even zero', 1, 0, '0.0005', '0', '0', '0.000000001'],
  ['midpoint to even nonzero', 1, 0, '0.0025', '0', '0.000000002', '0.000000003'],
  ['midpoint away from odd', 1, 0, '0.0015', '0', '0.000000002', '0.000000001'],
  ['above midpoint', 1, 0, '0.000500001', '0', '0.000000001', '0'],
  ['zero tokens with maximum rates', 0, 0, '999999999999999999.999999999', '999999999999999999.999999999', '0', '0.000000001'],
  ['round only final sum', 1, 1, '0.0005', '0.0005', '0.000000001', '0'],
  ['maximum safe token count', Number.MAX_SAFE_INTEGER, 0, '1', '0', '9007199254.740991', '9007199254.740992'],
  ['large products beyond number precision', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '1000000', '1000000', '18014398509481982', '18014398509481981'],
] as const) test(`declared derived amount validates exactly: ${name}`, () => {
  const input = mutable(modelWithCost());
  input.tokens.input = known(inputTokens); input.tokens.output = known(outputTokens);
  const cost = input.cost.derived.value;
  cost.usageInputs.input = inputTokens; cost.usageInputs.output = outputTokens;
  cost.pricing.inputRate = inputRate; cost.pricing.outputRate = outputRate; cost.amount = amount;
  assert.deepEqual(validateRuntimeObservation(input), input);
  cost.amount = incorrect;
  assert.throws(() => validateRuntimeObservation(input), { message: 'RUNTIME_COST_INVALID' });
});

test('ERROR and FAILURE cannot exchange their OTel or HTTP basis', () => {
  assert.throws(() => validateRuntimeObservation({ ...fixture(), sourceStatus: 'ERROR', outcome: { state: 'FAILURE', basis: 'OTEL_STATUS' } }),
    { message: 'RUNTIME_OUTCOME_INVALID' });
  assert.throws(() => validateRuntimeObservation({ ...fixture('API_CALL'), httpStatusCode: known(503), outcome: { state: 'ERROR', basis: 'HTTP_STATUS' } }),
    { message: 'RUNTIME_OUTCOME_INVALID' });
});

function withContext(): AttackInput {
  const input = mutable();
  const support = { evidence: evidence(), method: { code: 'DIRECT_RUNTIME_MEASUREMENT', version: '1' } };
  input.context = {
    principal: known({ value: { kind: 'WORKLOAD_IDENTITY', providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload' }, support }),
    environment: known({ value: 'TEST', support }),
    network: known({ networkReference: 'network-1', vpcReference: missing(), support }),
  };
  return structuredClone(input);
}
test('direct context facts preserve evidence scoped to this tenant, source and observation', () => {
  const input = withContext(); assert.deepEqual(validateRuntimeObservation(input), input);
});
for (const context of ['principal', 'environment', 'network']) {
  for (const [field, foreign] of [['organisationId', 'foreign-tenant'], ['connectionId', 'foreign-source'],
    ['observationId', '22222222-2222-4222-8222-222222222222']]) {
    test(`${context} support rejects foreign ${field}`, () => {
      const input = withContext(); input.context[context].value.support.evidence[field] = foreign;
      assert.throws(() => validateRuntimeObservation(input), { message: 'RUNTIME_REFERENCE_INVALID' });
    });
  }
}

// Compile-time regressions: these declarations are checked by the package typecheck.
function typeBoundaries(): void {
  // @ts-expect-error handoff is not a runtime observation kind
  const kind: RuntimeObservationKind = 'HANDOFF';
  // @ts-expect-error AGENT is not an exact runtime subject
  const subject: Extract<RuntimeSubjectBinding, { state: 'EXACT' }>['agentVersion'] = { organisationId: org, objectId: asCanonicalObjectId('agent'), kind: 'AGENT' };
  // @ts-expect-error model observations cannot target an API
  const target: Extract<RuntimeObservation, { kind: 'MODEL_CALL' }>['target']['observed'] = known({ kind: 'API', providerCode: 'provider', sourceReference: 'api' });
  void kind; void subject; void target;
}
void typeBoundaries;
