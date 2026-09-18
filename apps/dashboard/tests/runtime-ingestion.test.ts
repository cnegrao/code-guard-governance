import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import {
  asCanonicalObjectId, asIsoTimestamp, asOrganisationId, asRuntimeDeploymentBindingId,
  asRuntimeObservationId, asSourceConnectionId, runtimeKnown,
  type RuntimeObservation,
} from '@council/canonical-contracts';
import { validatePersistedRuntimeObservation, validateRuntimeObservation } from '@council/governance-review';
import type { RuntimePersistenceContext, RuntimePersistenceResult } from '../lib/governance/runtime-persistence';
import type { RuntimeIngestionErrorCode } from '../lib/runtime/runtime-ingestion';
import { otelContext, otelSpan } from './helpers/otel-fixtures';

let ingest: typeof import('../lib/runtime/runtime-ingestion').ingestSupportedRuntimeSpan;
let IngestionError: typeof import('../lib/runtime/runtime-ingestion').RuntimeIngestionError;
let calls: { context: RuntimePersistenceContext; observation: RuntimeObservation }[];
let persist: (observation: RuntimeObservation) => RuntimePersistenceResult;
let returned: RuntimePersistenceResult;
before(async () => {
  mock.module('../lib/governance/runtime-persistence', { namedExports: {
    persistRuntimeObservation: async (context: RuntimePersistenceContext, observation: RuntimeObservation) => {
      calls.push({ context, observation });
      return persist(observation);
    },
  } });
  const boundary = await import('../lib/runtime/runtime-ingestion');
  ingest = boundary.ingestSupportedRuntimeSpan;
  IngestionError = boundary.RuntimeIngestionError;
});
beforeEach(() => {
  calls = [];
  persist = observation => {
    returned = Object.freeze({ replay: false, observation: validatePersistedRuntimeObservation({
      ...observation, recordedAt: runtimeKnown(asIsoTimestamp('2026-09-18T12:00:00.000Z')),
    }) });
    return returned;
  };
});
const persistenceContext = (): RuntimePersistenceContext => {
  const { organisationId, connectionId } = otelContext();
  return { organisationId, connectionId };
};
const safeFailure = (code: RuntimeIngestionErrorCode) => (error: unknown): boolean => {
  assert.ok(error instanceof IngestionError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(error.name, 'RuntimeIngestionError');
  assert.equal('cause' in error, false);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'name']);
  return true;
};

