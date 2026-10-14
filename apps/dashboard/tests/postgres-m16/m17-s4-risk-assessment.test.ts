import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L15_DOMAIN_SUBJECT_MATRIX } from '@council/canonical-contracts';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { lit } from '../helpers/m16-governed-write-fixtures';
import { m17s1Kit, machineSignalSql } from '../helpers/m17-s1-fixtures';
import { objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { BOGUS, NON_MONOTONE_CELLS, NONE, m17s4Kit } from '../helpers/m17-s4-fixtures';

/**
 * M17-S4 — INHERENT RISK_ASSESSMENT on real disposable PostgreSQL 17 (M17S4 horizon). ADR-GOVIA-RISK-INTELLIGENCE-v1 §§9.2, 10,
 * 12, 16-18 — the governance flow, the exact dependency target, authority over the PINNED RISK SUBJECT, replay, support (D-03)
 * and O37 (band / level / hint / confidence / count never alter authorization; zero governed side effects outside the
 * assessment). Every governance write goes through the real RPCs as service_role with a verified principal; each statement
 * commits naturally (the S2R1 root ALLOW guard runs at COMMIT; no S4 writer forces it).
 */
const M16_HISTORY = ['l14_fact_states', 'l14_registry_states', 'l14_support_links', 'l14_authority_policy_versions'];
const OP = L15_DOMAIN_SUBJECT_MATRIX.OPERATIONAL;
const OP_TOKENS = [...OP.objects, ...OP.relationships.map(r => `REL:${r}`)];

test('M17-S4 INHERENT RISK_ASSESSMENT (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S4' });
  t.after(() => c.stop());
  const { owner, svc, exec, rejects } = c;
  const k = await m17s4Kit(c);
  const s1 = await m17s1Kit(c);
  const x = await k.setup();
  const one = k.one;
  const m16Digest = () => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    ${M16_HISTORY.map(tb => `select '${tb}:' || t::text as x from gov_repo.${tb} t where t.organisation_id = '${x.org}'`).join(' union all ')}) s`);
  const m16Before = await m16Digest();
  const m = await k.methodology(x, 'fm');
  const until = (d = '30 days') => k.instant(d);
  let seq = 0;
  const nm = (p: string) => `${p}-${++seq}`;
  // One OPERATIONAL scenario declaring every legal OPERATIONAL subject (6 object kinds + 12 relationship types): many
  // independent GOVERNED_RISK keys (= many independent assessment keys) under one scenario.
  const opScen = await k.k3.scenario(x, 'op-all', 'OPERATIONAL', OP_TOKENS);
  const subjects = [...OP.objects.map(kind => objectSubject(kind, x.objects[kind]!)), ...OP.relationships.map(r => relSubject(x.rels[r]!))];
  let next = 0;
  /** A fresh VALIDATED GOVERNED_RISK state (each call a new logical key: new scenario per 18 subjects). */
  let scenPool = opScen;
  const freshRisk = async () => {
    if (next === subjects.length) { scenPool = await k.k3.scenario(x, nm('op-pool'), 'OPERATIONAL', OP_TOKENS); next = 0; }
    const subject = subjects[next++]!;
    const v = await k.k3.validateRisk(x, nm('gr'), subject, scenPool);
    return { stateId: v.stateId, subject, scen: scenPool };
  };
  const machineSignal = (objectKind: string, hintSeverity: string | null = null, hintConfidence: number | null = null) =>
    s1.run(s1.machine, machineSignalSql({ org: x.org, key: `s4-${randomUUID()}`, kind: 'DETECTED_PATTERN', source: 'SYSTEM_DETECTOR',
      subject: { mode: 'CANONICAL_OBJECT', kind: objectKind, objectId: x.objects[objectKind]! }, trust: 'INFERRED', methodId: 'S4_TEST_DETECTOR',
      methodVersion: '1.0.0', hintSeverity, hintConfidence, tags: ['DISCOVERY_EVIDENCE'], ids: [x.evidence] }));
  const humanHypothesis = (objectKind: string, signals: string[], confidence: number | null = null) =>
    exec(s1.humanHypothesisSql(x.member, `s4h-${randomUUID()}`, { mode: 'CANONICAL_OBJECT', kind: objectKind, objectId: x.objects[objectKind]! },
      signals, confidence));

  // -------------------------------------------------------------------------------------------------------------------
  await t.test('flow: VALIDATE only via proposal -> ALLOW (L15_RISK_ASSESSMENT_VALIDATE over the PINNED RISK SUBJECT) -> decision -> state -> head; ids traceable', async () => {
    const r = await freshRisk();
    const before = await k.raCounts(x.org);
    const proposal = k.rated(r.stateId, m, 'L2', 'I2', await until());
    const submitted = await k.submit(x, nm('flow'), proposal);
    assert.deepEqual([submitted.outcome, submitted.authorization_decision_id, submitted.governance_decision_id, submitted.state_id,
      submitted.rating_band], ['SUBMITTED', null, null, null, null], 'submission grants nothing; no band before a decision');
    let after = await k.raCounts(x.org);
    assert.deepEqual([after.states, after.heads, after.decisions, after.authz], [before.states, before.heads, before.decisions, before.authz]);
    const decided = await k.decide(x, nm('flow'), submitted, proposal);
    assert.deepEqual([decided.outcome, decided.rating_band], ['VALIDATED', NON_MONOTONE_CELLS['L2:I2']]);
    after = await k.raCounts(x.org);
    assert.deepEqual([after.states, after.heads, after.decisions, after.authz], [before.states + 1, before.heads + 1, before.decisions + 1, before.authz + 1]);
    const trace = await k.json(`select json_build_object(
      'state', (select to_json(s) from gov_repo.l15_risk_assessment_states s where organisation_id='${x.org}' and state_id='${decided.state_id}'),
      'risk', (select to_json(g) from gov_repo.l15_governed_risk_states g where organisation_id='${x.org}' and state_id='${r.stateId}'),
      'authz', (select to_json(a) from gov_repo.l14_authorization_decisions a where organisation_id='${x.org}' and authorization_decision_id='${decided.authorization_decision_id}'),
      'rules', (select json_agg(r.permission||':'||r.requested_action||':'||r.permission_origin) from gov_repo.l14_authorization_decision_rules r
                where organisation_id='${x.org}' and authorization_decision_id='${decided.authorization_decision_id}'),
      'decision', (select to_json(d) from gov_repo.l14_governance_decisions d where organisation_id='${x.org}' and governance_decision_id='${decided.governance_decision_id}'),
      'head', (select latest_state_id from gov_repo.l15_risk_assessment_heads where organisation_id='${x.org}' and governed_risk_state_id='${r.stateId}'
               and assessment_basis='INHERENT'),
      'result', (select l15_state_id from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${decided.command_id}'),
      'ap', (select json_build_object('id', b.authority_policy_id, 'v', b.version_id, 'h', b.content_hash) from gov_repo.l14_effective_authority_basis_v1('${x.org}', clock_timestamp()) b))`);
    assert.deepEqual([trace.state.proposal_id, trace.state.governance_decision_id, trace.state.authorization_decision_id],
      [submitted.proposal_id, decided.governance_decision_id, decided.authorization_decision_id]);
    // Exact dependency pins: the S3 key tuple of the exact risk state; the exact VALIDATED methodology state.
    assert.deepEqual([trace.state.governed_risk_state_id, trace.state.governed_risk_subject_key, trace.state.governed_risk_scenario_definition_id,
      trace.state.governed_risk_scenario_definition_version_id, trace.state.governed_risk_scenario_content_hash,
      trace.state.governed_risk_scenario_validated_state_id], [r.stateId, trace.risk.subject_key, trace.risk.scenario_definition_id,
      trace.risk.scenario_definition_version_id, trace.risk.scenario_content_hash, trace.risk.scenario_validated_state_id]);
    assert.deepEqual([trace.state.methodology_id, trace.state.methodology_version_id, trace.state.methodology_content_hash,
      trace.state.methodology_validated_state_id], [m.id, m.versionId, m.hash, m.stateId]);
    // Typed scope = the subject of the pinned risk state (never the assessment, methodology, band, domain or a level).
    assert.deepEqual([trace.authz.result, trace.authz.subject_kind, trace.authz.requested_action, trace.authz.scope_tag,
      trace.authz.target_canonical_kind, trace.authz.target_canonical_object_id, trace.authz.authority_basis],
      ['ALLOW', 'RISK_ASSESSMENT', 'VALIDATE', trace.risk.subject_type, trace.risk.subject_canonical_kind, trace.risk.subject_canonical_object_id,
        'AUTHORITY_POLICY_VERSION']);
    assert.ok(trace.rules.every((rr: string) => rr === 'L15_RISK_ASSESSMENT_VALIDATE:VALIDATE:AUTHORITY_POLICY_RULE'), JSON.stringify(trace.rules));
    assert.deepEqual([trace.state.authority_policy_id, trace.state.authority_policy_version_id, trace.state.authority_policy_content_hash],
      [trace.ap.id, trace.ap.v, trace.ap.h]);
    assert.deepEqual([trace.decision.reason_code, trace.decision.proposal_id], ['RISK_ASSESSMENT_VALIDATED', submitted.proposal_id]);
    assert.equal(trace.head, decided.state_id);
    assert.equal(trace.result, decided.state_id);
    assert.equal(await k.resolve(x.org, r.stateId), decided.state_id);
    assert.equal(await k.stateCurrent(x.org, decided.state_id), true);
    // Attack 1: VALIDATE without a proposal (unknown / foreign id) is unresolved; nothing written.
    const n0 = await k.counts(x.org);
    await rejects(exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('nop')), proposalId: randomUUID(), proposal })), 'GV010', /PROPOSAL_UNRESOLVED/);
    assert.deepEqual(await k.counts(x.org), n0);
  });

  await t.test('REJECT / DEFER / DENY create no state and move no head; DENY durable + replayable; DEFER non-terminal', async () => {
    const r = await freshRisk();
    const proposal = k.insufficient(r.stateId, m, await until());
    const submitted = await k.submit(x, nm('rdd'), proposal);
    const before = await k.raCounts(x.org);
    const deferred = await k.decide(x, nm('rdd-d'), submitted, proposal, { outcome: 'DEFER' });
    assert.deepEqual([deferred.outcome, deferred.state_id], ['DEFERRED', null]);
    const denyCmd = x.cmd(nm('rdd-deny'));
    const denied = await exec(k.decideSql(x.member, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal }));
    assert.deepEqual([denied.outcome, denied.authorization_result, denied.deny_reason, denied.governance_decision_id, denied.state_id],
      ['DENIED', 'DENY', 'NO_MATCHING_AUTHORITY_RULE', null, null]);
    const replay = await exec(k.decideSql(x.member, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal }));
    assert.deepEqual([replay.replay, replay.outcome, replay.authorization_decision_id, replay.recorded_at],
      [true, 'DENIED', denied.authorization_decision_id, denied.recorded_at]);
    // The consumed DENY command id cannot be reused for an authorized VALIDATE (authority change requires a new command id).
    await rejects(exec(k.decideSql(x.assessor, { commandId: denyCmd, proposalId: submitted.proposal_id, proposal })), 'GV00[78]');
    const rejected = await k.decide(x, nm('rdd-r'), submitted, proposal, { outcome: 'REJECT' });
    assert.deepEqual([rejected.outcome, rejected.state_id], ['REJECTED', null]);
    const after = await k.raCounts(x.org);
    assert.deepEqual([after.states, after.heads], [before.states, before.heads]);
    assert.equal(after.decisions, before.decisions + 2, 'DEFER + REJECT decisions only (DENY has none)');
    assert.equal(await k.resolve(x.org, r.stateId), null);
    await rejects(k.decide(x, nm('rdd-t'), submitted, proposal), 'GV010', /PROPOSAL_TERMINAL/);
    // REVOKE semantics: only the exact current VALIDATED assessment; a REVOKE outcome on a VALIDATE proposal is refused.
    await rejects(exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('rdd-ox')), proposalId: submitted.proposal_id, proposal, outcome: 'REVOKE' })),
      'GV010', /OUTCOME_INTENT_INCOMPATIBLE/);
  });

  await t.test('attacks 2-6: the target is ONE exact current VALIDATED GOVERNED_RISK state of THIS tenant; INHERENT only', async () => {
    const n0 = await k.counts(x.org);
    const v = await until();
    // 2. nonexistent risk state
    await rejects(k.submit(x, nm('t2'), k.rated(randomUUID(), m, 'L1', 'I1', v)), 'GV010', /GOVERNED_RISK_STATE_UNRESOLVED/);
    // 4. a risk state of another tenant is indistinguishable from an unknown one
    const y = await k.setup();
    const ry = await k.risk(y, 'foreign');
    await rejects(k.submit(x, nm('t4'), k.rated(ry.stateId, m, 'L1', 'I1', v)), 'GV010', /GOVERNED_RISK_STATE_UNRESOLVED/);
    assert.deepEqual(await k.counts(x.org), n0);
    // 3. REVOKED tombstone / revoked VALIDATED / superseded VALIDATED risk states
    const rv = await freshRisk();
    const tomb = await k.k3.revokeRisk(x, nm('t3-rv'), rv.subject, rv.scen, rv.stateId);
    await rejects(k.submit(x, nm('t3a'), k.rated(tomb.stateId, m, 'L1', 'I1', v)), 'GV010', /GOVERNED_RISK_STATE_NOT_VALIDATED/);
    await rejects(k.submit(x, nm('t3b'), k.rated(rv.stateId, m, 'L1', 'I1', v)), 'GV010', /GOVERNED_RISK_STATE_NOT_CURRENT/);
    const sp = await freshRisk();
    const succ = await k.k3.scenarioSuccessor(x, nm('t3-v2'), sp.scen, 'OPERATIONAL', OP_TOKENS);
    const repin = await k.k3.validateRisk(x, nm('t3-repin'), sp.subject, succ, { over: { expectedCurrentStateId: sp.stateId } });
    await rejects(k.submit(x, nm('t3c'), k.rated(sp.stateId, m, 'L1', 'I1', v)), 'GV010', /GOVERNED_RISK_STATE_NOT_CURRENT/);
    assert.equal((await k.submit(x, nm('t3d'), k.rated(repin.stateId, m, 'L1', 'I1', v))).outcome, 'SUBMITTED', 'the successor is its own key');
    // 5 / 6. RESIDUAL is not executable in S4; an unknown / missing basis is refused (shape, before any read).
    const ok = await freshRisk();
    for (const [basis, detail] of [['RESIDUAL', /ASSESSMENT_BASIS_NOT_EXECUTABLE/], ['CONTROL', /ASSESSMENT_BASIS_UNKNOWN/],
      ['inherent', /ASSESSMENT_BASIS_UNKNOWN/], [null, /ASSESSMENT_BASIS_UNKNOWN/]] as const) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('t5')), proposal: k.rated(ok.stateId, m, 'L1', 'I1', v),
        raw: { assessmentBasis: basis }, fingerprint: BOGUS })), 'GV010', detail);
    }
    await rejects(exec(k.readSql(x.member, ok.stateId, null, null, 'RESIDUAL')), 'GV010', /ASSESSMENT_BASIS_NOT_EXECUTABLE/);
    await rejects(exec(k.readSql(x.member, ok.stateId, null, null, 'BOTH')), 'GV010', /ASSESSMENT_BASIS_UNKNOWN/);
    // The DB itself refuses a RESIDUAL / unknown-basis row even for the owner (executable CHECK + vocabulary CHECK).
    for (const basis of ['RESIDUAL', 'OTHER']) {
      await rejects(owner(`begin; alter table gov_repo.l15_risk_assessment_proposals disable trigger l15_risk_assessment_proposals_guard;
        insert into gov_repo.l15_risk_assessment_proposals(organisation_id,proposal_id,intent,assessment_basis,governed_risk_state_id,governed_risk_subject_key,
          governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,
          governed_risk_scenario_validated_state_id,methodology_id,methodology_version_id,methodology_content_hash,assessment_outcome,requested_valid_until)
        select '${x.org}','${randomUUID()}','VALIDATE','${basis}',s.state_id,s.subject_key,s.scenario_definition_id,s.scenario_definition_version_id,
          s.scenario_content_hash,s.scenario_validated_state_id,'${m.id}','${m.versionId}','${m.hash}','INSUFFICIENT_EVIDENCE',now() + interval '1 day'
        from gov_repo.l15_governed_risk_states s where s.state_id='${ok.stateId}'; rollback;`), '23514');
    }
  });

  await t.test('attacks 7-8: LOCAL_HUMAN only (SYSTEM_SEED / SOURCE_CONNECTION / machine source never); forged envelope and principal refused', async () => {
    const r = await freshRisk();
    const p = k.rated(r.stateId, m, 'L1', 'I1', await until());
    const n0 = await k.counts(x.org);
    for (const [source, detail] of [['SYSTEM_SEED', /SYSTEM_SEED_NOT_ADMISSIBLE/], ['SOURCE_CONNECTION', /SOURCE_CONNECTION_NOT_ADMISSIBLE/],
      ['SYSTEM_DETECTOR', /PROPOSAL_VOCABULARY_UNKNOWN/], ['MACHINE', /PROPOSAL_VOCABULARY_UNKNOWN/]] as const) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('t7')), proposal: p, raw: { sourceClass: source }, fingerprint: BOGUS })), 'GV010', detail);
    }
    // A forged SYSTEM_SEED / SOURCE_CONNECTION envelope cannot carry a typed RISK_ASSESSMENT proposal (structural guard).
    for (const source of ['SYSTEM_SEED', 'SOURCE_CONNECTION']) {
      const pid = randomUUID();
      await rejects(owner(`begin;
        insert into gov_repo.l14_proposals(organisation_id,proposal_id,subject_kind,intent,source_class,submitted_by_actor_user_id,support_status,submitted_at)
          values('${x.org}','${pid}','RISK_ASSESSMENT','VALIDATE','${source}','${x.member.id}','NONE',now());
        insert into gov_repo.l15_risk_assessment_proposals(organisation_id,proposal_id,intent,assessment_basis,governed_risk_state_id,governed_risk_subject_key,
          governed_risk_scenario_definition_id,governed_risk_scenario_definition_version_id,governed_risk_scenario_content_hash,
          governed_risk_scenario_validated_state_id,methodology_id,methodology_version_id,methodology_content_hash,assessment_outcome,requested_valid_until)
        select '${x.org}','${pid}','VALIDATE','INHERENT',s.state_id,s.subject_key,s.scenario_definition_id,s.scenario_definition_version_id,
          s.scenario_content_hash,s.scenario_validated_state_id,'${m.id}','${m.versionId}','${m.hash}','INSUFFICIENT_EVIDENCE',now() + interval '1 day'
        from gov_repo.l15_governed_risk_states s where s.state_id='${r.stateId}';
        rollback;`), 'GV010', /RISK_ASSESSMENT_PROPOSAL_SOURCE_INVALID/);
    }
    // A forged principal (no verified ACTIVE human: stale credential epoch / unknown user / foreign org) cannot submit.
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('t7f')), proposal: p, session: { epoch: `'2020-01-01T00:00:00Z'::timestamptz` } })), 'GV00[0-9]');
    await rejects(exec(k.submitSql({ id: randomUUID(), org: x.org, epoch: x.member.epoch }, { commandId: x.cmd(nm('t7g')), proposal: p, fingerprint: BOGUS })), 'GV00[0-9]');
    assert.deepEqual(await k.counts(x.org), n0);
  });

  await t.test('attacks 12-16, 21: authority = L15_RISK_ASSESSMENT_VALIDATE only, typed scope over the PINNED RISK SUBJECT, self-validation fail-closed', async () => {
    const deny = async (actor: typeof x.member, reason: string, proposal: ReturnType<typeof k.rated>, submitted: Record<string, any>) => {
      const r = await exec(k.decideSql(actor, { commandId: x.cmd(nm('deny')), proposalId: submitted.proposal_id, proposal }));
      assert.deepEqual([r.outcome, r.deny_reason, r.state_id], ['DENIED', reason, null], `${reason}`);
    };
    // A MODEL risk.
    const model = await k.k3.validateRisk(x, nm('a-model'), objectSubject('MODEL', x.objects.MODEL!), await k.k3.scenario(x, nm('a-model-scn'), 'OPERATIONAL', ['MODEL']));
    const p = k.rated(model.stateId, m, 'L3', 'I1', await until());
    const sub = await k.submit(x, nm('auth'), p);
    await deny(x.l14Resp, 'NO_MATCHING_AUTHORITY_RULE', p, sub);             // 13 L14 permission
    await deny(x.validator, 'NO_MATCHING_AUTHORITY_RULE', p, sub);           // 14 GOVERNED_RISK permission
    await deny(x.methodologyValidator, 'NO_MATCHING_AUTHORITY_RULE', p, sub); // 15 methodology permission
    await deny(x.treatment, 'NO_MATCHING_AUTHORITY_RULE', p, sub);           // 16 treatment permission
    await deny(x.scenarioValidator, 'NO_MATCHING_AUTHORITY_RULE', p, sub);   // scenario permission
    await deny(x.admin, 'NO_MATCHING_AUTHORITY_RULE', p, sub);               // legacy GOVERNANCE_ADMIN wildcard
    await deny(x.raContrib, 'SOURCE_NOT_AUTHORIZED', p, sub);                // CONTRIBUTING never authorizes
    await deny(x.raKind, 'SCOPE_NOT_AUTHORIZED', p, sub);                    // CANONICAL_KIND AGENT_VERSION vs the MODEL subject
    await deny(x.raRelType, 'SCOPE_NOT_AUTHORIZED', p, sub);                 // RELATIONSHIP_TYPE never matches an object subject
    const ok = await exec(k.decideSql(x.raObject, { commandId: x.cmd(nm('obj-ok')), proposalId: sub.proposal_id, proposal: p }));
    assert.deepEqual([ok.outcome, ok.rating_band], ['VALIDATED', NON_MONOTONE_CELLS['L3:I1']], 'CANONICAL_OBJECT scope of the exact MODEL subject');
    // CANONICAL_KIND scope matches an AGENT_VERSION risk subject.
    const av = await k.risk(x, nm('a-av'));
    const pav = k.rated(av.stateId, m, 'L1', 'I4', await until());
    const sav = await k.submit(x, nm('a-av'), pav);
    await deny(x.raObject, 'SCOPE_NOT_AUTHORIZED', pav, sav);
    assert.equal((await exec(k.decideSql(x.raKind, { commandId: x.cmd(nm('kind-ok')), proposalId: sav.proposal_id, proposal: pav }))).outcome, 'VALIDATED');
    // Relationship-state risk subjects: RELATIONSHIP_TYPE / RELATIONSHIP_STATE scopes match only the exact pinned risk subject.
    const relScen = await k.k3.scenario(x, nm('a-rel'), 'OPERATIONAL', ['REL:READS_FROM', 'REL:WRITES_TO']);
    const relScen2 = await k.k3.scenario(x, nm('a-rel2'), 'OPERATIONAL', ['REL:READS_FROM']);
    const reads = await k.k3.validateRisk(x, nm('a-reads'), relSubject(x.rels.READS_FROM!), relScen);
    const reads2 = await k.k3.validateRisk(x, nm('a-reads2'), relSubject(x.rels.READS_FROM!), relScen2);
    const writes = await k.k3.validateRisk(x, nm('a-writes'), relSubject(x.rels.WRITES_TO!), relScen);
    const pr = k.insufficient(reads.stateId, m, await until()), pr2 = k.insufficient(reads2.stateId, m, await until());
    const pw = k.insufficient(writes.stateId, m, await until());
    const sr = await k.submit(x, nm('a-r'), pr), sr2 = await k.submit(x, nm('a-r2'), pr2), sw = await k.submit(x, nm('a-w'), pw);
    await deny(x.raKind, 'SCOPE_NOT_AUTHORIZED', pr, sr);
    await deny(x.raRelType, 'SCOPE_NOT_AUTHORIZED', pw, sw);
    await deny(x.raRelState, 'SCOPE_NOT_AUTHORIZED', pw, sw);
    const relOk = await exec(k.decideSql(x.raRelType, { commandId: x.cmd(nm('rt-ok')), proposalId: sr.proposal_id, proposal: pr }));
    assert.equal(relOk.outcome, 'VALIDATED');
    assert.equal((await exec(k.decideSql(x.raRelState, { commandId: x.cmd(nm('rs-ok')), proposalId: sr2.proposal_id, proposal: pr2 }))).outcome, 'VALIDATED');
    assert.deepEqual(await k.json(`select json_build_object('scope', scope_tag, 'type', target_relationship_type, 'rel', target_relationship_id,
      'state', target_relationship_state_id) from gov_repo.l14_authorization_decisions where authorization_decision_id='${relOk.authorization_decision_id}'`),
      { scope: 'RELATIONSHIP_STATE', type: 'READS_FROM', rel: x.rels.READS_FROM!.relationshipId, state: x.rels.READS_FROM!.relationshipStateId });
    // 21. Self-validation fails closed; allowed only by an explicit allowSelfValidation rule.
    const sr3 = await freshRisk();
    const ps = k.rated(sr3.stateId, m, 'L4', 'I4', await until());
    const ss = await k.submit(x, nm('self'), ps, {}, x.assessor);
    await deny(x.assessor, 'SELF_VALIDATION_NOT_PERMITTED', ps, ss);
    const sr4 = await freshRisk();
    const ps2 = k.rated(sr4.stateId, m, 'L4', 'I4', await until());
    const ss2 = await k.submit(x, nm('self2'), ps2, {}, x.raSelf);
    assert.equal((await exec(k.decideSql(x.raSelf, { commandId: x.cmd(nm('self-ok')), proposalId: ss2.proposal_id, proposal: ps2 }))).outcome, 'VALIDATED');
    // A VALIDATE-only rule cannot REJECT / DEFER (requested action = the exact outcome).
    const sr5 = await freshRisk();
    const p5 = k.rated(sr5.stateId, m, 'L1', 'I1', await until());
    const s5 = await k.submit(x, nm('vo'), p5);
    const vo = await exec(k.decideSql(x.raValidateOnly, { commandId: x.cmd(nm('vo-d')), proposalId: s5.proposal_id, proposal: p5, outcome: 'DEFER' }));
    assert.deepEqual([vo.outcome, vo.deny_reason], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE']);
    // 11. service_role with a forged / null principal: GV00x, nothing written.
    const n0 = await k.counts(x.org);
    await rejects(exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('forge')), proposalId: s5.proposal_id, proposal: p5,
      session: { epoch: `'2020-01-01T00:00:00Z'::timestamptz` } })), 'GV00[0-9]');
    await rejects(svc(`select * from gov_repo.l15_decide_risk_assessment_proposal_v1(null,null,null,null,null,'x',null,'VALIDATE','RISK_ASSESSMENT_VALIDATED',null,'NONE','{}','{}','${BOGUS}')`),
      'GV00[0-9]|22004|P0001');
    assert.deepEqual(await k.counts(x.org), n0);
  });

  await t.test('attack 12 / O55: no RISK_ASSESSMENT rule in the organisation -> every decision is a durable, replayable DENY (no bootstrap, no wildcard)', async () => {
    const y = await k.setup({ ra: false });
    const my = await k.methodology(y, 'nora-m');
    const ry = await k.risk(y, 'nora');
    const p = k.rated(ry.stateId, my, 'L1', 'I1', await until());
    const sub = await k.submit(y, 'nora', p);
    for (const actor of [y.admin, y.validator, y.methodologyValidator, y.scenarioValidator, y.assessor, y.boot, y.ops]) {
      const cmd = y.cmd(`nora-${randomUUID().slice(0, 6)}`);
      const r = await exec(k.decideSql(actor, { commandId: cmd, proposalId: sub.proposal_id, proposal: p }));
      assert.deepEqual([r.outcome, r.deny_reason, r.state_id], ['DENIED', 'NO_MATCHING_AUTHORITY_RULE', null]);
      assert.equal((await exec(k.decideSql(actor, { commandId: cmd, proposalId: sub.proposal_id, proposal: p }))).replay, true);
    }
    assert.equal(await one(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${y.org}' and subject_kind='RISK_ASSESSMENT' and result='ALLOW'`), '0');
    assert.equal((await k.raCounts(y.org)).states, 0);
  });

  await t.test('attacks 43, 49-51 replay: exact retry = ORIGINAL durable result; changed payload GV007; wrong caller fingerprint GV008; stale GV009', async () => {
    const r = await freshRisk();
    const v = await until('20 days');
    const p = k.rated(r.stateId, m, 'L2', 'I3', v);
    const cmd = x.cmd(nm('rep-sub'));
    const a = await exec(k.submitSql(x.member, { commandId: cmd, proposal: p }));
    const b = await exec(k.submitSql(x.member, { commandId: cmd, proposal: p }));
    assert.deepEqual([b.replay, b.proposal_id, b.recorded_at, b.command_fingerprint], [true, a.proposal_id, a.recorded_at, a.command_fingerprint]);
    // Every semantically relevant field is in the fingerprint (changed payload -> GV007 on the same command id).
    for (const over of [{ likelihoodLevelCode: 'L1' }, { impactLevelCode: 'I1' }, { requestedValidUntil: await until('21 days') },
      { assessmentOutcome: 'INSUFFICIENT_EVIDENCE' as const, likelihoodLevelCode: null, impactLevelCode: null },
      { methodologyContentHash: 'f'.repeat(64) }]) {
      await rejects(exec(k.submitSql(x.member, { commandId: cmd, proposal: { ...p, ...over } })), 'GV007');
    }
    await rejects(exec(k.submitSql(x.member, { commandId: cmd, proposal: p, support: { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } })), 'GV007');
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('rep-fp')), proposal: p, fingerprint: BOGUS })), 'GV008');
    const dcmd = x.cmd(nm('rep-dec'));
    const d1 = await exec(k.decideSql(x.assessor, { commandId: dcmd, proposalId: a.proposal_id, proposal: p }));
    const d2 = await exec(k.decideSql(x.assessor, { commandId: dcmd, proposalId: a.proposal_id, proposal: p }));
    assert.deepEqual([d2.replay, d2.state_id, d2.authorization_decision_id, d2.governance_decision_id, d2.recorded_at, d2.effective_from, d2.rating_band],
      [true, d1.state_id, d1.authorization_decision_id, d1.governance_decision_id, d1.recorded_at, d1.effective_from, d1.rating_band]);
    await rejects(exec(k.decideSql(x.assessor, { commandId: dcmd, proposalId: a.proposal_id, proposal: p, outcome: 'DEFER' })), 'GV007');
    // 43. Stale expected-current / expected-none.
    await rejects(k.submit(x, nm('rep-stale'), k.rated(r.stateId, m, 'L1', 'I1', v)), 'GV009', /RISK_ASSESSMENT_STATE_EXISTS/);
    await rejects(k.submit(x, nm('rep-stale2'), k.rated(r.stateId, m, 'L1', 'I1', v, { expectedCurrentStateId: randomUUID() })), 'GV009', /EXPECTATION_MISMATCH/);
    // The same content again on an open current state is refused (a renewal must change something).
    const same = k.rated(r.stateId, m, 'L2', 'I3', v, { expectedCurrentStateId: d1.state_id });
    const ss = await k.submit(x, nm('rep-same'), same);
    await rejects(k.decide(x, nm('rep-same'), ss, same), 'GV010', /RISK_ASSESSMENT_ALREADY_VALIDATED/);
    // Decide expectation must equal the proposal's own explicit expectation and the head.
    await rejects(exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('rep-exp')), proposalId: ss.proposal_id, proposal: same, expected: null })), 'GV009');
    // A correction (another level) is a legitimate successor of the same key; the predecessor row is byte-identical.
    const before = await k.stateRow(x.org, d1.state_id);
    const corr = await k.assess(x, nm('rep-corr'), k.rated(r.stateId, m, 'L4', 'I3', v, { expectedCurrentStateId: d1.state_id }));
    assert.deepEqual([corr.decided.outcome, corr.decided.predecessor_state_id, corr.decided.rating_band], ['VALIDATED', d1.state_id, NON_MONOTONE_CELLS['L4:I3']]);
    assert.equal(await k.stateRow(x.org, d1.state_id), before);
    assert.equal(await k.resolve(x.org, r.stateId), corr.stateId);
    // REVOKE of the exact current VALIDATED state; the shared reason code only; no free-text reason exists.
    const rv = await k.revokeAssessment(x, nm('rep-rv'), r.stateId, m, corr.stateId);
    assert.deepEqual([rv.decided.outcome, rv.decided.predecessor_state_id, rv.decided.rating_band, rv.decided.assessment_outcome],
      ['REVOKED', corr.stateId, null, null]);
    assert.equal(await one(`select reason_code from gov_repo.l14_governance_decisions where governance_decision_id='${rv.decided.governance_decision_id}'`), 'RISK_ASSESSMENT_REVOKED');
    assert.equal(await k.resolve(x.org, r.stateId), null);
    await rejects(k.submit(x, nm('rep-rv2'), k.revocation(r.stateId, m, corr.stateId)), 'GV009', /EXPECTATION_MISMATCH/);
    await rejects(k.submit(x, nm('rep-rv3'), k.revocation(r.stateId, m, rv.stateId)), 'GV010', /TARGET_STATE_NOT_VALIDATED/);
  });

  await t.test('support (D-03): RISK_ASSESSMENT rank-3 owners (PROPOSAL / DECISION / STATE) cite hypotheses, signals and rank-0 tags; same tenant; immutable', async () => {
    const signal = await machineSignal('TOOL');
    const hyp = await humanHypothesis('TOOL', [signal.signal_id]);
    const assertion = await one(`select assertion_id from gov_repo.source_assertions where organisation_id='${x.org}' limit 1`);
    const r = await freshRisk();
    const support = { status: 'PRESENT', entries: [{ tag: 'RISK_HYPOTHESIS', targetId: hyp.hypothesis_id }, { tag: 'RISK_SIGNAL', targetId: signal.signal_id },
      { tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }, { tag: 'SOURCE_ASSERTION', targetId: assertion }] } as const;
    const a = await k.assess(x, nm('sup'), k.rated(r.stateId, m, 'L1', 'I2', await until()), { support, decideSupport: support });
    const links = await k.json(`select json_agg(owner_risk_assessment_artifact||':'||target_tag order by 1) from gov_repo.l15_support_links
      where organisation_id='${x.org}' and owner_kind='RISK_ASSESSMENT' and (owner_risk_assessment_proposal_id='${a.submitted.proposal_id}'
        or owner_governance_decision_id='${a.decided.governance_decision_id}' or owner_risk_assessment_state_id='${a.stateId}')`) as string[];
    assert.equal(links.length, 12, 'proposal + decision + state links (state links = decision links)');
    assert.equal(await one(`select count(*) from gov_repo.l15_support_links where owner_kind='RISK_ASSESSMENT' and owner_governance_decision_id is not null
      and owner_risk_assessment_artifact='DECISION' and owner_governance_decision_id='${a.decided.governance_decision_id}'`), '4');
    // 55. Cross-tenant / unknown target of every tag class is unresolved; nothing written.
    const other = await k.setup({ ra: false });
    const r2 = await freshRisk();
    const n0 = await k.counts(x.org);
    for (const [tag, id] of [['DISCOVERY_EVIDENCE', other.evidence], ['RISK_SIGNAL', randomUUID()], ['RISK_HYPOTHESIS', randomUUID()],
      ['L14_FACT_STATE', randomUUID()], ['RUNTIME_OBSERVATION', randomUUID()], ['SOURCE_ASSERTION', `assertion-${other.label}-agent`],
      ['CROSS_SIGNAL_RESULT', 'nope'], ['EXECUTION_FIELD_STATE', 'nope'], ['TECHNICAL_FIELD_STATE', 'nope'], ['LINEAGE_OBSERVATION', 'nope']] as const) {
      await rejects(k.submit(x, nm('sup-x'), k.rated(r2.stateId, m, 'L1', 'I1', await until()),
        { support: { status: 'PRESENT', entries: [{ tag, targetId: id }] } }), 'GV010', /SUPPORT_TARGET_UNRESOLVED/);
    }
    assert.deepEqual(await k.counts(x.org), n0);
    // 56. No governed L15 artifact is a support tag (RPC) or a DB target (closed tag CHECK + owner -> target matrix).
    for (const tag of ['GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE', 'RISK_SCENARIO_DEFINITION', 'RISK_METHODOLOGY', 'L15_STATE']) {
      await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('sup-t')), proposal: k.rated(r2.stateId, m, 'L1', 'I1', await until()),
        support: { status: 'PRESENT', entries: [{ tag: tag as never, targetId: a.stateId }] }, fingerprint: BOGUS })), 'GV010', /SUPPORT_TAG_UNKNOWN/);
    }
    const forge = (sql: string) => owner(`begin; alter table gov_repo.l15_support_links disable trigger l15_support_links_insert_guard; ${sql}; rollback;`);
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_risk_assessment_artifact,owner_risk_assessment_state_id,
      target_tag,target_risk_signal_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_ASSESSMENT','STATE','${a.stateId}','RISK_ASSESSMENT',
      '${signal.signal_id}',now())`), '23514');
    // Two typed owners / a missing artifact / a RISK_ASSESSMENT artifact on another owner kind: shape CHECK.
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_risk_assessment_artifact,owner_risk_assessment_state_id,
      owner_risk_assessment_proposal_id,target_tag,target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_ASSESSMENT','STATE',
      '${a.stateId}','${a.submitted.proposal_id}','DISCOVERY_EVIDENCE','${x.evidence}',now())`), '23514');
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_risk_assessment_state_id,target_tag,
      target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_ASSESSMENT','${a.stateId}','DISCOVERY_EVIDENCE','${x.evidence}',now())`), '23514');
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_governed_risk_artifact,owner_governed_risk_state_id,
      owner_risk_assessment_artifact,target_tag,target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','GOVERNED_RISK','STATE',
      '${r.stateId}','STATE','DISCOVERY_EVIDENCE','${x.evidence}',now())`), '23514');
    // A cross-tenant typed owner fails the composite FK.
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_risk_assessment_artifact,owner_risk_assessment_state_id,
      target_tag,target_discovery_evidence_id,recorded_at) values('${other.org}','${randomUUID()}','RISK_ASSESSMENT','STATE','${a.stateId}','DISCOVERY_EVIDENCE',
      '${other.evidence}',now())`), '23503');
    // Late support (owner not written by this transaction) is refused even for the owner; links are immutable.
    await rejects(owner(`begin; insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_risk_assessment_artifact,owner_risk_assessment_state_id,
      target_tag,target_discovery_evidence_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_ASSESSMENT','STATE','${a.stateId}','DISCOVERY_EVIDENCE',
      '${x.evidence}',now()); rollback;`), 'GV010', /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    for (const sql of [`update gov_repo.l15_support_links set recorded_at=now() where owner_kind='RISK_ASSESSMENT'`,
      `delete from gov_repo.l15_support_links where owner_kind='RISK_ASSESSMENT'`]) {
      await rejects(owner(sql), '55000', /L15_HISTORY_IMMUTABLE/);
    }
    // The S1 / S2 / S3 owners keep their own matrices (a registry owner -> RISK_SIGNAL stays refused).
    await rejects(forge(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_registry_artifact,owner_methodology_state_id,
      target_tag,target_risk_signal_id,recorded_at) values('${x.org}','${randomUUID()}','RISK_METHODOLOGY','STATE','${m.stateId}','RISK_SIGNAL',
      '${signal.signal_id}',now())`), '23514');
  });

  await t.test('attacks 57-58 (AJ): SUPPORT != DEPENDENCY — support never substitutes the governed-risk pin or the methodology pin', async () => {
    const r = await freshRisk();
    const signal = await machineSignal('AGENT_VERSION');
    const hyp = await humanHypothesis('AGENT_VERSION', [signal.signal_id]);
    // The risk's own provenance cited as support, with the exact pin missing: refused (support never replaces the pin).
    const support = { status: 'PRESENT', entries: [{ tag: 'RISK_HYPOTHESIS', targetId: hyp.hypothesis_id }, { tag: 'RISK_SIGNAL', targetId: signal.signal_id },
      { tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] } as const;
    const p = k.rated(r.stateId, m, 'L1', 'I1', await until());
    const n0 = await k.counts(x.org);
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('aj-r')), proposal: p, support, raw: { governedRiskStateId: null }, fingerprint: BOGUS })),
      'GV010', /GOVERNED_RISK_STATE_REQUIRED/);
    // Methodology-describing evidence cited as support with the methodology pin missing / not the exact admitted tuple: refused.
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('aj-m1')), proposal: p, support, raw: { methodologyId: null }, fingerprint: BOGUS })),
      'GV010', /METHODOLOGY_IDS_REQUIRED/);
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('aj-m2')), proposal: p, support, raw: { methodologyVersionId: null }, fingerprint: BOGUS })),
      'GV010', /METHODOLOGY_IDS_REQUIRED/);
    await rejects(exec(k.submitSql(x.member, { commandId: x.cmd(nm('aj-m3')), proposal: p, support, raw: { methodologyContentHash: null }, fingerprint: BOGUS })),
      'GV010', /CONTENT_HASH_MALFORMED/);
    assert.deepEqual(await k.counts(x.org), n0);
    // The DB itself: the pins are NOT NULL typed columns with composite FKs (no support column can stand in for them).
    assert.deepEqual(await k.json(`select json_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid='gov_repo.l15_risk_assessment_states'::regclass
      and a.attnotnull and a.attname in ('governed_risk_state_id','governed_risk_subject_key','methodology_id','methodology_version_id',
      'methodology_content_hash','methodology_validated_state_id')`), ['governed_risk_state_id', 'governed_risk_subject_key', 'methodology_content_hash',
      'methodology_id', 'methodology_validated_state_id', 'methodology_version_id']);
    // Support of ANOTHER risk's provenance never binds an assessment to that risk: the assessment pins only its own exact state.
    const other = await freshRisk();
    const a = await k.assess(x, nm('aj-ok'), k.rated(other.stateId, m, 'L2', 'I1', await until()), { support, decideSupport: support });
    assert.equal(await k.resolve(x.org, other.stateId), a.stateId);
    assert.equal(await k.resolve(x.org, r.stateId), null, 'semantic similarity of support is never physical identity of the pin');
    assert.equal(await one(`select governed_risk_state_id from gov_repo.l15_risk_assessment_states where state_id='${a.stateId}'`), other.stateId);
  });

  await t.test('attack 37 / O32: no executable surface carries a caller band; the RPC signatures have no band / score / weight / percentage argument', async () => {
    const args = await one(`select string_agg(pg_get_function_arguments(oid), ' ') from pg_proc where proname in
      ('l15_submit_risk_assessment_proposal_v1','l15_decide_risk_assessment_proposal_v1','l15_read_risk_assessment_v1')`);
    assert.doesNotMatch(args, /band|score|weight|percent|product|rating|domain|subject|scenario|title|description|rationale|lifecycle/i);
    const r = await freshRisk();
    const p = k.rated(r.stateId, m, 'L1', 'I1', await until());
    const sql = k.submitSql(x.member, { commandId: x.cmd(nm('band')), proposal: p }).replace('p_command_id =>', `p_rating_band => 'LOW',\n  p_command_id =>`);
    await rejects(exec(sql), '42883');
    const dsql = k.decideSql(x.assessor, { commandId: x.cmd(nm('band-d')), proposalId: randomUUID(), proposal: p }).replace('p_command_id =>', `p_rating_band => 'LOW',\n  p_command_id =>`);
    await rejects(exec(dsql), '42883');
    assert.equal(await one(`select count(*) from gov_repo.l15_risk_assessment_proposals where organisation_id='${x.org}' and governed_risk_state_id='${r.stateId}'`), '0');
  });

  await t.test('attacks 67-71 / O37 property test: band, levels, hint severity, hypothesis confidence and support count never alter authorization; zero side effects', async () => {
    const cells = Object.keys(NON_MONOTONE_CELLS);
    const risks: Awaited<ReturnType<typeof freshRisk>>[] = [];
    for (let i = 0; i < cells.length; i++) risks.push(await freshRisk());
    // Machine / human provenance with every hint severity and confidence (evidence only).
    const severities = ['info', 'low', 'medium', 'high', 'critical', null];
    const confidences = [0, 0.25, 0.5, 0.75, 1.0, null];
    const signals: string[] = [];
    for (const s of severities) signals.push((await machineSignal('AGENT_VERSION', s, s === null ? null : 1.0)).signal_id);
    const hyps: string[] = [];
    for (const cf of confidences) hyps.push((await humanHypothesis('AGENT_VERSION', signals, cf)).hypothesis_id);
    const unrelatedBefore = await k.unrelatedDigest(x.org);
    const m16b = await m16Digest();
    const outcomes: Array<{ cell: string; band: string; allowRules: string; deny: string; scopeDeny: string }> = [];
    for (let i = 0; i < cells.length; i++) {
      const [l, im] = cells[i]!.split(':') as [string, string];
      const n = i % 9; // 0..8 support entries
      const entries = [...signals.slice(0, Math.min(n, signals.length)).map(id => ({ tag: 'RISK_SIGNAL' as const, targetId: id })),
        ...hyps.slice(0, Math.max(0, n - signals.length)).map(id => ({ tag: 'RISK_HYPOTHESIS' as const, targetId: id }))];
      const support = entries.length ? { status: 'PRESENT' as const, entries } : NONE;
      const p = k.rated(risks[i]!.stateId, m, l, im, await until());
      const sub = await k.submit(x, nm('o37'), p, { support });
      // The same unauthorized actors under the same policy: same deny reason whatever the cell / hint / confidence / count.
      const denied = await exec(k.decideSql(x.validator, { commandId: x.cmd(nm('o37-n')), proposalId: sub.proposal_id, proposal: p, support }));
      // A typed-scope rule that never covers this exact risk subject (MODEL-object rule, or the AGENT_VERSION-kind rule for MODEL).
      const isModel = risks[i]!.subject.subjectType === 'CANONICAL_OBJECT' && (risks[i]!.subject as { canonicalKind: string }).canonicalKind === 'MODEL';
      const scopeDeny = await exec(k.decideSql(isModel ? x.raKind : x.raObject, { commandId: x.cmd(nm('o37-s')), proposalId: sub.proposal_id, proposal: p, support }));
      const ok = await exec(k.decideSql(x.assessor, { commandId: x.cmd(nm('o37-ok')), proposalId: sub.proposal_id, proposal: p, support }));
      const rules = await one(`select string_agg(permission||':'||requested_action||':'||scope_tag, ',' order by permission, requested_action, scope_tag) from gov_repo.l14_authorization_decision_rules
        where authorization_decision_id='${ok.authorization_decision_id}'`);
      outcomes.push({ cell: cells[i]!, band: ok.rating_band, allowRules: `${ok.outcome}|${ok.authorization_result}|${rules}`,
        deny: `${denied.outcome}|${denied.deny_reason}`, scopeDeny: `${scopeDeny.outcome}|${scopeDeny.deny_reason}` });
      assert.equal(ok.rating_band, NON_MONOTONE_CELLS[cells[i]!], 'the band is assessment content (the pinned cell) only');
    }
    assert.deepEqual([...new Set(outcomes.map(o => o.band))].sort(), ['CRITICAL', 'HIGH', 'LOW', 'MODERATE'], 'every band exercised');
    assert.equal(new Set(outcomes.map(o => o.allowRules)).size, 1, JSON.stringify(outcomes.map(o => o.allowRules)));
    assert.equal(outcomes[0]!.allowRules.split('|').slice(0, 2).join('|'), 'VALIDATED|ALLOW');
    assert.deepEqual([...new Set(outcomes.map(o => o.deny))], ['DENIED|NO_MATCHING_AUTHORITY_RULE']);
    // Scope depends only on the risk subject: the MODEL-object rule denies every non-MODEL subject identically.
    assert.deepEqual([...new Set(outcomes.map(o => o.scopeDeny))], ['DENIED|SCOPE_NOT_AUTHORIZED']);
    // Zero governed side effects outside the assessment: GOVERNED_RISK states / heads / proposals, M16 facts / registries,
    // canonical objects / relationships, signals / hypotheses and registry states are byte-identical.
    assert.equal(await k.unrelatedDigest(x.org), unrelatedBefore);
    assert.equal(await m16Digest(), m16b);
    for (const r of risks) assert.equal(await k.k3.resolve(x.org, r.subject, r.scen.id), r.stateId, 'the risk stays VALIDATED and current');
    // No treatment / acceptance store exists (S5 / S6) and S4 created none.
    assert.equal(await one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname ~ '^l15_risk_(treatment|acceptance)'`), '0');
  });

  await t.test('golden vectors: the TypeScript mirrors and the PostgreSQL frames are pinned to the same bytes', async () => {
    // Literal values are the governance-review unit-test goldens (packages/governance-review/test/l15-risk-assessment.test.ts).
    const org = '00000000-0000-4000-8000-000000000041', actor = '00000000-0000-4000-8000-000000000042';
    const pins = `'00000000-0000-4000-8000-0000000000d1','INHERENT','00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3','${'d'.repeat(64)}'`;
    const support = `gov_repo.l15_governed_risk_support_parts_v1('PRESENT', array['RISK_HYPOTHESIS','DISCOVERY_EVIDENCE'],
      array['00000000-0000-4000-8000-0000000000e1','evidence:golden-s4'])`;
    assert.equal(await one(`select gov_repo.l14_sha256_frame_v1(array['L15_COMMAND_FINGERPRINT_V1','SUBMIT_PROPOSAL','${org}','${actor}','RISK_ASSESSMENT',
      'VALIDATE','LOCAL_HUMAN',${pins},'ASSESSMENT_OUTCOME','RATED','LIKELIHOOD_LEVEL','L2','IMPACT_LEVEL','I3','EXPLICIT','2026-10-14T12:00:00.000000Z',
      'VALID_UNTIL','2026-12-14T12:00:00.000000Z','EXPECTED_NONE','NO_TARGET_STATE','NO_PRIOR_PROPOSAL'] || ${support})`),
      'd94053d9b5bea950a7f0e05c0f4df0a50f7807579683db7fc0ef43674efbd952');
    assert.equal(await one(`select gov_repo.l14_sha256_frame_v1(array['L15_COMMAND_FINGERPRINT_V1','DECIDE_PROPOSAL','${org}','${actor}','VALIDATE',
      'RISK_ASSESSMENT_VALIDATED','00000000-0000-4000-8000-0000000000d4','RISK_ASSESSMENT','VALIDATE','LOCAL_HUMAN',${pins},'ASSESSMENT_OUTCOME','RATED',
      'LIKELIHOOD_LEVEL','L2','IMPACT_LEVEL','I3','EXPLICIT','2026-10-14T12:00:00.000000Z','VALID_UNTIL','2026-12-14T12:00:00.000000Z','NO_TARGET_STATE',
      'EXPECTED_NONE'] || ${support})`), '2f80cd23a9393a413c69e9b953677b55f1dd88a211ae2bb1ddaa54bc0b4e75e3');
    assert.equal(await one(`select gov_repo.l14_sha256_frame_v1(array['L15_COMMAND_FINGERPRINT_V1','DECIDE_PROPOSAL','${org}','${actor}','REVOKE',
      'RISK_ASSESSMENT_REVOKED','00000000-0000-4000-8000-0000000000d4','RISK_ASSESSMENT','REVOKE','LOCAL_HUMAN',${pins},'NO_ASSESSMENT_OUTCOME',
      'NO_LIKELIHOOD_LEVEL','NO_IMPACT_LEVEL','IMMEDIATE','NO_VALID_UNTIL','TARGET_STATE','00000000-0000-4000-8000-0000000000d5','EXPECTED_CURRENT',
      '00000000-0000-4000-8000-0000000000d5'] || gov_repo.l15_governed_risk_support_parts_v1('NONE', '{}'::text[], '{}'::text[]))`),
      '727b594f54f8b9c44d101d2a817e362dc9c55d2ecd1f5b40d47bbe78f74cb31b');
    for (const [fn, frame] of [['l15_submit_risk_assessment_proposal_v1', "'SUBMIT_PROPOSAL'"], ['l15_decide_risk_assessment_proposal_v1', "'DECIDE_PROPOSAL'"]]) {
      assert.equal(await one(`select prosrc ~ ${lit(`L15_COMMAND_FINGERPRINT_V1', ${frame}`)} from pg_proc where proname='${fn}'`), 't', fn);
    }
  });

  await t.test('O07 / O13 invariants: M16 history byte-identical; four L15 families possible; no L15 row in l14_fact_states / l14_registry_states', async () => {
    assert.equal(await m16Digest(), m16Before);
    assert.equal(await one(`select count(*) from gov_repo.l14_fact_states where subject_kind not in ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT',
      'POLICY_APPLICABILITY','CONTROL_APPLICABILITY','CONTROL_ASSESSMENT')`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_registry_states r join gov_repo.l14_governance_decisions d
      on d.organisation_id=r.organisation_id and d.governance_decision_id=r.governance_decision_id where d.subject_kind='RISK_ASSESSMENT'`), '0');
    assert.equal(await one(`select count(*) from gov_repo.l14_proposals where subject_kind in ('RISK_SIGNAL','RISK_HYPOTHESIS')`), '0');
  });
});
