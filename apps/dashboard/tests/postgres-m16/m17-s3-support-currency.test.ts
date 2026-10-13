import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX, type L15GovernedRiskSupport, type L15RiskDomain } from '@council/canonical-contracts';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit, inDays } from '../helpers/m16-l14-control-assessment-fixtures';
import { m17s1Kit, objectSubject as s1Subject } from '../helpers/m17-s1-fixtures';
import { m17s3Kit, objectSubject, type Rel } from '../helpers/m17-s3-fixtures';

/**
 * M17-S3 — O44 support currency on real disposable PostgreSQL 17 (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§9.2, 12, 16; D-03).
 * Upstream rows are REAL: M16 CONTROL_ASSESSMENT facts through the real M16 RPCs (and revoked / expired / superseded through
 * them), a member human signal + hypothesis through the real S1 RPCs, an administrator technical field state lineage. The
 * GOVERNED_RISK authority enters the control-assessment organisation through a normal AP successor that keeps the M16 rules.
 *
 * O44: a support link's currency is a READ projection at (effective_at, recorded_cutoff). An L14_FACT_STATE link is current
 * iff the exact M16 resolver of its family returns exactly the cited fact_state_id (no replacement is ever selected); a field
 * state iff no successor is visible; immutable evidence by existence; signals / hypotheses transitively. A degraded support
 * never changes, revokes, expires or re-decides the risk: GOVERNED_RISK history and heads are byte-identical, and no M16
 * row is written by any L15 read.
 */
const legalObjects = (d: L15RiskDomain) => L15_DOMAIN_SUBJECT_MATRIX[d].objects as readonly string[];

