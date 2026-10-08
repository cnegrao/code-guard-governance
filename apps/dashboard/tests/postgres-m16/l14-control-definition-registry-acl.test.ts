import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14ControlDefinitionRegistryMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlDefinitionKit } from '../helpers/m16-l14-control-definition-fixtures';

/**
 * M16-S1B.6 — privilege closure, preflight, postflight negative controls and structural invariants on real disposable
 * PostgreSQL 17. The S1B6 horizon is stopped right before the S1B.6 migration so the suite can snapshot the merged
 * S1B.5 catalog, prove the preflight aborts atomically, then apply the migration itself. Every control runs inside a
 * rolled-back bootstrap transaction; historical postflights are never altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_admit_control_definition_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text,text,text,text,text,text[],text)',
  'gov_repo.l14_submit_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const NEW_HELPERS = [
  'gov_repo.l14_control_definition_content_hash_v1(text,text,text)', 'gov_repo.l14_control_definition_identity_guard_v1()',
  'gov_repo.l14_control_definition_version_guard_v1()', 'gov_repo.l14_control_definition_proposal_guard_v1()',
  'gov_repo.l14_control_definition_state_guard_v1()', 'gov_repo.l14_control_definition_head_guard_v1()',
  'gov_repo.l14_control_definition_command_result_v1(uuid,text,boolean)',
  'gov_repo.l14_control_definition_valid_state_v1(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
] as const;
const NEW_TABLES = ['gov_repo.l14_control_definitions', 'gov_repo.l14_control_definition_versions', 'gov_repo.l14_control_definition_states',
  'gov_repo.l14_control_definition_proposals', 'gov_repo.l14_control_definition_heads'] as const;
const postflight = () => {
  const text = migrationSource(l14ControlDefinitionRegistryMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1B6_POSTFLIGHT'));
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
/** Every pre-S1B.6 routine body + config + ACL in gov_repo (S1B.6 replaces nothing). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%control\\_definition%'`;
/** Every pre-S1B.6 table definition in gov_repo (columns + constraints + triggers + ACL): S1B.6 alters no existing table. */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')
  and c.relname not like 'l14\\_control\\_definition%'`;

test('M16 S1B.6 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B6', stopBefore: l14ControlDefinitionRegistryMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 30, 'the merged S1B.5 application definer surface is 30');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 20, 'the merged S1B.5 canonical-owner (policy-store-capable) class is 20');

  await t.test('preflight: the exact merged S1B.5 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_control_definition_versions')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%control\\_definition%'`), '0');
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
    };
    const decide = 'gov_repo.l14_decide_domain_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1b6_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1b6_probe() to service_role`, 'drop function public.s1b6_probe()', /not exactly the 30 S1B\.5 baseline/],
      ['S1B.5 RPC config drift', `alter function ${decide} set lock_timeout = '6s'`, `alter function ${decide} set lock_timeout = '5s'`,
        /differs from its merged S1B\.5 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
      ['S1B.5 horizon absent', 'alter table gov_repo.l14_domain_heads rename to l14_domain_heads_x', 'alter table gov_repo.l14_domain_heads_x rename to l14_domain_heads',
        /unexpected l14 relation set/],
    ] as const) {
      await bootstrapSql(brk);
      try {
        await assert.rejects(c.migrate(l14ControlDefinitionRegistryMigration), (error: Error) => {
          assert.match(error.message, /M16_S1B6_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(fix); }
      await notApplied();
    }
    // Pre-existing CONTROL_DEFINITION governance history (no earlier slice could write any) aborts the preflight.
    const text = migrationSource(l14ControlDefinitionRegistryMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    const org = await c.newOrg();
    const user = await c.mkUser(org, [c.memberRole]);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${org}',gen_random_uuid(),'CONTROL_DEFINITION','VALIDATE','LOCAL_HUMAN','${user.id}','NONE',now());
      ${pre} rollback;`), /M16_S1B6_PREFLIGHT: control definition governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly over the effective catalog; nothing pre-existing is replaced or altered', async () => {
    await c.migrate(l14ControlDefinitionRegistryMigration);
    await assert.rejects(c.migrate(l14ControlDefinitionRegistryMigration), /M16_S1B6_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1B.6 gov_repo routine body / config / ACL is byte-identical');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no pre-S1B.6 gov_repo table / view is altered');
  });

  await t.test('definer surface 30 -> 33 / canonical-owner class 20 -> 23: the 30 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the three new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 33);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 23);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '33|0');
    const text = migrationSource(l14ControlDefinitionRegistryMigration);
    const postBlock = text.slice(text.indexOf('DO $postflight$'));
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
      // Owner capability is not body-level need: no S1B.6 body reaches a policy content store or the policy lineage.
      assert.equal(await one(`select (prosrc ~ '(governance_policies|policy_versions|l14_policy_admissions|l14_policy_version_)')::text from pg_proc where oid='${sig}'::regprocedure`), 'false', sig);
      assert.equal(await one(`select count(*) from pg_depend where classid='pg_proc'::regclass and objid='${sig}'::regprocedure
        and refclassid='pg_class'::regclass and refobjid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)`), '0', sig);
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
      await assert.rejects(c.sql(`select * from gov_repo.l14_admit_control_definition_version_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), gen_random_uuid(), 'EXPECTED_NONE', null, 'C', 'T', 'D', repeat('a',64), 'LOCAL_HUMAN', 'NONE', '{}', repeat('a',64))`, role),
      /42501|permission denied/, `${role} admit`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_control_definition_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'CONTROL_DEFINITION_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_submit_control_definition_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'VALIDATE', 'LOCAL_HUMAN', gen_random_uuid(), gen_random_uuid(), repeat('a',64), null, null, null, 'NONE', '{}', repeat('a',64))`, role),
      /42501|permission denied/, `${role} submit`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the three new RPCs');
    await assert.rejects(c.sql(`select * from gov_repo.l14_control_definition_valid_state_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), repeat('a',64), now(), now())`, 'service_role'),
      /42501|permission denied/, 'the resolver is owner-only');
    await assert.rejects(c.sql(`select * from gov_repo.l14_control_definition_command_result_v1(gen_random_uuid(), 'x', false)`, 'service_role'), /42501|permission denied/);
    await assert.rejects(c.sql(`select gov_repo.l14_control_definition_content_hash_v1('a','b','c')`, 'service_role'), /42501|permission denied/);
    assert.equal(await one(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = any(${all}) and a.grantee=0`), '0', 'PUBLIC EXECUTE revoked');
    for (const table of NEW_TABLES) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `${table}: owner-only ACL, RLS on, no policy`);
      assert.equal(await one(`select count(*) from pg_attribute where attrelid='${table}'::regclass and attacl is not null`), '0', `${table}: no column grant`);
    }
  });

  await t.test('service_role cannot mutate history directly; the RPC path is the only writer (functional smoke)', async () => {
    const k = await controlDefinitionKit(c);
    const ctx = await k.setup();
    const v = await k.admitted(ctx, 'acl');
    const val = await k.validate(ctx, 'acl', v);
    assert.equal(val.decided.outcome, 'VALIDATED');
    for (const statement of [`update gov_repo.l14_control_definition_heads set latest_state_id=null`, `delete from gov_repo.l14_registry_states`,
      `update gov_repo.l14_control_definition_versions set title='x'`,
      `insert into gov_repo.l14_control_definitions(organisation_id,control_definition_id,admission_authorization_decision_id,recorded_at)
        values ('${ctx.org}',gen_random_uuid(),gen_random_uuid(),now())`,
      `insert into gov_repo.l14_control_definition_states(organisation_id,state_id,state_kind,control_definition_id,control_definition_version_id,content_hash)
        values ('${ctx.org}',gen_random_uuid(),'VALIDATED','${v.controlDefinitionId}','${v.controlDefinitionVersionId}','${v.contentHash}')`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
  });

  await t.test('structural: no JSON / EAV / score / applicability column; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(score|weight|severity|maturity|coverage|risk|waiver|effective|applicab|parent|hierarch|attribute|metadata|domain|rationale|note|comment|reason|^status$|approv|qes|owner|cg_)'
      and attname not in ('requested_effective_from')`), '0',
    'no score / weight / severity / maturity / coverage / risk / waiver / applicability / hierarchy / attribute / scanner domain / rationale / legacy column');
    assert.equal(await one(`select count(*) from pg_attribute a where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('text'::regtype,'bpchar'::regtype) and not exists (select 1 from pg_constraint k where k.conrelid=a.attrelid and k.contype='c'
      and k.conkey=array[a.attnum]::int2[])`), '0', 'every text column is a closed vocabulary / bounded');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    for (const [table, constraint, expected] of [['canonical_objects', 'canonical_objects_kind_check', Object.values(CANONICAL_OBJECT_KIND)],
      ['canonical_relationships', 'canonical_relationships_type_check', Object.values(GOVERNED_RELATIONSHIP_TYPE)]] as const) {
      const values = JSON.parse(await one(`select json_agg(m[1] order by m[1] collate "C") from pg_constraint k,
        regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m where k.conrelid='gov_repo.${table}'::regclass and k.conname='${constraint}'`));
      assert.deepEqual(values, [...expected].sort());
    }
    assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /CONTROL/.test(kind)), 'CONTROL_DEFINITION is not a canonical object kind');
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL/.test(type)), 'no CONTROLLED_BY / APPLIES_CONTROL / HAS_CONTROL');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, ACL and rows untouched');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid::regclass::text like 'gov_repo.l14\\_%'`), '0', 'no FK to canonical_relationships');
  });

  await t.test('postflight negative controls: every drift fails it; extension members are excluded but never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '33|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1b6_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1b6_probe() from public; grant execute on function ${schema}.s1b6_probe() to ${grantee};`;
    const admitBody = (body: string) => `set local role postgres; create or replace function gov_repo.l14_admit_control_definition_version_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_control_definition_id uuid, p_control_definition_version_id uuid,
          p_expectation_kind text, p_expected_latest_version_id uuid, p_control_code text, p_title text, p_description text, p_content_hash text,
          p_source_class text, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, attempted_content_hash text, expectation_kind text,
          expected_latest_version_id uuid, proposal_id uuid, governance_decision_id uuid, control_definition_id uuid,
          control_definition_version_id uuid, predecessor_version_id uuid, content_hash text, registry_state_id uuid, state_kind text,
          effective_from timestamptz, recorded_at timestamptz)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ ${body} $$; reset role;`;
    const nulls = `null::boolean, null, null, null, 'ADMITTED', null, null::uuid, null, null, null, null, null::uuid, null::uuid, null::uuid,
      null::uuid, null::uuid, null::uuid, null, null::uuid, null, null::timestamptz, null::timestamptz`;
    const controls: Array<[string, string, RegExp]> = [
      ['column SELECT on versions', 'grant select (control_code) on gov_repo.l14_control_definition_versions to authenticated;', /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_control_definition_heads to service_role;', /column-level grants|column privilege|holds/],
      ['table SELECT on identities', 'grant select on gov_repo.l14_control_definitions to service_role;', /non-owner table grant|holds/],
      ['table INSERT on states → anon', 'grant insert on gov_repo.l14_control_definition_states to anon;', /non-owner table grant|holds/],
      ['sequence owned by S1B.6 history → anon', `set local role postgres; create sequence gov_repo.s1b6_leak owned by gov_repo.l14_control_definition_states.state_id;
        reset role; grant usage on sequence gov_repo.s1b6_leak to anon;`, /sequence/],
      ['view over versions → service_role', 'create view public.s1b6_leak as select * from gov_repo.l14_control_definition_versions; grant select on public.s1b6_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1b6_leak as select * from gov_repo.l14_control_definition_heads;
        create view public.s1b6_leak2 as select * from public.s1b6_leak; grant update on public.s1b6_leak2 to authenticated;`, /view/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1b6_leak_parent nologin; grant select on gov_repo.l14_control_definition_proposals to s1b6_leak_parent;
        grant s1b6_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from S1B.6 history', 'create table public.s1b6_child () inherits (gov_repo.l14_control_definition_versions);', /inheritance/],
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['unexpected gov_repo definer → service_role', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_admit_control_definition_version_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_admit_control_definition_version_v1(uuid) from public; reset role;`,
      /overload|fourteen S1B\.5 \+ three S1B\.6|ACL\/definer shape/],
      ['member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['same routine once no longer a member', `${memberDefiner} alter extension pgcrypto drop function ${member};`, /CLOSED_SURFACE|not exactly 33/],
      ['admit RPC body drift', admitBody(`select ${nulls}`), /body hash changed/],
      ['admit RPC body reaching a policy store', admitBody(`select ${nulls} from gov_repo.governance_policies limit 0`), /body hash changed|reaches a policy store/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC owner drift', `create role s1b6_owner nologin; alter function ${NEW_RPCS[2]} owner to s1b6_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['helper made service_role-executable', `grant execute on function ${NEW_HELPERS[7]} to service_role;`, /owner-only SECURITY INVOKER|fourteen S1B\.5 \+ three S1B\.6/],
      ['helper made SECURITY DEFINER', `alter function ${NEW_HELPERS[0]} security definer;`, /owner-only SECURITY INVOKER/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[1]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['RPC executable by PUBLIC', `grant execute on function ${NEW_RPCS[0]} to public;`, /PUBLIC EXECUTE|not exactly service_role|ACL/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[2]} from service_role;`, /ACL\/definer shape|fourteen S1B\.5|not exactly service_role/],
      ['permissive policy on states', 'create policy s1b6_probe on gov_repo.l14_control_definition_states for select to service_role using (true);', /RLS policy/],
      ['permissive policy on identities', 'create policy s1b6_probe on gov_repo.l14_control_definitions for all to authenticated using (true) with check (true);', /RLS policy/],
      ['RLS disabled on versions', 'alter table gov_repo.l14_control_definition_versions disable row level security;', /RLS-enabled/],
      ['immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_control_definition_versions enable trigger l14_control_definition_versions_immutable;', /lacks ALWAYS raising/],
      ['identity immutability trigger disabled', 'alter table gov_repo.l14_control_definitions disable trigger l14_control_definitions_no_truncate;', /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_control_definition_heads disable trigger l14_control_definition_heads_guard;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_control_definition_states disable trigger l14_control_definition_states_guard;', /structural guard/],
      ['version guard disabled', 'alter table gov_repo.l14_control_definition_versions disable trigger l14_control_definition_versions_guard;', /structural guard/],
      ['identity guard disabled', 'alter table gov_repo.l14_control_definitions disable trigger l14_control_definitions_guard;', /structural guard/],
      ['proposal source guard disabled', 'alter table gov_repo.l14_control_definition_proposals disable trigger l14_control_definition_proposals_guard;', /structural guard/],
      ['JSON metadata column', 'alter table gov_repo.l14_control_definition_versions add column metadata jsonb;', /JSON column/],
      ['score column', 'alter table gov_repo.l14_control_definition_versions add column risk_score integer;', /pinned set/],
      ['scanner domain column', `alter table gov_repo.l14_control_definition_versions add column domain text check (domain in ('inventory','ownership'));`, /pinned set/],
      ['unbounded description', `alter table gov_repo.l14_control_definition_versions drop constraint l14_control_definition_versions_description_check;
        alter table gov_repo.l14_control_definition_versions add constraint l14_control_definition_versions_description_check check (length(description) >= 1);`,
      /content bounds|closed vocabulary/],
      ['other subject kind admitted by a relaxed CHECK', `alter table gov_repo.l14_control_definition_states drop constraint l14_control_definition_states_subject_kind_check;
        alter table gov_repo.l14_control_definition_states add constraint l14_control_definition_states_subject_kind_check check (subject_kind in ('CONTROL_DEFINITION','POLICY_VERSION'));`,
      /closed to exactly CONTROL_DEFINITION/],
      ['cascading FK into S1B.6 history', `create table public.s1b6_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_control_definition_states (organisation_id, state_id) on delete cascade);`,
        /cascading FK/],
      ['extra FK on a new table', `alter table gov_repo.l14_control_definition_heads add constraint l14_control_definition_heads_probe_fkey foreign key (organisation_id) references gov_repo.organisations (organisation_id);`,
        /FK set wrong/],
      ['another deferrable FK', `alter table gov_repo.l14_control_definition_heads drop constraint l14_control_definition_heads_version_fkey;
        alter table gov_repo.l14_control_definition_heads add constraint l14_control_definition_heads_version_fkey foreign key (organisation_id, control_definition_id,
          control_definition_version_id, content_hash) references gov_repo.l14_control_definition_versions (organisation_id, control_definition_id,
          control_definition_version_id, content_hash) deferrable initially deferred;`, /FK set wrong/],
      ['lineage root index dropped', 'drop index gov_repo.l14_control_definition_versions_root_uidx;', /lineage keys missing/],
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','CONTROL_DEFINITION')) not valid;`, /canonical object kinds \(11\)/],
      ['relationship type added', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP',
          'INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','APPLIES_CONTROL')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1B.6 routine attached to canonical_relationships', `create trigger s1b6_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_control_definition_head_guard_v1();`, /F2 boundary/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1B6_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '33|1', 'a genuine pgcrypto member is excluded');
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '33|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1b6_probe'`), '0');
    await owner(block);
  });

  await t.test('the new SQL never reaches the policy stores / lineage, legacy authority, CG-AG flags / scores, canonical truth, applicability or F2', async () => {
    const sources = await one(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/governance_policies/, /policy_versions/, /l14_policy_/, /current_version_id/, /approved_by/, /qes_signature_id/, /\bstatus\b/,
      /canonical_objects/, /canonical_relationships/, /semantic_representation/, /APPLICABILITY/, /_ASSIGNMENT/, /ASSESSMENT/, /\bcg_/i, /CG-AG/i,
      /gov_repo\.agents\b/, /agent_resource_links/, /ai_systems/, /\brisk/i, /coverage/i, /maturity/i, /severity/i, /\bscore/i, /\bweight/i, /waiver/i,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_governance_part|l14_authority_policy|l14_domain_|governance_users|governance_roles|organisations|discovery_evidence)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
  });
});
