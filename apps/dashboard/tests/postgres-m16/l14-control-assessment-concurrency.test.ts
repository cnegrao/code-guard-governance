import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit, inDays } from '../helpers/m16-l14-control-assessment-fixtures';

/**
 * M16-S1C.5 — CONTROL_ASSESSMENT concurrency on real disposable PostgreSQL 17 (S1C5 horizon). Distinct backends contend for
 * the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, the exact CONTROL_DEFINITION registry subject guard SHARED,
 * the exact S1C.4 CONTROL_APPLICABILITY fact KEY guard — SHARED for an assessment VALIDATE, EXCLUSIVE for an applicability
 * decision — the exact assessment fact KEY guard, the command guard); blocking is observed via pg_stat_activity +
 * pg_blocking_pids from a separate monitor session, never by sleeping alone. The loser fails typed and consumes nothing.
 */
test('M16 S1C.5 control assessment concurrency (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C5' });
  t.after(() => c.stop());
  const k = await controlAssessmentKit(c);
  const ca = k.cak;
  const { owner } = c;
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
  const one = async (query: string) => lastLine(await owner(query));
  /** Run `first` in an open transaction, start `second` which must block on it, commit, return both. */
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
  /** The exact S1C.4 fact KEY guard lock of an applicability key, as advisory-lock coordinates (classid / objid). */
  const applicabilityKeyLock = (org: string, targetKeySql: string, controlDefinitionId: string) =>
    `(select hashtextextended(gov_repo.frame_identity(array['${org}','l14-fact-subject-guard-v1','CONTROL_APPLICABILITY','KEY',
      ${targetKeySql},'${controlDefinitionId}']), 0) as v)`;

  await t.test('A: two DIFFERENT outcomes race as the first assessment of one applicability state → exactly one wins; the loser GV009, nothing consumed', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'ra', ca.objectTarget('AGENT', x.objects.byKind.AGENT));
    const [pa, pb] = [k.validateProposal(applies.stateId, 'SATISFIED'), k.validateProposal(applies.stateId, 'NOT_SATISFIED')];
    const [sa, sb] = [await k.submit(x, x.member, 'ra-submit', pa), await k.submit(x, x.member2, 'rb-submit', pb)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.as, x.cmd('ra'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.as2, x.cmd('rb'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).assessment_outcome, 'SATISFIED');
    assert.match(second.err, /GV009[\s\S]*CONTROL_ASSESSMENT_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    for (const table of ['l14_fact_states', 'l14_control_assessment_states', 'l14_governance_decisions', 'l14_authorization_decisions',
      'l14_command_results', 'l14_control_assessment_heads'] as const) {
      assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
    }
    assert.equal(await k.outcome(x.org, applies.stateId), 'SATISFIED');
  });

  await t.test('B: two renewals from the SAME expected state → exactly one successor; the loser stale (GV009); predecessor untouched', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'b', ca.relTarget(x.rels.reads));
    const s0 = await k.assess(x, 'b0', applies.stateId);
    const s0Rows = await k.stateRows(x.org, s0.stateId);
    const [p1, p2] = [k.validateProposal(applies.stateId, 'SATISFIED', inDays(90)), k.validateProposal(applies.stateId, 'PARTIALLY_SATISFIED')];
    const [q1, q2] = [await k.submit(x, x.member, 'b1-submit', p1), await k.submit(x, x.member2, 'b2-submit', p2)];
    const { first, second } = await race(k.decideSqlFor(x.as, x.cmd('b1'), q1.proposal_id, p1, 'VALIDATE', s0.stateId),
      k.decideSqlFor(x.as2, x.cmd('b2'), q2.proposal_id, p2, 'VALIDATE', s0.stateId));
    const won = json(first.out);
    assert.deepEqual([won.outcome, won.predecessor_state_id], ['VALIDATED', s0.stateId]);
    assert.match(second.err, /GV009[\s\S]*CONTROL_ASSESSMENT_STATE_EXPECTATION_MISMATCH/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_assessment_states where predecessor_state_id='${s0.stateId}'`), '1');
    assert.equal(await k.head(x.org, applies.stateId), won.fact_state_id);
    assert.equal(await k.stateRows(x.org, s0.stateId), s0Rows);
  });

  await t.test('applicability race order 1: an applicability REVOKE holds the EXCLUSIVE S1C.4 key guard; the waiting assessment sees it — GV010, nothing consumed', async () => {
    const x = await k.setup();
    const target = ca.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const applies = await k.applicability(x, 'ar1', target);
    const rvp = ca.revokeProposal(target, applies.pin, applies.stateId);
    const rvs = await ca.submit(x as never, x.member, 'ar1-ca-rv-submit', rvp);
    const p = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'ar1-submit', p);
    await c.evidence(x.org, 'ar1-ev');
    const digest = await k.factDigest(x.org);
    const decide = k.decideSql(x.as, { commandId: x.cmd('ar1'), proposalId: s.proposal_id, proposal: p,
      support: { status: 'PRESENT', evidenceIds: ['ar1-ev'] } });
    const { first, second } = await race(ca.decideSqlFor(x.cs, x.cmd('ar1-ca-rv'), rvs.proposal_id, rvp, 'REVOKE', applies.stateId), decide);
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID/, second.err);
    assert.equal(await k.factDigest(x.org), digest, 'the assessment consumed nothing (no authorization, decision, fact, head, result)');
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='ar1-ev'`), '0');
    assert.equal(await k.head(x.org, applies.stateId), null);
  });

  await t.test('applicability race order 1b: an applicability SUPERSESSION in flight is seen by the waiting assessment — GV010 (no successor is selected)', async () => {
    const x = await k.setup();
    const target = ca.objectTarget('TOOL', x.objects.byKind.TOOL);
    const applies = await k.applicability(x, 'ar1b', target);
    const sup = ca.validateProposal(target, applies.pin, 'DOES_NOT_APPLY');
    const sups = await ca.submit(x as never, x.member, 'ar1b-ca-sup-submit', sup);
    const p = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'ar1b-submit', p);
    const digest = await k.factDigest(x.org);
    const { first, second } = await race(ca.decideSqlFor(x.cs, x.cmd('ar1b-ca-sup'), sups.proposal_id, sup, 'VALIDATE', applies.stateId),
      k.decideSqlFor(x.as, x.cmd('ar1b'), s.proposal_id, p, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID/, second.err);
    assert.equal(await k.factDigest(x.org), digest);
  });

  await t.test('applicability race order 2: the assessment holds the SHARED key guard; the applicability REVOKE waits, commits after, makes it historical', async () => {
    const x = await k.setup();
    const target = ca.relTarget(x.rels.exposes);
    const applies = await k.applicability(x, 'ar2', target);
    const p = k.validateProposal(applies.stateId, 'NOT_ASSESSED');
    const s = await k.submit(x, x.member, 'ar2-submit', p);
    const rvp = ca.revokeProposal(target, applies.pin, applies.stateId);
    const rvs = await ca.submit(x as never, x.member, 'ar2-ca-rv-submit', rvp);
    const { first, second } = await race(k.decideSqlFor(x.as, x.cmd('ar2'), s.proposal_id, p, 'VALIDATE', null),
      ca.decideSqlFor(x.cs, x.cmd('ar2-ca-rv'), rvs.proposal_id, rvp, 'REVOKE', applies.stateId));
    const a = json(first.out), r = json(second.out);
    assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
    assert.ok(Date.parse(a.recorded_at) < Date.parse(r.recorded_at), 'the assessment committed before the applicability revocation was recorded');
    const rows = await k.stateRows(x.org, a.fact_state_id);
    assert.equal(await k.outcome(x.org, applies.stateId), 'UNKNOWN', 'the assessment is historical once its applicability is revoked');
    const at = `'${a.recorded_at}'::timestamptz`;
    assert.equal(await k.resolve(x.org, applies.stateId, at, at), a.fact_state_id, 'earlier coordinates still resolve');
    assert.equal(await k.stateRows(x.org, a.fact_state_id), rows);
  });

  await t.test('shared applicability key guard: an assessment VALIDATE holds the EXACT S1C.4 fact key in SHARE mode (pg_locks); the S1C.4 exclusive guard blocks on it', async () => {
    const x = await k.setup();
    const target = ca.objectTarget('API', x.objects.byKind.API);
    const applies = await k.applicability(x, 'sh', target);
    const p = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'sh-submit', p);
    const s1 = c.session('service_role'), s2 = c.session('postgres');
    try {
      await s1.run('begin;');
      assert.equal((await s1.run(k.decideSqlFor(x.as, x.cmd('sh'), s.proposal_id, p, 'VALIDATE', null))).err, '');
      const held = await one(`with k as ${applicabilityKeyLock(x.org, ca.keySql(target), applies.pin.subject.controlDefinitionId)}
        select count(distinct l.pid)||'|'||string_agg(distinct l.mode, ',') from pg_locks l, k where l.locktype='advisory' and l.granted
          and l.objsubid=1 and l.classid=((k.v >> 32) & 4294967295)::oid and l.objid=(k.v & 4294967295)::oid`);
      assert.equal(held, '1|ShareLock', 'the assessment holds the byte-identical S1C.4 applicability key in SHARE mode');
      // The S1C.4 decision path (l14_lock_fact_subject_guard_v1, EXCLUSIVE on the same key) waits on it.
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      await s2.run('begin;');
      const pending = s2.run(`select gov_repo.l14_lock_fact_subject_guard_v1('${x.org}', 'CONTROL_APPLICABILITY',
        array['KEY', ${ca.keySql(target)}, '${applies.pin.subject.controlDefinitionId}']);`);
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      assert.equal((await pending).err, '');
      await s2.run('rollback;');
    } finally { await Promise.all([s1.close(), s2.close()]); }
    assert.equal(await k.outcome(x.org, applies.stateId), 'SATISFIED');
  });

  await t.test('ControlDefinition race: a CD REVOKE holds the EXCLUSIVE registry guard; the waiting assessment sees the invalid applicability — GV010', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'cd', ca.objectTarget('PROMPT', x.objects.byKind.PROMPT));
    const rvProposal = ca.cdk.revokeProposal(applies.pin.subject, applies.pin.stateId);
    const rvSubmitted = await ca.cdk.submit(x as never, x.member, 'cd-rv-submit', rvProposal);
    const p = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'cd-submit', p);
    const digest = await k.factDigest(x.org);
    const { first, second } = await race(ca.cdk.decideSqlFor(x.steward, x.cmd('cd-rv'), rvSubmitted.proposal_id, rvProposal, 'REVOKE', applies.pin.stateId),
      k.decideSqlFor(x.as, x.cmd('cd'), s.proposal_id, p, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID/, second.err);
    assert.equal(await k.factDigest(x.org), digest);
  });

  await t.test('an assessment REVOKE never waits on the dependency guards (cleanup is not blocked by an applicability decision in flight)', async () => {
    const x = await k.setup();
    const target = ca.objectTarget('SKILL', x.objects.byKind.SKILL);
    const applies = await k.applicability(x, 'cl', target);
    const a = await k.assess(x, 'cl', applies.stateId);
    const rp = k.revokeProposal(applies.stateId, a.stateId);
    const rs = await k.submit(x, x.member, 'cl-rv-submit', rp);
    const s1 = c.session('postgres');
    try {
      await s1.run('begin;');
      assert.equal((await s1.run(`select gov_repo.l14_lock_fact_subject_guard_v1('${x.org}', 'CONTROL_APPLICABILITY',
        array['KEY', ${ca.keySql(target)}, '${applies.pin.subject.controlDefinitionId}']);
        select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}', 'CONTROL_DEFINITION',
        'CONTROL_DEFINITION_VALIDATION:${applies.pin.subject.controlDefinitionId}:${applies.pin.subject.controlDefinitionVersionId}:${applies.pin.subject.contentHash}');`)).err, '');
      const s2 = c.session('service_role');
      try {
        const r = await s2.run(k.decideSqlFor(x.as, x.cmd('cl-revoke'), rs.proposal_id, rp, 'REVOKE', a.stateId), 15_000);
        assert.equal(r.err, '', r.err);
        assert.equal(json(r.out).outcome, 'REVOKED');
      } finally { await s2.close(); }
      await s1.run('rollback;');
    } finally { await s1.close(); }
  });

  await t.test('same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'same', ca.objectTarget('MODEL', x.objects.byKind.MODEL));
    const q = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'same-submit', q);
    const sql = k.decideSqlFor(x.as, x.cmd('same'), s.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.fact_state_id, b.recorded_at, b.authorization_decision_id],
      ['VALIDATED', false, true, a.fact_state_id, a.recorded_at, a.authorization_decision_id]);
  });

  await t.test('concurrent terminal decisions on one proposal (VALIDATE vs REJECT): exactly one terminal decision', async () => {
    const x = await k.setup();
    const applies = await k.applicability(x, 'term', ca.objectTarget('AGENT', x.objects.agent2));
    const q = k.validateProposal(applies.stateId);
    const s = await k.submit(x, x.member, 'term-submit', q);
    const { first, second } = await race(k.decideSqlFor(x.as, x.cmd('term-v'), s.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.as2, x.cmd('term-r'), s.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${s.proposal_id}'`), '1');
  });
});
