import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { l14RegistryFrameworkMigration } from '../helpers/disposable-m16-postgres';
import { L14_TABLES, l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';

const PUBLIC_RPCS = ['l14_admit_authority_policy_version_v1', 'l14_decide_authority_policy_proposal_v1', 'l14_submit_proposal_v1'];
const APP_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const S1B0_TABLES = [...L14_TABLES, 'l14_registry_states'].sort();
const S1B0_HELPERS = [
  'l14_authority_policy_rule_registry_scope_guard_v1()', 'l14_decision_rule_snapshot_guard_v1()',
  'l14_lock_authority_policy_guard_shared_v1(uuid)', 'l14_lock_registry_subject_guard_v1(uuid,text,text)',
  'l14_resolve_support_v1(uuid,text[])', 'l14_snapshot_policy_rules_v1(uuid,uuid,uuid,uuid,integer[])',
  'l14_support_syntactic_parts_v1(text,text[])',
];

/**
 * M16-S1B.0 real-catalog ACL checker over the whole L14 surface at the S1B horizon (the S1A
 * suite keeps asserting the exact S1A catalog at its own horizon). Same checker classes as S1A:
 * every gov_repo relation/routine named l14_* plus any gov_repo view depending on an l14_* table.
 */
const CHECKER_SQL = `
with privs as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  || case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else array[]::text[] end) as p),
roles as (select unnest(array['anon','authenticated','service_role']) as r),
rels as (select c.oid, c.relname::text as name, c.relkind, c.relowner, c.relacl, c.reloptions from pg_class c
  where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m','S','f')
    and (c.relname like 'l14\\_%' or (c.relkind in ('v','m') and exists (
      select 1 from pg_rewrite w join pg_depend d on d.objid=w.oid join pg_class t on t.oid=d.refobjid
      where w.ev_class=c.oid and t.relname like 'l14\\_%' and t.relnamespace='gov_repo'::regnamespace)))),
v(line) as (
  select 'table-priv:'||r||':'||p||':'||name from rels, roles, privs where relkind<>'S' and has_table_privilege(r, oid, p)
  union all select 'column-priv:'||r||':'||name from rels, roles where relkind in ('r','p','v','m','f') and has_any_column_privilege(r, oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  union all select 'sequence-priv:'||r||':'||sp||':'||name from rels, roles, unnest(array['USAGE','SELECT','UPDATE']) sp where relkind='S' and has_sequence_privilege(r, oid, sp)
  union all select 'public-grant:'||name from rels, aclexplode(coalesce(relacl, acldefault((case when relkind='S' then 's' else 'r' end)::"char", relowner))) a where a.grantee=0
  union all select 'non-invoker-view:'||name from rels where relkind in ('v','m') and not coalesce(reloptions @> array['security_invoker=true'], false)
  union all select 'l14-relation-not-table:'||name from rels where relkind<>'r' and name like 'l14\\_%'
  union all select 'routine-public:'||p.proname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%' and a.grantee=0 and a.privilege_type='EXECUTE'
  union all select 'routine-execute:'||r||':'||p.proname from pg_proc p, roles
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%' and has_function_privilege(r, p.oid, 'EXECUTE')
      and not (r='service_role' and p.proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}]))
  union all select 'routine-shape:'||p.proname from pg_proc p
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%'
      and (not coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false)
        or p.prosecdef <> (p.proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}])))
)
select coalesce(string_agg(line, E'\\n' order by line), '') from v;`;

test('M16 S1B.0 L14 registry framework ACL / privilege boundary (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B0' });
  t.after(() => c.stop());
  const { owner, bootstrapSql, sql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const violations = async () => (await bootstrapSql(CHECKER_SQL)).split('\n').map(line => line.trim()).filter(Boolean);
  const migration = readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${l14RegistryFrameworkMigration}`, import.meta.url)), 'utf8');
  const postflight = migration.slice(migration.indexOf('DO $postflight$'), migration.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(postflight.startsWith('DO $postflight$') && postflight.includes('M16_S1B0_POSTFLIGHT'), 'S1B.0 postflight block extracted');

  await t.test('ACL postflight: zero violations with the hostile legacy grants/defaults in the chain; the S1B.0 postflight re-executes cleanly', async () => {
    assert.equal(await one(`select count(*) from pg_default_acl d where d.defaclnamespace='gov_repo'::regnamespace`), '3',
      'the hostile 20260818013113 default privileges are present in the fixture chain');
    assert.deepEqual(await violations(), []);
    await owner(postflight);
  });

  await t.test('exact surface: 14 RLS tables, exactly the 3 S1A service_role RPCs, owner-only internals, no sequences/views', async () => {
    assert.equal(await one(`select string_agg(relname::text, ',' order by relname::text collate "C") from pg_class
      where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%' and relkind in ('r','p','v','m','S','f')`), S1B0_TABLES.join(','));
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%' and relkind='r' and relrowsecurity`), '14');
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and has_function_privilege('service_role', oid, 'EXECUTE')`), PUBLIC_RPCS.join(','),
      'no new service_role-executable L14 routine');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and prosecdef`), '3');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}])`),
      '3', 'no overloads of the public RPCs');
    for (const helper of S1B0_HELPERS) {
      assert.equal(await one(`select prosecdef::text||':'||coalesce(array_to_string(proacl, ';'), 'default') from pg_proc where oid='gov_repo.${helper}'::regprocedure`)
        .then(v => v.startsWith('false:')), true, `${helper} is SECURITY INVOKER`);
      for (const role of APP_ROLES) {
        assert.equal(await one(`select has_function_privilege('${role}', 'gov_repo.${helper}'::regprocedure, 'EXECUTE')`), 'f', `${role} ${helper}`);
      }
    }
  });

  await t.test('direct app-role access denied on every L14 table incl. l14_registry_states (read, DML, TRUNCATE)', async () => {
    for (const table of S1B0_TABLES) {
      for (const role of APP_ROLES) {
        for (const statement of [`select 1 from gov_repo.${table} limit 1`, `insert into gov_repo.${table} default values`,
          `update gov_repo.${table} set organisation_id=organisation_id`, `delete from gov_repo.${table}`, `truncate gov_repo.${table}`]) {
          await assert.rejects(sql(statement, role), (error: Error) => { assert.match(error.message, /42501/, `${role}: ${statement}`); return true; });
        }
      }
    }
  });

  await t.test('RPC execute boundary: new helpers owner-only; application roles get 42501; public RPCs unchanged', async () => {
    for (const call of [`select gov_repo.l14_lock_authority_policy_guard_shared_v1(gen_random_uuid())`,
      `select gov_repo.l14_lock_registry_subject_guard_v1(gen_random_uuid(),'GOVERNANCE_PARTY','k')`,
      `select gov_repo.l14_support_syntactic_parts_v1('NONE','{}'::text[])`,
      `select gov_repo.l14_resolve_support_v1(gen_random_uuid(),'{}'::text[])`,
      `select gov_repo.l14_snapshot_policy_rules_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}'::int[])`,
      `select gov_repo.l14_parse_authority_policy_rules_v1(gen_random_uuid(),'[]'::jsonb)`]) {
      for (const role of APP_ROLES) await assert.rejects(sql(call, role), /42501/, `${role}: ${call}`);
    }
    for (const rpc of PUBLIC_RPCS) {
      const oid = await one(`select oid from pg_proc where pronamespace='gov_repo'::regnamespace and proname='${rpc}'`);
      assert.equal(await one(`select has_function_privilege('service_role', ${oid}, 'EXECUTE')`), 't');
      for (const role of ['anon', 'authenticated']) assert.equal(await one(`select has_function_privilege('${role}', ${oid}, 'EXECUTE')`), 'f');
    }
  });

  interface Control { key: string; apply: string; expect: RegExp; cleanup: string; as?: 'owner' | 'bootstrap' }
  const controls: Control[] = [
    { key: 'table direct DML (INSERT on the registry envelope)', apply: `grant insert on gov_repo.l14_registry_states to service_role`,
      expect: /^table-priv:service_role:INSERT:l14_registry_states$/m, cleanup: `revoke insert on gov_repo.l14_registry_states from service_role` },
    { key: 'table direct DML (UPDATE on a widened envelope)', apply: `grant update on gov_repo.l14_command_results to service_role`,
      expect: /^table-priv:service_role:UPDATE:l14_command_results$/m, cleanup: `revoke update on gov_repo.l14_command_results from service_role` },
    { key: 'table direct DML (DELETE)', apply: `grant delete on gov_repo.l14_registry_states to authenticated`,
      expect: /^table-priv:authenticated:DELETE:l14_registry_states$/m, cleanup: `revoke delete on gov_repo.l14_registry_states from authenticated` },
    { key: 'SELECT (direct read)', apply: `grant select on gov_repo.l14_registry_states to service_role`,
      expect: /^table-priv:service_role:SELECT:l14_registry_states$/m, cleanup: `revoke select on gov_repo.l14_registry_states from service_role` },
    { key: 'TRUNCATE', apply: `grant truncate on gov_repo.l14_registry_states to authenticated`,
      expect: /^table-priv:authenticated:TRUNCATE:l14_registry_states$/m, cleanup: `revoke truncate on gov_repo.l14_registry_states from authenticated` },
    { key: 'REFERENCES', apply: `grant references on gov_repo.l14_registry_states to anon`,
      expect: /^table-priv:anon:REFERENCES:l14_registry_states$/m, cleanup: `revoke references on gov_repo.l14_registry_states from anon` },
    { key: 'TRIGGER', apply: `grant trigger on gov_repo.l14_registry_states to service_role`,
      expect: /^table-priv:service_role:TRIGGER:l14_registry_states$/m, cleanup: `revoke trigger on gov_repo.l14_registry_states from service_role` },
    { key: 'MAINTAIN (PG17)', apply: `grant maintain on gov_repo.l14_registry_states to service_role`,
      expect: /^table-priv:service_role:MAINTAIN:l14_registry_states$/m, cleanup: `revoke maintain on gov_repo.l14_registry_states from service_role` },
    { key: 'column-level privilege (new audit column)', apply: `grant update (expectation_kind) on gov_repo.l14_authorization_decisions to service_role`,
      expect: /^column-priv:service_role:l14_authorization_decisions$/m, cleanup: `revoke update (expectation_kind) on gov_repo.l14_authorization_decisions from service_role` },
    { key: 'PUBLIC table grant', apply: `grant select on gov_repo.l14_registry_states to public`,
      expect: /^public-grant:l14_registry_states$/m, cleanup: `revoke select on gov_repo.l14_registry_states from public` },
    { key: 'sequence privileges (default-privilege reintroduction)', apply: `create sequence gov_repo.l14_negctl_seq`,
      expect: /^sequence-priv:service_role:USAGE:l14_negctl_seq$/m, cleanup: `drop sequence gov_repo.l14_negctl_seq` },
    { key: 'routine EXECUTE (new routine: PUBLIC + legacy default)', apply: `create function gov_repo.l14_negctl_fn() returns int language sql set search_path = pg_catalog, pg_temp as 'select 1'`,
      expect: /(?=[\s\S]*^routine-public:l14_negctl_fn$)(?=[\s\S]*^routine-execute:service_role:l14_negctl_fn$)/m, cleanup: `drop function gov_repo.l14_negctl_fn()` },
    { key: 'routine EXECUTE (new S1B.0 helper granted)', apply: `grant execute on function gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text) to service_role`,
      expect: /^routine-execute:service_role:l14_lock_registry_subject_guard_v1$/m,
      cleanup: `revoke execute on function gov_repo.l14_lock_registry_subject_guard_v1(uuid,text,text) from service_role` },
    { key: 'new service_role public L14 RPC (definer)', apply: `create function gov_repo.l14_negctl_rpc() returns int language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_negctl_rpc() from public;
        grant execute on function gov_repo.l14_negctl_rpc() to service_role`,
      expect: /(?=[\s\S]*^routine-execute:service_role:l14_negctl_rpc$)(?=[\s\S]*^routine-shape:l14_negctl_rpc$)/m, cleanup: `drop function gov_repo.l14_negctl_rpc()` },
    { key: 'unpinned search_path helper', apply: `create function gov_repo.l14_negctl_path() returns int language sql as 'select 1';
        revoke all on function gov_repo.l14_negctl_path() from public, service_role`,
      expect: /^routine-shape:l14_negctl_path$/m, cleanup: `drop function gov_repo.l14_negctl_path()` },
    { key: 'updatable non-invoker view inside the surface', apply: `create view gov_repo.l14_negctl_view as select * from gov_repo.l14_registry_states`,
      expect: /^non-invoker-view:l14_negctl_view$/m, cleanup: `drop view gov_repo.l14_negctl_view` },
    { key: 'updatable view outside the prefix exposing the envelope', apply: `create view gov_repo.negctl_exposure with (security_invoker=true) as select * from gov_repo.l14_registry_states;
      grant select, insert on gov_repo.negctl_exposure to authenticated`,
      expect: /^table-priv:authenticated:INSERT:negctl_exposure$/m, cleanup: `drop view gov_repo.negctl_exposure` },
    { key: 'inherited role grant', as: 'bootstrap', apply: `create role l14_negctl_group nologin; grant usage on schema gov_repo to l14_negctl_group;
      set role postgres; grant select on gov_repo.l14_registry_states to l14_negctl_group; reset role; grant l14_negctl_group to service_role`,
      expect: /^table-priv:service_role:SELECT:l14_registry_states$/m,
      cleanup: `revoke l14_negctl_group from service_role; set role postgres; revoke select on gov_repo.l14_registry_states from l14_negctl_group; reset role;
        revoke usage on schema gov_repo from l14_negctl_group; drop role l14_negctl_group` },
    { key: 'default-privilege reintroduction (new table)', apply: `alter default privileges for role postgres in schema gov_repo grant select on tables to authenticated;
      create table gov_repo.l14_negctl_table (x int)`,
      expect: /(?=[\s\S]*^table-priv:authenticated:SELECT:l14_negctl_table$)(?=[\s\S]*^table-priv:service_role:INSERT:l14_negctl_table$)/m,
      cleanup: `drop table gov_repo.l14_negctl_table; alter default privileges for role postgres in schema gov_repo revoke select on tables from authenticated` },
  ];
  for (const control of controls) {
    await t.test(`negative control detected: ${control.key}`, async () => {
      const run = control.as === 'bootstrap' ? bootstrapSql : owner;
      await run(control.apply);
      try {
        const found = (await violations()).join('\n');
        assert.match(found, control.expect, `checker missed ${control.key}:\n${found}`);
        await assert.rejects(owner(postflight), /M16_S1B0_POSTFLIGHT/, 'the S1B.0 migration postflight also fails closed');
      } finally {
        await run(control.cleanup);
      }
      assert.deepEqual(await violations(), [], 'clean again after the control is removed');
    });
  }

  await t.test('postflight also fails closed on disabled / missing structural guards (immutability, snapshot, D-14)', async () => {
    for (const [apply, cleanup] of [
      ['alter table gov_repo.l14_registry_states disable trigger l14_registry_states_immutable', 'alter table gov_repo.l14_registry_states enable always trigger l14_registry_states_immutable'],
      ['alter table gov_repo.l14_registry_states enable trigger l14_registry_states_no_truncate', 'alter table gov_repo.l14_registry_states enable always trigger l14_registry_states_no_truncate'],
      ['alter table gov_repo.l14_authorization_decision_rules disable trigger l14_authorization_decision_rules_snapshot_guard',
        'alter table gov_repo.l14_authorization_decision_rules enable always trigger l14_authorization_decision_rules_snapshot_guard'],
      ['alter table gov_repo.l14_authority_policy_rules disable trigger l14_authority_policy_rules_registry_scope_guard',
        'alter table gov_repo.l14_authority_policy_rules enable always trigger l14_authority_policy_rules_registry_scope_guard'],
      ['alter table gov_repo.l14_registry_states add column payload jsonb', 'alter table gov_repo.l14_registry_states drop column payload'],
    ]) {
      await owner(apply);
      try { await assert.rejects(owner(postflight), /M16_S1B0_POSTFLIGHT/, apply); } finally { await owner(cleanup); }
    }
    await owner(postflight);
  });

  await t.test('writable-view control really is writable (so the exposure class is meaningful)', async () => {
    await owner(`create view gov_repo.negctl_probe with (security_invoker=true) as select * from gov_repo.l14_registry_states`);
    try {
      assert.equal(await one(`select is_insertable_into from information_schema.views where table_schema='gov_repo' and table_name='negctl_probe'`), 'YES');
    } finally { await owner(`drop view gov_repo.negctl_probe`); }
  });

  await t.test('S0 contracts unchanged: exactly six *_governed_v1 wrappers; no l14 routine named *eligibility*/*governed*', async () => {
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%\\_governed\\_v1'`), '6');
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like '%eligibility%'`),
      'lock_and_resolve_governance_session_eligibility_v1,require_governed_write_eligibility_v1');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%'
      and (proname like '%eligibility%' or proname like '%governed%')`), '0');
    assert.equal(await one(`select has_function_privilege('service_role',
      'gov_repo.require_governed_write_eligibility_v1(uuid,uuid,bigint,bigint,timestamptz)'::regprocedure, 'EXECUTE')`), 'f');
  });
});
