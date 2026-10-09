import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { lit, named } from '../helpers/m16-governed-write-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { businessContextKit } from '../helpers/m16-l14-business-context-fixtures';
import { policyApplicabilityKit } from '../helpers/m16-l14-policy-applicability-fixtures';

/**
 * M16-S1C.3 — S1C.1 / S1C.1R1 / S1C.2 regression on the S1C.3 catalog (S1C3 horizon). S1C.3 widens the shared fact framework
 * (l14_fact_states subject vocabulary, the command-result fact branch, the fact guard): the first two families must keep their
 * exact behaviour — RESPONSIBILITY single-owner cardinality, O45 steward coexistence, O49 Party invalidation and both Party
 * dependency race orders (S1C.1R1); BUSINESS_CONTEXT supersession, O49 Domain invalidation and both Domain dependency race
 * orders — and the three families never mix. Their own suites keep their own horizons unchanged.
 */
test('M16 S1C.3 keeps S1C.1 / S1C.1R1 / S1C.2 green on the widened fact framework (disposable PG17)', { timeout: 2_400_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C3' });
  t.after(() => c.stop());
  const { owner, rejects } = c;
  const rk = await responsibilityKit(c);
  const bk = await businessContextKit(c);
  const pak = await policyApplicabilityKit(c);
  const one = async (query: string) => lastLine(await owner(query));
  const json = (out: string) => JSON.parse(lastLine(out));
  const ts = (value: string) => `'${value}'::timestamptz`;
  const now = 'clock_timestamp()';
  const monitor = c.session('m16_bootstrap');
  t.after(() => monitor.close());
  type Session = ReturnType<typeof c.session>;
  const pidOf = async (session: Session) => (await session.run('select pg_backend_pid();')).out.trim();
  async function race(first: string, second: string) {
    const s1 = c.session('service_role'), s2 = c.session('service_role');
    try {
      await s1.run('begin;');
      const a = await s1.run(first);
      assert.equal(a.err, '', a.err);
      const [p1, p2] = [await pidOf(s1), await pidOf(s2)];
      const pending = s2.run(second);
      for (let i = 0; ; i++) {
        const state = (await monitor.run(`select coalesce((select wait_event_type from pg_stat_activity where pid=${p2}),'')
          ||':'||(pg_blocking_pids(${p2}) @> array[${p1}])::text;`)).out.trim();
        if (state === 'Lock:true') break;
        assert.ok(i < 1000, 'session never observed blocked by the expected holder');
        await sleep(20);
      }
      await s1.run('commit;');
      return { first: a, second: await pending };
    } finally { await Promise.all([s1.close(), s2.close()]); }
  }

  await t.test('S1C.1: single-owner cardinality race, O45 steward coexistence, O49 Party invalidation unchanged', async () => {
    const x = await rk.setup();
    const [a, b] = [await rk.party(x, 'sa'), await rk.party(x, 'sb', 'GROUP')];
    const [pa, pb] = [rk.validateProposal(rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId), a.stateId),
      rk.validateProposal(rk.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', b.partyId), b.stateId)];
    const [sa, sb] = [await rk.submit(x, x.member, 'sa-submit', pa), await rk.submit(x, x.member, 'sb-submit', pb)];
    const { first, second } = await race(rk.decideSqlFor(x.rs, x.cmd('sa'), sa.proposal_id, pa, 'VALIDATE', null),
      rk.decideSqlFor(x.rs2, x.cmd('sb'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RESPONSIBILITY_SINGLE_OWNER_CONFLICT/, second.err);
    for (const party of [a, b]) {
      assert.equal((await rk.assign(x, `st-${party.partyId.slice(0, 4)}`, rk.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', party.partyId), party))
        .decided.outcome, 'VALIDATED');
    }
    assert.equal((await rk.current(x.org, 'DATA_ELEMENT', x.objects.element)).length, 2, 'O45: two stewards coexist');
    const key = rk.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', a.partyId);
    const held = await rk.assign(x, 'o49', key, a);
    const rows = await rk.stateRows(x.org, held.stateId);
    const beforeRevoke = await one('select clock_timestamp()::text');
    await rk.revokeParty(x, 'o49', a);
    assert.equal(await rk.stateRows(x.org, held.stateId), rows);
    assert.equal(await rk.resolve(x.org, key, now, now), null);
    assert.equal(await rk.resolve(x.org, key, ts(beforeRevoke), ts(beforeRevoke)), held.stateId);
  });

  for (const order of [1, 2] as const) {
    await t.test(`S1C.1R1 Party dependency race order ${order} unchanged on the S1C.3 catalog`, async () => {
      const x = await rk.setup();
      const p = await rk.party(x, `r${order}`);
      const key = rk.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', p.partyId);
      const q = rk.validateProposal(key, p.stateId);
      const s = await rk.submit(x, x.member, `r${order}-submit`, q);
      const rp = rk.pk.revokeProposal(p.partyId, p.stateId);
      const rs = await rk.pk.submit(x as never, x.member, `r${order}-party-rv-submit`, rp);
      const validate = rk.decideSqlFor(x.rs, x.cmd(`r${order}`), s.proposal_id, q, 'VALIDATE', null);
      const revoke = rk.pk.decideSqlFor(x as never, x.steward, x.cmd(`r${order}-party-rv`), rs.proposal_id, rp, 'REVOKE', p.stateId);
      if (order === 1) {
        const { first, second } = await race(revoke, validate);
        assert.equal(json(first.out).outcome, 'REVOKED');
        assert.match(second.err, /GV010[\s\S]*PARTY_DEPENDENCY_NOT_VALID/, second.err);
        assert.equal(await rk.head(x.org, key), null);
      } else {
        const { first, second } = await race(validate, revoke);
        const [a, r] = [json(first.out), json(second.out)];
        assert.deepEqual([a.outcome, r.outcome], ['VALIDATED', 'REVOKED']);
        assert.equal(await rk.resolve(x.org, key, now, now), null);
        assert.equal(await rk.resolve(x.org, key, ts(a.recorded_at), ts(a.recorded_at)), a.fact_state_id);
      }
    });
  }

  await t.test('S1C.2: supersession, O49 Domain invalidation and both Domain dependency race orders unchanged', async () => {
    const x = await bk.setup();
    const [d1, d2] = [await bk.domain(x, 'sup-1'), await bk.domain(x, 'sup-2')];
    const key = bk.keyOf('DATA_ASSET', x.objects.asset, 'BUSINESS_DOMAIN');
    const s1 = await bk.assign(x, 'sup-1', key, d1);
    const s1Rows = await bk.stateRows(x.org, s1.stateId);
    const s2 = await bk.assign(x, 'sup-2', key, d2);
    assert.deepEqual([s2.decided.predecessor_state_id, await bk.head(x.org, key)], [s1.stateId, s2.stateId]);
    assert.equal(await bk.stateRows(x.org, s1.stateId), s1Rows);
    // O49 Domain.
    await bk.revokeDomain(x, 'o49', d2);
    assert.equal(await bk.resolve(x.org, key, now, now), null);
    // Race order 1: the domain revocation holds the exclusive guard; the waiting assignment fails closed.
    const d3 = await bk.domain(x, 'r1');
    const k1 = bk.keyOf('AGENT', x.objects.agent, 'BUSINESS_DOMAIN');
    const p1 = bk.validateProposal(k1, d3);
    const q1 = await bk.submit(x, x.member, 'r1-submit', p1);
    const rv1 = bk.dk.revokeProposal(d3.subject, d3.stateId);
    const rs1 = await bk.dk.submit(x as never, x.member, 'r1-dom-rv-submit', rv1);
    const o1 = await race(bk.dk.decideSqlFor(x.steward, x.cmd('r1-dom-rv'), rs1.proposal_id, rv1, 'REVOKE', d3.stateId),
      bk.decideSqlFor(x.bs, x.cmd('r1'), q1.proposal_id, p1, 'VALIDATE', null));
    assert.match(o1.second.err, /GV010[\s\S]*DOMAIN_DEPENDENCY_NOT_VALID/, o1.second.err);
    // Race order 2: the assignment holds the shared guard; the revocation commits after it and invalidates it.
    const d4 = await bk.domain(x, 'r2', 'INFORMATION_DOMAIN');
    const k2 = bk.keyOf('DATA_ELEMENT', x.objects.element, 'INFORMATION_DOMAIN');
    const p2 = bk.validateProposal(k2, d4);
    const q2 = await bk.submit(x, x.member, 'r2-submit', p2);
    const rv2 = bk.dk.revokeProposal(d4.subject, d4.stateId);
    const rs2 = await bk.dk.submit(x as never, x.member, 'r2-dom-rv-submit', rv2);
    const o2 = await race(bk.decideSqlFor(x.bs, x.cmd('r2'), q2.proposal_id, p2, 'VALIDATE', null),
      bk.dk.decideSqlFor(x.steward, x.cmd('r2-dom-rv'), rs2.proposal_id, rv2, 'REVOKE', d4.stateId));
    assert.deepEqual([json(o2.first.out).outcome, json(o2.second.out).outcome], ['VALIDATED', 'REVOKED']);
    assert.equal(await bk.resolve(x.org, k2, now, now), null);
  });

  await t.test('the three families never mix; the widened guard still refuses the two unimplemented families', async () => {
    const x = await pak.setup();
    const pin = await pak.policy(x, 'mix');
    await pak.apply(x, 'mix', pak.objectTarget('AGENT', x.objects.byKind.AGENT), pin);
    for (const [detail, subject] of [['l14_responsibility_assignment_states', 'RESPONSIBILITY_ASSIGNMENT'],
      ['l14_business_context_assignment_states', 'BUSINESS_CONTEXT_ASSIGNMENT'], ['l14_policy_applicability_states', 'POLICY_APPLICABILITY']] as const) {
      assert.equal(await one(`select count(*) from gov_repo.l14_fact_states f join gov_repo.${detail} d
        on d.organisation_id=f.organisation_id and d.fact_state_id=f.fact_state_id where f.subject_kind<>'${subject}'`), '0', detail);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states f where subject_kind='POLICY_APPLICABILITY' and not exists
      (select 1 from gov_repo.l14_policy_applicability_states d where d.organisation_id=f.organisation_id and d.fact_state_id=f.fact_state_id)`), '0');
    for (const family of ['CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT']) {
      await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
        select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), '${family}', array['KEY','x']); rollback;`), /GUARD_KEY_INVALID/, family);
      await assert.rejects(c.bootstrapSql(`begin; set local role postgres; insert into gov_repo.l14_fact_states(organisation_id,fact_state_id,subject_kind,
        state_kind,effective_from,recorded_at,governance_decision_id,authorization_decision_id,authority_policy_id,authority_policy_version_id,
        authority_policy_content_hash,trust_state,source_class,support_status) values ('${x.org}',gen_random_uuid(),'${family}','VALIDATED',now(),now(),
        gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),'VALIDATED','LOCAL_HUMAN','NONE'); rollback;`),
      /l14_fact_states_subject_kind_check/, family);
    }
    // The generic S1A proposal RPC still refuses every fact family (only the typed S1C RPCs write them).
    await rejects(c.svc(`select * from gov_repo.l14_submit_proposal_v1(${named({ ...c.principal(x.member), p_command_id: lit(x.cmd('generic')),
      p_subject_kind: `'POLICY_APPLICABILITY'`, p_intent: `'VALIDATE'`, p_source_class: `'LOCAL_HUMAN'`, p_authority_policy_id: 'null::uuid',
      p_version_id: 'null::uuid', p_content_hash: 'null::text', p_requested_effective_from: 'null::timestamptz', p_target_state_id: 'null::uuid',
      p_prior_proposal_id: 'null::uuid', p_support_status: `'NONE'`, p_support_evidence_ids: `'{}'::text[]`, p_caller_fingerprint: `repeat('a',64)` })})`),
    'GV010', /SUBJECT_KIND_NOT_EXECUTABLE/);
  });
});
