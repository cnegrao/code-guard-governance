import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { policyKit } from '../helpers/m16-l14-policy-fixtures';

/**
 * M16-S1B.3 — policy content admission concurrency on real disposable PostgreSQL 17. Distinct backends contend for
 * the real locks (ORG -> USER -> ROLES FOR SHARE, AP guard SHARED, registry subject guard per policy code / per policy,
 * command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor session.
 */
test('M16 S1B.3 policy content admission concurrency (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B3' });
  t.after(() => c.stop());
  const k = await policyKit(c);
  const { owner, memberRole } = c;
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
  async function race(first: string, second: string, firstRole: 'service_role' | 'postgres' = 'service_role',
    secondRole: 'service_role' | 'postgres' = 'service_role') {
    const s1 = c.session(firstRole), s2 = c.session(secondRole);
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

  await t.test('same-command concurrent policy ADMIT: the waiter replays the ORIGINAL result — exactly one minted policy', async () => {
    const x = await k.setup();
    const sql = k.admitPolicySql(x.author, { commandId: x.cmd('same'), descriptor: k.descriptor('SAME') });
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.policy_id], ['ADMITTED', false, true, a.policy_id]);
    assert.equal(await one(`select count(*) from gov_repo.governance_policies where organisation_id='${x.org}'`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_admissions where organisation_id='${x.org}'`), '1');
  });

  await t.test('[33] concurrent ADMITs of the SAME code (different commands): one policy; the waiter is GV010 POLICY_CODE_EXISTS and not consumed', async () => {
    const x = await k.setup();
    const { first, second } = await race(k.admitPolicySql(x.author, { commandId: x.cmd('code-a'), descriptor: k.descriptor('RACE-CODE') }),
      k.admitPolicySql(x.author2, { commandId: x.cmd('code-b'), descriptor: k.descriptor('RACE-CODE', 'Other title', 'risk') }));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV010[\s\S]*POLICY_CODE_EXISTS/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.governance_policies where organisation_id='${x.org}' and policy_code='RACE-CODE'`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${x.cmd('code-b')}'`), '0');
  });

  await t.test('different codes do not serialize and legitimately mint different policies', async () => {
    const x = await k.setup();
    const { first, second } = await parallel(k.admitPolicySql(x.author, { commandId: x.cmd('d1'), descriptor: k.descriptor('PAR-1') }),
      k.admitPolicySql(x.author2, { commandId: x.cmd('d2'), descriptor: k.descriptor('PAR-2') }));
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, b.outcome], ['ADMITTED', 'ADMITTED']);
    assert.notEqual(a.policy_id, b.policy_id);
  });

  await t.test('[32] concurrent successors on ONE policy: one wins; the loser is GV009 (stale) and not consumed; lineage stays linear', async () => {
    const x = await k.setup();
    const p = await k.admitPolicy(x, x.author, 'cs-p', k.descriptor('CS-P'));
    // (a) two FIRST versions, both expected-none.
    const ra = await race(k.admitVersionSql(x.author, { commandId: x.cmd('cs-1a'), policyId: p.policy_id, content: '# first A' }),
      k.admitVersionSql(x.author2, { commandId: x.cmd('cs-1b'), policyId: p.policy_id, content: '# first B' }));
    const v1 = json(ra.first.out);
    assert.equal(v1.outcome, 'ADMITTED');
    assert.match(ra.second.err, /GV009[\s\S]*POLICY_VERSION_EXISTS/, ra.second.err);
    // (b) two successors of v1, both expecting v1.
    const rb = await race(k.admitVersionSql(x.author2, { commandId: x.cmd('cs-2a'), policyId: p.policy_id, content: '# second A', expected: v1.version_id }),
      k.admitVersionSql(x.author, { commandId: x.cmd('cs-2b'), policyId: p.policy_id, content: '# second B', expected: v1.version_id }));
    const v2 = json(rb.first.out);
    assert.deepEqual([v2.outcome, v2.version_number], ['ADMITTED', 2]);
    assert.match(rb.second.err, /GV009[\s\S]*POLICY_VERSION_EXPECTATION_MISMATCH/, rb.second.err);
    for (const command of ['cs-1b', 'cs-2b']) {
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where command_id='${x.cmd(command)}'`), '0', `${command} not consumed`);
    }
    assert.equal(await one(`select string_agg(coalesce(predecessor_version_id::text,'ROOT')||'>'||version_id::text, ',' order by recorded_at)
      from gov_repo.l14_policy_version_admissions where policy_id='${p.policy_id}'`), `ROOT>${v1.version_id},${v1.version_id}>${v2.version_id}`);
    assert.equal(await one(`select string_agg(version_number::text, ',' order by version_number) from gov_repo.policy_versions where policy_id='${p.policy_id}'`), '1,2');
    // The loser's command id is still free and succeeds once its expectation is current.
    assert.equal((await c.exec(k.admitVersionSql(x.author, { commandId: x.cmd('cs-2b'), policyId: p.policy_id, content: '# second B',
      expected: v2.version_id }))).version_number, 3);
  });

  await t.test('versions of DIFFERENT policies do not serialize (the subject guard is per policy; the AP guard is shared)', async () => {
    const x = await k.setup();
    const [pa, pb] = [await k.admitPolicy(x, x.author, 'dp-a', k.descriptor('DP-A')), await k.admitPolicy(x, x.author, 'dp-b', k.descriptor('DP-B'))];
    const { first, second } = await parallel(k.admitVersionSql(x.author, { commandId: x.cmd('dp-va'), policyId: pa.policy_id, content: '# a' }),
      k.admitVersionSql(x.author2, { commandId: x.cmd('dp-vb'), policyId: pb.policy_id, content: '# b' }));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['ADMITTED', 'ADMITTED']);
  });

  await t.test('[34] role revocation arriving while an ADMIT is in flight waits for it (roles are locked FOR SHARE until commit)', async () => {
    const x = await k.setup();
    const { first, second } = await race(k.admitPolicySql(x.author, { commandId: x.cmd('rr'), descriptor: k.descriptor('RR') }),
      `update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${x.author.id}';`, 'service_role', 'postgres');
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.equal(second.err, '');
    // The revocation committed after the admission: the NEXT command is evaluated against it.
    assert.equal((await c.exec(k.admitPolicySql(x.author, { commandId: x.cmd('rr-next'), descriptor: k.descriptor('RR-NEXT') }))).deny_reason,
      'NO_MATCHING_AUTHORITY_RULE');
    // Conversely a committed revocation in flight first: the waiting ADMIT is evaluated against the committed roles.
    const y = await k.setup();
    const blocked = await race(`update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${y.author.id}';`,
      k.admitPolicySql(y.author, { commandId: y.cmd('rr-wait'), descriptor: k.descriptor('RR-WAIT') }), 'postgres', 'service_role');
    assert.equal(json(blocked.second.out).deny_reason, 'NO_MATCHING_AUTHORITY_RULE', 'nothing partial: the committed role set decides');
  });

  await t.test('[34] Authority Policy change race (shared vs exclusive guard): an ADMIT in flight holds off the AP change, and vice versa', async () => {
    const x = await k.setup();
    const p = await k.admitPolicy(x, x.author, 'ap-p', k.descriptor('AP-P'));
    // A successor Authority Policy that removes the author's content grant, prepared up to its decision.
    const v2 = await k.ap.admitNext(x as never, x.ops, 'ap-v2-admit', k.policyRules(3, [`${k.authorRole}:L14_POLICY_CONTENT_ADMIT:ADMIT`]));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'ap-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const apValidate = k.ap.decideSqlFor(x as never, x.ops, x.cmd('ap-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id);
    // (a) version ADMIT in flight (AP guard SHARED) → the AP VALIDATE (EXCLUSIVE) waits, then commits.
    const held = await race(k.admitVersionSql(x.author, { commandId: x.cmd('ap-v1'), policyId: p.policy_id, content: '# ap' }), apValidate);
    const admitted = json(held.first.out);
    assert.equal(admitted.outcome, 'ADMITTED');
    assert.equal(json(held.second.out).outcome, 'VALIDATED');
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${admitted.authorization_decision_id}'`),
      x.v1.version_id, 'the in-flight admission was authorized by the policy effective when it held the guard');
    // (b) the next AP change in flight (EXCLUSIVE) restores the grant → the waiting ADMIT is evaluated against the NEW policy.
    const v3 = await k.ap.admitNext(x as never, x.ops, 'ap-v3-admit', k.policyRules(4));
    const apProposal3 = k.ap.validateProposal(v3);
    const apSubmitted3 = await k.ap.submit(x as never, x.member, 'ap-v3-submit', apProposal3);
    const apHead3 = await k.ap.head(x.org);
    const waitedOn = await race(k.ap.decideSqlFor(x as never, x.ops, x.cmd('ap-v3-validate'), apSubmitted3.proposal_id, apProposal3, 'VALIDATE', apHead3.latest_state_id),
      k.admitVersionSql(x.author, { commandId: x.cmd('ap-v2'), policyId: p.policy_id, content: '# ap 2', expected: admitted.version_id }));
    assert.equal(json(waitedOn.first.out).outcome, 'VALIDATED');
    const waited = json(waitedOn.second.out);
    assert.equal(waited.outcome, 'ADMITTED', 'v3 restores the author grant');
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${waited.authorization_decision_id}'`),
      v3.version_id, 'the waiter was authorized by the policy committed while it waited');
  });

  await t.test('[34] AP change removing the grant commits first → the waiting ADMIT is a durable DENY against the new basis', async () => {
    const x = await k.setup();
    const v2 = await k.ap.admitNext(x as never, x.ops, 'apd-v2-admit', k.policyRules(5, [`${k.authorRole}:L14_POLICY_CONTENT_ADMIT:ADMIT`]));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'apd-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const { first, second } = await race(
      k.ap.decideSqlFor(x as never, x.ops, x.cmd('apd-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.admitPolicySql(x.author, { commandId: x.cmd('apd-admit'), descriptor: k.descriptor('APD') }));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason, denied.policy_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`),
      v2.version_id);
    assert.equal(await one(`select count(*) from gov_repo.governance_policies where organisation_id='${x.org}'`), '0');
  });

  await t.test('subject / command / AP guard held → 55P03 after lock_timeout; nothing written; command reusable', async () => {
    const x = await k.setup();
    const p = await k.admitPolicy(x, x.author, 'lt-p', k.descriptor('LT-P'));
    const holder = c.session('m16_bootstrap');
    const before = await k.counts(x.org);
    try {
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','POLICY_VERSION','POLICY:${p.policy_id}');`);
      await assert.rejects(c.svc(k.admitVersionSql(x.author, { commandId: x.cmd('lt-v'), policyId: p.policy_id, content: '# lt' })), /55P03/);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','POLICY_VERSION','POLICY_CODE:LT-Q');`);
      await assert.rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('lt-q'), descriptor: k.descriptor('LT-Q') })), /55P03/);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_command_guard_v1('${x.org}','${x.cmd('lt-q')}');`);
      await assert.rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('lt-q'), descriptor: k.descriptor('LT-Q') })), /55P03/);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${x.org}');`);
      await assert.rejects(c.svc(k.admitPolicySql(x.author, { commandId: x.cmd('lt-q'), descriptor: k.descriptor('LT-Q') })), /55P03/,
        'the EXCLUSIVE AP guard blocks the SHARED admission guard');
      await holder.run('rollback;');
      assert.deepEqual(await k.counts(x.org), before);
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.admitVersionSql(x.author, { commandId: x.cmd('lt-v'), policyId: p.policy_id, content: '# lt' }))).outcome, 'ADMITTED');
    assert.equal((await c.exec(k.admitPolicySql(x.author, { commandId: x.cmd('lt-q'), descriptor: k.descriptor('LT-Q') }))).outcome, 'ADMITTED');
  });
});
