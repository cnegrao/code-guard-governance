import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId, CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';
import { sourceName } from '../lib/governance/source-name';

const org = asOrganisationId('demo-tenant');
const asOf = '2026-11-25T12:00:00Z';
let tables: Record<string, Record<string, unknown>[]>;
let calls: { table: string; columns: string; filters: [string, unknown][] }[];
let count: number | null;
let fail: string | undefined;
let leak: boolean;
const db = { from(table: string) {
  const call = { table, columns: '', filters: [] as [string, unknown][] }; calls.push(call);
  let from = 0, to = 199;
  const query = {
    select(columns: string) { call.columns = columns; return query; },
    eq(key: string, value: unknown) { call.filters.push([key, value]); return query; },
    in(key: string, values: unknown[]) { call.filters.push([key, values]); return query; },
    order() { return query; },
    range(start: number, end: number) { from = start; to = end; return query; },
    then(resolve: (result: unknown) => unknown) {
      const data = (tables[table] ?? []).filter(row => leak || call.filters.every(([key, value]) =>
        Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(from, to + 1);
      return Promise.resolve({ data, count, error: fail === table ? { message: 'read failed' } : null }).then(resolve);
    },
  }; return query;
} };
let readNames: typeof import('../lib/governance/source-name-query');
let readEstate: typeof import('../lib/governance/estate-query').readGovernedEstate;
before(async () => {
  mock.module('@/lib/governance/persistence', { namedExports: { privilegedDb: db } });
  mock.module('@/lib/governance/intelligence-read-store', { namedExports: { intelligenceReader: (tenant: string) => ({
    graphRows: async () => {
      assert.equal(tenant, org);
      if (fail === 'canonical_objects') throw new Error('canonical read unavailable');
      return { objects: tables.canonical_objects ?? [], relationships: tables.canonical_relationships ?? [] };
    },
  }) } });
  readNames = await import('../lib/governance/source-name-query');
  ({ readGovernedEstate: readEstate } = await import('../lib/governance/estate-query'));
});
beforeEach(() => { tables = {}; calls = []; count = 0; fail = undefined; leak = false; });
const row = (value: Record<string, unknown>) => ({ organisation_id: org, ...value });

test('source labels use only declaration identities, never Prompt content or invented version names', () => {
  for (const [kind, field, value] of [
    ['AGENT', 'agentCode', 'RepositoryAnalysisAgent'], ['MODEL', 'modelReference', 'gpt-4.1-mini'],
    ['TOOL', 'declarationKey', 'consultar_protocolo'], ['PROMPT', 'declarationKey', 'TRIAGEM_PROMPT'],
    ['API', 'apiReference', 'sistema-processos-api'], ['MCP_SERVER', 'serverReference', 'consulta-protocolo-mcp'],
    ['KNOWLEDGE_BASE', 'sourceReference', 'manual-atendimento'], ['DATA_ASSET', 'sourceReference', 'ouvidoria.manifestacao'],
    ['DATA_ELEMENT', 'elementPath', 'email'], ['SKILL', 'declarationReference', 'classify'],
  ]) assert.equal(sourceName(kind, { [field]: value }), value);
  assert.equal(sourceName('PROMPT', { content: 'SECRET_BODY', displayName: 'UNKNOWN' }), null);
  assert.equal(sourceName('AGENT', { agentCode: 'NOT_EVIDENCED' }), null);
  assert.equal(sourceName('AGENT_VERSION', { agent: { referenceKind: 'SOURCE_OBJECT', sourceObject: { externalId: 'src/agent.py' } } }), 'src/agent.py');
});

test('canonical source labels follow exact effective tenant/kind mappings and retain competing names', async () => {
  tables.canonical_normalized_object_mappings = [
    row({ mapping_id: 'm1', canonical_object_id: 'a', canonical_object_kind: 'AGENT', candidate_id: 'c1', valid_from: asOf }),
    row({ mapping_id: 'm2', canonical_object_id: 'a', canonical_object_kind: 'AGENT', candidate_id: 'c2', valid_from: asOf }),
    row({ mapping_id: 'future', canonical_object_id: 'a', canonical_object_kind: 'AGENT', candidate_id: 'c3', valid_from: '2099-01-01T00:00:00Z' }),
    row({ mapping_id: 'wrong-kind', canonical_object_id: 'a', canonical_object_kind: 'MODEL', candidate_id: 'c3', valid_from: asOf }),
  ];
  tables.discovery_candidates = [
    row({ candidate_id: 'c1', candidate_kind: 'AGENT', proposed_identity: { agentCode: 'Alpha' } }),
    row({ candidate_id: 'c2', candidate_kind: 'AGENT', proposed_identity: { agentCode: 'Beta' } }),
    row({ candidate_id: 'c3', candidate_kind: 'MODEL', proposed_identity: { modelReference: 'Wrong' } }),
  ];
  assert.deepEqual(await readNames.readCanonicalSourceNames(org, [{ objectId: 'a', kind: 'AGENT' }], asOf), { a: 'Alpha · Beta' });
  assert.ok(calls.every(c => c.filters.some(([key, value]) => key === 'organisation_id' && value === org)));
  assert.ok(calls.every(c => !/envelope|\*/.test(c.columns)));
  assert.deepEqual(await readNames.readCanonicalSourceNames(org, [], asOf), {});
});

test('queue labels match the finding; missing names stay unknown and read failures do not invent names', async () => {
  tables.discovery_candidates = [row({ candidate_id: 'c1', finding_id: 'f1', candidate_kind: 'MCP_SERVER', proposed_identity: { serverReference: 'consulta-protocolo-mcp' } })];
  assert.deepEqual(await readNames.readFindingSourceNames(org, ['f1', 'missing']), { f1: 'consulta-protocolo-mcp', missing: null });
  fail = 'discovery_candidates'; await assert.rejects(readNames.readFindingSourceNames(org, ['f1']), /SOURCE_NAME_READ_FAILED/);
  fail = undefined; leak = true; tables.discovery_candidates[0].organisation_id = 'foreign';
  await assert.rejects(readNames.readFindingSourceNames(org, ['f1']), /SOURCE_NAME_TENANT_MISMATCH/);
});

test('estate counts canonical objects by all existing kinds and counts pending review separately', async () => {
  tables.canonical_objects = [row({ canonical_object_id: 'agent', kind: 'AGENT', created_at: asOf, revision: 0, created_by_decision_id: 'decision' })];
  count = 63;
  const estate = await readEstate(org);
  assert.equal(estate.canonicalObjects, 1); assert.equal(estate.canonicalRelationships, 0);
  assert.equal(estate.pendingReview, 63); assert.equal(estate.byKind.AGENT, 1); assert.equal(estate.byKind.MODEL, 0);
  assert.deepEqual(Object.keys(estate.byKind).sort(), Object.values(CANONICAL_OBJECT_KIND).sort());
  assert.deepEqual(calls[0].filters, [['organisation_id', org], ['state', ['DETECTED', 'PROPOSED', 'CONFIRMED']]]);
});

test('estate distinguishes exact zero from unknown or failed counts', async () => {
  assert.equal((await readEstate(org)).pendingReview, 0);
  count = null; await assert.rejects(readEstate(org), /ESTATE_REVIEW_COUNT_UNKNOWN/);
  count = 0; fail = 'review_subjects'; await assert.rejects(readEstate(org), /ESTATE_REVIEW_COUNT_UNKNOWN/);
  fail = 'canonical_objects'; await assert.rejects(readEstate(org), /canonical read unavailable/);
});
