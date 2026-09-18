import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, mock, test } from 'node:test';
import { openaiSourceConfiguration } from './helpers/openai-producer-fixtures';

let ask: typeof import('../services/talk').ask;
let confidence = 10;
let rows: Record<string, unknown>[];
let calls: string[];
let persistenceBarrier = false;
let persistenceGate: Promise<void>;
let releasePersistenceGate: () => void = () => {};
let persistenceOrganisations: Set<string>;
let persistenceStarted = 0;
let persistenceActive = 0;
let persistenceMaxActive = 0;
const envKeys = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'GOVIA_RUNTIME_OPENAI_ENABLED', 'GOVIA_RUNTIME_OPENAI_SOURCE'];
const saved = new Map(envKeys.map(key => [key, process.env[key]]));
before(async () => {
  mock.module('@/repositories/talk', { namedExports: {
    executeQuery: async () => ({ answer: 'router answer', confidence, intent: 'fixture', citations: [] }),
    buildGovernanceContext: async () => [{ source: 'fixture', record: 'TEST-001', type: 'Agent', fields: {} }],
    formatContextForLLM: () => 'SYNTHETIC_CONTEXT', semanticSearch: async () => [],
  } });
  mock.module('@/services/coding-memory', { namedExports: { semanticSearch: async () => '' } });
  mock.module('@/lib/db', { namedExports: { db: { write: { rpc: async () => ({}) } } } });
  mock.module('@/lib/governance/persistence', { namedExports: { privilegedDb: {
    async rpc(name: string, args: { p_organisation_id: string; p_observation: Record<string, unknown> }) {
      assert.equal(name, 'admit_runtime_observation'); rows.push(args.p_observation);
      if (persistenceBarrier && !persistenceOrganisations.has(args.p_organisation_id)) {
        persistenceOrganisations.add(args.p_organisation_id);
        persistenceStarted++; persistenceActive++;
        persistenceMaxActive = Math.max(persistenceMaxActive, persistenceActive);
        if (persistenceOrganisations.size === 2) releasePersistenceGate();
        await persistenceGate;
        persistenceActive--;
      }
      return { data: [{ replay: false, observation: { ...args.p_observation, recorded_at: '2026-09-18T15:00:00.000Z' } }], error: null };
    },
  } } });
  ask = (await import('../services/talk')).ask;
});
beforeEach(() => {
  rows = []; calls = []; confidence = 10;
  persistenceBarrier = false;
  persistenceGate = new Promise<void>(resolve => { releasePersistenceGate = resolve; });
  persistenceOrganisations = new Set();
  persistenceStarted = 0; persistenceActive = 0; persistenceMaxActive = 0;
  process.env.LLM_PROVIDER = 'openai'; process.env.OPENAI_API_KEY = 'synthetic-fixture-value';
  process.env.GOVIA_RUNTIME_OPENAI_ENABLED = '1';
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(openaiSourceConfiguration());
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const endpoint = String(url); calls.push(endpoint);
    return Response.json(endpoint.endsWith('/embeddings') ? { data: [{ embedding: [0.1] }] } :
      { choices: [{ message: { content: '  TEST-001 answer  ' } }] });
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
test('Talk observes only the answer after embeddings; existing trimming, confidence and citations remain', async () => {
  const answer = await ask(openaiSourceConfiguration().organisationId, 'fixture-user', 'SYNTHETIC_QUERY');
  assert.equal(answer.answer, 'TEST-001 answer'); assert.equal(answer.confidence, 78);
  assert.equal(answer.citations.length, 1); assert.equal(answer.intent, 'llm_generated');
  assert.equal(calls.length, 2); assert.ok(calls[0].endsWith('/embeddings')); assert.ok(calls[1].endsWith('/chat/completions'));
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.operation), ['GOVERNANCE_ANSWER', 'CHAT_COMPLETION']);
  assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_')); assert.ok(!JSON.stringify(rows).includes('TEST-001 answer'));
});
test('Talk empty OpenAI answer uses the existing fallback without exposing the empty provider result', async () => {
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const endpoint = String(url); calls.push(endpoint);
    return Response.json(endpoint.endsWith('/embeddings') ? { data: [{ embedding: [0.1] }] } :
      { choices: [{ message: { content: '' } }] });
  });
  const answer = await ask(openaiSourceConfiguration().organisationId, 'fixture-user', 'SYNTHETIC_QUERY');
  assert.equal(answer.answer, 'router answer'); assert.equal(answer.confidence, 72); assert.equal(answer.intent, 'fixture');
  assert.equal(calls.length, 2); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.operation), ['GOVERNANCE_ANSWER', 'CHAT_COMPLETION']);
  assert.ok(!JSON.stringify({ rows, answer }).includes('TEST-001 answer'));
});
test('confident intent-router answer makes no OpenAI call or runtime observation', async () => {
  confidence = 90;
  const answer = await ask(openaiSourceConfiguration().organisationId, 'fixture-user', 'SYNTHETIC_QUERY');
  assert.equal(answer.answer, 'router answer'); assert.equal(calls.length, 0); assert.equal(rows.length, 0);
});
test('Talk provider transport failure keeps the existing fallback and safe error observations', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('EXCLUDED_PROVIDER_DETAIL'); });
  const answer = await ask(openaiSourceConfiguration().organisationId, 'fixture-user', 'SYNTHETIC_QUERY');
  assert.equal(answer.answer, 'router answer'); assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.error_code === 'CONNECTION_FAILED'));
  assert.ok(!JSON.stringify({ rows, answer }).includes('EXCLUDED_PROVIDER_DETAIL'));
});
test('concurrent Talk invocations keep tenant, source, producer and trace mapping isolated under overlapping persistence', async () => {
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>(resolve => { releaseFetch = resolve; });
  let resolveFirstChatStarted!: () => void;
  const firstChatStarted = new Promise<void>(resolve => { resolveFirstChatStarted = resolve; });
  let fetchCount = 0;
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const endpoint = String(url); calls.push(endpoint);
    if (++fetchCount === 2) { resolveFirstChatStarted(); await fetchGate; } else if (fetchCount === 3) releaseFetch();
    return Response.json(endpoint.endsWith('/embeddings') ? { data: [{ embedding: [0.1] }] } :
      { choices: [{ message: { content: '  TEST-001 answer  ' } }] });
  });
  const first = ask(openaiSourceConfiguration().organisationId, 'fixture-user-1', 'SYNTHETIC_QUERY_1');
  await firstChatStarted;
  const secondConfig = { ...openaiSourceConfiguration(), organisationId: '14400000-0918-4144-8144-000000000002',
    connectionId: 'm144-second-source', producerIdentity: 'm144-second-producer' };
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(secondConfig);
  persistenceBarrier = true;
  const [firstAnswer, secondAnswer] = await Promise.all([first,
    ask(secondConfig.organisationId, 'fixture-user-2', 'SYNTHETIC_QUERY_2')]);
  assert.equal(firstAnswer.answer, 'TEST-001 answer'); assert.equal(secondAnswer.answer, 'TEST-001 answer');
  assert.equal(persistenceStarted, 2, JSON.stringify({ rows, organisations: [...persistenceOrganisations], active: persistenceActive })); assert.equal(persistenceMaxActive, 2); assert.equal(persistenceActive, 0);
  assert.equal(rows.length, 4);
  const traces = new Set(rows.map(row => row.trace_id)); assert.equal(traces.size, 2);
  for (const traceId of traces) {
    const pair = rows.filter(row => row.trace_id === traceId);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].organisation_id, pair[1].organisation_id);
    assert.equal(pair[0].connection_id, pair[1].connection_id);
    assert.equal(pair[0].producer_identity, pair[1].producer_identity);
    assert.equal(pair[1].parent_span_id, pair[0].span_id);
  }
  assert.ok(!JSON.stringify({ rows, firstAnswer, secondAnswer }).includes('SYNTHETIC_'));
});
