import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';

/**
 * M16-S1C.2 — BUSINESS_CONTEXT_ASSIGNMENT concurrency on real disposable PostgreSQL 17 (S1C2 horizon). Distinct backends
 * contend for the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, the exact domain registry subject guard — SHARED
 * for an assignment, EXCLUSIVE for a domain decision — the exact business-context fact KEY guard, the command guard); blocking
 * is observed via pg_stat_activity + pg_blocking_pids from a separate monitor session, never by sleeping alone. No winner is
 * ever chosen by timing: the loser fails typed and consumes nothing.
 */
test('M16 S1C.2 business context assignment concurrency (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C2' });
  t.after(() => c.stop());
  const k = await businessContextKit(c);
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
  const CONSUMING = ['l14_fact_states', 'l14_business_context_assignment_states', 'l14_governance_decisions', 'l14_authorization_decisions',
    'l14_command_results', 'l14_business_context_assignment_heads'] as const;

  for (const [label, kind, object, semantic] of [
    ['A: two BusinessDomains for one AGENT + BUSINESS_DOMAIN', 'AGENT', 'agent', 'BUSINESS_DOMAIN'],
    ['B: two InformationDomains for one DATA_ELEMENT + INFORMATION_DOMAIN', 'DATA_ELEMENT', 'element', 'INFORMATION_DOMAIN'],
  ] as const) {
    await t.test(`${label}: two command ids, two sessions → exactly one first state; the loser GV009, nothing consumed`, async () => {
      const x = await k.setup();
      const [da, db] = [await k.domain(x, 'ra', semantic), await k.domain(x, 'rb', semantic)];
      const key = k.keyOf(kind, x.objects[object], semantic);
      const [pa, pb] = [k.validateProposal(key, da), k.validateProposal(key, db)];
      const [sa, sb] = [await k.submit(x, x.member, 'ra-submit', pa), await k.submit(x, x.member2, 'rb-submit', pb)];
      const before = await k.counts(x.org);
      const { first, second } = await race(k.decideSqlFor(x.bs, x.cmd('ra'), sa.proposal_id, pa, 'VALIDATE', null),
        k.decideSqlFor(x.bs2, x.cmd('rb'), sb.proposal_id, pb, 'VALIDATE', null));
      assert.equal(json(first.out).outcome, 'VALIDATED');
      assert.match(second.err, /GV009[\s\S]*BUSINESS_CONTEXT_ASSIGNMENT_STATE_EXISTS/, second.err);
      const after = await k.counts(x.org);
      for (const table of CONSUMING) assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('rb')}'`), '0');
      assert.deepEqual((await k.current(x.org, kind, x.objects[object])).map(r => r.split('|')[1]), [da.subject.domainId]);
      assert.equal(await one(`select count(*) from gov_repo.l14_business_context_assignment_states where organisation_id='${x.org}'
        and target_canonical_object_id='${x.objects[object]}' and semantic_kind='${semantic}'`), '1');
    });
  }

  await t.test('C: two successor domains racing from the SAME expected_current_state_id → exactly one successor; the loser stale (GV009)', async () => {
    const x = await k.setup();
    const [d0, d1, d2] = [await k.domain(x, 'c0'), await k.domain(x, 'c1'), await k.domain(x, 'c2')];
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const s0 = await k.assign(x, 'c0', key, d0);
    const s0Rows = await k.stateRows(x.org, s0.stateId);
    const [p1, p2] = [k.validateProposal(key, d1), k.validateProposal(key, d2)];
    const [q1, q2] = [await k.submit(x, x.member, 'c1-submit', p1), await k.submit(x, x.member2, 'c2-submit', p2)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.bs, x.cmd('c1'), q1.proposal_id, p1, 'VALIDATE', s0.stateId),
      k.decideSqlFor(x.bs2, x.cmd('c2'), q2.proposal_id, p2, 'VALIDATE', s0.stateId));
    const won = json(first.out);
    assert.deepEqual([won.outcome, won.predecessor_state_id], ['VALIDATED', s0.stateId]);
    assert.match(second.err, /GV009[\s\S]*BUSINESS_CONTEXT_ASSIGNMENT_STATE_EXPECTATION_MISMATCH/, second.err);
    const after = await k.counts(x.org);
    for (const table of CONSUMING.filter(t => t !== 'l14_business_context_assignment_heads')) {
      assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
    }
    assert.equal(after.l14_business_context_assignment_heads, before.l14_business_context_assignment_heads, 'one head per key, moved');
    assert.equal(await k.head(x.org, key), won.fact_state_id);
    assert.equal(await one(`select count(*) from gov_repo.l14_business_context_assignment_states where predecessor_state_id='${s0.stateId}'`), '1',
      'linear lineage: one successor');
    assert.equal(await k.stateRows(x.org, s0.stateId), s0Rows, 'the predecessor is never touched');
    assert.equal(await k.resolve(x.org, key, now, now), won.fact_state_id);
  });

  await t.test('D: the SAME DATA_ASSET — BUSINESS_DOMAIN and INFORMATION_DOMAIN assignments are different keys: both succeed without serializing', async () => {
    const x = await k.setup();
    const [b, i] = [await k.domain(x, 'db'), await k.domain(x, 'di', 'INFORMATION_DOMAIN')];
    const [kb, ki] = [k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN'), k.keyOf('DATA_ASSET', x.objects.asset, 'INFORMATION_DOMAIN')];
    const [pb, pi] = [k.validateProposal(kb, b), k.validateProposal(ki, i)];
    const [sb, si] = [await k.submit(x, x.member, 'db-submit', pb), await k.submit(x, x.member, 'di-submit', pi)];
    const { first, second } = await parallel(k.decideSqlFor(x.bs, x.cmd('db'), sb.proposal_id, pb, 'VALIDATE', null),
      k.decideSqlFor(x.bs2, x.cmd('di'), si.proposal_id, pi, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
    assert.deepEqual((await k.current(x.org, 'DATA_ASSET', x.objects.asset)).map(r => r.split('|').slice(0, 2).join('|')),
      [`BUSINESS_DOMAIN|${b.subject.domainId}`, `INFORMATION_DOMAIN|${i.subject.domainId}`]);
  });

  await t.test('two assignments pinning the SAME domain on different targets share the domain guard: no serialization', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'shared');
    const [ka, kb] = [k.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN'), k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN')];
    const [pa, pb] = [k.validateProposal(ka, d), k.validateProposal(kb, d)];
    const [sa, sb] = [await k.submit(x, x.member, 'sh-a-submit', pa), await k.submit(x, x.member, 'sh-b-submit', pb)];
    const { first, second } = await parallel(k.decideSqlFor(x.bs, x.cmd('sh-a'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.bs2, x.cmd('sh-b'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
  });

  await t.test('dependency race 1: domain revocation holds the exclusive domain guard; the waiting assignment sees it and consumes nothing', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'dep1');
    // The domain revocation proposal (S1B.5) and the assignment proposal pinning DS1 are both submitted.
    const rvProposal = k.dk.revokeProposal(d.subject, d.stateId);
    const rvSubmitted = await k.dk.submit(x as never, x.member, 'dep1-dom-rv-submit', rvProposal);
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const p = k.validateProposal(key, d);
    const s = await k.submit(x, x.member, 'dep1-submit', p);
    const before = await k.counts(x.org);
    const { first, second } = await race(k.dk.decideSqlFor(x.steward, x.cmd('dep1-dom-rv'), rvSubmitted.proposal_id, rvProposal, 'REVOKE', d.stateId),
      k.decideSqlFor(x.bs, x.cmd('dep1'), s.proposal_id, p, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'REVOKED');
    assert.match(second.err, /GV010[\s\S]*DOMAIN_DEPENDENCY_NOT_VALID/, second.err);
    const after = await k.counts(x.org);
    for (const table of CONSUMING) {
      const expected = table === 'l14_authorization_decisions' || table === 'l14_governance_decisions' || table === 'l14_command_results'
        ? before[table] + 1 : before[table];
      assert.equal(after[table], expected, `${table}: only the domain revocation wrote`);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('dep1')}'`), '0');
    assert.equal(await k.head(x.org, key), null, 'no fact was committed on an invalidated dependency');
  });

  await t.test('dependency race 2: the assignment holds the shared domain guard; the domain revocation waits, commits after it, and invalidates it', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'dep2');
    const key = k.keyOf('DATA_ASSET', x.objects.asset2, 'BUSINESS_DOMAIN');
    const p = k.validateProposal(key, d);
    const s = await k.submit(x, x.member, 'dep2-submit', p);
    const rvProposal = k.dk.revokeProposal(d.subject, d.stateId);
    const rvSubmitted = await k.dk.submit(x as never, x.member, 'dep2-dom-rv-submit', rvProposal);
    const { first, second } = await race(k.decideSqlFor(x.bs, x.cmd('dep2'), s.proposal_id, p, 'VALIDATE', null),
      k.dk.decideSqlFor(x.steward, x.cmd('dep2-dom-rv'), rvSubmitted.proposal_id, rvProposal, 'REVOKE', d.stateId));
    const a = json(first.out), r = json(second.out);
    assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
    assert.ok(Date.parse(a.recorded_at) < Date.parse(r.recorded_at), 'the assignment committed before the revocation was recorded');
    const rows = await k.stateRows(x.org, a.fact_state_id);
    assert.equal(await k.resolve(x.org, key, now, now), null, 'the revocation invalidates it through the resolver');
    assert.equal(await k.resolve(x.org, key, `'${a.recorded_at}'::timestamptz`, `'${a.recorded_at}'::timestamptz`), a.fact_state_id,
      'valid at its own coordinates');
    assert.equal(await k.stateRows(x.org, a.fact_state_id), rows, 'never mutated');
  });

  await t.test('E: same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'same', 'INFORMATION_DOMAIN');
    const q = k.validateProposal(k.keyOf('DATA_ELEMENT', x.objects.element2, 'INFORMATION_DOMAIN'), d);
    const s = await k.submit(x, x.member, 'same-submit', q);
    const sql = k.decideSqlFor(x.bs, x.cmd('same'), s.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.fact_state_id, b.recorded_at, b.authorization_decision_id],
      ['VALIDATED', false, true, a.fact_state_id, a.recorded_at, a.authorization_decision_id]);
  });

  await t.test('F: concurrent terminal decisions on one proposal (VALIDATE vs REJECT): exactly one terminal decision', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'term');
    const q = k.validateProposal(k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_DOMAIN'), d);
    const s = await k.submit(x, x.member, 'term-submit', q);
    const { first, second } = await race(k.decideSqlFor(x.bs, x.cmd('term-v'), s.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.bs2, x.cmd('term-r'), s.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${s.proposal_id}'`), '1');
  });

  await t.test('eligibility change concurrent with commitment: a role revocation committed first makes the waiting decision a durable DENY', async () => {
    const x = await k.setup();
    const d = await k.domain(x, 'elig');
    const q = k.validateProposal(k.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN'), d);
    const s = await k.submit(x, x.member, 'elig-submit', q);
    const { second } = await race(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.bs.id}';`,
      k.decideSqlFor(x.bs, x.cmd('elig'), s.proposal_id, q, 'VALIDATE', null), 'postgres');
    const r = json(second.out);
    assert.deepEqual([r.outcome, r.deny_reason, r.fact_state_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
  });
});
