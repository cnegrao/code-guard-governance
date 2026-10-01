import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AUDIT_API_MAX_ROWS, auditPostgresClient, type AuditSql } from '../helpers/audit-postgres-client';
import { fullChainCluster } from '../helpers/m16-definer-surface-fixtures';

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;
const sequences = (rows: Array<{ entry_sequence: number }>) => rows.map(row => row.entry_sequence);

test('M16 S1B.2R5 audit scale, pagination and query semantics (capped disposable PG17)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r3: true });
  t.after(() => pg.stop());
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'r5-anon', SUPABASE_SERVICE_ROLE_KEY: 'r5-service' });
  const { db } = await import('../../lib/db');
  const queries: string[] = [];
  const sql: AuditSql = (query, role) => { queries.push(query); return pg.sql(query, role); };
  const bind = (transport: AuditSql = sql) => Object.assign(db, {
    read: auditPostgresClient(transport, 'anon'), write: auditPostgresClient(transport, 'service_role'),
  });
  bind();
  const { getIntegrity, getEvents } = await import('../../repositories/audit');
  const org = randomUUID(), foreign = randomUUID(), actor = randomUUID();
  const append = (tenant: string, type: string, description: string, count = 1) => pg.svc(
    `select gov_repo.ledger_append(${lit(type)},${lit(description)},'S',gen_random_uuid(),${lit(actor)},null,${lit(tenant)},'{}') from generate_series(1,${count})`,
  );
  // First 1,000: ten types with distinct counts 145,135,...,55. Last 250: a new winner.
  const head = Array.from({ length: 10 }, (_, i) => ({ event_type: `HEAD_${i}`, count: 145 - i * 10 }));
  for (const row of head) {
    await append(org, row.event_type, 'scale fixture', row.count);
    await append(foreign, 'FOREIGN', 'interleaved sequence gap');
  }
  await append(org, 'TAIL', 'scale fixture', 250);
  const expectedTop = [{ event_type: 'TAIL', count: 250 }, ...head.slice(0, 9)];
  const expected: number[] = JSON.parse(await pg.svc(`select json_agg(entry_sequence order by entry_sequence desc) from gov_repo.governance_ledger where organisation_id = ${lit(org)}`));
  assert.equal(expected.length, 1250);

  await t.test('transport enforces configured 1000 cap even without range or with an oversized range; count stays exact', async () => {
    assert.match(readFileSync(new URL('../../../../supabase/config.toml', import.meta.url), 'utf8'), /max_rows\s*=\s*1000/);
    assert.equal(AUDIT_API_MAX_ROWS, 1000);
    const client = auditPostgresClient(sql, 'service_role');
    for (const ranged of [false, true]) {
      let query = client.from('governance_ledger').select('*', { count: 'exact' }).eq('organisation_id', org).order('entry_sequence');
      if (ranged) query = query.range(0, 1199);
      const result: any = await query;
      assert.equal(result.data.length, 1000);
      assert.equal(result.count, 1250);
    }
  });
  await t.test('scale: exact top ten across all 1250 tenant rows, including the winner beyond row 1000', async () => {
    queries.length = 0;
    const result = await getIntegrity(org);
    t.diagnostic(`1250-row aggregation: ${JSON.stringify(result.events_by_type)}`);
    assert.equal(result.total_entries, 1250);
    assert.deepEqual(result.events_by_type, expectedTop);
    const chunks = queries.filter(q => q.includes('select event_type'));
    assert.equal(chunks.length, 2);
    for (const q of chunks) {
      assert.ok(q.includes(`organisation_id = ${lit(org)}`));
      assert.match(q, /order by entry_sequence asc limit 1000 offset/);
    }
    assert.match(chunks[1], /offset 1000/);
    assert.deepEqual((await getIntegrity(foreign)).events_by_type, [{ event_type: 'FOREIGN', count: 10 }]);
  });
  await t.test('scale: second-chunk database denial rejects the entire integrity result', async () => {
    let failed = false;
    bind((query, role) => {
      if (query.includes('select event_type') && query.includes('offset 1000')) {
        failed = true;
        return pg.sql(query, 'anon');
      }
      return sql(query, role);
    });
    try { await assert.rejects(getIntegrity(org), /permission denied/); assert.equal(failed, true); }
    finally { bind(); }
  });
  await t.test('scale: exact chunk multiple requests the empty terminal page', async () => {
    const exact = randomUUID();
    await append(exact, 'EXACT', 'exact chunk', 1000);
    queries.length = 0;
    assert.deepEqual((await getIntegrity(exact)).events_by_type, [{ event_type: 'EXACT', count: 1000 }]);
    assert.equal(queries.filter(q => q.includes('select event_type')).length, 2);
  });
  for (const limit of [50, 1000]) await t.test(`pagination: limit ${limit}, every page, exact total, no skips or duplicates`, async () => {
    const found: number[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / limit) + 1; page++) {
      const result = await getEvents(org, { page, limit });
      assert.equal(result.total, 1250);
      assert.deepEqual(sequences(result.events), expected.slice((page - 1) * limit, page * limit));
      assert.ok(result.events.every(row => row.organisation_id === org));
      found.push(...sequences(result.events));
    }
    assert.deepEqual(found, expected);
    assert.equal(new Set(found).size, 1250);
  });
  await t.test('pagination: limits above 1000 reject before any query (R4 omits 100 rows at limit 1100)', async () => {
    // Diagnostic is useful on the unchanged R4 implementation during the BEFORE run.
    try {
      const first = await getEvents(org, { limit: 1100, page: 1 });
      const second = await getEvents(org, { limit: 1100, page: 2 });
      t.diagnostic(`BEFORE oversized: lengths=${first.events.length},${second.events.length}; total=${first.total}; omitted=${1250 - new Set([...sequences(first.events), ...sequences(second.events)]).size}`);
    } catch (error) { assert.ok(error instanceof RangeError); }
    for (const limit of [1001, 1100, 2000]) for (const page of [1, 2]) {
      queries.length = 0;
      await assert.rejects(getEvents(org, { page, limit }), RangeError);
      assert.equal(queries.length, 0);
    }
  });
  await t.test('pagination: invalid/nonpositive/nonfinite/fractional/unsafe page or limit rejects consistently', async () => {
    for (const field of ['page', 'limit'] as const) for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(getEvents(org, { [field]: value }), RangeError);
    }
    await assert.rejects(getEvents(org, { page: Number.MAX_SAFE_INTEGER, limit: 1000 }), RangeError);
    assert.deepEqual(sequences((await getEvents(org)).events), expected.slice(0, 50));
  });
  const searches = ['alpha,beta', '(policy)', 'risk)', '(risk', 'alpha,beta(policy)', 'nEeDlE', 'quote"value', 'x",event_type.ilike.%,event_description.ilike."y'];
  for (const search of searches) await t.test(`search: ${JSON.stringify(search)} in description and type, case insensitive and tenant bound`, async () => {
    const tenant = randomUUID();
    await append(tenant, 'DESCRIPTION_MATCH', `prefix ${search.toUpperCase()} suffix`);
    await append(tenant, `prefix ${search.toUpperCase()} suffix`, 'type-only');
    await append(tenant, 'UNRELATED', 'unrelated');
    await append(foreign, `prefix ${search} suffix`, `prefix ${search} suffix`);
    const expectedIds: number[] = JSON.parse(await pg.svc(`select json_agg(entry_sequence order by entry_sequence desc) from gov_repo.governance_ledger where organisation_id = ${lit(tenant)} and event_type <> 'UNRELATED'`));
    const result = await getEvents(tenant, { search });
    t.diagnostic(`search ${JSON.stringify(search)}: total=${result.total}`);
    assert.equal(result.total, 2);
    assert.deepEqual(sequences(result.events), expectedIds);
    assert.ok(result.events.every(row => row.organisation_id === tenant));
  });
});
