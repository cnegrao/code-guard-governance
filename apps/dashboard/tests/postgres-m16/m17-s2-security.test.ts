import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { m17S2ScenarioMethodologyMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { l15SecurityViolationsSql, type DefinerInventoryEntry } from '../helpers/m17-l15-security-profile';
import { MACHINE, m17s1Kit, machineHypothesisSql, machineSignalSql, objectSubject } from '../helpers/m17-s1-fixtures';
import { REGISTRY_TABLES, SCENARIO, m17s2Kit, scenarioContent } from '../helpers/m17-s2-fixtures';

/**
 * M17-S2 — L15 registry privilege / ACL / definer-capability surface on real disposable PostgreSQL 17 (ADR §24; O14, O53,
 * O59-O62, O73, O74, O76, O90 re-proven on the post-S2 catalog; attacks 18, 19, 43). The cluster is built to the exact
 * post-S1R1 catalog, the surface is measured, the S2 migration is applied, the surface is measured again, and the S1R1 closed
 * machine-LOGIN surface is re-proven AFTER all S2 grants.
 */
const CFG = 'search_path=pg_catalog, pg_temp;lock_timeout=5s';
/** The seven S1 L15 definers, unchanged by S2 (copied verbatim from m17-s1-security.test.ts; asserted byte-identical below). */
const L15_S1_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_admit_human_hypothesis_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '9b44f7d25a87151776f51756c34bf54c654c6445c7b4c3b8e7cf642b10dfee46', cfg: CFG },
  { sig: 'gov_repo.l15_admit_human_signal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text[],text[])', owner: 'postgres', sha: '5d9906f8e699f915dc925f7b185103075942d98eccdcd2fec0e48e1e55e4cf60', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '75934cfdbcd0684c7c20751e0e599c51a32757a5e8079be2827da94ac5401675', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])', owner: 'postgres', sha: '1122d2f1a6f1925c5ccd8dc8e62907af12c7e6b60f39bdbbb974c627ee5f6d98', cfg: CFG },
  { sig: 'gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '759086fea06b757f854963ffd9fa507606aeb3c4ead241f02d194e44adc3b487', cfg: CFG },
  { sig: 'gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '2e7809bbbf935582b9e95cfcd7deb7665ddf61f7c3866d7cce23e1b5e9ac0fd4', cfg: CFG },
  { sig: 'gov_repo.l15_support_completeness_guard_v1()', owner: 'postgres', sha: '93411b42b31461bc4e407cf2c275168068dfc5ff4463050c4b6458c5f6b4822d', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** The seven NEW L15 SECURITY DEFINER routines of S2 (owner, body SHA-256, config). Any change requires re-review. */
export const L15_S2_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_admit_methodology_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text[],integer[],text[],text[],text[],integer[],text[],text[],text[],text[],text[],interval,text,text,text)', owner: 'postgres', sha: '3641a97407bd75c4a066a34c5f648201e2df1765813166b6d5bbe98e7aa3e1c4', cfg: CFG },
  { sig: 'gov_repo.l15_admit_scenario_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text[],text[],text[],text,text,text)', owner: 'postgres', sha: 'c45547e09b4d3729b4a146aef750a4835e90223a8efe17425c7aecfccdfc26cf', cfg: CFG },
  { sig: 'gov_repo.l15_decide_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'cfaa6eef826731d44d2f53aab7273c544d508c08d21fd4f252ddd6c3732f0e7f', cfg: CFG },
  { sig: 'gov_repo.l15_decide_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: '8897b4cbc05f526bcbd244d09caaa5babf054829368dd4f9224c0bf9e1e1867f', cfg: CFG },
  { sig: 'gov_repo.l15_submit_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'd76e90dad660e532f3cb9f1b359710191257f28c85f53f79175077bb2c8bfc1a', cfg: CFG },
  { sig: 'gov_repo.l15_submit_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'bc7bb094235d241f2893ddf00d14593dfaba5379f319c6357fa34e98330becad', cfg: CFG },
  { sig: 'gov_repo.l15_registry_commit_guard_v1()', owner: 'postgres', sha: 'fd7fc610a3659d2efcc552f1c934b341d1b235b1edfa6eea391871837c6d196d', cfg: 'search_path=pg_catalog, pg_temp' },
];
const INVENTORY = [...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY];
/** service_role-executable L15 RPCs after S2: the four S1 member RPCs + the six S2 registry RPCs (verified principal in-RPC). */
const SERVICE_ROLE_RPCS = INVENTORY.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s));
const MACHINE_RPCS = ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1'];
const S2_RPC_SIGS = L15_S2_DEFINER_INVENTORY.map(e => e.sig).filter(s => !s.includes('commit_guard'));

test('M17-S2 L15 registry security / ACL / definer surface (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S2', stopBefore: m17S2ScenarioMethodologyMigration });
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
      'gov_repo.l14_command_results'::regclass)`) as Promise<Record<string, string>>;

  const before = await surface();
  t.diagnostic(`ACL surface before S2: ${JSON.stringify(before)}`);
  assert.deepEqual(before, { application_definers: 49, service_role_l15_rpcs: 4, technical_intake_rpcs: 2, l15_definers: 7, l15_tables: 3,
    service_role_l15_table_privileges: 0 });
  const defsBefore = await sharedDefs();
  await c.migrate(m17S2ScenarioMethodologyMigration);
  const after = await surface();
  t.diagnostic(`ACL surface after S2: ${JSON.stringify(after)}`);
  assert.deepEqual(after, { application_definers: 55, service_role_l15_rpcs: 10, technical_intake_rpcs: 2, l15_definers: 14, l15_tables: 18,
    service_role_l15_table_privileges: 0 });

  await t.test('the migration is additive and refuses to re-run (preflight) without changing anything', async () => {
    await rejects(owner(migrationSource(m17S2ScenarioMethodologyMigration)), '55000', /M17_S2_PREFLIGHT/);
    assert.deepEqual(await surface(), after);
  });

  await t.test('O59-O62 L15 profile: clean with the exact 14-definer inventory and the ten service_role RPCs; negative controls detected', async () => {
    assert.deepEqual(JSON.parse(lastLine(await owner(l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)))), []);
    const bare = JSON.parse(lastLine(await owner(l15SecurityViolationsSql()))) as string[];
    assert.equal(bare.filter(v => v.startsWith('DEFINER_NOT_INVENTORIED')).length, 14);
    assert.equal(bare.filter(v => v.startsWith('ROUTINE_EXECUTE service_role')).length, 10);
    const probe = async (ddl: string) => JSON.parse(lastLine(await owner(`begin; ${ddl}; ${l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)} rollback;`))) as string[];
    for (const tb of REGISTRY_TABLES) {
      assert.ok((await probe(`grant select on gov_repo.${tb} to service_role`)).includes(`TABLE_PRIVILEGE service_role SELECT ${tb}`), tb);
    }
    assert.ok((await probe(`grant insert (organisation_id) on gov_repo.l15_risk_methodology_rating_cells to authenticated`)).includes('COLUMN_PRIVILEGE authenticated l15_risk_methodology_rating_cells'));
    assert.ok((await probe(`grant execute on function gov_repo.l15_risk_methodology_valid_state_v1(uuid,uuid,uuid,text,timestamptz,timestamptz) to anon`))
      .some(v => v.startsWith('ROUTINE_EXECUTE anon gov_repo.l15_risk_methodology_valid_state_v1')));
    assert.ok((await probe(`alter function gov_repo.l15_decide_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamptz,text,uuid,text,text,uuid,text,text[],text[],text) set search_path = public`))
      .some(v => v.startsWith('ROUTINE_SEARCH_PATH gov_repo.l15_decide_scenario_proposal_v1') || v.startsWith('DEFINER_NOT_INVENTORIED gov_repo.l15_decide_scenario_proposal_v1')));
    assert.ok((await probe(`alter table gov_repo.l15_risk_methodology_states disable trigger l15_risk_methodology_states_immutable`)).includes('NO_IMMUTABILITY l15_risk_methodology_states'));
    assert.ok((await probe(`create or replace function gov_repo.l15_registry_commit_guard_v1() returns trigger language plpgsql security definer
      set search_path = pg_catalog, pg_temp as $$ begin return null; end $$`)).includes('DEFINER_NOT_INVENTORIED gov_repo.l15_registry_commit_guard_v1()'));
  });

  await t.test('O59 / attack 19: service_role and every application role hold zero direct privilege on every S2 table and helper', async () => {
    for (const tb of REGISTRY_TABLES) {
      for (const role of ['service_role', 'authenticated', 'anon', 'govia_l15_machine_intake_caller']) {
        assert.equal(await one(`select (has_table_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          or has_any_column_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,REFERENCES'))::text`), 'false', `${role} ${tb}`);
      }
    }
    await rejects(c.svc(`select count(*) from gov_repo.l15_risk_scenario_definition_states`), '42501', /permission denied/);
    await rejects(c.svc(`insert into gov_repo.l15_risk_methodologies(organisation_id, methodology_id, admission_authorization_decision_id, recorded_at)
      values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())`), '42501', /permission denied/);
    // Only the six S2 RPCs are application-executable; every S2 helper / guard / resolver is owner-only.
    assert.deepEqual(await json(`select json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
      where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l15\\_%' and has_function_privilege('service_role', p.oid, 'EXECUTE')
        and p.proname !~ '^l15_(admit_human|read_)'`), [...S2_RPC_SIGS].sort());
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l15\\_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`), '0');
    // Every S2 definer is owner-pinned, search_path pinned, and never reaches the M16 policy / registry / fact stores.
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.prosecdef
      and p.proname ~ '^l15_(admit_(scenario|methodology)|submit_|decide_|registry_)'
      and p.prosrc ~ '(governance_policies|policy_versions|l14_registry_states|l14_fact_states|l14_support_links|l14_control_definition)'`), '0');
  });

  await t.test('O14 / O90 / attacks 18, 19, 43: the closed S1R1 machine LOGIN surface is unchanged after every S2 grant', async () => {
    const k1 = await m17s1Kit(c);
    const k2 = await m17s2Kit(c);
    const x = await k2.setup();
    const safe = async (login: string) => lastLine(await bootstrapSql(`select gov_repo.l15_machine_role_safe_v1('${login}'::regrole, '${login}')::text`));
    // 43. The capability reaches exactly the two S1 intake RPCs; no S2 routine is reachable.
    assert.deepEqual(await json(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`), MACHINE_RPCS);
    assert.equal(await safe(MACHINE), 'true', 'the clean dedicated LOGIN still satisfies the closed surface after S2');
    const agentVersion = await k1.object(x.org, 'AGENT_VERSION');
    const ev = await k1.evidence(x.org);
    const sig = await k1.run(k1.machine, machineSignalSql({ org: x.org, key: 's2-sig', kind: 'DETECTED_ABSENCE', source: 'SYSTEM_DETECTOR',
      subject: objectSubject('AGENT_VERSION', agentVersion.id), trust: 'INFERRED', methodId: 'SCANNER_DETECTED_RISK:RISK-NO-README',
      methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [ev] }));
    const hyp = await k1.run(k1.machine, machineHypothesisSql({ org: x.org, key: 's2-hyp', generator: 'DETERMINISTIC_RULE',
      subject: objectSubject('AGENT_VERSION', agentVersion.id), methodId: 'RULE', methodVersion: '1', signals: [sig.signal_id] }));
    assert.deepEqual([sig.replayed, hyp.replayed], [false, false], 'machine intake still works');
    // 18. The machine LOGIN cannot call any registry RPC.
    for (const sql of [
      k2.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('m-admit'), identityId: randomUUID(), versionId: randomUUID() }, scenarioContent({}, 'M')),
      `select gov_repo.l15_submit_methodology_proposal_v1(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`,
      `select gov_repo.l15_decide_scenario_proposal_v1(null,null,null,null,null,null,null,null,null,null,null,null,null,null)`,
      `select * from gov_repo.l15_risk_scenario_definition_valid_state_v1(null,null,null,null,null,null)`]) {
      await rejects(k1.machine(sql), '42501', /permission denied/);
    }
    // A LOGIN that additionally held EXECUTE on an S2 RPC would be refused by the closed-surface predicate (no widening possible).
    await bootstrapSql(`create role l15_s2_neg login inherit; grant govia_l15_machine_intake_caller to l15_s2_neg;
      grant execute on function ${S2_RPC_SIGS[0]} to l15_s2_neg;`);
    assert.equal(await safe('l15_s2_neg'), 'false');
    await rejects(k1.as('l15_s2_neg')(machineSignalSql({ org: x.org, key: 's2-neg', kind: 'DETECTED_ABSENCE', source: 'SYSTEM_DETECTOR',
      subject: objectSubject('AGENT_VERSION', agentVersion.id), trust: 'INFERRED', methodId: 'SCANNER_DETECTED_RISK:RISK-NO-README',
      methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [ev] })), '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
    await bootstrapSql(`revoke execute on function ${S2_RPC_SIGS[0]} from l15_s2_neg; drop role l15_s2_neg;`);
    // 19 / O90. service_role without a verified ACTIVE human principal produces no ALLOW, decision or state.
    const beforeCounts = await k2.counts(x.org);
    await rejects(c.svc(k2.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('sr-forged'), identityId: randomUUID(), versionId: randomUUID(),
      session: { iat: '1', exp: '2' } }, scenarioContent({}, 'SR'))), 'GV00[1-5]');
    await rejects(c.svc(k2.admitScenarioSql({ id: randomUUID(), org: x.org, epoch: x.scenarioAdmitter.epoch }, { commandId: x.cmd('sr-ghost'),
      identityId: randomUUID(), versionId: randomUUID() }, scenarioContent({}, 'SR'))), 'GV00[1-5]|M16_');
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${x.scenarioValidator2.id}'`);
    const v = await k2.admitScenario(x, 'sr');
    const p = k2.proposalOf(SCENARIO, v);
    const s = await c.exec(k2.submitSql(x.member, { commandId: x.cmd('sr-s'), proposal: p }));
    await rejects(c.svc(k2.decideSql(x.scenarioValidator2, { commandId: x.cmd('sr-d'), proposalId: s.proposal_id, proposal: p })), 'GV00[1-5]');
    const afterCounts = await k2.counts(x.org);
    assert.equal(afterCounts.l15_risk_scenario_definition_states, beforeCounts.l15_risk_scenario_definition_states);
    // Even the owner cannot fabricate an L15 ALLOW without an effective-policy L15 rule (the S0 deferred guard).
    await rejects(owner(`begin; insert into gov_repo.l14_authorization_decisions(organisation_id, authorization_decision_id, command_id, command_fingerprint,
      actor_user_id, requested_action, subject_kind, scope_tag, source_class, authority_basis, basis_authority_policy_id, basis_version_id,
      basis_content_hash, result, evaluated_at, attempted_content_hash, expectation_kind)
      select organisation_id, gen_random_uuid(), 'forged-allow', repeat('a',64), '${x.member.id}', 'ADMIT', 'RISK_SCENARIO_DEFINITION',
        'ALL_ALLOWED_TARGETS', 'SYSTEM_SEED', 'AUTHORITY_POLICY_VERSION', authority_policy_id, version_id, content_hash, 'ALLOW', now(),
        repeat('b',64), 'EXPECTED_NONE'
      from gov_repo.l14_authority_policy_versions where organisation_id='${x.org}' limit 1;
      insert into gov_repo.l14_command_results(organisation_id, command_id, command_kind, subject_kind, command_fingerprint, actor_user_id,
        outcome, authorization_decision_id, recorded_at)
      select organisation_id, 'forged-allow', 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'RISK_SCENARIO_DEFINITION', repeat('a',64), actor_user_id,
        'ADMITTED', authorization_decision_id, now() from gov_repo.l14_authorization_decisions where command_id='forged-allow';
      commit;`), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
  });

  await t.test('O73 / O74 / O76: shared-envelope / M16 store constraints byte-identical; the only envelope change is the S0-deferred L15 result branch', async () => {
    const defsAfter = await sharedDefs();
    const changed = Object.keys({ ...defsBefore, ...defsAfter }).filter(key => defsBefore[key] !== defsAfter[key]).sort();
    assert.deepEqual(changed, ['gov_repo.l14_command_results.l14_command_results_l15_state_check', 'gov_repo.l14_command_results.l14_command_results_shape_check']);
    assert.match(defsAfter['gov_repo.l14_command_results.l14_command_results_shape_check']!, /l15_state_id IS NOT NULL/);
    assert.deepEqual(await json(`select json_agg(column_name order by ordinal_position) from information_schema.columns
      where table_schema='gov_repo' and table_name='l14_command_results' and ordinal_position > 16`), ['l15_state_id']);
    // No new column on any other l14 table; no constraint from an l14 table onto an l15 store.
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l14\\_%'
      and column_name ~ '(l15|risk|scenario|methodology)' and not (table_name='l14_command_results' and column_name='l15_state_id')`), '0');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid in (select oid from pg_class where relname like 'l14\\_%')
      and confrelid in (select oid from pg_class where relname like 'l15\\_%')`), '0');
    assert.equal(await one(`select count(*) from pg_proc where proname ~* 'l15.*bootstrap|bootstrap.*l15'`), '0');
  });
});
