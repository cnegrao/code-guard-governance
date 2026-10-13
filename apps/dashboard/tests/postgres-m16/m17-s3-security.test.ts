import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { m17S3GovernedRiskMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { l15SecurityViolationsSql } from '../helpers/m17-l15-security-profile';
import {
  L15_S1_DEFINER_INVENTORY, L15_S2_DEFINER_INVENTORY, L15_S2R1_DEFINER_INVENTORY, L15_S3_DEFINER_INVENTORY,
} from '../helpers/m17-l15-definer-inventory';
import { MACHINE, m17s1Kit, machineSignalSql, objectSubject as s1Object } from '../helpers/m17-s1-fixtures';
import { BOGUS, GR_TABLES, m17s3Kit, objectSubject } from '../helpers/m17-s3-fixtures';

/**
 * M17-S3 — GOVERNED_RISK privilege / ACL / definer-capability surface and immutability on real disposable PostgreSQL 17
 * (ADR §24; O14, O53, O59-O62, O73-O78, O90 re-proven on the post-S3 catalog; attacks 7-10, 45-47, 56). The cluster is built
 * to the exact post-S2R1 catalog, the surface is measured, the S3 migration is applied, the surface is measured again, and the
 * S1R1 closed machine-LOGIN surface is re-proven AFTER all S3 grants.
 */
const INVENTORY = [...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY, ...L15_S2R1_DEFINER_INVENTORY, ...L15_S3_DEFINER_INVENTORY];
const SERVICE_ROLE_RPCS = INVENTORY.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s));
const MACHINE_RPCS = ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1'];
const S3_RPC_SIGS = L15_S3_DEFINER_INVENTORY.map(e => e.sig).filter(s => !s.includes('commit_guard'));

