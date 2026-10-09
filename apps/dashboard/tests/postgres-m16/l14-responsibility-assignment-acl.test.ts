import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14ResponsibilityAssignmentMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.1 — privilege closure, preflight, postflight negative controls (one per privilege / structure class) and
 * structural invariants on real disposable PostgreSQL 17. The S1C1 horizon is stopped right before the S1C.1 migration so
 * the suite can seed real S1B history, snapshot the merged S1B.6 catalog, prove the preflight aborts atomically, then apply
 * the migration itself. Every control runs inside a rolled-back bootstrap transaction; historical postflights are never
 * altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_submit_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const NEW_HELPERS = [
  'gov_repo.l14_responsibility_single_owner_conflict_v1(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
  'gov_repo.l14_responsibility_assignment_proposal_guard_v1()', 'gov_repo.l14_responsibility_assignment_state_guard_v1()',
  'gov_repo.l14_responsibility_assignment_head_guard_v1()', 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])',
  'gov_repo.l14_evaluate_target_authority_rules_v1(uuid,uuid,uuid,uuid[],text,text,boolean,text,text,text)',
  'gov_repo.l14_responsibility_assignment_command_result_v1(uuid,text,boolean)',
  'gov_repo.l14_responsibility_assignment_valid_state_v1(uuid,text,text,text,uuid,timestamp with time zone,timestamp with time zone)',
  'gov_repo.l14_responsibility_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)',
] as const;
const NEW_TABLES = ['gov_repo.l14_fact_states', 'gov_repo.l14_responsibility_assignment_states',
  'gov_repo.l14_responsibility_assignment_proposals', 'gov_repo.l14_responsibility_assignment_heads'] as const;
