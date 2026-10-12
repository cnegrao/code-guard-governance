import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14ControlAssessmentMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { policyApplicabilityKit } from '../helpers/m16-l14-policy-applicability-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';

/**
 * M16-S1C.5 — privilege closure, preflight, postflight negative controls (one per privilege / structure class) and structural
 * invariants on real disposable PostgreSQL 17. The S1C5 horizon is stopped right before the S1C.5 migration so the suite can
 * seed real S1C.1 / S1C.3 / S1C.4 history, snapshot the post-S1C.4 catalog, prove the preflight aborts atomically, then apply
 * the migration itself. Every control runs inside a rolled-back bootstrap transaction; historical postflights are never altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_submit_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_control_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const DEP_GUARD = 'gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(uuid,text,uuid)';
const RESOLVER = 'gov_repo.l14_control_assessment_valid_state_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)';
const CURRENT = 'gov_repo.l14_control_assessments_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)';
const NEW_HELPERS = [
  'gov_repo.l14_control_assessment_proposal_guard_v1()', 'gov_repo.l14_control_assessment_state_guard_v1()',
  'gov_repo.l14_control_assessment_head_guard_v1()', DEP_GUARD, 'gov_repo.l14_control_assessment_command_result_v1(uuid,text,boolean)',
  RESOLVER, CURRENT,
] as const;
const FACT_GUARD = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])';
const NEW_TABLES = ['gov_repo.l14_control_assessment_states', 'gov_repo.l14_control_assessment_proposals',
  'gov_repo.l14_control_assessment_heads'] as const;
/** The four framework tables S1C.5 widens (closed CHECKs only); their rows are never rewritten. */
const WIDENED = ['l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results', 'l14_fact_states'] as const;
const postflight = () => {
  const text = migrationSource(l14ControlAssessmentMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1C5_POSTFLIGHT'));
  return block;
};
const SURFACE_SPLIT_SQL = `select count(*) filter (where not m) || '|' || count(*) filter (where m) from (
  select exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') as m
  from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
    and (exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))) s;`;
/** Structural digest of canonical_relationships (columns, constraints, indexes, triggers, rules, policies, ACL, rows). */
const F2_DIGEST = `select md5(concat_ws('|',
  (select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid='gov_repo.canonical_relationships'::regclass and attnum>0 and not attisdropped),
  (select string_agg(conname||':'||pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid='gov_repo.canonical_relationships'::regclass or confrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(indexrelid::regclass::text||':'||pg_get_indexdef(indexrelid), ',' order by indexrelid::regclass::text) from pg_index where indrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(tgname||':'||tgenabled::text||':'||tgfoid::regprocedure::text, ',' order by tgname) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass),
  (select string_agg(rulename||':'||definition, ',' order by rulename) from pg_rules where schemaname='gov_repo' and tablename='canonical_relationships'),
  (select string_agg(polname||':'||polcmd::text, ',' order by polname) from pg_policy where polrelid='gov_repo.canonical_relationships'::regclass),
  (select relacl::text from pg_class where oid='gov_repo.canonical_relationships'::regclass),
  (select md5(string_agg(t::text, '|' order by relationship_id)) from gov_repo.canonical_relationships t)));`;
/** Every pre-S1C.5 routine body + config + ACL in gov_repo (incl. every S1C.4 routine: resolver, current read, encoder, guards),
 *  except the one widened fact guard (S1C.5 replaces nothing else). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%control\\_assessment%'
    and proname not in ('l14_lock_fact_subject_guard_v1','l14_lock_control_applicability_dependency_guard_shared_v1')`;
/** Every pre-S1C.5 gov_repo table definition (incl. ALL S1C.4 tables) except the four widened framework tables and the new tables. */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(indexrelid::regclass::text, ',' order by indexrelid::regclass::text) from pg_index where indrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')
  and c.relname not like 'l14\\_control\\_assessment%'
  and c.relname not in (${WIDENED.map(t => `'${t}'`).join(',')})`;
/** Every existing row of the widened framework tables and every S1B.6 / S1C.1 / S1C.3 / S1C.4 history row (never rewritten). */
const HISTORY = [...WIDENED, 'l14_registry_states', 'l14_control_definitions', 'l14_control_definition_versions', 'l14_control_definition_states',
  'l14_control_definition_proposals', 'l14_control_definition_heads', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_proposals',
  'l14_responsibility_assignment_heads', 'l14_policy_applicability_states', 'l14_policy_applicability_proposals', 'l14_policy_applicability_heads',
  'l14_control_applicability_states', 'l14_control_applicability_proposals', 'l14_control_applicability_heads', 'l14_support_links'];
const ROWS_DIGEST = `select md5(string_agg(x, '|' order by x)) from (${HISTORY.map(t =>
  `select '${t}:'||to_jsonb(t)::text as x from gov_repo.${t} t`).join(' union all ')}) s`;
/** Every pre-existing constraint definition of the widened tables except the closed CHECKs S1C.5 re-states / adds. */
const WIDENED_CONSTRAINTS = `select md5(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in (${WIDENED.map(t => `'gov_repo.${t}'::regclass`).join(',')})
  and conname not in ('l14_governance_decisions_subject_kind_check','l14_governance_decisions_reason_code_check','l14_command_results_subject_kind_check',
    'l14_command_results_shape_check','l14_fact_states_subject_kind_check','l14_authorization_decisions_control_assessment_target_check')`;

test('M16 S1C.5 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 3_000_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C5', stopBefore: l14ControlAssessmentMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Real pre-S1C.5 history: an S1C.1 responsibility lifecycle, an S1C.3 policy applicability and an S1C.4 control applicability
  // lifecycle (APPLIES, DOES_NOT_APPLY, REVOKED). The widened framework must keep every row byte-identical and every command replayable.
  const rk = await responsibilityKit(c);
  const hist = await rk.setup();
  const histParty = await rk.party(hist, 'hist');
  const histKey = rk.keyOf('AGENT', hist.objects.agent, 'BUSINESS_OWNER', histParty.partyId);
  const histAssign = await rk.assign(hist, 'hist', histKey, histParty);
  const histRevoke = await rk.revoke(hist, 'hist', histKey, histParty.stateId, histAssign.stateId);
  assert.equal(histRevoke.decided.outcome, 'REVOKED');
  const pk = await policyApplicabilityKit(c);
  const pactx = await pk.setup();
  const histPolicy = await pk.apply(pactx, 'hist-pa', pk.objectTarget('AGENT', pactx.objects.byKind.AGENT), await pk.policy(pactx, 'hist-pa-pol'));
  assert.equal(histPolicy.decided.outcome, 'VALIDATED');
  const ck = await controlApplicabilityKit(c);
  const cctx = await ck.setup();
  const histPin = await ck.control(cctx, 'hist-cd');
  const histTarget = ck.objectTarget('AGENT', cctx.objects.byKind.AGENT);
  const histApplies = await ck.apply(cctx, 'hist-ca', histTarget, histPin);
  const histDna = await ck.apply(cctx, 'hist-ca-dna', ck.objectTarget('MODEL', cctx.objects.byKind.MODEL), histPin, { applicability: 'DOES_NOT_APPLY' });
  const histRvTarget = ck.objectTarget('TOOL', cctx.objects.byKind.TOOL);
  const histRv = await ck.apply(cctx, 'hist-ca-rv', histRvTarget, histPin);
  await ck.revoke(cctx, 'hist-ca-rv', histRvTarget, histPin, histRv.stateId);
  // Assessment roles only (support rows); no CONTROL_ASSESSMENT object exists before the migration.
  const k = await controlAssessmentKit(c, ck);
  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const rowsBefore = await one(ROWS_DIGEST);
  const constraintsBefore = await one(WIDENED_CONSTRAINTS);
  const factGuardBefore = await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
    from pg_proc where oid='${FACT_GUARD}'::regprocedure`);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 41, 'the post-S1C.4 application definer surface is 41');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 31, 'the post-S1C.4 canonical-owner (policy-store-capable) class is 31');

  await t.test('preflight: the exact post-S1C.4 catalog is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_control_assessment_states')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%control\\_assessment%'
        or proname = 'l14_lock_control_applicability_dependency_guard_shared_v1'`), '0');
      assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_fact_states_subject_kind_check'`),
        "CHECK ((subject_kind = ANY (ARRAY['RESPONSIBILITY_ASSIGNMENT'::text, 'BUSINESS_CONTEXT_ASSIGNMENT'::text, 'POLICY_APPLICABILITY'::text, 'CONTROL_APPLICABILITY'::text])))");
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
      assert.equal(await one(ROWS_DIGEST), rowsBefore);
    };
    const caDecide = 'gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1c5_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1c5_probe() to service_role`, 'drop function public.s1c5_probe()', /not exactly the 41 post-S1C\.4 baseline/],
      ['S1C.4 decide config drift', `alter function ${caDecide} set lock_timeout = '6s'`, `alter function ${caDecide} set lock_timeout = '5s'`,
        /differs from its post-S1C\.4 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
      ['S1C.4 horizon absent', 'alter table gov_repo.l14_control_applicability_heads rename to l14_control_applicability_heads_x',
        'alter table gov_repo.l14_control_applicability_heads_x rename to l14_control_applicability_heads', /unexpected l14 relation set/],
      ['S1C.4 pin key absent', `alter table gov_repo.l14_control_applicability_states rename constraint l14_control_applicability_states_kind_unique to l14_control_applicability_states_kind_unique_x`,
        `alter table gov_repo.l14_control_applicability_states rename constraint l14_control_applicability_states_kind_unique_x to l14_control_applicability_states_kind_unique`,
        /keys missing or already widened/],
      ['S1C.4 resolver absent', `alter function gov_repo.l14_control_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz) rename to l14_control_applicability_valid_state_x`,
        `alter function gov_repo.l14_control_applicability_valid_state_x(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz) rename to l14_control_applicability_valid_state_v1`,
        /keys missing or already widened/],
      ['fact envelope already widened', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT'))`,
      `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY'))`,
      /keys missing or already widened/],
      ['a finding relation pre-exists', 'create table gov_repo.l14_control_findings_x (id int)', 'drop table gov_repo.l14_control_findings_x',
        /unexpected l14 relation set|S1C\.5 object already exists/],
    ] as const) {
      await bootstrapSql(`set role postgres; ${brk}`);
      try {
        await assert.rejects(c.migrate(l14ControlAssessmentMigration), (error: Error) => {
          assert.match(error.message, /M16_S1C5_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(`set role postgres; ${fix}`); }
      await notApplied();
    }
    const text = migrationSource(l14ControlAssessmentMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${hist.org}',gen_random_uuid(),'CONTROL_ASSESSMENT','VALIDATE','LOCAL_HUMAN',
      '${hist.member.id}','NONE',now()); ${pre} rollback;`), /M16_S1C5_PREFLIGHT: control assessment governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly; historical shapes / rows / routines (incl. every S1C.4 object) are untouched', async () => {
    await c.migrate(l14ControlAssessmentMigration);
    await assert.rejects(c.migrate(l14ControlAssessmentMigration), /M16_S1C5_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1C.5 gov_repo routine body / config / ACL is byte-identical (except the widened fact guard)');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no other pre-S1C.5 gov_repo table (incl. every S1C.4 table, index and constraint) is altered');
    assert.equal(await one(ROWS_DIGEST), rowsBefore, 'every historical row is unchanged (no rewrite, no backfill)');
    assert.equal(await one(WIDENED_CONSTRAINTS), constraintsBefore, 'every other constraint of the widened tables is unchanged');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, indexes, rules, ACL and rows untouched');
    assert.equal(await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
      from pg_proc where oid='${FACT_GUARD}'::regprocedure`), factGuardBefore);
    // Historical commands still replay their ORIGINAL durable result after the widening.
    const replayed = await c.exec(rk.decideSql(hist.rs, { commandId: hist.cmd('hist-revoke'), proposalId: histRevoke.submitted.proposal_id,
      proposal: histRevoke.proposal, outcome: 'REVOKE', expected: histAssign.stateId }));
    assert.deepEqual([replayed.replay, replayed.fact_state_id, replayed.recorded_at], [true, histRevoke.decided.fact_state_id, histRevoke.decided.recorded_at]);
    const paReplay = await c.exec(pk.decideSqlFor(pactx.ps, pactx.cmd('hist-pa-validate'), histPolicy.submitted.proposal_id, histPolicy.proposal,
      'VALIDATE', null));
    assert.deepEqual([paReplay.replay, paReplay.fact_state_id], [true, histPolicy.stateId]);
    const caReplay = await c.exec(ck.decideSqlFor(cctx.cs, cctx.cmd('hist-ca-validate'), histApplies.submitted.proposal_id, histApplies.proposal,
      'VALIDATE', null));
    assert.deepEqual([caReplay.replay, caReplay.fact_state_id], [true, histApplies.stateId], 'the S1C.4 command still replays its original result');
    // The first assessment on the new catalog pins the pre-existing S1C.4 APPLIES state; the DOES_NOT_APPLY one never qualifies.
    const x = await k.setup();
    const xApplies = await k.applicability(x, 'post', ck.objectTarget('AGENT', x.objects.byKind.AGENT));
    assert.equal((await k.assess(x, 'post', xApplies.stateId)).decided.outcome, 'VALIDATED');
    await c.rejects(c.svc(k.submitSql(cctx.member, { commandId: cctx.cmd('post-dna'), proposal: k.validateProposal(histDna.stateId) })), 'GV010',
      /CONTROL_APPLICABILITY_DOES_NOT_APPLY/);
  });

  await t.test('definer surface 41 -> 43 / canonical-owner class 31 -> 33: the 41 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the two new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 43);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 33);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '43|0');
    const postBlock = postflight();
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
      assert.equal(await one(`select count(*) from pg_depend where classid='pg_proc'::regclass and objid='${sig}'::regprocedure
        and refclassid='pg_class'::regclass and refobjid in ('gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass)`), '0', sig);
    }
    for (const sig of [...NEW_HELPERS, FACT_GUARD]) {
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
      for (const table of [...WIDENED, 'l14_control_applicability_states', 'l14_control_applicability_heads', 'governance_policies', 'policy_versions']) {
        await assert.rejects(c.sql(`update gov_repo.${table} set organisation_id=organisation_id`, role), /42501|permission denied/, `${role}: ${table}`);
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of NEW_RPCS) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_control_assessment_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'CONTROL_ASSESSMENT_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS, FACT_GUARD].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the two new RPCs');
    for (const [name, call] of [
      ['resolver', `select * from gov_repo.l14_control_assessment_valid_state_v1(gen_random_uuid(), gen_random_uuid(), now(), now())`],
      ['current read', `select * from gov_repo.l14_control_assessments_current_v1(gen_random_uuid(), 'CANONICAL_OBJECT', 'AGENT', 'x', null, null, now(), now())`],
      ['result projection', `select * from gov_repo.l14_control_assessment_command_result_v1(gen_random_uuid(), 'x', false)`],
      ['shared applicability dependency guard', `select gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(gen_random_uuid(), 'k', gen_random_uuid())`],
      ['fact guard', `select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), 'CONTROL_ASSESSMENT', array['KEY','x'])`],
      ['S1C.4 resolver (reused)', `select * from gov_repo.l14_control_applicability_valid_state_v1(gen_random_uuid(), 'CANONICAL_OBJECT', 'AGENT', 'x', null, null, gen_random_uuid(), now(), now())`],
    ] as const) {
      await assert.rejects(c.sql(call, 'service_role'), /42501|permission denied/, `${name} is owner-only`);
    }
    for (const table of NEW_TABLES) {
      assert.equal(await one(`select coalesce(relacl::text,'-')||'|'||relrowsecurity::text||'|'||(select count(*) from pg_policy where polrelid='${table}'::regclass)
        from pg_class where oid='${table}'::regclass`), '{postgres=arwdDxtm/postgres}|true|0', `${table}: owner-only ACL, RLS on, no policy`);
      assert.equal(await one(`select count(*) from pg_attribute where attrelid='${table}'::regclass and attacl is not null`), '0', `${table}: no column grant`);
    }
  });

  await t.test('service_role cannot mutate history directly; immutable history raises for the owner too; the head is RPC-only', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'acl', ck.relTarget(x.rels.reads));
    const a = await k.assess(x, 'acl', applies.stateId);
    for (const statement of [`update gov_repo.l14_control_assessment_heads set latest_state_id=null`,
      `update gov_repo.l14_control_assessment_states set assessment_outcome='NOT_SATISFIED'`,
      `insert into gov_repo.l14_control_assessment_heads(organisation_id,control_applicability_state_id) values ('${x.org}','${applies.stateId}')`,
      `delete from gov_repo.l14_control_assessment_proposals`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
    for (const statement of [`update gov_repo.l14_fact_states set effective_to=now() + interval '1 year' where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_control_assessment_states set assessment_outcome='NOT_SATISFIED' where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_control_assessment_states set control_applicability_state_id=gen_random_uuid() where fact_state_id='${a.stateId}'`,
      `delete from gov_repo.l14_control_assessment_proposals where organisation_id='${x.org}'`,
      'truncate gov_repo.l14_control_assessment_states cascade',
      `delete from gov_repo.l14_control_assessment_heads where organisation_id='${x.org}'`,
      `update gov_repo.l14_control_assessment_heads set control_applicability_state_id=gen_random_uuid() where organisation_id='${x.org}'`,
      `update gov_repo.l14_control_assessment_heads set latest_state_id=null where organisation_id='${x.org}'`,
      // The assessed applicability history stays immutable too.
      `update gov_repo.l14_control_applicability_states set applicability='DOES_NOT_APPLY' where fact_state_id='${applies.stateId}'`]) {
      await assert.rejects(bootstrapSql(`begin; set local role postgres; ${statement}; rollback;`), /L14_HISTORY_IMMUTABLE|violates/, statement);
    }
  });

  await t.test('structural: no JSON / rationale / score / waiver / finding column; head key = applicability state; 11 kinds + 12 types; F2 untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|label|descr|title|control_code|path|source_system|tag|category|classif|rationale|note|comment|reason|score|weight|risk|confidence|similar|^status$|approv|cg_|owner|party|email|metadata|current_version|relationship_type|coverage|maturity|severity|waiv|finding|exception|residual|^valid_until$|^effective_to$|target_type)'`),
    '0', 'no label / code / rationale / score / waiver / finding / second end-date / caller target column');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL|ASSESS|SATISF|FINDING/.test(type)));
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid::regclass::text like 'gov_repo.l14\\_%'`), '0', 'no FK to canonical_relationships');
    assert.equal(await one(`select string_agg(a.attname, ',' order by k.ord) from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(n, ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n where c.conrelid='gov_repo.l14_control_assessment_heads'::regclass and c.contype='p'`),
    'organisation_id,control_applicability_state_id', 'the head key is exactly organisation + applicability state');
    assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_control_assessment_states_applicability_fkey'`),
      'FOREIGN KEY (organisation_id, control_applicability_state_id, applicability_target_key, control_definition_id, control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, applicability_state_kind) REFERENCES gov_repo.l14_control_applicability_states(organisation_id, fact_state_id, target_key, control_definition_id, control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, state_kind) ON UPDATE RESTRICT ON DELETE RESTRICT');
  });

  await t.test('postflight negative controls: every privilege / structure / guard / dependency-lock / vocabulary / F2 drift class fails it', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '43|0', 'baseline passes');
    const f2Snapshot = await one(F2_DIGEST);
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1c5_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1c5_probe() from public; grant execute on function ${schema}.s1c5_probe() to ${grantee};`;
    const depGuard = (lock: string, key: string) => `set local role postgres; create or replace function gov_repo.l14_lock_control_applicability_dependency_guard_shared_v1(
        p_organisation_id uuid, p_target_key text, p_control_definition_id uuid) returns void language plpgsql volatile
        set search_path = pg_catalog, pg_temp as $g$ begin
        perform pg_catalog.${lock}(pg_catalog.hashtextextended(gov_repo.frame_identity(${key}), 0)); end $g$; reset role;`;
    const exactKey = `ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY', p_target_key, p_control_definition_id::text]`;
    const guardBody = (subjects: string) => `set local role postgres; create or replace function gov_repo.l14_lock_fact_subject_guard_v1(p_organisation_id uuid,
        p_subject_kind text, p_key_parts text[]) returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
        if p_subject_kind not in (${subjects}) then raise exception 'x'; end if;
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(gov_repo.frame_identity(ARRAY[p_organisation_id::text,
          'l14-fact-subject-guard-v1', p_subject_kind] || p_key_parts), 0)); end $g$; reset role;`;
    const decideSrc = await owner(`select prosrc from pg_proc where oid='${NEW_RPCS[1]}'::regprocedure`);
    const submitSrc = await owner(`select prosrc from pg_proc where oid='${NEW_RPCS[0]}'::regprocedure`);
    const decideReplace = (body: string) => `set local role postgres; create or replace function gov_repo.l14_decide_control_assessment_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text,
          p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
          proposal_id uuid, governance_decision_id uuid, control_applicability_state_id uuid, control_definition_id uuid,
          control_definition_version_id uuid, content_hash text, assessment_outcome text, fact_state_id uuid, state_kind text,
          predecessor_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz)
        language plpgsql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $body$${body}$body$; reset role;`;
    const submitReplace = (body: string) => `set local role postgres; create or replace function gov_repo.l14_submit_control_assessment_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_intent text, p_source_class text, p_control_applicability_state_id uuid,
          p_assessment_outcome text, p_requested_effective_from timestamptz, p_requested_valid_until timestamptz, p_target_state_id uuid,
          p_prior_proposal_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
          proposal_id uuid, governance_decision_id uuid, control_applicability_state_id uuid, control_definition_id uuid,
          control_definition_version_id uuid, content_hash text, assessment_outcome text, fact_state_id uuid, state_kind text,
          predecessor_state_id uuid, effective_from timestamptz, valid_until timestamptz, recorded_at timestamptz)
        language plpgsql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $body$${body}$body$; reset role;`;
    const noAppGuard = decideSrc.replace(/\n\s+PERFORM gov_repo\.l14_lock_control_applicability_dependency_guard_shared_v1\([^;]+;/, '');
    assert.notEqual(noAppGuard, decideSrc, 'the guard removal probe really removes the applicability guard call');
    const factGuardCall = /  PERFORM gov_repo\.l14_lock_fact_subject_guard_v1\(v_org, 'CONTROL_ASSESSMENT',\n[^;]+;\n/.exec(decideSrc)?.[0] ?? '';
    assert.ok(factGuardCall.length > 0, 'the fact guard call is located');
    const inverted = decideSrc.replace(factGuardCall, '').replace("  IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(",
      `${factGuardCall}  IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(`);
    assert.notEqual(inverted, decideSrc, 'the lock order inversion probe really reorders the guards');
    const noWaiverRefusal = submitSrc.replace(/  IF p_assessment_outcome = 'WAIVED' THEN\n[^\n]+\n  END IF;\n/, '');
    assert.notEqual(noWaiverRefusal, submitSrc, 'the WAIVED refusal removal probe really removes it');
    const outcomes = (table: string, list: string) => `alter table gov_repo.${table} drop constraint ${table}_assessment_outcome_check;
      alter table gov_repo.${table} add constraint ${table}_assessment_outcome_check check (assessment_outcome in (${list}));`;
    const controls: Array<[string, string, RegExp]> = [
      // Table privilege classes, column grants, sequence leak, inherited paths.
      ['service_role direct INSERT on states', 'grant insert on gov_repo.l14_control_assessment_states to service_role;', /non-owner table grant|holds/],
      ['service_role SELECT on states', 'grant select on gov_repo.l14_control_assessment_states to service_role;', /non-owner table grant|holds/],
      ['service_role UPDATE on heads', 'grant update on gov_repo.l14_control_assessment_heads to service_role;', /non-owner table grant|holds/],
      ['service_role DELETE on proposals', 'grant delete on gov_repo.l14_control_assessment_proposals to service_role;', /non-owner table grant|holds/],
      ['TRUNCATE on states', 'grant truncate on gov_repo.l14_control_assessment_states to authenticated;', /non-owner table grant|holds/],
      ['REFERENCES on states', 'grant references on gov_repo.l14_control_assessment_states to anon;', /non-owner table grant|holds/],
      ['TRIGGER on proposals', 'grant trigger on gov_repo.l14_control_assessment_proposals to service_role;', /non-owner table grant|holds/],
      ['MAINTAIN on heads', 'grant maintain on gov_repo.l14_control_assessment_heads to service_role;', /non-owner table grant|holds/],
      ['service_role SELECT on the assessed applicability history', 'grant select on gov_repo.l14_control_applicability_states to service_role;', /non-owner table grant|holds/],
      ['column SELECT on states', 'grant select (assessment_outcome) on gov_repo.l14_control_assessment_states to authenticated;', /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_control_assessment_heads to service_role;', /column-level grants|column privilege|holds/],
      ['sequence owned by assessment history → anon', `set local role postgres; create sequence gov_repo.s1c5_leak owned by gov_repo.l14_control_assessment_states.fact_state_id;
        reset role; grant usage on sequence gov_repo.s1c5_leak to anon;`, /sequence/],
      ['readable view over states → service_role', 'create view public.s1c5_leak as select * from gov_repo.l14_control_assessment_states; grant select on public.s1c5_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1c5_leak as select * from gov_repo.l14_control_assessment_heads;
        create view public.s1c5_leak2 as select * from public.s1c5_leak; grant update on public.s1c5_leak2 to authenticated;`, /view/],
      ['gov_repo table default → service_role re-grants a new table', `alter default privileges for role postgres in schema gov_repo grant all on tables to service_role;
        set local role postgres; create table gov_repo.l14_control_assessment_probe (organisation_id uuid); reset role;`, /unexpected l14 relation set|non-owner table grant|holds/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1c5_leak_parent nologin; grant select on gov_repo.l14_control_assessment_proposals to s1c5_leak_parent;
        grant s1c5_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from assessment history', 'create table public.s1c5_child () inherits (gov_repo.l14_control_assessment_states);', /inheritance/],
      ['permissive policy on states', 'create policy s1c5_probe on gov_repo.l14_control_assessment_states for select to service_role using (true);', /RLS policy/],
      ['RLS disabled on proposals', 'alter table gov_repo.l14_control_assessment_proposals disable row level security;', /RLS-enabled/],
      // Routine EXECUTE classes, unexpected definers, drift.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['unexpected gov_repo definer → service_role', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_submit_control_assessment_proposal_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_submit_control_assessment_proposal_v1(uuid) from public; reset role;`,
      /overload|twenty-five post-S1C\.4 \+ two S1C\.5|ACL\/definer shape/],
      ['decide RPC body drift', decideReplace(decideSrc.replace('CONTROL_ASSESSMENT_ALREADY_VALIDATED', 'CONTROL_ASSESSMENT_ALREADY_VALIDATED_X')), /body hash changed/],
      ['decide no longer takes the applicability dependency guard', decideReplace(noAppGuard), /lock order drifted|body hash changed/],
      ['decide lock order inverted (assessment KEY before the dependency guards)', decideReplace(inverted), /lock order drifted|body hash changed/],
      ['submit no longer refuses WAIVED explicitly', submitReplace(noWaiverRefusal), /WAIVED refusal drifted|body hash changed/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC lock_timeout drift', `alter function ${NEW_RPCS[1]} set lock_timeout = '60s';`, /config changed/],
      ['RPC owner drift', `create role s1c5_owner nologin; alter function ${NEW_RPCS[1]} owner to s1c5_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['RPC made SECURITY INVOKER', `alter function ${NEW_RPCS[0]} security invoker;`, /ACL\/definer shape|not SECURITY DEFINER|not exactly 43/],
      ['unexpected SECURITY DEFINER helper (resolver)', `alter function ${RESOLVER} security definer;`, /owner-only SECURITY INVOKER/],
      ['resolver made service_role-executable', `grant execute on function ${RESOLVER} to service_role;`, /owner-only SECURITY INVOKER|twenty-five/],
      ['current read made authenticated-executable', `grant execute on function ${CURRENT} to authenticated;`, /executable by authenticated|owner-only/],
      ['state guard made service_role-executable', `grant execute on function gov_repo.l14_control_assessment_state_guard_v1() to service_role;`,
        /owner-only SECURITY INVOKER|twenty-five/],
      ['helper search_path drift', `alter function ${RESOLVER} set search_path = public, pg_temp;`, /search_path not pinned/],
      ['RPC executable by PUBLIC', `grant execute on function ${NEW_RPCS[0]} to public;`, /PUBLIC EXECUTE|not exactly service_role|ACL/],
      ['RPC executable by anon', `grant execute on function ${NEW_RPCS[0]} to anon;`, /executable by anon|not exactly service_role/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[1]} from service_role;`, /ACL\/definer shape|twenty-five|not exactly service_role/],
      // Applicability dependency guard: mode, namespace, key, executability; the S1C.4 key producers.
      ['dependency guard made EXCLUSIVE', depGuard('pg_advisory_xact_lock', exactKey), /dependency guard key drifted/],
      ['dependency guard moved to another lock namespace', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-control-assessment-dependency-v1',
        p_target_key, p_control_definition_id::text]`), /dependency guard key drifted/],
      ['dependency guard keyed without the control definition', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1',
        'CONTROL_APPLICABILITY', 'KEY', p_target_key]`), /dependency guard key drifted/],
      ['dependency guard keyed on the assessment subject', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1',
        'CONTROL_ASSESSMENT', 'KEY', p_target_key, p_control_definition_id::text]`), /dependency guard key drifted/],
      ['dependency guard made application-executable', `grant execute on function ${DEP_GUARD} to service_role;`, /owner-only SECURITY INVOKER|twenty-five/],
      ['dependency guard made SECURITY DEFINER', `alter function ${DEP_GUARD} security definer;`, /owner-only SECURITY INVOKER|dependency guard key drifted/],
      ['S1C.4 decide (the EXCLUSIVE key producer) config drift', `alter function gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,text,text,uuid,text,text[],text)
        set lock_timeout = '6s';`, /config changed/],
      ['reused S1C.4 resolver made a latest-state inference', `set local role postgres; create or replace function gov_repo.l14_control_applicability_valid_state_v1(
          p_organisation_id uuid, p_target_type text, p_target_canonical_kind text, p_target_canonical_object_id text, p_target_relationship_id text,
          p_target_relationship_state_id text, p_control_definition_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
          returns table (fact_state_id uuid, control_definition_id uuid, control_definition_version_id uuid, content_hash text,
            control_definition_validated_state_id uuid, applicability text, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
          language sql stable set search_path = pg_catalog, pg_temp as $$ select d.fact_state_id, d.control_definition_id, d.control_definition_version_id,
            d.content_hash::text, d.control_definition_validated_state_id, d.applicability, now(), null::timestamptz, now()
            from gov_repo.l14_control_applicability_states d order by d.fact_state_id limit 1 $$; reset role;`, /reused exact resolver drifted/],
      // Immutability / structural guards.
      ['state immutability trigger removed', 'drop trigger l14_control_assessment_states_immutable on gov_repo.l14_control_assessment_states;', /lacks ALWAYS raising/],
      ['proposal immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_control_assessment_proposals enable trigger l14_control_assessment_proposals_immutable;',
        /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_control_assessment_heads disable trigger l14_control_assessment_heads_guard;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_control_assessment_states disable trigger l14_control_assessment_states_guard;', /structural guard/],
      ['proposal guard disabled', 'alter table gov_repo.l14_control_assessment_proposals disable trigger l14_control_assessment_proposals_guard;', /structural guard/],
      // Applicability pin / envelope FK weakening.
      ['fact envelope FK dropped', 'alter table gov_repo.l14_control_assessment_states drop constraint l14_control_assessment_states_envelope_fkey;', /FK set wrong/],
      ['applicability pin FK dropped', 'alter table gov_repo.l14_control_assessment_states drop constraint l14_control_assessment_states_applicability_fkey;', /FK set wrong/],
      ['applicability pin FK narrowed to the bare state id (DOES_NOT_APPLY admissible)', `alter table gov_repo.l14_control_assessment_proposals drop constraint l14_control_assessment_proposals_applicability_fkey;
        alter table gov_repo.l14_control_assessment_proposals add constraint l14_control_assessment_proposals_applicability_fkey foreign key
          (organisation_id, control_applicability_state_id) references gov_repo.l14_control_applicability_states (organisation_id, fact_state_id);`, /FK set wrong/],
      ['applicability pin FK made NOT VALID', `alter table gov_repo.l14_control_assessment_states drop constraint l14_control_assessment_states_applicability_fkey;
        alter table gov_repo.l14_control_assessment_states add constraint l14_control_assessment_states_applicability_fkey foreign key
          (organisation_id, control_applicability_state_id, applicability_target_key, control_definition_id, control_definition_version_id, content_hash,
           control_definition_validated_state_id, applicability, applicability_state_kind) references gov_repo.l14_control_applicability_states
          (organisation_id, fact_state_id, target_key, control_definition_id, control_definition_version_id, content_hash, control_definition_validated_state_id,
           applicability, state_kind) not valid;`, /FK set wrong/],
      ['applicability pin FK made deferrable', `alter table gov_repo.l14_control_assessment_states drop constraint l14_control_assessment_states_applicability_fkey;
        alter table gov_repo.l14_control_assessment_states add constraint l14_control_assessment_states_applicability_fkey foreign key
          (organisation_id, control_applicability_state_id, applicability_target_key, control_definition_id, control_definition_version_id, content_hash,
           control_definition_validated_state_id, applicability, applicability_state_kind) references gov_repo.l14_control_applicability_states
          (organisation_id, fact_state_id, target_key, control_definition_id, control_definition_version_id, content_hash, control_definition_validated_state_id,
           applicability, state_kind) on update restrict on delete restrict deferrable initially deferred;`, /FK set wrong/],
      ['cascading FK into assessment history', `create table public.s1c5_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_control_assessment_states (organisation_id, fact_state_id) on delete cascade);`,
        /cascading/],
      ['extra FK on a new table', `alter table gov_repo.l14_control_assessment_heads add constraint l14_control_assessment_heads_probe_fkey foreign key (organisation_id)
        references gov_repo.organisations (organisation_id);`, /FK set wrong/],
      ['lineage root index dropped', 'drop index gov_repo.l14_control_assessment_states_root_uidx;', /lineage keys missing/],
      ['lineage successor index dropped', 'drop index gov_repo.l14_control_assessment_states_successor_uidx;', /lineage keys missing/],
      // Head key widening / narrowing (carry-over by target / control pair).
      ['head key replaced by a target / control pair (carry-over)', `alter table gov_repo.l14_control_assessment_heads add column control_definition_id uuid;
        create unique index s1c5_head_pair_uidx on gov_repo.l14_control_assessment_heads (organisation_id, control_definition_id);`, /pinned set|head key/],
      ['head key widened with the outcome', `alter table gov_repo.l14_control_assessment_heads drop constraint l14_control_assessment_heads_state_fkey;
        alter table gov_repo.l14_control_assessment_heads drop constraint l14_control_assessment_heads_pkey;
        alter table gov_repo.l14_control_assessment_heads add constraint l14_control_assessment_heads_pkey primary key (organisation_id, control_applicability_state_id, latest_state_id);`,
      /head key|FK set wrong/],
      // Outcome / pin / valid_until / fact subject relaxation.
      ['outcome CHECK widened with WAIVED (states)', outcomes('l14_control_assessment_states',
        `'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE','WAIVED'`), /relaxed/],
      ['outcome CHECK widened with UNKNOWN (proposals)', outcomes('l14_control_assessment_proposals',
        `'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE','UNKNOWN'`), /relaxed/],
      ['outcome CHECK narrowed (NOT_ASSESSED dropped)', outcomes('l14_control_assessment_states',
        `'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','INSUFFICIENT_EVIDENCE'`), /relaxed/],
      ['pinned applicability CHECK relaxed (DOES_NOT_APPLY)', `alter table gov_repo.l14_control_assessment_states drop constraint l14_control_assessment_states_applicability_check;
        alter table gov_repo.l14_control_assessment_states add constraint l14_control_assessment_states_applicability_check check (applicability in ('APPLIES','DOES_NOT_APPLY'));`,
      /relaxed/],
      ['valid_until made optional on VALIDATE proposals', `alter table gov_repo.l14_control_assessment_proposals drop constraint l14_control_assessment_proposals_target_check;
        alter table gov_repo.l14_control_assessment_proposals add constraint l14_control_assessment_proposals_target_check check (
          (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL AND requested_valid_until IS NULL));`, /relaxed/],
      ['fact interval CHECK relaxed', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_interval_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_interval_check check (effective_to IS NULL OR effective_to >= effective_from);`, /relaxed/],
      ['fact subject widened with CONTROL_FINDING (a sixth family)', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT',
          'BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','CONTROL_FINDING'));`, /relaxed/],
      ['second fact subject CHECK added', `alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_probe_check check (subject_kind <> 'X');`, /relaxed/],
      ['fact guard widened with CONTROL_FINDING', guardBody(`'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT','CONTROL_FINDING'`),
        /fact guard subject vocabulary/],
      ['fact guard narrowed (CONTROL_ASSESSMENT dropped)', guardBody(`'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY'`),
        /fact guard subject vocabulary/],
      ['authorization assessment target CHECK dropped', 'alter table gov_repo.l14_authorization_decisions drop constraint l14_authorization_decisions_control_assessment_target_check;',
        /relaxed/],
      ['a CONTROL_FINDING detail table appears', `set local role postgres; create table gov_repo.l14_control_finding_details (organisation_id uuid); reset role;`,
        /unexpected l14 relation set/],
      ['a finding routine appears', `set local role postgres; create function gov_repo.l14_record_finding_v1() returns void language sql set search_path = pg_catalog, pg_temp as ''; reset role;`,
        /twenty-five|finding/],
      ['free-text rationale on proposals', `alter table gov_repo.l14_control_assessment_proposals add column rationale text check (length(rationale) < 10);`, /pinned set/],
      ['score column on states', `alter table gov_repo.l14_control_assessment_states add column score integer;`, /pinned set/],
      ['independent valid_until column on states', `alter table gov_repo.l14_control_assessment_states add column valid_until timestamptz;`, /pinned set/],
      ['JSON evidence column', 'alter table gov_repo.l14_control_assessment_proposals add column evidence jsonb;', /JSON column/],
      // New SQL reach.
      ['a new routine reads the legacy control_assessments table', `set local role postgres; create or replace function gov_repo.l14_control_assessment_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin perform 1 from gov_repo.control_assessments; return new; end $h$; reset role;`, /quarantined legacy assessment surface|legacy label/],
      ['a new routine reads canonical_relationships directly', `set local role postgres; create or replace function gov_repo.l14_control_assessment_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin perform 1 from gov_repo.canonical_relationships; return new; end $h$; reset role;`, /canonical relationships outside/],
      ['a new routine mutates applicability history', `set local role postgres; create or replace function gov_repo.l14_control_assessment_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin UPDATE gov_repo.l14_control_applicability_heads set latest_state_id = latest_state_id where false; return new; end $h$; reset role;`,
      /mutates a registry/],
      ['a new routine reads the control definition registry directly', `set local role postgres; create or replace function gov_repo.l14_control_assessment_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin perform 1 from gov_repo.l14_control_definition_versions; return new; end $h$; reset role;`, /another registry/],
      // Frozen enumerations and F2.
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','CONTROL_ASSESSMENT')) not valid;`, /canonical object kinds \(11\)/],
      ['relationship type added (SATISFIES)', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP',
          'INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','SATISFIES')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1C.5 routine attached to canonical_relationships', `create trigger s1c5_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_control_assessment_head_guard_v1();`, /F2 boundary/],
      ['F2: unique relationship_state_id introduced', `create unique index s1c5_rel_state_uidx on gov_repo.canonical_relationships (organisation_id, relationship_state_id);`,
        /F2 boundary/],
      ['F2: relationship_state_id CHECK attached', `alter table gov_repo.canonical_relationships add constraint s1c5_state_check check (relationship_state_id <> '') not valid;`,
        /F2 boundary/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1C5_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    t.diagnostic(`S1C.5 postflight negative controls: ${controls.length}`);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '43|0');
    assert.equal(await one(`select count(*) from pg_proc where proname in ('s1c5_probe','l14_record_finding_v1')`), '0');
    assert.equal(await one(F2_DIGEST), f2Snapshot, 'every F2 probe was rolled back');
    await owner(block);
  });

  await t.test('the new SQL reads only the S1C.4 applicability lineage + resolvers; never content, cg_*, scores, legacy assessments, other families; F2 read-only', async () => {
    const sources = await owner(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/(^|[^A-Za-z0-9_$])governance_policies([^A-Za-z0-9_$]|$)/, /(^|[^A-Za-z0-9_$])policy_versions([^A-Za-z0-9_$]|$)/,
      /l14_policy_/, /POLICY_APPLICABILITY/, /l14_domain_/, /l14_governance_part/, /l14_responsibility_/, /l14_business_context_/, /l14_control_definition/,
      /control_code/, /\btitle\b/, /\bdescription\b/, /governance_users/, /\bemail\b/i, /scanner/i, /\bllm\b/i, /similarity/i, /\bcg_/i, /cg-ag/i,
      /\brisk/i, /\bscore/i, /coverage/i, /maturity/i, /waiver/i, /finding/i, /\bstatus\b/, /canonical_relationships/,
      /(^|[^A-Za-z0-9_])control_assessments([^A-Za-z0-9_]|$)/, /control_findings/, /conformity_assessments/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\.(l14_control_applicability|l14_control_definition|l14_registry_states|canonical_objects)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
    for (const required of [/gov_repo\.l14_control_applicability_states/, /gov_repo\.l14_control_applicability_valid_state_v1/,
      /gov_repo\.l14_control_applicabilities_current_v1/, /'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY'/,
      /gov_repo\.l14_lock_control_definition_dependency_guard_shared_v1/, /gov_repo\.l14_evaluate_target_authority_rules_v1/,
      /gov_repo\.l14_evaluate_relationship_state_authority_rules_v1/, /gov_repo\.l14_resolve_relationship_state_target_v1/, /'L14_CONTROL_ASSESSMENT_VALIDATE'/]) {
      assert.match(sources, required, String(required));
    }
    assert.equal(await one(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='gov_repo'::regnamespace
      and proname like 'l14\\_%' and prosrc ~ 'canonical_relationships'`), 'l14_parse_authority_policy_rules_v1,l14_resolve_relationship_state_target_v1');
  });
});
