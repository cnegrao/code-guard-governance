import 'server-only';
import { randomUUID } from 'node:crypto';
import { ROOT_CONTEXT, SpanStatusCode, trace, type HrTime } from '@opentelemetry/api';
import { AlwaysOnSampler, BasicTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_TELEMETRY_SDK_NAME, ATTR_TELEMETRY_SDK_VERSION } from '@opentelemetry/semantic-conventions';
import { asIsoTimestamp, asRuntimeObservationId } from '@council/canonical-contracts';
import type { RuntimePersistenceResult } from '../governance/runtime-persistence';
import type { SupportedOtelSpan } from './otel-contract';
import { OPENAI_GOVERNANCE_MODEL, type OpenAIAnswerMetadata } from './openai-answer-metadata';
import type { RuntimeProducerErrorCode, RuntimeProducerSource } from './runtime-producer-config';

export type RuntimeProducerReport =
  | { readonly state: 'RECORDED'; readonly observations: readonly RuntimePersistenceResult[] }
  | { readonly state: 'FAILED'; readonly code: RuntimeProducerErrorCode };

function bridgeFailure(): never { throw new Error('RUNTIME_PRODUCER_BRIDGE_FAILED'); }
export function hrTimeToUnixNano(time: HrTime): string {
  const [seconds, nanos] = time;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(nanos) || nanos < 0 || nanos >= 1e9) bridgeFailure();
  const value = BigInt(seconds) * BigInt(1e9) + BigInt(nanos);
  if (value > BigInt('9223372036854775807')) bridgeFailure();
  return value.toString();
}

/** Public SDK fields only; deliberately never reads name/events/links/status
 * description, or enumerates SDK, attribute or resource objects.
 */
export function bridgeEndedOpenAISpan(span: ReadableSpan): SupportedOtelSpan {
  if (!span.ended) bridgeFailure();
  const kind = span.attributes['govia.observation.kind'];
  const operation = span.attributes['govia.operation'];
  if (!((kind === 'EXECUTION' && operation === 'GOVERNANCE_ANSWER') ||
    (kind === 'MODEL_CALL' && operation === 'CHAT_COMPLETION'))) bridgeFailure();
  const text = (value: unknown): string => typeof value === 'string' ? value : bridgeFailure();
  const count = (value: unknown): number | undefined => value === undefined ? undefined :
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : bridgeFailure();
  const status = span.status.code;
  if (status !== 0 && status !== 1 && status !== 2) bridgeFailure();
  const context = span.spanContext();
  if (context.traceFlags !== 0 && context.traceFlags !== 1) bridgeFailure();
  const attributes: SupportedOtelSpan['attributes'] = {
    'govia.observation.kind': kind, 'govia.operation': operation,
  };
  const error = span.attributes['govia.error.code'];
  if (error !== undefined) {
    if (error !== 'HTTP_ERROR' && error !== 'CONNECTION_FAILED' && error !== 'INVALID_RESPONSE') bridgeFailure();
    Object.assign(attributes, { 'govia.error.code': error });
  }
  if (kind === 'MODEL_CALL') {
    if (span.attributes['govia.model.reported'] !== OPENAI_GOVERNANCE_MODEL) bridgeFailure();
    Object.assign(attributes, {
      'govia.model.reported': OPENAI_GOVERNANCE_MODEL,
      'govia.usage.input_tokens': count(span.attributes['govia.usage.input_tokens']),
      'govia.usage.output_tokens': count(span.attributes['govia.usage.output_tokens']),
      'govia.usage.total_tokens': count(span.attributes['govia.usage.total_tokens']),
    });
  }
  return {
    traceId: context.traceId, spanId: context.spanId, parentSpanId: span.parentSpanContext?.spanId ?? null,
    startTimeUnixNano: hrTimeToUnixNano(span.startTime), endTimeUnixNano: hrTimeToUnixNano(span.endTime),
    status: { code: status },
    instrumentationScope: { name: span.instrumentationScope.name, version: text(span.instrumentationScope.version) },
    resource: {
      'govia.producer.id': text(span.resource.attributes['govia.producer.id']),
      'telemetry.sdk.name': text(span.resource.attributes[ATTR_TELEMETRY_SDK_NAME]),
      'telemetry.sdk.version': text(span.resource.attributes[ATTR_TELEMETRY_SDK_VERSION]),
    },
    attributes, traceFlags: context.traceFlags,
    droppedAttributesCount: count(span.droppedAttributesCount), droppedEventsCount: count(span.droppedEventsCount),
    droppedLinksCount: count(span.droppedLinksCount),
  };
}

/** One provider and a maximum of two ended snapshots per invocation. No global
 * registration, ambient parent, global current span, background queue or retry.
 */
