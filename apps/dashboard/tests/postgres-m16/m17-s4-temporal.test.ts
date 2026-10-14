import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX } from '@council/canonical-contracts';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { BOGUS, NON_MONOTONE_CELLS, m17s4Kit, matrixMethodology } from '../helpers/m17-s4-fixtures';

/**
 * M17-S4 — temporal semantics, validity / expiry, exact currentness, no transfer and UNKNOWN vs INSUFFICIENT_EVIDENCE on real
 * disposable PostgreSQL 17 (M17S4 horizon). ADR-GOVIA-RISK-INTELLIGENCE-v1 §§10.1, 10.2(4), 17, 18 — O34, O35, O36 and attacks
 * 38-42, 59, 62-65 (+ the M16 §17 temporal rules verbatim: DB recorded_at, IMMEDIATE, BACKDATED / FUTURE_DATED only with the
 * rule flag, no skew tolerance, future-effective successors / revocations never hide early, later-recorded events never leak
 * into earlier cutoffs).
 */
const OP = L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL;
const OP_TOKENS = [...OP.objects, ...OP.relationships.map(r => `REL:${r}`)];

test('M17-S4 temporal / expiry / currentness / no transfer / UNKNOWN (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S4' });
  t.after(() => c.stop());
  const { exec, rejects } = c;
  const k = await m17s4Kit(c);
  const x = await k.setup();
  const one = k.one;
  let seq = 0;
  const nm = (p: string) => `${p}-${++seq}`;
  const ts = (v: string) => `'${v}'::timestamptz`;
  // Past-anchored dependencies: scenario / methodology validated (dating rules) four days ago, so assessments may be BACKDATED.
  const past4 = await k.instant('-4 days');
  const m = await k.methodology(x, 'tm', matrixMethodology(), { from: past4 });
  const subjects = [...OP.objects.map(kind => objectSubject(kind, x.objects[kind]!)), ...OP.relationships.map(r => relSubject(x.rels[r]!))];
  let pool = await k.k3.scenario(x, 'tpool-0', 'OPERATIONAL', OP_TOKENS, { from: past4 });
  let next = 0;
  /** A fresh VALIDATED GOVERNED_RISK state (new logical key), effective from `fromOffset` (BACKDATED by the S3 dating rule). */
  const freshRisk = async (fromOffset: string | null = '-3 days') => {
    if (next === subjects.length) { pool = await k.k3.scenario(x, nm('tpool'), 'OPERATIONAL', OP_TOKENS, { from: past4 }); next = 0; }
    const subject = subjects[next++]!;
    const v = await k.k3.validateRisk(x, nm('tgr'), subject, pool,
      { over: { requestedEffectiveFrom: fromOffset ? await k.instant(fromOffset) : null } });
    return { stateId: v.stateId, subject, scen: pool, decided: v.decided };
  };
  const canonical = (expr: string) => one(`select to_char((${expr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('M16 §17: DB-authored recorded_at; omitted effective_from = the DB transaction instant; BACKDATED / FUTURE_DATED only with the rule flag; no skew tolerance', async () => {
    const r = await freshRisk();
    const a = await k.assess(x, nm('imm'), k.rated(r.stateId, m, 'L1', 'I1', await k.instant('10 days')));
    assert.equal(a.decided.effective_from, a.decided.recorded_at, 'IMMEDIATE = the decision instant');
    for (const [offset, label] of [['-1 day', 'BACKDATED'], ['-1 second', 'BACKDATED (no skew tolerance)'], ['1 hour', 'FUTURE_DATED']] as const) {
      const rr = await freshRisk();
      const from = await k.instant(offset);
      const p = k.rated(rr.stateId, m, 'L2', 'I1', await k.instant('10 days'), { requestedEffectiveFrom: from });
      const sub = await k.submit(x, nm('dt'), p);
      const denied = await exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('dt-n')), proposalId: sub.proposal_id, proposal: p }));
      assert.deepEqual([denied.outcome, denied.deny_reason], ['DENIED', 'TEMPORAL_ACTION_NOT_AUTHORIZED'], label);
      const ok = await exec(k.decideSql(x.raDater, { commandId: x.cmd(nm('dt-ok')), proposalId: sub.proposal_id, proposal: p }));
      assert.equal(ok.outcome, 'VALIDATED', label);
      assert.equal(await canonical(`'${ok.effective_from}'::timestamptz`), from, 'the explicit instant is kept exactly');
      assert.notEqual(ok.effective_from, ok.recorded_at);
    }
  });

  await t.test('O34 / attacks 38-41: valid_until > effective_from and <= effective_from + the PINNED maximum (UTC calendar); exactly the maximum is accepted', async () => {
    const mMonth = await k.methodology(x, 'tm-month', matrixMethodology(undefined, { months: 1, days: 0, microseconds: 0 }), { from: past4 });
    const r = await freshRisk();
    const from = await k.instant('-1 day');
    const limit = await canonical(`gov_repo.l15_assessment_validity_limit_v1('${from}'::timestamptz, '1 month')`);
    assert.equal(limit, await canonical(`(('${from}'::timestamptz at time zone 'UTC') + interval '1 month') at time zone 'UTC'`));
    const p = (until: string) => k.rated(r.stateId, mMonth, 'L1', 'I1', until, { requestedEffectiveFrom: from });
    const n0 = await k.counts(x.org);
    // 38 valid_until = effective_from; 39 valid_until < effective_from (shape refusal, before any read)
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('b38')), proposal: p(from), fingerprint: BOGUS })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('b39')), proposal: p(await k.instant('-2 days')), fingerprint: BOGUS })), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    // 40 one microsecond beyond the maximum
    const beyond = await canonical(`'${limit}'::timestamptz + interval '1 microsecond'`);
    await rejects(k.submit(x, nm('b40'), p(beyond)), 'GV010', /VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM/);
    // A maximum is the PINNED version's: the 90-day methodology admits more than the 1-month one would.
    assert.deepEqual(await k.counts(x.org), n0);
    // 41 exactly the maximum: accepted
    const exact = await k.assess(x, nm('b41'), p(limit));
    assert.equal(exact.decided.outcome, 'VALIDATED');
    assert.equal(await canonical(`'${exact.decided.valid_until}'::timestamptz`), limit);
    // IMMEDIATE: the start is fixed only by the decision, which re-checks the maximum authoritatively (nothing consumed).
    const r2 = await freshRisk();
    const tooLong = k.rated(r2.stateId, mMonth, 'L1', 'I1', await k.instant('1 month 1 day'));
    const sub = await k.submit(x, nm('imm-long'), tooLong);
    const c0 = await k.raCounts(x.org);
    await rejects(k.decide(x, nm('imm-long'), sub, tooLong), 'GV010', /VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM/);
    assert.deepEqual(await k.raCounts(x.org), c0);
    // IMMEDIATE with a valid_until already in the past: shape-valid (no explicit start), refused against the DB instant.
    await rejects(k.submit(x, nm('imm-past'), k.rated(r2.stateId, mMonth, 'L1', 'I1', await k.instant('-1 minute'))), 'GV010', /EFFECTIVE_INTERVAL_INVALID/);
    // The bound never depends on the session TimeZone (DST): computed in UTC, not as local wall-clock arithmetic.
    const dst = await one(`begin; set local timezone = 'Europe/Lisbon';
      select gov_repo.l15_assessment_validity_limit_v1('2026-03-28T12:00:00Z'::timestamptz, '1 day')::text || '|'
        || ('2026-03-28T12:00:00Z'::timestamptz + interval '1 day')::text; commit;`);
    const [utc, local] = dst.split('|');
    assert.equal(await canonical(`'${utc}'::timestamptz`), '2026-03-29T12:00:00.000000Z');
    assert.notEqual(await canonical(`'${local}'::timestamptz`), '2026-03-29T12:00:00.000000Z', 'local wall-clock arithmetic would differ across DST');
  });

  await t.test('O34 / attack 42: at exactly valid_until the assessment is NOT current; no UPDATE, no state transition, no cron; renewal is a new governed state', async () => {
    const r = await freshRisk('-3 days');
    const from = await k.instant('-2 days'), until = await k.instant('-1 day');
    const a = await k.assess(x, nm('exp'), k.rated(r.stateId, m, 'L3', 'I3', until, { requestedEffectiveFrom: from }));
    assert.equal(a.decided.outcome, 'VALIDATED');
    const row = await k.stateRow(x.org, a.stateId);
    const counts = await k.counts(x.org);
    assert.equal(await k.resolve(x.org, r.stateId, `${ts(until)} - interval '1 microsecond'`), a.stateId, 'current until the last microsecond');
    assert.equal(await k.resolve(x.org, r.stateId, ts(until)), null, 'half-open: not current AT valid_until');
    assert.equal(await k.resolve(x.org, r.stateId), null);
    assert.deepEqual(await k.resolution(x.org, r.stateId, ts(until)), { resolution: 'EXPIRED', state_id: a.stateId, state_kind: 'VALIDATED' });
    const read = await k.read(x.member, r.stateId);
    assert.deepEqual([read.assessment_status, read.resolution, read.rating_band, read.state_id], ['UNKNOWN', 'EXPIRED', null, null]);
    assert.equal(await k.stateRow(x.org, a.stateId), row, 'the expired row is byte-identical');
    assert.deepEqual(await k.counts(x.org), counts, 'expiry wrote nothing (no REVOKED, no head move, no result)');
    // An expired assessment cannot be REVOKEd (GV011, nothing consumed); renewal is an explicit successor.
    const rp = k.revocation(r.stateId, m, a.stateId);
    const rs = await k.submit(x, nm('exp-rv'), rp);
    const c0 = await k.raCounts(x.org);
    await rejects(k.decide(x, nm('exp-rv'), rs, rp, { outcome: 'REVOKE' }), 'GV011', /REVOKE_AFTER_TARGET_EXPIRY/);
    assert.deepEqual(await k.raCounts(x.org), c0);
    const renewed = await k.assess(x, nm('exp-new'), k.rated(r.stateId, m, 'L3', 'I3', await k.instant('10 days'), { expectedCurrentStateId: a.stateId }));
    assert.deepEqual([renewed.decided.outcome, renewed.decided.predecessor_state_id], ['VALIDATED', a.stateId]);
    assert.equal(await k.resolve(x.org, r.stateId), renewed.stateId);
    assert.equal(await k.stateRow(x.org, a.stateId), row);
  });

  await t.test('future-effective successor / REVOKE never hide early; later-recorded events never leak into earlier cutoffs; continuity (GV011)', async () => {
    const r = await freshRisk();
    const a1 = await k.assess(x, nm('fut'), k.rated(r.stateId, m, 'L1', 'I3', await k.instant('20 days')));
    const t1 = await k.instant('0 seconds');
    const plus1h = await k.instant('1 hour');
    const rv = await k.revokeAssessment(x, nm('fut-rv'), r.stateId, m, a1.stateId, { from: plus1h });
    assert.equal(rv.decided.outcome, 'REVOKED');
    assert.equal(await k.resolve(x.org, r.stateId), a1.stateId, 'still current until the future revocation instant');
    assert.equal(await k.resolve(x.org, r.stateId, ts(plus1h)), null);
    assert.deepEqual((await k.resolution(x.org, r.stateId, ts(plus1h))).resolution, 'REVOKED');
    // Bitemporal: at a cutoff before the revocation was recorded, the later instant still shows the assessment.
    assert.equal(await k.resolve(x.org, r.stateId, ts(plus1h), ts(t1)), a1.stateId);
    // Before the assessment was recorded, nothing is visible.
    assert.equal(await k.resolve(x.org, r.stateId, 'clock_timestamp()', `${ts(a1.decided.recorded_at)} - interval '1 microsecond'`), null);
    // A future-dated renewal / correction never hides its predecessor early.
    const r2 = await freshRisk();
    const b1 = await k.assess(x, nm('fut2'), k.rated(r2.stateId, m, 'L2', 'I2', await k.instant('20 days')));
    const b2 = await k.assess(x, nm('fut2b'), k.rated(r2.stateId, m, 'L4', 'I1', await k.instant('21 days'),
      { expectedCurrentStateId: b1.stateId, requestedEffectiveFrom: plus1h }));
    assert.equal(await k.resolve(x.org, r2.stateId), b1.stateId);
    assert.equal(await k.resolve(x.org, r2.stateId, `${ts(plus1h)} + interval '1 second'`), b2.stateId);
    // Continuity: a successor never starts before its predecessor; a REVOKE never precedes its target's start; a re-validation
    // never overlaps the revoked interval.
    const r3 = await freshRisk();
    const plus2h = await k.instant('2 hours');
    const c1 = await k.assess(x, nm('cont'), k.rated(r3.stateId, m, 'L1', 'I1', await k.instant('20 days'), { requestedEffectiveFrom: plus2h }));
    const early = k.rated(r3.stateId, m, 'L2', 'I1', await k.instant('20 days'), { requestedEffectiveFrom: plus1h, expectedCurrentStateId: c1.stateId });
    const es = await k.submit(x, nm('cont-e'), early);
    await rejects(k.decide(x, nm('cont-e'), es, early, {}, x.raDater), 'GV011', /SUCCESSOR_BEFORE_PREDECESSOR_EFFECTIVE/);
    const rvEarly = k.revocation(r3.stateId, m, c1.stateId);
    const rs = await k.submit(x, nm('cont-r'), rvEarly);
    await rejects(k.decide(x, nm('cont-r'), rs, rvEarly, { outcome: 'REVOKE' }), 'GV011', /REVOKE_BEFORE_TARGET_EFFECTIVE/);
    const r4 = await freshRisk();
    const d1 = await k.assess(x, nm('reval'), k.rated(r4.stateId, m, 'L1', 'I1', await k.instant('20 days')));
    const d2 = await k.revokeAssessment(x, nm('reval-rv'), r4.stateId, m, d1.stateId);
    const back = k.rated(r4.stateId, m, 'L1', 'I1', await k.instant('20 days'), { requestedEffectiveFrom: await k.instant('-1 hour'),
      expectedCurrentStateId: d2.stateId });
    const bs = await k.submit(x, nm('reval-b'), back);
    await rejects(k.decide(x, nm('reval-b'), bs, back, {}, x.raDater), 'GV011', /REVALIDATION_OVERLAPS_PRIOR_INTERVAL/);
    const again = await k.assess(x, nm('reval-ok'), k.rated(r4.stateId, m, 'L1', 'I1', await k.instant('20 days'), { expectedCurrentStateId: d2.stateId }));
    assert.equal(again.decided.predecessor_state_id, d2.stateId);
    assert.equal(await k.resolve(x.org, r4.stateId), again.stateId);
  });

  await t.test('O35 / attacks 59, 62-63: an assessment NEVER transfers to a successor GOVERNED_RISK state; risk supersession / REVOKE / scenario REVOKE invalidate without mutation', async () => {
    const scen = await k.k3.scenario(x, nm('o35'), 'OPERATIONAL', ['AGENT_VERSION']);
    const subject = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION_2!);
    const r1 = await k.k3.validateRisk(x, nm('o35-r1'), subject, scen);
    const support = { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } as const;
    const a1 = await k.assess(x, nm('o35-a1'), k.rated(r1.stateId, m, 'L1', 'I2', await k.instant('20 days')), { support, decideSupport: support });
    const row = await k.stateRow(x.org, a1.stateId);
    const t0 = await k.instant('0 seconds');
    // The GOVERNED_RISK lineage advances to R2 (an authorized repin: same subject, same scenario definition id, same domain).
    const succ = await k.k3.scenarioSuccessor(x, nm('o35-v2'), scen, 'OPERATIONAL', ['AGENT_VERSION']);
    const r2 = await k.k3.validateRisk(x, nm('o35-r2'), subject, succ, { over: { expectedCurrentStateId: r1.stateId } });
    assert.equal(r2.decided.predecessor_state_id, r1.stateId);
    assert.equal(await k.stateRow(x.org, a1.stateId), row, 'the assessment row is byte-identical');
    assert.equal(await k.resolve(x.org, r1.stateId), null, 'R1 is no longer current, so neither is A1');
    assert.deepEqual(await k.resolution(x.org, r1.stateId), { resolution: 'GOVERNED_RISK_DEPENDENCY_INVALID', state_id: a1.stateId, state_kind: 'VALIDATED' });
    // R2 has NO assessment: UNKNOWN (never inherited, never copied, never LOW), even one millisecond after A1 was current.
    const read2 = await k.read(x.member, r2.stateId);
    assert.deepEqual([read2.assessment_status, read2.resolution, read2.state_id, read2.rating_band, read2.likelihood_level_code, read2.impact_level_code],
      ['UNKNOWN', 'NO_STATE', null, null, null, null]);
    assert.equal(await k.head(x.org, r2.stateId), null);
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where governed_risk_state_id='${r2.stateId}'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_proposals where governed_risk_state_id='${r2.stateId}'`), '0', 'no automatic proposal');
    // Historical as-of before the supersession still resolves A1 exactly.
    assert.equal(await k.resolve(x.org, r1.stateId, ts(t0), ts(t0)), a1.stateId);
    // A1's key cannot be re-assessed now (R1 not current); R2 is assessed independently from expected-none.
    await rejects(k.submit(x, nm('o35-again'), k.rated(r1.stateId, m, 'L1', 'I2', await k.instant('20 days'), { expectedCurrentStateId: a1.stateId })),
      'GV010', /GOVERNED_RISK_STATE_NOT_CURRENT/);
    const a2 = await k.assess(x, nm('o35-a2'), k.rated(r2.stateId, m, 'L2', 'I2', await k.instant('20 days')));
    assert.deepEqual([a2.decided.predecessor_state_id, a2.decided.rating_band], [null, NON_MONOTONE_CELLS['L2:I2']]);
    assert.equal(await k.resolve(x.org, r2.stateId), a2.stateId);
    assert.equal(await k.resolve(x.org, r1.stateId), null);
    // 62. GOVERNED_RISK REVOKE: the pinned assessment becomes not current; row byte-identical; history before the REVOKE resolves.
    const r3 = await freshRisk(null);
    const a3 = await k.assess(x, nm('o35-a3'), k.insufficient(r3.stateId, m, await k.instant('20 days')));
    const row3 = await k.stateRow(x.org, a3.stateId);
    const t3 = await k.instant('0 seconds');
    const tomb = await k.k3.revokeRisk(x, nm('o35-rr'), r3.subject, r3.scen, r3.stateId);
    assert.equal(await k.stateRow(x.org, a3.stateId), row3);
    assert.equal(await k.resolve(x.org, r3.stateId), null);
    assert.deepEqual((await k.read(x.member, r3.stateId)).resolution, 'GOVERNED_RISK_DEPENDENCY_INVALID');
    assert.equal(await k.resolve(x.org, r3.stateId, ts(t3), ts(t3)), a3.stateId, '63: historical read before the invalidation');
    await rejects(k.submit(x, nm('o35-tomb'), k.rated(tomb.stateId, m, 'L1', 'I1', await k.instant('20 days'))), 'GV010', /GOVERNED_RISK_STATE_NOT_VALIDATED/);
    // Transitive: revoking the risk's pinned scenario makes the risk, and therefore the assessment, not current (no row written).
    const sc = await k.k3.scenario(x, nm('o35-sc'), 'OPERATIONAL', ['TOOL']);
    const r4 = await k.k3.validateRisk(x, nm('o35-r4'), objectSubject('TOOL', x.objects.TOOL!), sc);
    const a4 = await k.assess(x, nm('o35-a4'), k.rated(r4.stateId, m, 'L4', 'I4', await k.instant('20 days')));
    const hist = await k.historyDigest(x.org);
    await k.k3.revokeScenario(x, nm('o35-sc-rv'), { admitted: sc.admitted, stateId: sc.stateId });
    assert.equal(await k.historyDigest(x.org), hist);
    assert.equal(await k.resolve(x.org, r4.stateId), null);
    assert.equal(await k.stateCurrent(x.org, a4.stateId), false);
    assert.equal((await k.resolution(x.org, r4.stateId)).resolution, 'GOVERNED_RISK_DEPENDENCY_INVALID');
  });

  await t.test('O36 / attacks 64-65: UNKNOWN != INSUFFICIENT_EVIDENCE != RATED LOW — three distinct representations, side by side', async () => {
    const ru = await freshRisk(null), rie = await freshRisk(null), rlow = await freshRisk(null);
    await k.assess(x, nm('ie'), k.insufficient(rie.stateId, m, await k.instant('20 days')));
    assert.equal(NON_MONOTONE_CELLS['L1:I2'], 'LOW');
    await k.assess(x, nm('low'), k.rated(rlow.stateId, m, 'L1', 'I2', await k.instant('20 days')));
    const [u, ie, low] = [await k.read(x.member, ru.stateId), await k.read(x.member, rie.stateId), await k.read(x.member, rlow.stateId)];
    assert.deepEqual([u.assessment_status, u.resolution, u.assessment_outcome, u.likelihood_level_code, u.impact_level_code, u.rating_band, u.state_id,
      u.methodology_id], ['UNKNOWN', 'NO_STATE', null, null, null, null, null, null]);
    for (const [key, value] of Object.entries(u)) {
      assert.ok(value !== 'LOW' && value !== 0 && value !== '0' && value !== 'RATED' && value !== 'INSUFFICIENT_EVIDENCE', `UNKNOWN exposes no default: ${key}`);
    }
    assert.deepEqual([ie.assessment_status, ie.resolution, ie.assessment_outcome, ie.likelihood_level_code, ie.impact_level_code, ie.rating_band],
      ['INSUFFICIENT_EVIDENCE', 'CURRENT', 'INSUFFICIENT_EVIDENCE', null, null, null]);
    assert.ok(ie.state_id && ie.governance_decision_id && ie.authorization_decision_id, 'a governed, human-authorized decision exists');
    assert.deepEqual([low.assessment_status, low.assessment_outcome, low.likelihood_level_code, low.impact_level_code, low.rating_band],
      ['RATED', 'RATED', 'L1', 'I2', 'LOW']);
    const shapes = [u, ie, low].map(r => JSON.stringify([r.assessment_status, r.resolution, r.assessment_outcome, r.rating_band, r.state_id !== null]));
    assert.equal(new Set(shapes).size, 3, 'never collapsed into one representation');
    // UNKNOWN is a read result only: it is never a stored outcome (vocabulary CHECK) and never a band.
    assert.deepEqual(await k.json(`select coalesce(json_agg(distinct coalesce(assessment_outcome, 'NULL(REVOKED)')), '[]') from gov_repo.l15_risk_assessment_states
      where organisation_id='${x.org}' and assessment_outcome not in ('RATED','INSUFFICIENT_EVIDENCE')`), []);
    // Every not-current reason reads UNKNOWN with the closed reason (REVOKED here), never the last levels / band.
    const rr = await freshRisk(null);
    const ar = await k.assess(x, nm('o36-r'), k.rated(rr.stateId, m, 'L1', 'I2', await k.instant('20 days')));
    await k.revokeAssessment(x, nm('o36-rv'), rr.stateId, m, ar.stateId);
    const rd = await k.read(x.member, rr.stateId);
    assert.deepEqual([rd.assessment_status, rd.resolution, rd.rating_band, rd.likelihood_level_code], ['UNKNOWN', 'REVOKED', null, null]);
    // An unknown / foreign governed-risk state id is refused (no probing), never answered UNKNOWN.
    await rejects(exec(k.readSql(x.member, randomUUID())), 'GV010', /GOVERNED_RISK_STATE_UNRESOLVED/);
    const y = await k.setup({ ra: false });
    const ry = await k.risk(y, 'o36-foreign');
    await rejects(exec(k.readSql(x.member, ry.stateId)), 'GV010', /GOVERNED_RISK_STATE_UNRESOLVED/);
    // The read is tenant-scoped by the verified principal: a forged principal / org reads nothing.
    await rejects(exec(k.readSql(x.member, rlow.stateId, null, null, 'INHERENT', { org: y.org })), 'GV00[0-9]');
  });
});
