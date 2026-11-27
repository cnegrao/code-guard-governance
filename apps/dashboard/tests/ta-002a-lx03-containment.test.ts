import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { signToken } from '../lib/auth/session-token';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const epoch = '2026-11-01T00:00:00.123456Z';
let token = '', revoked = false, denyAgents = false, noAgents = false;
let context = '', embeddings = 0;
const calls: Array<{ path: string; args: Record<string, unknown>; url: URL }> = [];
const client = createClient('https://fixture.invalid', 'fixture-service', {
  db: { schema: 'gov_repo' }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input)), args = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, args, url });
    if (url.pathname.endsWith('/ledger_append_v2')) {
      // Controlled persisted-eligibility port: production uses the unchanged M16/V2 SQL guard.
      if (revoked || args.p_verified_actor_user_id !== actor || args.p_verified_organisation_id !== A || args.p_verified_credential_epoch !== epoch)
        return Response.json({ message: 'ineligible' }, { status: 403 });
      return Response.json('44444444-4444-4444-8444-444444444444');
    }
    if (url.pathname.endsWith('/agent_semantic_search')) return Response.json([
      { agent_id: 'a-agent', similarity: 1, content_snippet: 'FOREIGN_TENANT_SOURCE UNADMITTED_SOURCE_INSTRUCTION' },
    ]);
    if (url.pathname.endsWith('/coding_memory_search')) return Response.json([
      { memory_id: 'legacy', symbol_type: 'code', symbol_name: 'legacy', path: 'private.ts', summary: 'UNADMITTED_SOURCE_INSTRUCTION', similarity: 1 },
    ]);
    assert.ok(url.pathname.endsWith('/agents'), url.pathname);
    assert.equal(url.searchParams.get('organisation_id'), `eq.${A}`);
    if (denyAgents) return Response.json({ message: 'PRIVATE_TRANSPORT_DETAIL' }, { status: 403 });
    const fixtures = [
      { organisation_id: A, agent_id: 'a-agent', agent_code: 'PAY-A', name: 'payments', agent_type: 'assistant', status: 'active' },
      { organisation_id: B, agent_id: 'b-agent', agent_code: 'FOREIGN_TENANT_SOURCE', name: 'payments', agent_type: 'assistant', status: 'active' },
    ];
    const rows = noAgents ? [] : fixtures.filter(row => url.searchParams.get('organisation_id') === `eq.${row.organisation_id}`);
    // Return only selected columns, just as PostgREST does. Foreign agent exists but fails SQL tenant selection.
    const selected = url.searchParams.get('select')?.split(',').map(s => s.trim()) ?? [];
    return Response.json(rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => selected.includes(key)))));
  } },
});
let talk: typeof import('../app/api/talk-to-governance/route');
let memory: typeof import('../app/api/discovery/memory/route');
before(async () => {
  process.env.JWT_SECRET = 'lx03-local-session-fixture-0123456789abcdef';
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => ({ value: token }) }) } });
  mock.module('@/lib/db', { namedExports: { db: { write: client } } });
  const repository = await import('../repositories/talk');
  mock.module('@/repositories/talk', { namedExports: { ...repository,
    executeQuery: async () => ({ answer: 'Direct records only.', confidence: 10, intent: 'fixture', citations: [], supportingData: [], evidence_count: 0,
      explanation: { source: 'direct', intent_matched: 'fixture', rows_used: 0, confidence_rationale: '' } }),
    buildGovernanceContext: async () => [],
  } });
  mock.module('@/lib/llm', { namedExports: { GOVERNANCE_SYSTEM_PROMPT: 'fixture', getLLMProvider: () => ({
    available: true, name: 'fixture', generateEmbedding: async () => { embeddings++; return [0.1]; },
  }) } });
  mock.module('@/lib/runtime/openai-governance-answer-producer', { namedExports: {
    generateGovernanceAnswer: async (_p: unknown, _org: string, _system: string, value: string) => { context = value; return 'Direct records only.'; },
  } });
  talk = await import('../app/api/talk-to-governance/route');
  memory = await import('../app/api/discovery/memory/route');
});
beforeEach(async () => {
  token = await signToken({ sub: actor, org: A, email: '', role: '', credentialEpoch: epoch });
  revoked = denyAgents = noAgents = false; context = ''; embeddings = 0; calls.length = 0;
});
const request = () => new Request('http://fixture/api/talk-to-governance', { method: 'POST',
  headers: { 'x-codeguard-org': B }, body: JSON.stringify({ query: 'payments', organisationId: B, actorUserId: 'forged' }) });
const noLegacy = () => assert.ok(!calls.some(c => /agent_semantic_search|coding_memory_search/.test(c.path)), JSON.stringify(calls));

