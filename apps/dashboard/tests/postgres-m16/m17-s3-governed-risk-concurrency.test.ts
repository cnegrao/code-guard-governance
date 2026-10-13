import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX } from '@council/canonical-contracts';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { m17s3Kit, objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { SCENARIO } from '../helpers/m17-s2-fixtures';

/**
 * M17-S3 — GOVERNED_RISK concurrency on real disposable PostgreSQL 17 (M17S3 horizon). Distinct backends contend for the real
 * locks (ORG -> USER -> ROLES FOR SHARE, AP guard SHARED, the S2 scenario registry key in SHARED mode, the exact logical-key
 * guard, the command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor session.
 * Attacks 14, 15, 31-33, 57 and the O57 / O66 S3 portions. Every commit below is a NATURAL commit of a service_role session:
 * the S2R1 root ALLOW guard fires at COMMIT; no S3 writer issues SET CONSTRAINTS.
 */
const op = [...L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL.objects, ...L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL.relationships.map(r => `REL:${r}`)];

test('M17-S3 GOVERNED_RISK concurrency (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S3' });
  t.after(() => c.stop());
  const k = await m17s3Kit(c);
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
  /** `first` in an open transaction; `second` must block on it; commit (natural); return both. */
  async function race(first: string, second: string, firstRole: 'service_role' | 'postgres' = 'service_role') {
    const s1 = c.session(firstRole), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(second);
      await awaitBlocked(p2, p1);
      const commit = await s1.run('commit;');
      assert.equal(commit.err, '', commit.err);
      return { first: a, second: await pending };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }

  const x = await k.setup();
  const scen = await k.scenario(x, 'cc', 'OPERATIONAL', op);
  const v2 = await k.scenarioSuccessor(x, 'cc-v2', scen, 'OPERATIONAL', op);
  const v3 = await k.scenarioSuccessor(x, 'cc-v3', v2, 'OPERATIONAL', op);
  let n = 0;
  const nm = (p: string) => `${p}-${++n}`;

  await t.test('attack 31: concurrent first VALIDATEs of one logical key (two proposals, expected-none): one state; loser GV009, nothing consumed', async () => {
    const s = objectSubject('AGENT', x.objects.AGENT!);
    const p = k.proposalOf(s, scen);
    const a = await k.submit(x, nm('f1'), p), b = await k.submit(x, nm('f2'), p);
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSql(x.validator, { commandId: x.cmd(nm('fd1')), proposalId: a.proposal_id, proposal: p }),
      k.decideSql(x.validator2, { commandId: x.cmd(nm('fd2')), proposalId: b.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*GOVERNED_RISK_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l15_governed_risk_states, before.l15_governed_risk_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(await one(`select count(*) from gov_repo.l15_governed_risk_states where organisation_id='${x.org}'
      and subject_key=gov_repo.l15_risk_subject_key_v1('CANONICAL_OBJECT','AGENT','${x.objects.AGENT}',null,null) and predecessor_state_id is null`), '1');
  });

  await t.test('attack 32: concurrent successor VALIDATEs (explicit repins to two versions, same expected head): one successor, never a fork', async () => {
    const s = objectSubject('MODEL', x.objects.MODEL!);
    const root = await k.validateRisk(x, nm('sr'), s, scen);
    const pa = k.proposalOf(s, v2, { expectedCurrentStateId: root.stateId }), pb = k.proposalOf(s, v3, { expectedCurrentStateId: root.stateId });
    const a = await k.submit(x, nm('sa'), pa), b = await k.submit(x, nm('sb'), pb);
    const { first, second } = await race(k.decideSql(x.validator, { commandId: x.cmd(nm('sda')), proposalId: a.proposal_id, proposal: pa }),
      k.decideSql(x.validator2, { commandId: x.cmd(nm('sdb')), proposalId: b.proposal_id, proposal: pb }));
    assert.equal(json(first.out).predecessor_state_id, root.stateId);
    assert.match(second.err, /GV009[\s\S]*EXPECTATION_MISMATCH/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l15_governed_risk_states where predecessor_state_id='${root.stateId}'`), '1', 'never a fork');
    assert.equal(await k.resolve(x.org, s, scen.id), json(first.out).state_id);
  });

  await t.test('attack 33: concurrent VALIDATE (successor) vs REVOKE of the same current state: one winner; lineage linear', async () => {
    const s = objectSubject('TOOL', x.objects.TOOL!);
    const root = await k.validateRisk(x, nm('vr'), s, scen);
    const pv = k.proposalOf(s, v2, { expectedCurrentStateId: root.stateId });
    const pr = k.proposalOf(s, scen, { intent: 'REVOKE', targetStateId: root.stateId, expectedCurrentStateId: root.stateId, closureReason: 'RISK_NO_LONGER_APPLICABLE' });
    const sv = await k.submit(x, nm('vrv'), pv), sr = await k.submit(x, nm('vrr'), pr);
    const { first, second } = await race(k.decideSql(x.validator, { commandId: x.cmd(nm('vrd1')), proposalId: sr.proposal_id, proposal: pr, outcome: 'REVOKE' }),
      k.decideSql(x.validator2, { commandId: x.cmd(nm('vrd2')), proposalId: sv.proposal_id, proposal: pv }));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV009[\s\S]*EXPECTATION_MISMATCH/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l15_governed_risk_states where predecessor_state_id='${root.stateId}'`), '1');
    // And the reverse order: a waiting REVOKE of a superseded state is stale.
    const s2 = objectSubject('API', x.objects.API!);
    const root2 = await k.validateRisk(x, nm('vr2'), s2, scen);
    const pv2 = k.proposalOf(s2, v2, { expectedCurrentStateId: root2.stateId });
    const pr2 = k.proposalOf(s2, scen, { intent: 'REVOKE', targetStateId: root2.stateId, expectedCurrentStateId: root2.stateId, closureReason: 'RECORDED_IN_ERROR' });
    const sv2 = await k.submit(x, nm('vrv2'), pv2), sr2 = await k.submit(x, nm('vrr2'), pr2);
    const r2 = await race(k.decideSql(x.validator, { commandId: x.cmd(nm('vrd3')), proposalId: sv2.proposal_id, proposal: pv2 }),
      k.decideSql(x.validator2, { commandId: x.cmd(nm('vrd4')), proposalId: sr2.proposal_id, proposal: pr2, outcome: 'REVOKE' }));
    assert.equal(json(r2.first.out).outcome, 'VALIDATED');
    assert.match(r2.second.err, /GV009|TARGET_STATE_NOT_CURRENT/, r2.second.err);
  });

  await t.test('same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const s = objectSubject('MCP_SERVER', x.objects.MCP_SERVER!);
    const p = k.proposalOf(s, scen);
    const sub = await k.submit(x, nm('same'), p);
    const sql = k.decideSql(x.validator, { commandId: x.cmd(nm('same-d')), proposalId: sub.proposal_id, proposal: p });
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.replay, b.replay, b.state_id, b.recorded_at], [false, true, a.state_id, a.recorded_at]);
  });

  // attack 11 / 12 / 13 / 14 / O57: eligibility changes committed while a GOVERNED_RISK VALIDATE waits on them.
  for (const r of [
    { key: 'role revocation (13)', change: (id: string) => `update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: (id: string) => `update gov_repo.governance_users set external_id='rotated' where user_id='${id}';`, expect: /GV002/ },
    { key: 'inactive user (11)', change: (id: string) => `update gov_repo.governance_users set status='suspended' where user_id='${id}';`, expect: /GV003/ },
    { key: 'inactive organisation (12)', change: (_id: string, org: string) => `update gov_repo.organisations set is_active=false where organisation_id='${org}';`, expect: /GV003/ },
  ] as const) {
    await t.test(`attack 14: VALIDATE waiting on a committed ${r.key} writes no state`, async () => {
      const y = await k.setup();
      const sc = await k.scenario(y, 'elig-scn', 'OPERATIONAL', ['AGENT']);
      const s = objectSubject('AGENT', y.objects.AGENT!);
      const p = k.proposalOf(s, sc);
      const sub = await k.submit(y, 'elig', p);
      const before = await k.counts(y.org);
      const { second } = await race(r.change(y.validator.id, y.org),
        k.decideSql(y.validator, { commandId: y.cmd('elig-d'), proposalId: sub.proposal_id, proposal: p }), 'postgres');
      const after = await k.counts(y.org);
      assert.equal(after.l15_governed_risk_states, before.l15_governed_risk_states, 'no state');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', r.expect]);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('attack 15: Authority Policy succession removing L15_GOVERNED_RISK_VALIDATE commits first -> the waiting VALIDATE is a durable DENY', async () => {
    const y = await k.setup();
    const sc = await k.scenario(y, 'aps-scn', 'OPERATIONAL', ['AGENT']);
    const s = objectSubject('AGENT', y.objects.AGENT!);
    const p = k.proposalOf(s, sc);
    const sub = await k.submit(y, 'aps', p);
    const sk = k.s2.sk;
    const apV = await sk.admitNext(y, y.ops, 'aps-ap-admit', [...k.s2.opsRules(), ...k.s2.l15Rules()]);
    const apProposal = sk.validateProposal(apV);
    const apSubmitted = await sk.submit(y, y.member, 'aps-ap-submit', apProposal);
    const apHead = await sk.head(y.org);
    const { first, second } = await race(
      sk.decideSqlFor(y, y.ops, y.cmd('aps-ap-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.decideSql(y.validator, { commandId: y.cmd('aps-d'), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`),
      apV.version_id, 'evaluated under the successor Authority Policy');
  });

  await t.test('scenario dependency guard: a scenario REVOKE in flight holds off a risk VALIDATE pinning it, which then fails closed', async () => {
    const sc = await k.scenario(x, 'dg', 'OPERATIONAL', op);
    const s = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
    const p = k.proposalOf(s, sc);
    const sub = await k.submit(x, nm('dg'), p);
    const rp = k.s2.proposalOf(SCENARIO, sc.admitted, { intent: 'REVOKE', targetStateId: sc.stateId });
    const rsub = await c.exec(k.s2.submitSql(x.member, { commandId: x.cmd(nm('dg-rs')), proposal: rp }));
    const { first, second } = await race(
      k.s2.decideSql(x.scenarioValidator, { commandId: x.cmd(nm('dg-rd')), proposalId: rsub.proposal_id, proposal: rp, outcome: 'REVOKE', expected: sc.stateId }),
      k.decideSql(x.validator, { commandId: x.cmd(nm('dg-d')), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*SCENARIO_DEPENDENCY_NOT_VALID/, second.err);
    // Reverse: a risk VALIDATE in flight holds off the scenario REVOKE; the committed risk then becomes not current.
    const sc2 = await k.scenario(x, 'dg2', 'OPERATIONAL', op);
    const p2 = k.proposalOf(s, sc2);
    const sub2 = await k.submit(x, nm('dg2'), p2);
    const rp2 = k.s2.proposalOf(SCENARIO, sc2.admitted, { intent: 'REVOKE', targetStateId: sc2.stateId });
    const rsub2 = await c.exec(k.s2.submitSql(x.member, { commandId: x.cmd(nm('dg2-rs')), proposal: rp2 }));
    const r2 = await race(k.decideSql(x.validator, { commandId: x.cmd(nm('dg2-d')), proposalId: sub2.proposal_id, proposal: p2 }),
      k.s2.decideSql(x.scenarioValidator, { commandId: x.cmd(nm('dg2-rd')), proposalId: rsub2.proposal_id, proposal: rp2, outcome: 'REVOKE', expected: sc2.stateId }));
    assert.equal(json(r2.first.out).outcome, 'VALIDATED');
    assert.equal(json(r2.second.out).outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, s, sc2.id), null, 'dependency invalid: not current');
    assert.equal((await k.read(x.member, s, sc2.id)).resolution, 'SCENARIO_DEPENDENCY_INVALID');
  });

  await t.test('attack 57: the S3 writer relies on the natural deferred S2R1 ALLOW guard (explicit service_role transaction, plain COMMIT)', async () => {
    assert.equal(await one(`select count(*) from pg_proc where proname in ('l15_submit_governed_risk_proposal_v1','l15_decide_governed_risk_proposal_v1',
      'l15_read_governed_risk_v1') and prosrc ~* 'set\\s+constraints'`), '0', 'no SET CONSTRAINTS workaround in any S3 writer');
    assert.deepEqual(await k.json(`select json_build_object('deferrable', tgdeferrable, 'deferred', tginitdeferred, 'enabled', tgenabled,
        'definer', (select prosecdef from pg_proc where oid=tgfoid)) from pg_trigger where tgname='l15_authorization_decisions_allow_guard'`),
      { deferrable: true, deferred: true, enabled: 'A', definer: true });
    const s = relSubject(x.rels.WRITES_TO!);
    const p = k.proposalOf(s, scen);
    const sub = await k.submit(x, nm('nat'), p);
    const session = c.session('service_role');
    try {
      await session.run('begin;');
      const decided = await session.run(k.decideSql(x.validator, { commandId: x.cmd(nm('nat-d')), proposalId: sub.proposal_id, proposal: p }));
      assert.equal(decided.err, '', decided.err);
      // Still pending: the deferred guard has not fired yet inside the open transaction.
      const commit = await session.run('commit;');
      assert.equal(commit.err, '', commit.err);
      const d = json(decided.out);
      assert.equal(await one(`select result from gov_repo.l14_authorization_decisions where authorization_decision_id='${d.authorization_decision_id}'`), 'ALLOW');
      assert.equal(await k.resolve(x.org, s, scen.id), d.state_id);
    } finally { await session.close(); }
    // The natural guard still refuses an owner-forged GOVERNED_RISK ALLOW without an L15 rule (fires at the plain COMMIT).
    const forged = c.session('postgres');
    try {
      await forged.run('begin;');
      const forgedId = (await forged.run('select gen_random_uuid();')).out.trim();
      const ins = await forged.run(`insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,
        actor_user_id,requested_action,subject_kind,scope_tag,target_canonical_kind,target_canonical_object_id,source_class,proposal_id,is_self_validation,
        authority_basis,basis_authority_policy_id,basis_version_id,basis_content_hash,result,evaluated_at,expectation_kind)
        select '${x.org}', '${forgedId}', 'forged-${n}', repeat('c',64), '${x.member.id}', 'VALIDATE', 'GOVERNED_RISK', 'CANONICAL_OBJECT', 'AGENT',
          '${x.objects.AGENT}', 'LOCAL_HUMAN', '${sub.proposal_id}', false, 'AUTHORITY_POLICY_VERSION', b.authority_policy_id, b.version_id, b.content_hash,
          'ALLOW', clock_timestamp(), 'EXPECTED_NONE' from gov_repo.l14_effective_authority_basis_v1('${x.org}', clock_timestamp()) b;
        insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,subject_kind,command_fingerprint,actor_user_id,outcome,
          authorization_decision_id,proposal_id,recorded_at) values('${x.org}','forged-${n}','DECIDE_PROPOSAL','GOVERNED_RISK',repeat('c',64),'${x.member.id}',
          'DENIED','${forgedId}','${sub.proposal_id}',clock_timestamp());`);
      assert.equal(ins.err, '', ins.err);
      const commit = await forged.run('commit;');
      assert.match(commit.err, /GV010[\s\S]*L15_ALLOW_WITHOUT_L15_AUTHORITY/, commit.err);
    } finally { await forged.close(); }
  });

  await t.test('different logical keys do not serialize on each other', async () => {
    const pa = k.proposalOf(relSubject(x.rels.USES_MODEL!), scen), pb = k.proposalOf(relSubject(x.rels.USES_TOOL!), scen);
    const a = await k.submit(x, nm('par-a'), pa), b = await k.submit(x, nm('par-b'), pb);
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      assert.equal((await s1.run(k.decideSql(x.validator, { commandId: x.cmd(nm('par-da')), proposalId: a.proposal_id, proposal: pa }))).err, '');
      const r = await s2.run(k.decideSql(x.validator2, { commandId: x.cmd(nm('par-db')), proposalId: b.proposal_id, proposal: pb }), 15_000);
      assert.equal(r.err, '', r.err);
      assert.equal((await s1.run('commit;')).err, '');
    } finally { await Promise.all([s1.close(), s2.close()]); }
  });
});
