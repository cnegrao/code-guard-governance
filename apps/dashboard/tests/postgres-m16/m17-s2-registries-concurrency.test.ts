import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { METHODOLOGY, SCENARIO, m17s2Kit, methodologyContent, scenarioContent } from '../helpers/m17-s2-fixtures';

/**
 * M17-S2 — L15 registry concurrency on real disposable PostgreSQL 17 (M17S2 horizon). Distinct backends contend for the real
 * locks (ORG -> USER -> ROLES FOR SHARE, AP guard SHARED, the L15 identity / version-id admission guards, the exact-tuple
 * validation guard, the command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor
 * session, never by sleeping alone. Attacks 9, 10, 21, 22 and the O57 / O66 S2 portions.
 */
test('M17-S2 registry concurrency (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S2' });
  t.after(() => c.stop());
  const k = await m17s2Kit(c);
  const monitor = c.session('m16_bootstrap');
  t.after(() => monitor.close());
  type Session = ReturnType<typeof c.session>;
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  async function awaitBlocked(blocked: string, holder: string) {
    for (let i = 0; i < 1000; i++) {
      const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${blocked}),'')
        ||':'||(pg_blocking_pids(${blocked}) @> array[${holder}])::text;`)).out.trim();
      if (state === 'Lock:true') return;
      await sleep(20);
    }
    assert.fail('session never observed blocked by the expected holder');
  }
  const json = (out: string) => JSON.parse(lastLine(out));
  const one = k.one;
  /** `first` in an open transaction; `second` must block on it; commit; return both. */
  async function race(first: string, second: string, firstRole: 'service_role' | 'postgres' = 'service_role') {
    const s1 = c.session(firstRole), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(second);
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      return { first: a, second: await pending };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }
  async function parallel(first: string, second: string) {
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const b = await s2.run(second, 15_000);
      assert.equal(b.err, '', b.err);
      await s1.run('commit;');
      return { first: a, second: b };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }

  await t.test('same-command concurrent first ADMIT: the waiter replays the ORIGINAL result; exactly one identity / version', async () => {
    const x = await k.setup();
    const id = randomUUID(), ver = randomUUID();
    const sql = k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('same'), identityId: id, versionId: ver }, scenarioContent({}, 'SAME'));
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.authorization_decision_id], ['ADMITTED', false, true, a.authorization_decision_id]);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_scenario_definition_versions where scenario_definition_id='${id}'`), '1');
  });

  await t.test('attack 9: concurrent first admissions of one identity: one winner; the loser GV009 and consumes nothing (both registries)', async () => {
    const x = await k.setup();
    for (const subject of [SCENARIO, METHODOLOGY] as const) {
      const id = randomUUID();
      const before = await k.counts(x.org);
      const sql = (n: number) => subject === SCENARIO
        ? k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd(`first-${subject}-${n}`), identityId: id, versionId: randomUUID() }, scenarioContent({}, `FIRST-${n}`))
        : k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd(`first-${subject}-${n}`), identityId: id, versionId: randomUUID() }, methodologyContent(2 + n, 3));
      const { first, second } = await race(sql(1), sql(2));
      assert.equal(json(first.out).outcome, 'ADMITTED');
      assert.match(second.err, new RegExp(`GV009[\\s\\S]*${subject}_EXISTS`), second.err);
      const after = await k.counts(x.org);
      assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
      assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
    }
  });

  await t.test('attack 10: concurrent successor admissions pinning the same predecessor: one successor, no fork; the loser GV009', async () => {
    const x = await k.setup();
    for (const subject of [SCENARIO, METHODOLOGY] as const) {
      const v1 = subject === SCENARIO ? await k.admitScenario(x, `succ-${subject}`) : await k.admitMethodology(x, `succ-${subject}`);
      const idCol = subject === SCENARIO ? 'scenario_definition_id' : 'methodology_id';
      const verCol = subject === SCENARIO ? 'scenario_definition_version_id' : 'methodology_version_id';
      const expectation = { kind: 'EXPECTED_CURRENT', latestVersionId: v1[verCol] } as const;
      const sql = (n: number) => subject === SCENARIO
        ? k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd(`succ-${subject}-${n}`), identityId: v1[idCol], versionId: randomUUID(), expectation },
          scenarioContent({}, `SUCC-${n}`))
        : k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd(`succ-${subject}-${n}`), identityId: v1[idCol], versionId: randomUUID(), expectation },
          methodologyContent(2, 2 + n));
      const { first, second } = await race(sql(1), sql(2));
      assert.equal(json(first.out).predecessor_version_id, v1[verCol]);
      assert.match(second.err, new RegExp(`GV009[\\s\\S]*${subject}_VERSION_EXPECTATION_MISMATCH`), second.err);
      const table = subject === SCENARIO ? 'l15_risk_scenario_definition_versions' : 'l15_risk_methodology_versions';
      assert.equal(await one(`select count(*) from gov_repo.${table} where predecessor_version_id='${v1[verCol]}'`), '1', 'never a fork');
    }
  });

  await t.test('concurrent version-id reuse under different identities: the version-id guard serializes; the loser GV009', async () => {
    const x = await k.setup();
    const ver = randomUUID();
    const { first, second } = await race(
      k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('vid-1'), identityId: randomUUID(), versionId: ver }, scenarioContent({}, 'VID-1')),
      k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('vid-2'), identityId: randomUUID(), versionId: ver }, scenarioContent({}, 'VID-2')));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV009[\s\S]*VERSION_ID_EXISTS/, second.err);
  });

  await t.test('admissions of different identities and validations of different tuples do not serialize', async () => {
    const x = await k.setup();
    await parallel(
      k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('par-1'), identityId: randomUUID(), versionId: randomUUID() }, scenarioContent({}, 'PAR-1')),
      k.admitScenarioSql(x.scenarioAdmitter, { commandId: x.cmd('par-2'), identityId: randomUUID(), versionId: randomUUID() }, scenarioContent({}, 'PAR-2')));
    const a = await k.admitMethodology(x, 'par-a'), b = await k.admitMethodology(x, 'par-b');
    const pa = k.proposalOf(METHODOLOGY, a), pb = k.proposalOf(METHODOLOGY, b);
    const sa = await c.exec(k.submitSql(x.member, { commandId: x.cmd('par-a-s'), proposal: pa }));
    const sb = await c.exec(k.submitSql(x.member, { commandId: x.cmd('par-b-s'), proposal: pb }));
    await parallel(k.decideSql(x.methodologyValidator, { commandId: x.cmd('par-a-v'), proposalId: sa.proposal_id, proposal: pa }),
      k.decideSql(x.methodologyValidator, { commandId: x.cmd('par-b-v'), proposalId: sb.proposal_id, proposal: pb }));
  });

  await t.test('concurrent first VALIDATEs of one tuple (two proposals, expected-none): one state; the loser GV009 and consumes nothing', async () => {
    const x = await k.setup();
    const v = await k.admitScenario(x, 'dv');
    const p = k.proposalOf(SCENARIO, v);
    const [s1, s2] = [await c.exec(k.submitSql(x.member, { commandId: x.cmd('dv-s1'), proposal: p })),
      await c.exec(k.submitSql(x.member, { commandId: x.cmd('dv-s2'), proposal: p }))];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSql(x.scenarioValidator, { commandId: x.cmd('dv-v1'), proposalId: s1.proposal_id, proposal: p }),
      k.decideSql(x.scenarioValidator2, { commandId: x.cmd('dv-v2'), proposalId: s2.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RISK_SCENARIO_DEFINITION_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l15_risk_scenario_definition_states, before.l15_risk_scenario_definition_states + 1, 'never two current states');
    assert.equal(after.l14_command_results, before.l14_command_results + 1);
  });

  await t.test('concurrent terminal decisions on one proposal: one wins; the other GV010 PROPOSAL_TERMINAL; nothing partial', async () => {
    const x = await k.setup();
    const v = await k.admitMethodology(x, 'tt');
    const p = k.proposalOf(METHODOLOGY, v);
    const s = await c.exec(k.submitSql(x.member, { commandId: x.cmd('tt-s'), proposal: p }));
    const { first, second } = await race(k.decideSql(x.methodologyValidator, { commandId: x.cmd('tt-v'), proposalId: s.proposal_id, proposal: p }),
      k.decideSql(x.methodologyValidator, { commandId: x.cmd('tt-r'), proposalId: s.proposal_id, proposal: p, outcome: 'REJECT' }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
  });

  await t.test('REVOKE vs REVOKE and REVOKE vs re-VALIDATE on one tuple: the loser is stale (GV009); lineage stays linear', async () => {
    const x = await k.setup();
    const v = await k.admitScenario(x, 'rr');
    const val = await k.validate(x, 'rr-v', SCENARIO, v);
    const rp = k.proposalOf(SCENARIO, v, { intent: 'REVOKE', targetStateId: val.decided.state_id });
    const [ra, rb] = [await c.exec(k.submitSql(x.member, { commandId: x.cmd('rr-ra'), proposal: rp })),
      await c.exec(k.submitSql(x.member, { commandId: x.cmd('rr-rb'), proposal: rp }))];
    const { first, second } = await race(
      k.decideSql(x.scenarioValidator, { commandId: x.cmd('rr-a'), proposalId: ra.proposal_id, proposal: rp, outcome: 'REVOKE', expected: val.decided.state_id }),
      k.decideSql(x.scenarioValidator2, { commandId: x.cmd('rr-b'), proposalId: rb.proposal_id, proposal: rp, outcome: 'REVOKE', expected: val.decided.state_id }));
    const tomb = json(first.out);
    assert.equal(tomb.outcome, 'REVOKED');
    assert.match(second.err, /GV009|TARGET_ALREADY_REVOKED/, second.err);
    // Re-VALIDATE racing a stale REVOKE expectation.
    const vp = k.proposalOf(SCENARIO, v);
    const [va, vb] = [await c.exec(k.submitSql(x.member, { commandId: x.cmd('rr-va'), proposal: vp })),
      await c.exec(k.submitSql(x.member, { commandId: x.cmd('rr-vb'), proposal: vp }))];
    const r2 = await race(
      k.decideSql(x.scenarioValidator, { commandId: x.cmd('rr-va-d'), proposalId: va.proposal_id, proposal: vp, expected: tomb.state_id }),
      k.decideSql(x.scenarioValidator2, { commandId: x.cmd('rr-vb-d'), proposalId: vb.proposal_id, proposal: vp, expected: tomb.state_id }));
    assert.equal(json(r2.first.out).outcome, 'VALIDATED');
    assert.match(r2.second.err, /GV009|ALREADY_VALIDATED/, r2.second.err);
    assert.equal(await one(`select string_agg(state_kind, '>' order by recorded_at) from gov_repo.l15_risk_scenario_definition_states
      where scenario_definition_version_id='${v.scenario_definition_version_id}'`), 'VALIDATED>REVOKED>VALIDATED');
  });

  // attack 21 / O57: role / membership / user / organisation deactivation committed while a registry command waits.
  interface AuthorityRace { key: string; change: (actorId: string, org: string) => string; expect: RegExp | string }
  const races: AuthorityRace[] = [
    { key: 'role revocation', change: id => `update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: id => `update gov_repo.governance_users set external_id='rotated' where user_id='${id}';`, expect: /GV002/ },
    { key: 'user suspension', change: id => `update gov_repo.governance_users set status='suspended' where user_id='${id}';`, expect: /GV003/ },
    { key: 'organisation deactivation', change: (_id, org) => `update gov_repo.organisations set is_active=false where organisation_id='${org}';`, expect: /GV003/ },
  ];
  for (const r of races) {
    await t.test(`attack 21: VALIDATE waiting on a committed ${r.key} is evaluated against the committed state; nothing partial`, async () => {
      const x = await k.setup();
      const v = await k.admitMethodology(x, 'ar');
      const p = k.proposalOf(METHODOLOGY, v);
      const s = await c.exec(k.submitSql(x.member, { commandId: x.cmd('ar-s'), proposal: p }));
      const before = await k.counts(x.org);
      const { second } = await race(r.change(x.methodologyValidator.id, x.org),
        k.decideSql(x.methodologyValidator, { commandId: x.cmd('ar-v'), proposalId: s.proposal_id, proposal: p }), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l15_risk_methodology_states, before.l15_risk_methodology_states, 'no state written');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', r.expect]);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
    await t.test(`attack 21: ADMIT waiting on a committed ${r.key} admits nothing`, async () => {
      const x = await k.setup();
      const before = await k.counts(x.org);
      const { second } = await race(r.change(x.scenarioAdmitter.id, x.org), k.admitScenarioSql(x.scenarioAdmitter,
        { commandId: x.cmd('aa'), identityId: randomUUID(), versionId: randomUUID() }, scenarioContent({}, 'AA')), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l15_risk_scenario_definition_versions, before.l15_risk_scenario_definition_versions, 'nothing admitted');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', r.expect]);
      } else {
        assert.match(second.err, r.expect, second.err);
      }
    });
  }

  await t.test('attack 22: Authority Policy succession removing the grant commits first -> the waiting VALIDATE is a durable DENY under the new basis', async () => {
    const x = await k.setup();
    const v = await k.admitScenario(x, 'apd');
    const p = k.proposalOf(SCENARIO, v);
    const s = await c.exec(k.submitSql(x.member, { commandId: x.cmd('apd-s'), proposal: p }));
    const apV = await k.sk.admitNext(x, x.ops, 'apd-ap-admit', [...k.opsRules(), ...k.l15Rules().filter(r => r.permission !== 'L15_RISK_SCENARIO_VALIDATE')]);
    const apProposal = k.sk.validateProposal(apV);
    const apSubmitted = await k.sk.submit(x, x.member, 'apd-ap-submit', apProposal);
    const apHead = await k.sk.head(x.org);
    const { first, second } = await race(
      k.sk.decideSqlFor(x, x.ops, x.cmd('apd-ap-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.decideSql(x.scenarioValidator, { commandId: x.cmd('apd-v'), proposalId: s.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`),
      apV.version_id, 'evaluated under the successor Authority Policy');
    assert.equal(await k.resolve(SCENARIO, x.org, v, 'clock_timestamp()', 'clock_timestamp()'), null);
  });

  await t.test('a registry decision in flight (AP guard SHARED) holds off an Authority Policy VALIDATE (EXCLUSIVE)', async () => {
    const x = await k.setup();
    const v = await k.admitScenario(x, 'aph');
    const p = k.proposalOf(SCENARIO, v);
    const s = await c.exec(k.submitSql(x.member, { commandId: x.cmd('aph-s'), proposal: p }));
    const apV = await k.sk.admitNext(x, x.ops, 'aph-ap-admit', [...k.opsRules(), ...k.l15Rules()].reverse());
    const apProposal = k.sk.validateProposal(apV);
    const apSubmitted = await k.sk.submit(x, x.member, 'aph-ap-submit', apProposal);
    const apHead = await k.sk.head(x.org);
    const { first, second } = await race(k.decideSql(x.scenarioValidator, { commandId: x.cmd('aph-v'), proposalId: s.proposal_id, proposal: p }),
      k.sk.decideSqlFor(x, x.ops, x.cmd('aph-ap-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.equal(json(second.out).outcome, 'VALIDATED');
  });

  await t.test('subject / version-id / AP guard held -> 55P03 after lock_timeout; nothing written; command reusable', async () => {
    const x = await k.setup();
    const v = await k.admitMethodology(x, 'lt');
    const p = k.proposalOf(METHODOLOGY, v);
    const s = await c.exec(k.submitSql(x.member, { commandId: x.cmd('lt-s'), proposal: p }));
    const fresh = { id: randomUUID(), ver: randomUUID() };
    const admitFresh = () => k.admitMethodologySql(x.methodologyAdmitter, { commandId: x.cmd('lt-a'), identityId: fresh.id, versionId: fresh.ver }, methodologyContent());
    const holder = c.session('m16_bootstrap');
    const before = await k.counts(x.org);
    try {
      await holder.run(`begin; select gov_repo.l15_lock_registry_subject_guard_v1('${x.org}','RISK_METHODOLOGY',
        'VALIDATION:${v.methodology_id}:${v.methodology_version_id}:${v.content_hash}');
        select gov_repo.l15_lock_registry_subject_guard_v1('${x.org}','RISK_METHODOLOGY','IDENTITY:${fresh.id}');`);
      await assert.rejects(c.svc(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lt-v'), proposalId: s.proposal_id, proposal: p })), /55P03/);
      await assert.rejects(c.svc(admitFresh()), /55P03/);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l15_lock_registry_subject_guard_v1('${x.org}','RISK_METHODOLOGY','VERSION:${fresh.ver}');`);
      await assert.rejects(c.svc(admitFresh()), /55P03/);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${x.org}');`);
      await assert.rejects(c.svc(admitFresh()), /55P03/, 'the EXCLUSIVE AP guard blocks the SHARED registry guard');
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.decideSql(x.methodologyValidator, { commandId: x.cmd('lt-v'), proposalId: s.proposal_id, proposal: p }))).outcome, 'VALIDATED');
    assert.equal((await c.exec(admitFresh())).outcome, 'ADMITTED');
  });
});
