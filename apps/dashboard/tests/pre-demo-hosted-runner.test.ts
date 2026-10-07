import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { Fixture } from '../scripts/accept-hosted-pre-demo';

const literals = ['É', 'é', 'x*y', 'a.b', '50%', 'a_b', 'C:\\temp', 'alpha,beta(policy)', 'quote"value'];
const fixture: Fixture = { baseUrl: 'https://hosted.fixture.invalid', tenants: ['A', 'B'].map((organisationId, index) => ({
  organisationId, cookieEnv: `H1_COOKIE_${organisationId}`, total: index ? 10 : 1001,
  latestSequence: index ? 10 : 1001, eventsByType: [{ event_type: 'TYPE', count: index ? 10 : 1001 }],
  searches: literals.map((literal, i) => ({ literal, sequences: i < 2 ? [2, 1] : [i + 1] })),
})) };
let mode = '', requests = 0;
let run: typeof import('../scripts/accept-hosted-pre-demo').runHostedAcceptance;
before(async () => {
  process.env.SUPABASE_URL = 'https://db.fixture.invalid';
  process.env.H1_COOKIE_A = 'A'; process.env.H1_COOKIE_B = 'B';
  mock.module('../repositories/audit', { namedExports: {
    getEvents: async (org: string, filters: { page?: number; limit: number; search?: string }) => {
      const tenant = fixture.tenants.find(t => t.organisationId === org)!;
      const sequences = filters.search ? tenant.searches.find(s => s.literal === filters.search)!.sequences
        : Array.from({ length: tenant.total }, (_, i) => tenant.total - i).slice(((filters.page ?? 1) - 1) * filters.limit, (filters.page ?? 1) * filters.limit);
      const events = sequences.map(entry_sequence => ({ entry_sequence, organisation_id: mode === 'foreign' ? 'FOREIGN' : org,
        event_type: 'TYPE', event_description: entry_sequence === 1 ? 'é' : entry_sequence === 2 ? 'É' : literals[entry_sequence - 1] ?? 'plain' }));
      return { events: mode === 'cap' ? events.slice(0, 500) : events, total: filters.search ? sequences.length : tenant.total };
    },
    getIntegrity: async (org: string) => {
      const tenant = fixture.tenants.find(t => t.organisationId === org)!;
      return { total_entries: tenant.total, latest_sequence: tenant.latestSequence, hash_chain_valid: mode !== 'integrity', events_by_type: tenant.eventsByType };
    },
  } });
  mock.method(globalThis, 'fetch', async (input: URL | string | Request, init?: RequestInit) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.origin, fixture.baseUrl);
    const tenant = fixture.tenants.find(t => t.organisationId === new Headers(init?.headers).get('cookie'))!;
    assert.notEqual(url.searchParams.get('organisation_id'), tenant.organisationId, 'runner sends hostile tenant input');
    return Response.json(url.pathname.endsWith('/events')
      ? { total: tenant.total, events: [{ organisation_id: mode === 'session' ? 'FOREIGN' : tenant.organisationId }] }
      : { total_entries: tenant.total, latest_sequence: tenant.latestSequence, events_by_type: tenant.eventsByType });
  });
  run = (await import('../scripts/accept-hosted-pre-demo')).runHostedAcceptance;
});
test('runner exercises pagination, literal fixtures and authenticated HTTP routes (simulated only)', async () => {
  mode = ''; requests = 0; await run(fixture); assert.equal(requests, 12);
});
test('runner rejects row caps, foreign data, failed integrity and wrong session tenant', async () => {
  for (mode of ['cap', 'foreign', 'integrity', 'session']) await assert.rejects(run(fixture));
  mode = '';
});
test('runner refuses vacuous Unicode and single-tenant acceptance', async () => {
  await assert.rejects(run({ ...fixture, tenants: [fixture.tenants[0]] }));
  const invalid = structuredClone(fixture);
  invalid.tenants[0].searches[0].sequences = [];
  await assert.rejects(run(invalid));
});
