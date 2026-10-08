import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14PolicyVersionValidationMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { policyValidationKit } from '../helpers/m16-l14-policy-validation-fixtures';

/**
 * M16-S1B.4 — privilege closure, preflight, postflight negative controls and structural invariants on real disposable
 * PostgreSQL 17. The S1B4 horizon is stopped right before the S1B.4 migration so the suite can snapshot the merged
 * S1B.3 catalog, prove the preflight aborts atomically, then apply the migration itself. Every control runs inside a
 * rolled-back bootstrap transaction; historical postflights are never altered. Bracketed numbers are acceptance items.
 */
const NEW_RPCS = [
  'gov_repo.l14_submit_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_policy_version_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const READ_RPC = 'gov_repo.l14_read_policy_descriptors_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)';
const NEW_HELPERS = [
  'gov_repo.l14_policy_version_proposal_guard_v1()', 'gov_repo.l14_policy_version_state_guard_v1()', 'gov_repo.l14_policy_version_head_guard_v1()',
  'gov_repo.l14_policy_version_command_result_v1(uuid,text,boolean)',
  'gov_repo.l14_policy_version_valid_state_v1(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
  'gov_repo.l14_policy_version_validation_condition_v1(uuid,uuid,uuid,text,timestamp with time zone)',
] as const;
const NEW_TABLES = ['gov_repo.l14_policy_version_states', 'gov_repo.l14_policy_version_proposals', 'gov_repo.l14_policy_version_heads'] as const;
const postflight = () => {
  const text = migrationSource(l14PolicyVersionValidationMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1B4_POSTFLIGHT'));
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

test('M16 S1B.4 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B4', stopBefore: l14PolicyVersionValidationMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  const f2Before = await one(F2_DIGEST);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 25, 'the merged S1B.3 application definer surface is 25');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 15, 'the merged S1B.3 policy-store-capable surface is 15');
  const readBefore = await one(`select oid::text||'|'||encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${READ_RPC}'::regprocedure`);

  await t.test('preflight: the exact merged S1B.3 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_policy_version_states')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname in ('l14_submit_policy_version_proposal_v1','l14_decide_policy_version_proposal_v1',
        'l14_policy_version_valid_state_v1','l14_policy_version_validation_condition_v1')`), '0');
      assert.equal(await one(`select oid::text||'|'||encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${READ_RPC}'::regprocedure`), readBefore,
        'the S1B.3 descriptor read is untouched');
    };
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1b4_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1b4_probe() to service_role`, 'drop function public.s1b4_probe()', /not exactly the 25 S1B\.3 baseline/],
      ['S1B.3 RPC config drift', `alter function ${READ_RPC} set lock_timeout = '6s'`, `alter function ${READ_RPC} set lock_timeout = '5s'`,
        /differs from its merged S1B\.3 owner\/body\/config/],
      ['admission lineage guard missing', 'alter table gov_repo.l14_policy_version_admissions disable trigger l14_policy_version_admissions_guard',
        'alter table gov_repo.l14_policy_version_admissions enable always trigger l14_policy_version_admissions_guard', /admission lineage \/ store hash key missing/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
    ] as const) {
      await bootstrapSql(brk);
      try {
        await assert.rejects(c.migrate(l14PolicyVersionValidationMigration), (error: Error) => {
          assert.match(error.message, /M16_S1B4_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(fix); }
      await notApplied();
    }
  });

  await t.test('the migration applies once; its postflight re-executes cleanly over the effective catalog', async () => {
    await c.migrate(l14PolicyVersionValidationMigration);
    await assert.rejects(c.migrate(l14PolicyVersionValidationMigration), /M16_S1B4_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
  });

  await t.test('[57,58,59] definer surface 25 -> 27 / 15 -> 17: the 24 untouched identities are unchanged; the read is replaced in place; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn) && p.fn !== READ_RPC)) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the two new RPCs; the descriptor read keeps its identity');
    for (const row of [...added, after.find(p => p.fn === READ_RPC)!]) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 27);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 17);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '27|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='l14_read_policy_descriptors_v1'`), '1', 'no second descriptor RPC / overload');
    const text = migrationSource(l14PolicyVersionValidationMigration);
    const postBlock = text.slice(text.indexOf('DO $postflight$'));
    for (const sig of [...NEW_RPCS, READ_RPC]) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
    }
    assert.notEqual(await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${READ_RPC}'::regprocedure`), readBefore.split('|')[1],
      'the descriptor read body was replaced');
    for (const sig of NEW_HELPERS) {
      assert.equal(await one(`select prosecdef::text||'|'||coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';') from pg_proc where oid='${sig}'::regprocedure`),
        'false|{postgres=X/postgres}|search_path=pg_catalog, pg_temp', sig);
    }
  });

  await t.test('[44,45,46,47,48,60] privilege closure: no direct table authority for any application role; only the intended RPCs are service_role-executable', async () => {
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      for (const table of NEW_TABLES) {
        for (const statement of [`select count(*) from ${table}`, `delete from ${table}`, `update ${table} set organisation_id=organisation_id`,
          `truncate ${table}`, `insert into ${table}(organisation_id) values (gen_random_uuid())`]) {
          await assert.rejects(c.sql(statement, role), /42501|permission denied/, `${role}: ${statement}`);
        }
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of [...NEW_RPCS, READ_RPC]) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_policy_version_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'POLICY_VERSION_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_submit_policy_version_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'VALIDATE', 'LOCAL_HUMAN', gen_random_uuid(), gen_random_uuid(), repeat('a',64), null, null, null, 'NONE', '{}', repeat('a',64))`, role),
      /42501|permission denied/, `${role} submit`);
    }
    const all = `array[${[...NEW_RPCS, READ_RPC, ...NEW_HELPERS].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS, READ_RPC].sort().join(','),
    '[48] service_role: exactly the two new RPCs + the replaced read');
    await assert.rejects(c.sql(`select * from gov_repo.l14_policy_version_valid_state_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', now(), now())`, 'service_role'),
      /42501|permission denied/, 'the resolver is owner-only');
    await assert.rejects(c.sql(`select * from gov_repo.l14_policy_version_command_result_v1(gen_random_uuid(), 'x', false)`, 'service_role'), /42501|permission denied/);
    assert.equal(await one(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = any(${all}) and a.grantee=0`), '0', '[45] PUBLIC EXECUTE revoked');
    for (const table of NEW_TABLES) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `[60] ${table}: owner-only ACL, RLS on, no policy`);
    }
  });

  await t.test('[44] service_role cannot mutate history even through the read path; the RPC path is the only writer (functional smoke)', async () => {
    const k = await policyValidationKit(c);
    const ctx = await k.setup();
    const s = await k.admitted(ctx, 'acl');
    const v = await k.validate(ctx, 'acl', s);
    assert.equal(v.decided.outcome, 'VALIDATED');
    for (const statement of [`update gov_repo.l14_policy_version_heads set latest_state_id=null`, `delete from gov_repo.l14_registry_states`,
      `insert into gov_repo.l14_policy_version_states(organisation_id,state_id,state_kind,policy_id,version_id,content_hash) values ('${ctx.org}',gen_random_uuid(),'VALIDATED','${s.policyId}','${s.versionId}','${s.contentHash}')`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
  });

  await t.test('[61,62,67,68,69,70] structural: no JSON / free text / content in the new tables; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', '[61] no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|email|phone|title|description|summary|rationale|content_markdown|label|note|comment|reason|status|approv|qes|current_version|owner)'`), '0',
    '[62] no free-text rationale, content, label or legacy authority column');
    assert.equal(await one(`select count(*) from pg_attribute a where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('text'::regtype,'bpchar'::regtype) and not exists (select 1 from pg_constraint k where k.conrelid=a.attrelid and k.contype='c'
      and k.conkey=array[a.attnum]::int2[])`), '0', '[62] every text column is a closed vocabulary / pinned hash');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    for (const [table, constraint, expected] of [['canonical_objects', 'canonical_objects_kind_check', Object.values(CANONICAL_OBJECT_KIND)],
      ['canonical_relationships', 'canonical_relationships_type_check', Object.values(GOVERNED_RELATIONSHIP_TYPE)]] as const) {
      const values = JSON.parse(await one(`select json_agg(m[1] order by m[1] collate "C") from pg_constraint k,
        regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m where k.conrelid='gov_repo.${table}'::regclass and k.conname='${constraint}'`));
      assert.deepEqual(values, [...expected].sort());
    }
    assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).includes('POLICY'));
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).includes('APPLIES_POLICY'));
    assert.equal(await one(F2_DIGEST), f2Before, '[69,70] F2: canonical_relationships structure, ACL and rows untouched');
  });

  await t.test('[49-60] postflight negative controls: every drift fails it; extension members are excluded but never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '27|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1b4_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1b4_probe() from public; grant execute on function ${schema}.s1b4_probe() to ${grantee};`;
    const controls: Array<[string, string, RegExp]> = [
      // [49] direct column privilege leaks.
      ['[49] column SELECT on states', 'grant select (state_id) on gov_repo.l14_policy_version_states to authenticated;', /column-level grants|column privilege|holds/],
      ['[49] column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_policy_version_heads to service_role;', /column-level grants|column privilege|holds/],
      // [50] sequence leaks.
      ['[50] sequence owned by S1B.4 history → anon', `set local role postgres; create sequence gov_repo.s1b4_leak owned by gov_repo.l14_policy_version_states.state_id;
        reset role; grant usage on sequence gov_repo.s1b4_leak to anon;`, /sequence/],
      // [51] writable / readable view leaks.
      ['[51] view over states → service_role', 'create view public.s1b4_leak as select * from gov_repo.l14_policy_version_states; grant select on public.s1b4_leak to service_role;', /view/],
      ['[51] writable nested view over head → authenticated', `create view public.s1b4_leak as select * from gov_repo.l14_policy_version_heads;
        create view public.s1b4_leak2 as select * from public.s1b4_leak; grant update on public.s1b4_leak2 to authenticated;`, /view/],
      // [52] unsafe default ACL.
      ['[52] gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['[52] global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      // [53] inheritance leaks.
      ['[53] inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['[53] inherited via an intermediate role', `create role s1b4_leak_parent nologin; grant select on gov_repo.l14_policy_version_proposals to s1b4_leak_parent;
        grant s1b4_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['[53] table inheritance from S1B.4 history', 'create table public.s1b4_child () inherits (gov_repo.l14_policy_version_heads);', /inheritance/],
      // [54] unexpected SECURITY DEFINER (any schema, any application grantee), incl. a policy-store-capable one.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`[54] public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['[54] postgres-owned definer reaching a policy store', `set local role postgres; create function gov_repo.s1b4_probe() returns bigint language sql security definer
        set search_path = pg_catalog, pg_temp as 'select count(*) from gov_repo.policy_versions'; grant execute on function gov_repo.s1b4_probe() to service_role; reset role;`,
      /CLOSED_SURFACE|outside the approved 17/],
      ['[54] overload of a new RPC', `set local role postgres; create function gov_repo.l14_decide_policy_version_proposal_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_decide_policy_version_proposal_v1(uuid) from public; reset role;`,
      /overload|nine S1B\.3 \+ two S1B\.4|ACL\/definer shape/],
      // [56] an extension member never masks a non-member.
      ['[56] member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['[56] same routine once no longer a member', `${memberDefiner} alter extension pgcrypto drop function ${member};`, /CLOSED_SURFACE|not exactly 27/],
      // [58] exact body hashes.
      ['[58] decide RPC body drift', `set local role postgres; create or replace function gov_repo.l14_decide_policy_version_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text,
          p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid, governance_decision_id uuid,
          policy_id uuid, version_id uuid, content_hash text, registry_state_id uuid, state_kind text, effective_from timestamptz, recorded_at timestamptz)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ select null::boolean, null, null, null, 'VALIDATED', null, null::uuid, null, null, null::uuid, null::uuid, null::uuid, null::uuid, null,
          null::uuid, null, null::timestamptz, null::timestamptz $$; reset role;`, /body hash changed/],
      // [59] exact owners / search_path.
      ['[59] RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['[59] RPC owner drift', `create role s1b4_owner nologin; alter function ${NEW_RPCS[1]} owner to s1b4_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['[59] helper made service_role-executable', `grant execute on function ${NEW_HELPERS[4]} to service_role;`, /owner-only SECURITY INVOKER|nine S1B\.3 \+ two S1B\.4/],
      ['[47] RPC executable by authenticated', `grant execute on function ${NEW_RPCS[0]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['[48] read RPC lost service_role', `revoke execute on function ${READ_RPC} from service_role;`, /ACL\/definer shape|nine S1B\.3|not exactly service_role/],
      // [60] permissive RLS / RLS off / immutability.
      ['[60] permissive policy on states', 'create policy s1b4_probe on gov_repo.l14_policy_version_states for select to service_role using (true);', /RLS policy/],
      ['[60] RLS disabled on head', 'alter table gov_repo.l14_policy_version_heads disable row level security;', /RLS-enabled/],
      ['[43] immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_policy_version_states enable trigger l14_policy_version_states_immutable;', /lacks ALWAYS raising/],
      ['[43] head guard disabled', 'alter table gov_repo.l14_policy_version_heads disable trigger l14_policy_version_heads_guard;', /structural guard/],
      ['[11] proposal source guard disabled', 'alter table gov_repo.l14_policy_version_proposals disable trigger l14_policy_version_proposals_guard;', /structural guard/],
      // [61,62] JSON / free text.
      ['[61] JSON column', 'alter table gov_repo.l14_policy_version_proposals add column extra jsonb;', /JSON column/],
      ['[62] free-text rationale column', 'alter table gov_repo.l14_policy_version_states add column rationale text;', /pinned set/],
      ['[18] cascading FK into S1B.4 history', `create table public.s1b4_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_policy_version_states (organisation_id, state_id) on delete cascade);`,
        /cascading FK/],
      // [67,68,70] frozen enumerations and F2.
      ['[67] canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','POLICY')) not valid;`, /canonical object kinds \(11\)/],
      ['[68] governed relationship type added', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL',
          'USES_MCP','INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','APPLIES_POLICY')) not valid;`,
      /governed relationship types \(12\)/],
      ['[70] F2: S1B.4 routine attached to canonical_relationships', `create trigger s1b4_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_policy_version_head_guard_v1();`, /F2 boundary/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1B4_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    // [55] a genuine pgcrypto member made an application definer is excluded (governed surface stays 27).
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '27|1');
    assert.equal(await inTxn(`${definer('public', 'service_role')} alter extension pgcrypto add function public.s1b4_probe();`, SURFACE_SPLIT_SQL), '27|1',
      'membership (pg_depend deptype e), not schema or name, decides');
    // Every control rolled back.
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '27|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1b4_probe'`), '0');
    await owner(block);
  });

  await t.test('[39,40,41] the new SQL never reaches legacy status/approval/QES, the version pointer, content bodies, applicability, mappings or F2', async () => {
    const sources = await one(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, READ_RPC, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/current_version_id/, /approved_by/, /approval_date/, /reviewed_by/, /qes_signature_id/, /\bstatus\b/, /content_markdown/,
      /change_summary/, /canonical_relationships/, /policy_mandate_mappings/, /POLICY_APPLICABILITY/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(governance_policies|policy_versions|l14_policy_admissions|l14_policy_version_admissions)\b/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
  });
});
