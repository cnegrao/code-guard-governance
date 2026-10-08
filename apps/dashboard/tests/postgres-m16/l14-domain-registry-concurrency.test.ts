import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { domainKit } from '../helpers/m16-l14-domain-fixtures';

/**
 * M16-S1B.5 — BUSINESS_DOMAIN / INFORMATION_DOMAIN registry concurrency on real disposable PostgreSQL 17 (S1B5 horizon).
 * Distinct backends contend for the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, exact-domain registry
 * subject guard, command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a separate monitor
 * session, never by sleeping alone.
 */
test('M16 S1B.5 domain registry concurrency (disposable PG17)', { timeout: 1_200_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1B5' });
  t.after(() => c.stop());
  const k = await domainKit(c);
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

  await t.test('same-command concurrent ADMIT: the waiter replays the ORIGINAL result — exactly one admission', async () => {
    const x = await k.setup();
    const s = k.subject('BUSINESS_DOMAIN', 'same-a');
    const sql = k.admitSql(x.registrar, { commandId: x.cmd('same-a'), subject: s });
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.authorization_decision_id, b.domain_id], ['ADMITTED', false, true, a.authorization_decision_id, s.domainId]);
    assert.equal(await one(`select count(*) from gov_repo.l14_domain_admissions where domain_id=${lit(s.domainId)}`), '1');
  });

  await t.test('concurrent ADMITs of one identity (different commands): one admission; the loser GV009 DOMAIN_ALREADY_ADMITTED, nothing consumed', async () => {
    const x = await k.setup();
    const s = k.subject('INFORMATION_DOMAIN', 'dup-a');
    const before = await k.counts(x.org);
    const { first, second } = await race(k.admitSql(x.registrar, { commandId: x.cmd('dup-1'), subject: s }),
      k.admitSql(x.registrar2, { commandId: x.cmd('dup-2'), subject: s }));
    assert.equal(json(first.out).outcome, 'ADMITTED');
    assert.match(second.err, /GV009[\s\S]*DOMAIN_ALREADY_ADMITTED/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_domain_admissions, before.l14_domain_admissions + 1);
    assert.equal(after.l14_domain_heads, before.l14_domain_heads + 1);
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1, 'the loser consumed nothing');
    assert.equal(after.l14_command_results, before.l14_command_results + 1);
  });

  await t.test('ADMITs of the same id under the OTHER kind, and of another id, do not serialize (subject guard is per kind + id)', async () => {
    const x = await k.setup();
    const s = k.subject('BUSINESS_DOMAIN', 'par');
    const { first, second } = await parallel(k.admitSql(x.registrar, { commandId: x.cmd('par-b'), subject: s }),
      k.admitSql(x.registrar2, { commandId: x.cmd('par-i'), subject: { ...s, subjectKind: 'INFORMATION_DOMAIN' } }));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['ADMITTED', 'ADMITTED']);
    const [sa, sb] = [await k.admitted(x, 'dp-a'), await k.admitted(x, 'dp-b')];
    const [qa, qb] = [k.validateProposal(sa), k.validateProposal(sb)];
    const [pa, pb] = [await k.submit(x, x.member, 'dp-sa', qa), await k.submit(x, x.member, 'dp-sb', qb)];
    const decided = await parallel(k.decideSqlFor(x.steward, x.cmd('dp-va'), pa.proposal_id, qa, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('dp-vb'), pb.proposal_id, qb, 'VALIDATE', null));
    assert.deepEqual([json(decided.first.out).outcome, json(decided.second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('same-command concurrent DECIDE: the waiter replays the ORIGINAL result — exactly one state', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'same');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'same-s', q);
    const sql = k.decideSqlFor(x.steward, x.cmd('same-v'), sub.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.registry_state_id], ['VALIDATED', false, true, a.registry_state_id]);
    assert.equal(await one(`select count(*) from gov_repo.l14_domain_states where domain_id=${lit(s.domainId)}`), '1');
  });

  await t.test('concurrent terminal decisions on one proposal: one wins; the other GV010 PROPOSAL_TERMINAL; nothing partial', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'ct');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'ct-s', q);
    const { first, second } = await race(k.decideSqlFor(x.steward, x.cmd('ct-validate'), sub.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('ct-reject'), sub.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${sub.proposal_id}'`), '1');
  });

  await t.test('concurrent VALIDATEs on expected-none (two proposals, one domain): one state; the loser GV009 and not consumed', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'cv', 'INFORMATION_DOMAIN');
    const q = k.validateProposal(s);
    const [s1, s2] = [await k.submit(x, x.member, 'cv-s1', q), await k.submit(x, x.member, 'cv-s2', q)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.steward, x.cmd('cv-1'), s1.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.steward2, x.cmd('cv-2'), s2.proposal_id, q, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*DOMAIN_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_domain_states, before.l14_domain_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(after.l14_authorization_decisions, before.l14_authorization_decisions + 1);
  });

  await t.test('REVOKE vs re-VALIDATE and REVOKE vs REVOKE: the loser is stale (GV009, not consumed); lineage stays linear', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'rr');
    const v1 = (await k.validate(x, 'rr', s)).decided.registry_state_id as string;
    const vq = k.validateProposal(s);
    const vs1 = await k.submit(x, x.member, 'rr-vs1', vq);
    const rp1 = k.revokeProposal(s, v1);
    const rs1 = await k.submit(x, x.member, 'rr-rs1', rp1);
    const ra = await race(k.decideSqlFor(x.steward, x.cmd('rr-revoke'), rs1.proposal_id, rp1, 'REVOKE', v1),
      k.decideSqlFor(x.steward2, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', v1));
    const r1 = json(ra.first.out);
    assert.equal(r1.outcome, 'REVOKED');
    assert.match(ra.second.err, /GV009[\s\S]*DOMAIN_STATE_EXPECTATION_MISMATCH/, ra.second.err);
    const v2 = await c.exec(k.decideSqlFor(x.steward2, x.cmd('rr-revalidate-1'), vs1.proposal_id, vq, 'VALIDATE', r1.registry_state_id));
    assert.equal(v2.outcome, 'VALIDATED', 'the stale command id succeeds once its expectation is current');
    const rp2 = k.revokeProposal(s, v2.registry_state_id);
    const [rsA, rsB] = [await k.submit(x, x.member, 'rr-rsA', rp2), await k.submit(x, x.member, 'rr-rsB', rp2)];
    const before = await k.counts(x.org);
    const rc = await race(k.decideSqlFor(x.steward, x.cmd('rr-revoke-a'), rsA.proposal_id, rp2, 'REVOKE', v2.registry_state_id),
      k.decideSqlFor(x.steward2, x.cmd('rr-revoke-b'), rsB.proposal_id, rp2, 'REVOKE', v2.registry_state_id));
    const r2 = json(rc.first.out);
    assert.equal(r2.outcome, 'REVOKED');
    assert.match(rc.second.err, /GV009/, rc.second.err);
    assert.equal((await k.counts(x.org)).l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.equal(await one(`select string_agg(s.state_kind, '>' order by s.recorded_at) from gov_repo.l14_registry_states s
      join gov_repo.l14_domain_states d using (organisation_id, state_id) where d.domain_id=${lit(s.domainId)}`),
      'VALIDATED>REVOKED>VALIDATED>REVOKED');
    assert.equal((await k.head(x.org, s))!.latest_state_id, r2.registry_state_id);
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
      const s = await k.admitted(x, 'ar');
      const q = k.validateProposal(s);
      const sub = await k.submit(x, x.member, 'ar-s', q);
      const before = await k.counts(x.org);
      const { second } = await race(r.change(x), k.decideSqlFor(x.steward, x.cmd('ar-v'), sub.proposal_id, q, 'VALIDATE', null), 'postgres');
      const after = await k.counts(x.org);
      assert.equal(after.l14_domain_states, before.l14_domain_states, 'no state written');
      if (typeof r.expect === 'string') {
        assert.equal(second.err, '', second.err);
        assert.equal(json(second.out).deny_reason, r.expect);
      } else {
        assert.match(second.err, r.expect, second.err);
        assert.deepEqual(after, before, 'base-eligibility failure consumes nothing');
      }
    });
  }

  await t.test('ADMIT waiting on a committed role revocation is a durable DENY; nothing admitted', async () => {
    const x = await k.setup();
    const s = k.subject('BUSINESS_DOMAIN', 'arr');
    const { second } = await race(`update gov_repo.governance_users set role_ids=array['${memberRole}']::uuid[] where user_id='${x.registrar.id}';`,
      k.admitSql(x.registrar, { commandId: x.cmd('arr'), subject: s }), 'postgres');
    assert.equal(second.err, '', second.err);
    assert.deepEqual([json(second.out).outcome, json(second.out).deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    assert.equal(await k.head(x.org, s), null);
  });

  await t.test('Authority Policy change removing the grant commits first → the waiting VALIDATE is a durable DENY under the new basis', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'apd');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'apd-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'apd-v2-admit', k.domainRules(5, {}, [`${k.stewardRole}:L14_DOMAIN_VALIDATE:VALIDATE`]));
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

  await t.test('a domain decision in flight (AP guard SHARED) holds off an Authority Policy VALIDATE (EXCLUSIVE)', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'ap');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'ap-s', q);
    const v2 = await k.ap.admitNext(x as never, x.ops, 'ap-v2-admit', k.domainRules(3));
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

  await t.test('exact-domain subject guard / AP guard held → 55P03 after lock_timeout; nothing written; command reusable', async () => {
    const x = await k.setup();
    const s = await k.admitted(x, 'lt');
    const q = k.validateProposal(s);
    const sub = await k.submit(x, x.member, 'lt-s', q);
    const fresh = k.subject('BUSINESS_DOMAIN', 'lt-new');
    const holder = c.session('m16_bootstrap');
    const before = await k.counts(x.org);
    try {
      await holder.run(`begin; select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','BUSINESS_DOMAIN',${lit(s.domainId)});
        select gov_repo.l14_lock_registry_subject_guard_v1('${x.org}','BUSINESS_DOMAIN',${lit(fresh.domainId)});`);
      await assert.rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/);
      await assert.rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('lt-s2'), proposal: q })), /55P03/);
      await assert.rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('lt-a'), subject: fresh })), /55P03/);
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
      await holder.run(`begin; select gov_repo.l14_lock_authority_policy_guard_v1('${x.org}');`);
      await assert.rejects(c.svc(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null)), /55P03/,
        'the EXCLUSIVE AP guard blocks the SHARED registry guard');
      await assert.rejects(c.svc(k.admitSql(x.registrar, { commandId: x.cmd('lt-a'), subject: fresh })), /55P03/);
      assert.deepEqual(await k.counts(x.org), before);
      await holder.run('rollback;');
    } finally { await holder.close(); }
    assert.equal((await c.exec(k.decideSqlFor(x.steward, x.cmd('lt-v'), sub.proposal_id, q, 'VALIDATE', null))).outcome, 'VALIDATED');
    assert.equal((await c.exec(k.admitSql(x.registrar, { commandId: x.cmd('lt-a'), subject: fresh }))).outcome, 'ADMITTED');
  });
});
