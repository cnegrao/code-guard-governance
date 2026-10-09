import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';

/**
 * M16-S1C.2 — S1C.1 RESPONSIBILITY_ASSIGNMENT regression on the S1C.2 catalog (S1C2 horizon). S1C.2 widens the shared fact
 * framework (l14_fact_states subject vocabulary, the command-result fact branch, the fact guard): the first family must keep
 * its exact behaviour — legal / illegal matrix, single-owner cardinality under real concurrency, O45 steward coexistence,
 * O49 Party invalidation, explicit effective_to — and the two families never mix. The S1C.1 suites themselves keep their own
 * S1C1 horizon unchanged.
 */
test('M16 S1C.2 keeps S1C.1 responsibility assignment green on the widened fact framework (disposable PG17)', { timeout: 1_800_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'S1C2' });
  t.after(() => c.stop());
  const { owner, rejects } = c;
  const k = await responsibilityKit(c);
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

  await t.test('legal / illegal matrix, steward coexistence, revoke and resolver are unchanged', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'ra'), await k.party(x, 'rb', 'GROUP')];
    for (const [kind, object, role] of [['AGENT', 'agent', 'BUSINESS_OWNER'], ['AGENT', 'agent', 'TECHNICAL_OWNER'],
      ['DATA_ASSET', 'asset', 'DATA_OWNER'], ['DATA_ELEMENT', 'element', 'DATA_STEWARD']] as const) {
      const r = await k.assign(x, `legal-${kind}-${role}`, k.keyOf(kind, x.objects[object], role, a.partyId), a);
      assert.equal(r.decided.outcome, 'VALIDATED');
      assert.equal(await k.resolve(x.org, r.proposal, now, now), r.stateId);
    }
    await rejects(c.svc(k.submitSql(x.member, { commandId: x.cmd('illegal'), fingerprint: 'a'.repeat(64),
      proposal: k.validateProposal(k.keyOf('AGENT_VERSION' as never, x.objects.agentVersion, 'BUSINESS_OWNER', a.partyId), a.stateId) })),
    'GV010', /RESPONSIBILITY_TARGET_KIND_ILLEGAL/);
    const st = await k.assign(x, 'steward-b', k.keyOf('DATA_ELEMENT', x.objects.element, 'DATA_STEWARD', b.partyId), b);
    assert.equal(st.decided.outcome, 'VALIDATED');
    assert.equal((await k.current(x.org, 'DATA_ELEMENT', x.objects.element)).length, 2, 'two stewards coexist');
    const key = k.keyOf('DATA_ASSET', x.objects.asset, 'DATA_OWNER', a.partyId);
    const head = await k.head(x.org, key);
    const rv = await k.revoke(x, 'rv', key, a.stateId, head!);
    assert.equal(rv.decided.outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, key, now, now), null);
  });

  await t.test('single-owner race on the widened guard: exactly one Party wins, the loser GV009, nothing consumed', async () => {
    const x = await k.setup();
    const [a, b] = [await k.party(x, 'sa'), await k.party(x, 'sb')];
    const [pa, pb] = [k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', a.partyId), a.stateId),
      k.validateProposal(k.keyOf('AGENT', x.objects.agent, 'BUSINESS_OWNER', b.partyId), b.stateId)];
    const [sa, sb] = [await k.submit(x, x.member, 'sa-submit', pa), await k.submit(x, x.member, 'sb-submit', pb)];
    const before = await k.counts(x.org);
    const { first, second } = await race(k.decideSqlFor(x.rs, x.cmd('sa'), sa.proposal_id, pa, 'VALIDATE', null),
      k.decideSqlFor(x.rs2, x.cmd('sb'), sb.proposal_id, pb, 'VALIDATE', null));
    assert.equal(json(first.out).outcome, 'VALIDATED');
    assert.match(second.err, /GV009[\s\S]*RESPONSIBILITY_SINGLE_OWNER_CONFLICT/, second.err);
    const after = await k.counts(x.org);
    assert.equal(after.l14_fact_states, before.l14_fact_states + 1);
    assert.equal(after.l14_command_results, before.l14_command_results + 1);
  });

  await t.test('O49 Party invalidation and explicit effective_to behave exactly as in S1C.1', async () => {
    const x = await k.setup();
    const p = await k.party(x, 'o49');
    const key = k.keyOf('DATA_ASSET', x.objects.asset2, 'DATA_OWNER', p.partyId);
    const a = await k.assign(x, 'o49', key, p);
    const rows = await k.stateRows(x.org, a.stateId);
    const beforeRevoke = await one('select clock_timestamp()::text');
    await k.revokeParty(x, 'o49', p);
    assert.equal(await k.stateRows(x.org, a.stateId), rows);
    assert.equal(await k.resolve(x.org, key, now, now), null);
    assert.equal(await k.resolve(x.org, key, ts(beforeRevoke), ts(beforeRevoke)), a.stateId);
    const p2 = await k.revalidateParty(x, 'o49', p);
    assert.equal(await k.resolve(x.org, key, now, now), null, 'no silent repin');
    assert.notEqual(p2.stateId, p.stateId);
    const e = await k.party(x, 'et', 'PERSON', await k.instant('-2 hours'));
    const ekey = k.keyOf('AGENT', x.objects.agent2, 'TECHNICAL_OWNER', e.partyId);
    const expired = await k.assign(x, 'et', ekey, e, { from: await k.instant('-90 minutes'), to: await k.instant('-30 minutes') });
    assert.equal(expired.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, ekey, now, now), null, 'expired without UPDATE');
    assert.equal(await k.resolve(x.org, ekey, ts(await k.instant('-60 minutes')), now), expired.stateId);
  });

  await t.test('the two fact families never mix in the shared envelope; the widened guard still refuses unimplemented families', async () => {
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states f join gov_repo.l14_responsibility_assignment_states r
      on r.organisation_id=f.organisation_id and r.fact_state_id=f.fact_state_id where f.subject_kind<>'RESPONSIBILITY_ASSIGNMENT'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states where subject_kind='BUSINESS_CONTEXT_ASSIGNMENT'`), '0',
      'responsibility commands never produce business context');
    for (const family of ['POLICY_APPLICABILITY', 'CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT']) {
      await assert.rejects(c.bootstrapSql(`begin; set local role postgres;
        select gov_repo.l14_lock_fact_subject_guard_v1(gen_random_uuid(), '${family}', array['KEY','x']); rollback;`), /GUARD_KEY_INVALID/, family);
    }
  });
});
