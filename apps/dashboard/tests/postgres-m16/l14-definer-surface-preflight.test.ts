import assert from 'node:assert/strict';
import { test } from 'node:test';
import { definerCapabilitySurfaceMigration } from '../helpers/disposable-m16-postgres';
import {
  APPROVED_SURFACE, fullChainCluster, graphosExecutorsSql, graphosTriggersSql, legacyLedgerOverloadSql, newOrg,
} from '../helpers/m16-definer-surface-fixtures';

/**
 * M16-S1B.2R1 on the FULL canonical primary chain BEFORE the corrective: measured inventory, the GraphOS
 * gov_exec bypass reproduced with the tracked bridge definitions, every fail-closed preflight control (each
 * failed application is atomic and leaves the catalog pre-R1), then the real application.
 */
test('M16 S1B.2R1 preflight / noncanonical drift / gov_exec closure (disposable PG17, full primary chain)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r1: false });
  t.after(() => pg.stop());
  const { owner, svc, bootstrapSql, inventory, migrate } = pg;
  const apply = () => migrate(definerCapabilitySurfaceMigration);
  const reject = async (pattern: RegExp) => {
    await assert.rejects(apply(), pattern);
    assert.equal(await owner(`select count(*) from pg_roles where rolname like 'govia\\_%'`), '0', 'failed R1 left no technical role');
  };
  const orgA = await newOrg(owner, 'r1-pre-a');
  const orgB = await newOrg(owner, 'r1-pre-b');

  await t.test('measured pre-R1 inventory: 35 definers, 27 application-executable, all postgres-owned (store-capable)', async () => {
    const rows = await inventory();
    const app = rows.filter(row => row.app);
    t.diagnostic(`pre-R1 application definers: ${app.map(row => `${row.fn}[${row.owner}${row.public ? ',PUBLIC' : ''}]`).join(' ; ')}`);
    assert.equal(rows.length, 35);
    assert.equal(app.length, 27);
    assert.ok(app.every(row => row.owner === 'postgres' && row.owner_store));
    for (const [name] of APPROVED_SURFACE) assert.ok(app.some(row => row.name === name), name);
    assert.equal(await owner(`select string_agg(defaclobjtype::text || ':' || coalesce(defaclnamespace::regnamespace::text, '-') || ':' || defaclacl::text, ' ' order by defaclobjtype)
      from pg_default_acl where defaclrole = 'postgres'::regrole`),
      'S:gov_repo:{service_role=rwU/postgres} f:gov_repo:{service_role=X/postgres} r:gov_repo:{service_role=arwdDxtm/postgres}');
  });

  await owner(graphosExecutorsSql());
  await owner(graphosTriggersSql());
  const policyAttack = (tenant: string) => `begin;
    select public.gov_exec('select count(*) as n from gov_repo.governance_policies');
    select public.gov_exec_dml($$insert into gov_repo.governance_policies(policy_id,organisation_id,policy_code,title,policy_type,status,owner_user_id,created_by)
      select gen_random_uuid(),'${tenant}','R1-X','Injected','compliance','draft',u.user_id,u.user_id from gov_repo.governance_users u limit 1 returning policy_id$$);
    rollback;`;

  await t.test('GraphOS bridge replicas (tracked definitions): the arbitrary-SQL bypass is REAL before R1', async () => {
    assert.match(await svc(`select public.gov_exec('select count(*) as n from gov_repo.governance_policies');`), /"n":\s*0/);
    await assert.rejects(svc(`select count(*) from gov_repo.governance_policies`), /permission denied/);
    await owner(`insert into gov_repo.governance_users(user_id,email,full_name,organisation_id,status)
      values(gen_random_uuid(),'r1-attacker@example.invalid','X','${orgA}','active')`);
    assert.match(await svc(policyAttack(orgB)), /policy_id/, 'service_role writes a policy row of ANOTHER tenant through gov_exec_dml');
  });

  await t.test('M008E governance objects fail closed: NONCANONICAL_GOVERNANCE_ROOT_CONFLICT', async () => {
    await owner(`create function gov_repo.log_agent_event(uuid) returns bigint language sql security definer as 'select 1::bigint'`);
    await reject(/NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
    await owner(`drop function gov_repo.log_agent_event(uuid)`);
    await owner(`create function gov_repo.compute_cg_ag_008(uuid) returns boolean language sql as 'select true'`);
    await reject(/NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
    await owner(`drop function gov_repo.compute_cg_ag_008(uuid)`);
    await owner(`alter function gov_repo.update_agent_compliance_flags() security definer`);
    await reject(/NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
    await owner(`alter function gov_repo.update_agent_compliance_flags() security invoker`);
    // M008E-style redefinition of a canonical routine (same identity, different body) is never re-owned.
    const original = await owner(`select pg_get_functiondef('gov_repo.agent_compliance_gaps(uuid)'::regprocedure)`);
    await owner(`do $$ begin execute regexp_replace(pg_get_functiondef('gov_repo.agent_compliance_gaps(uuid)'::regprocedure), '\\$function\\$', '$function$ /* M008E */ '); end $$`);
    await reject(/NONCANONICAL_GOVERNANCE_ROOT_CONFLICT[\s\S]*agent_compliance_gaps/);
    await owner(original + ';');
  });

  await t.test('coding-memory (S1B2-I4) and extension credits (S1B2-I5) fail closed; never auto-adopted', async () => {
    await owner(`create function gov_repo.coding_memory_search(uuid) returns integer language sql security definer as 'select 1'`);
    await reject(/NONCANONICAL_TARGET_DRIFT[\s\S]*S1B2-I4/);
    await owner(`drop function gov_repo.coding_memory_search(uuid)`);
    await owner(`create function public.use_credits(text, integer) returns boolean language sql security definer as 'select true';
      grant execute on function public.use_credits(text, integer) to anon, authenticated`);
    await reject(/CLOSED_SURFACE unapproved application-executable SECURITY DEFINER .*use_credits/);
    await owner(`drop function public.use_credits(text, integer)`);
  });

  await t.test('obsolete setup-8.2 ledger overload with a dependent object: exact drop without CASCADE aborts', async () => {
    await owner(legacyLedgerOverloadSql());
    await owner(`create view public.r1_legacy_ledger_dependent as select gov_repo.ledger_append('x'::text) as id`);
    await reject(/cannot drop function gov_repo\.ledger_append\(text,text,text,uuid,uuid,text,uuid,jsonb\) because other objects depend on it/);
    await owner(`drop view public.r1_legacy_ledger_dependent`);
  });

  await t.test('frozen-12 tamper and a pre-existing wrong-shape technical role stop the migration', async () => {
    const sig = `'gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)'::regprocedure`;
    const original = await owner(`select pg_get_functiondef(${sig})`);
    await owner(`do $$ begin execute regexp_replace(pg_get_functiondef(${sig}), '\\$function\\$', '$function$ -- tampered\n'); end $$`);
    await assert.rejects(apply(), /frozen routine .*l14_submit_proposal_v1.* differs/);
    await owner(original + ';');
    await bootstrapSql(`create role govia_ledger_executor login`);
    await assert.rejects(apply(), /role govia_ledger_executor exists with different attributes/);
    await bootstrapSql(`drop role govia_ledger_executor`);
  });

  await t.test('R1 applies: 22-routine closed surface, legacy overload dropped, gov_exec / GraphOS triggers closed', async () => {
    assert.equal(await owner(`select count(*) from pg_proc where proname = 'ledger_append'`), '2', 'legacy overload present before R1');
    await apply();
    assert.equal(await owner(`select string_agg(oid::regprocedure::text, ',') from pg_proc where proname = 'ledger_append'`),
      'gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)');
    const app = (await inventory()).filter(row => row.app);
    assert.deepEqual(app.map(row => [row.name, row.owner]).sort(), [...APPROVED_SURFACE].map(entry => [...entry]).sort());
    assert.ok(app.every(row => row.service_role && !row.anon && !row.authenticated && !row.public));
    assert.ok(app.every(row => row.owner_store === (row.owner === 'postgres')));
  });

  await t.test('after R1 the gov_exec bypass is unreachable (read, cross-tenant write, version insert, DDL)', async () => {
    for (const attack of [
      policyAttack(orgB),
      `select public.gov_exec('select * from gov_repo.policy_versions');`,
      `select public.gov_exec_dml($$insert into gov_repo.policy_versions(version_id) values (gen_random_uuid()) returning version_id$$);`,
      `select public.gov_exec_dml($$update gov_repo.policy_versions set content_markdown='x' returning version_id$$);`,
      `select public.gov_exec_dml($$delete from gov_repo.policy_versions returning version_id$$);`,
      `select public.gov_exec('select 1 from (select 1) x; alter table gov_repo.policy_versions disable trigger all; select 1');`,
    ]) await assert.rejects(svc(attack), /permission denied for function gov_exec/);
    for (const role of ['anon', 'authenticated', 'service_role', 'govia_ledger_executor', 'govia_runtime_executor', 'govia_legacy_read_executor', 'govia_legacy_graph_executor']) {
      assert.equal(await owner(`select bool_or(has_function_privilege('${role}', oid, 'EXECUTE')) from pg_proc where proname in ('gov_exec','gov_exec_dml')`), 'f', role);
    }
    assert.equal(await owner(`select count(*) from gov_repo.governance_policies where policy_code = 'R1-X'`), '0');
  });

  await t.test('GraphOS trigger functions: no direct application EXECUTE, triggers still fire', async () => {
    for (const fn of ['public.handle_new_user()', 'public.set_graphos_updated_at()']) {
      assert.equal(await owner(`select has_function_privilege('service_role','${fn}','EXECUTE') or has_function_privilege('anon','${fn}','EXECUTE')
        or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid='${fn}'::regprocedure), acldefault('f','postgres'::regrole))) a where a.grantee=0)`), 'f', fn);
    }
    await svc(`insert into auth.users(id,email) values('00000000-0000-4000-8000-00000000a001','graphos@example.invalid')`);
    assert.equal(await owner(`select role||':'||email from public.profiles where id='00000000-0000-4000-8000-00000000a001'`), 'admin:graphos@example.invalid');
    await owner(`insert into public.graphos_entities(id,name) values('00000000-0000-4000-8000-00000000a002','e')`);
    await svc(`update public.graphos_entities set name='f' where id='00000000-0000-4000-8000-00000000a002'`);
    assert.equal(await owner(`select updated_at is not null from public.graphos_entities`), 't');
  });

  await t.test('default privileges: new postgres-created gov_repo routines are executable by neither PUBLIC nor service_role', async () => {
    assert.equal(await owner(`select string_agg(defaclobjtype::text || ':' || coalesce(nullif(defaclnamespace, 0)::regnamespace::text, '*') || ':' || defaclacl::text, ' ' order by defaclobjtype, defaclnamespace)
      from pg_default_acl where defaclrole = 'postgres'::regrole`),
      'S:gov_repo:{service_role=rwU/postgres} f:*:{postgres=X/postgres} r:gov_repo:{service_role=arwdDxtm/postgres}');
    await owner(`create function gov_repo.r1_future_definer_v1() returns integer language sql security definer set search_path = pg_catalog as 'select 1'`);
    assert.equal(await owner(`select has_function_privilege('service_role','gov_repo.r1_future_definer_v1()','EXECUTE')::text || has_function_privilege('anon','gov_repo.r1_future_definer_v1()','EXECUTE')::text`), 'falsefalse');
    await owner(`drop function gov_repo.r1_future_definer_v1()`);
  });
});
