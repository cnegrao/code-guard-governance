import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { adaptOtelSpan } from '../lib/runtime/otel-span-adapter';
import { otelContext, otelSpan } from './helpers/otel-fixtures';

let calls: { name: string; args: Record<string, any> }[] = [];
let persist: typeof import('../lib/governance/runtime-persistence').persistRuntimeObservation;
before(async () => {
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: {
    async rpc(name: string, args: Record<string, any>) {
      calls.push({ name, args });
      return { data: [{ replay: false, observation: { ...args.p_observation, recorded_at: '2026-09-17T20:00:00.000Z' } }], error: null };
    },
  } } });
  persist = (await import('../lib/governance/runtime-persistence')).persistRuntimeObservation;
});

test('all five adapter outputs pass the existing persistence API with only sanitized typed columns (mock RPC)', async () => {
  const context = otelContext(); calls = [];
  for (const kind of context.supportedKinds) {
    const input = { ...otelSpan(kind), name: 'SYNTHETIC_EXCLUDED_CONTENT', baggage: 'SYNTHETIC_EXCLUDED_CONTENT',
      endTimeUnixNano: '9223372036854775807', sourceObservedTimeUnixNano: '9223372036854775806' };
    const result = adaptOtelSpan(context, input);
    assert.equal(result.state, 'ACCEPTED');
    if (result.state !== 'ACCEPTED') throw new Error('FIXTURE_REJECTED');
    const persisted = await persist(context, result.observation);
    assert.deepEqual({ ...persisted.observation, recordedAt: result.observation.recordedAt }, result.observation);
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