export function createPrivateOpenAIProducer(source: RuntimeProducerSource) {
  const snapshots = new Map<string, SupportedOtelSpan>();
  let bridgeFailed = false;
  const processor: SpanProcessor = {
    onStart() {},
    onEnd(span) {
      try {
        if (snapshots.size >= 2) bridgeFailure();
        const snapshot = bridgeEndedOpenAISpan(span);
        snapshots.set(snapshot.spanId, snapshot);
      } catch { bridgeFailed = true; }
    },
    async forceFlush() {}, async shutdown() {},
  };
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'govia.producer.id': source.producerIdentity,
      [ATTR_TELEMETRY_SDK_NAME]: source.instrumentation.sdkName,
      [ATTR_TELEMETRY_SDK_VERSION]: source.instrumentation.sdkVersion }),
    sampler: new AlwaysOnSampler(), spanProcessors: [processor],
    spanLimits: { attributeCountLimit: 8, attributeValueLengthLimit: 128, eventCountLimit: 0, linkCountLimit: 0,
      attributePerEventCountLimit: 0, attributePerLinkCountLimit: 0 },
  });
  const tracer = provider.getTracer(source.instrumentation.name, source.instrumentation.version);
  const executionObservationId = asRuntimeObservationId(randomUUID());
  const modelObservationId = asRuntimeObservationId(randomUUID());
  const execution = tracer.startSpan('govia.governance_answer', { attributes: {
    'govia.observation.kind': 'EXECUTION', 'govia.operation': 'GOVERNANCE_ANSWER',
  } }, ROOT_CONTEXT);
  const model = tracer.startSpan('govia.openai.chat_completion', { attributes: {
    'govia.observation.kind': 'MODEL_CALL', 'govia.operation': 'CHAT_COMPLETION',
    'govia.model.reported': OPENAI_GOVERNANCE_MODEL,
  } }, trace.setSpan(ROOT_CONTEXT, execution));
  let finished = false;
  return {
    async finish(metadata?: OpenAIAnswerMetadata): Promise<RuntimeProducerReport> {
      if (finished) return { state: 'FAILED', code: 'RUNTIME_PRODUCER_BRIDGE_FAILED' };
      finished = true;
      try {
        if (metadata) {
          const status = metadata.state === 'SUCCESS' ? SpanStatusCode.OK : SpanStatusCode.ERROR;
          execution.setStatus({ code: status }); model.setStatus({ code: status });
          if (metadata.state === 'ERROR') {
            execution.setAttribute('govia.error.code', metadata.code); model.setAttribute('govia.error.code', metadata.code);
          } else {
            if (metadata.inputTokens !== undefined) model.setAttribute('govia.usage.input_tokens', metadata.inputTokens);
            if (metadata.outputTokens !== undefined) model.setAttribute('govia.usage.output_tokens', metadata.outputTokens);
            if (metadata.totalTokens !== undefined) model.setAttribute('govia.usage.total_tokens', metadata.totalTokens);
          }
        }
        model.end(); execution.end();
        await provider.shutdown();
        if (bridgeFailed || snapshots.size !== 2) return { state: 'FAILED', code: 'RUNTIME_PRODUCER_BRIDGE_FAILED' };
        let expired = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const work = async (): Promise<RuntimeProducerReport> => {
          try {
            // Disabled/unconfigured consumers never initialize privileged persistence.
            const { ingestSupportedRuntimeSpan } = await import('./runtime-ingestion');
            const observations: RuntimePersistenceResult[] = [];
            for (const [spanId, observationId] of [
              [execution.spanContext().spanId, executionObservationId], [model.spanContext().spanId, modelObservationId],
            ] as const) {
              if (expired) return { state: 'FAILED', code: 'RUNTIME_PRODUCER_TIMEOUT' };
              const span = snapshots.get(spanId);
              if (!span) return { state: 'FAILED', code: 'RUNTIME_PRODUCER_BRIDGE_FAILED' };
              observations.push(await ingestSupportedRuntimeSpan(source, {
                ...source, observationId, receivedAt: asIsoTimestamp(new Date().toISOString()),
              }, span));
            }
            return { state: 'RECORDED', observations: Object.freeze(observations) };
          } catch { return { state: 'FAILED', code: 'RUNTIME_PRODUCER_INGESTION_FAILED' }; }
        };
        try {
          return await Promise.race([work(), new Promise<RuntimeProducerReport>(resolve => {
            timer = setTimeout(() => { expired = true; resolve({ state: 'FAILED', code: 'RUNTIME_PRODUCER_TIMEOUT' }); }, 5000);
          })]);
        } finally { clearTimeout(timer); }
      } catch { return { state: 'FAILED', code: 'RUNTIME_PRODUCER_BRIDGE_FAILED' }; }
    },
  };
}
