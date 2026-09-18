import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api';
import { AlwaysOnSampler, BasicTracerProvider, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { bridgeEndedOpenAISpan, hrTimeToUnixNano } from '../lib/runtime/otel-runtime-producer';
import { adaptOtelSpan } from '../lib/runtime/otel-span-adapter';
import { otelContext } from './helpers/otel-fixtures';

function endedSpan(status: SpanStatusCode): ReadableSpan {
  let ended: ReadableSpan | undefined;
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'govia.producer.id': 'fixture-producer',
      'telemetry.sdk.name': 'opentelemetry', 'telemetry.sdk.version': '2.0.1' }),
    sampler: new AlwaysOnSampler(), spanProcessors: [{ onStart() {}, onEnd(span) { ended = span; }, async forceFlush() {}, async shutdown() {} }],
  });
  const span = provider.getTracer('govia.fixture', '1.0.0').startSpan('safe.fixture', { attributes: {
    'govia.observation.kind': 'MODEL_CALL', 'govia.operation': 'CHAT_COMPLETION', 'govia.model.reported': 'gpt-4o-mini',
  } }, ROOT_CONTEXT);
  span.setStatus({ code: status }); span.end(); void provider.shutdown();
  assert.ok(ended); return ended;
}

for (const code of [SpanStatusCode.UNSET, SpanStatusCode.OK, SpanStatusCode.ERROR]) {
  test(`SDK status ${code} remains distinct through bridge and real adapter`, () => {
    const dto = bridgeEndedOpenAISpan(endedSpan(code));
    assert.equal(dto.status.code, code);
    const result = adaptOtelSpan({ ...otelContext(), approvedModels: ['gpt-4o-mini'] }, dto);
    assert.equal(result.state, 'ACCEPTED');
    if (result.state !== 'ACCEPTED') return;
    assert.equal(result.observation.sourceStatus, ['UNSET', 'OK', 'ERROR'][code]);
    assert.equal(result.observation.outcome.state, ['UNKNOWN', 'SUCCESS', 'ERROR'][code]);
  });
}

test('bridge never reads excluded SDK fields, arbitrary attributes/resource or status description', () => {
  const span = endedSpan(SpanStatusCode.OK);
  const trap = { get() { throw new Error('EXCLUDED_SYNTHETIC_CONTENT'); } };
  const attributes = { ...span.attributes };
  for (const key of ['prompt', 'completion', 'messages', 'Authorization', 'error.message', 'stack', 'response.body', 'arbitrary']) {
    Object.defineProperty(attributes, key, { ...trap, enumerable: true });
  }
  const resource = resourceFromAttributes({ 'govia.producer.id': 'fixture-producer',
    'telemetry.sdk.name': 'opentelemetry', 'telemetry.sdk.version': '2.0.1' });
  Object.defineProperty(resource.attributes, 'arbitrary', { ...trap, enumerable: true });
  const status = { code: SpanStatusCode.OK }; Object.defineProperty(status, 'message', { ...trap, enumerable: true });
  // Test fixture implements public fields only; no SDK private internals accessed.
  const input = {
    ended: true, attributes, resource, status, spanContext: () => span.spanContext(), parentSpanContext: undefined,
    startTime: span.startTime, endTime: span.endTime, instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0,
  } as ReadableSpan;
  for (const key of ['name', 'events', 'links', 'duration', 'kind', 'toJSON']) Object.defineProperty(input, key, { ...trap, enumerable: true });
  const dto = bridgeEndedOpenAISpan(input);
  assert.ok(!JSON.stringify(dto).includes('EXCLUDED_SYNTHETIC_CONTENT'));
  assert.deepEqual(Object.keys(dto.resource).sort(), ['govia.producer.id', 'telemetry.sdk.name', 'telemetry.sdk.version']);
  assert.ok(!('name' in dto)); assert.ok(!('events' in dto)); assert.ok(!('links' in dto));
  assert.equal(dto.attributes['govia.usage.input_tokens'], undefined);
});

test('HrTime nanoseconds round-trip exactly at BIGINT boundary, never using full-range Number', () => {
  assert.equal(hrTimeToUnixNano([9223372036, 854775807]), '9223372036854775807');
  assert.equal(hrTimeToUnixNano([1789740000, 123456789]), '1789740000123456789');
  for (const invalid of [[-1, 0], [1, 1e9], [1.5, 0], [9223372036, 854775808], [Number.MAX_SAFE_INTEGER + 1, 0]]) {
    assert.throws(() => hrTimeToUnixNano(invalid as [number, number]), error => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'RUNTIME_PRODUCER_BRIDGE_FAILED');
      assert.equal(error.cause, undefined); return true;
    });
  }
});
