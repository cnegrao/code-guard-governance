import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { policyValidationKit } from '../helpers/m16-l14-policy-validation-fixtures';

/**
 * M16-S1B.4 — POLICY_VERSION governance concurrency on real disposable PostgreSQL 17 (S1B4 horizon). Distinct backends
 * contend for the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, exact-tuple registry subject guard, command
 * guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor session, never by
 * sleeping alone. Bracketed numbers are the S1B.4 acceptance items.
 */
test('M16 S1B.4 POLICY_VERSION governance concurrency (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B4' });
  t.after(() => c.stop());
  const k = await policyValidationKit(c);
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

  await t.test('[34] same-command concurrent DECIDE: the waiter replays the ORIGINAL result — exactly one state', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'same');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'same-s', q);
    const sql = k.decideSqlFor(x.validator, x.cmd('same-v'), sub.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    const [a, b] = [json(first.out), json(second.out)];
    assert.equal(second.err, '', second.err);
    assert.deepEqual([a.outcome, a.replay, b.replay], ['VALIDATED', false, true]);
    assert.equal(b.registry_state_id, a.registry_state_id);
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_version_states where version_id='${s.versionId}'`), '1');
  });

  await t.test('decisions on DIFFERENT governed tuples do not serialize (subject guard is per exact tuple; the AP guard is shared)', async () => {
    const x = await k.setup();
    const [sa, sb] = [await k.admitted(x, 'dp-a'), await k.admitted(x, 'dp-b')];
    const [qa, qb] = [k.validateProposal(sa), k.validateProposal(sb)];
    const [pa, pb] = [await k.submit(x, x.member, 'dp-sa', qa), await k.submit(x, x.member, 'dp-sb', qb)];
    const { first, second } = await parallel(k.decideSqlFor(x.validator, x.cmd('dp-va'), pa.proposal_id, qa, 'VALIDATE', null),
      k.decideSqlFor(x.validator2, x.cmd('dp-vb'), pb.proposal_id, qb, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('[30] concurrent terminal decisions on one proposal: one wins; the other GV010 PROPOSAL_TERMINAL; nothing partial', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'ct');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'ct-s', q);
    const { first, second } = await race(k.decideSqlFor(x.validator, x.cmd('ct-validate'), sub.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.validator2, x.cmd('ct-reject'), sub.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${sub.proposal_id}'`), '1');
    // Expecting the now-current state: the loser is terminal, not stale.
    const again = await race(k.decideSqlFor(x.validator, x.cmd('ct2-defer'), (await k.submit(x, x.member, 'ct2-s', q)).proposal_id, q, 'REJECT',
      json(first.out).registry_state_id), k.decideSqlFor(x.validator2, x.cmd('ct2-reject-b'), sub.proposal_id, q, 'REJECT', json(first.out).registry_state_id));
    assert.equal(json(again.first.out).outcome, 'REJECTED');
    assert.match(again.second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, again.second.err);
  });

  await t.test('[31] concurrent VALIDATEs on expected-none (two proposals, one tuple): one state; the loser GV009 and not consumed', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'cv');
    const q = k.validateProposal(s);
    const [s1, s2] = [await k.submit(x, x.member, 'cv-s1', q), await k.submit(x, x.member, 'cv-s2', q)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.validator, x.cmd('cv-1'), s1.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.validator2, x.cmd('cv-2'), s2.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*POLICY_VERSION_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_policy_version_states, before.l14_policy_version_states + 1);
    assert.equal(after.l14_policy_version_heads, before.l14_policy_version_heads + 1, 'first-state uniqueness: one head');
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('[15,29] REVOKE vs re-VALIDATE, re-VALIDATE vs re-VALIDATE, REVOKE vs REVOKE: the loser is stale (GV009, not consumed); lineage stays linear', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'rr');
    const v1 = (await k.validate(x, 'rr', s)).decided.registry_state_id as string;
    const vq = k.validateProposal(s);
    const [vs1, vs2] = [await k.submit(x, x.member, 'rr-vs1', vq), await k.submit(x, x.member, 'rr-vs2', vq)];
    const rp1 = k.revokeProposal(s, v1);
    const rs1 = await k.submit(x, x.member, 'rr-rs1', rp1);
    const ra = await race(k.decideSqlFor(x.validator, x.cmd('rr-revoke'), rs1.proposal_id, rp1, 'REVOKE', v1),
      k.decideSqlFor(x.validator2, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', v1));
    const r1 = json(ra.first.out);
    assert.equal(r1.outcome, 'REVOKED');
    assert.match(ra.second.err, /GV009[\s\S]*POLICY_VERSION_STATE_EXPECTATION_MISMATCH/, ra.second.err);
    const rb = await race(k.decideSqlFor(x.validator, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', r1.registry_state_id),
      k.decideSqlFor(x.validator2, x.cmd('rr-revalidate-2'), vs2.proposal_id, vq, 'VALIDATE', r1.registry_state_id));
    const v2 = json(rb.first.out);
    assert.equal(v2.outcome, 'VALIDATED', 'the stale command id succeeds once its expectation is current');
    assert.match(rb.second.err, /GV009/, rb.second.err);
    const rp2 = k.revokeProposal(s, v2.registry_state_id);
    const [rsA, rsB] = [await k.submit(x, x.member, 'rr-rsA', rp2), await k.submit(x, x.member, 'rr-rsB', rp2)];
    const before = await k.counts(x.org);
    const rc = await race(k.decideSqlFor(x.validator, x.cmd('rr-revoke-a'), rsA.proposal_id, rp2, 'REVOKE', v2.registry_state_id),
      k.decideSqlFor(x.validator2, x.cmd('rr-revoke-b'), rsB.proposal_id, rp2, 'REVOKE', v2.registry_state_id));
    const r2 = json(rc.first.out);
    assert.equal(r2.outcome, 'REVOKED');
    assert.match(rc.second.err, /GV009/, rc.second.err);
    assert.equal((await k.counts(x.org)).l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    await assert.rejects(c.svc(k.decideSqlFor(x.validator2, x.cmd('rr-revoke-b'), rsB.proposal_id, rp2, 'REVOKE', r2.registry_state_id)),
      /GV010[\s\S]*TARGET_ALREADY_REVOKED/);
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_policy_version_states d using (organisation_id, state_id) where d.version_id='${s.versionId}'`),
      'VALIDATED>REVOKED>VALIDATED>REVOKED');
    assert.equal((await k.head(x.org, s))!.latest_state_id, r2.registry_state_id);
  });

  interface AuthorityRace { key: string; change: (x: Awaited<ReturnType<typeof k.setup>>) => string; expect: RegExp | string }
  const authorityRaces: AuthorityRace[] = [
    { key: 'role revocation', change: x => `update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${x.validator.id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: x => `update gov_repo.governance_users set external_id='rotated' where user_id='${x.validator.id}';`, expect: /GV002/ },
    { key: 'actor suspension', change: x => `update gov_repo.governance_users set status='suspended' where user_id='${x.validator.id}';`, expect: /GV003/ },
    { key: 'organisation deactivation', change: x => `update gov_repo.organisations set is_active=false where organisation_id='${x.org}';`, expect: /GV003/ },
  ];
  for (const r of authorityRaces) {
    await t.test(`[32] VALIDATE waiting on a committed ${r.key} is evaluated against the committed state; nothing partial`, async () => {
      const x = await k.setup();
      const s = await k.admitted(x, 'ar');
      const q = k.validateProposal(s);
      const sub = await k.submit(x, x.member, 'ar-s', q);
      const before = await k.counts(x.org);
      const { second } = await race(r.change(x), k.decideSqlFor(x.validator, x.cmd('ar-v'), sub.proposal_id, q, 'VALIDATE', null), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l14_policy_version_states, before.l14_policy_version_states, 'no state written');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.equal(json(second.out).deny_reason, r.expect);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('[32] role revocation arriving while a VALIDATE is in flight waits for it (roles are locked FOR SHARE until commit)', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'rw');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'rw-s', q);
    const s1 = c.session('service_role'), s2 = c.session('postgres');
    try {
      await s1.run('begin;');
      const decided = await s1.run(k.decideSqlFor(x.validator, x.cmd('rw-v'), sub.proposal_id, q, 'VALIDATE', null));
      assert.equal(json(decided.out).outcome, 'VALIDATED');
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(`update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${x.validator.id}';`);
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      assert.equal((await pending).err, '');
    } finally { await Promise.all([s1.close(), s2.close()]); }
    assert.equal(await one(`select count(*) from gov_repo.l14_policy_version_states where version_id='${s.versionId}'`), '1');
  });

  await t.test('[33] Authority Policy change race (shared vs exclusive guard): a decision in flight holds off the AP change, and vice versa', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'ap');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'ap-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'ap-v2-admit', k.validationRules(3, {}, [`${k.pk.validatorRole}:L14_POLICY_VERSION_VALIDATE:VALIDATE`]));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'ap-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const apValidate = k.ap.decideSqlFor(x as never, x.ops, x.cmd('ap-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id);
    // (a) POLICY_VERSION DEFER in flight (AP guard SHARED) → the AP VALIDATE (EXCLUSIVE) waits, then commits.
    const deferred = await race(k.decideSqlFor(x.validator, x.cmd('ap-defer'), sub.proposal_id, q, 'DEFER', null), apValidate);
    assert.equal(json(deferred.first.out).outcome, 'DEFERRED');
    assert.equal(json(deferred.second.out).outcome, 'VALIDATED');
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${json(deferred.first.out).authorization_decision_id}'`),
      x.v1.version_id, 'the in-flight decision was authorized by the policy effective when it held the guard');
    // (b) The next AP change in flight (EXCLUSIVE) → the waiting VALIDATE is evaluated against the NEW policy.
    const v3 = await k.ap.admitNext(x as never, x.ops, 'ap-v3-admit', k.validationRules(4));
    const apProposal3 = k.ap.validateProposal(v3);
    const apSubmitted3 = await k.ap.submit(x as never, x.member, 'ap-v3-submit', apProposal3);
    const apHead3 = await k.ap.head(x.org);
    const blocked = await race(k.ap.decideSqlFor(x as never, x.ops, x.cmd('ap-v3-validate'), apSubmitted3.proposal_id, apProposal3, 'VALIDATE', apHead3.latest_state_id),
      k.decideSqlFor(x.validator, x.cmd('ap-validate'), sub.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(blocked.first.out).outcome, 'VALIDATED');
    const waited = json(blocked.second.out);
    assert.equal(waited.outcome, 'VALIDATED', 'v3 restores the validator grant');
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${waited.authorization_decision_id}'`),
      v3.version_id, 'the waiter was authorized by the policy committed while it waited');
  });

  await t.test('[33] Authority Policy change removing the grant commits first → the waiting VALIDATE is a durable DENY', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'apd');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'apd-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'apd-v2-admit', k.validationRules(5, {}, [`${k.pk.validatorRole}:L14_POLICY_VERSION_VALIDATE:VALIDATE`]));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'apd-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const { first, second } = await race(
      k.ap.decideSqlFor(x as never, x.ops, x.cmd('apd-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.decideSqlFor(x.validator, x.cmd('apd-validate'), sub.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`), v2.version_id);
  });

  await t.test('exact-tuple subject guard / command guard held → 55P03 after lock_timeout; nothing written; command reusable', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'lt');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'lt-s', q);
    const holder = c.session('m16_bootstrap');
    const before = await k.counts(x.org);
    try {
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','POLICY_VERSION','POLICY_VERSION_VALIDATION:${s.policyId}:${s.versionId}:${s.contentHash}');`);
      await assert.rejects(c.svc(k.decideSqlFor(x.validator, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/);
      await assert.rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('lt-s2'), proposal: q })), /55P03/);
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${x.org}');`);
      await assert.rejects(c.svc(k.decideSqlFor(x.validator, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/,
        'the EXCLUSIVE AP guard blocks the SHARED registry guard');
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.decideSqlFor(x.validator, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null))).outcome, 'VALIDATED');
  });
});
