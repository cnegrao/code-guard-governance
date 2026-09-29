import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { successorKit } from '../helpers/m16-l14-successor-fixtures';

/**
 * M16-S1B.0 — Authority Policy SHARED guard and registry subject guard on real disposable
 * PostgreSQL 17. Distinct backends hold and contend for real advisory locks; blocking is observed
 * via pg_stat_activity + pg_blocking_pids from a separate monitor session, never by sleeping alone.
 * The guards are owner-only helpers, so the holders run as the owner; the Authority Policy side
 * also runs the REAL unchanged ADMIT RPC as service_role.
 */
test('M16 S1B.0 registry framework guards (disposable PG17)', { timeout: 900_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B0' });
  t.after(() => c.stop());
  const { owner, rejects } = c;
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
  /** Completes without ever waiting on a lock (the statement must return within the bound). */
  async function completesUnblocked(session: Session, query: string) {
    const result = await session.run(query, 15_000);
    assert.equal(result.err, '', result.err);
    return result;
  }
  const shared = (org: string) => `select gov_repo.l14_lock_authority_policy_guard_shared_v1('${org}');`;
  const exclusive = (org: string) => `select gov_repo.l14_lock_authority_policy_guard_v1('${org}');`;
  const subject = (org: string, kind: string, key: string) => `select gov_repo.l14_lock_registry_subject_guard_v1('${org}','${kind}','${key}');`;
  const advisory = async (pid: string) => (await monitor.run(`select string_agg(classid||'/'||objid||'/'||objsubid||'/'||mode, ',' order by mode)
    from pg_locks where locktype='advisory' and pid=${pid} and granted;`)).out.trim();

  const orgA = await c.newOrg(), orgB = await c.newOrg();

  await t.test('shared AP guard uses the SAME advisory key as the S1A exclusive guard (ShareLock vs ExclusiveLock on one key)', async () => {
    const s = c.session('postgres');
    try {
      await s.run('begin;');
      await s.run(shared(orgA));
      const sharedLock = await advisory(await pidOf(s));
      await s.run('commit;');
      await s.run('begin;');
      await s.run(exclusive(orgA));
      const exclusiveLock = await advisory(await pidOf(s));
      await s.run('commit;');
      const [sk, sm] = [sharedLock.slice(0, sharedLock.lastIndexOf('/')), sharedLock.slice(sharedLock.lastIndexOf('/') + 1)];
      const [ek, em] = [exclusiveLock.slice(0, exclusiveLock.lastIndexOf('/')), exclusiveLock.slice(exclusiveLock.lastIndexOf('/') + 1)];
      assert.equal(sk, ek, 'identical (classid, objid, objsubid)');
      assert.equal(sm, 'ShareLock');
      assert.equal(em, 'ExclusiveLock');
    } finally { await s.close(); }
  });

  await t.test('shared held → the exclusive AP guard waits; released → it proceeds', async () => {
    const [s1, s2] = [c.session('postgres'), c.session('postgres')];
    try {
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      await s1.run('begin;');
      await s1.run(shared(orgA));
      await s2.run('begin;');
      const pending = s2.run(exclusive(orgA));
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      assert.equal((await pending).err, '');
      await s2.run('commit;');
    } finally { await Promise.all([s1.close(), s2.close()]); }
  });

  await t.test('exclusive held → the shared registry guard waits; released → it proceeds', async () => {
    const [s1, s2] = [c.session('postgres'), c.session('postgres')];
    try {
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      await s1.run('begin;');
      await s1.run(exclusive(orgA));
      await s2.run('begin;');
      const pending = s2.run(shared(orgA));
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      assert.equal((await pending).err, '');
      await s2.run('commit;');
    } finally { await Promise.all([s1.close(), s2.close()]); }
  });

  await t.test('registry commands do not serialize each other on the AP guard; other organisations are independent', async () => {
    const [s1, s2, s3] = [c.session('postgres'), c.session('postgres'), c.session('postgres')];
    try {
      await s1.run('begin;');
      await s1.run(shared(orgA));
      await s2.run('begin;');
      await completesUnblocked(s2, shared(orgA));
      await s3.run('begin;');
      await completesUnblocked(s3, exclusive(orgB));
      assert.match(await advisory(await pidOf(s2)), /ShareLock$/);
      await Promise.all([s1.run('commit;'), s2.run('commit;'), s3.run('commit;')]);
    } finally { await Promise.all([s1.close(), s2.close(), s3.close()]); }
  });

  await t.test('the REAL unchanged Authority Policy ADMIT RPC waits for an in-flight registry shared guard (and vice versa)', async () => {
    const kit = await successorKit(c);
    const compliant = (variant: number) => kit.opsRules(variant).filter(r => r.permission !== 'L14_PARTY_VALIDATE');
    const ctx = await kit.setup(compliant(0));
    const [holder, rpc] = [c.session('postgres'), c.session('service_role')];
    try {
      const [holderPid, rpcPid] = [await pidOf(holder), await pidOf(rpc)];
      // Registry side first: the AP successor ADMIT must wait.
      await holder.run('begin;');
      await holder.run(shared(ctx.org));
      const head = await kit.head(ctx.org);
      await rpc.run('begin;');
      const pending = rpc.run(kit.admitNextSql(ctx, ctx.ops, ctx.cmd('guard-admit-1'), compliant(1), head.latest_version_id));
      await awaitBlocked(rpcPid, holderPid);
      await holder.run('commit;');
      const admitted = await pending;
      assert.equal(admitted.err, '', admitted.err);
      assert.equal(JSON.parse(lastLine(admitted.out)).outcome, 'ADMITTED');
      // AP side in flight (exclusive held until its commit): the registry shared guard must wait.
      await holder.run('begin;');
      const waiting = holder.run(shared(ctx.org));
      await awaitBlocked(holderPid, rpcPid);
      await rpc.run('commit;');
      assert.equal((await waiting).err, '');
      await holder.run('commit;');
    } finally { await Promise.all([holder.close(), rpc.close()]); }
  });

  await t.test('registry subject guard: same organisation + kind + key serializes; any other kind/key/organisation does not', async () => {
    const [s1, s2] = [c.session('postgres'), c.session('postgres')];
    try {
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      await s1.run('begin;');
      await s1.run(subject(orgA, 'GOVERNANCE_PARTY', 'party-1'));
      await s2.run('begin;');
      for (const other of [subject(orgA, 'GOVERNANCE_PARTY', 'party-2'), subject(orgA, 'BUSINESS_DOMAIN', 'party-1'),
        subject(orgB, 'GOVERNANCE_PARTY', 'party-1'), subject(orgA, 'POLICY_VERSION', 'party-1')]) {
        await completesUnblocked(s2, other);
      }
      await completesUnblocked(s2, shared(orgA)); // the subject guard is a different key family than the AP guard
      const pending = s2.run(subject(orgA, 'GOVERNANCE_PARTY', 'party-1'));
      await awaitBlocked(p2, p1);
      await s1.run('commit;');
      assert.equal((await pending).err, '');
      await s2.run('commit;');
    } finally { await Promise.all([s1.close(), s2.close()]); }
  });

  await t.test('registry subject guard keys are framed (length-prefixed), and every registry kind is a distinct family', async () => {
    const s = c.session('postgres');
    try {
      const keys = new Set<string>();
      for (const kind of ['GOVERNANCE_PARTY', 'BUSINESS_DOMAIN', 'INFORMATION_DOMAIN', 'CONTROL_DEFINITION', 'POLICY_VERSION']) {
        await s.run('begin;');
        await s.run(subject(orgA, kind, 'same-key'));
        keys.add(await advisory(await pidOf(s)));
        await s.run('commit;');
      }
      assert.equal(keys.size, 5);
      await s.run('begin;');
      await s.run(shared(orgA));
      const apKey = (await advisory(await pidOf(s))).replace(/\/ShareLock$/, '');
      await s.run('commit;');
      for (const key of keys) assert.notEqual(key.replace(/\/ExclusiveLock$/, ''), apKey);
    } finally { await s.close(); }
    assert.equal(lastLine(await owner(`select gov_repo.frame_identity(array['a','bc']) <> gov_repo.frame_identity(array['ab','c'])`)), 't');
  });

  await t.test('guards fail closed on malformed keys (GV010) and are never callable by application roles', async () => {
    for (const bad of [`null::uuid,'GOVERNANCE_PARTY','k'`, `'${orgA}','RESPONSIBILITY_ASSIGNMENT','k'`, `'${orgA}','AUTHORITY_POLICY_VERSION','k'`,
      `'${orgA}',null,'k'`, `'${orgA}','GOVERNANCE_PARTY',null`, `'${orgA}','GOVERNANCE_PARTY',''`, `'${orgA}','GOVERNANCE_PARTY',' k'`,
      `'${orgA}','GOVERNANCE_PARTY',repeat('k',501)`]) {
      await rejects(owner(`select gov_repo.l14_lock_registry_subject_guard_v1(${bad})`), 'GV010', /GUARD_KEY_INVALID/);
    }
    await rejects(owner(`select gov_repo.l14_lock_authority_policy_guard_shared_v1(null)`), 'GV010', /GUARD_KEY_MISSING/);
    for (const role of ['service_role', 'authenticated', 'anon'] as const) {
      await assert.rejects(c.sql(shared(orgA), role), /42501/);
      await assert.rejects(c.sql(subject(orgA, 'GOVERNANCE_PARTY', 'k'), role), /42501/);
    }
  });
});
