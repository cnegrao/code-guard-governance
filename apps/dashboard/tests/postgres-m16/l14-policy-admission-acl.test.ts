import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14PolicyAdmissionMigration, migrationSource, s0ExecutionContextClosureMigration } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';

/**
 * M16-S1B.3 — privilege closure, preflight, postflight negative controls and structural invariants on real disposable
 * PostgreSQL 17. The S1B3 horizon is stopped right before the S1B.3 migration so the suite can seed LEGACY policy rows,
 * snapshot the pre-S1B.3 catalog and prove the preflight aborts atomically, then applies the migration itself.
 * Every control runs inside a rolled-back bootstrap transaction; historical postflights are never altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_admit_governance_policy_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text[],text)',
  'gov_repo.l14_admit_policy_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,text,text,text,text[],text)',
  'gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)',
] as const;
const NEW_HELPERS = [
  'gov_repo.l14_policy_identity_content_hash_v1(text,text,text)', 'gov_repo.l14_policy_admission_guard_v1()',
  'gov_repo.l14_policy_version_admission_guard_v1()', 'gov_repo.l14_policy_admitted_descriptor_guard_v1()',
  'gov_repo.l14_policy_command_result_v1(uuid,text,boolean)',
] as const;
const GUARDED = ['gov_repo.governance_policies', 'gov_repo.policy_versions', 'gov_repo.l14_policy_admissions', 'gov_repo.l14_policy_version_admissions'] as const;
const postflight = () => {
  const text = migrationSource(l14PolicyAdmissionMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1B3_POSTFLIGHT'));
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

test('M16 S1B.3 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B3', stopBefore: l14PolicyAdmissionMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Pre-S1B.3 legacy data and catalog snapshots.
  const org = await c.newOrg();
  const legacyOwner = await c.mkUser(org, []);
  const legacyPolicy = await one(`insert into gov_repo.governance_policies(policy_code,title,policy_type,status,owner_user_id,organisation_id,created_by)
    values('LEG-PRE','Legacy pre-S1B.3','compliance','approved','${legacyOwner.id}','${org}','${legacyOwner.id}') returning policy_id`);
  await owner(`insert into gov_repo.policy_versions(organisation_id,policy_id,version_number,version_label,content_markdown,change_summary,status,approved_by,approval_date,created_by)
    values('${org}','${legacyPolicy}',1,'1.0','# legacy','legacy approval','approved','${legacyOwner.id}',now(),'${legacyOwner.id}')`);
  const legacyDigest = `select md5(string_agg(x, '|' order by x)) from (select p::text as x from gov_repo.governance_policies p
    union all select v::text from gov_repo.policy_versions v) s`;
  const legacyBefore = await one(legacyDigest);
  const f2Before = await one(F2_DIGEST);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 22, 'the pre-S1B.3 application definer surface is the 22 baseline');

  await t.test('preflight: the exact S1B.2/R1/R2/R3 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_policy_admissions')::text, 'absent')`), 'absent');
      assert.equal(await one(`select attnotnull::text from pg_attribute where attrelid='gov_repo.governance_policies'::regclass and attname='owner_user_id'`), 'true');
      assert.equal(await one(`select count(*) from pg_proc where proname in ('l14_admit_governance_policy_v1','l14_admit_policy_version_v1',
        'l14_read_policy_descriptors_v1','l14_policy_identity_content_hash_v1','l14_policy_command_result_v1','l14_policy_admission_guard_v1',
        'l14_policy_version_admission_guard_v1','l14_policy_admitted_descriptor_guard_v1')`), '0');
    };
    for (const [name, brk, fix, message] of [
      ['D-4 already applied', 'alter table gov_repo.governance_policies alter column owner_user_id drop not null',
        'alter table gov_repo.governance_policies alter column owner_user_id set not null', /D-4 applied outside S1B\.3/],
      ['D-13 broken', 'grant select on gov_repo.policy_versions to service_role', 'revoke select on gov_repo.policy_versions from service_role',
        /application-accessible \(D-13 broken\)/],
      ['policy-store RLS policy', 'create policy s1b3_probe on gov_repo.governance_policies for select to service_role using (true)',
        'drop policy s1b3_probe on gov_repo.governance_policies', /application-accessible \(D-13 broken\)/],
      ['extra application definer', `create function public.s1b3_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1b3_probe() to service_role`, 'drop function public.s1b3_probe()', /not exactly the 22 baseline/],
      ['approved definer body drift', `alter function gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text[],text) set lock_timeout = '6s'`,
        `alter function gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text[],text) set lock_timeout = '5s'`,
        /differs from its post-R3 owner\/body\/config/],
      ['R3 not applied', 'alter function gov_repo.technical_field_valid(text, text) set search_path = pg_catalog',
        'alter function gov_repo.technical_field_valid(text, text) set search_path = pg_catalog, pg_temp', /S1B\.2R3 execution-context closure not applied/],
      ['policy-store guard drift', 'alter table gov_repo.policy_versions enable trigger policy_versions_immutable',
        'alter table gov_repo.policy_versions enable always trigger policy_versions_immutable', /not the exact S1B\.2 set/],
    ] as const) {
      await bootstrapSql(brk);
      try {
        await assert.rejects(c.migrate(l14PolicyAdmissionMigration), (error: Error) => {
          assert.match(error.message, /M16_S1B3_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(fix); }
      await notApplied();
    }
    assert.equal(await one(legacyDigest), legacyBefore);
  });

  await t.test('[D-4] the migration applies once: legacy rows are not rewritten nor admitted; owner_user_id is nullable LEGACY / NON-AUTHORITATIVE', async () => {
    await c.migrate(l14PolicyAdmissionMigration);
    assert.equal(await one(legacyDigest), legacyBefore, 'no legacy row rewritten (byte-identical)');
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_admissions where policy_id='${legacyPolicy}'`), '0', 'legacy existence is never admission');
    assert.equal(await one(`select attnotnull::text from pg_attribute where attrelid='gov_repo.governance_policies'::regclass and attname='owner_user_id'`), 'false');
    assert.match(await one(`select col_description('gov_repo.governance_policies'::regclass, (select attnum from pg_attribute
      where attrelid='gov_repo.governance_policies'::regclass and attname='owner_user_id')::int)`), /^LEGACY \/ NON-AUTHORITATIVE for M16 \(D-4/);
    assert.match(await one(`select col_description('gov_repo.policy_versions'::regclass, (select attnum from pg_attribute
      where attrelid='gov_repo.policy_versions'::regclass and attname='change_summary')::int)`), /M16_POLICY_VERSION_ADMISSION/);
    await assert.rejects(c.migrate(l14PolicyAdmissionMigration), /M16_S1B3_PREFLIGHT/, 'not re-appliable');
    // Re-executable postflight over the effective catalog.
    await owner(postflight());
  });

  await t.test('[25/15] definer surface: the 22 baseline identities are untouched; exactly the three new RPCs are added, postgres-owned and policy-store-capable', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort());
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 25);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 15);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '25|0');
    // Exact EXECUTE ACL text and body hash pinned by the migration's own postflight entries.
    const text = migrationSource(l14PolicyAdmissionMigration);
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(text.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
    }
    for (const sig of NEW_HELPERS) {
      assert.equal(await one(`select prosecdef::text||'|'||coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';') from pg_proc where oid='${sig}'::regprocedure`),
        'false|{postgres=X/postgres}|search_path=pg_catalog, pg_temp', sig);
    }
  });

  await t.test('[44-48] privilege closure: no direct table authority for any application role; only the three RPCs are service_role-executable', async () => {
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      for (const table of GUARDED) {
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
      await assert.rejects(c.sql(`select * from gov_repo.l14_read_policy_descriptors_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), null)`, role),
        /42501|permission denied/, `${role} cannot execute the read RPC`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_admit_governance_policy_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c', 'EXPECTED_NONE',
        'X', 'X', 'risk', 'LOCAL_HUMAN', 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','), 'service_role: exactly the three RPCs');
    await assert.rejects(c.sql(`select gov_repo.l14_policy_identity_content_hash_v1('a', 'b', 'risk')`, 'service_role'), /42501|permission denied/);
    await assert.rejects(c.sql(`select * from gov_repo.l14_policy_command_result_v1(gen_random_uuid(), 'x', false)`, 'service_role'), /42501|permission denied/);
    assert.equal(await one(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS].map(s => `'${s}'::regprocedure`).join(',')}]::oid[]) and a.grantee=0`), '0', 'PUBLIC EXECUTE revoked');
    for (const table of GUARDED) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `${table}: owner-only ACL, RLS on, no policy`);
    }
  });

  await t.test('[56-60] structural: no JSON / free text / PII in lineage; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in ('gov_repo.l14_policy_admissions'::regclass,'gov_repo.l14_policy_version_admissions'::regclass)
      and attnum>0 and not attisdropped and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in ('gov_repo.l14_policy_admissions'::regclass,'gov_repo.l14_policy_version_admissions'::regclass)
      and attnum>0 and not attisdropped and attname ~ '(name|email|phone|title|description|summary|rationale|content_markdown|label|note|text|code)'`), '0',
      'no PII / free-rationale / descriptor / body column');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    for (const [table, constraint, expected] of [['canonical_objects', 'canonical_objects_kind_check', Object.values(CANONICAL_OBJECT_KIND)],
      ['canonical_relationships', 'canonical_relationships_type_check', Object.values(GOVERNED_RELATIONSHIP_TYPE)]] as const) {
      const values = JSON.parse(await one(`select json_agg(m[1] order by m[1] collate "C") from pg_constraint k,
        regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m where k.conrelid='gov_repo.${table}'::regclass and k.conname='${constraint}'`));
      assert.deepEqual(values, [...expected].sort());
    }
    for (const forbidden of ['POLICY', 'PARTY', 'DOMAIN', 'CONTROL']) assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).includes(forbidden), forbidden);
    for (const forbidden of ['OWNS', 'APPLIES_POLICY', 'CONTROLLED_BY']) assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).includes(forbidden), forbidden);
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, ACL and rows untouched');
  });

  await t.test('[49-55] postflight negative controls: every drift fails it; extension members are excluded but never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '25|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1b3_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1b3_probe() from public; grant execute on function ${schema}.s1b3_probe() to ${grantee};`;
    const controls: Array<[string, string, RegExp]> = [
      // [49] unsafe default privileges.
      ['[49] gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['[49] global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['[49] gov_repo routine default → anon', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to anon;', /default privileges/],
      // [50] unexpected SECURITY DEFINER (any schema, any application grantee) incl. one reaching a policy store.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`[50] public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['[50] gov_repo definer', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['[50] unrelated-schema definer', `create schema s1b3_probe_app; ${definer('s1b3_probe_app', 'authenticated')}`, /CLOSED_SURFACE/],
      ['[50] postgres-owned definer reaching a policy store', `set local role postgres; create function gov_repo.s1b3_probe() returns bigint language sql security definer
        set search_path = pg_catalog, pg_temp as 'select count(*) from gov_repo.governance_policies'; grant execute on function gov_repo.s1b3_probe() to service_role; reset role;`,
      /CLOSED_SURFACE|outside the approved 15/],
      ['[50] overload of a new RPC', `set local role postgres; create function gov_repo.l14_read_policy_descriptors_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_read_policy_descriptors_v1(uuid) from public; reset role;`,
      /overload|exactly the six S1B\.1 \+ three S1B\.3|ACL\/definer shape/],
      // [51] writable / readable view leaks (any schema, transitive).
      ['[51] view over lineage → service_role', 'create view public.s1b3_leak as select * from gov_repo.l14_policy_admissions; grant select on public.s1b3_leak to service_role;', /view/],
      ['[51] writable view over governance_policies → authenticated', `create view public.s1b3_leak as select policy_id, title from gov_repo.governance_policies;
        grant insert, update on public.s1b3_leak to authenticated;`, /view/],
      ['[51] nested view over policy_versions → anon', `create view public.s1b3_leak as select * from gov_repo.policy_versions;
        create view public.s1b3_leak2 as select version_id from public.s1b3_leak; grant select on public.s1b3_leak2 to anon;`, /view/],
      // [52] sequence leaks.
      ['[52] sequence owned by policy_versions → anon', `set local role postgres; create sequence gov_repo.s1b3_leak owned by gov_repo.policy_versions.version_number;
        reset role; grant usage on sequence gov_repo.s1b3_leak to anon;`, /sequence/],
      ['[52] sequence owned by lineage → service_role', `set local role postgres; create sequence gov_repo.s1b3_leak owned by gov_repo.l14_policy_version_admissions.recorded_at;
        reset role; grant select on sequence gov_repo.s1b3_leak to service_role;`, /sequence/],
      // [53] column-level and inherited privileges.
      ['[53] column SELECT on governance_policies', 'grant select (title) on gov_repo.governance_policies to authenticated;', /column-level grants|column privilege|holds/],
      ['[53] column REFERENCES on lineage', 'grant references (policy_id) on gov_repo.l14_policy_admissions to service_role;', /column-level grants|column privilege|holds/],
      ['[53] inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['[53] inherited via an intermediate role', `create role s1b3_leak_parent nologin; grant select on gov_repo.l14_policy_version_admissions to s1b3_leak_parent;
        grant s1b3_leak_parent to service_role;`, /non-owner table grant|holds/],
      // Lineage / RLS / ACL / definer shape drift.
      ['RLS disabled on lineage', 'alter table gov_repo.l14_policy_admissions disable row level security;', /RLS-enabled/],
      ['permissive policy on lineage', 'create policy s1b3_probe on gov_repo.l14_policy_admissions for select to service_role using (true);', /RLS policy/],
      ['permissive policy on a store', 'create policy s1b3_probe on gov_repo.policy_versions for select to authenticated using (true);', /RLS policy/],
      ['immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_policy_version_admissions enable trigger l14_policy_version_admissions_immutable;', /lacks ALWAYS raising/],
      ['lineage guard disabled', 'alter table gov_repo.l14_policy_admissions disable trigger l14_policy_admissions_guard;', /structural guard/],
      ['admitted-descriptor guard dropped', 'drop trigger governance_policies_l14_admitted_descriptor_guard on gov_repo.governance_policies;', /guard sets/],
      ['JSON column in lineage', 'alter table gov_repo.l14_policy_admissions add column extra jsonb;', /JSON column/],
      ['free-text column in lineage', 'alter table gov_repo.l14_policy_version_admissions add column rationale text;', /pinned set/],
      ['helper made service_role-executable', `grant execute on function ${NEW_HELPERS[4]} to service_role;`, /owner-only SECURITY INVOKER|exactly the six/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[0]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['read RPC lost service_role', `revoke execute on function ${NEW_RPCS[2]} from service_role;`, /ACL\/definer shape|exactly the six|not exactly service_role/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[1]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC body drift', `set local role postgres; create or replace function gov_repo.l14_read_policy_descriptors_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_policy_id uuid)
        returns table (policy_id uuid, policy_code text, title text, policy_type text, policy_admission_authorization_decision_id uuid, policy_recorded_at timestamptz,
          version_id uuid, version_number integer, version_label text, content_hash text, version_admission_authorization_decision_id uuid,
          version_recorded_at timestamptz, validation_state text)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ select null::uuid, null, null, null, null::uuid, null::timestamptz, null::uuid, null::int, null, null, null::uuid, null::timestamptz, 'VALIDATED' $$;
        reset role;`, /body hash changed/],
      ['D-4 reverted', 'alter table gov_repo.governance_policies alter column owner_user_id set not null;', /D-4 not resolved/],
      ['change_summary made optional', 'alter table gov_repo.policy_versions alter column change_summary drop not null;', /change_summary/],
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','POLICY')) not valid;`, /canonical object kinds \(11\)/],
      ['governed relationship type added', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL',
          'USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','APPLIES_POLICY')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1B.3 routine attached to canonical_relationships', `create trigger s1b3_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_policy_admitted_descriptor_guard_v1();`, /F2 boundary/],
      ['cascading FK into policy_versions', `create table public.s1b3_cascade (version_id uuid references gov_repo.policy_versions (version_id) on delete cascade);`,
        /cascading FK/],
      // [55] an extension member never masks a non-member.
      ['[55] member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['[55] same routine once no longer a member', `${memberDefiner} alter extension pgcrypto drop function ${member};`, /CLOSED_SURFACE|not exactly 25/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1B3_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    // [54] a genuine pgcrypto member made an application definer is excluded (governed surface stays 25).
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '25|1');
    assert.equal(await inTxn(`${definer('public', 'service_role')} alter extension pgcrypto add function public.s1b3_probe();`, SURFACE_SPLIT_SQL), '25|1',
      'membership (pg_depend deptype e), not schema or name, decides');
    // Every control rolled back.
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '25|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1b3_probe'`), '0');
    await owner(block);
  });

  await t.test('[36-38] the new SQL never reaches governance decisions, registry states, proposals, trust, legacy status/approval or the version pointer', async () => {
    const sources = await one(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/current_version_id/, /l14_governance_decisions/, /l14_registry_states/, /l14_proposals/, /trust_state/, /approved_by/,
      /approval_date/, /qes_signature_id/, /\bstatus\b/, /canonical_relationships/, /policy_mandate_mappings/]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
  });
});

test('M16 S1B.3 preflight refuses a catalog without the S1B.2R3 closure (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B3', stopBefore: s0ExecutionContextClosureMigration });
  t.after(() => c.stop());
  await assert.rejects(c.migrate(l14PolicyAdmissionMigration), /M16_S1B3_PREFLIGHT: S1B\.2R3 execution-context closure not applied/);
  assert.equal(lastLine(await c.owner(`select coalesce(to_regclass('gov_repo.l14_policy_admissions')::text, 'absent')`)), 'absent');
});
