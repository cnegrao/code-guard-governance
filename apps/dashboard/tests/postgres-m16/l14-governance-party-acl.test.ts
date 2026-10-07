import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { l14GovernancePartyMigration } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { L14_S1B1_TABLES, partyKit } from '../helpers/m16-l14-party-fixtures';

const AP_RPCS = ['l14_admit_authority_policy_version_v1', 'l14_decide_authority_policy_proposal_v1', 'l14_submit_proposal_v1'];
const PARTY_RPCS = ['l14_admit_governance_party_v1', 'l14_decide_governance_party_proposal_v1', 'l14_submit_governance_party_proposal_v1'];
const PUBLIC_RPCS = [...AP_RPCS, ...PARTY_RPCS].sort();
const PROFILE = 'governance_party_directory_profiles';
const APP_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const S1B1_HELPERS = [
  'l14_governance_party_command_result_v1(uuid,text,boolean)', 'l14_governance_party_content_hash_v1(text)',
  'l14_governance_party_head_guard_v1()', 'l14_governance_party_profile_guard_v1()', 'l14_governance_party_state_guard_v1()',
  'l14_governance_party_valid_state_v1(uuid,uuid,timestamptz,timestamptz)', 'l14_lock_command_guard_v1(uuid,text)',
];
const PARTY_SIGNATURES = [
  'l14_admit_governance_party_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,text,text[],text)',
  'l14_submit_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,uuid,text,timestamptz,uuid,uuid,text,text[],text)',
  'l14_decide_governance_party_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,text,text,uuid,text,text[],text)',
];

/**
 * M16-S1B.1 real-catalog ACL checker at the live S1B1R1 horizon: every gov_repo relation/routine named l14_*,
 * the Party directory/profile table, and any gov_repo view depending on either (the S1A / S1B.0 suites
 * keep asserting their own exact catalogs at their own horizons).
 */
const CHECKER_SQL = `
with privs as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  || case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else array[]::text[] end) as p),
roles as (select unnest(array['anon','authenticated','service_role']) as r),
rels as (select c.oid, c.relname::text as name, c.relkind, c.relowner, c.relacl, c.reloptions from pg_class c
  where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m','S','f')
    and (c.relname like 'l14\\_%' or c.relname = '${PROFILE}' or (c.relkind in ('v','m') and exists (
      select 1 from pg_rewrite w join pg_depend d on d.objid=w.oid join pg_class t on t.oid=d.refobjid
      where w.ev_class=c.oid and (t.relname like 'l14\\_%' or t.relname = '${PROFILE}') and t.relnamespace='gov_repo'::regnamespace)))),
v(line) as (
  select 'table-priv:'||r||':'||p||':'||name from rels, roles, privs where relkind<>'S' and has_table_privilege(r, oid, p)
  union all select 'column-priv:'||r||':'||name from rels, roles where relkind in ('r','p','v','m','f') and has_any_column_privilege(r, oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  union all select 'sequence-priv:'||r||':'||sp||':'||name from rels, roles, unnest(array['USAGE','SELECT','UPDATE']) sp where relkind='S' and has_sequence_privilege(r, oid, sp)
  union all select 'public-grant:'||name from rels, aclexplode(coalesce(relacl, acldefault((case when relkind='S' then 's' else 'r' end)::"char", relowner))) a where a.grantee=0
  union all select 'non-invoker-view:'||name from rels where relkind in ('v','m') and not coalesce(reloptions @> array['security_invoker=true'], false)
  union all select 'l14-relation-not-table:'||name from rels where relkind<>'r' and (name like 'l14\\_%' or name = '${PROFILE}')
  union all select 'routine-public:'||p.proname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%' and a.grantee=0 and a.privilege_type='EXECUTE'
  union all select 'routine-execute:'||r||':'||p.proname from pg_proc p, roles
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%' and has_function_privilege(r, p.oid, 'EXECUTE')
      and not (r='service_role' and p.proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}]))
  union all select 'routine-shape:'||p.proname from pg_proc p
    where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l14\\_%'
      and (not coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false)
        or p.prosecdef <> (p.proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}])))
  union all select 'profile-routine:'||p.proname from pg_proc p
    where p.pronamespace='gov_repo'::regnamespace and p.prosrc like '%${PROFILE}%'
      and (p.prosecdef or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
)
select coalesce(string_agg(line, E'\\n' order by line), '') from v;`;

