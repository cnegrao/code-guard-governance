import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { L14_TABLES, l14Cluster, lastLine, rule } from '../helpers/m16-l14-fixtures';

/**
 * M16-S1A.1 — first-policy concurrency on real disposable PostgreSQL 17. Distinct backends hold
 * and contend for real locks; blocking is observed via pg_stat_activity + pg_blocking_pids from a
 * separate monitor session, never by sleeping alone.
 */
test('M16 S1A.1 L14 Authority Policy first-policy concurrency (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message));
  t.after(() => c.stop());
  const { owner, counts, admitSql, submitSql, decideSql, adminRole, memberRole } = c;
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
  const rules = [rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'), rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE')];
  const zero = Object.fromEntries(L14_TABLES.map(table => [table, 0]));
  const json = (out: string) => JSON.parse(lastLine(out));

  await t.test('two concurrent first ADMITs (different command ids) → exactly one identity; the other GV009, nothing partial', async () => {
    const org = await c.newOrg();
    const [a1, a2] = [await c.mkUser(org, [adminRole]), await c.mkUser(org, [adminRole])];
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const first = await s1.run(admitSql(a1, { commandId: 'c-1', rules }));
      assert.equal(first.err, '', first.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(admitSql(a2, { commandId: 'c-2', rules }));
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      const second = await pending;
      assert.match(second.err, /GV009[\s\S]*L14_STALE_EXPECTATION/, second.err);
      assert.equal(json(first.out).outcome, 'ADMITTED');
    } finally { await Promise.all([s1.close(), s2.close()]); }
    const n = await counts(org);
    assert.equal(n.l14_authority_policies, 1);
    assert.equal(n.l14_authority_policy_versions, 1);
    assert.equal(n.l14_command_results, 1, 'the loser consumed nothing');
    assert.equal(n.l14_authorization_decisions, 1);
  });

  await t.test('same command id + same payload concurrently → one durable result; the waiter replays it', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const first = json((await s1.run(admitSql(admin, { commandId: 'same', rules }))).out);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(admitSql(admin, { commandId: 'same', rules }));
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      const second = await pending;
      assert.equal(second.err, '', second.err);
      const replay = json(second.out);
      assert.equal(replay.replay, true);
      assert.deepEqual({ ...replay, replay: false }, first);
    } finally { await Promise.all([s1.close(), s2.close()]); }
    assert.equal((await counts(org)).l14_command_results, 1);
  });

  await t.test('two concurrent first VALIDATEs of different proposals → exactly one first state; the other GV009', async () => {
    const org = await c.newOrg();
    const [a1, a2] = [await c.mkUser(org, [adminRole]), await c.mkUser(org, [adminRole])];
    const admitted = await c.exec(admitSql(a1, { commandId: 'v-admit', rules }));
    const proposal = c.proposalFor(admitted);
    const [p1, p2] = [await c.exec(submitSql(a1, { commandId: 'v-sub-1', proposal })), await c.exec(submitSql(a2, { commandId: 'v-sub-2', proposal }))];
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const first = await s1.run(decideSql(a1, { commandId: 'v-1', proposalId: p1.proposal_id, proposal }));
      assert.equal(first.err, '', first.err);
      const [pid1, pid2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(decideSql(a2, { commandId: 'v-2', proposalId: p2.proposal_id, proposal }));
      await awaitBlocked(pid2, pid1);
      await s1.run('commit;');
      const second = await pending;
      assert.match(second.err, /GV009[\s\S]*AUTHORITY_POLICY_STATE_EXISTS/, second.err);
    } finally { await Promise.all([s1.close(), s2.close()]); }
    const n = await counts(org);
    assert.equal(n.l14_authority_policy_states, 1);
    assert.equal(n.l14_governance_decisions, 1);
  });

  interface Race { key: string; setup: (org: string, actor: string) => string; restore?: string; expect: 'DENY' | 'GV003'; lock: string }
  const races: Race[] = [
    { key: 'role revocation (role_ids)', setup: (_o, a) => `update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${a}';`, expect: 'DENY', lock: 'user' },
    { key: 'is_system_role flip on the seeded role', setup: () => `update gov_repo.governance_roles set is_system_role=false where role_id='${adminRole}';`,
      restore: `update gov_repo.governance_roles set is_system_role=true where role_id='${adminRole}';`, expect: 'DENY', lock: 'role' },
    { key: 'organisation deactivation', setup: o => `update gov_repo.organisations set is_active=false where organisation_id='${o}';`, expect: 'GV003', lock: 'organisation' },
    { key: 'actor suspension', setup: (_o, a) => `update gov_repo.governance_users set status='suspended' where user_id='${a}';`, expect: 'GV003', lock: 'user' },
  ];
  for (const race of races) {
    await t.test(`authority change committed while ADMIT waits (${race.key}) → evaluated against the committed state`, async () => {
      const org = await c.newOrg();
      const admin = await c.mkUser(org, [adminRole]);
      const writer = c.session('postgres'), caller = c.session('service_role');
      try {
        await writer.run(`begin; ${race.setup(org, admin.id)}`);
        const [pw, pc] = [await pidOf(writer), await pidOf(caller)];
        const pending = caller.run(admitSql(admin, { commandId: 'race', rules }));
        await awaitBlocked(pc, pw);
        await writer.run('commit;');
        const result = await pending;
        if (race.expect === 'DENY') {
          assert.equal(result.err, '', result.err);
          assert.equal(json(result.out).deny_reason, 'BOOTSTRAP_ROLE_REQUIRED');
          assert.equal((await counts(org)).l14_authority_policies, 0);
        } else {
          assert.match(result.err, /GV003/, result.err);
          assert.deepEqual(await counts(org), zero, 'no partial durable writes');
        }
      } finally {
        await Promise.all([writer.close(), caller.close()]);
        if (race.restore) await owner(race.restore);
      }
    });

    await t.test(`in-flight ADMIT holds its locks: the ${race.key} WAITS for commitment`, async () => {
      const org = await c.newOrg();
      const admin = await c.mkUser(org, [adminRole]);
      const caller = c.session('service_role'), writer = c.session('postgres');
      try {
        await caller.run('begin;');
        const admitted = await caller.run(admitSql(admin, { commandId: 'inflight', rules }));
        assert.equal(admitted.err, '', admitted.err);
        const [pc, pw] = [await pidOf(caller), await pidOf(writer)];
        const pending = writer.run(race.setup(org, admin.id));
        await awaitBlocked(pw, pc);
        await caller.run('commit;');
        const done = await pending;
        assert.equal(done.err, '', done.err);
        assert.equal(json(admitted.out).outcome, 'ADMITTED');
      } finally {
        await Promise.all([caller.close(), writer.close()]);
        if (race.restore) await owner(race.restore);
      }
    });
  }

  await t.test('Authority Policy guard held elsewhere → 55P03 after lock_timeout; nothing written, command reusable', async () => {
    const org = await c.newOrg();
    const admin = await c.mkUser(org, [adminRole]);
    const holder = c.session('m16_bootstrap');
    try {
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${org}');`);
      await assert.rejects(c.svc(admitSql(admin, { commandId: 'timeout', rules })), (error: Error) => {
        assert.match(error.message, /55P03/);
        return true;
      });
      assert.deepEqual(await counts(org), zero);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(admitSql(admin, { commandId: 'timeout', rules }))).outcome, 'ADMITTED');
  });
});
