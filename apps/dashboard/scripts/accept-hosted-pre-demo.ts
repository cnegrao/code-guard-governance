/** Read-only real HTTP acceptance. Never seeds or changes hosted configuration. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEvents, getIntegrity } from '../repositories/audit';

interface TenantFixture {
  organisationId: string;
  cookieEnv: string;
  total: number;
  latestSequence: number;
  eventsByType: Array<{ event_type: string; count: number }>;
  searches: Array<{ literal: string; sequences: number[] }>;
}
export interface Fixture { baseUrl: string; tenants: TenantFixture[] }
export async function runHostedAcceptance(fixture: Fixture) {
  assert.equal(new URL(fixture.baseUrl).protocol, 'https:');
  assert.equal(new URL(process.env.SUPABASE_URL!).protocol, 'https:');
  assert.ok(fixture.tenants.length >= 2, 'Two independently identified tenants required');
  assert.equal(new Set(fixture.tenants.map(t => t.organisationId)).size, fixture.tenants.length);
  assert.ok(fixture.tenants.some(t => t.total > 1000), 'A >1000-row tenant is required to prove max_rows and chunking');
  for (const tenant of fixture.tenants) {
    assert.ok(Number.isSafeInteger(tenant.total) && tenant.total >= 0);
    assert.ok(Number.isSafeInteger(tenant.latestSequence) && tenant.latestSequence >= 0);
    assert.ok(process.env[tenant.cookieEnv], `Missing session cookie environment variable: ${tenant.cookieEnv}`);
    assert.ok(tenant.searches.some(s => s.literal === 'É' && s.sequences.length > 0));
    assert.ok(tenant.searches.some(s => s.literal === 'é' && s.sequences.length > 0));
    assert.deepEqual(tenant.searches.find(s => s.literal === 'É')!.sequences,
      tenant.searches.find(s => s.literal === 'é')!.sequences, 'Unicode case searches must find the same rows');
    for (const literal of ['x*y', 'a.b', '50%', 'a_b', 'C:\\temp', 'alpha,beta(policy)', 'quote"value']) {
      assert.ok(tenant.searches.some(s => s.literal === literal && s.sequences.length > 0), `Missing literal fixture: ${literal}`);
    }
    const ids: number[] = [];
    for (let page = 1; ids.length < tenant.total || page === 1; page++) {
      const rows = await getEvents(tenant.organisationId, { page, limit: 1000 });
      assert.equal(rows.total, tenant.total);
      assert.equal(rows.events.length, Math.min(1000, tenant.total - ids.length));
      assert.ok(rows.events.every(row => row.organisation_id === tenant.organisationId));
      ids.push(...rows.events.map(row => row.entry_sequence));
    }
    assert.equal(new Set(ids).size, tenant.total);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    const integrity = await getIntegrity(tenant.organisationId);
    assert.equal(integrity.total_entries, tenant.total);
    assert.equal(integrity.latest_sequence, tenant.latestSequence);
    assert.equal(integrity.hash_chain_valid, true);
    const sorted = (rows: typeof tenant.eventsByType) => [...rows].sort((a,b) => a.event_type.localeCompare(b.event_type));
    assert.deepEqual(sorted(integrity.events_by_type), sorted(tenant.eventsByType));
    for (const search of tenant.searches) {
      assert.ok(search.sequences.length <= 1000, 'Literal fixture must fit one acceptance page');
      const rows = await getEvents(tenant.organisationId, { search: search.literal, limit: 1000 });
      assert.equal(rows.total, search.sequences.length);
      assert.deepEqual(rows.events.map(row => row.entry_sequence), search.sequences);
      assert.ok(rows.events.every(row => row.organisation_id === tenant.organisationId));
      if (search.literal === 'É' || search.literal === 'é') {
        for (const letter of ['É', 'é']) assert.ok(rows.events.some(row =>
          row.event_description.includes(letter) || row.event_type.includes(letter)), `Missing ${letter} witness`);
      }
    }
    // Prove session tenant binding at the actual product ingress, including hostile tenant input.
    const foreign = fixture.tenants.find(t => t.organisationId !== tenant.organisationId)!;
    for (const route of ['/api/audit/events', '/api/audit/integrity', '/api/dashboard/summary', '/api/agents', '/api/systems', '/api/discovery/review']) {
      const url = new URL(route, fixture.baseUrl);
      url.searchParams.set('organisation_id', foreign.organisationId);
      const response = await fetch(url, { headers: { cookie: process.env[tenant.cookieEnv]! }, redirect: 'error' });
      assert.equal(response.status, 200, `Hosted route failed: ${route}`);
      const body = await response.json();
      if (route === '/api/audit/events') {
        assert.equal(body.total, tenant.total);
        assert.ok(body.events.every((row: {organisation_id: string}) => row.organisation_id === tenant.organisationId));
      }
      if (route === '/api/audit/integrity') {
        assert.equal(body.total_entries, tenant.total);
        assert.equal(body.latest_sequence, tenant.latestSequence);
        assert.deepEqual(sorted(body.events_by_type), sorted(tenant.eventsByType));
      }
    }
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/accept-hosted-pre-demo.ts')) {
  Promise.resolve().then(async () => {
    assert.ok(process.argv[2], 'Fixture file required');
    await runHostedAcceptance(JSON.parse(readFileSync(process.argv[2], 'utf8')) as Fixture);
    console.log('REAL_HTTP_H1_PASS: schema, max_rows, repository reads, literals, Unicode and session tenant binding verified. Independent review still required.');
  }).catch(() => { console.error('HOSTED_ACCEPTANCE_FAILED: check fixture, server configuration and HTTP responses privately; no credentials logged.'); process.exitCode = 1; });
}