for (const kind of ['EXECUTION', 'MODEL_CALL'] as const) {
  test(`accepted ${kind} reaches persistence as a validated observation and returns its typed result`, async () => {
    const context = otelContext(); const trustedPersistence = persistenceContext();
    const result = await ingest(trustedPersistence, context, otelSpan(kind));
    assert.equal(calls.length, 1);
    assert.strictEqual(calls[0].context, trustedPersistence);
    assert.deepEqual(validateRuntimeObservation(calls[0].observation), calls[0].observation);
    assert.ok(Object.isFrozen(calls[0].observation));
    assert.equal(calls[0].observation.kind, kind);
    assert.equal(calls[0].observation.observationId, context.observationId);
    assert.equal(calls[0].observation.receivedAt, context.receivedAt);
    assert.deepEqual(calls[0].observation.recordedAt, { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' });
    assert.strictEqual(result, returned);
    assert.equal(result.replay, false);
    assert.equal(result.observation.recordedAt.state, 'KNOWN');
    assert.equal(result.observation.binding.state, 'UNRESOLVED');
  });
}

test('adapter rejection never calls persistence', async () => {
  await assert.rejects(ingest(persistenceContext(), otelContext(), { ...otelSpan(), traceId: 'invalid' }),
    safeFailure('RUNTIME_INGESTION_ADAPTER_REJECTED'));
  assert.equal(calls.length, 0);
});

for (const patch of [
  { organisationId: asOrganisationId('14300000-0917-4143-8143-000000000003') },
  { connectionId: asSourceConnectionId('another-runtime') },
]) {
  test(`${Object.keys(patch)[0]} mismatch fails before adaptation and persistence`, async () => {
    let telemetryReads = 0;
    const span = otelSpan();
    Object.defineProperty(span, 'attributes', { get() { telemetryReads++; throw new Error('EXCLUDED'); } });
    await assert.rejects(ingest({ ...persistenceContext(), ...patch }, otelContext(), span),
      safeFailure('RUNTIME_INGESTION_CONTEXT_MISMATCH'));
    assert.equal(calls.length, 0);
    assert.equal(telemetryReads, 0);
  });
}

test('admission failures and unknown thrown values collapse to one value-free code without logs', async t => {
  const logs = ['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir'] as const;
  const spies = logs.map(method => t.mock.method(console, method, () => {}));
  for (const failure of [new Error('RUNTIME_SOURCE_INACTIVE'), new Error('RUNTIME_REPLAY_CONFLICT'),
    new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL'), 'SYNTHETIC_PRIVATE_DATABASE_DETAIL',
    { message: 'RUNTIME_READBACK_INVALID', details: 'SYNTHETIC_PRIVATE_DATABASE_DETAIL' }]) {
    persist = () => { throw failure; };
    await assert.rejects(ingest(persistenceContext(), otelContext(), otelSpan()),
      safeFailure('RUNTIME_INGESTION_ADMISSION_REJECTED'));
  }
  assert.equal(calls.length, 5);
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});

test('readback failure uses a separate value-free code and discards the original cause', async () => {
  persist = () => { throw new Error('RUNTIME_READBACK_INVALID', { cause: 'SYNTHETIC_PRIVATE_DATABASE_DETAIL' }); };
  await assert.rejects(ingest(persistenceContext(), otelContext(), otelSpan()),
    safeFailure('RUNTIME_INGESTION_READBACK_INVALID'));
  assert.equal(calls.length, 1);
});

test('full-range source nanoseconds and derived duration survive the boundary exactly', async () => {
  for (const start of ['0', '9223372036854775806']) {
    const result = await ingest(persistenceContext(), otelContext(), { ...otelSpan(), startTimeUnixNano: start,
      endTimeUnixNano: '9223372036854775807', sourceObservedTimeUnixNano: '9223372036854775807' });
    for (const observation of [calls[calls.length - 1].observation, result.observation]) {
      assert.equal(observation.startedAtUnixNano, start);
      assert.deepEqual(observation.endedAtUnixNano, runtimeKnown('9223372036854775807'));
      assert.deepEqual(observation.sourceObservedAtUnixNano, runtimeKnown('9223372036854775807'));
      assert.equal(observation.duration.state, 'KNOWN');
      if (observation.duration.state !== 'KNOWN') throw new Error('DURATION_MISSING');
      assert.equal(observation.duration.value.value, (BigInt('9223372036854775807') - BigInt(start)).toString());
    }
  }
});

test('EXACT binding and original durable replay identity, provenance and times are preserved', async () => {
  const context = otelContext();
  const binding = {
    state: 'EXACT' as const,
    agentVersion: { organisationId: context.organisationId, objectId: asCanonicalObjectId('version-v1'), kind: 'AGENT_VERSION' as const },
    coordinates: { producerIdentity: context.producerIdentity,
      deploymentReference: runtimeKnown('release-v1'), artifactDigest: runtimeKnown('c'.repeat(64)) },
    proof: { organisationId: context.organisationId, connectionId: context.connectionId,
      deploymentBindingId: asRuntimeDeploymentBindingId('binding-v1'), method: 'VERIFIED_RELEASE_ASSOCIATION_V1' as const, version: '1.0.0' as const },
  };
  const span = { ...otelSpan(), resource: { ...otelSpan().resource,
    'govia.deployment.reference': 'release-v1', 'govia.artifact.sha256': 'c'.repeat(64) } };
  const original = await ingest(persistenceContext(), { ...context, verifiedBinding: binding }, span);
  assert.deepEqual(calls[0].observation.binding, binding);
  assert.deepEqual(original.observation.binding, binding);
  const durableReplay = Object.freeze({ replay: true, observation: original.observation });
  persist = () => durableReplay;
  const laterContext = { ...context, verifiedBinding: binding,
    observationId: asRuntimeObservationId('14300000-0917-4143-8143-000000000004'),
    receivedAt: asIsoTimestamp('2026-09-18T13:00:00.000Z') };
  const replay = await ingest(persistenceContext(), laterContext, span);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].observation.observationId, laterContext.observationId);
  assert.equal(calls[1].observation.receivedAt, laterContext.receivedAt);
  assert.strictEqual(replay, durableReplay);
  assert.equal(replay.replay, true);
  assert.equal(replay.observation.observationId, context.observationId);
  assert.equal(replay.observation.receivedAt, context.receivedAt);
  assert.deepEqual(replay.observation.binding, original.observation.binding);
  assert.deepEqual(replay.observation.provenance, original.observation.provenance);
  assert.deepEqual(replay.observation.recordedAt, original.observation.recordedAt);
});

