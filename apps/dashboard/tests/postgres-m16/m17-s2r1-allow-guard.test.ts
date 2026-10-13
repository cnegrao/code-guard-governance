import assert from 'node:assert/strict';
import { test } from 'node:test';
import { m17S2R1AllowGuardMigration, migrationSource } from '../helpers/disposable-m16-postgres';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { l15SecurityViolationsSql } from '../helpers/m17-l15-security-profile';
import {
  L15_S1_DEFINER_INVENTORY, L15_S2_DEFINER_INVENTORY, L15_S2R1_DEFINER_INVENTORY,
} from '../helpers/m17-l15-definer-inventory';
import { MACHINE, m17s1Kit } from '../helpers/m17-s1-fixtures';
import { METHODOLOGY, SCENARIO, m17s2Kit } from '../helpers/m17-s2-fixtures';

/**
 * M17-S2R1 — the D-01 root L15 ALLOW guard executes correctly at the NATURAL COMMIT of an application transaction (ACP F-S2-1),
 * on real disposable PostgreSQL 17. The cluster is built to the exact post-S2 catalog; the defect is reproduced (fail-closed);
 * S2R1 is applied; the guard's catalog posture, ACL, trigger, semantics and the surrounding surface are proven.
 *
 * Natural-commit proofs use a TEST-ONLY SECURITY DEFINER probe created by the fixture and dropped before the test ends (never a
 * production helper). Unlike the S2 RPCs it does NOT force `SET CONSTRAINTS ... IMMEDIATE`: it writes an L15 ADMIT authorization
 * envelope (decision, role + rule snapshots, command result) exactly as an L15 writer does and RETURNS to the service_role
 * session, whose plain COMMIT fires the deferred root guard.
 */
const GUARD = 'gov_repo.l15_authorization_allow_guard_v1()';
const PROBE = 'gov_repo.s2r1_test_probe_allow_v1(uuid,uuid,text,text,text)';
const M16_HISTORY = ['l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_fact_states',
  'l14_registry_states', 'l14_support_links', 'l14_control_definitions', 'l14_control_definition_versions'];

