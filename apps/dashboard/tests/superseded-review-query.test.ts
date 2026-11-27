import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId } from '@council/canonical-contracts';
import { twoDiscoveryRunsFixture, candidate } from './helpers/agent-chain-fixtures';

const org = asOrganisationId('org-queue');
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let calls: { table: string; filters: [string, unknown][]; start: number }[];
let failed = false, corrupt = false;
const db = { from(table: string) {
  const call = { table, filters: [] as [string, unknown][], start: 0 }; calls.push(call);
  const predicates: ((row: Row) => boolean)[] = [];
  const orders: [string, boolean][] = [];
  let start = 0, end = Infinity, head = false;
  const q = {
    select(_columns: string, options?: { head?: boolean }) { head = !!options?.head; return q; },
    eq(key: string, value: unknown) { call.filters.push([key, value]); predicates.push(row => row[key] === value); return q; },
    neq(key: string, value: unknown) { predicates.push(row => row[key] !== value); return q; },
    in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return q; },
    or(value: string) { const term = value.split('.ilike.%')[1].split('%')[0]; predicates.push(row => row.finding_id.includes(term) || row.source_external_id.includes(term)); return q; },
    order(key: string, options?: { ascending: boolean }) { orders.push([key, options?.ascending ?? true]); return q; },
    range(a: number, b: number) { start = a; end = b; call.start = a; return q; },
    then(resolve: (value: unknown) => unknown) {
      const rows = (tables[table] ?? []).filter(row => predicates.every(p => p(row))).toSorted((a, b) => {
        for (const [key, asc] of orders) { const delta = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (delta) return asc ? delta : -delta; }
        return 0;
      });
      const data = rows.slice(start, end + 1).map(row => ({ ...row, ...(corrupt ? { organisation_id: 'foreign' } : {}) }));
      return Promise.resolve({ data: head ? null : data, count: rows.length, error: failed ? { message: 'failed' } : null }).then(resolve);
    },
  }; return q;
} };

mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: db, canonicalStringify: JSON.stringify, sha256Hex: (value: string) => value, governanceReviewPersistence: {} } });
// Recency is tested through the real shared REV-001 function; envelope parsing has its own contract tests.
mock.module('../lib/governance/discovery-intake-persistence', { namedExports: {
  rehydrateNormalizedCandidate: (value: unknown) => value,
  normalizedCandidateEnvelopeHash: JSON.stringify,
  discoveryIntakePersistence: {},
} });
mock.module('../lib/governance/source-name-query', { namedExports: {
  readFindingSourceNames: async () => ({}), readRelationshipSourceLabels: async () => ({}),
} });
let query: typeof import('../lib/governance/workspace-query');
let superseded: typeof import('../lib/governance/superseded-review-query');
before(async () => {
  query = await import('../lib/governance/workspace-query');
  superseded = await import('../lib/governance/superseded-review-query');
});
const add = (table: string, row: Row) => (tables[table] ??= []).push({ organisation_id: org, ...row });
beforeEach(() => { tables = {}; calls = []; failed = false; corrupt = false; });
function seed() {
  const fixture = twoDiscoveryRunsFixture();
  fixture.all.forEach(row => {
    add('discovery_candidates', { candidate_id: row.candidate.candidateId, envelope: row.candidate, envelope_hash: JSON.stringify(row.candidate), acquisition_run_id: row.discoveryRun!.id });
    add('review_subjects', { review_subject_id: row.reviewSubjectId, finding_id: row.candidate.findingId, state: row.state, candidate_kind: row.candidate.candidateKind });
    add('review_subject_queue', { review_subject_id: row.reviewSubjectId, finding_id: row.candidate.findingId, state: row.state, candidate_kind: row.candidate.candidateKind,
      source_connection_id: 'conn', source_external_type: 'file', source_external_id: row.candidate.sourceObject.externalId, detected_at: row.discoveryRun!.startedAt, triage_rank: 0, evidence_count: 1, assertion_count: 1 });
  });
  [fixture.old, fixture.latest].forEach(run => add('acquisition_runs', { run_id: run.id, source_connection_id: 'conn', started_at: run.startedAt }));
  return fixture;
}

