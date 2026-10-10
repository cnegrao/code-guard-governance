import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14ControlApplicabilityMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { policyApplicabilityKit } from '../helpers/m16-l14-policy-applicability-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';

/**
 * M16-S1C.4 — privilege closure, preflight, postflight negative controls (one per privilege / structure class) and structural
 * invariants on real disposable PostgreSQL 17. The S1C4 horizon is stopped right before the S1C.4 migration so the suite can
 * seed real S1B.6 / S1C.1 / S1C.2 / S1C.3 history, snapshot the post-S1C.3 catalog, prove the preflight aborts atomically, then
 * apply the migration itself. Every control runs inside a rolled-back bootstrap transaction; historical postflights are never
 * altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_submit_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_control_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const DEP_GUARD = 'gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(uuid,uuid,uuid,text)';
const RESOLVER = 'gov_repo.l14_control_applicability_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)';
const CURRENT = 'gov_repo.l14_control_applicabilities_current_v1(uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone)';
/** Reused UNCHANGED from S1C.3 (never re-created): part of the byte-identical routine digest. */
const REL_RESOLVER = 'gov_repo.l14_resolve_relationship_state_target_v1(uuid,text,text)';
const KEY_FN = 'gov_repo.l14_control_applicability_target_key_v1(text,text,text,text,text)';
const NEW_HELPERS = [
  'gov_repo.l14_control_applicability_proposal_guard_v1()', 'gov_repo.l14_control_applicability_state_guard_v1()',
  'gov_repo.l14_control_applicability_head_guard_v1()', DEP_GUARD, 'gov_repo.l14_control_applicability_command_result_v1(uuid,text,boolean)',
  RESOLVER, CURRENT, KEY_FN,
] as const;
const FACT_GUARD = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])';
const NEW_TABLES = ['gov_repo.l14_control_applicability_states', 'gov_repo.l14_control_applicability_proposals',
  'gov_repo.l14_control_applicability_heads'] as const;
