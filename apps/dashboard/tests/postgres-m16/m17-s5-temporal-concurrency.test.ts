import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { m17s5Kit, NONE } from '../helpers/m17-s5-fixtures';

test('M17-S5 exact temporal coordinates and real transaction concurrency (PG17)', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S5' });
  t.after(() => c.stop());
  const k = await m17s5Kit(c), x = await k.setup(), r = await k.risk(x, 'temporal-risk');
  let n = 0;
  const name = () => `tc-${++n}`;
  const fresh = (over = {}) => k.proposal(x, r.stateId, { treatmentOrdinalKey: name(), ...over });
  const monitor = c.session('m16_bootstrap');
  t.after(() => monitor.close());
  const json = (s: string) => JSON.parse(lastLine(s));
  async function race(first: string, second: string, role: 'service_role' | 'postgres' = 'service_role') {
    const a = c.session(role), b = c.session('service_role');
    try {
      await a.run('begin;');
      const ra = await a.run(first);
      assert.equal(ra.err, '', ra.err);
      const apid = (await a.run('select pg_backend_pid();')).out.trim(), bpid = (await b.run('select pg_backend_pid();')).out.trim();
      assert.match(apid, /^\d+$/);
      assert.match(bpid, /^\d+$/);
      const pending = b.run(second);
      let blocked = false;
      for (let i = 0; i < 150; i++) {
        const seen = await monitor.run(`select wait_event_type||':'||(pg_blocking_pids(${bpid}) @> array[${apid}])::text from pg_stat_activity where pid=${bpid};`);
        assert.equal(seen.err, '', seen.err);
        if (seen.out.trim() === 'Lock:true') { blocked = true; break; }
        await sleep(10);
      }
      assert.ok(blocked, 'observed PostgreSQL lock wait and exact blocking backend');
      const commit = await a.run('commit;');
      assert.equal(commit.err, '', commit.err);
      return { first: ra, second: await pending };
    } finally { await Promise.all([a.close(), b.close()]); }
  }
  await t.test('future successor preserves present; exact boundary and recorded cutoff select predecessor/successor', async () => {
    const p = fresh(), root = await k.treat(x, name(), p), before = await k.instant('0 seconds');
    const future = await k.instant('1 day'), after = await k.instant('2 days');
    const next = { ...p, expectedCurrentStateId: root.stateId, implementationStatus: 'IMPLEMENTED' as const, requestedEffectiveFrom: future };
    const successor = await k.treat(x, name(), next, k.evidence(x), x.flex);
    assert.equal((await k.read(x.member, p)).current_state.state_id, root.stateId);
    assert.equal((await k.read(x.member, p, future, after)).current_state.state_id, successor.stateId);
    assert.equal((await k.read(x.member, p, future, before)).current_state.state_id, root.stateId);
    const predecessor = await k.json(`select to_json(s) from gov_repo.l15_risk_treatment_states s where state_id='${root.stateId}'`);
    assert.equal(predecessor.effective_to, null);
  });
  await t.test('future REVOKE is visible only at its effective boundary and its recorded cutoff', async () => {
    const p = fresh(), root = await k.treat(x, name(), p), before = await k.instant('0 seconds');
    const from = await k.instant('2 days'), rev = { ...k.revocation(p, root.stateId), requestedEffectiveFrom: from };
    const submitted = await k.submit(x, name(), rev);
    await k.decide(x, name(), submitted, rev, { outcome: 'REVOKE' }, x.flex);
    assert.equal((await k.read(x.member, p)).treatment_status, 'PLANNED');
    assert.equal((await k.read(x.member, p, from)).resolution, 'REVOKED');
    assert.equal((await k.read(x.member, p, from, before)).treatment_status, 'PLANNED');
  });
  await t.test('optional effective end is half-open, target date is not the end', async () => {
    const end = await k.instant('1 day'), p = fresh({ requestedEffectiveTo: end, targetImplementationDate: '2000-01-01' });
    await k.treat(x, name(), p);
    assert.equal((await k.read(x.member, p)).treatment_status, 'PLANNED');
    assert.equal((await k.read(x.member, p, end)).resolution, 'EXPIRED');
    const priorMicro = await k.one(`select gov_repo.l14_canonical_instant_v1('${end}'::timestamptz-interval '1 microsecond')`);
    assert.equal((await k.read(x.member, p, priorMicro)).treatment_status, 'PLANNED');
  });
  await t.test('backdating needs policy and cannot precede predecessor; later recorded correction stays out of earlier cutoff', async () => {
    const p = fresh(), root = await k.treat(x, name(), p), before = await k.instant('0 seconds');
    const next = { ...p, expectedCurrentStateId: root.stateId, implementationStatus: 'IMPLEMENTED' as const, requestedEffectiveFrom: before };
    const s = await k.submit(x, name(), next);
    assert.equal((await k.decide(x, name(), s, next, { support: k.evidence(x) })).outcome, 'DENIED');
    const result = await k.decide(x, name(), s, next, { support: k.evidence(x) }, x.flex);
    assert.equal(result.outcome, 'VALIDATED');
    assert.equal((await k.read(x.member, p, before, before)).current_state.state_id, root.stateId);
    assert.equal((await k.read(x.member, p, before)).current_state.state_id, result.state_id);
    const rootFrom = await k.one(`select gov_repo.l14_canonical_instant_v1('${root.decided.effective_from}'::timestamptz)`);
    const invalid = { ...next, expectedCurrentStateId: result.state_id, requestedEffectiveFrom: rootFrom };
    const invalidS = await k.submit(x, name(), invalid);
    await assert.rejects(k.decide(x, name(), invalidS, invalid, { support: k.evidence(x) }, x.flex), /SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE/);
  });
  await t.test('concurrent first decisions: exactly one state, stale loser consumes nothing', async () => {
    const p = fresh(), a = await k.submit(x, name(), p), b = await k.submit(x, name(), p);
    const cmdB = x.cmd(name());
    const out = await race(k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: a.proposal_id, proposal: p }),
      k.decideSql(x.treatment, { commandId: cmdB, proposalId: b.proposal_id, proposal: p }));
    assert.equal(json(out.first.out).outcome, 'VALIDATED');
    assert.match(out.second.err, /GV009/);
    assert.equal(await k.one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${cmdB}'`), '0');
  });
  await t.test('concurrent successors never fork', async () => {
    const p = fresh(), root = await k.treat(x, name(), p), next = { ...p, expectedCurrentStateId: root.stateId, implementationStatus: 'IMPLEMENTED' as const };
    const a = await k.submit(x, name(), next), b = await k.submit(x, name(), next);
    const out = await race(k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: a.proposal_id, proposal: next, support: k.evidence(x) }),
      k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: b.proposal_id, proposal: next, support: k.evidence(x) }));
    assert.equal(json(out.first.out).outcome, 'VALIDATED');
    assert.match(out.second.err, /GV009/);
    assert.equal(await k.one(`select count(*) from gov_repo.l15_risk_treatment_states where predecessor_state_id='${root.stateId}'`), '1');
  });
  await t.test('concurrent identical command returns exact original result', async () => {
    const p = fresh(), s = await k.submit(x, name(), p), command = k.decideSql(x.treatment, { commandId: x.cmd(name()), proposalId: s.proposal_id, proposal: p });
    const out = await race(command, command);
    assert.equal(out.second.err, '');
    assert.deepEqual(json(out.second.out), { ...json(out.first.out), replay: true });
  });
  await t.test('distinct ordinal keys do not share treatment guard', async () => {
    const p = fresh(), q = fresh(), s = await k.submit(x, name(), q), holder = c.session('postgres');
    try {
      await holder.run(`begin; select gov_repo.l15_lock_risk_treatment_key_guard_v1('${x.org}','${p.governedRiskStateId}','${p.treatmentOption}','${p.treatmentOrdinalKey}');`);
      assert.equal((await k.decide(x, name(), s, q)).outcome, 'VALIDATED');
      await holder.run('rollback;');
    } finally { await holder.close(); }
  });
  for (const dependency of ['party','control','risk'] as const) await t.test(`${dependency} revocation committed first blocks and invalidates VALIDATE without partial result`, async () => {
    // A dedicated party/risk isolates each dependency race.
    const y = await k.setup(), risk = await k.risk(y, name()), ctrl = await k.control(y, name());
    const p = k.proposal(y, risk.stateId, { controlDefinitionVersionIds: [ctrl.versionId] }), s = await k.submit(y, name(), p);
    let first: string;
    if (dependency === 'party') {
      const rp = k.pk.revokeProposal(y.responsible.partyId, y.responsible.decided.registry_state_id, 'PERSON');
      const rs = await k.pk.submit(y.party as never, y.member, name(), rp);
      first = k.pk.decideSql(y.party.steward, { commandId: y.cmd(name()), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE', expected: y.responsible.decided.registry_state_id });
    } else if (dependency === 'control') {
      const rp = k.ck.revokeProposal(ctrl.version, ctrl.stateId);
      const rs = await k.ck.submit(y.control as never, y.member, name(), rp);
      first = k.ck.decideSqlFor(y.control.steward, y.cmd(name()), rs.proposal_id, rp, 'REVOKE', ctrl.stateId);
    } else {
      const rp = k.k3.proposalOf(risk.subject, risk.scen, { intent: 'REVOKE', targetStateId: risk.stateId, expectedCurrentStateId: risk.stateId, closureReason: 'RISK_NO_LONGER_APPLICABLE' });
      const rs = await k.k3.submit(y, name(), rp);
      first = k.k3.decideSql(y.validator, { commandId: y.cmd(name()), proposalId: rs.proposal_id, proposal: rp, outcome: 'REVOKE' });
    }
    const out = await race(first, k.decideSql(y.treatment, { commandId: y.cmd(name()), proposalId: s.proposal_id, proposal: p }));
    assert.equal(json(out.first.out).outcome, 'REVOKED');
    assert.match(out.second.err, /DEPENDENCY_NOT_VALID/);
    assert.equal((await k.read(y.member, p)).resolution, 'NO_STATE');
  });
});
