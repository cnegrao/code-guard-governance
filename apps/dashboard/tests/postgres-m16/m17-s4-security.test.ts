import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  m17S3GovernedRiskMigration, m17S3R1SupportLineageMigration, m17S4InherentRiskAssessmentMigration, migrationSource,
} from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { l15SecurityViolationsSql } from '../helpers/m17-l15-security-profile';
import {
  L15_S1_DEFINER_INVENTORY, L15_S2_DEFINER_INVENTORY, L15_S2R1_DEFINER_INVENTORY, L15_S3_DEFINER_INVENTORY, L15_S4_DEFINER_INVENTORY,
} from '../helpers/m17-l15-definer-inventory';
import { MACHINE, m17s1Kit, machineSignalSql, objectSubject as s1Object } from '../helpers/m17-s1-fixtures';
import { BOGUS, RA_TABLES, m17s4Kit } from '../helpers/m17-s4-fixtures';

/**
 * M17-S4 — RISK_ASSESSMENT privilege / ACL / definer-capability surface and immutability on real disposable PostgreSQL 17
 * (ADR §24; O14, O53, O59-O62, O73-O78, O90 re-proven on the post-S4 catalog; attacks 9-11, 52-54, 73). The cluster is built
 * to the exact post-S3R1 catalog WITH live S3 history (a GOVERNED_RISK state with proposal / decision / state support), the
 * surface is measured, the S4 migration is applied, the surface is measured again, the pre-existing S1 / S2 / S3 rows and the
 * S3 support projection are proven byte-identical, and the S1R1 closed machine-LOGIN surface is re-proven AFTER all S4 grants.
 */
const INVENTORY = [...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY, ...L15_S2R1_DEFINER_INVENTORY, ...L15_S3_DEFINER_INVENTORY,
  ...L15_S4_DEFINER_INVENTORY];
const SERVICE_ROLE_RPCS = INVENTORY.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s));
const MACHINE_RPCS = ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1'];
const S4_RPC_SIGS = L15_S4_DEFINER_INVENTORY.map(e => e.sig).filter(s => !s.includes('commit_guard'));

