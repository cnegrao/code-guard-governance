import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14DomainRegistryMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { domainKit } from '../helpers/m16-l14-domain-fixtures';

/**
 * M16-S1B.5 — privilege closure, preflight, postflight negative controls and structural invariants on real disposable
 * PostgreSQL 17. The S1B5 horizon is stopped right before the S1B.5 migration so the suite can snapshot the merged
 * S1B.4 catalog, prove the preflight aborts atomically, then apply the migration itself. Every control runs inside a
 * rolled-back bootstrap transaction; historical postflights are never altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_admit_domain_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text[],text)',
  'gov_repo.l14_submit_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const NEW_HELPERS = [
  'gov_repo.l14_domain_proposal_guard_v1()', 'gov_repo.l14_domain_state_guard_v1()', 'gov_repo.l14_domain_head_guard_v1()',
  'gov_repo.l14_domain_content_hash_v1(text,text)', 'gov_repo.l14_domain_command_result_v1(uuid,text,boolean)',
  'gov_repo.l14_domain_valid_state_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)',
] as const;
const NEW_TABLES = ['gov_repo.l14_domain_admissions', 'gov_repo.l14_domain_states', 'gov_repo.l14_domain_proposals', 'gov_repo.l14_domain_heads'] as const;
const postflight = () => {
  const text = migrationSource(l14DomainRegistryMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1B5_POSTFLIGHT'));
  return block;
};
const SURFACE_SPLIT_SQL = `select count(*) filter (where not m) || '|' || count(*) filter (where m) from (
  select exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') as m
  from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
    and (exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))) s;`;
/** Structural digest of canonical_relationships (columns, constraints, triggers, policies, ACL, row count). */
const F2_DIGEST = `select md5(concat_ws('|',
  (select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid='gov_repo.canonical_relationships'::regclass and attnum>0 and not attisdropped),
  (select string_agg(conname||':'||pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid='gov_repo.canonical_relationships'::regclass or confrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(tgname||':'||tgenabled::text||':'||tgfoid::regprocedure::text, ',' order by tgname) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(polname||':'||polcmd::text, ',' order by polname) from pg_policy where polrelid='gov_repo.canonical_relationships'::regclass),
  (select relacl::text from pg_class where oid='gov_repo.canonical_relationships'::regclass),
  (select count(*)::text from gov_repo.canonical_relationships)));`;