test('forged principal: invalid signature denies before reads, RPC or embedding', async () => {
  token = token.slice(0, -8) + 'forged00';
  assert.equal((await talk.POST(request())).status, 401);
  assert.equal(calls.length, 0); assert.equal(embeddings, 0);
});
test('revoked principal: persisted gate denies before enrichment, RPC fallback or embedding', async () => {
  revoked = true;
  assert.equal((await talk.POST(request())).status, 503);
  assert.ok(calls.every(c => c.path.endsWith('/ledger_append_v2'))); assert.equal(embeddings, 0);
});
test('cross tenant: request principal overrides and foreign embedding/source cannot enter context', async () => {
  const response = await talk.POST(request()); assert.equal(response.status, 200);
  assert.doesNotMatch(context, /FOREIGN_TENANT_SOURCE/); noLegacy();
  assert.ok(calls.some(c => c.path.endsWith('/agents') && c.url.searchParams.get('organisation_id') === `eq.${A}`));
  const body = await response.json();
  assert.equal(body.retrieval.agentLookup.status, 'available');
  assert.match(context, /PAY-A/);
  assert.ok(body.citations.some((c: { source: string; record: string }) => c.source === 'gov_repo.agents' && c.record === 'PAY-A'));
});
test('unadmitted source: legacy snippets/code never enter prompt; unavailable is explicit', async () => {
  const body = await (await talk.POST(request())).json();
  assert.doesNotMatch(context, /UNADMITTED_SOURCE_INSTRUCTION/);
  assert.equal(body.retrieval.codingMemory.status, 'unavailable');
  assert.equal(body.retrieval.codingMemory.knowledge, 'UNKNOWN'); assert.equal(embeddings, 0); noLegacy();
});
test('failure: denied lexical source is unavailable, without legacy/provider fallback or false no-match', async () => {
  denyAgents = true;
  const body = await (await talk.POST(request())).json(); noLegacy();
  assert.equal(body.retrieval.agentLookup.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_TRANSPORT_DETAIL/); assert.equal(embeddings, 0);
});
test('valid empty lexical selection differs from unavailable coding memory', async () => {
  noAgents = true;
  const body = await (await talk.POST(request())).json();
  assert.equal(body.retrieval.agentLookup.status, 'no_matches');
  assert.equal(body.retrieval.codingMemory.status, 'unavailable'); noLegacy();
});
test('lexical filter metacharacters never become caller-supplied PostgREST expressions', async () => {
  const response = await talk.POST(new Request('http://fixture/api/talk-to-governance', { method: 'POST',
    body: JSON.stringify({ query: 'payments),organisation_id.eq.foreign*%_' }) }));
  assert.equal(response.status, 200); noLegacy();
  const lookup = calls.find(c => c.path.endsWith('/agents'))!;
  assert.equal(lookup.url.searchParams.get('organisation_id'), `eq.${A}`);
  assert.match(lookup.url.searchParams.get('or')!, /^\((?:(?:name|agent_code)\.ilike\.\*[\p{L}\p{N}]+\*(?:,|(?=\))))+\)$/u);
  assert.equal(lookup.url.searchParams.get('limit'), '5');
  assert.doesNotMatch(lookup.url.searchParams.get('select')!, /owner|system|embedding|summary|content|oversight/);
});
test('memory API search and adjacent repo path cannot bypass admission or disguise unavailability as empty', async () => {
  for (const params of ['query=payments', 'action=repo&repository_id=foreign-repo']) {
    const response = await memory.GET(new Request(`http://fixture/api/discovery/memory?${params}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'unavailable'); assert.equal(body.knowledge, 'UNKNOWN');
    assert.ok(!('empty' in body) && !('chunks' in body));
  }
  assert.equal(calls.length, 0); assert.equal(embeddings, 0);
});
test('static: application code cannot name either legacy RPC or fetch vectors as fallback', () => {
  function check(dir: URL) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) check(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) assert.doesNotMatch(readFileSync(path, 'utf8'), /agent_semantic_search|coding_memory_search/, path.pathname);
    }
  }
  for (const dir of ['app', 'components', 'services', 'repositories', 'lib']) check(new URL(`../${dir}/`, import.meta.url));
  for (const dir of ['scanner', 'graphos', 'canonical-contracts', 'governance-review']) check(new URL(`../../../packages/${dir}/src/`, import.meta.url));
  check(new URL('../../discovery-worker/src/', import.meta.url));
  assert.doesNotMatch(readFileSync(new URL('../services/talk.ts', import.meta.url), 'utf8'), /generateEmbedding|services\/coding-memory/);
  assert.doesNotMatch(readFileSync(new URL('../repositories/talk.ts', import.meta.url), 'utf8'), /\.from\(["'](?:coding_memory|agent_embeddings)["']/);
});
