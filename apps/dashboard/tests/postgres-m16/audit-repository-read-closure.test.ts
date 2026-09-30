import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { auditPostgresClient, type AuditSql } from '../helpers/audit-postgres-client';
import { fullChainCluster, INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import type { LedgerFilters } from '../../repositories/audit';

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

test('M16 S1B.2R4 audit repository: canonical reads, tenant isolation and query failures (disposable PG17)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r3: true });
  t.after(() => pg.stop());
  const denied: string[] = [];
  const sql: AuditSql = async (query, role) => {
    try { return await pg.sql(query, role); }
    catch (error) { denied.push(`${role}: ${String(error)}`); throw error; }
  };
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'r4-anon', SUPABASE_SERVICE_ROLE_KEY: 'r4-service' });
  const { db } = await import('../../lib/db');
  const bind = (transport: AuditSql = sql) => Object.assign(db, {
    read: auditPostgresClient(transport, 'anon'), write: auditPostgresClient(transport, 'service_role'),
  });
  bind();
  const { getIntegrity, getEvents, getEventById } = await import('../../repositories/audit');
  const orgA = randomUUID(), orgB = randomUUID(), empty = randomUUID();
  const actorA = randomUUID(), actorB = randomUUID();
  const now = Date.now();
  const date = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();
  const append = async (org: string, type: string, description: string, subject: string, actor: string, daysAgo: number) => {
    const sequence = Number(await pg.svc(`select gov_repo.ledger_append(${lit(type)},${lit(description)},${lit(subject)},gen_random_uuid(),${lit(actor)},null,${lit(org)},'{"source":"r4"}')`));
    // Fixture-only event time is outside the immutable/hash fields. Real append and verification remain intact.
    await pg.sql(`update gov_repo.governance_ledger set event_timestamp = ${lit(date(daysAgo))} where entry_sequence = ${sequence}`, 'postgres');
    return sequence;
  };
  const a = [
    await append(orgA, 'POLICY_APPROVED', 'Old policy', 'POLICY', actorA, 45),
    await append(orgA, 'RISK_ACCEPTED', 'Needle risk', 'RISK', actorB, 20),
    await append(orgA, 'POLICY_APPROVED', 'Needle policy', 'POLICY', actorA, 10),
    await append(orgA, 'LOGIN', 'Ordinary login', 'USER', actorA, 5),
    await append(orgA, 'RISK_ACCEPTED', 'Recent risk', 'RISK', actorB, 0),
  ];
  const b = [
    await append(orgB, 'POLICY_APPROVED', 'Needle policy', 'POLICY', actorA, 10),
    await append(orgB, 'FOREIGN', 'Needle foreign', 'POLICY', actorB, 0),
  ];
  const sequences = (events: Array<{ entry_sequence: number }>) => events.map(e => e.entry_sequence);

  await t.test('canonical ACL: anon SELECT is denied, service_role reads real tenant rows', async () => {
    const query = `select count(*) from gov_repo.governance_ledger where organisation_id = ${lit(orgA)}`;
    await assert.rejects(pg.sql(query, 'anon'), /42501[\s\S]*permission denied for table governance_ledger/);
    assert.equal(await pg.svc(query), '5');
  });
  await t.test('getIntegrity: all five components from canonical rows; foreign rows excluded', async () => {
    const result = await getIntegrity(orgA);
    t.diagnostic(`getIntegrity(orgA): ${JSON.stringify(result)}`);
    assert.equal(result.total_entries, 5);
    assert.equal(result.latest_sequence, a[4]);
    assert.equal(result.entries_last_30_days, 4);
    assert.deepEqual([...result.events_by_type].sort((x, y) => x.event_type.localeCompare(y.event_type)), [
      { event_type: 'POLICY_APPROVED', count: 2 }, { event_type: 'RISK_ACCEPTED', count: 2 }, { event_type: 'LOGIN', count: 1 },
    ].sort((x, y) => x.event_type.localeCompare(y.event_type)));
    assert.equal(result.hash_chain_valid, true);
    assert.ok(Number.isFinite(Date.parse(result.last_verified_at!)));
    const foreign = await getIntegrity(orgB);
    assert.equal(foreign.total_entries, 2);
    assert.equal(foreign.latest_sequence, b[1]);
    assert.equal(foreign.entries_last_30_days, 2);
  });
  await t.test('empty tenant: zero metrics, empty lists and null lookup while the global chain verifies', async () => {
    const result = await getIntegrity(empty);
    assert.deepEqual({ ...result, last_verified_at: null }, {
      total_entries: 0, latest_sequence: 0, entries_last_30_days: 0, events_by_type: [], hash_chain_valid: true, last_verified_at: null,
    });
    assert.deepEqual(await getEvents(empty), { events: [], total: 0 });
    assert.equal(await getEventById(empty, a[0]), null);
  });
  await t.test('getEvents: unfiltered descending order, total and tenant boundary', async () => {
    const result = await getEvents(orgA);
    t.diagnostic(`getEvents(orgA): ${JSON.stringify(result)}`);
    assert.equal(result.total, 5);
    assert.deepEqual(sequences(result.events), [...a].reverse());
    assert.ok(result.events.every(e => e.organisation_id === orgA));
    assert.deepEqual(sequences((await getEvents(orgB)).events), [...b].reverse());
  });
  await t.test('getEvents: page/limit/offset and total beyond the last page', async () => {
    for (const [page, expected] of [[1, [a[4], a[3]]], [2, [a[2], a[1]]], [3, [a[0]]], [4, []]] as const) {
      const result = await getEvents(orgA, { page, limit: 2 });
      assert.deepEqual(sequences(result.events), expected);
      assert.equal(result.total, 5);
    }
  });
  const cases: Array<[string, LedgerFilters, number[]]> = [
    ['event_type', { event_type: 'POLICY_APPROVED' }, [a[2], a[0]]],
    ['subject_type', { subject_type: 'RISK' }, [a[4], a[1]]],
    ['actor_id', { actor_id: actorA }, [a[3], a[2], a[0]]],
    ['dateFrom inclusive', { dateFrom: date(10) }, [a[4], a[3], a[2]]],
    ['dateTo inclusive', { dateTo: date(10) }, [a[2], a[1], a[0]]],
    ['date window', { dateFrom: date(20), dateTo: date(10) }, [a[2], a[1]]],
    ['search description case insensitive', { search: 'nEeDlE' }, [a[2], a[1]]],
    ['search event_type', { search: 'approved' }, [a[2], a[0]]],
    ['combined filters exclude matching foreign row', { event_type: 'POLICY_APPROVED', subject_type: 'POLICY', actor_id: actorA, search: 'needle', dateFrom: date(20), dateTo: date(5) }, [a[2]]],
    ['no matches', { search: 'absent' }, []],
  ];
  for (const [name, filters, expected] of cases) await t.test(`getEvents filter: ${name}`, async () => {
    const result = await getEvents(orgA, filters);
    assert.deepEqual(sequences(result.events), expected);
    assert.equal(result.total, expected.length);
    assert.ok(result.events.every(e => e.organisation_id === orgA));
  });
  await t.test('getEvents: pagination preserves filtered total', async () => {
    const result = await getEvents(orgA, { event_type: 'POLICY_APPROVED', page: 2, limit: 1 });
    assert.deepEqual(sequences(result.events), [a[0]]);
    assert.equal(result.total, 2);
  });
  await t.test('getEventById: full existing row, missing sequence and foreign sequence', async () => {
    const result = await getEventById(orgA, a[2]);
    t.diagnostic(`getEventById(orgA, ${a[2]}): ${JSON.stringify(result)}`);
    const expected = JSON.parse(await pg.svc(`select row_to_json(l) from gov_repo.governance_ledger l where entry_sequence = ${a[2]}`));
    assert.deepEqual(result, expected);
    assert.equal(await getEventById(orgA, b[0]), null);
    assert.equal(await getEventById(orgA, 999999), null);
  });
  await t.test('all successful repository reads use allowed roles (no swallowed permission errors)', () => {
    assert.deepEqual(denied, []);
  });
  await t.test('getEvents/getEventById: real query failure rejects instead of returning empty/null', async () => {
    await assert.rejects(getEvents('invalid-uuid'), /invalid input syntax for type uuid/);
    await assert.rejects(getEventById('invalid-uuid', a[0]), /invalid input syntax for type uuid/);
  });
  const failures: Array<[string, (query: string) => boolean]> = [
    ['total_entries', q => q.startsWith('select count(*)') && !q.includes('event_timestamp')],
    ['latest_sequence', q => q.includes('select entry_sequence')],
    ['entries_last_30_days', q => q.startsWith('select count(*)') && q.includes('event_timestamp')],
    ['events_by_type', q => q.includes('select event_type')],
    ['ledger_verify', q => q.includes('gov_repo.ledger_verify(')],
  ];
  for (const [name, matches] of failures) await t.test(`getIntegrity rejects a real database denial in ${name}`, async () => {
    // Fail exactly this component through a real denied SQL request; the other four still execute normally.
    bind((query, role) => pg.sql(query, matches(query) ? 'anon' : role));
    try { await assert.rejects(getIntegrity(orgA), /permission denied/); }
    finally { bind(); }
  });
  await t.test('R3 aggregation keeps descending counts and top-ten cap', async () => {
    const many = randomUUID();
    for (let i = 0; i < 12; i++) await append(many, `TYPE_${i}`, 'cap', 'S', actorA, 0);
    await append(many, 'TYPE_11', 'cap', 'S', actorA, 0);
    const result = await getIntegrity(many);
    assert.equal(result.total_entries, 13);
    assert.equal(result.events_by_type.length, 10);
    assert.deepEqual(result.events_by_type[0], { event_type: 'TYPE_11', count: 2 });
    assert.ok(result.events_by_type.slice(1).every(e => e.count === 1));
  });
  await t.test('getEvents defaults to the first 50 rows and keeps the full tenant total', async () => {
    const many = randomUUID();
    await pg.svc(`select gov_repo.ledger_append('PAGE','default page','S',gen_random_uuid(),${lit(actorA)},null,${lit(many)},'{}') from generate_series(1,51)`);
    const expected: number[] = JSON.parse(await pg.svc(`select json_agg(entry_sequence order by entry_sequence desc) from gov_repo.governance_ledger where organisation_id = ${lit(many)}`));
    const first = await getEvents(many);
    assert.equal(first.total, 51);
    assert.deepEqual(sequences(first.events), expected.slice(0, 50));
    const second = await getEvents(many, { page: 2 });
    assert.equal(second.total, 51);
    assert.deepEqual(sequences(second.events), expected.slice(50));
  });
  await t.test('R3 global verification unchanged: foreign tampering makes hash_chain_valid false', async () => {
    await pg.sql(`insert into gov_repo.governance_ledger(event_type,event_description,subject_type,subject_id,actor_user_id,organisation_id,previous_hash,entry_hash,payload)
      select 'TAMPER','t','S',gen_random_uuid(),gen_random_uuid(),${lit(orgB)},entry_hash,repeat('f',64),'{}' from gov_repo.governance_ledger order by entry_sequence desc limit 1`, 'postgres');
    assert.equal((await getIntegrity(orgA)).hash_chain_valid, false);
    assert.equal((await getIntegrity(empty)).hash_chain_valid, false);
  });
  await t.test('canonical application routine surface remains exactly 22', async () => {
    const inventory: InventoryRow[] = JSON.parse(await pg.sql(INVENTORY_SQL, 'postgres'));
    assert.equal(inventory.filter(row => row.app).length, 22);
  });
});