/** Every pre-S1B.5 routine body + config of the l14 / policy surface (S1B.5 replaces nothing). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%domain%'`;

test('M16 S1B.5 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B5', stopBefore: l14DomainRegistryMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 27, 'the merged S1B.4 application definer surface is 27');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 17, 'the merged S1B.4 policy-store-capable surface is 17');

  await t.test('preflight: the exact merged S1B.4 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_domain_admissions')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%domain%'`), '0');
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
    };
    const decide = 'gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1b5_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1b5_probe() to service_role`, 'drop function public.s1b5_probe()', /not exactly the 27 S1B\.4 baseline/],
      ['S1B.4 RPC config drift', `alter function ${decide} set lock_timeout = '6s'`, `alter function ${decide} set lock_timeout = '5s'`,
        /differs from its merged S1B\.4 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
    ] as const) {
      await bootstrapSql(brk);
      try {
        await assert.rejects(c.migrate(l14DomainRegistryMigration), (error: Error) => {
          assert.match(error.message, /M16_S1B5_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(fix); }
      await notApplied();
    }
    // Pre-existing domain governance history (no earlier slice could write any) aborts the preflight.
    const text = migrationSource(l14DomainRegistryMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    const org = await c.newOrg();
    const user = await c.mkUser(org, [c.memberRole]);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${org}',gen_random_uuid(),'INFORMATION_DOMAIN','VALIDATE','LOCAL_HUMAN','${user.id}','NONE',now());
      ${pre} rollback;`), /M16_S1B5_PREFLIGHT: domain governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly over the effective catalog; nothing pre-existing is replaced', async () => {
    await c.migrate(l14DomainRegistryMigration);
    await assert.rejects(c.migrate(l14DomainRegistryMigration), /M16_S1B5_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1B.5 gov_repo routine body / config / ACL is byte-identical');
  });

  await t.test('definer surface 27 -> 30 / 17 -> 20: the 27 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the three new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 30);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 20);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '30|0');
    const text = migrationSource(l14DomainRegistryMigration);
    const postBlock = text.slice(text.indexOf('DO $postflight$'));
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
    }
    for (const sig of NEW_HELPERS) {
      assert.equal(await one(`select prosecdef::text||'|'||coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';') from pg_proc where oid='${sig}'::regprocedure`),
        'false|{postgres=X/postgres}|search_path=pg_catalog, pg_temp', sig);
    }
  });

  await t.test('privilege closure: no direct table authority for any application role; only the three RPCs are service_role-executable', async () => {
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      for (const table of NEW_TABLES) {
        for (const statement of [`select count(*) from ${table}`, `delete from ${table}`, `update ${table} set organisation_id=organisation_id`,
          `truncate ${table}`, `insert into ${table}(organisation_id) values (gen_random_uuid())`]) {
          await assert.rejects(c.sql(statement, role), /42501|permission denied/, `${role}: ${statement}`);
        }
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of NEW_RPCS) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_admit_domain_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'EXPECTED_NONE', 'BUSINESS_DOMAIN', 'd', 'LOCAL_HUMAN', 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} admit`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_domain_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'BUSINESS_DOMAIN_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_submit_domain_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'VALIDATE', 'LOCAL_HUMAN', 'BUSINESS_DOMAIN', 'd', null, null, null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} submit`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the three new RPCs');
    await assert.rejects(c.sql(`select * from gov_repo.l14_domain_valid_state_v1(gen_random_uuid(), 'BUSINESS_DOMAIN', 'x', now(), now())`, 'service_role'),
      /42501|permission denied/, 'the resolver is owner-only');
    await assert.rejects(c.sql(`select * from gov_repo.l14_domain_command_result_v1(gen_random_uuid(), 'x', false)`, 'service_role'), /42501|permission denied/);
    assert.equal(await one(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = any(${all}) and a.grantee=0`), '0', 'PUBLIC EXECUTE revoked');
    for (const table of NEW_TABLES) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `${table}: owner-only ACL, RLS on, no policy`);
    }
  });

  await t.test('service_role cannot mutate history directly; the RPC path is the only writer (functional smoke)', async () => {
    const k = await domainKit(c);
    const ctx = await k.setup();
    const s = await k.admitted(ctx, 'acl');
    const v = await k.validate(ctx, 'acl', s);
    assert.equal(v.decided.outcome, 'VALIDATED');
    for (const statement of [`update gov_repo.l14_domain_heads set latest_state_id=null`, `delete from gov_repo.l14_registry_states`,
      `insert into gov_repo.l14_domain_admissions(organisation_id,subject_kind,domain_id,source_class,admitted_by_actor_user_id,admission_authorization_decision_id,support_status,admitted_at)
        values ('${ctx.org}','BUSINESS_DOMAIN','forged','LOCAL_HUMAN','${ctx.registrar.id}',gen_random_uuid(),'NONE',now())`,
      `insert into gov_repo.l14_domain_states(organisation_id,state_id,subject_kind,state_kind,domain_id) values ('${ctx.org}',gen_random_uuid(),'BUSINESS_DOMAIN','VALIDATED','${s.domainId}')`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
    // Even the owner cannot fabricate an admission without its exact ALLOW / ADMIT / same-kind authorization.
    await assert.rejects(c.bootstrapSql(`begin; insert into gov_repo.l14_domain_admissions(organisation_id,subject_kind,domain_id,source_class,
      admitted_by_actor_user_id,admission_authorization_decision_id,support_status,admitted_at) values ('${ctx.org}','INFORMATION_DOMAIN','${s.domainId}',
      'LOCAL_HUMAN','${ctx.registrar.id}',(select admission_authorization_decision_id from gov_repo.l14_domain_admissions where domain_id='${s.domainId}'),
      'NONE',now()); rollback;`), /l14_domain_admissions_(authorization_fkey|admission_unique)|23503|23505/);
  });

  await t.test('structural: no JSON / label / free text in the new tables; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|email|phone|title|description|summary|rationale|label|note|comment|reason|status$|approv|qes|owner|parent|hierarch)' and attname <> 'support_status'`), '0',
    'no label, description, rationale, hierarchy or legacy authority column (support_status is the framework support marker)');
    assert.equal(await one(`select count(*) from pg_attribute a where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('text'::regtype,'bpchar'::regtype) and not exists (select 1 from pg_constraint k where k.conrelid=a.attrelid and k.contype='c'
      and k.conkey=array[a.attnum]::int2[])`), '0', 'every text column is a closed vocabulary / pinned identity');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    for (const [table, constraint, expected] of [['canonical_objects', 'canonical_objects_kind_check', Object.values(CANONICAL_OBJECT_KIND)],
      ['canonical_relationships', 'canonical_relationships_type_check', Object.values(GOVERNED_RELATIONSHIP_TYPE)]] as const) {
      const values = JSON.parse(await one(`select json_agg(m[1] order by m[1] collate "C") from pg_constraint k,
        regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m where k.conrelid='gov_repo.${table}'::regclass and k.conname='${constraint}'`));
      assert.deepEqual(values, [...expected].sort());
    }
    assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /DOMAIN|PARTY|POLICY|CONTROL/.test(kind)), 'no DOMAIN canonical kind');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, ACL and rows untouched');
  });

  await t.test('postflight negative controls: every drift fails it; extension members are excluded but never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '30|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1b5_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1b5_probe() from public; grant execute on function ${schema}.s1b5_probe() to ${grantee};`;
    const controls: Array<[string, string, RegExp]> = [
      ['column SELECT on states', 'grant select (state_id) on gov_repo.l14_domain_states to authenticated;', /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_domain_heads to service_role;', /column-level grants|column privilege|holds/],
      ['table SELECT on admissions', 'grant select on gov_repo.l14_domain_admissions to service_role;', /non-owner table grant|holds/],
      ['sequence owned by S1B.5 history → anon', `set local role postgres; create sequence gov_repo.s1b5_leak owned by gov_repo.l14_domain_states.state_id;
        reset role; grant usage on sequence gov_repo.s1b5_leak to anon;`, /sequence/],
      ['view over admissions → service_role', 'create view public.s1b5_leak as select * from gov_repo.l14_domain_admissions; grant select on public.s1b5_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1b5_leak as select * from gov_repo.l14_domain_heads;
        create view public.s1b5_leak2 as select * from public.s1b5_leak; grant update on public.s1b5_leak2 to authenticated;`, /view/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1b5_leak_parent nologin; grant select on gov_repo.l14_domain_proposals to s1b5_leak_parent;
        grant s1b5_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from S1B.5 history', 'create table public.s1b5_child () inherits (gov_repo.l14_domain_heads);', /inheritance/],
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_admit_domain_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_admit_domain_v1(uuid) from public; reset role;`,
      /overload|eleven S1B\.4 \+ three S1B\.5|ACL\/definer shape/],
      ['member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['same routine once no longer a member', `${memberDefiner} alter extension pgcrypto drop function ${member};`, /CLOSED_SURFACE|not exactly 30/],
      ['admit RPC body drift', `set local role postgres; create or replace function gov_repo.l14_admit_domain_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_expectation_kind text, p_subject_kind text, p_domain_id text,
          p_source_class text, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid, governance_decision_id uuid,
          domain_id text, registry_state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ select null::boolean, null, null, null, 'ADMITTED', null, null::uuid, null, null, null::uuid, null::uuid, null,
          null::uuid, null, null::timestamptz, null::timestamptz $$; reset role;`, /body hash changed/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC owner drift', `create role s1b5_owner nologin; alter function ${NEW_RPCS[2]} owner to s1b5_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['helper made service_role-executable', `grant execute on function ${NEW_HELPERS[5]} to service_role;`, /owner-only SECURITY INVOKER|eleven S1B\.4 \+ three S1B\.5/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[1]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[2]} from service_role;`, /ACL\/definer shape|eleven S1B\.4|not exactly service_role/],
      ['permissive policy on states', 'create policy s1b5_probe on gov_repo.l14_domain_states for select to service_role using (true);', /RLS policy/],
      ['RLS disabled on admissions', 'alter table gov_repo.l14_domain_admissions disable row level security;', /RLS-enabled/],
      ['immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_domain_admissions enable trigger l14_domain_admissions_immutable;', /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_domain_heads disable trigger l14_domain_heads_guard;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_domain_states disable trigger l14_domain_states_guard;', /structural guard/],
      ['proposal source guard disabled', 'alter table gov_repo.l14_domain_proposals disable trigger l14_domain_proposals_guard;', /structural guard/],
      ['JSON column', 'alter table gov_repo.l14_domain_proposals add column extra jsonb;', /JSON column/],
      ['label column', 'alter table gov_repo.l14_domain_admissions add column label text check (length(label) < 100);', /pinned set/],
      ['third kind admitted by a relaxed CHECK', `alter table gov_repo.l14_domain_heads drop constraint l14_domain_heads_subject_kind_check;
        alter table gov_repo.l14_domain_heads add constraint l14_domain_heads_subject_kind_check check (subject_kind in ('BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION'));`,
      /closed to exactly BUSINESS_DOMAIN \/ INFORMATION_DOMAIN/],
      ['cascading FK into S1B.5 history', `create table public.s1b5_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_domain_states (organisation_id, state_id) on delete cascade);`,
        /cascading FK/],
      ['extra FK on a new table', `alter table gov_repo.l14_domain_heads add constraint l14_domain_heads_probe_fkey foreign key (organisation_id) references gov_repo.organisations (organisation_id);`,
        /FK set wrong/],
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','BUSINESS_DOMAIN')) not valid;`, /canonical object kinds \(11\)/],
      ['F2: S1B.5 routine attached to canonical_relationships', `create trigger s1b5_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_domain_head_guard_v1();`, /F2 boundary/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1B5_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '30|1', 'a genuine pgcrypto member is excluded');
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '30|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1b5_probe'`), '0');
    await owner(block);
  });

  await t.test('the new SQL never reaches the policy stores / lineage, legacy authority, canonical truth, assignments, applicability or F2', async () => {
    const sources = await one(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/governance_policies/, /policy_versions/, /l14_policy_/, /current_version_id/, /approved_by/, /qes_signature_id/, /\bstatus\b/,
      /canonical_objects/, /canonical_relationships/, /semantic_representation/, /APPLICABILITY/, /_ASSIGNMENT/, /description/, /label/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_governance_part|l14_authority_policy|governance_users|governance_roles|organisations|discovery_evidence)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
  });
});
