import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, mock, test } from 'node:test';
import { openaiSourceConfiguration } from './helpers/openai-producer-fixtures';

let ask: typeof import('../services/talk').ask;
let confidence = 10;
let rows: Record<string, unknown>[];
let rpcEnvelopes: { p_organisation_id: string; p_connection_id: string; p_observation: Record<string, unknown> }[];
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
    async rpc(name: string, args: { p_organisation_id: string; p_connection_id: string; p_observation: Record<string, unknown> }) {
      assert.equal(name, 'admit_runtime_observation'); rpcEnvelopes.push(args); rows.push(args.p_observation);
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
  rows = []; rpcEnvelopes = []; calls = []; confidence = 10;
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
  const firstConfig = openaiSourceConfiguration();
  const secondConfig = { ...firstConfig, organisationId: '14400000-0918-4144-8144-000000000002',
    connectionId: 'm144-second-source', producerIdentity: 'm144-second-producer' };
  assert.notEqual(firstConfig.organisationId, secondConfig.organisationId);
  const expectedByOrganisation = new Map([
    [firstConfig.organisationId, firstConfig], [secondConfig.organisationId, secondConfig],
  ]);
  const first = ask(firstConfig.organisationId, 'fixture-user-1', 'SYNTHETIC_QUERY_1');
  await firstChatStarted;
  process.env.GOVIA_RUNTIME_OPENAI_SOURCE = JSON.stringify(secondConfig);
  persistenceBarrier = true;
  const [firstAnswer, secondAnswer] = await Promise.all([first,
    ask(secondConfig.organisationId, 'fixture-user-2', 'SYNTHETIC_QUERY_2')]);
  assert.equal(firstAnswer.answer, 'TEST-001 answer'); assert.equal(secondAnswer.answer, 'TEST-001 answer');
  assert.equal(persistenceStarted, 2, JSON.stringify({ rows, organisations: [...new Set(rpcEnvelopes.map(args => args.p_organisation_id))], active: persistenceActive })); assert.equal(persistenceMaxActive, 2); assert.equal(persistenceActive, 0);
  assert.equal(rpcEnvelopes.length, 4); assert.equal(rows.length, 4);
  const traceGroups = new Map<string, typeof rpcEnvelopes>();
  for (const args of rpcEnvelopes) {
    const traceId = args.p_observation.trace_id as string;
    const group = traceGroups.get(traceId) ?? []; group.push(args); traceGroups.set(traceId, group);
  }
  assert.equal(traceGroups.size, 2);
  for (const organisationId of expectedByOrganisation.keys()) {
    assert.equal([...traceGroups.values()].filter(group =>
      group[0].p_observation.organisation_id === organisationId).length, 1, organisationId);
  }
  const groupedOrganisations = new Set([...traceGroups.values()].map(group =>
    group[0].p_observation.organisation_id as string));
  assert.deepEqual(groupedOrganisations, new Set(expectedByOrganisation.keys()));
  assert.equal(new Set(expectedByOrganisation.keys()).size, 2);
  for (const [traceId, group] of traceGroups) {
    assert.equal(group.length, 2, traceId);
    const organisationId = group[0].p_observation.organisation_id as string;
    assert.equal(new Set(group.map(args => args.p_observation.organisation_id)).size, 1, traceId);
    assert.equal(new Set(group.map(args => args.p_organisation_id)).size, 1, traceId);
    assert.equal(new Set(group.map(args => args.p_connection_id)).size, 1, traceId);
    const expected = expectedByOrganisation.get(organisationId); assert.ok(expected, organisationId);
    for (const args of group) {
      assert.equal(args.p_organisation_id, organisationId, traceId);
      assert.equal(args.p_connection_id, expected.connectionId, traceId);
      assert.equal(args.p_observation.organisation_id, organisationId, traceId);
      assert.equal(args.p_observation.connection_id, expected.connectionId, traceId);
      assert.equal(args.p_observation.producer_identity, expected.producerIdentity, traceId);
    }
    const pair = rows.filter(row => row.trace_id === traceId);
    assert.equal(pair.length, 2, traceId);
    const execution = pair.find(row => row.operation === 'GOVERNANCE_ANSWER');
    const model = pair.find(row => row.operation === 'CHAT_COMPLETION');
    assert.ok(execution && model, traceId);
    assert.equal(model.parent_span_id, execution.span_id, traceId);
  }
  assert.ok(!JSON.stringify({ rows, rpcEnvelopes, firstAnswer, secondAnswer }).includes('SYNTHETIC_'));
});