test('M17-S2R1 root L15 ALLOW guard execution context (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S2R1', stopBefore: m17S2R1AllowGuardMigration });
  t.after(() => c.stop());
  const { owner, svc, rejects, bootstrapSql } = c;
  const one = async (query: string) => lastLine(await owner(query));
  const json = async (query: string) => JSON.parse(await one(query));
  const k1 = await m17s1Kit(c);
  const k = await m17s2Kit(c);
  const x = await k.setup();
  const other = await k.setup();
  const m16Digest = () => one(`select md5(string_agg(x, '|' order by x)) from (
    ${M16_HISTORY.map(tb => `select '${tb}:' || t::text as x from gov_repo.${tb} t where t.organisation_id = '${x.org}'`).join(' union all ')}) s`);
  const m16Before = await m16Digest();
  const f2Before = await one(`select count(*) || ':' || (select count(*) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass and not tgisinternal)
    from gov_repo.canonical_relationships`);

  /** Test-only probe (owner postgres, SECURITY DEFINER, EXECUTE to service_role only while it exists). */
  const createProbe = () => owner(`create function ${PROBE.replace(/\(.*\)$/, '')}(p_org uuid, p_actor uuid, p_command text, p_mode text, p_permission text)
    returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $probe$
    declare v_authz uuid := pg_catalog.gen_random_uuid(); v_policy uuid; v_version uuid; v_hash text; v_roles uuid[]; v_ord integer[]; v_deny text;
    begin
      select b.authority_policy_id, b.version_id, b.content_hash into v_policy, v_version, v_hash
        from gov_repo.l14_effective_authority_basis_v1(p_org, pg_catalog.clock_timestamp()) as b;
      select u.role_ids into v_roles from gov_repo.governance_users as u where u.user_id = p_actor;
      select e.deny_reason, e.rule_ordinals into v_deny, v_ord from gov_repo.l14_evaluate_authority_rules_v1(p_org, v_policy, v_version,
        v_roles, p_permission, 'ADMIT', false, 'IMMEDIATE') as e;
      insert into gov_repo.l14_authorization_decisions(organisation_id, authorization_decision_id, command_id, command_fingerprint,
        actor_user_id, requested_action, subject_kind, scope_tag, source_class, authority_basis, basis_authority_policy_id,
        basis_version_id, basis_content_hash, result, evaluated_at, attempted_content_hash, expectation_kind)
      values (p_org, v_authz, p_command, pg_catalog.repeat('a', 64), p_actor, 'ADMIT', 'RISK_SCENARIO_DEFINITION', 'ALL_ALLOWED_TARGETS',
        'LOCAL_HUMAN', case when p_mode = 'BOOTSTRAP' then 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1' else 'AUTHORITY_POLICY_VERSION' end,
        case when p_mode = 'BOOTSTRAP' then null else v_policy end, case when p_mode = 'BOOTSTRAP' then null else v_version end,
        case when p_mode = 'BOOTSTRAP' then null else v_hash end, 'ALLOW', pg_catalog.clock_timestamp(), pg_catalog.repeat('b', 64), 'EXPECTED_NONE');
      perform gov_repo.l14_snapshot_roles_v1(p_org, v_authz, v_roles);
      if p_mode <> 'NO_RULE' then
        perform gov_repo.l14_snapshot_policy_rules_v1(p_org, v_authz, v_policy, v_version, v_ord);
      end if;
      insert into gov_repo.l14_command_results(organisation_id, command_id, command_kind, subject_kind, command_fingerprint, actor_user_id,
        outcome, authorization_decision_id, recorded_at)
      values (p_org, p_command, 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'RISK_SCENARIO_DEFINITION', pg_catalog.repeat('a', 64), p_actor,
        'ADMITTED', v_authz, pg_catalog.clock_timestamp());
      return v_authz;
    end $probe$;
    revoke all on function ${PROBE} from public, anon, authenticated, service_role;
    grant execute on function ${PROBE} to service_role;`);
  const dropProbe = () => owner(`drop function ${PROBE};`);
  let n = 0;
  /** A service_role transaction: the probe writes and returns; the session then COMMITs naturally (no SET CONSTRAINTS). */
  const natural = (org: string, actorId: string, mode: string, permission = 'L15_RISK_SCENARIO_ADMIT') =>
    svc(`begin; select gov_repo.s2r1_test_probe_allow_v1('${org}', '${actorId}', 's2r1-probe-${++n}', '${mode}', '${permission}'); commit;`);
  const probeRows = (org: string) => one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${org}' and command_id like 's2r1-probe-%'`);

  await t.test('defect reproduced on the post-S2 catalog: a legitimate L15 ALLOW cannot COMMIT naturally as service_role (fail-closed)', async () => {
    assert.equal(await one(`select prosecdef::text from pg_proc where oid='${GUARD}'::regprocedure`), 'false');
    await createProbe();
    const before = await probeRows(x.org);
    await rejects(natural(x.org, x.scenarioAdmitter.id, 'LEGIT'), '42501', /permission denied/);
    assert.equal(await probeRows(x.org), before, 'rolled back: never a false ALLOW');
    // The S2 RPCs (forced IMMEDIATE inside the definer) still work on the uncorrected catalog.
    assert.equal((await k.admitScenario(x, 'pre-s2r1')).outcome, 'ADMITTED');
    await dropProbe();
  });

  const surface = async () => json(`select json_build_object(
    'application_definers', (select count(*) from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
    'l15_definers', (select count(*) from pg_proc where proname like 'l15\\_%' and prosecdef),
    'service_role_l15_rpcs', (select count(*) from pg_proc p where p.proname like 'l15\\_%' and has_function_privilege('service_role',p.oid,'EXECUTE')),
    'technical_intake_rpcs', (select count(*) from pg_proc p where p.pronamespace='gov_repo'::regnamespace and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')),
    'service_role_l15_table_privileges', (select count(*) from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
      where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_%' and c.relkind='r' and has_table_privilege('service_role',c.oid,pr)))`);
  const triggerDef = () => one(`select pg_get_triggerdef(oid) || '|' || tgenabled::text || '|' || tgdeferrable || '|' || tginitdeferred
    from pg_trigger where tgname='l15_authorization_decisions_allow_guard'`);
  const before = await surface();
  const triggerBefore = await triggerDef();
  assert.deepEqual(before, { application_definers: 55, l15_definers: 14, service_role_l15_rpcs: 10, technical_intake_rpcs: 2,
    service_role_l15_table_privileges: 0 });
  await c.migrate(m17S2R1AllowGuardMigration);
  const after = await surface();
  t.diagnostic(`surface before S2R1 ${JSON.stringify(before)} / after ${JSON.stringify(after)}`);

  await t.test('S2R1 is additive and refuses to re-run (preflight) without changing anything', async () => {
    await rejects(owner(migrationSource(m17S2R1AllowGuardMigration)), '55000', /M17_S2R1_PREFLIGHT/);
    assert.deepEqual(await surface(), after);
  });

  await t.test('1-11: SECURITY DEFINER, owner postgres, pinned search_path, owner-only EXECUTE; trigger unchanged (deferred, ENABLE ALWAYS, same function)', async () => {
    const proc = await json(`select json_build_object('secdef', prosecdef, 'owner', pg_get_userbyid(proowner), 'config', proconfig,
      'sha', encode(sha256(convert_to(prosrc,'UTF8')),'hex'), 'acl', proacl::text, 'volatile', provolatile)
      from pg_proc where oid='${GUARD}'::regprocedure`);
    assert.deepEqual(proc, { secdef: true, owner: 'postgres', config: ['search_path=pg_catalog, pg_temp'],
      sha: L15_S2R1_DEFINER_INVENTORY[0]!.sha, acl: '{postgres=X/postgres}', volatile: 'v' });
    // 4-8: no direct EXECUTE for PUBLIC (a fresh role with no grant), anon, authenticated, service_role, the capability.
    for (const role of ['anon', 'authenticated', 'service_role', 'govia_l15_machine_intake_caller']) {
      assert.equal(await one(`select has_function_privilege('${role}','${GUARD}'::regprocedure,'EXECUTE')::text`), 'false', role);
    }
    await bootstrapSql(`create role s2r1_public_probe nologin;`);
    assert.equal(await one(`select has_function_privilege('s2r1_public_probe','${GUARD}'::regprocedure,'EXECUTE')::text`), 'false', 'PUBLIC');
    await bootstrapSql(`drop role s2r1_public_probe;`);
    await rejects(svc(`select ${GUARD}`), '42501', /permission denied/);
    await rejects(c.sql(`select ${GUARD}`, 'anon' as never), '42501', /permission denied/);
    await rejects(c.sql(`select ${GUARD}`, 'authenticated' as never), '42501', /permission denied/);
    await rejects(k1.machine(`select ${GUARD}`), '42501', /permission denied/);
    // 9-11: the trigger is byte-identical (definition incl. WHEN clause, DEFERRABLE INITIALLY DEFERRED, ENABLE ALWAYS) and
    //       invokes exactly the corrected guard.
    assert.equal(await triggerDef(), triggerBefore);
    assert.equal(await one(`select (tgfoid = '${GUARD}'::regprocedure)::text || tgenabled::text || tgdeferrable::text || tginitdeferred::text
      from pg_trigger where tgname='l15_authorization_decisions_allow_guard' and tgrelid='gov_repo.l14_authorization_decisions'::regclass`), 'trueAtruetrue');
    assert.match(triggerBefore, /AFTER INSERT ON gov_repo\.l14_authorization_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN/);
  });

  await t.test('12: a legitimate L15 ALLOW now COMMITs naturally from a service_role session (no SET CONSTRAINTS IMMEDIATE)', async () => {
    await createProbe();
    const beforeRows = Number(await probeRows(x.org));
    await natural(x.org, x.scenarioAdmitter.id, 'LEGIT');
    assert.equal(Number(await probeRows(x.org)), beforeRows + 1, 'committed');
    assert.equal(await one(`select string_agg(r.permission || '/' || r.permission_origin, ',') from gov_repo.l14_authorization_decision_rules r
      join gov_repo.l14_authorization_decisions a using (organisation_id, authorization_decision_id)
      where a.organisation_id='${x.org}' and a.command_id='s2r1-probe-${n}'`), 'L15_RISK_SCENARIO_ADMIT/AUTHORITY_POLICY_RULE');
    // The real registry RPCs on the corrected catalog (both registries, ADMIT + VALIDATE ALLOWs).
    for (const subject of [SCENARIO, METHODOLOGY] as const) {
      const v = subject === SCENARIO ? await k.admitScenario(x, `s2r1-${subject}`) : await k.admitMethodology(x, `s2r1-${subject}`);
      assert.equal(v.outcome, 'ADMITTED');
      assert.equal((await k.validate(x, `s2r1-${subject}-v`, subject, v)).decided.outcome, 'VALIDATED');
    }
  });

  await t.test('13-20: forged / mis-based L15 ALLOWs still fail closed at natural COMMIT (semantics unchanged)', async () => {
    const rows = Number(await probeRows(x.org));
    // 13. no mapped L15 rule snapshot.
    await rejects(natural(x.org, x.scenarioAdmitter.id, 'NO_RULE'), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 14. an L15 rule snapshot of the wrong L15 permission (methodology ADMIT for a scenario ALLOW).
    await rejects(natural(x.org, x.methodologyAdmitter.id, 'LEGIT', 'L15_RISK_METHODOLOGY_ADMIT'), 'GV010', /L15_PERMISSION_SUBJECT_MISMATCH|L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 14b. an actor without any matching rule (empty snapshot) under a real basis.
    await rejects(natural(x.org, x.member.id, 'LEGIT'), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 15. an L14 permission used for an L15 ALLOW.
    await rejects(natural(x.org, x.l14Steward.id, 'LEGIT', 'L14_CONTROL_DEFINITION_ADMIT'), 'GV010', /L15_PERMISSION_SUBJECT_MISMATCH|L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 16. bootstrap basis.
    await rejects(natural(x.org, x.scenarioAdmitter.id, 'BOOTSTRAP'), '23514|GV010', /bootstrap|L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 18. a foreign-tenant actor (holds the role; the rule is evaluated under this organisation's policy).
    await rejects(natural(x.org, other.scenarioAdmitter.id, 'LEGIT'), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 17. an inactive (suspended) actor.
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${x.scenarioValidator2.id}'`);
    await owner(`update gov_repo.governance_users set role_ids = role_ids || '${k.roles.scenarioAdmit}'::uuid where user_id='${x.scenarioValidator2.id}'`)
      .catch(() => undefined);
    await rejects(natural(x.org, x.scenarioValidator2.id, 'LEGIT'), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    // 19. an inactive organisation (a dedicated organisation, deactivated after its L15 policy was established).
    const dead = await k.setup();
    await owner(`update gov_repo.organisations set is_active=false where organisation_id='${dead.org}'`);
    await rejects(natural(dead.org, dead.scenarioAdmitter.id, 'LEGIT'), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    assert.equal(Number(await probeRows(x.org)), rows, 'nothing committed for any forged ALLOW');
    // 20. owner-forged ALLOW with an invalid semantic basis (no rule snapshot) is still rejected at the owner's own COMMIT.
    await rejects(owner(`begin; insert into gov_repo.l14_authorization_decisions(organisation_id, authorization_decision_id, command_id,
        command_fingerprint, actor_user_id, requested_action, subject_kind, scope_tag, source_class, authority_basis, basis_authority_policy_id,
        basis_version_id, basis_content_hash, result, evaluated_at, attempted_content_hash, expectation_kind)
      select organisation_id, gen_random_uuid(), 's2r1-owner-forged', repeat('a',64), '${x.scenarioAdmitter.id}', 'ADMIT', 'RISK_METHODOLOGY',
        'ALL_ALLOWED_TARGETS', 'SYSTEM_SEED', 'AUTHORITY_POLICY_VERSION', authority_policy_id, version_id, content_hash, 'ALLOW', now(),
        repeat('b',64), 'EXPECTED_NONE' from gov_repo.l14_authority_policy_versions where organisation_id='${x.org}'
        order by admitted_at desc, version_number desc limit 1;
      insert into gov_repo.l14_command_results(organisation_id, command_id, command_kind, subject_kind, command_fingerprint, actor_user_id,
        outcome, authorization_decision_id, recorded_at)
      select organisation_id, command_id, 'ADMIT_RISK_METHODOLOGY_VERSION', 'RISK_METHODOLOGY', repeat('a',64), actor_user_id, 'ADMITTED',
        authorization_decision_id, now() from gov_repo.l14_authorization_decisions where command_id='s2r1-owner-forged';
      commit;`), 'GV010', /L15_ALLOW_WITHOUT_L15_AUTHORITY/);
    await dropProbe();
  });

  await t.test('21-22 + definer inventory: surface derived from the real catalog; machine surface 2; zero service_role L15 table privilege', async () => {
    assert.equal(await one(`select count(*) from pg_proc where proname = 's2r1_test_probe_allow_v1'`), '0', 'test-only probe dropped');
    // The guard is owner-only, so the APPLICATION definer surface (EXECUTE by service_role / anon / authenticated / PUBLIC) is
    // unchanged; the L15 definer inventory grows by exactly the guard.
    assert.deepEqual(await surface(), { application_definers: 55, l15_definers: 15, service_role_l15_rpcs: 10, technical_intake_rpcs: 2,
      service_role_l15_table_privileges: 0 });
    const inventory = [...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY, ...L15_S2R1_DEFINER_INVENTORY];
    const serviceRoleRpcs = inventory.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s));
    assert.deepEqual(JSON.parse(lastLine(await owner(l15SecurityViolationsSql(inventory, serviceRoleRpcs)))), []);
    const withoutGuard = JSON.parse(lastLine(await owner(l15SecurityViolationsSql([...L15_S1_DEFINER_INVENTORY, ...L15_S2_DEFINER_INVENTORY], serviceRoleRpcs)))) as string[];
    assert.deepEqual(withoutGuard, [`DEFINER_NOT_INVENTORIED ${GUARD}`], 'the guard is the single new definer');
    // 21. The machine capability reaches exactly the two intake RPCs; the clean machine LOGIN is still on its closed surface.
    assert.deepEqual(await json(`select json_agg(p.proname order by p.proname) from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('govia_l15_machine_intake_caller',p.oid,'EXECUTE')`),
    ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1']);
    assert.equal(lastLine(await bootstrapSql(`select gov_repo.l15_machine_role_safe_v1('${MACHINE}'::regrole, '${MACHINE}')::text`)), 'true');
    // The guard body reaches no policy-content / M16 typed store and contains no write / dynamic SQL.
    assert.equal(await one(`select (prosrc ~* '(insert|update|delete|truncate|execute\\s|governance_policies|policy_versions|l14_registry_states|l14_fact_states)')::text
      from pg_proc where oid='${GUARD}'::regprocedure`), 'false');
  });

  await t.test('23-24: no M16 history / store change; F2 untouched', async () => {
    assert.equal(await m16Digest(), m16Before);
    assert.equal(await one(`select (select count(*) from gov_repo.l14_registry_states) + (select count(*) from gov_repo.l14_fact_states)
      + (select count(*) from gov_repo.l14_support_links)`), '0');
    assert.equal(await one(`select count(*) || ':' || (select count(*) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass and not tgisinternal)
      from gov_repo.canonical_relationships`), f2Before);
    assert.equal(await one(`select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
      where k.confrelid='gov_repo.canonical_relationships'::regclass and c.relname like 'l15\\_%'`), '0');
  });
});
