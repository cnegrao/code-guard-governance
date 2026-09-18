import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, mock, test } from 'node:test';
import { openaiSourceConfiguration } from './helpers/openai-producer-fixtures';

let ask: typeof import('../services/talk').ask;
let confidence = 10;
let rows: Record<string, unknown>[];
let calls: string[];
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
    async rpc(name: string, args: { p_observation: Record<string, unknown> }) {
      assert.equal(name, 'admit_runtime_observation'); rows.push(args.p_observation);
      return { data: [{ replay: false, observation: { ...args.p_observation, recorded_at: '2026-09-18T15:00:00.000Z' } }], error: null };
    },
  } } });
  ask = (await import('../services/talk')).ask;
});
beforeEach(() => {
  rows = []; calls = []; confidence = 10;
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