test('M16 S1B.1 GovernanceParty ACL / privilege boundary (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B1R1' });
  t.after(() => c.stop());
  const { owner, bootstrapSql, sql } = c;
  const k = await partyKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const violations = async () => (await bootstrapSql(CHECKER_SQL)).split('\n').map(line => line.trim()).filter(Boolean);
  const migration = readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${l14GovernancePartyMigration}`, import.meta.url)), 'utf8');
  const postflight = migration.slice(migration.indexOf('DO $postflight$'), migration.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(postflight.startsWith('DO $postflight$') && postflight.includes('M16_S1B1_POSTFLIGHT'), 'S1B.1 postflight block extracted');
  // Real Party history exists while the catalog is checked.
  const ctx = await k.setup();
  const a = await k.validated(ctx, 'acl');

  await t.test('ACL postflight: zero violations with the hostile legacy grants/defaults in the chain; the S1B.1 postflight re-executes cleanly', async () => {
    assert.equal(await one(`select count(*) from pg_default_acl d where d.defaclnamespace='gov_repo'::regnamespace`), '3',
      'the hostile 20260818013113 default privileges are present in the fixture chain');
    assert.deepEqual(await violations(), []);
    await owner(postflight);
  });

  await t.test('exact surface: 18 RLS l14 tables + the RLS profile table, exactly the 6 service_role RPCs (3 AP + 3 Party), owner-only internals', async () => {
    assert.equal(await one(`select string_agg(relname::text, ',' order by relname::text collate "C") from pg_class
      where relnamespace='gov_repo'::regnamespace and relname like 'l14\\_%' and relkind in ('r','p','v','m','S','f')`), [...L14_S1B1_TABLES].sort().join(','));
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and (relname like 'l14\\_%' or relname='${PROFILE}')
      and relkind='r' and relrowsecurity`), '19');
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and has_function_privilege('service_role', oid, 'EXECUTE')`), PUBLIC_RPCS.join(','),
      'the public L14 RPC inventory is exactly the three AP RPCs plus the three Party RPCs');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%' and prosecdef`), '6');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname = any(array[${PUBLIC_RPCS.map(n => `'${n}'`).join(',')}])`),
      '6', 'no overloads');
    for (const signature of PARTY_SIGNATURES) {
      assert.equal(await one(`select prosecdef::text||':'||array_to_string(proconfig, ';') from pg_proc where oid='gov_repo.${signature}'::regprocedure`),
        'true:search_path=pg_catalog, pg_temp;lock_timeout=5s', signature);
      assert.equal(await one(`select string_agg(a.grantee::regrole::text||'='||a.privilege_type, ',' order by a.grantee::regrole::text)
        from pg_proc p, aclexplode(p.proacl) a where p.oid='gov_repo.${signature}'::regprocedure`), 'postgres=EXECUTE,service_role=EXECUTE', signature);
    }
    for (const helper of S1B1_HELPERS) {
      assert.equal(await one(`select prosecdef::text from pg_proc where oid='gov_repo.${helper}'::regprocedure`), 'false', `${helper} is SECURITY INVOKER`);
      for (const role of APP_ROLES) {
        assert.equal(await one(`select has_function_privilege('${role}', 'gov_repo.${helper}'::regprocedure, 'EXECUTE')`), 'f', `${role} ${helper}`);
      }
    }
  });

  await t.test('direct app-role access denied on every new Party table and the profile table (read, DML, TRUNCATE)', async () => {
    for (const table of ['l14_governance_parties', 'l14_governance_party_proposals', 'l14_governance_party_states', 'l14_governance_party_heads', PROFILE]) {
      for (const role of APP_ROLES) {
        for (const statement of [`select 1 from gov_repo.${table} limit 1`, `insert into gov_repo.${table} default values`,
          `update gov_repo.${table} set organisation_id=organisation_id`, `delete from gov_repo.${table}`, `truncate gov_repo.${table}`]) {
          await assert.rejects(sql(statement, role), (error: Error) => { assert.match(error.message, /42501/, `${role}: ${statement}`); return true; });
        }
      }
    }
    // Head writes are RPC-only: even the resolver/guards are unreachable for application roles.
    for (const call of [`select gov_repo.l14_lock_command_guard_v1(gen_random_uuid(),'x')`,
      `select * from gov_repo.l14_governance_party_valid_state_v1(gen_random_uuid(),gen_random_uuid(),now(),now())`,
      `select * from gov_repo.l14_governance_party_command_result_v1(gen_random_uuid(),'x',false)`,
      `select gov_repo.l14_governance_party_content_hash_v1('PERSON')`]) {
      for (const role of APP_ROLES) await assert.rejects(sql(call, role), /42501/, `${role}: ${call}`);
    }
    for (const rpc of PARTY_SIGNATURES) {
      for (const role of ['anon', 'authenticated'] as const) {
        assert.equal(await one(`select has_function_privilege('${role}', 'gov_repo.${rpc}'::regprocedure, 'EXECUTE')`), 'f');
      }
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_parties where governance_party_id='${a.partyId}'`), '1');
  });

  interface Control { key: string; apply: string; expect: RegExp; cleanup: string; as?: 'owner' | 'bootstrap' }
  const controls: Control[] = [
    { key: 'table direct DML (INSERT on Party identity)', apply: `grant insert on gov_repo.l14_governance_parties to service_role`,
      expect: /^table-priv:service_role:INSERT:l14_governance_parties$/m, cleanup: `revoke insert on gov_repo.l14_governance_parties from service_role` },
    { key: 'table direct DML (UPDATE on the Party head)', apply: `grant update on gov_repo.l14_governance_party_heads to service_role`,
      expect: /^table-priv:service_role:UPDATE:l14_governance_party_heads$/m, cleanup: `revoke update on gov_repo.l14_governance_party_heads from service_role` },
    { key: 'profile direct read (SELECT)', apply: `grant select on gov_repo.${PROFILE} to authenticated`,
      expect: new RegExp(`^table-priv:authenticated:SELECT:${PROFILE}$`, 'm'), cleanup: `revoke select on gov_repo.${PROFILE} from authenticated` },
    { key: 'profile direct write (UPDATE)', apply: `grant update on gov_repo.${PROFILE} to service_role`,
      expect: new RegExp(`^table-priv:service_role:UPDATE:${PROFILE}$`, 'm'), cleanup: `revoke update on gov_repo.${PROFILE} from service_role` },
    { key: 'profile column-level privilege', apply: `grant update (email) on gov_repo.${PROFILE} to service_role`,
      expect: new RegExp(`^column-priv:service_role:${PROFILE}$`, 'm'), cleanup: `revoke update (email) on gov_repo.${PROFILE} from service_role` },
    { key: 'PUBLIC grant on the Party states', apply: `grant select on gov_repo.l14_governance_party_states to public`,
      expect: /^public-grant:l14_governance_party_states$/m, cleanup: `revoke select on gov_repo.l14_governance_party_states from public` },
    { key: 'TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on Party proposals', apply: `grant truncate, references, trigger, maintain on gov_repo.l14_governance_party_proposals to anon`,
      expect: /(?=[\s\S]*^table-priv:anon:TRUNCATE:l14_governance_party_proposals$)(?=[\s\S]*^table-priv:anon:MAINTAIN:l14_governance_party_proposals$)/m,
      cleanup: `revoke truncate, references, trigger, maintain on gov_repo.l14_governance_party_proposals from anon` },
    { key: 'routine EXECUTE (new S1B.1 helper granted)', apply: `grant execute on function gov_repo.l14_governance_party_valid_state_v1(uuid,uuid,timestamptz,timestamptz) to service_role`,
      expect: /^routine-execute:service_role:l14_governance_party_valid_state_v1$/m,
      cleanup: `revoke execute on function gov_repo.l14_governance_party_valid_state_v1(uuid,uuid,timestamptz,timestamptz) from service_role` },
    { key: 'Party RPC granted to authenticated', apply: `grant execute on function gov_repo.${PARTY_SIGNATURES[0]} to authenticated`,
      expect: /^routine-execute:authenticated:l14_admit_governance_party_v1$/m, cleanup: `revoke execute on function gov_repo.${PARTY_SIGNATURES[0]} from authenticated` },
    { key: 'new service_role L14 RPC (definer)', apply: `create function gov_repo.l14_negctl_rpc() returns int language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_negctl_rpc() from public;
        grant execute on function gov_repo.l14_negctl_rpc() to service_role`,
      expect: /(?=[\s\S]*^routine-execute:service_role:l14_negctl_rpc$)(?=[\s\S]*^routine-shape:l14_negctl_rpc$)/m, cleanup: `drop function gov_repo.l14_negctl_rpc()` },
    { key: 'a profile RPC (callable routine reaching the profile table)', apply: `create function gov_repo.negctl_profile_rpc() returns bigint language sql security definer
        set search_path = pg_catalog, pg_temp as 'select count(*) from gov_repo.${PROFILE}'; revoke all on function gov_repo.negctl_profile_rpc() from public;
        grant execute on function gov_repo.negctl_profile_rpc() to service_role`,
      expect: /^profile-routine:negctl_profile_rpc$/m, cleanup: `drop function gov_repo.negctl_profile_rpc()` },
    { key: 'sequence privileges (default-privilege reintroduction)', apply: `create sequence gov_repo.l14_negctl_seq`,
      expect: /^sequence-priv:service_role:USAGE:l14_negctl_seq$/m, cleanup: `drop sequence gov_repo.l14_negctl_seq` },
    { key: 'updatable view exposing the profile table', apply: `create view gov_repo.negctl_profile_view with (security_invoker=true) as select * from gov_repo.${PROFILE};
      grant select, update on gov_repo.negctl_profile_view to authenticated`,
      expect: /^table-priv:authenticated:UPDATE:negctl_profile_view$/m, cleanup: `drop view gov_repo.negctl_profile_view` },
    { key: 'non-invoker view over Party states', apply: `create view gov_repo.l14_negctl_view as select * from gov_repo.l14_governance_party_states`,
      expect: /^non-invoker-view:l14_negctl_view$/m, cleanup: `drop view gov_repo.l14_negctl_view` },
    { key: 'inherited role grant on the profile table', as: 'bootstrap', apply: `create role l14_negctl_group nologin; grant usage on schema gov_repo to l14_negctl_group;
      set role postgres; grant select on gov_repo.${PROFILE} to l14_negctl_group; reset role; grant l14_negctl_group to service_role`,
      expect: new RegExp(`^table-priv:service_role:SELECT:${PROFILE}$`, 'm'),
      cleanup: `revoke l14_negctl_group from service_role; set role postgres; revoke select on gov_repo.${PROFILE} from l14_negctl_group; reset role;
        revoke usage on schema gov_repo from l14_negctl_group; drop role l14_negctl_group` },
  ];
  for (const control of controls) {
    await t.test(`negative control detected: ${control.key}`, async () => {
      const run = control.as === 'bootstrap' ? bootstrapSql : owner;
      await run(control.apply);
      try {
        const found = (await violations()).join('\n');
        assert.match(found, control.expect, `checker missed ${control.key}:\n${found}`);
        await assert.rejects(owner(postflight), /M16_S1B1_POSTFLIGHT/, 'the S1B.1 migration postflight also fails closed');
      } finally {
        await run(control.cleanup);
      }
      assert.deepEqual(await violations(), [], 'clean again after the control is removed');
    });
  }

  await t.test('postflight also fails closed on disabled guards, a PII column, a JSON column, a profile reference, or a weakened mapping FK', async () => {
    for (const [apply, cleanup] of [
      ['alter table gov_repo.l14_governance_parties disable trigger l14_governance_parties_immutable', 'alter table gov_repo.l14_governance_parties enable always trigger l14_governance_parties_immutable'],
      ['alter table gov_repo.l14_governance_party_states enable trigger l14_governance_party_states_no_truncate', 'alter table gov_repo.l14_governance_party_states enable always trigger l14_governance_party_states_no_truncate'],
      ['alter table gov_repo.l14_governance_party_states disable trigger l14_governance_party_states_guard', 'alter table gov_repo.l14_governance_party_states enable always trigger l14_governance_party_states_guard'],
      ['alter table gov_repo.l14_governance_party_heads disable trigger l14_governance_party_heads_guard', 'alter table gov_repo.l14_governance_party_heads enable always trigger l14_governance_party_heads_guard'],
      [`alter table gov_repo.${PROFILE} disable trigger governance_party_directory_profiles_guard`, `alter table gov_repo.${PROFILE} enable always trigger governance_party_directory_profiles_guard`],
      ['alter table gov_repo.l14_governance_parties add column display_name text', 'alter table gov_repo.l14_governance_parties drop column display_name'],
      ['alter table gov_repo.l14_governance_party_proposals add column email text', 'alter table gov_repo.l14_governance_party_proposals drop column email'],
      ['alter table gov_repo.l14_command_results add column governance_user_id uuid', 'alter table gov_repo.l14_command_results drop column governance_user_id'],
      ['alter table gov_repo.l14_governance_party_states add column payload jsonb', 'alter table gov_repo.l14_governance_party_states drop column payload'],
      [`alter table gov_repo.${PROFILE} add column attributes jsonb`, `alter table gov_repo.${PROFILE} drop column attributes`],
      [`alter table gov_repo.l14_governance_party_heads add column profile_party uuid, add constraint negctl_fk foreign key (organisation_id, profile_party) references gov_repo.${PROFILE} (organisation_id, governance_party_id)`,
        'alter table gov_repo.l14_governance_party_heads drop column profile_party'],
      [`alter table gov_repo.${PROFILE} drop constraint governance_party_directory_profiles_user_fkey, add constraint governance_party_directory_profiles_user_fkey
          foreign key (organisation_id, governance_user_id) references gov_repo.governance_users (organisation_id, user_id) on delete cascade`,
        `alter table gov_repo.${PROFILE} drop constraint governance_party_directory_profiles_user_fkey, add constraint governance_party_directory_profiles_user_fkey
          foreign key (organisation_id, governance_user_id) references gov_repo.governance_users (organisation_id, user_id) on delete set null (governance_user_id) on update restrict`],
      [`alter table gov_repo.${PROFILE} drop constraint governance_party_directory_profiles_user_unique`,
        `alter table gov_repo.${PROFILE} add constraint governance_party_directory_profiles_user_unique unique (organisation_id, governance_user_id)`],
    ]) {
      await owner(apply!);
      try { await assert.rejects(owner(postflight), /M16_S1B1_POSTFLIGHT/, apply); } finally { await owner(cleanup!); }
    }
    await owner(postflight);
    assert.deepEqual(await violations(), []);
  });

  await t.test('S0 contracts unchanged: exactly six *_governed_v1 wrappers; no l14 routine named *eligibility*/*governed*; F2 untouched', async () => {
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like '%\\_governed\\_v1'`), '6');
    assert.equal(await one(`select string_agg(proname::text, ',' order by proname::text) from pg_proc
      where pronamespace='gov_repo'::regnamespace and proname like '%eligibility%'`),
      'lock_and_resolve_governance_session_eligibility_v1,require_governed_write_eligibility_v1');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%'
      and (proname like '%eligibility%' or proname like '%governed%')`), '0');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid in (select oid from pg_class where relnamespace='gov_repo'::regnamespace and (relname like 'l14\\_%' or relname='${PROFILE}'))`), '0');
    assert.equal(await one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l14\\_%governance\\_party%'
      and prosrc ~ 'canonical_relationships'`), '0');
  });
});
