import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX } from '@council/canonical-contracts';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { METHODOLOGY } from '../helpers/m17-s2-fixtures';
import { NON_MONOTONE_CELLS, m17s4Kit, type M17S4Ctx, type Meth } from '../helpers/m17-s4-fixtures';

/**
 * M17-S4 — RISK_ASSESSMENT concurrency on real disposable PostgreSQL 17 (M17S4 horizon). Distinct backends contend for the
 * real locks (ORG -> USER -> ROLES FOR SHARE, AP guard SHARED, the S2 scenario key SHARED, the S3 GOVERNED_RISK key SHARED, the
 * S2 methodology key SHARED, the exact assessment key, the command guard); blocking is observed via pg_stat_activity +
 * pg_blocking_pids from a separate monitor session. Attacks 17-20, 44-49, 72 and the O57 / O66 S4 portions. Every commit below
 * is a NATURAL commit of a service_role session: the S2R1 root ALLOW guard fires at COMMIT; no S4 writer issues SET CONSTRAINTS.
 */
const OP = L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL;
const OP_TOKENS = [...OP.objects, ...OP.relationships.map(r => `REL:${r}`)];

test('M17-S4 RISK_ASSESSMENT concurrency (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S4' });
  t.after(() => c.stop());
  const k = await m17s4Kit(c);
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
  const m = await k.methodology(x, 'cm');
  const subjects = [...OP.objects.map(kind => objectSubject(kind, x.objects[kind]!)), ...OP.relationships.map(r => relSubject(x.rels[r]!))];
  let n = 0, next = 0;
  const nm = (p: string) => `${p}-${++n}`;
  let pool = await k.k3.scenario(x, 'cpool-0', 'OPERATIONAL', OP_TOKENS);
  const freshRisk = async (ctx: M17S4Ctx = x) => {
    if (ctx !== x) return k.risk(ctx, nm('crisk'));
    if (next === subjects.length) { pool = await k.k3.scenario(x, nm('cpool'), 'OPERATIONAL', OP_TOKENS); next = 0; }
    const subject = subjects[next++]!;
    const v = await k.k3.validateRisk(x, nm('cgr'), subject, pool);
    return { stateId: v.stateId, subject, scen: pool, decided: v.decided };
  };
  const until = () => k.instant('20 days');

  await t.test('attack 44: concurrent first VALIDATEs of one assessment key (two proposals, expected-none): one state; loser GV009, nothing consumed', async () => {
    const r = await freshRisk();
    const pa = k.rated(r.stateId, m, 'L1', 'I1', await until()), pb = k.rated(r.stateId, m, 'L2', 'I2', await until());
    const a = await k.submit(x, nm('f1'), pa), b = await k.submit(x, nm('f2'), pb);
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSql(x.assessor, { commandId: x.cmd(nm('fd1')), proposalId: a.proposal_id, proposal: pa }),
      k.decideSql(x.assessor2, { commandId: x.cmd(nm('fd2')), proposalId: b.proposal_id, proposal: pb }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RISK_ASSESSMENT_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l15_risk_assessment_states, before.l15_risk_assessment_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where governed_risk_state_id='${r.stateId}' and predecessor_state_id is null`), '1');
  });

  await t.test('attack 45: concurrent successor VALIDATEs (same expected head): one successor, never a fork', async () => {
    const r = await freshRisk();
    const root = await k.assess(x, nm('sr'), k.rated(r.stateId, m, 'L1', 'I1', await until()));
    const pa = k.rated(r.stateId, m, 'L3', 'I1', await until(), { expectedCurrentStateId: root.stateId });
    const pb = k.rated(r.stateId, m, 'L4', 'I1', await until(), { expectedCurrentStateId: root.stateId });
    const a = await k.submit(x, nm('sa'), pa), b = await k.submit(x, nm('sb'), pb);
    const { first, second } = await race(k.decideSql(x.assessor, { commandId: x.cmd(nm('sda')), proposalId: a.proposal_id, proposal: pa }),
      k.decideSql(x.assessor2, { commandId: x.cmd(nm('sdb')), proposalId: b.proposal_id, proposal: pb }));
    assert.equal(json(first.out).predecessor_state_id, root.stateId);
    assert.match(second.err, /GV009[\s\S]*EXPECTATION_MISMATCH/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where predecessor_state_id='${root.stateId}'`), '1', 'never a fork');
    assert.equal(await k.resolve(x.org, r.stateId), json(first.out).state_id);
  });

  await t.test('attack 46: concurrent VALIDATE (successor) vs REVOKE of the same current assessment, both orders: one winner; lineage linear', async () => {
    for (const revokeFirst of [true, false]) {
      const r = await freshRisk();
      const root = await k.assess(x, nm('vr'), k.rated(r.stateId, m, 'L2', 'I3', await until()));
      const pv = k.rated(r.stateId, m, 'L2', 'I4', await until(), { expectedCurrentStateId: root.stateId });
      const pr = k.revocation(r.stateId, m, root.stateId);
      const sv = await k.submit(x, nm('vrv'), pv), sr = await k.submit(x, nm('vrr'), pr);
      const rv = k.decideSql(x.assessor, { commandId: x.cmd(nm('vrd1')), proposalId: sr.proposal_id, proposal: pr, outcome: 'REVOKE' });
      const va = k.decideSql(x.assessor2, { commandId: x.cmd(nm('vrd2')), proposalId: sv.proposal_id, proposal: pv });
      const { first, second } = revokeFirst ? await race(rv, va) : await race(va, rv);
      assert.equal(json(first.out).outcome, revokeFirst ? 'REVOKED' : 'VALIDATED');
      assert.match(second.err, /GV009|TARGET_STATE_NOT_CURRENT/, second.err);
      assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where predecessor_state_id='${root.stateId}'`), '1');
    }
  });

  await t.test('attack 49: the same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const r = await freshRisk();
    const p = k.rated(r.stateId, m, 'L1', 'I3', await until());
    const sub = await k.submit(x, nm('same'), p);
    const sql = k.decideSql(x.assessor, { commandId: x.cmd(nm('same-d')), proposalId: sub.proposal_id, proposal: p });
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.replay, b.replay, b.state_id, b.recorded_at, b.rating_band], [false, true, a.state_id, a.recorded_at, a.rating_band]);
  });

  await t.test('attack 47: GOVERNED_RISK REVOKE / supersession racing an assessment VALIDATE, both orders: never both committed against incompatible truth', async () => {
    // (a) The risk REVOKE holds the S3 key EXCLUSIVELY; the assessment VALIDATE waits on the SHARED mode of the same key and then
    //     fails closed against the revoked risk (nothing consumed).
    const r = await freshRisk();
    const p = k.rated(r.stateId, m, 'L1', 'I2', await until());
    const sub = await k.submit(x, nm('rr-a'), p);
    const grRevoke = k.k3.proposalOf(r.subject, r.scen, { intent: 'REVOKE', targetStateId: r.stateId, expectedCurrentStateId: r.stateId,
      closureReason: 'RISK_NO_LONGER_APPLICABLE' });
    const grSub = await k.k3.submit(x as never, nm('rr-a-gr'), grRevoke);
    const c0 = await k.raCounts(x.org);
    const a = await race(k.k3.decideSql(x.validator, { commandId: x.cmd(nm('rr-a-grd')), proposalId: grSub.proposal_id, proposal: grRevoke, outcome: 'REVOKE' }),
      k.decideSql(x.assessor, { commandId: x.cmd(nm('rr-a-d')), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(json(a.first.out).outcome, 'REVOKED');
    assert.match(a.second.err, /GV010[\s\S]*GOVERNED_RISK_DEPENDENCY_NOT_VALID/, a.second.err);
    assert.deepEqual(await k.raCounts(x.org), c0, 'nothing consumed');
    // (b) The assessment VALIDATE holds the SHARED dependency guard; the risk REVOKE waits, commits after it, and the committed
    //     assessment becomes not current through the exact resolver (its row is never written).
    const r2 = await freshRisk();
    const p2 = k.rated(r2.stateId, m, 'L1', 'I2', await until());
    const sub2 = await k.submit(x, nm('rr-b'), p2);
    const grRevoke2 = k.k3.proposalOf(r2.subject, r2.scen, { intent: 'REVOKE', targetStateId: r2.stateId, expectedCurrentStateId: r2.stateId,
      closureReason: 'RECORDED_IN_ERROR' });
    const grSub2 = await k.k3.submit(x as never, nm('rr-b-gr'), grRevoke2);
    const b = await race(k.decideSql(x.assessor, { commandId: x.cmd(nm('rr-b-d')), proposalId: sub2.proposal_id, proposal: p2 }),
      k.k3.decideSql(x.validator, { commandId: x.cmd(nm('rr-b-grd')), proposalId: grSub2.proposal_id, proposal: grRevoke2, outcome: 'REVOKE' }));
    const assessed = json(b.first.out);
    assert.equal(assessed.outcome, 'VALIDATED');
    assert.equal(json(b.second.out).outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, r2.stateId), null);
    assert.equal((await k.resolution(x.org, r2.stateId)).resolution, 'GOVERNED_RISK_DEPENDENCY_INVALID');
    assert.equal(await k.resolve(x.org, r2.stateId, `'${assessed.recorded_at}'::timestamptz`, `'${assessed.recorded_at}'::timestamptz`), assessed.state_id);
    // (c) A supersession (authorized repin of the same risk key) in flight holds off the assessment VALIDATE, which then fails
    //     closed (the old risk state is no longer current; it never transfers to the successor).
    const r3 = await freshRisk();
    const p3 = k.rated(r3.stateId, m, 'L3', 'I3', await until());
    const sub3 = await k.submit(x, nm('rr-c'), p3);
    const succ = await k.k3.scenarioSuccessor(x as never, nm('rr-c-v2'), r3.scen, 'OPERATIONAL', OP_TOKENS);
    const repin = k.k3.proposalOf(r3.subject, succ, { expectedCurrentStateId: r3.stateId });
    const repinSub = await k.k3.submit(x as never, nm('rr-c-repin'), repin);
    const cc = await race(k.k3.decideSql(x.validator, { commandId: x.cmd(nm('rr-c-rd')), proposalId: repinSub.proposal_id, proposal: repin }),
      k.decideSql(x.assessor, { commandId: x.cmd(nm('rr-c-d')), proposalId: sub3.proposal_id, proposal: p3 }));
    assert.equal(json(cc.first.out).outcome, 'VALIDATED');
    assert.match(cc.second.err, /GV010[\s\S]*GOVERNED_RISK_DEPENDENCY_NOT_VALID/, cc.second.err);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where governed_risk_state_id in ('${r3.stateId}','${json(cc.first.out).state_id}')`), '0');
  });

  await t.test('attack 48: methodology REVOKE racing an assessment VALIDATE, both orders: never committed against an invalid methodology pin', async () => {
    const revokeSql = async (meth: Meth, label: string) => {
      const proposal = k.s2.proposalOf(METHODOLOGY, meth.admitted, { intent: 'REVOKE', targetStateId: meth.stateId });
      const submitted = await c.exec(k.s2.submitSql(x.member, { commandId: x.cmd(nm(`${label}-ms`)), proposal }));
      return k.s2.decideSql(x.methodologyValidator, { commandId: x.cmd(nm(`${label}-md`)), proposalId: submitted.proposal_id, proposal,
        outcome: 'REVOKE', expected: meth.stateId });
    };
    // (a) The methodology REVOKE holds the S2 VALIDATION key EXCLUSIVELY; the assessment waits on its SHARED mode and fails closed.
    const ma = await k.methodology(x, 'cm-a');
    const r = await freshRisk();
    const p = k.rated(r.stateId, ma, 'L4', 'I2', await until());
    const sub = await k.submit(x, nm('mr-a'), p);
    const c0 = await k.raCounts(x.org);
    const a = await race(await revokeSql(ma, 'mr-a'), k.decideSql(x.assessor, { commandId: x.cmd(nm('mr-a-d')), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(json(a.first.out).outcome, 'REVOKED');
    assert.match(a.second.err, /GV010[\s\S]*METHODOLOGY_DEPENDENCY_NOT_VALID/, a.second.err);
    assert.deepEqual(await k.raCounts(x.org), c0, 'nothing consumed');
    // (b) The assessment holds the SHARED methodology guard; the REVOKE waits and commits after; the assessment is then not current.
    const mb = await k.methodology(x, 'cm-b');
    const r2 = await freshRisk();
    const p2 = k.rated(r2.stateId, mb, 'L4', 'I2', await until());
    const sub2 = await k.submit(x, nm('mr-b'), p2);
    const rv = await revokeSql(mb, 'mr-b');
    const b = await race(k.decideSql(x.assessor, { commandId: x.cmd(nm('mr-b-d')), proposalId: sub2.proposal_id, proposal: p2 }), rv);
    assert.deepEqual([json(b.first.out).outcome, json(b.first.out).rating_band], ['VALIDATED', NON_MONOTONE_CELLS['L4:I2']]);
    assert.equal(json(b.second.out).outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, r2.stateId), null);
    assert.equal((await k.resolution(x.org, r2.stateId)).resolution, 'METHODOLOGY_DEPENDENCY_INVALID');
  });

  // attacks 17-19 / O57: eligibility changes committed while an assessment VALIDATE waits on them.
  for (const r of [
    { key: 'role revocation (19)', change: (id: string) => `update gov_repo.governance_users set role_ids=array['${c.memberRole}']::uuid[] where user_id='${id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: (id: string) => `update gov_repo.governance_users set external_id='rotated' where user_id='${id}';`, expect: /GV002/ },
    { key: 'inactive user (17)', change: (id: string) => `update gov_repo.governance_users set status='suspended' where user_id='${id}';`, expect: /GV003/ },
    { key: 'inactive organisation (18)', change: (_id: string, org: string) => `update gov_repo.organisations set is_active=false where organisation_id='${org}';`, expect: /GV003/ },
  ] as const) {
    await t.test(`attacks 17-19: an assessment VALIDATE waiting on a committed ${r.key} writes no state`, async () => {
      const y = await k.setup();
      const my = await k.methodology(y, 'elig-m');
      const ry = await freshRisk(y);
      const p = k.rated(ry.stateId, my, 'L1', 'I1', await until());
      const sub = await k.submit(y, 'elig', p);
      const before = await k.counts(y.org);
      const { second } = await race(r.change(y.assessor.id, y.org),
        k.decideSql(y.assessor, { commandId: y.cmd('elig-d'), proposalId: sub.proposal_id, proposal: p }), 'postgres');
      const after = await k.counts(y.org);
      assert.equal(after.l15_risk_assessment_states, before.l15_risk_assessment_states, 'no state');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', r.expect]);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('attack 20: an Authority Policy succession removing L15_RISK_ASSESSMENT_VALIDATE commits first -> the waiting VALIDATE is a durable DENY under the successor', async () => {
    const y = await k.setup();
    const my = await k.methodology(y, 'aps-m');
    const ry = await freshRisk(y);
    const p = k.rated(ry.stateId, my, 'L1', 'I1', await until());
    const sub = await k.submit(y, 'aps', p);
    const sk = k.s2.sk;
    const apV = await sk.admitNext(y as never, y.ops, 'aps-ap-admit', [...k.s2.opsRules(), ...k.s2.l15Rules(), ...k.k3.grRules(y.objects, y.rels)]);
    const apProposal = sk.validateProposal(apV);
    const apSubmitted = await sk.submit(y as never, y.member, 'aps-ap-submit', apProposal);
    const apHead = await sk.head(y.org);
    const { first, second } = await race(
      sk.decideSqlFor(y as never, y.ops, y.cmd('aps-ap-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.decideSql(y.assessor, { commandId: y.cmd('aps-d'), proposalId: sub.proposal_id, proposal: p }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`),
      apV.version_id, 'evaluated under the successor Authority Policy');
    assert.equal((await k.raCounts(y.org)).states, 0);
  });

  await t.test('attack 72: the S4 writer relies on the natural deferred S2R1 ALLOW guard (explicit service_role transaction, plain COMMIT); a forged ALLOW is refused at COMMIT', async () => {
    assert.equal(await one(`select count(*) from pg_proc where proname in ('l15_submit_risk_assessment_proposal_v1','l15_decide_risk_assessment_proposal_v1',
      'l15_read_risk_assessment_v1') and prosrc ~* 'set\\s+constraints'`), '0', 'no SET CONSTRAINTS workaround in any S4 writer');
    assert.deepEqual(await k.json(`select json_build_object('deferrable', tgdeferrable, 'deferred', tginitdeferred, 'enabled', tgenabled,
        'definer', (select prosecdef from pg_proc where oid=tgfoid), 'when', pg_get_triggerdef(oid) ~ 'RISK_ASSESSMENT')
      from pg_trigger where tgname='l15_authorization_decisions_allow_guard'`),
      { deferrable: true, deferred: true, enabled: 'A', definer: true, when: true });
    const r = await freshRisk();
    const p = k.rated(r.stateId, m, 'L2', 'I4', await until());
    const sub = await k.submit(x, nm('nat'), p);
    const session = c.session('service_role');
    try {
      await session.run('begin;');
      const decided = await session.run(k.decideSql(x.assessor, { commandId: x.cmd(nm('nat-d')), proposalId: sub.proposal_id, proposal: p }));
      assert.equal(decided.err, '', decided.err);
      const commit = await session.run('commit;');
      assert.equal(commit.err, '', commit.err);
      const d = json(decided.out);
      assert.equal(await one(`select result from gov_repo.l14_authorization_decisions where authorization_decision_id='${d.authorization_decision_id}'`), 'ALLOW');
      assert.equal(await k.resolve(x.org, r.stateId), d.state_id);
    } finally { await session.close(); }
    // The natural guard still refuses an owner-forged RISK_ASSESSMENT ALLOW without an L15 rule (fires at the plain COMMIT).
    const forged = c.session('postgres');
    try {
      await forged.run('begin;');
      const forgedId = (await forged.run('select gen_random_uuid();')).out.trim();
      const ins = await forged.run(`insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,
        actor_user_id,requested_action,subject_kind,scope_tag,target_canonical_kind,target_canonical_object_id,source_class,proposal_id,is_self_validation,
        authority_basis,basis_authority_policy_id,basis_version_id,basis_content_hash,result,evaluated_at,expectation_kind)
        select '${x.org}', '${forgedId}', 'forged-ra-${n}', repeat('c',64), '${x.member.id}', 'VALIDATE', 'RISK_ASSESSMENT', 'CANONICAL_OBJECT', 'AGENT',
          '${x.objects.AGENT}', 'LOCAL_HUMAN', '${sub.proposal_id}', false, 'AUTHORITY_POLICY_VERSION', b.authority_policy_id, b.version_id, b.content_hash,
          'ALLOW', clock_timestamp(), 'EXPECTED_NONE' from gov_repo.l14_effective_authority_basis_v1('${x.org}', clock_timestamp()) b;
        insert into gov_repo.l14_command_results(organisation_id,command_id,command_kind,subject_kind,command_fingerprint,actor_user_id,outcome,
          authorization_decision_id,proposal_id,recorded_at) values('${x.org}','forged-ra-${n}','DECIDE_PROPOSAL','RISK_ASSESSMENT',repeat('c',64),'${x.member.id}',
          'DENIED','${forgedId}','${sub.proposal_id}',clock_timestamp());`);
      assert.equal(ins.err, '', ins.err);
      const commit = await forged.run('commit;');
      assert.match(commit.err, /GV010[\s\S]*L15_ALLOW_WITHOUT_L15_AUTHORITY/, commit.err);
    } finally { await forged.close(); }
  });

  await t.test('different assessment keys (and the same methodology / scenario) never serialize on each other', async () => {
    const ra = await freshRisk(), rb = await freshRisk();
    const pa = k.rated(ra.stateId, m, 'L1', 'I1', await until()), pb = k.rated(rb.stateId, m, 'L1', 'I1', await until());
    const a = await k.submit(x, nm('par-a'), pa), b = await k.submit(x, nm('par-b'), pb);
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      assert.equal((await s1.run(k.decideSql(x.assessor, { commandId: x.cmd(nm('par-da')), proposalId: a.proposal_id, proposal: pa }))).err, '');
      const r = await s2.run(k.decideSql(x.assessor2, { commandId: x.cmd(nm('par-db')), proposalId: b.proposal_id, proposal: pb }), 15_000);
      assert.equal(r.err, '', r.err);
      assert.equal((await s1.run('commit;')).err, '');
    } finally { await Promise.all([s1.close(), s2.close()]); }
    assert.ok(await k.resolve(x.org, ra.stateId));
    assert.ok(await k.resolve(x.org, rb.stateId));
  });
});
