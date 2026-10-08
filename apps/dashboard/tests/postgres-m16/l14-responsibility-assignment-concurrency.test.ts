import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.1 — RESPONSIBILITY_ASSIGNMENT concurrency on real disposable PostgreSQL 17 (S1C1 horizon). Distinct backends
 * contend for the real locks (ORG → USER → ROLES FOR SHARE, AP guard SHARED, the target + single-owner-role CARDINALITY
 * guard, the exact fact KEY guard, the command guard); blocking is observed via pg_stat_activity + pg_blocking_pids from a
 * separate monitor session, never by sleeping alone. No winner is ever chosen by timing: the loser fails typed and consumes
 * nothing.
 */
test('M16 S1C.1 responsibility assignment concurrency (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C1' });
  t.after(() => c.stop());
  const k = await responsibilityKit(c);
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
  const activeOf = async (org: string, kind: string, object: string, role: string) =>
    (await k.current(org, kind, object)).filter(r => r.startsWith(`${role}:`)).map(r => r.split(':')[1]);

  for (const [kind, object, role] of [['AGENT', 'agent', 'BUSINESS_OWNER'], ['AGENT', 'agent', 'TECHNICAL_OWNER'],
    ['DATA_ASSET', 'asset', 'DATA_OWNER'], ['DATA_ELEMENT', 'element', 'DATA_OWNER']] as const) {
    await t.test(`single-owner race ${kind} + ${role}: two Parties, two command ids, one interval → exactly one wins; the loser GV009, nothing consumed`, async () => {
      const x = await k.setup();
      const [a, b] = [await k.party(x, 'ra'), await k.party(x, 'rb')];
      const target = x.objects[object];
      const [pa, pb] = [k.validateProposal(k.keyOf(kind, target, role, a.partyId), a.stateId),
        k.validateProposal(k.keyOf(kind, target, role, b.partyId), b.stateId)];
      const [sa, sb] = [await k.submit(x, x.member, 'ra-submit', pa), await k.submit(x, x.member, 'rb-submit', pb)];
      const before = await k.counts(x.org);
      const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('ra'), sa.proposal_id, pa, 'VALIDATE', null),
        k.decideSqlFor(x.rs2, x.cmd('rb'), sb.proposal_id, pb, 'VALIDATE', null));
      assert.equal(json(first.out).outcome, 'VALIDATED');
      assert.match(second.err, /GV009[\s\S]*RESPONSIBILITY_SINGLE_OWNER_CONFLICT/, second.err);
      const after = await k.counts(x.org);
      for (const table of ['l14_fact_states', 'l14_responsibility_assignment_states', 'l14_governance_decisions', 'l14_authorization_decisions',
        'l14_command_results', 'l14_responsibility_assignment_heads'] as const) {
        assert.equal(after[table], before[table] + 1, `${table}: only the winner wrote`);
      }
      assert.equal(await one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('rb')}'`), '0');
      assert.deepEqual(await activeOf(x.org, kind, target, role), [a.partyId]);
      assert.equal(await one(`select count(*) from gov_repo.l14_responsibility_assignment_states where organisation_id='${x.org}'
        and target_canonical_object_id='${target}' and responsibility_role='${role}'`), '1');
    });
  }

  await t.test('single-owner: a revoke and a replacement racing on one target + role serialize on the cardinality guard (no timing win)', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'sa'), await k.party(x, 'sb')];
    const keyA = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', a.partyId);
    const held = await k.assign(x, 'sa', keyA, a);
    const rp = k.revokeProposal(keyA, a.stateId, held.stateId);
    const rs = await k.submit(x, x.member, 'sa-rv-submit', rp);
    const pb = k.validateProposal(k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', b.partyId), b.stateId);
    const sb = await k.submit(x, x.member, 'sb-submit', pb);
    const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('sa-revoke'), rs.proposal_id, rp, 'REVOKE', held.stateId),
      k.decideSqlFor(x.rs2, x.cmd('sb-validate'), sb.proposal_id, pb, 'VALIDATE', null));
    const [r, v] = [json(first.out), json(second.out)];
    assert.deepEqual([r.outcome, v.outcome], ['REVOKED', 'VALIDATED'], 'the waiter sees the committed revocation, never an overlap');
    assert.ok(Date.parse(v.effective_from) >= Date.parse(r.effective_from));
    assert.deepEqual(await activeOf(x.org, 'DATA_ASSET', x.objects.asset, 'DATA_OWNER'), [b.partyId]);
  });

  await t.test('O45-A: same target + DATA_STEWARD + SAME Party, two proposals / command ids concurrently → exactly one active assignment', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'oa');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_STEWARD', p.partyId);
    const [q1, q2] = [k.validateProposal(key, p.stateId), k.validateProposal(key, p.stateId)];
    const [s1, s2] = [await k.submit(x, x.member, 'oa-1-submit', q1), await k.submit(x, x.member2, 'oa-2-submit', q2)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('oa-1'), s1.proposal_id, q1, 'VALIDATE', null),
      k.decideSqlFor(x.rs2, x.cmd('oa-2'), s2.proposal_id, q2, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RESPONSIBILITY_ASSIGNMENT_STATE_EXISTS/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_fact_states, before.l14_fact_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1, 'the loser consumed nothing');
    assert.deepEqual(await activeOf(x.org, 'DATA_ASSET', x.objects.asset, 'DATA_STEWARD'), [p.partyId]);
    assert.equal(await one(`select count(*) from gov_repo.l14_responsibility_assignment_states where organisation_id='${x.org}'
      and governance_party_id='${p.partyId}' and responsibility_role='DATA_STEWARD'`), '1', 'one state; no predecessor edit');
  });

  await t.test('O45-B: same target + DATA_STEWARD + DIFFERENT Parties concurrently → both succeed without serializing', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ob1'), await k.party(x, 'ob2', 'GROUP')];
    for (const [kind, object] of [['DATA_ASSET', x.objects.asset], ['DATA_ELEMENT', x.objects.element]] as const) {
      const [qa, qb] = [k.validateProposal(k.keyOf(kind, object, 'DATA_STEWARD', a.partyId), a.stateId),
        k.validateProposal(k.keyOf(kind, object, 'DATA_STEWARD', b.partyId), b.stateId)];
      const [sa, sb] = [await k.submit(x, x.member, `ob-${kind}-a-submit`, qa), await k.submit(x, x.member, `ob-${kind}-b-submit`, qb)];
      const { first, second } = await parallel(k.decideSqlFor(x.rs, x.cmd(`ob-${kind}-a`), sa.proposal_id, qa, 'VALIDATE', null),
        k.decideSqlFor(x.rs2, x.cmd(`ob-${kind}-b`), sb.proposal_id, qb, 'VALIDATE', null));
      assert.deepEqual([json(first.out).outcome, json(second.out).outcome], ['VALIDATED', 'VALIDATED']);
      assert.deepEqual((await activeOf(x.org, kind, object, 'DATA_STEWARD')).sort(), [a.partyId, b.partyId].sort());
    }
  });

  await t.test('same command id concurrently: the waiter replays the ORIGINAL durable result', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'same');
    const q = k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'TECHNICAL_OWNER', p.partyId), p.stateId);
    const s = await k.submit(x, x.member, 'same-submit', q);
    const sql = k.decideSqlFor(x.rs, x.cmd('same'), s.proposal_id, q, 'VALIDATE', null);
    const { first, second } = await race(sql, sql);
    assert.equal(second.err, '', second.err);
    const [a, b] = [json(first.out), json(second.out)];
    assert.deepEqual([a.outcome, a.replay, b.replay, b.fact_state_id, b.recorded_at, b.authorization_decision_id],
      ['VALIDATED', false, true, a.fact_state_id, a.recorded_at, a.authorization_decision_id]);
  });

  await t.test('concurrent terminal decisions on one proposal (VALIDATE vs REJECT): exactly one terminal decision', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'term');
    const q = k.validateProposal(k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_OWNER', p.partyId), p.stateId);
    const s = await k.submit(x, x.member, 'term-submit', q);
    const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('term-v'), s.proposal_id, q, 'VALIDATE', null),
      k.decideSqlFor(x.rs2, x.cmd('term-r'), s.proposal_id, q, 'REJECT', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV010[\s\S]*PROPOSAL_TERMINAL/, second.err);
    assert.equal(await one(`select count(*) from gov_repo.l14_governance_decisions where proposal_id='${s.proposal_id}'`), '1');
  });

  await t.test('eligibility change concurrent with commitment: a role revocation committed first makes the waiting decision a durable DENY', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'elig');
    const q = k.validateProposal(k.keyOf('AGENT', x.objects.agent2, 'BUSINESS_OWNER', p.partyId), p.stateId);
    const s = await k.submit(x, x.member, 'elig-submit', q);
    const { second } = await race(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${x.rs.id}';`,
      k.decideSqlFor(x.rs, x.cmd('elig'), s.proposal_id, q, 'VALIDATE', null), 'postgres');
    const r = json(second.out);
    assert.deepEqual([r.outcome, r.deny_reason, r.fact_state_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decision_roles where authorization_decision_id='${r.authorization_decision_id}'`),
      '0', 'the snapshot holds the CURRENT (now empty) persisted roles');
  });
});
