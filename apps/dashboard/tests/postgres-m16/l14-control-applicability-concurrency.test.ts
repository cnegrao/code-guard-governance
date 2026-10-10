import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlApplicabilityKit } from '../helpers/m16-l14-control-applicability-fixtures';

/**
 * M16-S1C.4 — CONTROL_APPLICABILITY concurrency on real disposable PostgreSQL 17 (S1C4 horizon). Distinct backends contend for
 * the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, the exact CONTROL_DEFINITION registry subject guard — SHARED
 * for an applicability VALIDATE, EXCLUSIVE for a CONTROL_DEFINITION decision — the exact applicability fact KEY guard, the
 * command guard);
 * blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor session, never by sleeping alone. No
 * winner is ever chosen by timing: the loser fails typed and consumes nothing.
 */
test('M16 S1C.4 control applicability concurrency (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C4' });
  t.after(() => c.stop());
  const k = await controlApplicabilityKit(c);
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
  const now = 'clock_timestamp()';
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
  /** `first` in an open transaction; `second` must complete WITHOUT waiting on it. */
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
  const CONSUMING = ['l14_fact_states', 'l14_control_applicability_states', 'l14_governance_decisions', 'l14_authorization_decisions',
    'l14_command_results', 'l14_control_applicability_heads', 'l14_support_links'] as const;

  await t.test('A: two DIFFERENT ControlDefinition versions race as the first state of one target + control definition → exactly one wins; the loser GV009, nothing consumed', async () => {
    const x = await k.setup();
    const v1 = await k.control(x, 'ra');
    const v2 = await k.nextVersion(x, 'ra-v2', v1);
    const target = k.objectTarget('AGENT', x.objects.byKind.AGENT);
    const [pa, pb] = [k.validateProposal(target, v1), k.validateProposal(target, v2)];
    const [sa, sb] = [await k.submit(x, x.member, 'ra-submit', pa), await k.submit(x, x.member2, 'rb-submit', pb)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.cs, x.cmd('ra'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.cs2, x.cmd('rb'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*CONTROL_APPLICABILITY_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    for (const table of CONSUMING.filter(t => t !== 'l14_support_links')) assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
    assert.equal(after.l14_support_links, before.l14_support_links);
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('rb')}'`), '0');
    assert.equal((await k.resolveRow(x.org, target, v1.subject.controlDefinitionId, now, now))?.control_definition_version_id, v1.subject.controlDefinitionVersionId);
  });

  await t.test('B: APPLIES vs DOES_NOT_APPLY race for the same key (relationship-state target) → exactly one wins', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'rb');
    const target = k.relTarget(x.rels.reads);
    const [pa, pb] = [k.validateProposal(target, pin, 'APPLIES'), k.validateProposal(target, pin, 'DOES_NOT_APPLY')];
    const [sa, sb] = [await k.submit(x, x.member, 'b-a-submit', pa), await k.submit(x, x.member2, 'b-d-submit', pb)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.cs, x.cmd('b-a'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.cs2, x.cmd('b-d'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).applicability, 'APPLIES');
    assert.match(second.err, /GV009[\s\S]*CONTROL_APPLICABILITY_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_fact_states, before.l14_fact_states + 1);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
    assert.equal(await k.outcome(x.org, target, pin.subject.controlDefinitionId), 'APPLIES');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_applicability_states where organisation_id='${x.org}'`), '1');
  });

  await t.test('C: two successors from the SAME expected state → exactly one successor; the loser stale (GV009); predecessor untouched', async () => {
    const x = await k.setup();
    const v1 = await k.control(x, 'c');
    const v2 = await k.nextVersion(x, 'c-v2', v1);
    const target = k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const s0 = await k.apply(x, 'c0', target, v1);
    const s0Rows = await k.stateRows(x.org, s0.stateId);
    const [p1, p2] = [k.validateProposal(target, v2), k.validateProposal(target, v1, 'DOES_NOT_APPLY')];
    const [q1, q2] = [await k.submit(x, x.member, 'c1-submit', p1), await k.submit(x, x.member2, 'c2-submit', p2)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.cs, x.cmd('c1'), q1.proposal_id, p1, 'VALIDATE', s0.stateId),
      k.decideSqlFor(x.cs2, x.cmd('c2'), q2.proposal_id, p2, 'VALIDATE', s0.stateId));
    const won = json(first.out);
    assert.deepEqual([won.outcome, won.predecessor_state_id], ['VALIDATED', s0.stateId]);
    assert.match(second.err, /GV009[\s\S]*CONTROL_APPLICABILITY_STATE_EXPECTATION_MISMATCH/, second.err);
    const after = await k.counts(x.org);
    for (const table of CONSUMING.filter(t => t !== 'l14_control_applicability_heads' && t !== 'l14_support_links')) {
      assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
    }
    assert.equal(after.l14_control_applicability_heads, before.l14_control_applicability_heads, 'one head per key, moved');
    assert.equal(await k.head(x.org, target, v1.subject.controlDefinitionId), won.fact_state_id);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_applicability_states where predecessor_state_id='${s0.stateId}'`), '1');
    assert.equal(await k.stateRows(x.org, s0.stateId), s0Rows);
  });

  await t.test('D: the SAME ControlDefinition version on DIFFERENT targets → both succeed without serializing (shared dependency guard)', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'd');
    const [ta, tb] = [k.objectTarget('AGENT', x.objects.byKind.AGENT), k.relTarget(x.rels.exposes)];
    const [pa, pb] = [k.validateProposal(ta, pin), k.validateProposal(tb, pin, 'DOES_NOT_APPLY')];
    const [sa, sb] = [await k.submit(x, x.member, 'd-a-submit', pa), await k.submit(x, x.member, 'd-b-submit', pb)];
    const { first, second } = await parallel(k.decideSqlFor(x.cs, x.cmd('d-a'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.cs2, x.cmd('d-b'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('E: DIFFERENT control definitions on the SAME target → independent keys, both succeed without serializing', async () => {
    const x = await k.setup();
    const [pa, pb] = [await k.control(x, 'e-a'), await k.control(x, 'e-b')];
    const target = k.objectTarget('MODEL', x.objects.byKind.MODEL);
    const [qa, qb] = [k.validateProposal(target, pa), k.validateProposal(target, pb, 'DOES_NOT_APPLY')];
    const [sa, sb] = [await k.submit(x, x.member, 'e-a-submit', qa), await k.submit(x, x.member, 'e-b-submit', qb)];
    const { first, second } = await parallel(k.decideSqlFor(x.cs, x.cmd('e-a'), sa.proposal_id, qa, 'VALIDATE', null),
      k.decideSqlFor(x.cs2, x.cmd('e-b'), sb.proposal_id, qb, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
    assert.equal((await k.current(x.org, target)).length, 2);
  });

  await t.test('shared dependency parallelism: two VALIDATEs on one exact ControlDefinition version hold the dependency guard concurrently (observed in pg_locks)', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'par');
    const [ta, tb] = [k.objectTarget('TOOL', x.objects.byKind.TOOL), k.objectTarget('API', x.objects.byKind.API)];
    const [pa, pb] = [k.validateProposal(ta, pin), k.validateProposal(tb, pin)];
    const [sa, sb] = [await k.submit(x, x.member, 'par-a-submit', pa), await k.submit(x, x.member, 'par-b-submit', pb)];
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;'); await s2.run('begin;');
      assert.equal((await s1.run(k.decideSqlFor(x.cs, x.cmd('par-a'), sa.proposal_id, pa, 'VALIDATE', null))).err, '');
      assert.equal((await s2.run(k.decideSqlFor(x.cs2, x.cmd('par-b'), sb.proposal_id, pb, 'VALIDATE', null), 15_000)).err, '');
      const held = await one(`with k as (select hashtextextended(gov_repo.frame_identity(array['${x.org}','l14-registry-subject-guard-v1','CONTROL_DEFINITION',
          'CONTROL_DEFINITION_VALIDATION:${pin.subject.controlDefinitionId}:${pin.subject.controlDefinitionVersionId}:${pin.subject.contentHash}']), 0) as v)
        select count(distinct l.pid)||'|'||string_agg(distinct l.mode, ',') from pg_locks l, k where l.locktype='advisory' and l.granted
          and l.objsubid=1 and l.classid=((k.v >> 32) & 4294967295)::oid and l.objid=(k.v & 4294967295)::oid`);
      assert.equal(held, '2|ShareLock', 'both transactions hold the SHARED CONTROL_DEFINITION dependency guard at once');
      await s1.run('commit;'); await s2.run('commit;');
    } finally { await Promise.all([s1.close(), s2.close()]); }
    assert.equal(await k.outcome(x.org, ta, pin.subject.controlDefinitionId), 'APPLIES');
    assert.equal(await k.outcome(x.org, tb, pin.subject.controlDefinitionId), 'APPLIES');
  });

  await t.test('dependency race order 1: ControlDefinition REVOKE holds the EXCLUSIVE registry guard; the waiting VALIDATE sees it — GV010, nothing consumed', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'dep1');
    const rvProposal = k.cdk.revokeProposal(pin.subject, pin.stateId);
    const rvSubmitted = await k.cdk.submit(x as never, x.member, 'dep1-cd-rv-submit', rvProposal);
    const target = k.objectTarget('DATA_ASSET', x.objects.byKind.DATA_ASSET);
    const p = k.validateProposal(target, pin);
    const s = await k.submit(x, x.member, 'dep1-submit', p);
    await c.evidence(x.org, 'dep1-ev');
    const before = await k.counts(x.org);
    const decide = k.decideSql(x.cs, { commandId: x.cmd('dep1'), proposalId: s.proposal_id, proposal: p,
      support: { status: 'PRESENT', evidenceIds: ['dep1-ev'] } });
    const { first, second } = await race(k.cdk.decideSqlFor(x.steward, x.cmd('dep1-cd-rv'), rvSubmitted.proposal_id, rvProposal, 'REVOKE', pin.stateId),
      decide);
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*CONTROL_DEFINITION_DEPENDENCY_NOT_VALID/, second.err);
    const after = await k.counts(x.org);
    for (const table of CONSUMING) {
      // Only the CONTROL_DEFINITION revocation wrote (its authorization, decision, result); the applicability consumed nothing.
      const expected = table === 'l14_authorization_decisions' || table === 'l14_governance_decisions' || table === 'l14_command_results'
        ? before[table] + 1 : before[table];
      assert.equal(after[table], expected, `${table}: only the CONTROL_DEFINITION revocation wrote`);
    }
    for (const table of ['l14_fact_states', 'l14_governance_decisions', 'l14_authorization_decisions', 'l14_command_results']) {
      assert.equal(await one(`select count(*) from gov_repo.${table} where organisation_id='${x.org}' and subject_kind='CONTROL_APPLICABILITY'
        and ${table === 'l14_fact_states' ? 'true' : table === 'l14_governance_decisions' ? `proposal_id='${s.proposal_id}'` : `command_id='${x.cmd('dep1')}'`}`), '0', table);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_support_links where evidence_id='dep1-ev'`), '0', 'no support link');
    assert.equal(await k.head(x.org, target, pin.subject.controlDefinitionId), null, 'no head');
  });

  await t.test('dependency race order 2: the VALIDATE holds the SHARED dependency guard; the ControlDefinition REVOKE waits, commits after it, invalidates it', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'dep2');
    const target = k.relTarget(x.rels.reads);
    const p = k.validateProposal(target, pin, 'DOES_NOT_APPLY');
    const s = await k.submit(x, x.member, 'dep2-submit', p);
    const rvProposal = k.cdk.revokeProposal(pin.subject, pin.stateId);
    const rvSubmitted = await k.cdk.submit(x as never, x.member, 'dep2-cd-rv-submit', rvProposal);
    const { first, second } = await race(k.decideSqlFor(x.cs, x.cmd('dep2'), s.proposal_id, p, 'VALIDATE', null),
      k.cdk.decideSqlFor(x.steward, x.cmd('dep2-cd-rv'), rvSubmitted.proposal_id, rvProposal, 'REVOKE', pin.stateId));
    const a = json(first.out), r = json(second.out);
    assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
    assert.ok(Date.parse(a.recorded_at) < Date.parse(r.recorded_at), 'the applicability committed before the revocation was recorded');
    const rows = await k.stateRows(x.org, a.fact_state_id);
    assert.equal(await k.outcome(x.org, target, pin.subject.controlDefinitionId), 'UNKNOWN', 'after the revoke the current resolver answers UNKNOWN');
    assert.equal(await k.resolve(x.org, target, pin.subject.controlDefinitionId, `'${a.recorded_at}'::timestamptz`, `'${a.recorded_at}'::timestamptz`), a.fact_state_id,
      'earlier coordinates still resolve');
    assert.equal(await k.stateRows(x.org, a.fact_state_id), rows, 'historical fact unchanged');
  });

  await t.test('REVOKE of an applicability never waits on the dependency guard (cleanup is not blocked by a CONTROL_DEFINITION decision in flight)', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'cl');
    const target = k.objectTarget('SKILL', x.objects.byKind.SKILL);
    const a = await k.apply(x, 'cl', target, pin);
    const rp = k.revokeProposal(target, pin, a.stateId);
    const rs = await k.submit(x, x.member, 'cl-rv-submit', rp);
    const s1 = c.session('postgres');
    try {
      await s1.run('begin;');
      // Hold the EXCLUSIVE S1B.6 registry subject guard of the exact tuple (exactly what a CONTROL_DEFINITION decision holds).
      assert.equal((await s1.run(`select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}', 'CONTROL_DEFINITION',
        'CONTROL_DEFINITION_VALIDATION:${pin.subject.controlDefinitionId}:${pin.subject.controlDefinitionVersionId}:${pin.subject.contentHash}');`)).err, '');
      const s2 = c.session('service_role');
      try {
        const r = await s2.run(k.decideSqlFor(x.cs, x.cmd('cl-revoke'), rs.proposal_id, rp, 'REVOKE', a.stateId), 15_000);
        assert.equal(r.err, '', r.err);
        assert.equal(json(r.out).outcome, 'REVOKED');
      } finally { await s2.close(); }
      await s1.run('rollback;');
    } finally { await s1.close(); }
  });

  await t.test('REVOKE of an applicability whose dependency is ALREADY revoked never waits on an in-flight ControlDefinition re-validation', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'inv');
    const target = k.relTarget(x.rels.exposes);
    const a = await k.apply(x, 'inv', target, pin);
    await k.revokeControlDefinition(x, 'inv', pin);
    assert.equal(await k.outcome(x.org, target, pin.subject.controlDefinitionId), 'UNKNOWN', 'dependency-invalid → UNKNOWN');
    const rp = k.revokeProposal(target, pin, a.stateId);
    const rs = await k.submit(x, x.member, 'inv-rv-submit', rp);
    // A re-validation of the same exact tuple is in flight (it holds the EXCLUSIVE S1B.6 validation-subject guard).
    const vp = k.cdk.validateProposal(pin.subject);
    const vs = await k.cdk.submit(x as never, x.member, 'inv-cd-reval-submit', vp);
    const cdHead = (await k.cdk.head(x.org, pin.subject))?.latest_state_id ?? null;
    const s1 = c.session('service_role');
    try {
      await s1.run('begin;');
      const held = await s1.run(k.cdk.decideSqlFor(x.steward, x.cmd('inv-cd-reval'), vs.proposal_id, vp, 'VALIDATE', cdHead));
      assert.equal(held.err, '', held.err);
      const s2 = c.session('service_role');
      try {
        const r = await s2.run(k.decideSqlFor(x.cs, x.cmd('inv-revoke'), rs.proposal_id, rp, 'REVOKE', a.stateId), 15_000);
        assert.equal(r.err, '', r.err);
        assert.deepEqual([json(r.out).outcome, json(r.out).predecessor_state_id], ['REVOKED', a.stateId]);
      } finally { await s2.close(); }
      await s1.run('commit;');
    } finally { await s1.close(); }
    // The re-validation committed afterwards; the revoked applicability stays UNKNOWN (no resurrection, no auto-repin).
    assert.equal(await k.outcome(x.org, target, pin.subject.controlDefinitionId), 'UNKNOWN');
  });

  await t.test('same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'same');
    const q = k.validateProposal(k.objectTarget('PROMPT', x.objects.byKind.PROMPT), pin);
    const s = await k.submit(x, x.member, 'same-submit', q);
    const sql = k.decideSqlFor(x.cs, x.cmd('same'), s.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.fact_state_id, b.recorded_at, b.authorization_decision_id],
      ['VALIDATED', false, true, a.fact_state_id, a.recorded_at, a.authorization_decision_id]);
  });

  await t.test('concurrent terminal decisions on one proposal (VALIDATE vs REJECT): exactly one terminal decision', async () => {
    const x = await k.setup();
    const pin = await k.control(x, 'term');
    const q = k.validateProposal(k.objectTarget('AGENT', x.objects.agent2), pin);
    const s = await k.submit(x, x.member, 'term-submit', q);
    const { first, second } = await race(k.decideSqlFor(x.cs, x.cmd('term-v'), s.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.cs2, x.cmd('term-r'), s.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${s.proposal_id}'`), '1');
  });
});