test('queue hides exactly the old REV-001 objects and relations before pagination, restores them on demand and never writes', async () => {
  const fixture = seed(), snapshot = JSON.stringify(tables);
  const first = await query.listReviewQueue(org, { page: 1, pageSize: 4 });
  assert.equal(first.supersededCount, fixture.old.all.length);
  assert.equal(first.items.length, 4); assert.equal(first.hasMore, true);
  assert.ok(first.items.every(item => !item.superseded && fixture.latest.all.some(row => row.reviewSubjectId === item.reviewSubjectId)));
  const second = await query.listReviewQueue(org, { page: 2, pageSize: 4 });
  const last = await query.listReviewQueue(org, { page: 3, pageSize: 4 });
  assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map(row => row.reviewSubjectId)).size, fixture.latest.all.length);
  const shown = await query.listReviewQueue(org, { page: 1, pageSize: 100, showSuperseded: true });
  assert.equal(shown.items.length, fixture.all.length);
  assert.equal(shown.items.filter(item => item.superseded).length, fixture.old.all.length);
  assert.equal(JSON.stringify(tables), snapshot);
  assert.ok(calls.every(call => call.filters.some(([key, value]) => key === 'organisation_id' && value === org)));
});

test('kind/state/search filters count hidden matches against the complete history, and summary keeps persisted totals', async () => {
  seed();
  const filtered = await query.listReviewQueue(org, { page: 1, pageSize: 25, candidateKind: 'MODEL', state: 'PROPOSED', search: 'model:run-old' });
  assert.equal(filtered.items.length, 0); assert.equal(filtered.supersededCount, 1);
  const shown = await query.listReviewQueue(org, { page: 1, pageSize: 25, candidateKind: 'MODEL', showSuperseded: true });
  assert.equal(shown.items.length, 2); assert.equal(shown.supersededCount, 1);
  const summary = await query.getWorkspaceSummary(org);
  assert.equal(summary.proposed, 18); assert.equal(summary.supersededByState.PROPOSED, 9);
  assert.equal(summary.needsReview - summary.supersededByState.PROPOSED!, 9);
});

test('ties, missing provenance and other connections remain visible; candidates without a review can supersede old reviews', async () => {
  seed();
  tables.acquisition_runs[1].started_at = tables.acquisition_runs[0].started_at;
  assert.equal((await superseded.readSupersededReviews(org)).size, 0);
  tables.acquisition_runs.pop();
  assert.equal((await superseded.readSupersededReviews(org)).size, 0);
  seedReset();
  tables.review_subjects = tables.review_subjects.filter(row => !row.finding_id.endsWith('run-new'));
  assert.equal((await superseded.readSupersededReviews(org)).size, 9);
  const foreign = candidate('AGENT', 'foreign', { agentCode: 'TriagemManifestacaoAgent' }, {
    sourceObject: { connectionId: 'different', externalType: 'file', externalId: 'agent.ts' },
  });
  add('discovery_candidates', { candidate_id: 'foreign', envelope: foreign.candidate, envelope_hash: JSON.stringify(foreign.candidate), acquisition_run_id: 'different-run' });
  add('acquisition_runs', { run_id: 'different-run', source_connection_id: 'different', started_at: '2099-01-01T00:00:00Z' });
  assert.equal((await superseded.readSupersededReviews(org)).size, 9);
});
function seedReset() { tables = {}; seed(); }

test('reads span server pages and refuse errors, corrupt hashes, foreign rows and truncated histories', async () => {
  seed();
  const run = tables.acquisition_runs[0];
  for (let i = 0; i < 200; i++) add('acquisition_runs', { ...run, run_id: `extra:${i}` });
  await superseded.readSupersededReviews(org);
  assert.ok(calls.some(call => call.table === 'acquisition_runs' && call.start === 200));
  failed = true; await assert.rejects(() => superseded.readSupersededReviews(org), /READ_FAILED/);
  failed = false; corrupt = true; await assert.rejects(() => superseded.readSupersededReviews(org), /TENANT_MISMATCH/);
  corrupt = false; tables.discovery_candidates[0].envelope_hash = 'corrupt';
  await assert.rejects(() => superseded.readSupersededReviews(org), /HASH_MISMATCH/);
  tables.discovery_candidates = [];
  tables.acquisition_runs = Array.from({ length: 10001 }, (_, i) => ({ ...run, run_id: `cap:${i}` }));
  await assert.rejects(() => superseded.readSupersededReviews(org), /READ_LIMIT_EXCEEDED/);
});