test('M17-S3 GOVERNED_RISK O44 support currency (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S3' });
  t.after(() => c.stop());
  const { owner, exec } = c;
  const k = await m17s3Kit(c);
  const s1 = await m17s1Kit(c);
  const ca = await controlAssessmentKit(c);
  const ctx = await ca.setup();
  const O = ctx.objects.byKind as Record<string, string>;
  const rels: Record<string, Rel> = { READS_FROM: ctx.rels.reads, EXPOSES: ctx.rels.exposes };
  const x = await k.attach(ctx as never, ca.rules(ctx.objects, ctx.rels), { ...O }, rels);
  const org = ctx.org;
  const scen = await k.scenario(x, 'scn-o44', 'OPERATIONAL', legalObjects('OPERATIONAL'));
  const kinds = legalObjects('OPERATIONAL');
  assert.ok(kinds.length >= 5, 'enough OPERATIONAL object kinds for isolated logical keys');
  const subjectOf = (i: number) => objectSubject(kinds[i]!, O[kinds[i]!]!);
  const now = async () => lastLine(await k.instant('0 seconds'));
  const at = (ts: string) => `'${ts}'::timestamptz`;
  const present = (...entries: Array<[string, string]>): L15GovernedRiskSupport =>
    ({ status: 'PRESENT', entries: entries.map(([tag, targetId]) => ({ tag: tag as never, targetId })) });
  const summary = (stateId: string, a = 'clock_timestamp()', cut = 'clock_timestamp()') => k.json(`select to_json(r) from
    gov_repo.l15_governed_risk_support_summary_v1('${org}', '${stateId}', ${a}, ${cut}) r`) as Promise<{
      support_currency: string; support_link_count: number; degraded_link_count: number; failing_link_id: string | null;
      failing_reason: string | null; failing_upstream_link_id: string | null }>;
  const stateLink = (stateId: string, tag: string) => k.one(`select link_id from gov_repo.l15_support_links where organisation_id='${org}'
    and owner_kind='GOVERNED_RISK' and owner_governed_risk_artifact='STATE' and owner_governed_risk_state_id='${stateId}' and target_tag='${tag}'`);
  const m16Digest = () => ca.historyDigest(org);
  const grRows = () => k.one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 's:'||t::text x from gov_repo.l15_governed_risk_states t where organisation_id='${org}'
    union all select 'h:'||t::text from gov_repo.l15_governed_risk_heads t where organisation_id='${org}'
    union all select 'p:'||t::text from gov_repo.l15_governed_risk_proposals t where organisation_id='${org}'
    union all select 'l:'||t::text from gov_repo.l15_support_links t where organisation_id='${org}' and owner_kind='GOVERNED_RISK'
    union all select 'r:'||t::text from gov_repo.l14_command_results t where organisation_id='${org}' and subject_kind='GOVERNED_RISK') s`);

  // REAL M16 facts (NOT_SATISFIED assessments of APPLIES applicabilities) through the M16 RPCs after the AP succession.
  const fact = async (name: string, kind: string, until?: string) => {
    const app = await ca.applicability(ctx, name, ca.cak.objectTarget(kind as never, O[kind]!));
    const a = await ca.assess(ctx, name, app.stateId, { outcome: 'NOT_SATISFIED', ...(until ? { until } : {}) });
    return { app, stateId: a.stateId };
  };
  const direct = await fact('o44-direct', 'TOOL');
  const viaSignal = await fact('o44-signal', 'MODEL');
  const expiring = await fact('o44-expiring', 'API');
  const superseded = await fact('o44-superseded', 'AGENT');

  await t.test('O44 SUPPORT_NONE: a risk validated with explicit NONE support projects SUPPORT_NONE (never CURRENT by default)', async () => {
    const r = await k.validateRisk(x, 'o44-none', subjectOf(0), scen);
    const s = await summary(r.stateId);
    assert.deepEqual([s.support_currency, Number(s.support_link_count), Number(s.degraded_link_count), s.failing_link_id],
      ['SUPPORT_NONE', 0, 0, null]);
    const read = await k.read(x.member, subjectOf(0), scen.id);
    assert.deepEqual([read.resolution, read.state_id, read.support_currency], ['CURRENT', r.stateId, 'SUPPORT_NONE']);
  });

  await t.test('O44 L14_FACT_STATE: exact M16 resolver; M16 REVOKE degrades the link (named) while the risk stays VALIDATED byte-identical', async () => {
    const s = subjectOf(1);
    const r = await k.validateRisk(x, 'o44-l14', s, scen, {
      support: present(['L14_FACT_STATE', direct.stateId]),
      decideSupport: present(['L14_FACT_STATE', direct.stateId], ['DISCOVERY_EVIDENCE', x.evidence]) });
    const l14Link = await stateLink(r.stateId, 'L14_FACT_STATE');
    const evLink = await stateLink(r.stateId, 'DISCOVERY_EVIDENCE');
    assert.equal((await summary(r.stateId)).support_currency, 'SUPPORT_CURRENT');
    const rows = await k.supportCurrency(org, r.stateId);
    assert.deepEqual(rows.map(l => [l.target_tag, l.link_currency, l.failure_reason]).sort(),
      [['DISCOVERY_EVIDENCE', 'CURRENT', null], ['L14_FACT_STATE', 'CURRENT', null]]);
    assert.equal(rows.find(l => l.target_tag === 'L14_FACT_STATE')!.target_id, direct.stateId, 'the exact cited fact_state_id');
    const before = await now();
    const grBefore = await grRows();
    const headBefore = await k.head(org, s, scen.id);
    // The M16 fact is revoked through the real M16 RPC (M16 history grows; L15 never writes M16).
    await ca.revoke(ctx, 'o44-l14', direct.app.stateId, direct.stateId, 'NOT_SATISFIED');
    assert.equal(await ca.resolve(org, direct.app.stateId, 'clock_timestamp()', 'clock_timestamp()'), null, 'M16 fact no longer current');
    const deg = await summary(r.stateId);
    assert.deepEqual([deg.support_currency, Number(deg.support_link_count), Number(deg.degraded_link_count), deg.failing_link_id,
      deg.failing_reason, deg.failing_upstream_link_id],
    ['SUPPORT_DEGRADED', 2, 1, l14Link, 'L14_FACT_STATE_NOT_CURRENT', null]);
    const perLink = await k.supportCurrency(org, r.stateId);
    assert.deepEqual(perLink.find(l => l.link_id === evLink)!.link_currency, 'CURRENT', 'immutable evidence stays current');
    // The risk itself is untouched: no automatic transition, no revoke, no re-decision; history + head byte-identical.
    assert.equal(await grRows(), grBefore, 'GOVERNED_RISK history / heads / results byte-identical');
    assert.equal(await k.head(org, s, scen.id), headBefore);
    assert.deepEqual(await k.resolution(org, s, scen.id), { resolution: 'CURRENT', state_id: r.stateId, state_kind: 'VALIDATED' });
    // Historical replay at both coordinates before the M16 revoke: still CURRENT (deterministic).
    assert.equal((await summary(r.stateId, at(before), at(before))).support_currency, 'SUPPORT_CURRENT');
    // The member read RPC projects the same (and writes nothing anywhere).
    const m16 = await m16Digest();
    const read = await k.read(x.member, s, scen.id);
    assert.deepEqual([read.resolution, read.state_id, read.support_currency, read.failing_link_id, read.failing_reason,
      Number(read.support_link_count), Number(read.degraded_link_count)],
    ['CURRENT', r.stateId, 'SUPPORT_DEGRADED', l14Link, 'L14_FACT_STATE_NOT_CURRENT', 2, 1]);
    const past = await k.read(x.member, s, scen.id, at(before), at(before));
    assert.equal(past.support_currency, 'SUPPORT_CURRENT');
    assert.equal(await m16Digest(), m16, 'no M16 row written by the L15 read');
    assert.equal(await grRows(), grBefore, 'no L15 row written by the L15 read');
    // A re-validation of the M16 key (new fact) never re-points the old link: the cited fact stays not current.
    const again = await ca.assess(ctx, 'o44-l14-again', direct.app.stateId, { outcome: 'NOT_SATISFIED' });
    assert.notEqual(again.stateId, direct.stateId);
    assert.equal(await ca.resolve(org, direct.app.stateId, 'clock_timestamp()', 'clock_timestamp()'), again.stateId);
    const still = await summary(r.stateId);
    assert.deepEqual([still.support_currency, still.failing_link_id], ['SUPPORT_DEGRADED', l14Link], 'no replacement is selected');
  });

  await t.test('O44 M16 expiry / supersession: the exact cited state only; business-time projection at both coordinates', async () => {
    // Expiry: the cited assessment is valid until T; at business instants after T the link is not current.
    const sE = subjectOf(2);
    const until = inDays(3);
    const exp = await fact('o44-exp2', 'MCP_SERVER', until);
    const r = await k.validateRisk(x, 'o44-exp', sE, scen, { decideSupport: present(['L14_FACT_STATE', exp.stateId]) });
    assert.equal((await summary(r.stateId)).support_currency, 'SUPPORT_CURRENT');
    const later = `clock_timestamp() + interval '5 days'`;
    const s5 = await summary(r.stateId, later, 'clock_timestamp()');
    assert.deepEqual([s5.support_currency, s5.failing_reason], ['SUPPORT_DEGRADED', 'L14_FACT_STATE_NOT_CURRENT']);
    assert.equal((await k.resolution(org, sE, scen.id, later)).resolution, 'CURRENT', 'the open-ended risk is unaffected');
    // The long-lived `expiring` fact (30 days) is current today and not current after its validity.
    const sX = subjectOf(3);
    const r2 = await k.validateRisk(x, 'o44-exp30', sX, scen, { decideSupport: present(['L14_FACT_STATE', expiring.stateId]) });
    assert.equal((await summary(r2.stateId)).support_currency, 'SUPPORT_CURRENT');
    assert.equal((await summary(r2.stateId, `clock_timestamp() + interval '60 days'`)).support_currency, 'SUPPORT_DEGRADED');
    // Supersession by a successor assessment of the same M16 key: the cited (older) state is no longer returned by the resolver.
    const sS = subjectOf(4);
    const r3 = await k.validateRisk(x, 'o44-sup', sS, scen, { decideSupport: present(['L14_FACT_STATE', superseded.stateId]) });
    assert.equal((await summary(r3.stateId)).support_currency, 'SUPPORT_CURRENT');
    const before = await now();
    await ca.revoke(ctx, 'o44-sup', superseded.app.stateId, superseded.stateId, 'NOT_SATISFIED');
    const next = await ca.assess(ctx, 'o44-sup-next', superseded.app.stateId, { outcome: 'PARTIALLY_SATISFIED' });
    assert.equal(await ca.resolve(org, superseded.app.stateId, 'clock_timestamp()', 'clock_timestamp()'), next.stateId);
    assert.equal((await summary(r3.stateId)).failing_reason, 'L14_FACT_STATE_NOT_CURRENT');
    assert.equal((await summary(r3.stateId, at(before), at(before))).support_currency, 'SUPPORT_CURRENT');
  });

  await t.test('O44 transitive: RISK_SIGNAL / RISK_HYPOTHESIS degrade through their upstream L14 link (named)', async () => {
    const sig = await s1.run(c.svc, s1.humanSignalSql(ctx.member, `o44-sig-${randomUUID()}`, s1Subject('MODEL', O.MODEL!),
      ['DISCOVERY_EVIDENCE', 'L14_FACT_STATE'], [x.evidence, viaSignal.stateId]));
    const hyp = await exec(s1.humanHypothesisSql(ctx.member, `o44-hyp-${randomUUID()}`, s1Subject('MODEL', O.MODEL!), [sig.signal_id]));
    const upstream = await k.one(`select link_id from gov_repo.l15_support_links where organisation_id='${org}' and owner_kind='RISK_SIGNAL'
      and owner_signal_id='${sig.signal_id}' and target_tag='L14_FACT_STATE'`);
    assert.match(upstream, /^[0-9a-f-]{36}$/);
    const sSig = objectSubject(kinds[0]!, O[kinds[0]!]!);
    const scen2 = await k.scenario(x, 'scn-o44-transitive', 'OPERATIONAL', legalObjects('OPERATIONAL'));
    const rs = await k.validateRisk(x, 'o44-via-sig', sSig, scen2, { support: present(['RISK_SIGNAL', sig.signal_id]),
      decideSupport: present(['RISK_SIGNAL', sig.signal_id]) });
    const sHyp = subjectOf(1);
    const rh = await k.validateRisk(x, 'o44-via-hyp', sHyp, scen2, { support: present(['RISK_HYPOTHESIS', hyp.hypothesis_id]),
      decideSupport: present(['RISK_HYPOTHESIS', hyp.hypothesis_id]) });
    assert.equal((await summary(rs.stateId)).support_currency, 'SUPPORT_CURRENT');
    assert.equal((await summary(rh.stateId)).support_currency, 'SUPPORT_CURRENT');
    const grBefore = await grRows();
    const signalRows = await k.one(`select md5(string_agg(t::text, '|' order by t::text)) from gov_repo.l15_risk_signals t where organisation_id='${org}'`);
    await ca.revoke(ctx, 'o44-signal', viaSignal.app.stateId, viaSignal.stateId, 'NOT_SATISFIED');
    const a = await summary(rs.stateId), b = await summary(rh.stateId);
    assert.deepEqual([a.support_currency, a.failing_link_id, a.failing_reason, a.failing_upstream_link_id],
      ['SUPPORT_DEGRADED', await stateLink(rs.stateId, 'RISK_SIGNAL'), 'SIGNAL_SUPPORT_NOT_CURRENT', upstream]);
    assert.deepEqual([b.support_currency, b.failing_link_id, b.failing_reason, b.failing_upstream_link_id],
      ['SUPPORT_DEGRADED', await stateLink(rh.stateId, 'RISK_HYPOTHESIS'), 'HYPOTHESIS_SUPPORT_NOT_CURRENT', upstream]);
    assert.equal(await grRows(), grBefore, 'no GOVERNED_RISK row changes');
    assert.equal(await k.one(`select md5(string_agg(t::text, '|' order by t::text)) from gov_repo.l15_risk_signals t where organisation_id='${org}'`),
      signalRows, 'the signal itself is never re-evaluated or rewritten');
    assert.equal((await k.resolution(org, sSig, scen2.id)).resolution, 'CURRENT');
    assert.equal((await k.resolution(org, sHyp, scen2.id)).resolution, 'CURRENT');
  });

  await t.test('O44 field state: a visible successor (previous_state_id) degrades with FIELD_STATE_SUPERSEDED; as-of before it is current', async () => {
    const tech = await s1.technicalState(org);
    const scen3 = await k.scenario(x, 'scn-o44-field', 'OPERATIONAL', legalObjects('OPERATIONAL'));
    const s = subjectOf(2);
    const r = await k.validateRisk(x, 'o44-field', s, scen3, { decideSupport: present(['TECHNICAL_FIELD_STATE', tech]) });
    assert.equal((await summary(r.stateId)).support_currency, 'SUPPORT_CURRENT');
    const before = await now();
    await owner(`insert into gov_repo.technical_field_decisions(organisation_id,decision_id,canonical_object_id,object_kind,field_key,proposal_id,
        expected_current_state_id,expected_source_observation_id,expected_source_snapshot_id,outcome,actor_kind,actor_reference,decided_at)
      select d.organisation_id, d.decision_id || '-next', d.canonical_object_id, d.object_kind, d.field_key, d.proposal_id, s.state_id,
             d.expected_source_observation_id, d.expected_source_snapshot_id, 'ACCEPT_PROPOSED', 'HUMAN', 'fixture-admin', now()
      from gov_repo.technical_field_states s join gov_repo.technical_field_decisions d on d.organisation_id = s.organisation_id and d.decision_id = s.decision_id
      where s.organisation_id = '${org}' and s.state_id = '${tech}';
      insert into gov_repo.technical_field_states(organisation_id,state_id,canonical_object_id,object_kind,field_key,proposal_id,decision_id,previous_state_id,recorded_at)
      select organisation_id, state_id || '-next', canonical_object_id, object_kind, field_key, proposal_id, decision_id || '-next', state_id, now()
      from gov_repo.technical_field_states where organisation_id = '${org}' and state_id = '${tech}';`);
    const d = await summary(r.stateId);
    assert.deepEqual([d.support_currency, d.failing_link_id, d.failing_reason],
      ['SUPPORT_DEGRADED', await stateLink(r.stateId, 'TECHNICAL_FIELD_STATE'), 'FIELD_STATE_SUPERSEDED']);
    assert.equal((await summary(r.stateId, at(before), at(before))).support_currency, 'SUPPORT_CURRENT');
    assert.equal((await k.resolution(org, s, scen3.id)).resolution, 'CURRENT');
  });

  await t.test('O44 currency is never authority: a degraded risk is revoked only by a normal authorized REVOKE (closure reason)', async () => {
    const s = subjectOf(1);
    const cur = await k.resolution(org, s, scen.id);
    assert.equal((await summary(cur.state_id!)).support_currency, 'SUPPORT_DEGRADED');
    const rv = await k.revokeRisk(x, 'o44-close', s, scen, cur.state_id!, 'RISK_NO_LONGER_APPLICABLE');
    assert.deepEqual([rv.decided.outcome, rv.decided.state_kind, rv.decided.closure_reason], ['REVOKED', 'REVOKED', 'RISK_NO_LONGER_APPLICABLE']);
    assert.equal((await k.resolution(org, s, scen.id)).resolution, 'REVOKED');
    assert.equal((await summary(rv.stateId)).support_currency, 'SUPPORT_NONE', 'the REVOKED state carries its own (explicit NONE) support');
    // The function surface: no support-currency function is executable by any application role (owner-only projection).
    for (const fn of ['l15_governed_risk_support_currency_v1', 'l15_governed_risk_support_summary_v1', 'l15_support_link_target_failure_v1']) {
      assert.equal(await k.one(`select count(*) from pg_proc p, unnest(array['anon','authenticated','service_role']) r(role)
        where p.pronamespace='gov_repo'::regnamespace and p.proname='${fn}' and has_function_privilege(r.role, p.oid, 'EXECUTE')`), '0', fn);
      assert.equal(await k.one(`select prosecdef from pg_proc where pronamespace='gov_repo'::regnamespace and proname='${fn}'`), 'f',
        `${fn} is not a definer`);
    }
  });
});