test('excluded hostile telemetry and authority spoofing never reach persistence or logs', async t => {
  const spies = (['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir'] as const)
    .map(method => t.mock.method(console, method, () => {}));
  const marker = 'SYNTHETIC_EXCLUDED_CONTENT';
  const excluded = { marker, authorization: 'Bearer SYNTHETIC_TOKEN', password: marker };
  Object.assign(excluded, { cycle: excluded });
  const context = otelContext(); const baseSpan = otelSpan('MODEL_CALL');
  const spoof = { organisationId: marker, connectionId: marker, sourceSystemId: marker, providerCode: marker,
    sourceConfigurationVersion: marker, producerIdentity: marker, supportedKinds: [], supportedFacts: [],
    approvedTargets: [], approvedModels: [], approvedTools: [], approvedDeployments: [], verifiedBinding: excluded,
    observationId: marker, receivedAt: marker };
  const span = { ...baseSpan, ...spoof, name: marker, events: excluded, links: excluded, baggage: excluded,
    attributes: { ...baseSpan.attributes, ...spoof, prompt: excluded, completion: excluded,
      headers: excluded, body: excluded, 'tool.arguments': excluded, 'tool.result': excluded },
    resource: { ...baseSpan.resource, ...spoof }, status: { code: 0 as const, message: marker } };
  let excludedReads = 0;
  for (const object of [span, span.resource, span.attributes]) {
    Object.defineProperty(object, 'toJSON', { get() { excludedReads++; throw new Error(marker); } });
  }
  const result = await ingest(persistenceContext(), context, span);
  assert.equal(calls.length, 1);
  assert.equal(excludedReads, 0);
  const observation = calls[0].observation;
  assert.equal(observation.organisationId, context.organisationId);
  assert.equal(observation.sourceConnection.connectionId, context.connectionId);
  assert.equal(observation.sourceSystemId, context.sourceSystemId);
  assert.equal(observation.providerCode, context.providerCode);
  assert.equal(observation.sourceConfigurationVersion, context.sourceConfigurationVersion);
  assert.equal(observation.binding.state, 'UNRESOLVED');
  assert.equal(observation.kind, 'MODEL_CALL');
  assert.equal('attributes' in observation, false);
  assert.equal(JSON.stringify(calls).includes(marker), false);
  assert.equal(JSON.stringify(result).includes(marker), false);
  await assert.rejects(ingest(persistenceContext(), context, { ...span, traceId: marker }),
    safeFailure('RUNTIME_INGESTION_ADAPTER_REJECTED'));
  assert.equal(calls.length, 1);
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});
