import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX, type L15RatingBand } from '@council/canonical-contracts';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { BOGUS, NON_MONOTONE_CELLS, m17s4Kit, matrixMethodology, type Meth } from '../helpers/m17-s4-fixtures';

/**
 * M17-S4 — methodology pin, scale membership, DB-derived rating band and the no-score catalog on real disposable PostgreSQL 17
 * (M17S4 horizon). ADR-GOVIA-RISK-INTELLIGENCE-v1 §§7.3, 10, 18 — O31, O32, O33 and attacks 22-37, 60, 61, 66. The band is a
 * LOOKUP of the exact pinned cell: the fixture matrix is deliberately non-monotone in the ordinals (L1 x I1 = CRITICAL,
 * L4 x I4 = LOW), so no arithmetic over ordinals can reproduce a stored band.
 */
const OP = L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL;
const OP_TOKENS = [...OP.objects, ...OP.relationships.map(r => `REL:${r}`)];
const RANK: Record<L15RatingBand, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

test('M17-S4 methodology pin / matrix / no-score (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S4' });
  t.after(() => c.stop());
  const { owner, exec, rejects } = c;
  const k = await m17s4Kit(c);
  const x = await k.setup();
  const one = k.one;
  const m = await k.methodology(x, 'mm');
  // A second version of ANOTHER methodology identity whose scales use different codes (P* / Q*) and its own matrix.
  const m2 = await k.methodology(x, 'mm2', matrixMethodology({ 'L1:I1': 'LOW', 'L1:I2': 'HIGH', 'L2:I1': 'CRITICAL', 'L2:I2': 'MODERATE' },
    { months: 0, days: 30, microseconds: 0 }, { l: 'P', i: 'Q' }));
  const until = (d = '20 days') => k.instant(d);
  let seq = 0;
  const nm = (p: string) => `${p}-${++seq}`;
  const subjects = [...OP.objects.map(kind => objectSubject(kind, x.objects[kind]!)), ...OP.relationships.map(r => relSubject(x.rels[r]!))];
  let pool = await k.k3.scenario(x, 'pool-0', 'OPERATIONAL', OP_TOKENS);
  let next = 0;
  const freshRisk = async () => {
    if (next === subjects.length) { pool = await k.k3.scenario(x, nm('pool'), 'OPERATIONAL', OP_TOKENS); next = 0; }
    const subject = subjects[next++]!;
    return { stateId: (await k.k3.validateRisk(x, nm('gr'), subject, pool)).stateId, subject, scen: pool };
  };

  /**
   * Owner-forged FULL governance chain in a rolled-back transaction (envelope proposal + typed proposal + ALLOW authorization
   * + governance decision + state), coherent in every mirrored field, so that ONLY the overridden state field is wrong: it
   * reaches the S4 state guard / CHECKs / FKs directly. The deferred commit-time guards never run (rollback).
   */
  async function forgeState(riskStateId: string, meth: Meth, o: { outcome?: string; lik?: string | null; imp?: string | null; band?: string | null;
    validUntil?: string; methodologyStateId?: string; stateOutcome?: string } = {}) {
    const [pid, aid, did, sid] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const outcome = o.outcome ?? 'RATED';
    const lik = o.lik === undefined ? 'L1' : o.lik, imp = o.imp === undefined ? 'I1' : o.imp;
    const band = o.band === undefined ? NON_MONOTONE_CELLS['L1:I1']! : o.band;
    const validUntil = o.validUntil ?? `now() + interval '1 day'`;
    const v = (s: string | null) => (s === null ? 'null' : lit(s));
    return owner(`begin;
      insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
        values('${x.org}','${pid}','RISK_ASSESSMENT','VALIDATE','LOCAL_HUMAN','${x.member.id}','NONE',now());
      insert into gov_repo.l15_risk_assessment_proposals(organisation_id,proposal_id,intent,assessment_basis,governed_risk_state_id,governed_risk_subject_key,
        governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,
        governed_risk_scenario_validated_state_id,methodology_id,methodology_version_id,methodology_content_hash,assessment_outcome,likelihood_level_code,
        impact_level_code,requested_valid_until)
      select '${x.org}','${pid}','VALIDATE','INHERENT',s.state_id,s.subject_key,s.scenario_definition_id,s.scenario_definition_version_id,
        s.scenario_content_hash,s.scenario_validated_state_id,'${meth.id}','${meth.versionId}','${meth.hash}',${v(outcome)},${v(lik)},${v(imp)},${validUntil}
      from gov_repo.l15_governed_risk_states s where s.state_id='${riskStateId}';
      insert into gov_repo.l14_authorization_decisions(organisation_id,authorization_decision_id,command_id,command_fingerprint,actor_user_id,requested_action,
        subject_kind,scope_tag,target_canonical_kind,target_canonical_object_id,target_relationship_type,target_relationship_id,target_relationship_state_id,
        source_class,proposal_id,is_self_validation,authority_basis,basis_authority_policy_id,basis_version_id,basis_content_hash,result,evaluated_at,
        expectation_kind)
      select '${x.org}','${aid}','forged-${aid}',repeat('c',64),'${x.assessor.id}','VALIDATE','RISK_ASSESSMENT',s.subject_type,s.subject_canonical_kind,
        s.subject_canonical_object_id,s.subject_relationship_type,s.subject_relationship_id,s.subject_relationship_state_id,'LOCAL_HUMAN','${pid}',false,
        'AUTHORITY_POLICY_VERSION',b.authority_policy_id,b.version_id,b.content_hash,'ALLOW',now(),'EXPECTED_NONE'
      from gov_repo.l15_governed_risk_states s cross join gov_repo.l14_effective_authority_basis_v1('${x.org}', now()) b where s.state_id='${riskStateId}';
      insert into gov_repo.l14_governance_decisions(organisation_id,governance_decision_id,proposal_id,subject_kind,outcome,reason_code,authorization_decision_id,
        actor_user_id,support_status,decided_at) values('${x.org}','${did}','${pid}','RISK_ASSESSMENT','VALIDATE','RISK_ASSESSMENT_VALIDATED','${aid}',
        '${x.assessor.id}','NONE',now());
      insert into gov_repo.l15_risk_assessment_states(organisation_id,state_id,state_kind,assessment_basis,governed_risk_state_id,governed_risk_subject_key,
        governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,
        governed_risk_scenario_validated_state_id,methodology_id,methodology_version_id,methodology_content_hash,methodology_validated_state_id,
        assessment_outcome,likelihood_level_code,impact_level_code,rating_band,effective_from,valid_until,recorded_at,proposal_id,governance_decision_id,
        authorization_decision_id,authority_policy_id,authority_policy_version_id,authority_policy_content_hash,source_class,support_status)
      select '${x.org}','${sid}','VALIDATED','INHERENT',s.state_id,s.subject_key,s.scenario_definition_id,s.scenario_definition_version_id,
        s.scenario_content_hash,s.scenario_validated_state_id,'${meth.id}','${meth.versionId}','${meth.hash}','${o.methodologyStateId ?? meth.stateId}',
        ${v(o.stateOutcome ?? outcome)},${v(lik)},${v(imp)},${v(band)},now(),${validUntil},now(),'${pid}','${did}','${aid}',b.authority_policy_id,b.version_id,
        b.content_hash,'LOCAL_HUMAN','NONE'
      from gov_repo.l15_governed_risk_states s cross join gov_repo.l14_effective_authority_basis_v1('${x.org}', now()) b where s.state_id='${riskStateId}';
      select 'FORGED_CHAIN_ACCEPTED';
      rollback;`);
  }

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('O32 / attack 66: every one of the 16 cells (all four bands) reproduces EXACTLY the pinned cell; the stored band is a lookup, never arithmetic', async () => {
    const stored: Array<{ l: number; i: number; band: L15RatingBand }> = [];
    for (const [cell, expected] of Object.entries(NON_MONOTONE_CELLS)) {
      const [l, im] = cell.split(':') as [string, string];
      const r = await freshRisk();
      const a = await k.assess(x, nm('cell'), k.rated(r.stateId, m, l, im, await until()));
      assert.equal(a.decided.rating_band, expected, cell);
      assert.equal(await k.cellBand(x.org, m.versionId, l, im), expected, `${cell} DB cell`);
      assert.equal(await one(`select rating_band from gov_repo.l15_risk_assessment_states where state_id='${a.stateId}'`), expected);
      const read = await k.read(x.member, r.stateId);
      assert.deepEqual([read.assessment_status, read.likelihood_level_code, read.impact_level_code, read.rating_band], ['RATED', l, im, expected]);
      stored.push({ l: Number(l.slice(1)), i: Number(im.slice(1)), band: expected });
    }
    assert.deepEqual([...new Set(stored.map(s => s.band))].sort(), ['CRITICAL', 'HIGH', 'LOW', 'MODERATE']);
    // Not a function of any ordinal arithmetic: the same product / sum maps to different bands, and order is violated.
    const violates = (f: (s: { l: number; i: number }) => number) => stored.some(a => stored.some(b => f(a) < f(b) && RANK[a.band] > RANK[b.band]))
      && stored.some(a => stored.some(b => f(a) === f(b) && a.band !== b.band));
    assert.ok(violates(s => s.l * s.i), 'product');
    assert.ok(violates(s => s.l + s.i), 'sum');
    // EVERY stored RATED band of the suite equals its exact pinned cell (catalog-wide join; no row disagrees).
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states s left join gov_repo.l15_risk_methodology_rating_cells c
      on c.organisation_id=s.organisation_id and c.methodology_version_id=s.methodology_version_id and c.likelihood_level_code=s.likelihood_level_code
      and c.impact_level_code=s.impact_level_code where s.assessment_outcome='RATED' and c.rating_band is distinct from s.rating_band`), '0');
    // Another version's own matrix governs its own assessments (no cross-version lookup).
    const r2 = await freshRisk();
    const a2 = await k.assess(x, nm('m2'), k.rated(r2.stateId, m2, 'P2', 'Q1', await until()));
    assert.equal(a2.decided.rating_band, 'CRITICAL');
  });

  await t.test('O33 / attacks 29-36: level membership in the PINNED scales only; no default level; INSUFFICIENT_EVIDENCE carries none', async () => {
    const r = await freshRisk();
    const n0 = await k.counts(x.org);
    const v = await until();
    const sub = (l: string | null, i: string | null, outcome: 'RATED' | 'INSUFFICIENT_EVIDENCE' = 'RATED') =>
      k.submit(x, nm('o33'), k.rated(r.stateId, m, l ?? 'L1', i ?? 'I1', v, { assessmentOutcome: outcome, likelihoodLevelCode: l, impactLevelCode: i }));
    await rejects(sub('L9', 'I1'), 'GV010', /LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY/);                  // 29 unknown likelihood
    await rejects(sub('L1', 'I9'), 'GV010', /IMPACT_LEVEL_NOT_IN_METHODOLOGY/);                      // 30 unknown impact
    await rejects(sub('P1', 'I1'), 'GV010', /LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY/);                  // 31 a level of another version
    await rejects(sub('L1', 'Q1'), 'GV010', /IMPACT_LEVEL_NOT_IN_METHODOLOGY/);                      // 32
    await rejects(sub('l1', 'I1'), 'GV010', /LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY/);                  // no case folding
    await rejects(sub('1', 'I1'), 'GV010', /LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY/);                   // never by ordinal
    await rejects(sub('L1 ', 'I1'), 'GV010', /LIKELIHOOD_LEVEL_NOT_IN_METHODOLOGY/);                 // no trimming / nearest match
    const raw = (over: Record<string, string | null>) => exec(k.submitSql(x.member, { commandId: x.cmd(nm('o33r')),
      proposal: k.rated(r.stateId, m, 'L1', 'I1', v), raw: over, fingerprint: BOGUS }));
    await rejects(raw({ likelihoodLevelCode: null }), 'GV010', /LIKELIHOOD_LEVEL_REQUIRED/);                           // 33
    await rejects(raw({ impactLevelCode: null }), 'GV010', /IMPACT_LEVEL_REQUIRED/);                                   // 34
    await rejects(raw({ assessmentOutcome: 'INSUFFICIENT_EVIDENCE', impactLevelCode: null }), 'GV010', /LIKELIHOOD_LEVEL_NOT_PERMITTED/); // 35
    await rejects(raw({ assessmentOutcome: 'INSUFFICIENT_EVIDENCE', likelihoodLevelCode: null }), 'GV010', /IMPACT_LEVEL_NOT_PERMITTED/); // 36
    await rejects(raw({ assessmentOutcome: null }), 'GV010', /ASSESSMENT_OUTCOME_REQUIRED/);
    for (const bad of ['UNKNOWN', 'LOW', 'NOT_ASSESSED', 'rated']) {
      await rejects(raw({ assessmentOutcome: bad }), 'GV010', /ASSESSMENT_OUTCOME_UNKNOWN/);
    }
    assert.deepEqual(await k.counts(x.org), n0, 'nothing written');
    // The DB itself (owner): a level of another version fails the composite FK onto the PINNED version's scale / cell; an
    // INSUFFICIENT_EVIDENCE with a level, a RATED without one, or a stored UNKNOWN outcome fails the CHECKs.
    await rejects(forgeState(r.stateId, m, { lik: 'P1', imp: 'I1' }), '23503');
    await rejects(forgeState(r.stateId, m, { lik: 'L1', imp: 'Q2' }), '23503');
    await rejects(forgeState(r.stateId, m, { outcome: 'INSUFFICIENT_EVIDENCE', lik: 'L1', imp: null, band: null }), '23514');
    await rejects(forgeState(r.stateId, m, { outcome: 'RATED', lik: 'L1', imp: null, band: null }), '23514');
    await rejects(forgeState(r.stateId, m, { outcome: 'UNKNOWN', lik: null, imp: null, band: null }), '23514');
  });

  await t.test('O32 / attack 37 at the DB: a stored band can only be EXACTLY the pinned cell (forged chains reach the state guard directly)', async () => {
    const r = await freshRisk();
    // Control: a coherent forged chain with the exact cell band is structurally accepted (then rolled back).
    assert.match(await forgeState(r.stateId, m), /FORGED_CHAIN_ACCEPTED/);
    for (const band of ['LOW', 'MODERATE', 'HIGH']) {
      await rejects(forgeState(r.stateId, m, { band }), 'GV010', /RATING_BAND_NOT_DERIVED/);           // L1 x I1 is CRITICAL
    }
    await rejects(forgeState(r.stateId, m, { band: null }), 'GV010|23514', /RATING_BAND_NOT_DERIVED|outcome_levels_check/);
    await rejects(forgeState(r.stateId, m, { band: 'SEVERE' }), 'GV010|23514');
    await rejects(forgeState(r.stateId, m, { outcome: 'INSUFFICIENT_EVIDENCE', lik: null, imp: null, band: 'LOW' }), 'GV010|23514');
    // A band "computed" from ordinals (L4 x I4 = 16 -> CRITICAL) is refused: the pinned cell says LOW.
    await rejects(forgeState(r.stateId, m, { lik: 'L4', imp: 'I4', band: 'CRITICAL' }), 'GV010', /RATING_BAND_NOT_DERIVED/);
    assert.match(await forgeState(r.stateId, m, { lik: 'L4', imp: 'I4', band: 'LOW' }), /FORGED_CHAIN_ACCEPTED/);
    // The methodology pin of a state must be the exact VALIDATED state of its own tuple (composite FK) and valid (guard).
    await rejects(forgeState(r.stateId, m, { methodologyStateId: m2.stateId }), 'GV010|23503', /METHODOLOGY_DEPENDENCY_NOT_VALID|methodology_state_fkey/);
    await rejects(forgeState(r.stateId, m, { validUntil: `now() + interval '91 days'` }), 'GV010', /VALIDITY_EXCEEDS_METHODOLOGY_MAXIMUM/);
    await rejects(forgeState(r.stateId, m, { validUntil: 'now()' }), '23514|GV010');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_states where governed_risk_state_id='${r.stateId}'`), '0');
  });

  await t.test('attacks 22-28: the methodology pin is the exact admitted + VALIDATED + effective tuple of THIS tenant; never latest / default / another version', async () => {
    const r = await freshRisk();
    const v = await until();
    const n0 = await k.raCounts(x.org);
    const pin = (meth: Partial<Meth> & Meth) => k.rated(r.stateId, meth, meth === m2 ? 'P1' : 'L1', meth === m2 ? 'Q1' : 'I1', v);
    await rejects(k.submit(x, nm('m22'), pin({ ...m, id: randomUUID() })), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/);        // 22 wrong id
    await rejects(k.submit(x, nm('m23'), pin({ ...m, versionId: m2.versionId })), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/); // 23 wrong version
    await rejects(k.submit(x, nm('m23b'), pin({ ...m, versionId: randomUUID() })), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/);
    await rejects(k.submit(x, nm('m24'), pin({ ...m, hash: 'e'.repeat(64) })), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/);    // 24 wrong hash
    await rejects(k.submit(x, nm('m24b'), pin({ ...m, hash: m2.hash })), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/);
    // 25 admitted but never validated
    const admittedOnly = await k.s2.admitMethodology(x as never, nm('m25'), matrixMethodology(), {}, x.methodologyAdmitter);
    await rejects(k.submit(x, nm('m25'), k.rated(r.stateId, { id: admittedOnly.methodology_id, versionId: admittedOnly.methodology_version_id,
      hash: admittedOnly.content_hash, stateId: '', admitted: admittedOnly }, 'L1', 'I1', v)), 'GV010', /METHODOLOGY_VERSION_NOT_VALID/);
    // 26 revoked
    const mr = await k.methodology(x, 'm26');
    await k.revokeMethodology(x, 'm26-rv', mr);
    await rejects(k.submit(x, nm('m26'), k.rated(r.stateId, mr, 'L1', 'I1', v)), 'GV010', /METHODOLOGY_VERSION_NOT_VALID/);
    // 27 another tenant's methodology is indistinguishable from an unknown one
    const y = await k.setup({ ra: false });
    const my = await k.methodology(y, 'm27');
    await rejects(k.submit(x, nm('m27'), k.rated(r.stateId, my, 'L1', 'I1', v)), 'GV010', /METHODOLOGY_VERSION_NOT_ADMITTED/);
    // 28 future-effective at the assessment's effective_from
    const future = await k.instant('2 hours');
    const mf = await k.methodology(x, 'm28', matrixMethodology(), { from: future });
    await rejects(k.submit(x, nm('m28'), k.rated(r.stateId, mf, 'L1', 'I1', v)), 'GV010', /METHODOLOGY_VERSION_NOT_VALID/);
    assert.deepEqual(await k.raCounts(x.org), n0, 'no RISK_ASSESSMENT proposal / authorization / decision / state / head written');
    // ... an assessment explicitly FUTURE_DATED at/after the methodology's own effective instant is admissible (dating rule).
    const later = await k.instant('3 hours');
    const fut = await k.assess(x, nm('m28-ok'), k.rated(r.stateId, mf, 'L1', 'I1', await k.instant('30 days'), { requestedEffectiveFrom: later }));
    assert.equal(fut.decided.outcome, 'VALIDATED');
    assert.equal(await k.resolve(x.org, r.stateId), null, 'not yet effective');
    assert.equal(await k.resolve(x.org, r.stateId, `'${later}'::timestamptz + interval '1 second'`), fut.stateId);
    // Methodology revoked between SUBMIT and DECIDE: the VALIDATE decision re-resolves the exact pin and fails closed.
    const r2 = await freshRisk();
    const mx = await k.methodology(x, 'mx');
    const p = k.rated(r2.stateId, mx, 'L2', 'I2', v);
    const sub = await k.submit(x, nm('mx'), p);
    await k.revokeMethodology(x, 'mx-rv', mx);
    const c0 = await k.raCounts(x.org);
    await rejects(k.decide(x, nm('mx'), sub, p), 'GV010', /METHODOLOGY_DEPENDENCY_NOT_VALID/);
    assert.deepEqual(await k.raCounts(x.org), c0, 'nothing consumed');
  });

  await t.test('attacks 60-61 / §18: a methodology successor never repins; a methodology REVOKE invalidates currentness without mutation; no replacement', async () => {
    const mi = await k.methodology(x, 'mi');
    const r = await freshRisk();
    const a = await k.assess(x, nm('mi'), k.rated(r.stateId, mi, 'L3', 'I2', await until()));
    const row0 = await k.stateRow(x.org, a.stateId);
    const hist0 = await k.historyDigest(x.org);
    // 60. A successor version (admitted + VALIDATED) changes nothing: same exact pin, still current, no row written.
    const mv2 = await k.methodologySuccessor(x, 'mi-v2', mi);
    assert.equal(await k.historyDigest(x.org), hist0);
    let read = await k.read(x.member, r.stateId);
    assert.deepEqual([read.assessment_status, read.methodology_version_id, read.methodology_validated_state_id], ['RATED', mi.versionId, mi.stateId]);
    // 61. Revoke the pinned version: the assessment is not current at both coordinates; its row is byte-identical.
    const tb = await k.instant('0 seconds');
    await k.revokeMethodology(x, 'mi-rv', mi);
    assert.equal(await k.stateRow(x.org, a.stateId), row0);
    assert.equal(await k.historyDigest(x.org), hist0, 'no repin, no REVOKED tombstone manufactured, no row');
    assert.equal(await k.resolve(x.org, r.stateId), null);
    assert.equal(await k.stateCurrent(x.org, a.stateId), false);
    assert.deepEqual(await k.resolution(x.org, r.stateId), { resolution: 'METHODOLOGY_DEPENDENCY_INVALID', state_id: a.stateId, state_kind: 'VALIDATED' });
    read = await k.read(x.member, r.stateId);
    assert.deepEqual([read.assessment_status, read.resolution, read.state_id, read.rating_band, read.likelihood_level_code],
      ['UNKNOWN', 'METHODOLOGY_DEPENDENCY_INVALID', null, null, null], 'UNKNOWN exposes no content');
    // Historical as-of before the revocation still resolves exactly the same state.
    assert.equal(await k.resolve(x.org, r.stateId, `'${tb}'::timestamptz`, `'${tb}'::timestamptz`), a.stateId);
    // The newer validated version is never auto-selected; a re-validation of the SAME version (a new methodology state) does not
    // revive the assessment either (the pin is the exact methodology state id).
    const head = await k.json(`select to_json(latest_state_id) from gov_repo.l15_risk_methodology_heads where methodology_version_id='${mi.versionId}'`);
    const reval = await k.s2.validate(x as never, 'mi-reval', 'RISK_METHODOLOGY', mi.admitted, x.methodologyValidator, head as string);
    assert.equal(reval.decided.outcome, 'VALIDATED');
    assert.notEqual(reval.decided.state_id, mi.stateId);
    assert.equal(await k.resolve(x.org, r.stateId), null);
    assert.equal(await k.stateRow(x.org, a.stateId), row0);
    // A new assessment must pin explicitly (a successor of the same key, naming the version it chooses).
    const renewed = await k.assess(x, nm('mi-new'), k.rated(r.stateId, mv2, 'L3', 'I2', await until(), { expectedCurrentStateId: a.stateId }));
    assert.deepEqual([renewed.decided.outcome, renewed.decided.predecessor_state_id, renewed.decided.methodology_version_id],
      ['VALIDATED', a.stateId, mv2.versionId]);
    assert.equal(await k.resolve(x.org, r.stateId), renewed.stateId);
  });

  await t.test('O31: no L15 column is a score / weight / percentage / product; the only numeric L15 columns are the S2 scale ordinals (+ the two non-authoritative S1 hints)', async () => {
    const named = await k.json(`select coalesce(json_agg(c.relname||'.'||a.attname), '[]') from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p','v','m') and c.relname like 'l15\\_%' and a.attnum > 0 and not a.attisdropped
        and a.attname ~* '(score|weight|percent|product)'`);
    assert.deepEqual(named, []);
    const numeric = (await k.json(`select json_agg(c.relname||'.'||a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='gov_repo'::regnamespace and c.relkind in ('r','p') and c.relname like 'l15\\_%' and a.attnum > 0 and not a.attisdropped
        and a.atttypid in ('int2'::regtype,'int4'::regtype,'int8'::regtype,'numeric'::regtype,'float4'::regtype,'float8'::regtype,'money'::regtype)`) as string[]).sort();
    assert.deepEqual(numeric, ['l15_risk_hypotheses.hint_confidence', 'l15_risk_methodology_impact_levels.ordinal',
      'l15_risk_methodology_likelihood_levels.ordinal', 'l15_risk_signals.hint_confidence']);
    // Every RISK_ASSESSMENT store: no numeric / json / array / interval-as-score column, no generated numeric column.
    const raCols = await k.json(`select json_agg(c.relname||'.'||a.attname||':'||format_type(a.atttypid, a.atttypmod)||':'||(a.attgenerated <> '')::text)
      from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='gov_repo'::regnamespace and c.relname like 'l15\\_risk\\_assessment\\_%'
        and c.relkind='r' and a.attnum > 0 and not a.attisdropped`) as string[];
    assert.ok(raCols.length > 60);
    for (const col of raCols) {
      assert.match(col.split(':')[1]!, /^(uuid|text|timestamp with time zone|character\(64\))$/, col);
      assert.doesNotMatch(col, /score|weight|percent|product|severity|confidence|rationale|title|description|label|domain/i, col);
    }
    // The routines of S4 carry no numeric score argument / result.
    assert.equal(await one(`select count(*) from pg_proc where proname ~ 'risk_assessment' and (pg_get_function_arguments(oid) ~* '(score|weight|percent|numeric|integer|double)'
      or pg_get_function_result(oid) ~* '(score|weight|percent|numeric|double)')`), '0');
    // The only interval in the assessment chain is the S2 methodology maximum (a duration bound, never a score).
    assert.equal(await one(`select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relname like 'l15\\_%' and c.relkind='r'
      and a.atttypid='interval'::regtype and not a.attisdropped`), '1');
  });
});