test('M17-S4 RISK_ASSESSMENT security / ACL / definer surface (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S4', stopBefore: m17S4InherentRiskAssessmentMigration });
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
      'gov_repo.l14_command_results'::regclass, 'gov_repo.canonical_objects'::regclass, 'gov_repo.canonical_relationships'::regclass,
      'gov_repo.l15_governed_risk_states'::regclass, 'gov_repo.l15_governed_risk_proposals'::regclass, 'gov_repo.l15_governed_risk_heads'::regclass,
      'gov_repo.l15_risk_methodology_states'::regclass, 'gov_repo.l15_risk_methodology_rating_cells'::regclass,
      'gov_repo.l15_risk_methodology_likelihood_levels'::regclass, 'gov_repo.l15_risk_methodology_impact_levels'::regclass,
      'gov_repo.l15_risk_signals'::regclass, 'gov_repo.l15_risk_hypotheses'::regclass)`) as Promise<Record<string, string>>;
  const bodies = () => json(`select json_object_agg(p.oid::regprocedure::text, md5(p.prosrc)||'|'||p.prosecdef||'|'||coalesce(p.proacl::text,'-')||'|'||
    coalesce(array_to_string(p.proconfig, ';'),'-')) from pg_proc p where p.pronamespace='gov_repo'::regnamespace`) as Promise<Record<string, string>>;
  // Pre-S4 rows of the support union use exactly these columns (the S4 owner columns are new).
  const PRE_S4_LINK_COLS = `organisation_id, link_id, owner_kind, owner_signal_id, owner_signal_kind, owner_hypothesis_id, target_tag,
    target_discovery_evidence_id, target_source_assertion_id, target_runtime_observation_id, target_cross_signal_comparison_id,
    target_execution_field_state_id, target_technical_field_state_id, target_lineage_observation_finding_id, target_l14_fact_state_id,
    target_l14_fact_subject_kind, target_risk_signal_id, target_risk_hypothesis_id, recorded_at, owner_registry_artifact, owner_scenario_proposal_id,
    owner_methodology_proposal_id, owner_governance_decision_id, owner_scenario_state_id, owner_methodology_state_id, owner_governed_risk_artifact,
    owner_governed_risk_proposal_id, owner_governed_risk_state_id`;
  const rowsDigest = () => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 'l:'||t::text x from (select ${PRE_S4_LINK_COLS} from gov_repo.l15_support_links) t
    union all select 'gs:'||t::text from gov_repo.l15_governed_risk_states t union all select 'gp:'||t::text from gov_repo.l15_governed_risk_proposals t
    union all select 'gh:'||t::text from gov_repo.l15_governed_risk_heads t union all select 'ms:'||t::text from gov_repo.l15_risk_methodology_states t
    union all select 'ss:'||t::text from gov_repo.l15_risk_scenario_definition_states t union all select 'sg:'||t::text from gov_repo.l15_risk_signals t
    union all select 'hy:'||t::text from gov_repo.l15_risk_hypotheses t union all select 'f:'||t::text from gov_repo.l14_fact_states t
    union all select 'p:'||t::text from gov_repo.l14_proposals t union all select 'a:'||t::text from gov_repo.l14_authorization_decisions t
    union all select 'd:'||t::text from gov_repo.l14_governance_decisions t union all select 'cr:'||t::text from gov_repo.l14_command_results t
    union all select 'co:'||t::text from gov_repo.canonical_objects t union all select 'rel:'||t::text from gov_repo.canonical_relationships t) s`);

  // Live S1 / S2 / S3 history BEFORE S4: a methodology, a governed risk with PROPOSAL / DECISION / STATE support.
  const k1 = await m17s1Kit(c);
  const k = await m17s4Kit(c);
  const x = await k.setup();
  const m = await k.methodology(x, 'sec-m');
  const scen = await k.k3.scenario(x, 'sec', 'OPERATIONAL', ['AGENT', 'AGENT_VERSION', 'TOOL']);
  const s = objectSubjectOf(x.objects.AGENT!);
  const support = { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } as const;
  const gr = await k.k3.validateRisk(x, 'sec-v', s, scen, { support, decideSupport: support });
  const grSupportBefore = await json(`select to_json(r) from gov_repo.l15_governed_risk_support_summary_v1('${x.org}', '${gr.stateId}', clock_timestamp(), clock_timestamp()) r`);

  const before = await surface();
  t.diagnostic(`ACL surface before S4 (post-S3R1): ${JSON.stringify(before)}`);
  assert.deepEqual(before, { application_definers: 58, service_role_l15_rpcs: 13, technical_intake_rpcs: 2, l15_definers: 19, l15_tables: 21,
    service_role_l15_table_privileges: 0 });
  const defsBefore = await sharedDefs();
  const bodiesBefore = await bodies();
  const rowsBefore = await rowsDigest();
  await c.migrate(m17S4InherentRiskAssessmentMigration);
  const after = await surface();
  t.diagnostic(`ACL surface after S4: ${JSON.stringify(after)}`);
  assert.deepEqual(after, { application_definers: 61, service_role_l15_rpcs: 16, technical_intake_rpcs: 2, l15_definers: 23, l15_tables: 24,
    service_role_l15_table_privileges: 0 });

  await t.test('additive: every pre-existing S1 / S2 / S3 / M16 / canonical row byte-identical; only the two enumerated guard bodies changed; S3 support projection unchanged', async () => {
    assert.equal(await rowsDigest(), rowsBefore);
    const bodiesAfter = await bodies();
    const changed = Object.keys(bodiesBefore).filter(key => bodiesAfter[key] !== bodiesBefore[key]).sort();
    assert.deepEqual(changed, ['gov_repo.l15_command_result_state_guard_v1()', 'gov_repo.l15_support_link_insert_guard_v1()']);
    for (const key of changed) assert.equal(bodiesAfter[key]!.split('|').slice(1).join('|'), bodiesBefore[key]!.split('|').slice(1).join('|'), `${key} definer / ACL / config preserved`);
    assert.ok(Object.keys(bodiesBefore).every(key => key in bodiesAfter), 'no routine removed');
    assert.deepEqual(await json(`select to_json(r) from gov_repo.l15_governed_risk_support_summary_v1('${x.org}', '${gr.stateId}', clock_timestamp(), clock_timestamp()) r`),
      grSupportBefore);
    // The S3 GOVERNED_RISK RPCs still work unchanged after S4 (their support writer / result guard branches restated verbatim).
    const tool = await k.k3.validateRisk(x, 'sec-after', objectSubjectOf(x.objects.TOOL!, 'TOOL'), scen, { support, decideSupport: support });
    assert.equal(tool.decided.outcome, 'VALIDATED');
    assert.equal(await one(`select count(*) from gov_repo.l15_support_links where owner_kind='GOVERNED_RISK' and (owner_governed_risk_state_id='${tool.stateId}'
      or owner_governance_decision_id='${tool.decided.governance_decision_id}' or owner_governed_risk_proposal_id='${tool.submitted.proposal_id}')`), '3');
  });

  await t.test('the S4 migration refuses to re-run (preflight, nothing applied); S3R1 and S3 still refuse', async () => {
    await rejects(owner(migrationSource(m17S4InherentRiskAssessmentMigration)), '55000', /M17_S4_PREFLIGHT/);
    await rejects(owner(migrationSource(m17S3R1SupportLineageMigration)), '55000', /M17_S3R1_PREFLIGHT/);
    await rejects(owner(migrationSource(m17S3GovernedRiskMigration)), '55000', /M17_S3_PREFLIGHT/);
    assert.deepEqual(await surface(), after);
  });

  await t.test('O59-O62 L15 profile: clean with the exact 23-definer inventory and the 16 service_role RPCs; negative controls detected', async () => {
    assert.deepEqual(JSON.parse(lastLine(await owner(l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)))), []);
    const bare = JSON.parse(lastLine(await owner(l15SecurityViolationsSql()))) as string[];
    assert.equal(bare.filter(v => v.startsWith('DEFINER_NOT_INVENTORIED')).length, 23);
    assert.equal(bare.filter(v => v.startsWith('ROUTINE_EXECUTE service_role')).length, 16);
    const probe = async (ddl: string) => JSON.parse(lastLine(await owner(`begin; ${ddl}; ${l15SecurityViolationsSql(INVENTORY, SERVICE_ROLE_RPCS)} rollback;`))) as string[];
    for (const tb of RA_TABLES) {
      assert.ok((await probe(`grant select on gov_repo.${tb} to service_role`)).includes(`TABLE_PRIVILEGE service_role SELECT ${tb}`), tb);
    }
    assert.ok((await probe(`grant insert (organisation_id) on gov_repo.l15_risk_assessment_states to authenticated`)).includes('COLUMN_PRIVILEGE authenticated l15_risk_assessment_states'));
    assert.ok((await probe(`grant execute on function gov_repo.l15_risk_assessment_valid_state_v1(uuid,uuid,text,timestamptz,timestamptz) to anon`))
      .some(v => v.startsWith('ROUTINE_EXECUTE anon gov_repo.l15_risk_assessment_valid_state_v1')));
    assert.ok((await probe(`alter function ${S4_RPC_SIGS[1]} set search_path = public`))
      .some(v => v.startsWith('ROUTINE_SEARCH_PATH gov_repo.l15_decide_risk_assessment_proposal_v1') || v.startsWith('DEFINER_NOT_INVENTORIED gov_repo.l15_decide_risk_assessment_proposal_v1')));
    for (const tb of ['l15_risk_assessment_states', 'l15_risk_assessment_proposals']) {
      assert.ok((await probe(`alter table gov_repo.${tb} disable trigger ${tb}_immutable`)).includes(`NO_IMMUTABILITY ${tb}`), tb);
    }
    assert.ok((await probe(`create or replace function gov_repo.l15_risk_assessment_commit_guard_v1() returns trigger language plpgsql security definer
      set search_path = pg_catalog, pg_temp as $$ begin return null; end $$`)).includes('DEFINER_NOT_INVENTORIED gov_repo.l15_risk_assessment_commit_guard_v1()'));
  });

  await t.test('O59 / attack 11: service_role and every application role hold zero direct privilege on every S4 table and helper; exactly three S4 RPCs', async () => {
    for (const tb of RA_TABLES) {
      for (const role of ['service_role', 'authenticated', 'anon', 'govia_l15_machine_intake_caller']) {
        assert.equal(await one(`select (has_table_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          or has_any_column_privilege('${role}','gov_repo.${tb}','SELECT,INSERT,UPDATE,REFERENCES'))::text`), 'false', `${role} ${tb}`);
      }
    }
    await rejects(c.svc(`select count(*) from gov_repo.l15_risk_assessment_states`), '42501', /permission denied/);
    await rejects(c.svc(`select * from gov_repo.l15_risk_assessment_valid_state_v1(null,null,null,null,null)`), '42501', /permission denied/);
    await rejects(c.svc(`select gov_repo.l15_risk_assessment_rating_band_v1(null,null,null,null)`), '42501', /permission denied/);
    assert.deepEqual(await json(`select json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
      where p.pronamespace='gov_repo'::regnamespace and p.proname ~ '(risk_assessment|assessment_validity|governed_risk_dependency|methodology_dependency)'
        and has_function_privilege('service_role', p.oid, 'EXECUTE')`), [...S4_RPC_SIGS].sort());
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and p.proname like 'l15\\_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`), '0');
    // Every S4 routine: owner postgres, pinned search_path; the four definers are exactly the inventory (owner / body / config).
    assert.equal(await one(`select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace
      and p.proname ~ '(risk_assessment|assessment_validity|governed_risk_dependency|methodology_dependency)'
      and (pg_get_userbyid(p.proowner) <> 'postgres' or not ('search_path=pg_catalog, pg_temp' = any (coalesce(p.proconfig, '{}'))))`), '0');
    assert.deepEqual((await json(`select json_agg(p.oid::regprocedure::text) from pg_proc p where p.pronamespace='gov_repo'::regnamespace
      and p.proname ~ 'risk_assessment' and p.prosecdef`) as string[]).sort(), L15_S4_DEFINER_INVENTORY.map(e => e.sig).sort());
  });

  const rf = await k.risk(x, 'sec-ra', 'AGENT_VERSION');
  const a = await k.assess(x, 'sec-a', k.rated(rf.stateId, m, 'L1', 'I1', await k.instant('10 days')));

  await t.test('O14 / attacks 9, 10, 73: the machine LOGIN surface is exactly the two S1 intake RPCs; it cannot submit, decide, read or resolve an assessment', async () => {
    const safe = async (login: string) => lastLine(await bootstrapSql(`select gov_repo.l15_machine_role_safe_v1('${login}'::regrole, '${login}')::text`));
    assert.deepEqual(await json(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`), MACHINE_RPCS);
    assert.equal(await safe(MACHINE), 'true');
    const sig = await k1.run(k1.machine, machineSignalSql({ org: x.org, key: 's4-sig', kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: s1Object('AGENT', x.objects.AGENT!), trust: 'INFERRED', methodId: 'S4_SEC', methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [x.evidence] }));
    assert.equal(sig.replayed, false, 'machine intake still works');
    const p = k.rated(rf.stateId, m, 'L2', 'I2', await k.instant('10 days'), { expectedCurrentStateId: a.stateId });
    for (const sql of [k.submitSql(x.member, { commandId: x.cmd('m-sub'), proposal: p }),
      k.decideSql(x.assessor, { commandId: x.cmd('m-dec'), proposalId: randomUUID(), proposal: p }),
      k.readSql(x.member, rf.stateId),
      `select * from gov_repo.l15_risk_assessment_valid_state_v1(null,null,null,null,null)`,
      `select gov_repo.l15_risk_assessment_state_current_v1(null,null,null,null)`]) {
      await rejects(k1.machine(sql), '42501', /permission denied/);
    }
    await bootstrapSql(`create role l15_s4_neg login inherit; grant govia_l15_machine_intake_caller to l15_s4_neg;
      grant execute on function ${S4_RPC_SIGS[0]} to l15_s4_neg;`);
    assert.equal(await safe('l15_s4_neg'), 'false', 'a LOGIN additionally holding an S4 RPC is not a safe intake identity');
    await rejects(k1.as('l15_s4_neg')(machineSignalSql({ org: x.org, key: 's4-neg', kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: s1Object('AGENT', x.objects.AGENT!), trust: 'INFERRED', methodId: 'S4_SEC', methodVersion: '1.0.0', tags: ['DISCOVERY_EVIDENCE'], ids: [x.evidence] })),
      '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
    await bootstrapSql(`revoke execute on function ${S4_RPC_SIGS[0]} from l15_s4_neg; drop role l15_s4_neg;`);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_proposals where organisation_id='${x.org}'`), '1');
  });

  await t.test('O90 / attack 11: service_role without a verified ACTIVE human principal produces no ALLOW, decision or state', async () => {
    const r2 = await k.risk(x, 'sec-90', 'TOOL');
    const p = k.rated(r2.stateId, m, 'L1', 'I1', await k.instant('10 days'));
    const sub = await k.submit(x, 'sr', p);
    const before = await k.raCounts(x.org);
    await rejects(c.svc(k.decideSql(x.assessor, { commandId: x.cmd('sr-iat'), proposalId: sub.proposal_id, proposal: p, session: { iat: '1', exp: '2' } })), 'GV00[1-5]');
    await rejects(c.svc(k.decideSql({ id: randomUUID(), org: x.org, epoch: x.assessor.epoch }, { commandId: x.cmd('sr-ghost'), proposalId: sub.proposal_id,
      proposal: p, fingerprint: BOGUS })), 'GV00[1-5]|M16_');
    await rejects(c.svc(k.decideSql(x.assessor, { commandId: x.cmd('sr-org'), proposalId: sub.proposal_id, proposal: p,
      session: { org: randomUUID() }, fingerprint: BOGUS })), 'GV00[1-5]|M16_');
    assert.deepEqual(await k.raCounts(x.org), before);
  });

  await t.test('O62 / attacks 52-54: RISK_ASSESSMENT history rejects UPDATE / DELETE / TRUNCATE even for the owner (and replica role); heads only advance by lineage', async () => {
    for (const tb of ['l15_risk_assessment_states', 'l15_risk_assessment_proposals']) {
      await rejects(owner(`update gov_repo.${tb} set organisation_id=organisation_id where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
      await rejects(owner(`delete from gov_repo.${tb} where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
      await rejects(owner(`truncate gov_repo.${tb} cascade`), '55000', /L15_HISTORY_IMMUTABLE/);
      await rejects(bootstrapSql(`set session_replication_role = replica; update gov_repo.${tb} set organisation_id=organisation_id where organisation_id='${x.org}'`),
        '55000', /L15_HISTORY_IMMUTABLE/);
    }
    // Expiry is never a mutation: there is no UPDATE path at all, and valid_until cannot be rewritten.
    await rejects(owner(`update gov_repo.l15_risk_assessment_states set valid_until = now() where state_id='${a.stateId}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`update gov_repo.l15_risk_assessment_states set rating_band = 'LOW' where state_id='${a.stateId}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`delete from gov_repo.l15_risk_assessment_heads where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`truncate gov_repo.l15_risk_assessment_heads`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`update gov_repo.l15_risk_assessment_heads set latest_state_id=null where organisation_id='${x.org}'`), '55000', /L15_HISTORY_IMMUTABLE/);
    await rejects(owner(`update gov_repo.l15_risk_assessment_heads set governed_risk_state_id='${gr.stateId}' where organisation_id='${x.org}'`), '55000|23503');
    // The durable result cannot name another L15 state (forged l15_state_id) for RISK_ASSESSMENT.
    await rejects(owner(`begin; insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,subject_kind,command_fingerprint,actor_user_id,outcome,
      authorization_decision_id,proposal_id,governance_decision_id,l15_state_id,recorded_at) values('${x.org}','forged-result','DECIDE_PROPOSAL','RISK_ASSESSMENT',
      repeat('a',64),'${x.assessor.id}','VALIDATED','${a.decided.authorization_decision_id}','${a.submitted.proposal_id}','${a.decided.governance_decision_id}',
      '${gr.stateId}',now()); rollback;`), 'GV010', /COMMAND_RESULT_L15_STATE_MISMATCH/);
    // No FK cascade reaches L15 history.
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class r on r.oid=k.confrelid where k.contype='f' and r.relname like 'l15\\_%'
      and (k.confdeltype in ('c','n','d') or k.confupdtype in ('c','n','d'))`), '0');
  });

  await t.test('O73-O78 / O05: shared-envelope / M16 / F2 / S1-S3 constraints byte-identical except the enumerated L15 result branch; exactly four L15 families possible', async () => {
    const defsAfter = await sharedDefs();
    const changed = Object.keys({ ...defsBefore, ...defsAfter }).filter(key => defsBefore[key] !== defsAfter[key]).sort();
    assert.deepEqual(changed, ['gov_repo.l14_command_results.l14_command_results_l15_state_check', 'gov_repo.l14_command_results.l14_command_results_shape_check']);
    assert.match(defsAfter['gov_repo.l14_command_results.l14_command_results_l15_state_check']!, /RISK_ASSESSMENT/);
    assert.doesNotMatch(defsAfter['gov_repo.l14_command_results.l14_command_results_l15_state_check']!, /RISK_TREATMENT|RISK_ACCEPTANCE/);
    assert.equal(await one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l14\\_%'
      and column_name ~ '(risk|scenario|methodology|assessment_basis|rating)'`), '0', 'no new L14 column');
    assert.equal(await one(`select count(*) from pg_constraint where conrelid in (select oid from pg_class where relname like 'l14\\_%')
      and confrelid in (select oid from pg_class where relname like 'l15\\_%')`), '0', 'no FK from the L14 envelope onto an L15 store');
    await rejects(owner(`begin; insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
      values('${x.org}','${randomUUID()}','RISK_EXCEPTION','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now()); rollback;`), '23514');
    assert.deepEqual(await json(`select json_agg(relname order by relname) from pg_class where relnamespace='gov_repo'::regnamespace and relkind='r'
      and relname ~ '^l15_.*_states$'`), ['l15_governed_risk_states', 'l15_risk_assessment_states', 'l15_risk_methodology_states', 'l15_risk_scenario_definition_states']);
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname ~ '^l15_risk_(treatment|acceptance)'`), '0',
      'S5 / S6 stores not started');
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states where subject_kind like 'RISK%' or subject_kind='GOVERNED_RISK'`), '0');
    assert.equal(await one(`select count(*) from pg_proc where proname ~* 'l15.*bootstrap|bootstrap.*l15'`), '0');
    assert.equal(await one(`select count(*) from (select organisation_id from gov_repo.l14_authority_policies group by 1 having count(*) > 1) s`), '0', 'one AP root');
    // The S2R1 root ALLOW guard is still the owner-only definer with the reviewed body.
    assert.equal(await one(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') || '|' || prosecdef from pg_proc where oid='gov_repo.l15_authorization_allow_guard_v1()'::regprocedure`),
      'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236|true');
  });
});

function objectSubjectOf(id: string, kind = 'AGENT') {
  return { subjectType: 'CANONICAL_OBJECT', canonicalKind: kind, canonicalObjectId: id } as never;
}
