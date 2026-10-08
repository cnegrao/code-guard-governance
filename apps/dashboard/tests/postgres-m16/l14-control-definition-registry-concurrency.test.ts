import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlDefinitionKit } from '../helpers/m16-l14-control-definition-fixtures';

/**
 * M16-S1B.6 — CONTROL_DEFINITION registry concurrency on real disposable PostgreSQL 17 (S1B6 horizon). Distinct backends
 * contend for the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, the identity / version-id admission guards,
 * the exact-tuple validation guard, command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a
 * separate monitor session, never by sleeping alone.
 */
test('M16 S1B.6 control definition registry concurrency (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B6' });
  t.after(() => c.stop());
  const k = await controlDefinitionKit(c);
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

  await t.test('same-command concurrent first-version ADMIT: the waiter replays the ORIGINAL result — exactly one identity / version', async () => {
    const x = await k.setup();
    const cdid = randomUUID(), vid = randomUUID();
    const sql = k.admitSql(x.registrar, { commandId: x.cmd('same-a'), controlDefinitionId: cdid, versionId: vid, content: k.content('same-a') });
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.authorization_decision_id, b.control_definition_version_id],
      ['ADMITTED', false, true, a.authorization_decision_id, vid]);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definitions where control_definition_id='${cdid}'`), '1');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definition_versions where control_definition_id='${cdid}'`), '1');
  });

  await t.test('concurrent first-version ADMITs of one identity (different commands / versions): one identity; the loser GV009, nothing consumed', async () => {
    const x = await k.setup();
    const cdid = randomUUID();
    const before = await k.counts(x.org);
    const { first, second } = await race(
      k.admitSql(x.registrar, { commandId: x.cmd('dup-1'), controlDefinitionId: cdid, versionId: randomUUID(), content: k.content('dup-1') }),
      k.admitSql(x.registrar2, { commandId: x.cmd('dup-2'), controlDefinitionId: cdid, versionId: randomUUID(), content: k.content('dup-2') }));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV009[\s\S]*CONTROL_DEFINITION_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_control_definitions, before.l14_control_definitions + 1);
    assert.equal(after.l14_control_definition_versions, before.l14_control_definition_versions + 1);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1, 'the loser consumed nothing');
    assert.equal(after.l14_command_results, before.l14_command_results + 1);
  });

  await t.test('concurrent successor ADMITs pinning the same expected latest: one successor; the loser is stale (GV009); lineage stays linear', async () => {
    const x = await k.setup();
    const { version: v1 } = await k.admitFirst(x, 'succ');
    const before = await k.counts(x.org);
    const expectation = { kind: 'EXPECTED_CURRENT', latestVersionId: v1.controlDefinitionVersionId } as const;
    const { first, second } = await race(
      k.admitSql(x.registrar, { commandId: x.cmd('succ-a'), controlDefinitionId: v1.controlDefinitionId, versionId: randomUUID(),
        content: k.content('succ-a'), expectation }),
      k.admitSql(x.registrar2, { commandId: x.cmd('succ-b'), controlDefinitionId: v1.controlDefinitionId, versionId: randomUUID(),
        content: k.content('succ-b'), expectation }));
    const a = json(first.out);
    assert.deepEqual([a.outcome, a.predecessor_version_id], ['ADMITTED', v1.controlDefinitionVersionId]);
    assert.match(second.err, /GV009[\s\S]*CONTROL_DEFINITION_VERSION_EXPECTATION_MISMATCH/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_control_definition_versions, before.l14_control_definition_versions + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definition_versions where control_definition_id='${v1.controlDefinitionId}'
      and predecessor_version_id='${v1.controlDefinitionVersionId}'`), '1', 'never a fork');
    // The stale command id succeeds once its expectation is current.
    const retry = await c.exec(k.admitSql(x.registrar2, { commandId: x.cmd('succ-b'), controlDefinitionId: v1.controlDefinitionId,
      versionId: randomUUID(), content: k.content('succ-b'), expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: a.control_definition_version_id } }));
    assert.deepEqual([retry.outcome, retry.predecessor_version_id], ['ADMITTED', a.control_definition_version_id]);
  });

  await t.test('concurrent ADMITs reusing one version id under different identities: the version-id guard serializes; the loser GV009', async () => {
    const x = await k.setup();
    const vid = randomUUID();
    const before = await k.counts(x.org);
    const { first, second } = await race(
      k.admitSql(x.registrar, { commandId: x.cmd('vid-1'), controlDefinitionId: randomUUID(), versionId: vid, content: k.content('vid-1') }),
      k.admitSql(x.registrar2, { commandId: x.cmd('vid-2'), controlDefinitionId: randomUUID(), versionId: vid, content: k.content('vid-2') }));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV009[\s\S]*CONTROL_DEFINITION_VERSION_ID_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_control_definitions, before.l14_control_definitions + 1);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('ADMITs of different identities, and VALIDATEs of two versions of one identity, do not serialize', async () => {
    const x = await k.setup();
    const { first, second } = await parallel(
      k.admitSql(x.registrar, { commandId: x.cmd('par-a'), controlDefinitionId: randomUUID(), versionId: randomUUID(), content: k.content('par-a') }),
      k.admitSql(x.registrar2, { commandId: x.cmd('par-b'), controlDefinitionId: randomUUID(), versionId: randomUUID(), content: k.content('par-b') }));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['ADMITTED', 'ADMITTED']);
    const { version: v1 } = await k.admitFirst(x, 'pv');
    const { version: v2 } = await k.admitNext(x, 'pv2', v1, k.content('pv2'));
    const [q1, q2] = [k.validateProposal(v1), k.validateProposal(v2)];
    const [p1, p2] = [await k.submit(x, x.member, 'pv-s1', q1), await k.submit(x, x.member, 'pv-s2', q2)];
    const decided = await parallel(k.decideSqlFor(x.steward, x.cmd('pv-v1'), p1.proposal_id, q1, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('pv-v2'), p2.proposal_id, q2, 'VALIDATE', null));
    assert.deepEqual([json(decided.first.out).outcome, json(decided.second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('same-command concurrent DECIDE: the waiter replays the ORIGINAL result — exactly one state', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'same');
    const q = k.validateProposal(v);
    const sub = await k.submit(x, x.member, 'same-s', q);
    const sql = k.decideSqlFor(x.steward, x.cmd('same-v'), sub.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.registry_state_id], ['VALIDATED', false, true, a.registry_state_id]);
    assert.equal(await one(`select count(*) from gov_repo.l14_control_definition_states where control_definition_version_id='${v.controlDefinitionVersionId}'`), '1');
  });

  await t.test('concurrent terminal decisions on one proposal: one wins; the other GV010 PROPOSAL_TERMINAL; nothing partial', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'ct');
    const q = k.validateProposal(v);
    const sub = await k.submit(x, x.member, 'ct-s', q);
    const { first, second } = await race(k.decideSqlFor(x.steward, x.cmd('ct-validate'), sub.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('ct-reject'), sub.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${sub.proposal_id}'`), '1');
  });

  await t.test('concurrent first VALIDATEs on expected-none (two proposals, one tuple): one state; the loser GV009 and not consumed', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'cv');
    const q = k.validateProposal(v);
    const [s1, s2] = [await k.submit(x, x.member, 'cv-s1', q), await k.submit(x, x.member, 'cv-s2', q)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.steward, x.cmd('cv-1'), s1.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('cv-2'), s2.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*CONTROL_DEFINITION_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_control_definition_states, before.l14_control_definition_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('REVOKE vs re-VALIDATE and REVOKE vs REVOKE: the loser is stale (GV009, not consumed); lineage stays linear', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'rr');
    const s1 = (await k.validate(x, 'rr', v)).decided.registry_state_id as string;
    const vq = k.validateProposal(v);
    const vs1 = await k.submit(x, x.member, 'rr-vs1', vq);
    const rp1 = k.revokeProposal(v, s1);
    const rs1 = await k.submit(x, x.member, 'rr-rs1', rp1);
    const ra = await race(k.decideSqlFor(x.steward, x.cmd('rr-revoke'), rs1.proposal_id, rp1, 'REVOKE', s1),
      k.decideSqlFor(x.steward2, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', s1));
    const r1 = json(ra.first.out);
    assert.equal(r1.outcome, 'REVOKED');
    assert.match(ra.second.err, /GV009[\s\S]*CONTROL_DEFINITION_STATE_EXPECTATION_MISMATCH/, ra.second.err);
    const s2 = await c.exec(k.decideSqlFor(x.steward2, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', r1.registry_state_id));
    assert.equal(s2.outcome, 'VALIDATED', 'the stale command id succeeds once its expectation is current');
    const rp2 = k.revokeProposal(v, s2.registry_state_id);
    const [rsA, rsB] = [await k.submit(x, x.member, 'rr-rsA', rp2), await k.submit(x, x.member, 'rr-rsB', rp2)];
    const before = await k.counts(x.org);
    const rc = await race(k.decideSqlFor(x.steward, x.cmd('rr-revoke-a'), rsA.proposal_id, rp2, 'REVOKE', s2.registry_state_id),
      k.decideSqlFor(x.steward2, x.cmd('rr-revoke-b'), rsB.proposal_id, rp2, 'REVOKE', s2.registry_state_id));
    const r2 = json(rc.first.out);
    assert.equal(r2.outcome, 'REVOKED');
    assert.match(rc.second.err, /GV009/, rc.second.err);
    assert.equal((await k.counts(x.org)).l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_control_definition_states d using (organisation_id, state_id) where d.control_definition_version_id='${v.controlDefinitionVersionId}'`),
    'VALIDATED>REVOKED>VALIDATED>REVOKED');
    assert.equal((await k.head(x.org, v))!.latest_state_id, r2.registry_state_id);
  });

  interface AuthorityRace { key: string; change: (x: Awaited<ReturnType<typeof k.setup>>) => string; expect: RegExp | string }
  const authorityRaces: AuthorityRace[] = [
    { key: 'role revocation', change: x => `update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${x.steward.id}';`,
      expect: 'NO_MATCHING_AUTHORITY_RULE' },
    { key: 'credential rotation', change: x => `update gov_repo.governance_users set external_id='rotated' where user_id='${x.steward.id}';`, expect: /GV002/ },
    { key: 'actor suspension', change: x => `update gov_repo.governance_users set status='suspended' where user_id='${x.steward.id}';`, expect: /GV003/ },
    { key: 'organisation deactivation', change: x => `update gov_repo.organisations set is_active=false where organisation_id='${x.org}';`, expect: /GV003/ },
  ];
  for (const r of authorityRaces) {
    await t.test(`VALIDATE waiting on a committed ${r.key} is evaluated against the committed state; nothing partial`, async () => {
      const x = await k.setup();
      const v = await k.admitted(x, 'ar');
      const q = k.validateProposal(v);
      const sub = await k.submit(x, x.member, 'ar-s', q);
      const before = await k.counts(x.org);
      const { second } = await race(r.change(x), k.decideSqlFor(x.steward, x.cmd('ar-v'), sub.proposal_id, q, 'VALIDATE', null), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l14_control_definition_states, before.l14_control_definition_states, 'no state written');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.equal(json(second.out).deny_reason, r.expect);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  for (const r of authorityRaces) {
    await t.test(`successor ADMIT waiting on a committed ${r.key} (registrar) is evaluated against the committed state; nothing admitted`, async () => {
      const x = await k.setup();
      const { version: v1 } = await k.admitFirst(x, 'aa');
      const change = r.change(x).replace(x.steward.id, x.registrar.id);
      const before = await k.counts(x.org);
      const { second } = await race(change, k.admitSql(x.registrar, { commandId: x.cmd('aa-2'), controlDefinitionId: v1.controlDefinitionId,
        versionId: randomUUID(), content: k.content('aa-2'), expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: v1.controlDefinitionVersionId } }), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l14_control_definition_versions, before.l14_control_definition_versions, 'nothing admitted');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', r.expect]);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('Authority Policy change removing the grant commits first → the waiting VALIDATE is a durable DENY under the new basis', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'apd');
    const q = k.validateProposal(v);
    const sub = await k.submit(x, x.member, 'apd-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'apd-v2-admit', k.controlRules(5, {}, [`${k.stewardRole}:L14_CONTROL_DEFINITION_VALIDATE:VALIDATE`]));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'apd-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const { first, second } = await race(
      k.ap.decideSqlFor(x as never, x.ops, x.cmd('apd-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id),
      k.decideSqlFor(x.steward, x.cmd('apd-validate'), sub.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    const denied = json(second.out);
    assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}'`), v2.version_id);
  });

  await t.test('a control decision / admission in flight (AP guard SHARED) holds off an Authority Policy VALIDATE (EXCLUSIVE)', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'ap');
    const q = k.validateProposal(v);
    const sub = await k.submit(x, x.member, 'ap-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'ap-v2-admit', k.controlRules(3));
    const apProposal = k.ap.validateProposal(v2);
    const apSubmitted = await k.ap.submit(x as never, x.member, 'ap-v2-submit', apProposal);
    const apHead = await k.ap.head(x.org);
    const { first, second } = await race(k.decideSqlFor(x.steward, x.cmd('ap-v'), sub.proposal_id, q, 'VALIDATE', null),
      k.ap.decideSqlFor(x as never, x.ops, x.cmd('ap-v2-validate'), apSubmitted.proposal_id, apProposal, 'VALIDATE', apHead.latest_state_id));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.equal(json(second.out).outcome, 'VALIDATED');
    assert.equal(await one(`select basis_version_id from gov_repo.l14_authorization_decisions where authorization_decision_id='${json(first.out).authorization_decision_id}'`),
      x.v1.version_id, 'the in-flight decision was authorized by the policy effective when it held the guard');
  });

  await t.test('identity / version-id / validation subject guard or AP guard held → 55P03 after lock_timeout; nothing written; command reusable', async () => {
    const x = await k.setup();
    const v = await k.admitted(x, 'lt');
    const q = k.validateProposal(v);
    const sub = await k.submit(x, x.member, 'lt-s', q);
    const fresh = { cdid: randomUUID(), vid: randomUUID() };
    const admitFresh = () => k.admitSql(x.registrar, { commandId: x.cmd('lt-a'), controlDefinitionId: fresh.cdid, versionId: fresh.vid, content: k.content('lt-a') });
    const holder = c.session('m16_bootstrap');
    const before = await k.counts(x.org);
    try {
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','CONTROL_DEFINITION',
        'CONTROL_DEFINITION_VALIDATION:${v.controlDefinitionId}:${v.controlDefinitionVersionId}:${v.contentHash}');
        select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','CONTROL_DEFINITION','CONTROL_DEFINITION:${fresh.cdid}');`);
      await assert.rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/);
      await assert.rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('lt-s2'), proposal: q })), /55P03/);
      await assert.rejects(c.svc(admitFresh()), /55P03/);
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','CONTROL_DEFINITION','CONTROL_DEFINITION_VERSION:${fresh.vid}');`);
      await assert.rejects(c.svc(admitFresh()), /55P03/, 'the version-id guard is held');
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${x.org}');`);
      await assert.rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/,
        'the EXCLUSIVE AP guard blocks the SHARED registry guard');
      await assert.rejects(c.svc(admitFresh()), /55P03/);
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null))).outcome, 'VALIDATED');
    assert.equal((await c.exec(admitFresh())).outcome, 'ADMITTED');
  });
});