/** The four S1A / S1B framework tables S1C.1 widens (closed CHECKs + one nullable fact column); their rows are never rewritten. */
const WIDENED = ['l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results', 'l14_support_links'] as const;
const postflight = () => {
  const text = migrationSource(l14ResponsibilityAssignmentMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1C1_POSTFLIGHT'));
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
/** Every pre-S1C.1 routine body + config + ACL in gov_repo (S1C.1 replaces nothing). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%responsibilit%' and proname not in
    ('l14_lock_fact_subject_guard_v1','l14_evaluate_target_authority_rules_v1')`;
/** Every pre-S1C.1 gov_repo table definition except the four widened framework tables and the new S1C.1 tables. */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')
  and c.relname not like 'l14\\_responsibility%' and c.relname <> 'l14_fact_states'
  and c.relname not in (${WIDENED.map(t => `'${t}'`).join(',')})`;
/** Every existing row of the widened framework tables, without the new nullable fact column (never rewritten). */
const ROWS_DIGEST = `select md5(string_agg(x, '|' order by x)) from (${WIDENED.map(t =>
  `select '${t}:'||(to_jsonb(t) - 'fact_state_id')::text as x from gov_repo.${t} t`).join(' union all ')}) s`;
/** Every pre-existing constraint definition of the widened tables except the closed CHECKs S1C.1 widens. */
const WIDENED_CONSTRAINTS = `select md5(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in (${WIDENED.map(t => `'gov_repo.${t}'::regclass`).join(',')})
  and conname not in ('l14_governance_decisions_subject_kind_check','l14_governance_decisions_reason_code_check','l14_command_results_subject_kind_check',
    'l14_command_results_shape_check','l14_support_links_owner_kind_check','l14_support_links_owner_check','l14_command_results_fact_state_fkey',
    'l14_support_links_fact_state_fkey','l14_authorization_decisions_responsibility_target_check')`;

test('M16 S1C.1 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C1', stopBefore: l14ResponsibilityAssignmentMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Real pre-S1C.1 history (AP + Party lifecycle with support) that the widened framework must keep byte-identical.
  const rk = await responsibilityKit(c);
  const pk = rk.pk;
  const hist = await pk.setup();
  await c.evidence(hist.org, 'hist-ev');
  const histParty = await pk.validated(hist as never, 'hist');
  const histRevoke = await pk.revoke(hist as never, 'hist-rv', histParty.partyId, histParty.decided.registry_state_id);
  assert.equal(histRevoke.decided.outcome, 'REVOKED');
  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const rowsBefore = await one(ROWS_DIGEST);
  const constraintsBefore = await one(WIDENED_CONSTRAINTS);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 33, 'the merged S1B.6 application definer surface is 33');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 23, 'the merged S1B.6 canonical-owner (policy-store-capable) class is 23');

  await t.test('preflight: the exact merged S1B.6 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_fact_states')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%responsibilit%'`), '0');
      assert.equal(await one(`select count(*) from pg_attribute where attrelid='gov_repo.l14_command_results'::regclass and attname='fact_state_id'`), '0');
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
      assert.equal(await one(ROWS_DIGEST), rowsBefore);
    };
    const decide = 'gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1c1_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1c1_probe() to service_role`, 'drop function public.s1c1_probe()', /not exactly the 33 S1B\.6 baseline/],
      ['S1B.6 RPC config drift', `alter function ${decide} set lock_timeout = '6s'`, `alter function ${decide} set lock_timeout = '5s'`,
        /differs from its merged S1B\.6 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
      ['S1B.6 horizon absent', 'alter table gov_repo.l14_control_definition_heads rename to l14_control_definition_heads_x',
        'alter table gov_repo.l14_control_definition_heads_x rename to l14_control_definition_heads', /unexpected l14 relation set/],
      ['framework already widened', 'alter table gov_repo.l14_command_results add column fact_state_id uuid',
        'alter table gov_repo.l14_command_results drop column fact_state_id', /framework keys missing or already widened/],
    ] as const) {
      await bootstrapSql(`set role postgres; ${brk}`);
      try {
        await assert.rejects(c.migrate(l14ResponsibilityAssignmentMigration), (error: Error) => {
          assert.match(error.message, /M16_S1C1_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(`set role postgres; ${fix}`); }
      await notApplied();
    }
    // Pre-existing RESPONSIBILITY_ASSIGNMENT governance history (no earlier slice could write any) aborts the preflight.
    const text = migrationSource(l14ResponsibilityAssignmentMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${hist.org}',gen_random_uuid(),'RESPONSIBILITY_ASSIGNMENT','VALIDATE','LOCAL_HUMAN',
      '${hist.member.id}','NONE',now()); ${pre} rollback;`), /M16_S1C1_PREFLIGHT: responsibility assignment governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly; historical shapes / rows / routines are untouched', async () => {
    await c.migrate(l14ResponsibilityAssignmentMigration);
    await assert.rejects(c.migrate(l14ResponsibilityAssignmentMigration), /M16_S1C1_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1C.1 gov_repo routine body / config / ACL is byte-identical');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no other pre-S1C.1 gov_repo table / view is altered');
    assert.equal(await one(ROWS_DIGEST), rowsBefore, 'every historical S1A / S1B framework row is unchanged (no rewrite, no backfill)');
    assert.equal(await one(WIDENED_CONSTRAINTS), constraintsBefore, 'every other constraint of the widened tables is unchanged');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where fact_state_id is not null`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where fact_state_id is not null`), '0');
    // Historical commands still replay their ORIGINAL durable result after the widening.
    const replayed = await c.exec(pk.decideSql(hist.steward, { commandId: hist.cmd('hist-rv-revoke'), proposalId: histRevoke.submitted.proposal_id,
      proposal: histRevoke.proposal, outcome: 'REVOKE', expected: histParty.decided.registry_state_id }));
    assert.deepEqual([replayed.replay, replayed.registry_state_id, replayed.recorded_at],
      [true, histRevoke.decided.registry_state_id, histRevoke.decided.recorded_at]);
    // The old S1B shapes stay exactly enforceable: a registry result can never carry a fact state (rolled back).
    await assert.rejects(bootstrapSql(`begin; set local role postgres; update gov_repo.l14_command_results set fact_state_id=gen_random_uuid()
      where organisation_id='${hist.org}'; rollback;`), /L14_HISTORY_IMMUTABLE|l14_command_results_shape_check|fact_state_fkey/);
  });

  await t.test('definer surface 33 -> 35 / canonical-owner class 23 -> 25: the 33 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the two new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 35);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 25);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '35|0');
    const text = migrationSource(l14ResponsibilityAssignmentMigration);
    const postBlock = text.slice(text.indexOf('DO $postflight$'));
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
      // Owner capability is not body-level need: no S1C.1 body reaches a policy store, a registry store or Party PII.
      assert.equal(await one(`select (prosrc ~ '(governance_policies|policy_versions|l14_policy_|l14_control_definition|l14_domain_|directory_profile|canonical_relationships)')::text
        from pg_proc where oid='${sig}'::regprocedure`), 'false', sig);
      assert.equal(await one(`select count(*) from pg_depend where classid='pg_proc'::regclass and objid='${sig}'::regprocedure
        and refclassid='pg_class'::regclass and refobjid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)`), '0', sig);
    }
    for (const sig of NEW_HELPERS) {
      assert.equal(await one(`select prosecdef::text||'|'||coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';') from pg_proc where oid='${sig}'::regprocedure`),
        'false|{postgres=X/postgres}|search_path=pg_catalog, pg_temp', sig);
    }
  });

  await t.test('privilege closure: no direct table authority for any application role; only the two RPCs are service_role-executable', async () => {
    for (const role of ['service_role', 'anon', 'authenticated'] as const) {
      for (const table of NEW_TABLES) {
        for (const statement of [`select count(*) from ${table}`, `delete from ${table}`, `update ${table} set organisation_id=organisation_id`,
          `truncate ${table}`, `insert into ${table}(organisation_id) values (gen_random_uuid())`]) {
          await assert.rejects(c.sql(statement, role), /42501|permission denied/, `${role}: ${statement}`);
        }
      }
      for (const table of WIDENED) {
        await assert.rejects(c.sql(`update gov_repo.${table} set organisation_id=organisation_id`, role), /42501|permission denied/, `${role}: ${table}`);
      }
      for (const table of ['l14_command_results', 'l14_support_links']) {
        await assert.rejects(c.sql(`update gov_repo.${table} set fact_state_id=null`, role), /42501|permission denied/, `${role}: ${table}.fact_state_id`);
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of NEW_RPCS) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_submit_responsibility_assignment_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'VALIDATE', 'LOCAL_HUMAN', 'AGENT', 'x', 'BUSINESS_OWNER', gen_random_uuid(), gen_random_uuid(), null, null, null, null, 'NONE', '{}', repeat('a',64))`, role),
      /42501|permission denied/, `${role} submit`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_responsibility_assignment_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'RESPONSIBILITY_ASSIGNMENT_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the two new RPCs');
    for (const [name, call] of [
      ['resolver', `select * from gov_repo.l14_responsibility_assignment_valid_state_v1(gen_random_uuid(), 'AGENT', 'x', 'BUSINESS_OWNER', gen_random_uuid(), now(), now())`],
      ['current read', `select * from gov_repo.l14_responsibility_assignments_current_v1(gen_random_uuid(), 'AGENT', 'x', now(), now())`],
      ['result projection', `select * from gov_repo.l14_responsibility_assignment_command_result_v1(gen_random_uuid(), 'x', false)`],
      ['cardinality test', `select gov_repo.l14_responsibility_single_owner_conflict_v1(gen_random_uuid(), 'AGENT', 'x', 'BUSINESS_OWNER', now(), null)`],
      ['fact guard', `select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), 'RESPONSIBILITY_ASSIGNMENT', array['KEY','x'])`],
      ['target evaluator', `select * from gov_repo.l14_evaluate_target_authority_rules_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '{}', 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', false, 'IMMEDIATE', 'AGENT', 'x')`],
    ] as const) {
      await assert.rejects(c.sql(call, 'service_role'), /42501|permission denied/, `${name} is owner-only`);
    }
    assert.equal(await one(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = any(${all}) and a.grantee=0`), '0', 'PUBLIC EXECUTE revoked');
    for (const table of NEW_TABLES) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `${table}: owner-only ACL, RLS on, no policy`);
      assert.equal(await one(`select count(*) from pg_attribute where attrelid='${table}'::regclass and attacl is not null`), '0', `${table}: no column grant`);
    }
  });

  await t.test('service_role cannot mutate history directly; immutable history raises for the owner too; the RPC path is the only writer', async () => {
    const k = rk;
    const ctx = await k.setup();
    const p = await k.party(ctx, 'acl');
    const key = k.keyOf('AGENT', ctx.objects.agent, 'BUSINESS_OWNER', p.partyId);
    const a = await k.assign(ctx, 'acl', key, p);
    assert.equal(a.decided.outcome, 'VALIDATED');
    for (const statement of [`update gov_repo.l14_responsibility_assignment_heads set latest_state_id=null`, `delete from gov_repo.l14_fact_states`,
      `update gov_repo.l14_responsibility_assignment_states set governance_party_id=gen_random_uuid()`,
      `insert into gov_repo.l14_fact_states(organisation_id,fact_state_id,subject_kind,state_kind,effective_from,recorded_at,governance_decision_id,
        authorization_decision_id,authority_policy_id,authority_policy_version_id,authority_policy_content_hash,trust_state,source_class,support_status)
        values ('${ctx.org}',gen_random_uuid(),'RESPONSIBILITY_ASSIGNMENT','VALIDATED',now(),now(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),repeat('a',64),'VALIDATED','LOCAL_HUMAN','NONE')`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
    for (const statement of [`update gov_repo.l14_fact_states set effective_to=now() where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_responsibility_assignment_states set governance_party_id=gen_random_uuid() where fact_state_id='${a.stateId}'`,
      `delete from gov_repo.l14_responsibility_assignment_proposals where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_fact_states cascade', `delete from gov_repo.l14_responsibility_assignment_heads where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_responsibility_assignment_heads set governance_party_id=gen_random_uuid() where organisation_id='${ctx.org}'`]) {
      await assert.rejects(bootstrapSql(`begin; set local role postgres; ${statement}; rollback;`), /L14_HISTORY_IMMUTABLE/, statement);
    }
  });

  await t.test('structural: no JSON / PII / rationale / score column; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|email|phone|profile|display|directory|user_id|external|label|rationale|note|comment|reason|score|weight|risk|confidence|^status$|approv|cg_|owner_)'`),
    '0', 'no PII / directory / label / rationale / score / legacy owner column');
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
    assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /PARTY|RESPONSIB|OWNER/.test(kind)), 'no PARTY / RESPONSIBILITY kind');
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /OWN|STEWARD|RESPONSIB/.test(type)), 'no OWNS / STEWARD_OF / HAS_OWNER');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, ACL and rows untouched');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid::regclass::text like 'gov_repo.l14\\_%'`), '0', 'no FK to canonical_relationships');
  });

  await t.test('postflight negative controls: every privilege / structure drift class fails it; extension members never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '35|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1c1_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1c1_probe() from public; grant execute on function ${schema}.s1c1_probe() to ${grantee};`;
    const decideBody = (body: string) => `set local role postgres; create or replace function gov_repo.l14_decide_responsibility_assignment_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text,
          p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
          proposal_id uuid, governance_decision_id uuid, target_kind text, target_canonical_object_id text, responsibility_role text,
          governance_party_id uuid, party_validated_state_id uuid, fact_state_id uuid, state_kind text, effective_from timestamptz,
          effective_to timestamptz, recorded_at timestamptz)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ ${body} $$; reset role;`;
    const nulls = `null::boolean, null, null, null, 'DENIED', null, null::uuid, null, null, null, null::uuid, null::uuid, null::uuid, null, null, null,
      null::uuid, null::uuid, null::uuid, null, null::timestamptz, null::timestamptz, null::timestamptz`;
    const controls: Array<[string, string, RegExp]> = [
      // Table privilege classes (direct DML, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), column grants, inherited paths.
      ['service_role direct INSERT on facts', 'grant insert on gov_repo.l14_fact_states to service_role;', /non-owner table grant|holds/],
      ['service_role UPDATE on states', 'grant update on gov_repo.l14_responsibility_assignment_states to service_role;', /non-owner table grant|holds/],
      ['service_role DELETE on proposals', 'grant delete on gov_repo.l14_responsibility_assignment_proposals to service_role;', /non-owner table grant|holds/],
      ['TRUNCATE on heads', 'grant truncate on gov_repo.l14_responsibility_assignment_heads to authenticated;', /non-owner table grant|holds/],
      ['REFERENCES on facts', 'grant references on gov_repo.l14_fact_states to anon;', /non-owner table grant|holds/],
      ['TRIGGER on states', 'grant trigger on gov_repo.l14_responsibility_assignment_states to service_role;', /non-owner table grant|holds/],
      ['MAINTAIN on facts', 'grant maintain on gov_repo.l14_fact_states to service_role;', /non-owner table grant|holds/],
      ['SELECT on a widened framework table', 'grant select on gov_repo.l14_command_results to service_role;', /non-owner table grant|holds/],
      ['column SELECT on states', 'grant select (governance_party_id) on gov_repo.l14_responsibility_assignment_states to authenticated;',
        /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_responsibility_assignment_heads to service_role;',
        /column-level grants|column privilege|holds/],
      ['column UPDATE on the new command-result column', 'grant update (fact_state_id) on gov_repo.l14_command_results to service_role;',
        /column-level grants|column privilege|holds/],
      ['sequence owned by fact history → anon', `set local role postgres; create sequence gov_repo.s1c1_leak owned by gov_repo.l14_fact_states.fact_state_id;
        reset role; grant usage on sequence gov_repo.s1c1_leak to anon;`, /sequence/],
      ['sequence default on fact history → service_role', `set local role postgres; create sequence gov_repo.s1c1_seq;
        alter table gov_repo.l14_responsibility_assignment_heads add column s1c1_n bigint default nextval('gov_repo.s1c1_seq'); reset role;
        grant update on sequence gov_repo.s1c1_seq to service_role;`, /sequence|pinned set/],
      ['readable view over facts → service_role', 'create view public.s1c1_leak as select * from gov_repo.l14_fact_states; grant select on public.s1c1_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1c1_leak as select * from gov_repo.l14_responsibility_assignment_heads;
        create view public.s1c1_leak2 as select * from public.s1c1_leak; grant update on public.s1c1_leak2 to authenticated;`, /view/],
      ['view over states with PUBLIC', 'create view public.s1c1_leak as select * from gov_repo.l14_responsibility_assignment_states; grant select on public.s1c1_leak to public;', /view/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1c1_leak_parent nologin; grant select on gov_repo.l14_responsibility_assignment_proposals to s1c1_leak_parent;
        grant s1c1_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from fact history', 'create table public.s1c1_child () inherits (gov_repo.l14_fact_states);', /inheritance/],
      ['permissive policy on facts', 'create policy s1c1_probe on gov_repo.l14_fact_states for select to service_role using (true);', /RLS policy/],
      ['permissive policy on heads', 'create policy s1c1_probe on gov_repo.l14_responsibility_assignment_heads for all to authenticated using (true) with check (true);', /RLS policy/],
      ['RLS disabled on states', 'alter table gov_repo.l14_responsibility_assignment_states disable row level security;', /RLS-enabled/],
      // Routine EXECUTE classes, unexpected definers, drift.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['unexpected gov_repo definer → service_role', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_submit_responsibility_assignment_proposal_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_submit_responsibility_assignment_proposal_v1(uuid) from public; reset role;`,
      /overload|seventeen S1B\.6 \+ two S1C\.1|ACL\/definer shape/],
      ['member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['same routine once no longer a member', `${memberDefiner} alter extension pgcrypto drop function ${member};`, /CLOSED_SURFACE|not exactly 35/],
      ['decide RPC body drift', decideBody(`select ${nulls}`), /body hash changed/],
      ['decide RPC body reaching a policy store', decideBody(`select ${nulls} from gov_repo.governance_policies limit 0`), /body hash changed|reaches a policy/],
      ['decide RPC body reaching Party PII', decideBody(`select ${nulls} from gov_repo.governance_party_directory_profiles limit 0`), /body hash changed|PII/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC owner drift', `create role s1c1_owner nologin; alter function ${NEW_RPCS[1]} owner to s1c1_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['helper made service_role-executable', `grant execute on function ${NEW_HELPERS[7]} to service_role;`, /owner-only SECURITY INVOKER|seventeen S1B\.6 \+ two S1C\.1/],
      ['read primitive made authenticated-executable', `grant execute on function ${NEW_HELPERS[8]} to authenticated;`, /executable by authenticated|owner-only/],
      ['helper made SECURITY DEFINER', `alter function ${NEW_HELPERS[0]} security definer;`, /owner-only SECURITY INVOKER/],
      ['helper search_path drift', `alter function ${NEW_HELPERS[5]} set search_path = public, pg_temp;`, /search_path not pinned/],
      ['RPC executable by anon', `grant execute on function ${NEW_RPCS[0]} to anon;`, /executable by anon|not exactly service_role/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[1]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['RPC executable by PUBLIC', `grant execute on function ${NEW_RPCS[0]} to public;`, /PUBLIC EXECUTE|not exactly service_role|ACL/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[1]} from service_role;`, /ACL\/definer shape|seventeen S1B\.6|not exactly service_role/],
      // Immutability / structural guards.
      ['fact immutability trigger removed', 'drop trigger l14_fact_states_immutable on gov_repo.l14_fact_states;', /lacks ALWAYS raising/],
      ['state immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_responsibility_assignment_states enable trigger l14_responsibility_assignment_states_immutable;',
        /lacks ALWAYS raising/],
      ['proposal TRUNCATE trigger disabled', 'alter table gov_repo.l14_responsibility_assignment_proposals disable trigger l14_responsibility_assignment_proposals_no_truncate;',
        /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_responsibility_assignment_heads disable trigger l14_responsibility_assignment_heads_guard;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_responsibility_assignment_states disable trigger l14_responsibility_assignment_states_guard;', /structural guard/],
      ['proposal source guard disabled', 'alter table gov_repo.l14_responsibility_assignment_proposals disable trigger l14_responsibility_assignment_proposals_guard;',
        /structural guard/],
      // Fact-state FK weakening.
      ['fact envelope FK dropped', 'alter table gov_repo.l14_responsibility_assignment_states drop constraint l14_responsibility_assignment_states_envelope_fkey;', /FK set wrong/],
      ['party dependency FK dropped', 'alter table gov_repo.l14_responsibility_assignment_states drop constraint l14_responsibility_assignment_states_party_fkey;', /FK set wrong/],
      ['fact decision FK made NOT VALID', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_decision_fkey;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_decision_fkey foreign key (organisation_id, governance_decision_id, subject_kind,
          decision_outcome, authorization_decision_id) references gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome,
          authorization_decision_id) not valid;`, /FK set wrong/],
      ['target FK made deferrable', `alter table gov_repo.l14_responsibility_assignment_states drop constraint l14_responsibility_assignment_states_target_fkey;
        alter table gov_repo.l14_responsibility_assignment_states add constraint l14_responsibility_assignment_states_target_fkey foreign key
          (organisation_id, target_canonical_object_id, target_kind) references gov_repo.canonical_objects (organisation_id, canonical_object_id, kind)
          on update restrict on delete restrict deferrable initially deferred;`, /FK set wrong/],
      ['cascading FK into fact history', `create table public.s1c1_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_fact_states (organisation_id, fact_state_id) on delete cascade);`,
        /cascading/],
      ['command-result fact FK dropped', 'alter table gov_repo.l14_command_results drop constraint l14_command_results_fact_state_fkey;', /FK set wrong/],
      ['support-link fact FK dropped', 'alter table gov_repo.l14_support_links drop constraint l14_support_links_fact_state_fkey;', /FK set wrong/],
      ['extra FK on a new table', `alter table gov_repo.l14_responsibility_assignment_heads add constraint l14_responsibility_assignment_heads_probe_fkey foreign key (organisation_id)
        references gov_repo.organisations (organisation_id);`, /FK set wrong/],
      ['lineage root index dropped', 'drop index gov_repo.l14_responsibility_assignment_states_root_uidx;', /lineage keys missing/],
      ['revocation-target index dropped', 'drop index gov_repo.l14_fact_states_revocation_target_uidx;', /lineage keys missing/],
      // Target / role CHECK relaxation; PII / JSON / score columns.
      ['target kind CHECK relaxed', `alter table gov_repo.l14_responsibility_assignment_states drop constraint l14_responsibility_assignment_states_target_kind_check;
        alter table gov_repo.l14_responsibility_assignment_states add constraint l14_responsibility_assignment_states_target_kind_check check
          (target_kind in ('AGENT','AGENT_VERSION','DATA_ASSET','DATA_ELEMENT'));`, /matrix|relaxed/],
      ['role CHECK relaxed', `alter table gov_repo.l14_responsibility_assignment_proposals drop constraint l14_responsibility_assignment_proposa_responsibility_role_check;
        alter table gov_repo.l14_responsibility_assignment_proposals add constraint l14_responsibility_assignment_proposa_responsibility_role_check check
          (responsibility_role in ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER','DATA_STEWARD','OWNER'));`, /matrix|relaxed/],
      ['matrix CHECK relaxed', `alter table gov_repo.l14_responsibility_assignment_states drop constraint l14_responsibility_assignment_states_matrix_check;
        alter table gov_repo.l14_responsibility_assignment_states add constraint l14_responsibility_assignment_states_matrix_check check
          (target_kind in ('AGENT','DATA_ASSET','DATA_ELEMENT'));`, /matrix|relaxed/],
      ['matrix CHECK dropped', 'alter table gov_repo.l14_responsibility_assignment_proposals drop constraint l14_responsibility_assignment_proposals_matrix_check;', /matrix|relaxed/],
      ['fact interval CHECK relaxed', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_interval_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_interval_check check (effective_to is null or effective_to >= effective_from);`, /relaxed/],
      ['fact subject CHECK widened', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','POLICY_APPLICABILITY'));`,
      /relaxed/],
      ['authorization responsibility-target CHECK dropped', 'alter table gov_repo.l14_authorization_decisions drop constraint l14_authorization_decisions_responsibility_target_check;',
        /relaxed/],
      ['PII column on states', `alter table gov_repo.l14_responsibility_assignment_states add column owner_email text check (length(owner_email) < 320);`, /pinned set/],
      ['free-text rationale on proposals', `alter table gov_repo.l14_responsibility_assignment_proposals add column rationale text check (length(rationale) < 10);`, /pinned set/],
      ['JSON metadata column', 'alter table gov_repo.l14_fact_states add column metadata jsonb;', /JSON column/],
      // Frozen enumerations and F2.
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','GOVERNANCE_PARTY')) not valid;`, /canonical object kinds \(11\)/],
      ['relationship type added', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP',
          'INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','OWNS')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1C.1 routine attached to canonical_relationships', `create trigger s1c1_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_responsibility_assignment_head_guard_v1();`, /F2 boundary/],
      ['unpinned extra column on the head', `alter table gov_repo.l14_responsibility_assignment_heads add column rel_id text check (length(rel_id) < 2);`,
        /pinned set/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1C1_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    // An FK from an l14 table to canonical_relationships is caught by the F2 rule itself (independent of column shape).
    await assert.rejects(inTxn(`alter table gov_repo.l14_support_links add column s1c1_rel text;
      alter table gov_repo.l14_support_links add constraint l14_support_links_s1c1_rel_fkey foreign key (s1c1_rel)
        references gov_repo.canonical_relationships (relationship_id);`), /M16_S1C1_POSTFLIGHT: F2 boundary violated/);
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '35|1', 'a genuine pgcrypto member is excluded');
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '35|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1c1_probe'`), '0');
    await owner(block);
  });

  await t.test('the new SQL never reaches policy / registry stores, Party PII, legacy owner fields, canonical relationships or other fact families', async () => {
    // The bodies come back as ONE single-line JSON value (never a multi-line text result through lastLine), so the scan
    // provably covers every targeted routine body in full.
    const bodies = JSON.parse(await one(`select json_object_agg(oid::regprocedure::text, prosrc) from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`)) as Record<string, string>;
    assert.deepEqual(Object.keys(bodies).sort(), [...NEW_RPCS, ...NEW_HELPERS].sort(),
      'every targeted routine body was collected');
    const sources = Object.values(bodies).join('\n----\n');
    // Positive sanity: known content of several distinct targeted routines is present in the scanned corpus.
    for (const known of ['RESPONSIBILITY_SINGLE_OWNER_CONFLICT', 'RESPONSIBILITY_PROPOSAL_SOURCE_INVALID', 'l14-fact-subject-guard-v1',
      'NO_MATCHING_AUTHORITY_RULE', 'l14_governance_party_valid_state_v1', 'l14_responsibility_assignment_heads:LINEAGE']) {
      assert.ok(sources.includes(known), `scanned corpus contains ${known}`);
    }
    assert.ok(sources.split('\n').length > 300, 'the full multi-line corpus is scanned, not a tail');
    for (const forbidden of [/governance_policies/, /policy_versions/, /l14_policy_/, /l14_control_definition/, /l14_domain_/, /current_version_id/,
      /directory_profile/, /display_name/, /\bemail\b/i, /\bphone\b/i, /profile_text/, /governance_users/, /owner_user_id/, /owner_email/,
      /canonical_relationships/, /semantic_representation/, /APPLICABILITY/, /BUSINESS_CONTEXT/, /ASSESSMENT/, /\bcg_/i, /CG-AG/i,
      /gov_repo\.agents\b/, /agent_resource_links/, /ai_systems/, /\brisk/i, /\bscore/i, /confidence/i, /\bstatus\b/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_governance_part|l14_authority_policy|l14_registry_states|governance_users|governance_roles|organisations|discovery_evidence|canonical_objects)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
  });
});
