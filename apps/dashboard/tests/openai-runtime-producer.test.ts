import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, mock, test } from 'node:test';
import { trace, context } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { getLLMProvider } from '../lib/llm';
import { loadRuntimeProducerConfiguration } from '../lib/runtime/runtime-producer-config';
import { openaiSourceConfiguration } from './helpers/openai-producer-fixtures';
import type { RuntimeObservationReport } from '../lib/runtime/openai-governance-answer-producer';
import type { RuntimePersistenceResult } from '../lib/governance/runtime-persistence';

type Row = Record<string, unknown>;
type RpcArgs = { p_organisation_id: string; p_connection_id: string; p_observation: Row };
let calls: { name: string; args: RpcArgs }[];
let rpcFailure: 'ADMISSION' | 'READBACK' | 'THROW' | 'HANG' | undefined;
let run: typeof import('../lib/runtime/openai-governance-answer-producer').generateGovernanceAnswer;
let notices: unknown[][];
let report: RuntimeObservationReport | undefined;
const marker = 'EXCLUDED_SYNTHETIC_CONTENT';
const envKeys = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OLLAMA_MODEL', 'OLLAMA_BASE_URL',
  'GOVIA_RUNTIME_OPENAI_ENABLED', 'GOVIA_RUNTIME_OPENAI_SOURCE'];