test('M17-S3 GOVERNED_RISK security / ACL / definer surface (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S3', stopBefore: m17S3GovernedRiskMigration });
  t.after(() => c.stop());
  const { owner, rejects, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const json = async (query: string) => JSON.parse(await one(query));
  const surface = async () => json(`select json_build_object(
    'application_definers', (select count(*) from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
    'service_role_l15_rpcs', (select count(*) from pg_proc p where p.proname like 'l15\\_%' and has_function_privilege('service_role',p.oid,'EXECUTE')),
    'technical_intake_rpcs', (select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')),
    'l15_definers', (select count(*) from pg_proc where proname like 'l15\\_%' and prosecdef),
    'l15_tables', (select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15\\_%' and relkind='r'),
    'service_role_l15_table_privileges', (select count(*) from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' and c.relkind='r' and has_table_privilege('service_role',c.oid,pr)))`);
  const sharedDefs = async () => json(`select json_object_agg(c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid))
    from pg_constraint c where c.conrelid in ('gov_repo.l14_registry_states'::regclass, 'gov_repo.l14_fact_states'::regclass,
      'gov_repo.l14_support_links'::regclass, 'gov_repo.l14_authorization_decisions'::regclass, 'gov_repo.l14_proposals'::regclass,
      'gov_repo.l14_governance_decisions'::regclass, 'gov_repo.l14_authority_policy_rules'::regclass, 'gov_repo.l14_authorization_decision_rules'::regclass,
      'gov_repo.l14_command_results'::regclass, 'gov_repo.canonical_objects'::regclass, 'gov_repo.canonical_relationships'::regclass)`) as Promise<Record<string, string>>;

  const before = await surface();
  t.diagnostic(`ACL surface before S3 (post-S2R1): ${JSON.stringify(before)}`);
  assert.deepEqual(before, { application_definers: 55, service_role_l15_rpcs: 10, technical_intake_rpcs: 2, l15_definers: 15, l15_tables: 18,
    service_role_l15_table_privileges: 0 });
  const defsBefore = await sharedDefs();
  await c.migrate(m17S3GovernedRiskMigration);
  const after = await surface();
  t.diagnostic(`ACL surface after S3: ${JSON.stringify(after)}`);
  assert.deepEqual(after, { application_definers: 58, service_role_l15_rpcs: 13, technical_intake_rpcs: 2, l15_definers: 19, l15_tables: 21,
    service_role_l15_table_privileges: 0 });

  await t.test('the migration is additive and refuses to re-run (preflight) without changing anything', async () => {
    await rejects(owner(migrationSource(m17S3GovernedRiskMigration)), '55000', /M17_S3_PREFLIGHT/);
    assert.deepEqual(await surface(), after);
  });

  await t.test('O59-O62 L15 profile: clean with the exact 19-definer inventory and the 13 service_role RPCs; negative controls detected', async () => {
    assert.deepEqual(JSON.parse(lastLine(await owner(l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)))), []);
    const bare = JSON.parse(lastLine(await owner(l15SecurityViolationsSql()))) as string[];
    assert.equal(bare.filter(v => v.startsWith('DEFINER_NOT_INVENTORIED')).length, 19);
    assert.equal(bare.filter(v => v.startsWith('ROUTINE_EXECUTE service_role')).length, 13);
    const probe = async (ddl: string) => JSON.parse(lastLine(await owner(`begin; ${ddl}; ${l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)} rollback;`))) as string[];
    for (const tb of GR_TABLES) {
      assert.ok((await probe(`grant select on gov_repo.${tb} to service_role`)).includes(`TABLE_PRIVILEGE service_role SELECT ${tb}`), tb);
    }
    assert.ok((await probe(`grant insert (organisation_id) on gov_repo.l15_governed_risk_states to authenticated`)).includes('COLUMN_PRIVILEGE authenticated l15_governed_risk_states'));
    assert.ok((await probe(`grant execute on function gov_repo.l15_governed_risk_valid_state_v1(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz) to anon`))
      .some(v => v.startsWith('ROUTINE_EXECUTE anon gov_repo.l15_governed_risk_valid_state_v1')));
    assert.ok((await probe(`alter function ${S3_RPC_SIGS[1]} set search_path = public`))
      .some(v => v.startsWith('ROUTINE_SEARCH_PATH gov_repo.l15_decide_governed_risk_proposal_v1') || v.startsWith('DEFINER_NOT_INVENTORIED gov_repo.l15_decide_governed_risk_proposal_v1')));
    for (const tb of ['l15_governed_risk_states', 'l15_governed_risk_proposals']) {
      assert.ok((await probe(`alter table gov_repo.${tb} disable trigger ${tb}_immutable`)).includes(`NO_IMMUTABILITY ${tb}`), tb);
    }
    assert.ok((await probe(`create or replace function gov_repo.l15_governed_risk_commit_guard_v1() returns trigger language plpgsql security definer
      set search_path = pg_catalog, pg_temp as $$ begin return null; end $$`)).includes('DEFINER_NOT_INVENTORIED gov_repo.l15_governed_risk_commit_guard_v1()'));
  });

  await t.test('O59 / attack 10: service_role and every application role hold zero direct privilege on every S3 table and helper', async () => {
    for (const tb of GR_TABLES) {
      for (const role of ['service_role', 'authenticated', 'anon', 'govia_l15_machine_intake_caller']) {
        assert.equal(await one(`select (has_table_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          or has_any_column_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,REFERENCES'))::text`), 'false', `${role} ${tb}`);
      }
    }
    await rejects(c.svc(`select count(*) from gov_repo.l15_governed_risk_states`), '42501', /permission denied/);
    await rejects(c.svc(`select * from gov_repo.l15_governed_risk_valid_state_v1(null,null,null,null,null,null,null,null,null)`), '42501', /permission denied/);
    await rejects(c.svc(`select * from gov_repo.l15_governed_risk_support_currency_v1(null,null,null,null)`), '42501', /permission denied/);
    assert.deepEqual(await json(`select json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
      where p.pronamespace='gov_repo'::regnamespace and p.proname ~ '(governed_risk|risk_subject|support_link_target|scenario_dependency)'
        and has_function_privilege('service_role', p.oid, 'EXECUTE')`), [...S3_RPC_SIGS].sort());
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l15\\_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`), '0');
    // Every S3 routine: owner postgres, pinned search_path; definers documented (inventory above).
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname ~ '(governed_risk|risk_subject)'
      and (pg_get_userbyid(p.proowner) <> 'postgres' or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, '{}'))))`), '0');
  });

  const k1 = await m17s1Kit(c);
  const k = await m17s3Kit(c);
  const x = await k.setup();
  const scen = await k.scenario(x, 'sec', 'OPERATIONAL', ['AGENT', 'AGENT_VERSION', 'TOOL']);
  const s = objectSubject('AGENT', x.objects.AGENT!);
  const v = await k.validateRisk(x, 'sec-v', s, scen);

  await t.test('O14 / attacks 7, 8, 56: the closed S1R1 machine LOGIN surface is unchanged; the capability cannot submit, decide or read', async () => {
    const safe = async (login: string) => lastLine(await bootstrapSql(`select gov_repo.l15_machine_role_safe_v1('${login}'::regrole, '${login}')::text`));
    assert.deepEqual(await json(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`), MACHINE_RPCS);
    assert.equal(await safe(MACHINE), 'true');
    const sig = await k1.run(k1.machine, machineSignalSql({ org: x.org, key: 's3-sig', kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: s1Object('AGENT', x.objects.AGENT!), trust: 'INFERRED', methodId: 'S3_SEC', methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [x.evidence] }));
    assert.equal(sig.replayed, false, 'machine intake still works');
    const p = k.proposalOf(objectSubject('TOOL', x.objects.TOOL!), scen);
    for (const sql of [k.submitSql(x.member, { commandId: x.cmd('m-sub'), proposal: p }),
      k.decideSql(x.validator, { commandId: x.cmd('m-dec'), proposalId: randomUUID(), proposal: p }),
      k.readSql(x.member, s, scen.id),
      `select * from gov_repo.l15_governed_risk_valid_state_v1(null,null,null,null,null,null,null,null,null)`,
      `select * from gov_repo.l15_governed_risk_support_currency_v1(null,null,null,null)`]) {
      await rejects(k1.machine(sql), '42501', /permission denied/);
    }
    await bootstrapSql(`create role l15_s3_neg login inherit; grant govia_l15_machine_intake_caller to l15_s3_neg;
      grant execute on function ${S3_RPC_SIGS[0]} to l15_s3_neg;`);
    assert.equal(await safe('l15_s3_neg'), 'false', 'a LOGIN additionally holding an S3 RPC is not a safe intake identity');
    await rejects(k1.as('l15_s3_neg')(machineSignalSql({ org: x.org, key: 's3-neg', kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: s1Object('AGENT', x.objects.AGENT!), trust: 'INFERRED', methodId: 'S3_SEC', methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [x.evidence] })),
      '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
    await bootstrapSql(`revoke execute on function ${S3_RPC_SIGS[0]} from l15_s3_neg; drop role l15_s3_neg;`);
  });

  await t.test('O90 / attack 10: service_role without a verified ACTIVE human principal produces no ALLOW, decision or state', async () => {
    const p = k.proposalOf(objectSubject('TOOL', x.objects.TOOL!), scen);
    const sub = await k.submit(x, 'sr', p);
    const before = await k.grCounts(x.org);
    await rejects(c.svc(k.decideSql(x.validator, { commandId: x.cmd('sr-iat'), proposalId: sub.proposal_id, proposal: p, session: { iat: '1', exp: '2' } })), 'GV00[1-5]');
    await rejects(c.svc(k.decideSql({ id: randomUUID(), org: x.org, epoch: x.validator.epoch }, { commandId: x.cmd('sr-ghost'), proposalId: sub.proposal_id,
      proposal: p, fingerprint: BOGUS })), 'GV00[1-5]|M16_');
    await rejects(c.svc(k.decideSql(x.validator, { commandId: x.cmd('sr-org'), proposalId: sub.proposal_id, proposal: p,
      session: { org: randomUUID() }, fingerprint: BOGUS })), 'GV00[1-5]|M16_');
    assert.deepEqual(await k.grCounts(x.org), before);
  });

  await t.test('O62 / attacks 45-47: GOVERNED_RISK history rejects UPDATE / DELETE / TRUNCATE even for the owner; heads only advance by lineage', async () => {
    for (const tb of ['l15_governed_risk_states', 'l15_governed_risk_proposals']) {
      await rejects(owner(`update gov_repo.${tb} set organisation_id=organisation_id where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
      await rejects(owner(`delete from gov_repo.${tb} where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
      await rejects(owner(`truncate gov_repo.${tb} cascade`), '55000', /L15_HISTORY_IMMUTABLE/);
      // Superuser with session_replication_role = replica: ENABLE ALWAYS still fires.
      await rejects(bootstrapSql(`set session_replication_role = replica; update gov_repo.${tb} set organisation_id=organisation_id where organisation_id='${x.org}'`),
        '55000', /L15_HISTORY_IMMUTABLE/);
    }
    await rejects(owner(`delete from gov_repo.l15_governed_risk_heads where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`truncate gov_repo.l15_governed_risk_heads`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`update gov_repo.l15_governed_risk_heads set latest_state_id=null where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`update gov_repo.l15_governed_risk_heads set latest_state_id='${scen.stateId}' where organisation_id='${x.org}'`), '23503|55000');
    // The durable result cannot name another L15 state (forged l15_state_id).
    await rejects(owner(`begin; insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,subject_kind,command_fingerprint,actor_user_id,outcome,
      authorization_decision_id,proposal_id,governance_decision_id,l15_state_id,recorded_at) values('${x.org}','forged-result','DECIDE_PROPOSAL','GOVERNED_RISK',
      repeat('a',64),'${x.validator.id}','VALIDATED','${v.decided.authorization_decision_id}','${v.submitted.proposal_id}','${v.decided.governance_decision_id}',
      '${scen.stateId}',now()); rollback;`), 'GV010', /COMMAND_RESULT_L15_STATE_MISMATCH/);
    // No FK cascade reaches L15 history.
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class r on r.oid=k.confrelid where k.contype='f' and r.relname like 'l15\\_%'
      and (k.confdeltype in ('c','n','d') or k.confupdtype in ('c','n','d'))`), '0');
  });

  await t.test('O73-O78 / O05: shared-envelope / M16 / F2 constraints byte-identical except the enumerated L15 result branch; exactly four L15 families possible', async () => {
    const defsAfter = await sharedDefs();
    const changed = Object.keys({ ...defsBefore, ...defsAfter }).filter(key => defsBefore[key] !== defsAfter[key]).sort();
    assert.deepEqual(changed, ['gov_repo.l14_command_results.l14_command_results_l15_state_check', 'gov_repo.l14_command_results.l14_command_results_shape_check']);
    assert.match(defsAfter['gov_repo.l14_command_results.l14_command_results_l15_state_check']!, /GOVERNED_RISK/);
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l14\\_%'
      and column_name ~ '(risk|scenario|methodology)'`), '0', 'no new L14 column');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid in (select oid from pg_class where relname like 'l14\\_%')
      and confrelid in (select oid from pg_class where relname like 'l15\\_%')`), '0', 'no FK from the L14 envelope onto an L15 store');
    // O05 (structural): the 17-subject envelope vocabulary is unchanged; a fifth L15 family subject is rejected; the only L15 fact
    // store is GOVERNED_RISK (S4-S6 create the other three); l14_fact_states holds exactly the five M16 families and no L15 row.
    await rejects(owner(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${x.org}','${randomUUID()}','RISK_EXCEPTION','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now()); rollback;`), '23514');
    assert.deepEqual(await json(`select json_agg(relname order by relname) from pg_class where relnamespace='gov_repo'::regnamespace and relkind='r'
      and relname ~ '^l15_.*_states$'`), ['l15_governed_risk_states', 'l15_risk_methodology_states', 'l15_risk_scenario_definition_states']);
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states where subject_kind like 'RISK%' or subject_kind='GOVERNED_RISK'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states r join gov_repo.l14_governance_decisions d
      on d.organisation_id=r.organisation_id and d.subject_kind='GOVERNED_RISK' and d.governance_decision_id=r.governance_decision_id`), '0');
    assert.equal(await one(`select count(*) from pg_proc where proname ~* 'l15.*bootstrap|bootstrap.*l15'`), '0');
    assert.equal(await one(`select count(*) from (select organisation_id from gov_repo.l14_authority_policies group by 1 having count(*) > 1) s`), '0', 'one AP root');
  });
});
