import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { successorKit } from '../helpers/m16-l14-successor-fixtures';

/**
 * M16-S1A.2 — successor-lifecycle concurrency on real disposable PostgreSQL 17. Distinct
 * backends contend for the real locks (ORG → USER → ROLES FOR SHARE, then the organisation
 * Authority Policy advisory guard); blocking is observed via pg_blocking_pids.
 */
test('M16 S1A.2 L14 Authority Policy successor concurrency (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message));
  t.after(() => c.stop());
  const k = await successorKit(c);
  const { owner, counts, memberRole } = c;
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

  await t.test('two concurrent successor ADMITs from the same expected head → exactly one v2; the other GV009, nothing consumed', async () => {
    const ctx = await k.setup();
    const h = await k.head(ctx.org);
    const { first, second } = await race(k.admitNextSql(ctx, ctx.ops, ctx.cmd('ca-1'), k.opsRules(1), h.latest_version_id),
      k.admitNextSql(ctx, ctx.ops2, ctx.cmd('ca-2'), k.opsRules(2), h.latest_version_id));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV009[\s\S]*EXPECTED_HEAD_MISMATCH/, second.err);
    assert.equal(await owner(`select count(*) from gov_repo.l14_authority_policy_versions where organisation_id='${ctx.org}' and version_number=2`), '1');
    assert.equal(await owner(`select count(*) from gov_repo.l14_command_results where organisation_id='${ctx.org}' and command_id='${ctx.cmd('ca-2')}'`), '0');
  });

  await t.test('two concurrent terminal decisions on one proposal → one wins; the other GV010 PROPOSAL_TERMINAL', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'ct-v2', k.opsRules(1));
    const p = k.validateProposal(v2);
    const s = await k.submit(ctx, ctx.member, 'ct-submit', p);
    const h = await k.head(ctx.org);
    const { first, second } = await race(
      k.decideSqlFor(ctx, ctx.ops, ctx.cmd('ct-validate'), s.proposal_id, p, 'VALIDATE', h.latest_state_id),
      k.decideSqlFor(ctx, ctx.ops2, ctx.cmd('ct-reject'), s.proposal_id, p, 'REJECT', h.latest_state_id));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await owner(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${s.proposal_id}'`), '1');
  });

  await t.test('two concurrent successor VALIDATEs from one expected state → one state; the other GV009', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'cv-v2', k.opsRules(1));
    const v3 = await k.admitNext(ctx, ctx.ops, 'cv-v3', k.opsRules(2));
    const [p2, p3] = [k.validateProposal(v2), k.validateProposal(v3)];
    const [s2, s3] = [await k.submit(ctx, ctx.member, 'cv-s2', p2), await k.submit(ctx, ctx.member, 'cv-s3', p3)];
    const h = await k.head(ctx.org);
    const before = await counts(ctx.org);
    const { first, second } = await race(
      k.decideSqlFor(ctx, ctx.ops, ctx.cmd('cv-2'), s2.proposal_id, p2, 'VALIDATE', h.latest_state_id),
      k.decideSqlFor(ctx, ctx.ops2, ctx.cmd('cv-3'), s3.proposal_id, p3, 'VALIDATE', h.latest_state_id));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009/, second.err);
    const after = await counts(ctx.org);
    assert.equal(after.l14_authority_policy_states, before.l14_authority_policy_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
  });

  await t.test('future successor vs revocation race: the revocation commits first; the stale VALIDATE fails GV009', async () => {
    const ctx = await k.setup(k.opsRules(0, { validate: { allowFutureDating: true } }));
    const T2 = await k.instant('2 hours');
    const { decided: s2 } = await k.successor(ctx, 'fr', k.opsRules(1), T2);
    const rp = k.revokeProposal(await k.state(ctx.org, s2.state_id));
    const rs = await k.submit(ctx, ctx.member, 'fr-revoke-submit', rp);
    const v3 = await k.admitNext(ctx, ctx.ops, 'fr-v3', k.opsRules(2));
    const p3 = k.validateProposal(v3, await k.instant('3 hours'));
    const s3 = await k.submit(ctx, ctx.member, 'fr-s3', p3);
    const { first, second } = await race(
      k.decideSqlFor(ctx, ctx.ops, ctx.cmd('fr-revoke'), rs.proposal_id, rp, 'REVOKE', s2.state_id),
      k.decideSqlFor(ctx, ctx.ops2, ctx.cmd('fr-v3-validate'), s3.proposal_id, p3, 'VALIDATE', s2.state_id));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV009/, second.err);
    assert.equal(await k.resolve(ctx.org, `'${T2}'::timestamptz + interval '1 day'`, `'${T2}'::timestamptz + interval '1 day'`), ctx.v1.version_id);
  });

  interface AuthorityRace { key: string; change: (ctx: Awaited<ReturnType<typeof k.setup>>) => string; expect: RegExp | string }
  const authorityRaces: AuthorityRace[] = [
    { key: 'role revocation', change: ctx => `update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${ctx.ops.id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: ctx => `update gov_repo.governance_users set external_id='rotated' where user_id='${ctx.ops.id}';`, expect: /GV002/ },
    { key: 'actor suspension', change: ctx => `update gov_repo.governance_users set status='suspended' where user_id='${ctx.ops.id}';`, expect: /GV003/ },
    { key: 'organisation deactivation', change: ctx => `update gov_repo.organisations set is_active=false where organisation_id='${ctx.org}';`, expect: /GV003/ },
  ];
  for (const r of authorityRaces) {
    await t.test(`successor ADMIT waiting on a committed ${r.key} is evaluated against the committed state; nothing partial`, async () => {
      const ctx = await k.setup();
      const h = await k.head(ctx.org);
      const before = await counts(ctx.org);
      const { second } = await race(r.change(ctx), k.admitNextSql(ctx, ctx.ops, ctx.cmd('ar'), k.opsRules(1), h.latest_version_id), 'postgres');
      const after = await counts(ctx.org);
      assert.equal(after.l14_authority_policy_versions, before.l14_authority_policy_versions, 'no version written');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.equal(json(second.out).deny_reason, r.expect);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('policy-head change race: a successor ADMIT waiting on an in-flight VALIDATE is authorized by the newly effective policy', async () => {
    const ctx = await k.setup();
    const v2 = await k.admitNext(ctx, ctx.ops, 'ph-v2', k.opsRules(1));
    const p = k.validateProposal(v2);
    const s = await k.submit(ctx, ctx.member, 'ph-s', p);
    const h = await k.head(ctx.org);
    const { first, second } = await race(
      k.decideSqlFor(ctx, ctx.ops, ctx.cmd('ph-validate'), s.proposal_id, p, 'VALIDATE', h.latest_state_id),
      k.admitNextSql(ctx, ctx.ops2, ctx.cmd('ph-v3'), k.opsRules(2), h.latest_version_id));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const admitted = json(second.out);
    assert.equal(admitted.outcome, 'ADMITTED', 'latest_version is unchanged by a VALIDATE, so the waiting ADMIT is still current');
    const a = JSON.parse(lastLine(await owner(`select to_json(a) from gov_repo.l14_authorization_decisions a where authorization_decision_id='${admitted.authorization_decision_id}'`)));
    assert.equal(a.basis_version_id, v2.version_id, 'the waiter was authorized by the NEW effective policy committed while it waited');
  });

  await t.test('Authority Policy guard held → 55P03 after lock_timeout; nothing written; command id reusable', async () => {
    const ctx = await k.setup();
    const h = await k.head(ctx.org);
    const holder = c.session('m16_bootstrap');
    const before = await counts(ctx.org);
    try {
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${ctx.org}');`);
      await assert.rejects(c.svc(k.admitNextSql(ctx, ctx.ops, ctx.cmd('lt'), k.opsRules(1), h.latest_version_id)), /55P03/);
      assert.deepEqual(await counts(ctx.org), before);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.admitNextSql(ctx, ctx.ops, ctx.cmd('lt'), k.opsRules(1), h.latest_version_id))).outcome, 'ADMITTED');
  });
});