const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
before(async () => {
  // Structural integration mocks ONLY privileged RPC and the provider network.
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: {
    async rpc(name: string, args: RpcArgs) {
      calls.push({ name, args });
      if (rpcFailure === 'HANG') return new Promise(() => {});
      if (rpcFailure === 'THROW') throw new Error(marker);
      if (rpcFailure === 'ADMISSION') return { data: null, error: { message: marker } };
      return { data: [{ replay: false, observation: { ...args.p_observation,
        recorded_at: rpcFailure === 'READBACK' ? null : '2026-09-18T15:00:00.000Z' } }], error: null };
    },
  } } });
  run = (await import('../lib/runtime/openai-governance-answer-producer')).generateGovernanceAnswer;
});
beforeEach(() => {
  calls = []; notices = []; report = undefined; rpcFailure = undefined;
  process.env.LLM_PROVIDER = 'openai'; process.env.OPENAI_API_KEY = marker;
  process.env.GOVIA_RUNTIME_OPENAI_ENABLED = '1';
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(openaiSourceConfiguration());
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    mock.method(console, method, (...args: unknown[]) => { notices.push(args); });
  }
});
afterEach(() => {
  // Boolean-only assertion: never echo raw fixtures or responses in failure output.
  assert.ok(!JSON.stringify({ calls, notices, report }).includes(marker));
  mock.restoreAll();
  for (const [key, value] of originalEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
function success(usage?: unknown) {
  return { choices: [{ message: { content: `  ${marker} answer  ` } }], usage, model: `${marker}-model`,
    headers: marker, request: marker, arbitrary: marker, error: { message: marker }, cost: 99 };
}
function fetchResponse(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
}
async function invoke(organisationId = openaiSourceConfiguration().organisationId) {
  return run(getLLMProvider(), organisationId, `${marker}-system`, `${marker}-context`, `${marker}-query`, value => { report = value; });
}
function observations(): readonly RuntimePersistenceResult[] {
  assert.equal(report?.state, 'RECORDED');
  return (report as Extract<RuntimeObservationReport, { state: 'RECORDED' }>).observations;
}
function modelObservation() {
  const value = observations()[1].observation;
  assert.equal(value.kind, 'MODEL_CALL');
  if (value.kind !== 'MODEL_CALL') throw new Error('TEST_KIND');
  return value;
}

test('real private SDK -> bridge -> ingestion -> adapter -> persistence/readback; exactly two sanitized observations', async () => {
  const fetch = fetchResponse(success({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, detail: marker }));
  assert.ok(await invoke() === `  ${marker} answer  `);
  assert.equal(fetch.mock.callCount(), 1);
  const [execution, model] = observations().map(result => result.observation);
  assert.equal(calls.length, 2);
  assert.equal(execution.kind, 'EXECUTION'); assert.equal(execution.operation, 'GOVERNANCE_ANSWER');
  assert.equal(model.kind, 'MODEL_CALL'); assert.equal(model.operation, 'CHAT_COMPLETION');
  assert.equal(model.traceId, execution.traceId); assert.notEqual(model.spanId, execution.spanId);
  assert.deepEqual(execution.parent, { state: 'ROOT' });
  assert.deepEqual(model.parent, { state: 'SPAN_REFERENCE', parentSpanId: execution.spanId });
  assert.notEqual(execution.observationId, model.observationId);
  for (const observation of [execution, model]) {
    assert.match(observation.observationId, /^[0-9a-f-]{36}$/);
    assert.notEqual(observation.observationId, observation.traceId);
    assert.equal(observation.sourceStatus, 'OK');
    assert.deepEqual(observation.outcome, { state: 'SUCCESS', basis: 'OTEL_STATUS' });
    assert.equal(observation.binding.state, 'UNRESOLVED'); assert.equal(observation.duration.state, 'KNOWN');
    assert.equal(observation.recordedAt.state, 'KNOWN');
    assert.equal(typeof observation.startedAtUnixNano, 'string');
    assert.equal(observation.provenance.method.version, '1.0.0');
  }
  const typedModel = modelObservation();
  assert.deepEqual(typedModel.reportedModel, { state: 'KNOWN', value: 'gpt-4o-mini' });
  assert.equal(typedModel.target.canonical.state, 'UNKNOWN');
  assert.equal(typedModel.target.observed.state, 'UNKNOWN');
  assert.equal(typedModel.cost.supplied.state, 'UNKNOWN'); assert.equal(typedModel.cost.derived.state, 'UNKNOWN');
  assert.deepEqual(typedModel.tokens, { unit: 'TOKEN', input: { state: 'KNOWN', value: 5 },
    output: { state: 'KNOWN', value: 2 }, total: { state: 'KNOWN', value: 7 } });
  for (const call of calls) {
    assert.equal(call.name, 'admit_runtime_observation');
    assert.equal(call.args.p_organisation_id, openaiSourceConfiguration().organisationId);
    assert.equal(call.args.p_connection_id, 'm144-unit-source');
    assert.ok(!('attributes' in call.args.p_observation)); assert.ok(!('recorded_at' in call.args.p_observation));
  }
  assert.ok(observations().every(result => result.replay === false)); assert.equal(notices.length, 0);
});

for (const [name, usage, expected] of [
  ['missing', undefined, [undefined, undefined, undefined]],
  ['explicit zero', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, [0, 0, 0]],
  ['partial', { prompt_tokens: 3 }, [3, undefined, undefined]],
  ['invalid counts', { prompt_tokens: -1, completion_tokens: 0.5, total_tokens: '5' }, [undefined, undefined, undefined]],
  ['unsafe integer', { total_tokens: Number.MAX_SAFE_INTEGER + 1 }, [undefined, undefined, undefined]],
  ['inconsistent complete counts', { prompt_tokens: 3, completion_tokens: 2, total_tokens: 99 }, [undefined, undefined, undefined]],
] as const) test(`usage ${name}: only direct validated counts, no zero/limit inference`, async () => {
  fetchResponse(success(usage)); await invoke();
  const tokens = modelObservation().tokens;
  for (const [index, key] of (['input', 'output', 'total'] as const).entries()) {
    assert.deepEqual(tokens[key], expected[index] === undefined ? { state: 'UNKNOWN', reason: 'NOT_SUPPLIED' } : { state: 'KNOWN', value: expected[index] });
  }
});

for (const [name, status, body, code] of [
  ['HTTP', 429, { error: { message: marker } }, 'HTTP_ERROR'],
  ['invalid content', 200, { choices: [] }, 'INVALID_RESPONSE'],
] as const) test(`${name} response preserves empty answer and emits closed error`, async () => {
  fetchResponse(body, status); assert.equal(await invoke(), '');
  for (const result of observations()) {
    assert.equal(result.observation.sourceStatus, 'ERROR');
    assert.deepEqual(result.observation.error, { state: 'KNOWN', value: { category: 'PROTOCOL', code } });
  }
});

for (const [name, code] of [['transport', 'CONNECTION_FAILED'], ['invalid JSON', 'INVALID_RESPONSE']] as const) {
  test(`${name} failure has safe telemetry without changing exception behavior`, async () => {
    const raw = new Error(marker);
    mock.method(globalThis, 'fetch', async () => {
      if (name === 'transport') throw raw;
      return new Response(marker, { status: 200 });
    });
    await assert.rejects(invoke(), error => name === 'transport' ? error === raw : error instanceof SyntaxError);
    for (const result of observations()) {
      assert.equal(result.observation.sourceStatus, 'ERROR');
      assert.equal(result.observation.error.state, 'KNOWN');
      if (result.observation.error.state === 'KNOWN') assert.equal(result.observation.error.value.code, code);
    }
  });
}

for (const mode of ['disabled', 'unconfigured', 'invalid', 'foreign tenant'] as const) {
  test(`${mode} observation preserves the answer, makes no RPC and never fabricates a source`, async () => {
    if (mode === 'disabled') delete process.env.GOVIA_RUNTIME_OPENAI_ENABLED;
    if (mode === 'unconfigured') { delete process.env.GOVIA_RUNTIME_OPENAI_ENABLED; delete process.env.GOVIA_RUNTIME_OPENAI_SOURCE; }
    if (mode === 'invalid') process.env.GOVIA_RUNTIME_OPENAI_SOURCE = marker;
    fetchResponse(success());
    assert.ok(await invoke(mode === 'foreign tenant' ? '14400000-0918-4144-8144-000000000002' : undefined) === `  ${marker} answer  `);
    assert.equal(calls.length, 0);
    assert.equal(report?.state, mode === 'disabled' || mode === 'unconfigured' ? 'NOT_OBSERVED' : 'FAILED');
  });
}

for (const failure of ['ADMISSION', 'READBACK', 'THROW'] as const) test(`${failure} telemetry failure preserves answer with value-free FAILED disposition`, async () => {
  rpcFailure = failure; fetchResponse(success());
  assert.ok(await invoke() === `  ${marker} answer  `);
  assert.deepEqual(report, { state: 'FAILED', code: 'RUNTIME_PRODUCER_INGESTION_FAILED' });
  assert.deepEqual(notices, [['GOVIA_RUNTIME_OBSERVATION_FAILED', 'RUNTIME_PRODUCER_INGESTION_FAILED']]);
  assert.equal(calls.length, 1);
});

test('hung admission has a bounded five-second wait and no retry or false success', async () => {
  rpcFailure = 'HANG'; fetchResponse(success());
  assert.ok(await invoke() === `  ${marker} answer  `);
  assert.deepEqual(report, { state: 'FAILED', code: 'RUNTIME_PRODUCER_TIMEOUT' }); assert.equal(calls.length, 1);
});

for (const provider of ['deepseek', 'ollama', 'none'] as const) test(`${provider} remains uninstrumented with unchanged selection/answer`, async () => {
  process.env.LLM_PROVIDER = provider; process.env.DEEPSEEK_API_KEY = marker;
  const fetch = fetchResponse(provider === 'ollama' ? { message: { content: marker } } : success());
  const answer = await invoke();
  assert.ok(answer === (provider === 'none' ? '' : provider === 'ollama' ? marker : `  ${marker} answer  `));
  assert.equal(getLLMProvider().name, provider); assert.equal(calls.length, 0); assert.equal(report?.state, 'NOT_OBSERVED');
  assert.equal(fetch.mock.callCount(), provider === 'none' ? 0 : 1);
});

test('OpenAI embeddings do not create governance-answer observations', async () => {
  const fetch = fetchResponse({ data: [{ embedding: [0.1, 0.2] }] });
  assert.deepEqual(await getLLMProvider().generateEmbedding(marker), [0.1, 0.2]);
  assert.equal(fetch.mock.callCount(), 1); assert.equal(calls.length, 0); assert.equal(report, undefined);
});

test('observed request preserves model, prompts, temperature, token limit and exact answer formatting', async () => {
  mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-4o-mini'); assert.equal(body.max_tokens, 500); assert.equal(body.temperature, 0.1);
    assert.ok(body.messages[0].content === `${marker}-system`);
    assert.ok(body.messages[1].content === `Context:\n${marker}-context\n\nQuestion: ${marker}-query\n\nAnswer concisely. Cite specific records.`);
    assert.equal(body.messages.length, 2);
    return Response.json(success());
  });
  assert.ok(await invoke() === `  ${marker} answer  `);
});

test('private tracing never registers global tracer/context or changes ambient context', async () => {
  const globalProvider = trace.getTracerProvider(); const active = context.active();
  const tracerRegistration = mock.method(trace, 'setGlobalTracerProvider', () => { throw new Error('TEST_GLOBAL_REGISTRATION'); });
  const contextRegistration = mock.method(context, 'setGlobalContextManager', () => { throw new Error('TEST_GLOBAL_REGISTRATION'); });
  fetchResponse(success()); await invoke();
  assert.equal(trace.getTracerProvider(), globalProvider); assert.equal(context.active(), active);
  assert.equal(tracerRegistration.mock.callCount(), 0); assert.equal(contextRegistration.mock.callCount(), 0);
});

test('all writes to the real public SDK are metadata-only, with no events or exception capture', async () => {
  const sdkWrites: unknown[] = [];
  const getTracer = BasicTracerProvider.prototype.getTracer;
  mock.method(BasicTracerProvider.prototype, 'getTracer', function (this: BasicTracerProvider, ...args: Parameters<typeof getTracer>) {
    sdkWrites.push(args);
    const tracer = getTracer.apply(this, args);
    const start = tracer.startSpan.bind(tracer);
    mock.method(tracer, 'startSpan', (...spanArgs: Parameters<typeof start>) => {
      sdkWrites.push([spanArgs[0], spanArgs[1]]);
      const span = start(...spanArgs);
      const setAttribute = span.setAttribute.bind(span); const setStatus = span.setStatus.bind(span);
      mock.method(span, 'setAttribute', (...values: Parameters<typeof setAttribute>) => { sdkWrites.push(values); return setAttribute(...values); });
      mock.method(span, 'setStatus', (...values: Parameters<typeof setStatus>) => { sdkWrites.push(values); return setStatus(...values); });
      mock.method(span, 'addEvent', () => { assert.fail('No events allowed'); });
      mock.method(span, 'recordException', () => { assert.fail('No exceptions allowed'); });
      return span;
    });
    return tracer;
  });
  fetchResponse(success({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, arbitrary: marker }));
  await invoke();
  assert.equal(calls.length, 2); assert.ok(sdkWrites.length > 0);
  assert.ok(!JSON.stringify(sdkWrites).includes(marker));
});

test('concurrent invocations keep traces, parents, source and tenant isolated', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fetchCount = 0;
  mock.method(globalThis, 'fetch', async () => { if (++fetchCount === 1) await gate; else release(); return Response.json(success()); });
  const first = invoke();
  const secondConfig = { ...openaiSourceConfiguration(), organisationId: '14400000-0918-4144-8144-000000000002',
    connectionId: 'm144-second-source', producerIdentity: 'm144-second-producer' };
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(secondConfig);
  await Promise.all([first, invoke(secondConfig.organisationId)]);
  assert.equal(calls.length, 4);
  const traces = new Set(calls.map(call => call.args.p_observation.trace_id)); assert.equal(traces.size, 2);
  for (const traceId of traces) {
    const pair = calls.filter(call => call.args.p_observation.trace_id === traceId);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].args.p_organisation_id, pair[1].args.p_organisation_id);
    assert.equal(pair[0].args.p_connection_id, pair[1].args.p_connection_id);
    assert.equal(pair[0].args.p_observation.producer_identity, pair[1].args.p_observation.producer_identity);
    assert.equal(pair[1].args.p_observation.parent_span_id, pair[0].args.p_observation.span_id);
  }
});

test('configuration rejects missing permissions, unapproved model, credentials, extensions and oversized input safely', () => {
  const source = openaiSourceConfiguration();
  for (const changed of [{ ...source, supportedKinds: ['EXECUTION'] }, { ...source, supportedFacts: ['END_TIME'] },
    { ...source, approvedModels: [] }, { ...source, instrumentation: { ...source.instrumentation, sdkVersion: 'other' } },
    { ...source, apiKey: marker }, { ...source, producerIdentity: 'sk-rejected-fixture-value' }, { ...source, verifiedBinding: {} }]) {
    process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(changed);
    assert.deepEqual(loadRuntimeProducerConfiguration(source.organisationId), { state: 'INVALID', code: 'RUNTIME_PRODUCER_CONFIGURATION_INVALID' });
  }
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = 'x'.repeat(8193);
  assert.equal(loadRuntimeProducerConfiguration(source.organisationId).state, 'INVALID');
});
