import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { otelContext, otelSpan } from './helpers/otel-fixtures';

let calls: { name: string; args: Record<string, any> }[] = [];
let ingest: typeof import('../lib/runtime/runtime-ingestion').ingestSupportedRuntimeSpan;
let responsePatch: Record<string, unknown>;
let error: string | undefined;
before(async () => {
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: {
    async rpc(name: string, args: Record<string, any>) {
      calls.push({ name, args });
      return error ? { data: null, error: { message: error } } : {
        data: [{ replay: false, observation: { ...args.p_observation, recorded_at: '2026-09-17T20:00:00.000Z', ...responsePatch } }], error: null,
      };
    },
  } } });
  ingest = (await import('../lib/runtime/runtime-ingestion')).ingestSupportedRuntimeSpan;
});
beforeEach(() => { calls = []; responsePatch = {}; error = undefined; });

test('all five kinds pass ingestion, real adapter and M14.2 typed persistence/readback (mock RPC only)', async () => {
  const context = otelContext(); calls = [];
  for (const kind of context.supportedKinds) {
    const input = { ...otelSpan(kind), name: 'SYNTHETIC_EXCLUDED_CONTENT', baggage: 'SYNTHETIC_EXCLUDED_CONTENT',
      endTimeUnixNano: '9223372036854775807', sourceObservedTimeUnixNano: '9223372036854775806' };
    const persisted = await ingest(context, context, input);
    assert.equal(persisted.replay, false);
    assert.equal(persisted.observation.kind, kind);
    assert.equal(persisted.observation.observationId, context.observationId);
    assert.equal(persisted.observation.receivedAt, context.receivedAt);
    assert.equal(persisted.observation.startedAtUnixNano, input.startTimeUnixNano);
    assert.deepEqual(persisted.observation.endedAtUnixNano, { state: 'KNOWN', value: input.endTimeUnixNano });
    assert.deepEqual(persisted.observation.sourceObservedAtUnixNano, { state: 'KNOWN', value: input.sourceObservedTimeUnixNano });
    assert.equal(persisted.observation.recordedAt.state, 'KNOWN');
  }
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.name, 'admit_runtime_observation');
    assert.equal(call.args.p_organisation_id, context.organisationId);
    assert.equal(call.args.p_connection_id, context.connectionId);
    assert.ok(!JSON.stringify(call).includes('SYNTHETIC_EXCLUDED_CONTENT'));
    assert.ok(!('attributes' in call.args.p_observation));
    assert.equal(call.args.p_observation.ended_nano_value, '9223372036854775807');
  }
});

test('real M14.2 admission errors are translated by ingestion without database details', async () => {
  const context = otelContext();
  for (const message of ['RUNTIME_SOURCE_INACTIVE', 'SYNTHETIC_PRIVATE_DATABASE_DETAIL']) {
    error = message;
    await assert.rejects(ingest(context, context, otelSpan()), {
      name: 'RuntimeIngestionError', code: 'RUNTIME_INGESTION_ADMISSION_REJECTED', message: 'RUNTIME_INGESTION_ADMISSION_REJECTED',
    });
  }
});

test('real M14.2 readback validation fails safely through ingestion', async () => {
  const context = otelContext();
  for (const patch of [{ recorded_at: null }, { span_id: 'c'.repeat(16) }, { ended_nano_value: 9223372036854775807 }]) {
    responsePatch = patch;
    await assert.rejects(ingest(context, context, { ...otelSpan(), endTimeUnixNano: '9223372036854775807' }), {
      name: 'RuntimeIngestionError', code: 'RUNTIME_INGESTION_READBACK_INVALID', message: 'RUNTIME_INGESTION_READBACK_INVALID',
    });
  }
});
