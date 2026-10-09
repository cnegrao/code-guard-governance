import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE } from '@council/canonical-contracts';
import { l14BusinessContextAssignmentMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { INVENTORY_SQL, type InventoryRow } from '../helpers/m16-definer-surface-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.2 — privilege closure, preflight, postflight negative controls (one per privilege / structure class) and
 * structural invariants on real disposable PostgreSQL 17. The S1C2 horizon is stopped right before the S1C.2 migration so
 * the suite can seed real S1C.1 / S1B.5 history, snapshot the merged S1C.1 catalog, prove the preflight aborts atomically,
 * then apply the migration itself. Every control runs inside a rolled-back bootstrap transaction; historical postflights are
 * never altered.
 */
const NEW_RPCS = [
  'gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text[],text)',
  'gov_repo.l14_decide_business_context_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)',
] as const;
const NEW_HELPERS = [
  'gov_repo.l14_business_context_assignment_proposal_guard_v1()', 'gov_repo.l14_business_context_assignment_state_guard_v1()',
  'gov_repo.l14_business_context_assignment_head_guard_v1()', 'gov_repo.l14_lock_domain_dependency_guard_shared_v1(uuid,text,text)',
  'gov_repo.l14_business_context_assignment_command_result_v1(uuid,text,boolean)',
  'gov_repo.l14_business_context_assignment_valid_state_v1(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
  'gov_repo.l14_business_context_assignments_current_v1(uuid,text,text,timestamp with time zone,timestamp with time zone)',
] as const;
const FACT_GUARD = 'gov_repo.l14_lock_fact_subject_guard_v1(uuid,text,text[])';
const NEW_TABLES = ['gov_repo.l14_business_context_assignment_states', 'gov_repo.l14_business_context_assignment_proposals',
  'gov_repo.l14_business_context_assignment_heads'] as const;
/** The four S1A / S1B / S1C.1 framework tables S1C.2 widens (closed CHECKs only); their rows are never rewritten. */
const WIDENED = ['l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results', 'l14_fact_states'] as const;
const postflight = () => {
  const text = migrationSource(l14BusinessContextAssignmentMigration);
  const block = text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;') + '$postflight$;'.length);
  assert.ok(block.startsWith('DO $postflight$') && block.includes('M16_S1C2_POSTFLIGHT'));
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
/** Every pre-S1C.2 routine body + config + ACL in gov_repo, except the one widened fact guard (S1C.2 replaces nothing else). */
const ROUTINE_DIGEST = `select md5(string_agg(oid::regprocedure::text||':'||encode(sha256(convert_to(prosrc,'UTF8')),'hex')||':'||coalesce(array_to_string(proconfig,';'),'-')
  ||':'||coalesce(proacl::text,'-'), ',' order by oid::regprocedure::text collate "C")) from pg_proc
  where pronamespace='gov_repo'::regnamespace and proname not like 'l14\\_%business\\_context%'
    and proname not in ('l14_lock_fact_subject_guard_v1','l14_lock_domain_dependency_guard_shared_v1')`;
/** Every pre-S1C.2 gov_repo table definition except the four widened framework tables and the new S1C.2 tables. */
const TABLE_DIGEST = `select md5(string_agg(c.oid::regclass::text||'|'||coalesce(c.relacl::text,'-')||'|'||c.relrowsecurity::text||'|'||
  coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull, ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'')||'|'||
  coalesce((select string_agg(conname||':'||pg_get_constraintdef(k.oid), ',' order by conname) from pg_constraint k where k.conrelid=c.oid),'')||'|'||
  coalesce((select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),''),
  ',' order by c.oid::regclass::text collate "C")) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m')
  and c.relname not like 'l14\\_business\\_context%'
  and c.relname not in (${WIDENED.map(t => `'${t}'`).join(',')})`;
/** Every existing row of the widened framework tables (never rewritten). */
const ROWS_DIGEST = `select md5(string_agg(x, '|' order by x)) from (${WIDENED.map(t =>
  `select '${t}:'||to_jsonb(t)::text as x from gov_repo.${t} t`).join(' union all ')}) s`;
/** Every pre-existing constraint definition of the widened tables except the closed CHECKs S1C.2 re-states. */
const WIDENED_CONSTRAINTS = `select md5(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in (${WIDENED.map(t => `'gov_repo.${t}'::regclass`).join(',')})
  and conname not in ('l14_governance_decisions_subject_kind_check','l14_governance_decisions_reason_code_check','l14_command_results_subject_kind_check',
    'l14_command_results_shape_check','l14_fact_states_subject_kind_check','l14_authorization_decisions_business_context_target_check')`;

test('M16 S1C.2 privilege closure, preflight, postflight negative controls (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C2', stopBefore: l14BusinessContextAssignmentMigration });
  t.after(() => c.stop());
  const { owner, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const inventory = async (): Promise<InventoryRow[]> => JSON.parse(await bootstrapSql(INVENTORY_SQL));

  // Real pre-S1C.2 history: an S1C.1 responsibility lifecycle (VALIDATED + REVOKED, with support) and an S1B.5 domain
  // lifecycle. The widened framework must keep every row byte-identical and every historical command replayable.
  const rk = await responsibilityKit(c);
  const hist = await rk.setup();
  await c.evidence(hist.org, 'hist-ev');
  const histParty = await rk.party(hist, 'hist');
  const histKey = rk.keyOf('AGENT', hist.objects.agent, 'BUSINESS_OWNER', histParty.partyId);
  const histAssign = await rk.assign(hist, 'hist', histKey, histParty);
  const histRevoke = await rk.revoke(hist, 'hist', histKey, histParty.stateId, histAssign.stateId);
  assert.equal(histRevoke.decided.outcome, 'REVOKED');
  const k = await businessContextKit(c);
  const dctx = await k.setup();
  const histDomain = await k.domain(dctx, 'hist-dom');
  const f2Before = await one(F2_DIGEST);
  const routinesBefore = await one(ROUTINE_DIGEST);
  const tablesBefore = await one(TABLE_DIGEST);
  const rowsBefore = await one(ROWS_DIGEST);
  const constraintsBefore = await one(WIDENED_CONSTRAINTS);
  const factGuardBefore = await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
    from pg_proc where oid='${FACT_GUARD}'::regprocedure`);
  const inventoryBefore = await inventory();
  assert.equal(inventoryBefore.filter(p => p.app).length, 35, 'the merged S1C.1 application definer surface is 35');
  assert.equal(inventoryBefore.filter(p => p.app && p.owner_store).length, 25, 'the merged S1C.1 canonical-owner (policy-store-capable) class is 25');

  await t.test('preflight: the exact merged S1C.1 baseline is required; each break aborts atomically with nothing applied', async () => {
    const notApplied = async () => {
      assert.equal(await one(`select coalesce(to_regclass('gov_repo.l14_business_context_assignment_states')::text, 'absent')`), 'absent');
      assert.equal(await one(`select count(*) from pg_proc where proname like 'l14\\_%business\\_context%'`), '0');
      assert.equal(await one(`select pg_get_constraintdef(oid) from pg_constraint where conname='l14_fact_states_subject_kind_check'`),
        "CHECK ((subject_kind = 'RESPONSIBILITY_ASSIGNMENT'::text))");
      assert.equal(await one(ROUTINE_DIGEST), routinesBefore);
      assert.equal(await one(ROWS_DIGEST), rowsBefore);
    };
    const decide = 'gov_repo.l14_decide_responsibility_assignment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text)';
    for (const [name, brk, fix, message] of [
      ['extra application definer', `create function public.s1c2_probe() returns integer language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        grant execute on function public.s1c2_probe() to service_role`, 'drop function public.s1c2_probe()', /not exactly the 35 S1C\.1 baseline/],
      ['S1C.1 RPC config drift', `alter function ${decide} set lock_timeout = '6s'`, `alter function ${decide} set lock_timeout = '5s'`,
        /differs from its merged S1C\.1 owner\/body\/config/],
      ['unexpected l14 relation', 'create table gov_repo.l14_probe (id int)', 'drop table gov_repo.l14_probe', /unexpected l14 relation set/],
      ['S1C.1 horizon absent', 'alter table gov_repo.l14_responsibility_assignment_heads rename to l14_responsibility_assignment_heads_x',
        'alter table gov_repo.l14_responsibility_assignment_heads_x rename to l14_responsibility_assignment_heads', /unexpected l14 relation set/],
      ['fact envelope already widened', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT'))`,
      `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check (subject_kind in ('RESPONSIBILITY_ASSIGNMENT'))`,
      /keys missing or already widened/],
      ['S1B.5 domain dependency key absent', `alter table gov_repo.l14_domain_states rename constraint l14_domain_states_kind_unique to l14_domain_states_kind_unique_x`,
        `alter table gov_repo.l14_domain_states rename constraint l14_domain_states_kind_unique_x to l14_domain_states_kind_unique`,
        /keys missing or already widened/],
    ] as const) {
      await bootstrapSql(`set role postgres; ${brk}`);
      try {
        await assert.rejects(c.migrate(l14BusinessContextAssignmentMigration), (error: Error) => {
          assert.match(error.message, /M16_S1C2_PREFLIGHT/, `${name}: ${error.message}`);
          assert.match(error.message, message, name);
          return true;
        });
      } finally { await bootstrapSql(`set role postgres; ${fix}`); }
      await notApplied();
    }
    // Pre-existing BUSINESS_CONTEXT_ASSIGNMENT governance history (no earlier slice could write any) aborts the preflight.
    const text = migrationSource(l14BusinessContextAssignmentMigration);
    const pre = text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;') + '$preflight$;'.length);
    await assert.rejects(bootstrapSql(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,
      submitted_by_actor_user_id,support_status,submitted_at) values ('${hist.org}',gen_random_uuid(),'BUSINESS_CONTEXT_ASSIGNMENT','VALIDATE','LOCAL_HUMAN',
      '${hist.member.id}','NONE',now()); ${pre} rollback;`), /M16_S1C2_PREFLIGHT: business context assignment governance history already exists/);
    await bootstrapSql(`begin; ${pre} rollback;`);
    await notApplied();
  });

  await t.test('the migration applies once; its postflight re-executes cleanly; historical shapes / rows / routines are untouched', async () => {
    await c.migrate(l14BusinessContextAssignmentMigration);
    await assert.rejects(c.migrate(l14BusinessContextAssignmentMigration), /M16_S1C2_PREFLIGHT/, 'not re-appliable');
    await owner(postflight());
    assert.equal(await one(ROUTINE_DIGEST), routinesBefore, 'every pre-S1C.2 gov_repo routine body / config / ACL is byte-identical (except the widened fact guard)');
    assert.equal(await one(TABLE_DIGEST), tablesBefore, 'no other pre-S1C.2 gov_repo table / view is altered');
    assert.equal(await one(ROWS_DIGEST), rowsBefore, 'every historical S1A / S1B / S1C.1 framework + fact row is unchanged (no rewrite, no backfill)');
    assert.equal(await one(WIDENED_CONSTRAINTS), constraintsBefore, 'every other constraint of the widened tables is unchanged');
    // The fact guard keeps its owner, owner-only ACL, invoker mode and config; only its closed vocabulary widened.
    assert.equal(await one(`select coalesce(proacl::text,'-')||'|'||array_to_string(proconfig,';')||'|'||prosecdef::text||'|'||pg_get_userbyid(proowner)
      from pg_proc where oid='${FACT_GUARD}'::regprocedure`), factGuardBefore);
    assert.equal(await one(`select (prosrc like '%NOT IN (''RESPONSIBILITY_ASSIGNMENT'',''BUSINESS_CONTEXT_ASSIGNMENT'')%')::text from pg_proc
      where oid='${FACT_GUARD}'::regprocedure`), 'true');
    // Historical commands still replay their ORIGINAL durable result after the widening.
    const replayed = await c.exec(rk.decideSql(hist.rs, { commandId: hist.cmd('hist-revoke'), proposalId: histRevoke.submitted.proposal_id,
      proposal: histRevoke.proposal, outcome: 'REVOKE', expected: histAssign.stateId }));
    assert.deepEqual([replayed.replay, replayed.fact_state_id, replayed.recorded_at],
      [true, histRevoke.decided.fact_state_id, histRevoke.decided.recorded_at]);
    // The S1C.1 rows can never be re-labelled as the new family (rolled back).
    await assert.rejects(bootstrapSql(`begin; set local role postgres; update gov_repo.l14_fact_states set subject_kind='BUSINESS_CONTEXT_ASSIGNMENT'
      where organisation_id='${hist.org}'; rollback;`), /L14_HISTORY_IMMUTABLE|fkey|violates/);
  });

  await t.test('definer surface 35 -> 37 / canonical-owner class 25 -> 27: the 35 untouched identities are unchanged; exact hashes, owners, config', async () => {
    const after = await inventory();
    const before = new Map(inventoryBefore.map(p => [p.fn, p]));
    for (const row of after.filter(p => before.has(p.fn))) assert.deepEqual(row, before.get(row.fn), `${row.fn} unchanged`);
    const added = after.filter(p => !before.has(p.fn));
    assert.deepEqual(added.map(p => p.fn).sort(), [...NEW_RPCS].sort(), 'exactly the two new RPCs');
    for (const row of added) {
      assert.deepEqual([row.owner, row.app, row.public, row.anon, row.authenticated, row.service_role, row.owner_store, row.config],
        ['postgres', true, false, false, false, true, true, 'search_path=pg_catalog, pg_temp;lock_timeout=5s'], row.fn);
    }
    assert.equal(after.filter(p => p.app).length, 37);
    assert.equal(after.filter(p => p.app && p.owner_store).length, 27);
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '37|0');
    const text = migrationSource(l14BusinessContextAssignmentMigration);
    const postBlock = text.slice(text.indexOf('DO $postflight$'));
    for (const sig of NEW_RPCS) {
      assert.equal(await one(`select proacl::text from pg_proc where oid='${sig}'::regprocedure`), '{postgres=X/postgres,service_role=X/postgres}', sig);
      const sha = await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='${sig}'::regprocedure`);
      assert.ok(postBlock.includes(`('${sig}', 'postgres', '${sha}', 'search_path=pg_catalog, pg_temp;lock_timeout=5s')`), `${sig} body hash pinned`);
      // Owner capability is not body-level need: no S1C.2 body reaches a policy store, the control registry, Party PII or F2.
      assert.equal(await one(`select (prosrc ~ '(governance_policies|policy_versions|l14_policy_|l14_control_definition|directory_profile|canonical_relationships|l14_responsibility_)')::text
        from pg_proc where oid='${sig}'::regprocedure`), 'false', sig);
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
      for (const table of WIDENED) {
        await assert.rejects(c.sql(`update gov_repo.${table} set organisation_id=organisation_id`, role), /42501|permission denied/, `${role}: ${table}`);
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sig of NEW_RPCS) {
        assert.equal(await one(`select has_function_privilege('${role}', '${sig}'::regprocedure, 'EXECUTE')::text`), 'false', `${role} ${sig}`);
      }
      await assert.rejects(c.sql(`select * from gov_repo.l14_submit_business_context_assignment_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        'VALIDATE', 'LOCAL_HUMAN', 'AGENT', 'x', 'BUSINESS_DOMAIN', 'd', gen_random_uuid(), null, null, null, null, 'NONE', '{}', repeat('a',64))`, role),
      /42501|permission denied/, `${role} submit`);
      await assert.rejects(c.sql(`select * from gov_repo.l14_decide_business_context_assignment_proposal_v1(gen_random_uuid(), gen_random_uuid(), 0, 0, now(), 'c',
        gen_random_uuid(), 'VALIDATE', 'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED', null, 'NONE', '{}', repeat('a',64))`, role), /42501|permission denied/, `${role} decide`);
    }
    const all = `array[${[...NEW_RPCS, ...NEW_HELPERS, FACT_GUARD].map(sig => `'${sig}'::regprocedure`).join(',')}]::oid[]`;
    assert.equal(await one(`select string_agg(oid::regprocedure::text, ',' order by oid::regprocedure::text collate "C") from pg_proc
      where oid = any(${all}) and has_function_privilege('service_role', oid, 'EXECUTE')`), [...NEW_RPCS].sort().join(','),
    'service_role: exactly the two new RPCs');
    for (const [name, call] of [
      ['resolver', `select * from gov_repo.l14_business_context_assignment_valid_state_v1(gen_random_uuid(), 'AGENT', 'x', 'BUSINESS_DOMAIN', now(), now())`],
      ['current read', `select * from gov_repo.l14_business_context_assignments_current_v1(gen_random_uuid(), 'AGENT', 'x', now(), now())`],
      ['result projection', `select * from gov_repo.l14_business_context_assignment_command_result_v1(gen_random_uuid(), 'x', false)`],
      ['shared domain guard', `select gov_repo.l14_lock_domain_dependency_guard_shared_v1(gen_random_uuid(), 'BUSINESS_DOMAIN', 'x')`],
      ['fact guard', `select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), 'BUSINESS_CONTEXT_ASSIGNMENT', array['KEY','x'])`],
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
    const ctx = await k.setup();
    const d = await k.domain(ctx, 'acl');
    const key = k.keyOf('AGENT', ctx.objects.agent, 'BUSINESS_DOMAIN');
    const a = await k.assign(ctx, 'acl', key, d);
    assert.equal(a.decided.outcome, 'VALIDATED');
    for (const statement of [`update gov_repo.l14_business_context_assignment_heads set latest_state_id=null`,
      `update gov_repo.l14_business_context_assignment_states set domain_id='other'`,
      `insert into gov_repo.l14_business_context_assignment_heads(organisation_id,target_kind,target_canonical_object_id,semantic_kind)
        values ('${ctx.org}','AGENT','x','BUSINESS_DOMAIN')`,
      `delete from gov_repo.l14_business_context_assignment_proposals`]) {
      await assert.rejects(c.sql(statement, 'service_role'), /42501|permission denied/, statement);
    }
    for (const statement of [`update gov_repo.l14_fact_states set effective_to=now() where fact_state_id='${a.stateId}'`,
      `update gov_repo.l14_business_context_assignment_states set domain_id=${`'${histDomain.subject.domainId}'`} where fact_state_id='${a.stateId}'`,
      `delete from gov_repo.l14_business_context_assignment_proposals where organisation_id='${ctx.org}'`,
      'truncate gov_repo.l14_business_context_assignment_states cascade',
      `delete from gov_repo.l14_business_context_assignment_heads where organisation_id='${ctx.org}'`,
      `update gov_repo.l14_business_context_assignment_heads set semantic_kind='INFORMATION_DOMAIN' where organisation_id='${ctx.org}'`]) {
      await assert.rejects(bootstrapSql(`begin; set local role postgres; ${statement}; rollback;`), /L14_HISTORY_IMMUTABLE/, statement);
    }
  });

  await t.test('structural: no JSON / label / description / rationale / score column; 11 kinds + 12 relationship types; canonical_relationships untouched', async () => {
    const rels = NEW_TABLES.map(t => `'${t}'::regclass`).join(',');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and atttypid in ('json'::regtype,'jsonb'::regtype)`), '0', 'no JSON / EAV');
    assert.equal(await one(`select count(*) from pg_attribute where attrelid in (${rels}) and attnum>0 and not attisdropped
      and attname ~ '(name|label|descr|path|source_system|tag|category|classif|rationale|note|comment|reason|score|weight|risk|confidence|similar|^status$|approv|cg_|owner|party|email)'`),
    '0', 'no label / description / category / classification / rationale / score / owner / PII column');
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
    assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /DOMAIN|CONTEXT|TERM/.test(kind)), 'no domain / business-context kind');
    assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /DOMAIN|CONTEXT|BELONGS/.test(type)),
      'no BELONGS_TO_DOMAIN / IN_DOMAIN / HAS_*_DOMAIN type');
    assert.equal(await one(F2_DIGEST), f2Before, 'F2: canonical_relationships structure, ACL and rows untouched');
    assert.equal(await one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid::regclass::text like 'gov_repo.l14\\_%'`), '0', 'no FK to canonical_relationships');
    // The head key is exactly target + semantic kind (never the domain).
    assert.equal(await one(`select string_agg(a.attname, ',' order by k.ord) from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(n, ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n where c.conrelid='gov_repo.l14_business_context_assignment_heads'::regclass and c.contype='p'`),
    'organisation_id,target_kind,target_canonical_object_id,semantic_kind');
  });

  await t.test('postflight negative controls: every privilege / structure drift class fails it; extension members never mask a non-member', async () => {
    const block = postflight();
    const inTxn = (setup: string, probe = '') => bootstrapSql(`begin;\n${setup}\n${block}\n${probe}\nrollback;`);
    assert.equal(await inTxn('', SURFACE_SPLIT_SQL), '37|0', 'baseline passes');
    const member = 'extensions.armor(bytea)';
    const memberDefiner = `alter function ${member} security definer; grant execute on function ${member} to public, anon, authenticated, service_role;`;
    const definer = (schema: string, grantee: string) => `create function ${schema}.s1c2_probe() returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1';
      revoke execute on function ${schema}.s1c2_probe() from public; grant execute on function ${schema}.s1c2_probe() to ${grantee};`;
    const decideBody = (body: string) => `set local role postgres; create or replace function gov_repo.l14_decide_business_context_assignment_proposal_v1(
          p_verified_organisation_id uuid, p_verified_actor_user_id uuid, p_verified_session_iat bigint, p_verified_session_exp bigint,
          p_verified_credential_epoch timestamptz, p_command_id text, p_proposal_id uuid, p_outcome text, p_reason_code text,
          p_expected_current_state_id uuid, p_support_status text, p_support_evidence_ids text[], p_caller_fingerprint text)
        returns table (replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
          authorization_decision_id uuid, authorization_result text, deny_reason text, expectation_kind text, expected_current_state_id uuid,
          proposal_id uuid, governance_decision_id uuid, target_kind text, target_canonical_object_id text, semantic_kind text,
          domain_id text, domain_validated_state_id uuid, fact_state_id uuid, state_kind text, predecessor_state_id uuid,
          effective_from timestamptz, effective_to timestamptz, recorded_at timestamptz)
        language sql volatile security definer set search_path = pg_catalog, pg_temp set lock_timeout = '5s'
        as $$ ${body} $$; reset role;`;
    const nulls = `null::boolean, null, null, null, 'DENIED', null, null::uuid, null, null, null, null::uuid, null::uuid, null::uuid, null, null, null,
      null, null::uuid, null::uuid, null, null::uuid, null::timestamptz, null::timestamptz, null::timestamptz`;
    const guardBody = (subjects: string, key = `ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1', p_subject_kind] || p_key_parts`) =>
      `set local role postgres; create or replace function gov_repo.l14_lock_fact_subject_guard_v1(p_organisation_id uuid, p_subject_kind text, p_key_parts text[])
        returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
        if p_subject_kind not in (${subjects}) then raise exception 'x'; end if;
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(gov_repo.frame_identity(${key}), 0)); end $g$; reset role;`;
    const controls: Array<[string, string, RegExp]> = [
      // Table privilege classes (direct DML, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), column grants, inherited paths.
      ['service_role direct INSERT on states', 'grant insert on gov_repo.l14_business_context_assignment_states to service_role;', /non-owner table grant|holds/],
      ['service_role UPDATE on heads', 'grant update on gov_repo.l14_business_context_assignment_heads to service_role;', /non-owner table grant|holds/],
      ['service_role DELETE on proposals', 'grant delete on gov_repo.l14_business_context_assignment_proposals to service_role;', /non-owner table grant|holds/],
      ['TRUNCATE on states', 'grant truncate on gov_repo.l14_business_context_assignment_states to authenticated;', /non-owner table grant|holds/],
      ['REFERENCES on proposals', 'grant references on gov_repo.l14_business_context_assignment_proposals to anon;', /non-owner table grant|holds/],
      ['TRIGGER on heads', 'grant trigger on gov_repo.l14_business_context_assignment_heads to service_role;', /non-owner table grant|holds/],
      ['MAINTAIN on states', 'grant maintain on gov_repo.l14_business_context_assignment_states to service_role;', /non-owner table grant|holds/],
      ['service_role INSERT on the shared fact envelope', 'grant insert on gov_repo.l14_fact_states to service_role;', /non-owner table grant|holds/],
      ['column SELECT on states', 'grant select (domain_id) on gov_repo.l14_business_context_assignment_states to authenticated;',
        /column-level grants|column privilege|holds/],
      ['column UPDATE on head', 'grant update (latest_state_id) on gov_repo.l14_business_context_assignment_heads to service_role;',
        /column-level grants|column privilege|holds/],
      ['sequence owned by business-context history → anon', `set local role postgres; create sequence gov_repo.s1c2_leak owned by gov_repo.l14_business_context_assignment_states.fact_state_id;
        reset role; grant usage on sequence gov_repo.s1c2_leak to anon;`, /sequence/],
      ['readable view over states → service_role', 'create view public.s1c2_leak as select * from gov_repo.l14_business_context_assignment_states; grant select on public.s1c2_leak to service_role;', /view/],
      ['writable nested view over head → authenticated', `create view public.s1c2_leak as select * from gov_repo.l14_business_context_assignment_heads;
        create view public.s1c2_leak2 as select * from public.s1c2_leak; grant update on public.s1c2_leak2 to authenticated;`, /view/],
      ['updatable view over proposals with PUBLIC', 'create view public.s1c2_leak as select * from gov_repo.l14_business_context_assignment_proposals; grant insert, update on public.s1c2_leak to public;', /view/],
      ['gov_repo routine default → service_role', 'alter default privileges for role postgres in schema gov_repo grant execute on functions to service_role;', /default privileges/],
      ['global routine default → PUBLIC', 'alter default privileges for role postgres grant execute on functions to public;', /default privileges/],
      ['inherited via owner membership', 'grant postgres to authenticated;', /holds/],
      ['inherited via an intermediate role', `create role s1c2_leak_parent nologin; grant select on gov_repo.l14_business_context_assignment_proposals to s1c2_leak_parent;
        grant s1c2_leak_parent to service_role;`, /non-owner table grant|holds/],
      ['table inheritance from business-context history', 'create table public.s1c2_child () inherits (gov_repo.l14_business_context_assignment_states);', /inheritance/],
      ['permissive policy on states', 'create policy s1c2_probe on gov_repo.l14_business_context_assignment_states for select to service_role using (true);', /RLS policy/],
      ['permissive policy on heads', 'create policy s1c2_probe on gov_repo.l14_business_context_assignment_heads for all to authenticated using (true) with check (true);', /RLS policy/],
      ['RLS disabled on proposals', 'alter table gov_repo.l14_business_context_assignment_proposals disable row level security;', /RLS-enabled/],
      // Routine EXECUTE classes, unexpected definers, drift.
      ...(['public', 'anon', 'authenticated', 'service_role'] as const).map(g => [`public definer → ${g}`, definer('public', g), /CLOSED_SURFACE/] as [string, string, RegExp]),
      ['unexpected gov_repo definer → service_role', definer('gov_repo', 'service_role'), /CLOSED_SURFACE/],
      ['overload of a new RPC', `set local role postgres; create function gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid) returns integer language sql security definer
        set search_path = pg_catalog, pg_temp as 'select 1'; revoke all on function gov_repo.l14_submit_business_context_assignment_proposal_v1(uuid) from public; reset role;`,
      /overload|nineteen S1C\.1 \+ two S1C\.2|ACL\/definer shape/],
      ['member + non-member definer', `${memberDefiner} ${definer('public', 'service_role')}`, /CLOSED_SURFACE/],
      ['decide RPC body drift', decideBody(`select ${nulls}`), /body hash changed/],
      ['decide RPC body reaching a policy store', decideBody(`select ${nulls} from gov_repo.governance_policies limit 0`), /body hash changed|reaches a policy/],
      ['decide RPC body reaching canonical relationships', decideBody(`select ${nulls} from gov_repo.canonical_relationships limit 0`), /body hash changed|canonical relationships/],
      ['RPC search_path drift', `alter function ${NEW_RPCS[0]} set search_path = gov_repo, pg_catalog, pg_temp;`, /search_path|config changed/],
      ['RPC owner drift', `create role s1c2_owner nologin; alter function ${NEW_RPCS[1]} owner to s1c2_owner;`, /owner|CLOSED_SURFACE|ACL\/definer shape/],
      ['resolver made service_role-executable', `grant execute on function ${NEW_HELPERS[5]} to service_role;`, /owner-only SECURITY INVOKER|nineteen S1C\.1 \+ two S1C\.2/],
      ['current read made authenticated-executable', `grant execute on function ${NEW_HELPERS[6]} to authenticated;`, /executable by authenticated|owner-only/],
      ['shared domain guard made SECURITY DEFINER', `alter function ${NEW_HELPERS[3]} security definer;`, /owner-only SECURITY INVOKER/],
      ['helper search_path drift', `alter function ${NEW_HELPERS[4]} set search_path = public, pg_temp;`, /search_path not pinned/],
      ['RPC executable by anon', `grant execute on function ${NEW_RPCS[0]} to anon;`, /executable by anon|not exactly service_role/],
      ['RPC executable by authenticated', `grant execute on function ${NEW_RPCS[1]} to authenticated;`, /executable by authenticated|not exactly service_role/],
      ['RPC executable by PUBLIC', `grant execute on function ${NEW_RPCS[0]} to public;`, /PUBLIC EXECUTE|not exactly service_role|ACL/],
      ['RPC lost service_role', `revoke execute on function ${NEW_RPCS[1]} from service_role;`, /ACL\/definer shape|nineteen S1C\.1|not exactly service_role/],
      // Immutability / structural guards.
      ['state immutability trigger removed', 'drop trigger l14_business_context_assignment_states_immutable on gov_repo.l14_business_context_assignment_states;', /lacks ALWAYS raising/],
      ['proposal immutability trigger no longer ALWAYS', 'alter table gov_repo.l14_business_context_assignment_proposals enable trigger l14_business_context_assignment_proposals_immutable;',
        /lacks ALWAYS raising/],
      ['state TRUNCATE trigger disabled', 'alter table gov_repo.l14_business_context_assignment_states disable trigger l14_business_context_assignment_states_no_truncate;',
        /lacks ALWAYS raising/],
      ['fact envelope immutability trigger removed', 'drop trigger l14_fact_states_immutable on gov_repo.l14_fact_states;', /lacks ALWAYS raising/],
      ['head guard disabled', 'alter table gov_repo.l14_business_context_assignment_heads disable trigger l14_business_context_assignment_heads_guard;', /structural guard/],
      ['state guard disabled', 'alter table gov_repo.l14_business_context_assignment_states disable trigger l14_business_context_assignment_states_guard;', /structural guard/],
      ['proposal source guard disabled', 'alter table gov_repo.l14_business_context_assignment_proposals disable trigger l14_business_context_assignment_proposals_guard;',
        /structural guard/],
      // Fact-state / domain dependency FK weakening.
      ['fact envelope FK dropped', 'alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_envelope_fkey;', /FK set wrong/],
      ['fact decision FK made NOT VALID', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_decision_fkey;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_decision_fkey foreign key (organisation_id, governance_decision_id, subject_kind,
          decision_outcome, authorization_decision_id) references gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, subject_kind, outcome,
          authorization_decision_id) not valid;`, /FK set wrong/],
      ['domain dependency FK dropped', 'alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_domain_fkey;', /FK set wrong/],
      ['domain dependency FK narrowed to the admission only', `alter table gov_repo.l14_business_context_assignment_proposals drop constraint l14_business_context_assignment_proposals_domain_fkey;
        alter table gov_repo.l14_business_context_assignment_proposals add constraint l14_business_context_assignment_proposals_domain_fkey foreign key
          (organisation_id, semantic_kind, domain_id) references gov_repo.l14_domain_admissions (organisation_id, subject_kind, domain_id);`, /FK set wrong/],
      ['domain dependency FK made NOT VALID', `alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_domain_fkey;
        alter table gov_repo.l14_business_context_assignment_states add constraint l14_business_context_assignment_states_domain_fkey foreign key
          (organisation_id, domain_validated_state_id, semantic_kind, domain_id, domain_state_kind) references gov_repo.l14_domain_states
          (organisation_id, state_id, subject_kind, domain_id, state_kind) not valid;`, /FK set wrong/],
      ['target FK made deferrable', `alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_target_fkey;
        alter table gov_repo.l14_business_context_assignment_states add constraint l14_business_context_assignment_states_target_fkey foreign key
          (organisation_id, target_canonical_object_id, target_kind) references gov_repo.canonical_objects (organisation_id, canonical_object_id, kind)
          on update restrict on delete restrict deferrable initially deferred;`, /FK set wrong/],
      ['cascading FK into business-context history', `create table public.s1c2_cascade (o uuid, s uuid, foreign key (o, s) references gov_repo.l14_business_context_assignment_states (organisation_id, fact_state_id) on delete cascade);`,
        /cascading/],
      ['extra FK on a new table', `alter table gov_repo.l14_business_context_assignment_heads add constraint l14_business_context_assignment_heads_probe_fkey foreign key (organisation_id)
        references gov_repo.organisations (organisation_id);`, /FK set wrong/],
      ['lineage root index dropped', 'drop index gov_repo.l14_business_context_assignment_states_root_uidx;', /lineage keys missing/],
      ['lineage successor index dropped', 'drop index gov_repo.l14_business_context_assignment_states_successor_uidx;', /lineage keys missing/],
      // Head key widening (the domain is never part of the logical key).
      ['head key widened with domain_id', `alter table gov_repo.l14_business_context_assignment_heads add column domain_id text not null default 'x' check (length(domain_id) < 501);
        alter table gov_repo.l14_business_context_assignment_heads drop constraint l14_business_context_assignment_heads_pkey;
        alter table gov_repo.l14_business_context_assignment_heads add constraint l14_business_context_assignment_heads_pkey
          primary key (organisation_id, target_kind, target_canonical_object_id, semantic_kind, domain_id);`, /pinned set|head key/],
      ['head key widened by another column', `alter table gov_repo.l14_business_context_assignment_heads drop constraint l14_business_context_assignment_heads_state_fkey;
        alter table gov_repo.l14_business_context_assignment_heads drop constraint l14_business_context_assignment_heads_pkey;
        alter table gov_repo.l14_business_context_assignment_heads alter column latest_state_id set not null;
        alter table gov_repo.l14_business_context_assignment_heads add constraint l14_business_context_assignment_heads_pkey
          primary key (organisation_id, target_kind, target_canonical_object_id, semantic_kind, latest_state_id);`, /head key|FK set wrong/],
      ['unique index on the head including a domain column', `alter table gov_repo.l14_business_context_assignment_heads add column domain_id text check (length(domain_id) < 501);
        create unique index s1c2_head_domain_uidx on gov_repo.l14_business_context_assignment_heads (organisation_id, domain_id);`, /pinned set|head key/],
      // Semantic-kind / target-matrix / fact-subject CHECK relaxation.
      ['semantic-kind CHECK widened', `alter table gov_repo.l14_business_context_assignment_heads drop constraint l14_business_context_assignment_heads_semantic_kind_check;
        alter table gov_repo.l14_business_context_assignment_heads add constraint l14_business_context_assignment_heads_semantic_kind_check check
          (semantic_kind in ('BUSINESS_DOMAIN','INFORMATION_DOMAIN','DATA_DOMAIN'));`, /relaxed/],
      ['target-kind CHECK widened to AGENT_VERSION', `alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_target_kind_check;
        alter table gov_repo.l14_business_context_assignment_states add constraint l14_business_context_assignment_states_target_kind_check check
          (target_kind in ('AGENT','AGENT_VERSION','DATA_ASSET','DATA_ELEMENT'));`, /relaxed/],
      ['matrix CHECK weakened (AGENT + INFORMATION_DOMAIN)', `alter table gov_repo.l14_business_context_assignment_states drop constraint l14_business_context_assignment_states_matrix_check;
        alter table gov_repo.l14_business_context_assignment_states add constraint l14_business_context_assignment_states_matrix_check check
          ((target_kind = 'AGENT') OR (target_kind = 'DATA_ASSET' AND semantic_kind IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN'))
           OR (target_kind = 'DATA_ELEMENT' AND semantic_kind = 'INFORMATION_DOMAIN'));`, /relaxed/],
      ['matrix CHECK dropped', 'alter table gov_repo.l14_business_context_assignment_proposals drop constraint l14_business_context_assignment_proposals_matrix_check;', /relaxed/],
      ['fact subject widened beyond the two families', `alter table gov_repo.l14_fact_states drop constraint l14_fact_states_subject_kind_check;
        alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_kind_check check
          (subject_kind in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY'));`, /relaxed/],
      ['second fact subject CHECK added', `alter table gov_repo.l14_fact_states add constraint l14_fact_states_subject_probe_check check (subject_kind <> 'X');`, /relaxed/],
      ['fact guard widened beyond the two families', guardBody(`'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','CONTROL_ASSESSMENT'`), /fact guard subject vocabulary/],
      ['shared domain guard key drift', `set local role postgres; create or replace function gov_repo.l14_lock_domain_dependency_guard_shared_v1(p_organisation_id uuid,
          p_semantic_kind text, p_domain_id text) returns void language plpgsql volatile set search_path = pg_catalog, pg_temp as $g$ begin
          perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(gov_repo.frame_identity(ARRAY[p_organisation_id::text,
            'l14-business-context-domain-guard-v1', p_semantic_kind, p_domain_id]), 0)); end $g$; reset role;`, /shared domain guard key drifted/],
      ['authorization business-context target CHECK dropped', 'alter table gov_repo.l14_authorization_decisions drop constraint l14_authorization_decisions_business_context_target_check;',
        /relaxed/],
      ['label column on states', `alter table gov_repo.l14_business_context_assignment_states add column domain_label text check (length(domain_label) < 200);`, /pinned set/],
      ['free-text rationale on proposals', `alter table gov_repo.l14_business_context_assignment_proposals add column rationale text check (length(rationale) < 10);`, /pinned set/],
      ['JSON metadata column', 'alter table gov_repo.l14_business_context_assignment_proposals add column metadata jsonb;', /JSON column/],
      // Frozen enumerations and F2.
      ['canonical kind added', `alter table gov_repo.canonical_objects drop constraint canonical_objects_kind_check;
        alter table gov_repo.canonical_objects add constraint canonical_objects_kind_check check (kind in ('AGENT','AGENT_VERSION','MODEL','TOOL','MCP_SERVER','API',
          'PROMPT','KNOWLEDGE_BASE','DATA_ASSET','DATA_ELEMENT','SKILL','BUSINESS_DOMAIN')) not valid;`, /canonical object kinds \(11\)/],
      ['relationship type added', `alter table gov_repo.canonical_relationships drop constraint canonical_relationships_type_check;
        alter table gov_repo.canonical_relationships add constraint canonical_relationships_type_check check (relationship_type in ('USES_MODEL','USES_TOOL','USES_MCP',
          'INVOKES','USES_PROMPT','USES_KNOWLEDGE_BASE','USES_SKILL','EXPOSES','HANDOFF_TO','READS_FROM','WRITES_TO','DERIVED_FROM','BELONGS_TO_DOMAIN')) not valid;`,
      /governed relationship types \(12\)/],
      ['F2: S1C.2 routine attached to canonical_relationships', `create trigger s1c2_probe before update on gov_repo.canonical_relationships
        for each row execute function gov_repo.l14_business_context_assignment_head_guard_v1();`, /F2 boundary/],
    ];
    for (const [name, setup, expected] of controls) {
      await assert.rejects(inTxn(setup), (error: Error) => {
        assert.match(error.message, /M16_S1C2_POSTFLIGHT/, `${name}: ${error.message}`);
        assert.match(error.message, expected, `${name}: ${error.message}`);
        return true;
      });
    }
    // An FK from an l14 table to canonical_relationships is caught by the F2 rule itself (independent of column shape).
    await assert.rejects(inTxn(`alter table gov_repo.l14_support_links add column s1c2_rel text;
      alter table gov_repo.l14_support_links add constraint l14_support_links_s1c2_rel_fkey foreign key (s1c2_rel)
        references gov_repo.canonical_relationships (relationship_id);`), /M16_S1C2_POSTFLIGHT: F2 boundary violated/);
    assert.equal(await inTxn(memberDefiner, SURFACE_SPLIT_SQL), '37|1', 'a genuine pgcrypto member is excluded');
    assert.equal(await bootstrapSql(SURFACE_SPLIT_SQL), '37|0');
    assert.equal(await one(`select count(*) from pg_proc where proname='s1c2_probe'`), '0');
    await owner(block);
  });

  await t.test('the new SQL never reaches policy / control stores, Party PII, legacy domain fields, scanner output, F2 or other fact families', async () => {
    const sources = await owner(`select string_agg(prosrc, E'\\n----\\n') from pg_proc where oid = any(array[${[...NEW_RPCS, ...NEW_HELPERS]
      .map(s => `'${s}'::regprocedure`).join(',')}]::oid[])`);
    for (const forbidden of [/governance_policies/, /policy_versions/, /l14_policy_/, /l14_control_definition/, /current_version_id/,
      /directory_profile/, /display_name/, /\bemail\b/i, /\bphone\b/i, /profile_text/, /governance_users/, /l14_governance_part/,
      /\bbusiness_domain\b/, /\binformation_domain\b/, /\bdepartment\b/, /industry_sector/, /\blabel\b/, /\bdescription\b/, /classif/i, /scanner/i,
      /canonical_relationships/, /semantic_representation/, /APPLICABILITY/, /ASSESSMENT/, /RESPONSIBILITY/, /l14_responsibility_/, /\bcg_/i, /CG-AG/i,
      /gov_repo\.agents\b/, /agent_resource_links/, /ai_systems/, /\brisk/i, /\bscore/i, /confidence/i, /\bstatus\b/,
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_domain_|l14_governance_part|l14_authority_policy|l14_registry_states|governance_users|governance_roles|organisations|discovery_evidence|canonical_objects)/i]) {
      assert.doesNotMatch(sources, forbidden, String(forbidden));
    }
    // The domain registry is READ (admission, exact state, resolver, guard key) — required dependency access.
    for (const required of [/gov_repo\.l14_domain_admissions/, /gov_repo\.l14_domain_states/, /gov_repo\.l14_domain_valid_state_v1/,
      /'l14-registry-subject-guard-v1'/, /gov_repo\.l14_evaluate_target_authority_rules_v1/]) {
      assert.match(sources, required, String(required));
    }
  });
});