/** The four framework tables S1C.4 widens (closed CHECKs only); their rows are never rewritten. */
const WIDENED = ['l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results', 'l14_fact_states'] as const;
const postflight = () => {
  const text = migrationSource(l14ControlApplicabilityMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1C4_POSTFLIGHT'));
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
/** Every pre-S1C.4 routine body + config + ACL in gov_repo (incl. every S1C.3 routine and the reused relationship-state resolver /
 *  evaluator), except the one widened fact guard (S1C.4 replaces nothing else). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%control\\_applicab%'
    and proname not in ('l14_lock_fact_subject_guard_v1','l14_lock_control_definition_dependency_guard_shared_v1')`;
/** Every pre-S1C.4 gov_repo table definition except the four widened framework tables and the new S1C.4 tables. */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')
  and c.relname not like 'l14\\_control\\_applicability%'
  and c.relname not in (${WIDENED.map(t => `'${t}'`).join(',')})`;
/** Every existing row of the widened framework tables and every S1B.4 / S1B.6 / S1C.1 / S1C.2 / S1C.3 history row (never rewritten). */
const HISTORY = [...WIDENED, 'l14_policy_version_states', 'l14_policy_version_proposals', 'l14_policy_version_heads', 'l14_registry_states',
  'l14_control_definitions', 'l14_control_definition_versions', 'l14_control_definition_states', 'l14_control_definition_proposals',
  'l14_control_definition_heads', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_proposals',
  'l14_responsibility_assignment_heads', 'l14_business_context_assignment_states', 'l14_business_context_assignment_proposals',
  'l14_business_context_assignment_heads', 'l14_policy_applicability_states', 'l14_policy_applicability_proposals',
  'l14_policy_applicability_heads', 'l14_support_links'];
const ROWS_DIGEST = `select md5(string_agg(x, '|' order by x)) from (${HISTORY.map(t =>
  `select '${t}:'||to_jsonb(t)::text as x from gov_repo.${t} t`).join(' union all ')}) s`;
/** Every pre-existing constraint definition of the widened tables except the closed CHECKs S1C.4 re-states / adds. */
const WIDENED_CONSTRAINTS = `select md5(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in (${WIDENED.map(t => `'gov_repo.${t}'::regclass`).join(',')})
  and conname not in ('l14_governance_decisions_subject_kind_check','l14_governance_decisions_reason_code_check','l14_command_results_subject_kind_check',
    'l14_command_results_shape_check','l14_fact_states_subject_kind_check','l14_authorization_decisions_control_applicability_target_check')`;

test('M16 S1C.4 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 3_000_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C4', stopBefore: l14ControlApplicabilityMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Real pre-S1C.4 history: an S1C.1 responsibility lifecycle (VALIDATED + REVOKED), an S1C.2 business context assignment, an S1C.3
  // policy applicability and an S1B.6 CONTROL_DEFINITION lifecycle (VALIDATED version + REVOKED version). The widened framework
  // must keep every row byte-identical and every command replayable.
  const rk = await responsibilityKit(c);
  const hist = await rk.setup();
  await c.evidence(hist.org, 'hist-ev');
  const histParty = await rk.party(hist, 'hist');
  const histKey = rk.keyOf('AGENT', hist.objects.agent, 'BUSINESS_OWNER', histParty.partyId);
  const histAssign = await rk.assign(hist, 'hist', histKey, histParty);
  const histRevoke = await rk.revoke(hist, 'hist', histKey, histParty.stateId, histAssign.stateId);
  assert.equal(histRevoke.decided.outcome, 'REVOKED');
  const bk = await businessContextKit(c);
  const bctx = await bk.setup();
  const histDomain = await bk.domain(bctx, 'hist-dom');
  const histBc = await bk.assign(bctx, 'hist-bc', bk.keyOf('AGENT', bctx.objects.agent, 'BUSINESS_DOMAIN'), histDomain);
  assert.equal(histBc.decided.outcome, 'VALIDATED');
  const pk = await policyApplicabilityKit(c);
  const pactx = await pk.setup();
  const histPolicy = await pk.apply(pactx, 'hist-pa', pk.objectTarget('AGENT', pactx.objects.byKind.AGENT), await pk.policy(pactx, 'hist-pa-pol'));
  assert.equal(histPolicy.decided.outcome, 'VALIDATED');
  const k = await controlApplicabilityKit(c);
  const pctx = await k.setup();
  const histPin = await k.control(pctx, 'hist-cd');
  const histRevokedPin = await k.control(pctx, 'hist-cd-rv');
  await k.revokeControlDefinition(pctx, 'hist-cd-rv', histRevokedPin);
  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const rowsBefore = await one(ROWS_DIGEST);
  const constraintsBefore = await one(WIDENED_CONSTRAINTS);
  const factGuardBefore = await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
    from pg_proc where oid='${FACT_GUARD}'::regprocedure`);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 39, 'the post-S1C.3 application definer surface is 39');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 29, 'the post-S1C.3 canonical-owner (policy-store-capable) class is 29');

  await t.test('preflight: the exact post-S1C.3 catalog is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_control_applicability_states')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%control\\_applicab%'
        or proname = 'l14_lock_control_definition_dependency_guard_shared_v1'`), '0');
      assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_fact_states_subject_kind_check'`),
        "CHECK ((subject_kind = ANY (ARRAY['RESPONSIBILITY_ASSIGNMENT'::text, 'BUSINESS_CONTEXT_ASSIGNMENT'::text, 'POLICY_APPLICABILITY'::text])))");
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
      assert.equal(await one(ROWS_DIGEST), rowsBefore);
    };
    const decide = 'gov_repo.l14_decide_policy_applicability_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    const cdDecide = 'gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1c4_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1c4_probe() to service_role`, 'drop function public.s1c4_probe()', /not exactly the 39 post-S1C\.3 baseline/],
      ['S1C.3 decide config drift', `alter function ${decide} set lock_timeout = '6s'`, `alter function ${decide} set lock_timeout = '5s'`,
        /differs from its post-S1C\.3 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
      ['S1C.3 horizon absent', 'alter table gov_repo.l14_policy_applicability_heads rename to l14_policy_applicability_heads_x',
        'alter table gov_repo.l14_policy_applicability_heads_x rename to l14_policy_applicability_heads', /unexpected l14 relation set/],
      ['S1C.3 shared relationship-state resolver absent', `alter function ${REL_RESOLVER} rename to l14_resolve_relationship_state_target_x`,
        `alter function gov_repo.l14_resolve_relationship_state_target_x(uuid,text,text) rename to l14_resolve_relationship_state_target_v1`,
        /keys missing or already widened/],
      ['fact envelope already widened', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY'))`,
      `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY'))`,
      /keys missing or already widened/],
      ['S1B.6 CONTROL_DEFINITION dependency key absent', `alter table gov_repo.l14_control_definition_states rename constraint l14_control_definition_states_kind_unique to l14_control_definition_states_kind_unique_x`,
        `alter table gov_repo.l14_control_definition_states rename constraint l14_control_definition_states_kind_unique_x to l14_control_definition_states_kind_unique`,
        /keys missing or already widened/],
      ['S1B.6 CONTROL_DEFINITION resolver absent', `alter function gov_repo.l14_control_definition_valid_state_v1(uuid,uuid,uuid,text,timestamptz,timestamptz) rename to l14_control_definition_valid_state_x`,
        `alter function gov_repo.l14_control_definition_valid_state_x(uuid,uuid,uuid,text,timestamptz,timestamptz) rename to l14_control_definition_valid_state_v1`,
        /keys missing or already widened/],
      ['S1B.6 CONTROL_DEFINITION decide config drift', `alter function ${cdDecide} set lock_timeout = '6s'`, `alter function ${cdDecide} set lock_timeout = '5s'`,
        /differs from its post-S1C\.3 owner\/body\/config/],
    ] as const) {
      await bootstrapSql(`set role postgres; ${brk}`);
      try {
        await assert.rejects(c.migrate(l14ControlApplicabilityMigration), (error: Error) => {
          assert.match(error.message, /M16_S1C4_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(`set role postgres; ${fix}`); }
      await notApplied();
    }
    const text = migrationSource(l14ControlApplicabilityMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${hist.org}',gen_random_uuid(),'CONTROL_APPLICABILITY','VALIDATE','LOCAL_HUMAN',
      '${hist.member.id}','NONE',now()); ${pre} rollback;`), /M16_S1C4_PREFLIGHT: control applicability governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly; historical shapes / rows / routines are untouched', async () => {
    await c.migrate(l14ControlApplicabilityMigration);
    await assert.rejects(c.migrate(l14ControlApplicabilityMigration), /M16_S1C4_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1C.4 gov_repo routine body / config / ACL is byte-identical (except the widened fact guard)');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no other pre-S1C.4 gov_repo table / view is altered');
    assert.equal(await one(ROWS_DIGEST), rowsBefore, 'every historical framework / S1B.4 / S1B.6 / S1C.1 / S1C.2 / S1C.3 row is unchanged (no rewrite, no backfill)');
    assert.equal(await one(WIDENED_CONSTRAINTS), constraintsBefore, 'every other constraint of the widened tables is unchanged');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, indexes, rules, ACL and rows untouched');
    assert.equal(await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
      from pg_proc where oid='${FACT_GUARD}'::regprocedure`), factGuardBefore);
    // Historical commands still replay their ORIGINAL durable result after the widening.
    const replayed = await c.exec(rk.decideSql(hist.rs, { commandId: hist.cmd('hist-revoke'), proposalId: histRevoke.submitted.proposal_id,
      proposal: histRevoke.proposal, outcome: 'REVOKE', expected: histAssign.stateId }));
    assert.deepEqual([replayed.replay, replayed.fact_state_id, replayed.recorded_at], [true, histRevoke.decided.fact_state_id, histRevoke.decided.recorded_at]);
    const bcReplay = await c.exec(bk.decideSql(bctx.bs, { commandId: bctx.cmd('hist-bc-validate'), proposalId: histBc.submitted.proposal_id,
      proposal: histBc.proposal, expected: null }));
    assert.deepEqual([bcReplay.replay, bcReplay.fact_state_id], [true, histBc.stateId]);
    const paReplay = await c.exec(pk.decideSqlFor(pactx.ps, pactx.cmd('hist-pa-validate'), histPolicy.submitted.proposal_id, histPolicy.proposal,
      'VALIDATE', null));
    assert.deepEqual([paReplay.replay, paReplay.fact_state_id], [true, histPolicy.stateId], 'the S1C.3 command still replays its original result');
    // The first applicability on the new catalog pins the pre-existing S1B.6 VALIDATED state; the pre-existing REVOKED one never validates.
    const first = await k.apply(pctx, 'post', k.objectTarget('AGENT', pctx.objects.byKind.AGENT), histPin);
    assert.equal(first.decided.outcome, 'VALIDATED');
    const rvp = k.validateProposal(k.objectTarget('MODEL', pctx.objects.byKind.MODEL), histRevokedPin);
    const rvs = await k.submit(pctx, pctx.member, 'post-rv-submit', rvp);
    await c.rejects(c.svc(k.decideSql(pctx.cs, { commandId: pctx.cmd('post-rv'), proposalId: rvs.proposal_id, proposal: rvp })), 'GV010',
      /CONTROL_DEFINITION_DEPENDENCY_NOT_VALID/);
    await assert.rejects(bootstrapSql(`begin; set local role postgres; update gov_repo.l14_fact_states set subject_kind='CONTROL_APPLICABILITY'
      where organisation_id='${hist.org}'; rollback;`), /L14_HISTORY_IMMUTABLE|fkey|violates/);
  });

  await t.test('definer surface 39 -> 41 / canonical-owner class 29 -> 31: the 39 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the two new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 41);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 31);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '41|0');
    const postBlock = migrationSource(l14ControlApplicabilityMigration).slice(migrationSource(l14ControlApplicabilityMigration).indexOf('DO $postflight$'));
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
      assert.equal(await one(`select (prosrc ~ '(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)')::text from pg_proc
        where oid='${sig}'::regprocedure`), 'false', `${sig}: never reaches a policy content store directly`);
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
      for (const table of [...WIDENED, 'l14_control_definition_states', 'l14_control_definition_versions', 'l14_policy_applicability_states',
        'governance_policies', 'policy_versions']) {
        await assert.rejects(c.sql(`update gov_repo.${table} set organisation_id=organisation_id`, role), /42501|permission denied/, `${role}: ${table}`);
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of NEW_RPCS) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_control_applicability_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'CONTROL_APPLICABILITY_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS, FACT_GUARD].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the two new RPCs');
    for (const [name, call] of [
      ['resolver', `select * from gov_repo.l14_control_applicability_valid_state_v1(gen_random_uuid(), 'CANONICAL_OBJECT', 'AGENT', 'x', null, null, gen_random_uuid(), now(), now())`],
      ['current read', `select * from gov_repo.l14_control_applicabilities_current_v1(gen_random_uuid(), 'CANONICAL_OBJECT', 'AGENT', 'x', null, null, now(), now())`],
      ['result projection', `select * from gov_repo.l14_control_applicability_command_result_v1(gen_random_uuid(), 'x', false)`],
      ['shared CONTROL_DEFINITION dependency guard', `select gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), repeat('a',64))`],
      ['exact relationship-state resolver (reused)', `select * from gov_repo.l14_resolve_relationship_state_target_v1(gen_random_uuid(), 'r', 's')`],
      ['relationship-state evaluator (reused)', `select * from gov_repo.l14_evaluate_relationship_state_authority_rules_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        '{}'::uuid[], 'L14_CONTROL_APPLICABILITY_VALIDATE', 'VALIDATE', false, 'IMMEDIATE', 'EXPOSES', 'r', 's')`],
      ['target key encoder', `select gov_repo.l14_control_applicability_target_key_v1('CANONICAL_OBJECT', 'AGENT', 'x', null, null)`],
      ['fact guard', `select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), 'CONTROL_APPLICABILITY', array['KEY','x'])`],
      ['S1B.6 control definition resolver', `select * from gov_repo.l14_control_definition_valid_state_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), repeat('a',64), now(), now())`],
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
    const pin = await k.control(x, 'acl');
    const target = k.relTarget(x.rels.reads);
    const a = await k.apply(x, 'acl', target, pin);
    for (const statement of [`update gov_repo.l14_control_applicability_heads set latest_state_id=null`,
      `update gov_repo.l14_control_applicability_states set applicability='DOES_NOT_APPLY'`,
      `insert into gov_repo.l14_control_applicability_heads(organisation_id,target_type,target_canonical_kind,target_canonical_object_id,control_definition_id)
        values ('${x.org}','CANONICAL_OBJECT','AGENT','x','${pin.subject.controlDefinitionId}')`,
      `delete from gov_repo.l14_control_applicability_proposals`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
    for (const statement of [`update gov_repo.l14_fact_states set effective_to=now() where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_control_applicability_states set applicability='DOES_NOT_APPLY' where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_control_applicability_states set control_definition_version_id=gen_random_uuid() where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_control_applicability_states set control_definition_validated_state_id=gen_random_uuid() where fact_state_id='${a.stateId}'`,
      `delete from gov_repo.l14_control_applicability_proposals where organisation_id='${x.org}'`,
      'truncate gov_repo.l14_control_applicability_states cascade',
      `delete from gov_repo.l14_control_applicability_heads where organisation_id='${x.org}'`,
      `update gov_repo.l14_control_applicability_heads set control_definition_id=gen_random_uuid() where organisation_id='${x.org}'`,
      `update gov_repo.l14_control_applicability_heads set latest_state_id=null where organisation_id='${x.org}'`]) {
      await assert.rejects(bootstrapSql(`begin; set local role postgres; ${statement}; rollback;`), /L14_HISTORY_IMMUTABLE|violates/, statement);
    }
  });

  await t.test('structural: no JSON / label / rationale / score column; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|label|descr|title|control_code|path|source_system|tag|category|classif|rationale|note|comment|reason|score|weight|risk|confidence|similar|^status$|approv|cg_|owner|party|email|metadata|current_version|relationship_type|satisf|assess|coverage|maturity|severity|waiv)'`),
    '0', 'no label / code / title / rationale / score / assessment / owner / metadata / caller relationship-type column');
    assert.equal(Object.keys(CANONICAL_OBJECT_KIND).length, 11);
    assert.equal(Object.keys(GOVERNED_RELATIONSHIP_TYPE).length, 12);
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL|POLICY|APPLIES|GOVERNED_BY|SUBJECT_TO/.test(type)),
      'no CONTROLLED_BY / APPLIES_CONTROL / SUBJECT_TO_CONTROL (or policy) type');
    for (const [table, constraint, expected] of [['canonical_objects', 'canonical_objects_kind_check', Object.values(CANONICAL_OBJECT_KIND)],
      ['canonical_relationships', 'canonical_relationships_type_check', Object.values(GOVERNED_RELATIONSHIP_TYPE)]] as const) {
      const values = JSON.parse(await one(`select json_agg(m[1] order by m[1] collate "C") from pg_constraint k,
        regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g') m where k.conrelid='gov_repo.${table}'::regclass and k.conname='${constraint}'`));
      assert.deepEqual(values, [...expected].sort());
    }
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid::regclass::text like 'gov_repo.l14\\_%'`), '0', 'no FK to canonical_relationships');
    assert.equal(await one(`select string_agg(a.attname, ',' order by k.ord) from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(n, ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n where c.conrelid='gov_repo.l14_control_applicability_heads'::regclass and c.contype='p'`),
    'organisation_id,target_key,control_definition_id', 'the head key is exactly organisation + target + control definition');
  });

  await t.test('postflight negative controls: every privilege / structure / guard / dependency-lock / F2 drift class fails it', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '41|0', 'baseline passes');
    const f2Snapshot = await one(F2_DIGEST);
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1c4_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1c4_probe() from public; grant execute on function ${schema}.s1c4_probe() to ${grantee};`;
    const depGuard = (lock: string, key: string) => `set local role postgres; create or replace function gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(
        p_organisation_id uuid, p_control_definition_id uuid, p_control_definition_version_id uuid, p_content_hash text) returns void language plpgsql volatile
        set search_path = pg_catalog, pg_temp as $g$ begin
        perform pg_catalog.${lock}(pg_catalog.hashtextextended(gov_repo.frame_identity(${key}), 0)); end $g$; reset role;`;
    const exactKey = `ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'CONTROL_DEFINITION',
      'CONTROL_DEFINITION_VALIDATION:' || p_control_definition_id::text || ':' || p_control_definition_version_id::text || ':' || p_content_hash]`;
    const guardBody = (subjects: string) => `set local role postgres; create or replace function gov_repo.l14_lock_fact_subject_guard_v1(p_organisation_id uuid,
        p_subject_kind text, p_key_parts text[]) returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
        if p_subject_kind not in (${subjects}) then raise exception 'x'; end if;
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(gov_repo.frame_identity(ARRAY[p_organisation_id::text,
          'l14-fact-subject-guard-v1', p_subject_kind] || p_key_parts), 0)); end $g$; reset role;`;
    const decideSrc = await owner(`select prosrc from pg_proc where oid='${NEW_RPCS[1]}'::regprocedure`);
    const decideReplace = (body: string) => `set local role postgres; create or replace function gov_repo.l14_decide_control_applicability_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text,
          p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
          proposal_id uuid, governance_decision_id uuid, target_type text, target_canonical_kind text, target_canonical_object_id text,
          target_relationship_id text, target_relationship_state_id text, control_definition_id uuid, control_definition_version_id uuid,
          content_hash text, control_definition_validated_state_id uuid, applicability text, fact_state_id uuid, state_kind text,
          predecessor_state_id uuid, effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
        language plpgsql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $body$${body}$body$; reset role;`;
    const noGuard = decideSrc.replace(/IF p_outcome = 'VALIDATE' THEN\n\s+PERFORM gov_repo\.l14_lock_control_definition_dependency_guard_shared_v1\([^;]+;\n\s+END IF;\n/, '');
    assert.notEqual(noGuard, decideSrc, 'the guard removal probe really removes the guard call');
    // Lock order inversion: the fact KEY guard taken BEFORE the dependency guard.
    const factGuardCall = /  PERFORM gov_repo\.l14_lock_fact_subject_guard_v1\(v_org, 'CONTROL_APPLICABILITY',\n[^;]+;\n/.exec(decideSrc)?.[0] ?? '';
    assert.ok(factGuardCall.length > 0, 'the fact guard call is located');
    const inverted = decideSrc.replace(factGuardCall, '').replace("  IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(",
      `${factGuardCall}  IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(`);
    assert.notEqual(inverted, decideSrc, 'the lock order inversion probe really reorders the guards');
    const union = (table: string, check: string) => `alter table gov_repo.${table} drop constraint ${table}_target_union_check;
      alter table gov_repo.${table} add constraint ${table}_target_union_check check (${check});`;
    const controls: Array<[string, string, RegExp]> = [
      // Table privilege classes, column grants, sequence leak, inherited paths.
      ['service_role direct INSERT on states', 'grant insert on gov_repo.l14_control_applicability_states to service_role;', /non-owner table grant|holds/],
      ['service_role SELECT on states', 'grant select on gov_repo.l14_control_applicability_states to service_role;', /non-owner table grant|holds/],
      ['service_role UPDATE on heads', 'grant update on gov_repo.l14_control_applicability_heads to service_role;', /non-owner table grant|holds/],
      ['service_role DELETE on proposals', 'grant delete on gov_repo.l14_control_applicability_proposals to service_role;', /non-owner table grant|holds/],
      ['TRUNCATE on states', 'grant truncate on gov_repo.l14_control_applicability_states to authenticated;', /non-owner table grant|holds/],
      ['REFERENCES on states', 'grant references on gov_repo.l14_control_applicability_states to anon;', /non-owner table grant|holds/],
      ['TRIGGER on proposals', 'grant trigger on gov_repo.l14_control_applicability_proposals to service_role;', /non-owner table grant|holds/],
      ['MAINTAIN on heads', 'grant maintain on gov_repo.l14_control_applicability_heads to service_role;', /non-owner table grant|holds/],
      ['service_role INSERT on the shared fact envelope', 'grant insert on gov_repo.l14_fact_states to service_role;', /non-owner table grant|holds/],
      ['column SELECT on states', 'grant select (applicability) on gov_repo.l14_control_applicability_states to authenticated;', /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_control_applicability_heads to service_role;', /column-level grants|column privilege|holds/],
      ['sequence owned by applicability history → anon', `set local role postgres; create sequence gov_repo.s1c4_leak owned by gov_repo.l14_control_applicability_states.fact_state_id;
        reset role; grant usage on sequence gov_repo.s1c4_leak to anon;`, /sequence/],
      ['readable view over states → service_role', 'create view public.s1c4_leak as select * from gov_repo.l14_control_applicability_states; grant select on public.s1c4_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1c4_leak as select * from gov_repo.l14_control_applicability_heads;
        create view public.s1c4_leak2 as select * from public.s1c4_leak; grant update on public.s1c4_leak2 to authenticated;`, /view/],
      ['gov_repo table default → service_role re-grants the new tables', `alter default privileges for role postgres in schema gov_repo grant all on tables to service_role;
        set local role postgres; create table gov_repo.l14_control_applicability_probe (organisation_id uuid); reset role;`, /unexpected l14 relation set|non-owner table grant|holds/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1c4_leak_parent nologin; grant select on gov_repo.l14_control_applicability_proposals to s1c4_leak_parent;
        grant s1c4_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from applicability history', 'create table public.s1c4_child () inherits (gov_repo.l14_control_applicability_states);', /inheritance/],
      ['permissive policy on states', 'create policy s1c4_probe on gov_repo.l14_control_applicability_states for select to service_role using (true);', /RLS policy/],
      ['permissive policy on heads', 'create policy s1c4_probe on gov_repo.l14_control_applicability_heads for all to authenticated using (true) with check (true);', /RLS policy/],
      ['RLS disabled on proposals', 'alter table gov_repo.l14_control_applicability_proposals disable row level security;', /RLS-enabled/],
      // Routine EXECUTE classes, unexpected definers, drift.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['unexpected gov_repo definer → service_role', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_submit_control_applicability_proposal_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_submit_control_applicability_proposal_v1(uuid) from public; reset role;`,
      /overload|twenty-three post-S1C\.3 \+ two S1C\.4|ACL\/definer shape/],
      ['decide RPC body drift', decideReplace(decideSrc.replace('CONTROL_APPLICABILITY_ALREADY_VALIDATED', 'CONTROL_APPLICABILITY_ALREADY_VALIDATED_X')),
        /body hash changed/],
      ['decide no longer takes the dependency guard', decideReplace(noGuard), /lock order drifted|body hash changed/],
      ['decide lock order inverted (fact KEY before the dependency guard)', decideReplace(inverted), /lock order drifted|body hash changed/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC lock_timeout drift', `alter function ${NEW_RPCS[1]} set lock_timeout = '60s';`, /config changed/],
      ['RPC owner drift', `create role s1c4_owner nologin; alter function ${NEW_RPCS[1]} owner to s1c4_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['RPC made SECURITY INVOKER', `alter function ${NEW_RPCS[0]} security invoker;`, /ACL\/definer shape|not SECURITY DEFINER|not exactly 41/],
      ['unexpected SECURITY DEFINER helper (resolver)', `alter function ${RESOLVER} security definer;`, /owner-only SECURITY INVOKER/],
      ['resolver made service_role-executable', `grant execute on function ${RESOLVER} to service_role;`, /owner-only SECURITY INVOKER|twenty-three/],
      ['current read made authenticated-executable', `grant execute on function ${CURRENT} to authenticated;`, /executable by authenticated|owner-only/],
      ['state guard made service_role-executable', `grant execute on function gov_repo.l14_control_applicability_state_guard_v1() to service_role;`,
        /owner-only SECURITY INVOKER|twenty-three/],
      ['helper search_path drift', `alter function ${KEY_FN} set search_path = public, pg_temp;`, /search_path not pinned/],
      ['RPC executable by PUBLIC', `grant execute on function ${NEW_RPCS[0]} to public;`, /PUBLIC EXECUTE|not exactly service_role|ACL/],
      ['RPC executable by anon', `grant execute on function ${NEW_RPCS[0]} to anon;`, /executable by anon|not exactly service_role/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[1]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[1]} from service_role;`, /ACL\/definer shape|twenty-three|not exactly service_role/],
      // CONTROL_DEFINITION dependency guard: mode, namespace, key, executability.
      ['dependency guard made EXCLUSIVE', depGuard('pg_advisory_xact_lock', exactKey), /dependency guard key drifted/],
      ['dependency guard moved to another lock namespace', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-control-applicability-dependency-v1',
        p_control_definition_id::text, p_control_definition_version_id::text, p_content_hash]`), /dependency guard key drifted/],
      ['dependency guard moved to the POLICY_VERSION subject', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'POLICY_VERSION',
        'POLICY_VERSION_VALIDATION:' || p_control_definition_id::text || ':' || p_control_definition_version_id::text || ':' || p_content_hash]`),
      /dependency guard key drifted/],
      ['dependency guard key without the content hash', depGuard('pg_advisory_xact_lock_shared', `ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'CONTROL_DEFINITION',
        'CONTROL_DEFINITION_VALIDATION:' || p_control_definition_id::text || ':' || p_control_definition_version_id::text]`), /dependency guard key drifted/],
      ['dependency guard made application-executable', `grant execute on function ${DEP_GUARD} to service_role;`, /owner-only SECURITY INVOKER|twenty-three/],
      ['dependency guard made SECURITY DEFINER', `alter function ${DEP_GUARD} security definer;`, /owner-only SECURITY INVOKER|dependency guard key drifted/],
      ['S1B.6 decide (the EXCLUSIVE key producer) config drift', `alter function gov_repo.l14_decide_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,text,text,uuid,text,text[],text)
        set lock_timeout = '6s';`, /config changed/],
      ['S1B.6 submit (the EXCLUSIVE key producer) owner drift', `create role s1c4_cd_owner nologin; alter function
        gov_repo.l14_submit_control_definition_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text[],text)
        owner to s1c4_cd_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      // Immutability / structural guards.
      ['state immutability trigger removed', 'drop trigger l14_control_applicability_states_immutable on gov_repo.l14_control_applicability_states;', /lacks ALWAYS raising/],
      ['proposal immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_control_applicability_proposals enable trigger l14_control_applicability_proposals_immutable;',
        /lacks ALWAYS raising/],
      ['state TRUNCATE trigger disabled', 'alter table gov_repo.l14_control_applicability_states disable trigger l14_control_applicability_states_no_truncate;', /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_control_applicability_heads disable trigger l14_control_applicability_heads_guard;', /structural guard/],
      ['head TRUNCATE guard disabled', 'alter table gov_repo.l14_control_applicability_heads disable trigger l14_control_applicability_heads_no_truncate;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_control_applicability_states disable trigger l14_control_applicability_states_guard;', /structural guard/],
      ['proposal source guard disabled', 'alter table gov_repo.l14_control_applicability_proposals disable trigger l14_control_applicability_proposals_guard;', /structural guard/],
      // Fact-state / CONTROL_DEFINITION dependency FK weakening.
      ['fact envelope FK dropped', 'alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_envelope_fkey;', /FK set wrong/],
      ['control dependency FK dropped', 'alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_control_definition_fkey;', /FK set wrong/],
      ['control dependency FK narrowed to the admitted version (no state)', `alter table gov_repo.l14_control_applicability_proposals drop constraint l14_control_applicability_proposals_control_definition_fkey;
        alter table gov_repo.l14_control_applicability_proposals add constraint l14_control_applicability_proposals_control_definition_fkey foreign key
          (organisation_id, control_definition_id, control_definition_version_id, content_hash) references gov_repo.l14_control_definition_versions
          (organisation_id, control_definition_id, control_definition_version_id, content_hash);`, /FK set wrong/],
      ['control dependency FK made NOT VALID', `alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_control_definition_fkey;
        alter table gov_repo.l14_control_applicability_states add constraint l14_control_applicability_states_control_definition_fkey foreign key
          (organisation_id, control_definition_validated_state_id, control_definition_id, control_definition_version_id, content_hash, control_definition_state_kind)
          references gov_repo.l14_control_definition_states (organisation_id, state_id, control_definition_id, control_definition_version_id, content_hash, state_kind) not valid;`,
      /FK set wrong/],
      ['control dependency FK made deferrable', `alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_control_definition_fkey;
        alter table gov_repo.l14_control_applicability_states add constraint l14_control_applicability_states_control_definition_fkey foreign key
          (organisation_id, control_definition_validated_state_id, control_definition_id, control_definition_version_id, content_hash, control_definition_state_kind)
          references gov_repo.l14_control_definition_states (organisation_id, state_id, control_definition_id, control_definition_version_id, content_hash, state_kind)
          on update restrict on delete restrict deferrable initially deferred;`, /FK set wrong/],
      ['cascading FK into applicability history', `create table public.s1c4_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_control_applicability_states (organisation_id, fact_state_id) on delete cascade);`,
        /cascading/],
      ['extra FK on a new table', `alter table gov_repo.l14_control_applicability_heads add constraint l14_control_applicability_heads_probe_fkey foreign key (organisation_id)
        references gov_repo.organisations (organisation_id);`, /FK set wrong/],
      ['lineage root index dropped', 'drop index gov_repo.l14_control_applicability_states_root_uidx;', /lineage keys missing/],
      ['lineage successor index dropped', 'drop index gov_repo.l14_control_applicability_states_successor_uidx;', /lineage keys missing/],
      // Head key widening (version / hash / dependency are never part of the logical key).
      ['head key widened with the version id', `alter table gov_repo.l14_control_applicability_heads add column control_definition_version_id uuid not null default gen_random_uuid();
        alter table gov_repo.l14_control_applicability_heads drop constraint l14_control_applicability_heads_state_fkey;
        alter table gov_repo.l14_control_applicability_heads drop constraint l14_control_applicability_heads_pkey;
        alter table gov_repo.l14_control_applicability_heads add constraint l14_control_applicability_heads_pkey primary key (organisation_id, target_key, control_definition_id, control_definition_version_id);`,
      /pinned set|head key|FK set wrong/],
      ['head key widened with content_hash', `alter table gov_repo.l14_control_applicability_heads add column content_hash character(64) check (content_hash::text ~ '^[0-9a-f]{64}$');
        create unique index s1c4_head_hash_uidx on gov_repo.l14_control_applicability_heads (organisation_id, target_key, control_definition_id, content_hash);`, /pinned set|head key/],
      ['head key narrowed (control definition dropped from the key)', `alter table gov_repo.l14_control_applicability_heads drop constraint l14_control_applicability_heads_state_fkey;
        alter table gov_repo.l14_control_applicability_heads drop constraint l14_control_applicability_heads_pkey;
        alter table gov_repo.l14_control_applicability_heads add constraint l14_control_applicability_heads_pkey primary key (organisation_id, target_key);`,
      /head key|FK set wrong/],
      // Target union / outcome / fact subject relaxation.
      ['target union CHECK weakened (hybrid allowed)', union('l14_control_applicability_states',
        `target_type in ('CANONICAL_OBJECT','RELATIONSHIP_STATE')`), /relaxed/],
      ['target union CHECK dropped on proposals', 'alter table gov_repo.l14_control_applicability_proposals drop constraint l14_control_applicability_proposals_target_union_check;',
        /relaxed/],
      ['target union CHECK weakened on heads (bare state id)', union('l14_control_applicability_heads',
        `(target_type = 'CANONICAL_OBJECT' AND target_canonical_kind IS NOT NULL AND target_canonical_object_id IS NOT NULL AND target_relationship_id IS NULL AND target_relationship_state_id IS NULL)
         OR (target_type = 'RELATIONSHIP_STATE' AND target_canonical_kind IS NULL AND target_canonical_object_id IS NULL AND target_relationship_state_id IS NOT NULL)`), /relaxed/],
      ['target type CHECK widened', `alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_target_type_check;
        alter table gov_repo.l14_control_applicability_states add constraint l14_control_applicability_states_target_type_check check
          (target_type in ('CANONICAL_OBJECT','RELATIONSHIP_STATE','RELATIONSHIP'));`, /relaxed/],
      ['applicability CHECK widened (UNKNOWN stored)', `alter table gov_repo.l14_control_applicability_states drop constraint l14_control_applicability_states_applicability_check;
        alter table gov_repo.l14_control_applicability_states add constraint l14_control_applicability_states_applicability_check check
          (applicability in ('APPLIES','DOES_NOT_APPLY','UNKNOWN'));`, /relaxed/],
      ['applicability CHECK widened (SATISFIED)', `alter table gov_repo.l14_control_applicability_proposals drop constraint l14_control_applicability_proposals_applicability_check;
        alter table gov_repo.l14_control_applicability_proposals add constraint l14_control_applicability_proposals_applicability_check check
          (applicability in ('APPLIES','DOES_NOT_APPLY','SATISFIED'));`, /relaxed/],
      ['fact subject widened with CONTROL_ASSESSMENT', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check
          (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT'));`, /relaxed/],
      ['second fact subject CHECK added', `alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_probe_check check (subject_kind <> 'X');`, /relaxed/],
      ['governance decisions admit CONTROL_ASSESSMENT', `alter table gov_repo.l14_governance_decisions drop constraint l14_governance_decisions_subject_kind_check;
        alter table gov_repo.l14_governance_decisions add constraint l14_governance_decisions_subject_kind_check check (subject_kind in (
          'AUTHORITY_POLICY_VERSION','GOVERNANCE_PARTY','BUSINESS_DOMAIN','INFORMATION_DOMAIN','CONTROL_DEFINITION','POLICY_VERSION',
          'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')) not valid;`, /relaxed/],
      ['fact guard widened with CONTROL_ASSESSMENT', guardBody(`'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT'`),
        /fact guard subject vocabulary/],
      ['fact guard narrowed (CONTROL_APPLICABILITY dropped)', guardBody(`'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY'`),
        /fact guard subject vocabulary/],
      ['authorization applicability target CHECK dropped', 'alter table gov_repo.l14_authorization_decisions drop constraint l14_authorization_decisions_control_applicability_target_check;',
        /relaxed/],
      ['target key encoder made non-injective', `set local role postgres; create or replace function gov_repo.l14_control_applicability_target_key_v1(p_target_type text,
          p_target_canonical_kind text, p_target_canonical_object_id text, p_target_relationship_id text, p_target_relationship_state_id text)
          returns text language sql immutable parallel safe set search_path = pg_catalog, pg_temp
          as $$ select coalesce(p_target_canonical_object_id, p_target_relationship_state_id) $$; reset role;`, /target key/],
      ['free-text rationale on proposals', `alter table gov_repo.l14_control_applicability_proposals add column rationale text check (length(rationale) < 10);`, /pinned set/],
      ['control code column on states', `alter table gov_repo.l14_control_applicability_states add column control_code text check (length(control_code) < 50);`, /pinned set/],
      ['cg_* flag column on proposals', `alter table gov_repo.l14_control_applicability_proposals add column cg_has_owner boolean;`, /pinned set/],
      ['caller relationship type column on states', `alter table gov_repo.l14_control_applicability_states add column relationship_type text check (length(relationship_type) < 50);`, /pinned set/],
      ['JSON metadata column', 'alter table gov_repo.l14_control_applicability_proposals add column metadata jsonb;', /JSON column/],
      // Frozen enumerations and F2.
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','CONTROL')) not valid;`, /canonical object kinds \(11\)/],
      ['relationship type added (CONTROLLED_BY)', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP',
          'INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','CONTROLLED_BY')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1C.4 routine attached to canonical_relationships', `create trigger s1c4_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_control_applicability_head_guard_v1();`, /F2 boundary/],
      ['F2: unique relationship_state_id introduced', `create unique index s1c4_rel_state_uidx on gov_repo.canonical_relationships (organisation_id, relationship_state_id);`,
        /F2 boundary/],
      ['F2: FK from an applicability table onto canonical_relationships', `alter table gov_repo.l14_control_applicability_states add constraint l14_control_applicability_states_rel_fkey
        foreign key (organisation_id, target_relationship_id) references gov_repo.canonical_relationships (organisation_id, relationship_id);`, /F2 boundary|FK set wrong/],
      ['F2: trigger attached to canonical_relationships', `create function public.s1c4_noop() returns trigger language plpgsql as $f$ begin return new; end $f$;
        create trigger s1c4_noop before insert on gov_repo.canonical_relationships for each row execute function public.s1c4_noop();`, /F2 boundary/],
      ['F2: relationship_state_id CHECK / DDL attached', `alter table gov_repo.canonical_relationships add constraint s1c4_state_check check (relationship_state_id <> '') not valid;`,
        /F2 boundary/],
      ['a new S1C.4 routine reads canonical_relationships directly', `set local role postgres; create or replace function gov_repo.l14_control_applicability_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin perform 1 from gov_repo.canonical_relationships; return new; end $h$; reset role;`, /canonical relationships outside/],
      ['a new S1C.4 routine reads control definition content', `set local role postgres; create or replace function gov_repo.l14_control_applicability_head_guard_v1()
          returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp
          as $h$ begin perform 1 from gov_repo.l14_control_definition_versions v where v.control_code = 'CG-AG-001'; return new; end $h$; reset role;`,
      /control definition content|CG-AG flag/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1C4_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '41|1', 'a genuine pgcrypto member is excluded');
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '41|0');
    assert.equal(await one(`select count(*) from pg_proc where proname in ('s1c4_probe','s1c4_noop')`), '0');
    assert.equal(await one(F2_DIGEST), f2Snapshot, 'every F2 probe was rolled back');
    await owner(block);
  });

  await t.test('the new SQL reads only the admitted / validated CONTROL_DEFINITION lineage; never content, cg_*, other families; F2 read-only', async () => {
    const sources = await owner(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/(^|[^A-Za-z0-9_$])governance_policies([^A-Za-z0-9_$]|$)/, /(^|[^A-Za-z0-9_$])policy_versions([^A-Za-z0-9_$]|$)/,
      /content_markdown/, /current_version_id/, /policy_mandate_mappings/, /\bmandates\b/, /l14_policy_/, /POLICY_APPLICABILITY/, /(^|[^_])POLICY_VERSION/,
      /l14_domain_/, /l14_governance_part/, /l14_responsibility_/, /l14_business_context_/, /CONTROL_ASSESSMENT/, /control_code/, /\btitle\b/,
      /directory_profile/, /\bemail\b/i, /governance_users/, /\blabel\b/, /\bdescription\b/, /classif/i, /scanner/i, /\bllm\b/i, /similarity/i,
      /semantic_representation/, /\bcg_/i, /cg-ag/i, /ai_systems/, /\brisk/i, /\bscore/i, /satisf/i, /coverage/i, /\bstatus\b/, /approved_by/,
      /canonical_relationships/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\.(l14_control_definition|l14_registry_states|l14_policy_|governance_policies|policy_versions|canonical_relationships|canonical_objects)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
    // The S1B.6 identity / version / state lineage, the S1B.6 resolver, the exact S1B.6 guard key, the reused S1C.3 relationship-state
    // resolver and both evaluators are READ (required).
    for (const required of [/gov_repo\.l14_control_definitions\b/, /gov_repo\.l14_control_definition_versions/, /gov_repo\.l14_control_definition_states/,
      /gov_repo\.l14_control_definition_valid_state_v1/, /'l14-registry-subject-guard-v1', 'CONTROL_DEFINITION'/, /'CONTROL_DEFINITION_VALIDATION:'/,
      /gov_repo\.l14_evaluate_target_authority_rules_v1/, /gov_repo\.l14_evaluate_relationship_state_authority_rules_v1/,
      /gov_repo\.l14_resolve_relationship_state_target_v1/]) {
      assert.match(sources, required, String(required));
    }
    // Among the L14 routines canonical_relationships is read ONLY by the pre-existing S1A rule-scope validator (exact triple,
    // read-only) and the reused S1C.3 exact-triple resolver — never by an S1C.4 RPC, guard, resolver or read primitive.
    assert.equal(await one(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='gov_repo'::regnamespace
      and proname like 'l14\\_%' and prosrc ~ 'canonical_relationships'`), 'l14_parse_authority_policy_rules_v1,l14_resolve_relationship_state_target_v1');
  });
});
