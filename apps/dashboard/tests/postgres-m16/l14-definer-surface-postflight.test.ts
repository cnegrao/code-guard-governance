import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPROVED_SURFACE, EXECUTORS, fullChainCluster, legacyLedgerOverloadSql, r1Postflight, s1b2Postflight,
} from '../helpers/m16-definer-surface-fixtures';

const L14_SUBMIT = `gov_repo.l14_submit_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text)`;
const LEDGER = 'gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)';

/**
 * M16-S1B.2R1 closed-surface + least-privilege-owner checker, re-executed from the migration itself after
 * each hostile catalog change (inside a rolled-back transaction, as the bootstrap superuser so any change is
 * possible). The old S1B.2 source-text detector is shown to MISS the dynamic-SQL and helper-chain shapes.
 */
test('M16 S1B.2R1 capability postflight negative controls (disposable PG17, full primary chain + R1)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { owner, bootstrapSql, inventory } = pg;
  const postflight = r1Postflight();
  const s1b2 = s1b2Postflight();
  const inTxn = (setup: string, check = postflight) => bootstrapSql(`begin;\n${setup}\n${check}\nrollback;`);
  const fails = async (setup: string, pattern: RegExp) => assert.rejects(inTxn(setup), pattern);

  await t.test('baseline: R1, S1B.2 postflights re-execute cleanly; measured surface is exactly the 22 with their owner classes', async () => {
    await owner(postflight);
    await owner(postflight);
    await owner(s1b2);
    const rows = await inventory();
    const app = rows.filter(row => row.app);
    t.diagnostic(`post-R1 definers=${rows.length} application=${app.length}: ${app.map(row => `${row.name}[${row.owner}${row.owner_store ? ',STORE' : ''}]`).join(' ; ')}`);
    assert.equal(rows.length, 35);
    assert.deepEqual(app.map(row => [row.name, row.owner]).sort(), [...APPROVED_SURFACE].map(entry => [...entry]).sort());
    assert.ok(app.every(row => row.owner_store === (row.owner === 'postgres')), 'only the frozen 12 run as a store-capable owner');
    for (const row of rows.filter(r => !r.app)) t.diagnostic(`application-inaccessible definer: ${row.fn} [${row.owner}]`);
  });

  await t.test('technical owners: exact attributes, zero policy-store capability, no membership, no CREATE', async () => {
    for (const role of EXECUTORS) {
      assert.equal(await owner(`select concat_ws(',', rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit) from pg_roles where rolname='${role}'`),
        'f,f,f,f,f,f,f', role);
      assert.equal(await owner(`select bool_or(has_table_privilege('${role}', t, p)) or bool_or(has_any_column_privilege('${role}', t, 'SELECT, INSERT, UPDATE, REFERENCES'))
        from unnest(array['gov_repo.governance_policies'::regclass,'gov_repo.policy_versions'::regclass]) t
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p`), 'f', role);
      assert.equal(await owner(`select count(*) from pg_auth_members where member = '${role}'::regrole`), '0', role);
      assert.equal(await owner(`select string_agg(member::regrole::text || ':' || admin_option || inherit_option || set_option, ',') from pg_auth_members where roleid = '${role}'::regrole`),
        'postgres:truefalsefalse', role);
      for (const store of ['governance_policies', 'policy_versions']) {
        await assert.rejects(bootstrapSql(`set role ${role}; select count(*) from gov_repo.${store};`), /permission denied for table/);
      }
    }
  });

  await t.test('application-inaccessible definer is NOT a false positive', async () => {
    await inTxn(`create function gov_repo.r1_owner_only_v1() returns bigint language sql security definer set search_path = pg_catalog
      as 'select count(*) from gov_repo.governance_policies';
      revoke all on function gov_repo.r1_owner_only_v1() from public;`);
  });

  await t.test('dynamic-SQL definer (store name never contiguous): S1B.2 detector misses it, R1 closed surface rejects it', async () => {
    const dyn = `create function gov_repo.r1_dynamic_v1() returns bigint language plpgsql security definer set search_path = pg_catalog as $f$
      declare n bigint; begin execute 'select count(*) from gov_repo.' || 'governance_' || 'policies' into n; return n; end $f$;
      grant execute on function gov_repo.r1_dynamic_v1() to service_role;`;
    await inTxn(dyn, s1b2);
    await fails(dyn, /CLOSED_SURFACE unapproved application-executable SECURITY DEFINER gov_repo\.r1_dynamic_v1\(\)/);
  });

  await t.test('definer -> invoker helper chain: S1B.2 detector misses it, R1 rejects it', async () => {
    const chain = `create function gov_repo.r1_helper_v1() returns bigint language sql security invoker as 'select count(*) from gov_repo.policy_versions';
      create function gov_repo.r1_wrapper_v1() returns bigint language sql security definer set search_path = pg_catalog as 'select gov_repo.r1_helper_v1()';
      grant execute on function gov_repo.r1_wrapper_v1() to service_role;`;
    await inTxn(chain, s1b2);
    await fails(chain, /CLOSED_SURFACE .*r1_wrapper_v1/);
  });

  await t.test('legacy default-granted definer, inherited-role execution, public-schema and gov_exec-style executors', async () => {
    await fails(`alter default privileges for role postgres in schema gov_repo grant execute on routines to service_role;
      set local role postgres;
      create function gov_repo.r1_defaulted_v1() returns integer language sql security definer as 'select 1';`, /CLOSED_SURFACE .*r1_defaulted_v1/);
    await fails(`create role r1_bridge nologin; grant execute on function gov_repo.compute_governance_score(uuid) to r1_bridge; grant r1_bridge to service_role;`,
      /CLOSED_SURFACE .*compute_governance_score/);
    await fails(`create function public.r1_run_sql(q text) returns void language plpgsql security definer as $f$ begin execute q; end $f$;
      grant execute on function public.r1_run_sql(text) to service_role;`, /CLOSED_SURFACE .*r1_run_sql/);
    await fails(`create function public.gov_exec(sql text) returns json language plpgsql security definer set search_path = public, gov_repo as $f$
      declare result json; begin execute 'SELECT json_agg(r) FROM (' || sql || ') r' into result; return result; end $f$;
      revoke all on function public.gov_exec(text) from public; grant execute on function public.gov_exec(text) to service_role;`,
      /CLOSED_SURFACE .*gov_exec|forbidden arbitrary-SQL executor/);
    await fails(`create function public.gov_exec_dml(sql text) returns json language plpgsql as $f$ begin return null; end $f$;`,
      /forbidden arbitrary-SQL executor/);
  });

  await t.test('unapproved 23rd definer, wrong owner, frozen body change, overload, anon/authenticated/PUBLIC EXECUTE', async () => {
    await fails(`create function gov_repo.r1_extra_v1() returns integer language sql security definer set search_path = pg_catalog as 'select 1';
      grant execute on function gov_repo.r1_extra_v1() to service_role;`, /CLOSED_SURFACE .*r1_extra_v1/);
    await fails(`alter function ${LEDGER} owner to postgres;`, /ledger_append.* owner postgres is not govia_ledger_executor/);
    await fails(`do $$ begin execute regexp_replace(pg_get_functiondef('${L14_SUBMIT}'::regprocedure), '\\$function\\$', '$function$ -- tampered\n'); end $$;`,
      /l14_submit_proposal_v1.* body hash changed/);
    await fails(`alter function ${L14_SUBMIT} set work_mem = '64kB';`, /l14_submit_proposal_v1.* config changed/);
    await fails(`create function gov_repo.l14_submit_proposal_v1(integer) returns integer language sql as 'select 1';`, /overload of approved routine/);
    await fails(`grant execute on function ${LEDGER} to anon;`, /ledger_append.* application EXECUTE is not exactly service_role/);
    await fails(`grant execute on function gov_repo.record_execution_snapshot(uuid,jsonb,text) to authenticated;`, /record_execution_snapshot.* not exactly service_role/);
    await fails(`grant execute on function gov_repo.agent_compliance_gaps(uuid) to public;`, /agent_compliance_gaps.* not exactly service_role/);
  });

  await t.test('technical owner gains policy SELECT / DML / BYPASSRLS / membership / forbidden definer EXECUTE / extra grant', async () => {
    await fails(`grant select on gov_repo.governance_policies to govia_ledger_executor;`, /technical owner govia_ledger_executor has policy-store capability|owner of .* has policy-store capability/);
    await fails(`grant insert on gov_repo.policy_versions to govia_runtime_executor;`, /policy-store capability/);
    await fails(`grant references (policy_id) on gov_repo.governance_policies to govia_legacy_graph_executor;`, /policy-store capability/);
    await fails(`alter role govia_legacy_read_executor bypassrls;`, /policy-store capability|NOBYPASSRLS/);
    await fails(`grant pg_read_all_data to govia_ledger_executor;`, /policy-store capability|membership path/);
    await fails(`grant execute on function ${L14_SUBMIT} to govia_runtime_executor;`, /govia_runtime_executor can execute elevated routine .*l14_submit_proposal_v1/);
    await fails(`grant execute on function gov_repo.recompute_risk_propagation(uuid,uuid) to govia_legacy_read_executor;`, /can execute elevated routine .*recompute_risk_propagation/);
    await fails(`grant execute on function gov_repo.ai_system_evidence_report(uuid) to govia_legacy_graph_executor;`, /can execute elevated routine .*ai_system_evidence_report/);
    await fails(`grant select on gov_repo.organisations to govia_ledger_executor;`, /relation grants .* differ/);
    await fails(`grant create on schema gov_repo to govia_runtime_executor;`, /can CREATE in a schema/);
    await fails(`create policy r1_extra on gov_repo.agents for select to govia_ledger_executor using (true);`, /RLS policies .* differ/);
  });

  await t.test('noncanonical drift after R1: coding memory, credits, legacy ledger overload, M008E', async () => {
    await fails(`create function gov_repo.coding_memory_search(uuid) returns integer language sql as 'select 1';`, /NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
    await fails(`create function public.get_credits(text) returns integer language sql security definer as 'select 1';
      grant execute on function public.get_credits(text) to anon;`, /CLOSED_SURFACE .*get_credits/);
    await fails(`set local role postgres; ${legacyLedgerOverloadSql()}`, /overload of approved routine gov_repo.ledger_append/);
    await fails(`create function gov_repo.log_agent_event(uuid) returns bigint language sql as 'select 1::bigint';`, /NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
    await fails(`alter function gov_repo.update_agent_compliance_flags() security definer;`,
      /NONCANONICAL_GOVERNANCE_ROOT_CONFLICT|CLOSED_SURFACE .*update_agent_compliance_flags/);
  });

  await t.test('default-privilege reintroduction fails the postflight', async () => {
    await fails(`alter default privileges for role postgres in schema gov_repo grant execute on routines to service_role;`, /default privileges/);
    await fails(`alter default privileges for role postgres grant execute on routines to public;`, /default privileges/);
  });
});
