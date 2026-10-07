import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fullChainCluster } from '../helpers/m16-definer-surface-fixtures';

import { auditPostgresClient as bridge, type AuditSql as Sql } from '../helpers/audit-postgres-client';
const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * M16-S1B.2R3 audit integrity read path (disposable PG17, canonical catalog: full primary chain + R1 + R2 + R3).
 * The dashboard has exactly two established database clients: db.read (anon key -> role anon) and db.write (service-role
 * key -> role service_role, already the ledger_verify path). The REAL repositories/audit.ts getIntegrity() runs here with
 * each client bound to its real database role, so events_by_type is aggregated from actual governance_ledger rows.
 */
test('M16 S1B.2R3 audit integrity: events_by_type read path on the canonical catalog (disposable PG17)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r3: true });
  t.after(() => pg.stop());
  const { svc } = pg;
  const sql: Sql = (query, role) => pg.sql(query, role);

  // Real module, real repository; only the two clients' transport is bound to the disposable cluster.
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'r3-anon', SUPABASE_SERVICE_ROLE_KEY: 'r3-service' });
  const { db } = await import('../../lib/db');
  Object.assign(db, { read: bridge(sql, 'anon'), write: bridge(sql, 'service_role') });
  const { getIntegrity } = await import('../../repositories/audit');

  const orgA = randomUUID(), orgB = randomUUID(), empty = randomUUID();
  const append = (org: string, type: string) =>
    svc(`select gov_repo.ledger_append(${lit(type)},'d','SUBJECT',gen_random_uuid(),gen_random_uuid(),null,'${org}'::uuid,'{}'::jsonb)`);
  const eventTypes = (org: string) => `select coalesce(json_agg(event_type order by event_type), '[]') from gov_repo.governance_ledger where organisation_id = '${org}'`;

  await t.test('empty ledger: no event types, the empty chain verifies, contract shape intact', async () => {
    const integrity = await getIntegrity(empty);
    assert.deepEqual(integrity.events_by_type, []);
    assert.equal(integrity.hash_chain_valid, true);
    assert.deepEqual(Object.keys(integrity).sort(),
      ['entries_last_30_days', 'events_by_type', 'hash_chain_valid', 'last_verified_at', 'latest_sequence', 'total_entries']);
  });

  await t.test('reproduction: the anon role (db.read) is denied the tenant ledger read, so it can never yield event_type rows', async () => {
    await append(orgA, 'SEED');
    await assert.rejects(sql(eventTypes(orgA), 'anon'), /42501[\s\S]*permission denied for table governance_ledger/);
    assert.equal(await sql(eventTypes(orgA), 'service_role'), '["SEED"]');
  });

  await t.test('events_by_type is aggregated from the actual tenant event_type rows (other tenants excluded); hash_chain_valid from ledger_verify', async () => {
    for (const [org, type] of [[orgA, 'POLICY_APPROVED'], [orgB, 'FOREIGN'], [orgA, 'RISK_ACCEPTED'], [orgA, 'POLICY_APPROVED'], [orgB, 'FOREIGN'], [orgB, 'FOREIGN']] as const) {
      await append(org, type);
    }
    const a = await getIntegrity(orgA);
    assert.deepEqual([...a.events_by_type].sort((x, y) => y.count - x.count || x.event_type.localeCompare(y.event_type)), [{ event_type: 'POLICY_APPROVED', count: 2 }, { event_type: 'RISK_ACCEPTED', count: 1 }, { event_type: 'SEED', count: 1 }]
      .sort((x, y) => y.count - x.count || x.event_type.localeCompare(y.event_type)));
    assert.equal(a.events_by_type.reduce((sum, row) => sum + row.count, 0), JSON.parse(await sql(eventTypes(orgA), 'service_role')).length);
    assert.equal(a.hash_chain_valid, true);
    assert.deepEqual((await getIntegrity(orgB)).events_by_type, [{ event_type: 'FOREIGN', count: 3 }]);
    assert.deepEqual((await getIntegrity(empty)).events_by_type, []);
  });

  await t.test('ledger_verify RPC contract unchanged; a tampered chain surfaces as hash_chain_valid = false', async () => {
    assert.equal(await svc(`select string_agg(parameter_name || ':' || data_type, ',' order by ordinal_position) from information_schema.parameters
      where specific_name = (select specific_name from information_schema.routines where routine_schema = 'gov_repo' and routine_name = 'ledger_verify')`),
      'p_from_sequence:bigint,p_to_sequence:bigint,is_valid:boolean,entries_checked:bigint,first_break_at:bigint,break_reason:text');
    await pg.sql(`insert into gov_repo.governance_ledger(event_type,event_description,subject_type,subject_id,actor_user_id,organisation_id,previous_hash,entry_hash,payload)
      select 'TAMPER','t','S',gen_random_uuid(),gen_random_uuid(),'${orgB}',entry_hash,repeat('f',64),'{}' from gov_repo.governance_ledger order by entry_sequence desc limit 1`, 'postgres');
    const b = await getIntegrity(orgB);
    assert.equal(b.hash_chain_valid, false);
    assert.deepEqual(b.events_by_type, [{ event_type: 'FOREIGN', count: 3 }, { event_type: 'TAMPER', count: 1 }]);
  });
});
