import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  controlAssessmentSignal, crossSignalResultSignal, executionContextSignal, governanceGapSignal, lineageSignal, runtimeObservationSignal,
  type L15MachineHypothesisCommand,
} from '@council/canonical-contracts';
import { detectedRiskToSignal } from '@council/scanner/l15';
import { lastLine } from '../helpers/m16-l14-fixtures';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import {
  MACHINE, UNBOUND, machineHypothesisSql, machineSignalSql, hypothesisOps, objectSubject, relSubject, signalOps, unresolved,
  m17s1Kit, type SignalOps,
} from '../helpers/m17-s1-fixtures';

/**
 * M17-S1 — RISK_SIGNAL + RISK_HYPOTHESIS + l15_support_links (D-03) + bounded intake / replay + adapters on real disposable
 * PostgreSQL 17 (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§4, 5, 9, 12, 17; O08-O18, O79-O82, O84 and the S1-affected inherited
 * O01 / O02 / O07 / O13 / O14 / O59 / O73 / O74 / O76 / O88). Upstream rows are real: M16 CONTROL_ASSESSMENT / APPLICABILITY
 * through the real M16 RPCs, an L12 observation through the real admission RPC, M15 rows of each outcome, L11 / technical /
 * lineage / discovery-evidence / source-assertion administrator rows. Every L15 write goes through the real S1 RPCs.
 */
test('M17-S1 signals / hypotheses / support (disposable PG17)', { timeout: 3_600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S1' });
  t.after(() => c.stop());
  const { owner, svc, rejects, bootstrapSql } = c;
  const k = await m17s1Kit(c);
  const ca = await controlAssessmentKit(c);
  const ctx = await ca.setup();
  const other = await ca.setup();
  const rt = await k.runtime();
  const A = ctx.org, B = other.org, R = rt.org;
  const O = ctx.objects.byKind;
  const machine = (o: SignalOps) => k.run(k.machine, machineSignalSql(o));
  const machineH = (o: Parameters<typeof machineHypothesisSql>[0]) => k.run(k.machine, machineHypothesisSql(o));
  const evA = await k.evidence(A), evA2 = await k.evidence(A), evB = await k.evidence(B), evR = await k.evidence(R);
  const techA = await k.technicalState(A), techB = await k.technicalState(B);
  const toolA = await k.object(A, 'TOOL');
  const memberR = await c.mkUser(R, [c.memberRole]);
  // M16 CONTROL_ASSESSMENT history: NOT_SATISFIED (admissible), SATISFIED (not), a REVOKED tombstone (not), and an APPLIES
  // control applicability with no assessment (a deterministic governance gap).
  const appNs = await ca.applicability(ctx, 'ns', ca.cak.objectTarget('TOOL', O.TOOL));
  const notSatisfied = await ca.assess(ctx, 'ns', appNs.stateId, { outcome: 'NOT_SATISFIED' });
  const appSat = await ca.applicability(ctx, 'sat', ca.cak.objectTarget('MODEL', O.MODEL));
  const satisfied = await ca.assess(ctx, 'sat', appSat.stateId, { outcome: 'SATISFIED' });
  const appRv = await ca.applicability(ctx, 'rv', ca.cak.objectTarget('API', O.API));
  const partial = await ca.assess(ctx, 'rv', appRv.stateId, { outcome: 'PARTIALLY_SATISFIED' });
  const tombstone = (await ca.revoke(ctx, 'rv', appRv.stateId, partial.stateId, 'PARTIALLY_SATISFIED')).decided.fact_state_id as string;
  const appGap = await ca.applicability(ctx, 'gap', ca.cak.objectTarget('AGENT_VERSION', O.AGENT_VERSION));
  const appForeign = await ca.applicability(other, 'foreign', ca.cak.objectTarget('TOOL', other.objects.byKind.TOOL));
  const notSatForeign = await ca.assess(other, 'foreign', appForeign.stateId, { outcome: 'NOT_SATISFIED' });

  const base = (org: string, key: string, kind: string, objectId: string) =>
    ({ organisationId: org, intakeKey: key, subject: { mode: 'CANONICAL_OBJECT' as const, kind: kind as never, canonicalObjectId: objectId },
      methodId: 'S1_TEST_ADAPTER', methodVersion: '1.0.0' });
  const detected = (org: string, key: string, ev: string, severity: 'critical' | 'info' = 'critical', id = 'RISK-NO-LICENSE') =>
    signalOps(detectedRiskToSignal({ id, severity, category: 'legal', title: 't', description: 'd', recommendation: 'r' },
      { organisationId: org, intakeKey: key, subject: { mode: 'CANONICAL_OBJECT', kind: 'AGENT_VERSION', canonicalObjectId: org === A ? O.AGENT_VERSION : other.objects.byKind.AGENT_VERSION },
        detectorVersion: '1.0.0', evidence: [{ tag: 'DISCOVERY_EVIDENCE', targetId: ev }] }));
  const govBefore = await k.governanceCounts();
  const m16Before = await ca.historyDigest(A);
  const toolCurrentBefore = await ca.current(A, ca.cak.objectTarget('TOOL', O.TOOL));

  await t.test('signal store: every adapter path admits an exact, non-authoritative, evidence-backed reference', async () => {
    // Scanner DetectedRisk adapter (DETECTED_ABSENCE / DETECTED_PATTERN, hint_severity only).
    const absence = await machine(detected(A, 'scan-1:RISK-NO-LICENSE', evA));
    const pattern = await machine(detected(A, 'scan-1:RISK-DEV-UNLOCK', evA, 'critical', 'RISK-DEV-UNLOCK'));
    assert.equal(absence.replayed, false);
    const row = await k.json(`select to_json(s) from gov_repo.l15_risk_signals s where signal_id='${absence.signal_id}'`);
    assert.deepEqual([row.signal_kind, row.source_class, row.trust_state, row.method_id, row.method_version, row.hint_severity,
      row.hint_confidence, row.observed_at, row.support_status, row.admitted_by_technical_identity, row.submitted_by_user_id],
    ['DETECTED_ABSENCE', 'SYSTEM_DETECTOR', 'INFERRED', 'SCANNER_DETECTED_RISK:RISK-NO-LICENSE', '1.0.0', 'critical', null, null, 'PRESENT', MACHINE, null]);
    assert.equal((await k.json(`select to_json(s) from gov_repo.l15_risk_signals s where signal_id='${pattern.signal_id}'`)).signal_kind, 'DETECTED_PATTERN');
    // M15: CONFLICT_CANDIDATE / INSUFFICIENT_EVIDENCE accepted, exact reference only (no outcome column in L15).
    for (const [key, id, outcome] of [['m15-conflict', rt.conflict, 'CONFLICT_CANDIDATE'], ['m15-insufficient', rt.insufficient, 'INSUFFICIENT_EVIDENCE']] as const) {
      const r = await machine(signalOps(crossSignalResultSignal(base(R, key, 'AGENT_VERSION', rt.agentVersion), { comparisonId: id, outcome })));
      const s = await k.json(`select to_json(s) from gov_repo.l15_risk_signals s where signal_id='${r.signal_id}'`);
      assert.deepEqual([s.signal_kind, s.source_class, s.trust_state], ['CROSS_SIGNAL_RESULT_REF', 'GOVERNED_FACT_REFERENCE', null]);
    }
    // L12 runtime (OBSERVED), L11 execution, lineage, imported assertion.
    await machine(signalOps(runtimeObservationSignal(base(R, 'l12-1', 'AGENT_VERSION', rt.agentVersion), [rt.observationId])));
    await machine(signalOps(executionContextSignal(base(R, 'l11-1', 'AGENT_VERSION', rt.agentVersion), [rt.executionStateId])));
    await machine(signalOps(lineageSignal(base(R, 'lin-1', 'AGENT_VERSION', rt.agentVersion), [rt.lineageFindingId])));
    await machine({ org: R, key: 'imp-1', kind: 'IMPORTED_ASSERTION', source: 'SOURCE_CONNECTION', subject: unresolved('AMBIGUOUS_MAPPING'),
      trust: 'IMPORTED', methodId: 'REGISTER_IMPORT', methodVersion: '2', hintSeverity: 'high', hintConfidence: 0.4, tags: ['SOURCE_ASSERTION'], ids: [rt.assertionId] });
    // M16 control assessment reference + technical field evidence for a detector.
    await machine(signalOps(controlAssessmentSignal(base(A, 'ca-ns', 'TOOL', O.TOOL), { factStateId: notSatisfied.stateId, outcome: 'NOT_SATISFIED' })));
    await machine({ ...detected(A, 'tech-1', evA), tags: ['TECHNICAL_FIELD_STATE'], ids: [techA] });
    // No copied upstream value: L15 has no metric / outcome / cost / text / domain column at all.
    const columns = (await k.json(`select json_agg(column_name order by column_name) from information_schema.columns where table_schema='gov_repo'
      and table_name in ('l15_risk_signals','l15_risk_hypotheses','l15_support_links')`)) as string[];
    for (const forbidden of ['latency', 'duration', 'error', 'token', 'cost', 'amount', 'estimate', 'monthly', 'outcome', 'domain', 'rating',
      'score', 'status_', 'lifecycle', 'title', 'description', 'category', 'owner_user', 'scenario', 'state_kind', 'head']) {
      assert.ok(!columns.some(col => col.includes(forbidden)), `no ${forbidden} column: ${columns.filter(x => x.includes(forbidden))}`);
    }
    assert.ok(!columns.includes('status'), 'no mutable status column');
  });

  await t.test('O10: a CONSISTENT M15 result never becomes a signal (adapter and DB)', async () => {
    assert.throws(() => crossSignalResultSignal(base(R, 'm15-c', 'AGENT_VERSION', rt.agentVersion), { comparisonId: rt.consistent, outcome: 'CONSISTENT' }),
      /CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE/);
    const forged = signalOps(crossSignalResultSignal(base(R, 'm15-c', 'AGENT_VERSION', rt.agentVersion), { comparisonId: rt.conflict, outcome: 'CONFLICT_CANDIDATE' }));
    await rejects(machine({ ...forged, ids: [rt.consistent] }), 'L15_INVALID_COMMAND', /CROSS_SIGNAL_RESULT_NOT_ADMISSIBLE/);
  });

  await t.test('M16 adapter: only admissible VALIDATED CONTROL_ASSESSMENT outcomes; SATISFIED and REVOKED tombstones rejected', async () => {
    assert.throws(() => controlAssessmentSignal(base(A, 'x', 'MODEL', O.MODEL), { factStateId: satisfied.stateId, outcome: 'SATISFIED' }));
    const ok = signalOps(controlAssessmentSignal(base(A, 'ca-forged', 'MODEL', O.MODEL), { factStateId: notSatisfied.stateId, outcome: 'NOT_SATISFIED' }));
    await rejects(machine({ ...ok, ids: [satisfied.stateId] }), 'L15_INVALID_COMMAND', /CONTROL_ASSESSMENT_NOT_ADMISSIBLE/);
    await rejects(machine({ ...ok, key: 'ca-tomb', ids: [tombstone] }), 'L15_INVALID_COMMAND', /CONTROL_ASSESSMENT_NOT_ADMISSIBLE/);
    // An L14 fact of another family is not a CONTROL_ASSESSMENT_REF target (kind -> target CHECK).
    await rejects(machine({ ...ok, key: 'ca-app', ids: [appNs.stateId] }), 'L15_INVALID_COMMAND', /CONTROL_ASSESSMENT_NOT_ADMISSIBLE/);
  });

  await t.test('GOVERNANCE_GAP_REF: deterministic M16 read at DB-authored coordinates; UNKNOWN != FALSE; no M16 write', async () => {
    const digest = await ca.historyDigest(A);
    const ra = await machine(signalOps(governanceGapSignal(base(A, 'gap-owner', 'DATA_ASSET', O.DATA_ASSET),
      { family: 'RESPONSIBILITY_ASSIGNMENT', responsibilityRole: 'DATA_OWNER' }, [{ tag: 'DISCOVERY_EVIDENCE', targetId: evA }])));
    const g = await k.json(`select to_json(s) from gov_repo.l15_risk_signals s where signal_id='${ra.signal_id}'`);
    assert.equal(g.gap_effective_at, g.recorded_at);
    assert.equal(g.gap_recorded_cutoff, g.recorded_at);
    assert.deepEqual([g.gap_fact_family, g.gap_responsibility_role, g.trust_state], ['RESPONSIBILITY_ASSIGNMENT', 'DATA_OWNER', null]);
    const reads = await k.json(k.readSignalsSql(ctx.member, objectSubject('DATA_ASSET', O.DATA_ASSET)), svc);
    assert.equal(reads.find((r: any) => r.signal_id === ra.signal_id).observation_presentation, 'unknown');
    // Control assessment gap: the control APPLIES and is unassessed -> admitted; assessed -> not a gap; not applicable -> not required.
    const gap = (key: string, kind: string, id: string, control: string) => machine(signalOps(governanceGapSignal(base(A, key, kind, id),
      { family: 'CONTROL_ASSESSMENT', controlDefinitionId: control }, [{ tag: 'L14_FACT_STATE', targetId: appGap.stateId }])));
    await gap('gap-ca', 'AGENT_VERSION', O.AGENT_VERSION, appGap.pin.subject.controlDefinitionId);
    await rejects(gap('gap-ca-assessed', 'TOOL', O.TOOL, appNs.pin.subject.controlDefinitionId), 'L15_INVALID_COMMAND', /GOVERNANCE_GAP_NOT_UNKNOWN/);
    await rejects(gap('gap-ca-none', 'PROMPT', O.PROMPT, appNs.pin.subject.controlDefinitionId), 'L15_INVALID_COMMAND', /GOVERNANCE_GAP_NOT_REQUIRED/);
    // Illegal gap shapes (role x kind matrix, UNRESOLVED subject).
    await rejects(machine({ ...signalOps(governanceGapSignal(base(A, 'gap-bad', 'TOOL', O.TOOL),
      { family: 'RESPONSIBILITY_ASSIGNMENT', responsibilityRole: 'DATA_OWNER' }, [{ tag: 'DISCOVERY_EVIDENCE', targetId: evA }])) }), '23514', /gap_shape_check/);
    await rejects(machine({ ...signalOps(governanceGapSignal(base(A, 'gap-unres', 'TOOL', O.TOOL),
      { family: 'CONTROL_ASSESSMENT', controlDefinitionId: appGap.pin.subject.controlDefinitionId }, [{ tag: 'DISCOVERY_EVIDENCE', targetId: evA }])),
      subject: unresolved() }), 'L15_INVALID_COMMAND', /GOVERNANCE_GAP_SUBJECT_INVALID/);
    assert.equal(await ca.historyDigest(A), digest, 'no M16 history row changed; no negative fact created');
  });

  await t.test('LOCAL_HUMAN: verified ACTIVE member only; explicit NONE support; no trust / method; observed_at only when evidenced', async () => {
    const none = await k.run(svc, k.humanSignalSql(ctx.member, 'h-none', objectSubject('AGENT', O.AGENT)));
    const s = await k.json(`select to_json(s) from gov_repo.l15_risk_signals s where signal_id='${none.signal_id}'`);
    assert.deepEqual([s.signal_kind, s.source_class, s.trust_state, s.method_id, s.support_status, s.submitted_by_user_id, s.observed_at],
      ['HUMAN_OBSERVATION', 'LOCAL_HUMAN', null, null, 'NONE', ctx.member.id, null]);
    await k.run(svc, k.humanSignalSql(ctx.member, 'h-ev', relSubject(ctx.rels.reads.relationshipId, ctx.rels.reads.relationshipStateId),
      ['DISCOVERY_EVIDENCE', 'L14_FACT_STATE'], [evA, notSatisfied.stateId], new Date(Date.now() - 3600_000).toISOString()));
    await rejects(svc(k.humanSignalSql(ctx.member, 'h-obs', objectSubject('AGENT', O.AGENT), [], [], new Date(Date.now() - 1000).toISOString())),
      'L15_INVALID_COMMAND', /OBSERVED_AT_UNEVIDENCED/);
    await rejects(svc(k.humanSignalSql(ctx.member, 'h-future', objectSubject('AGENT', O.AGENT), ['DISCOVERY_EVIDENCE'], [evA],
      new Date(Date.now() + 86_400_000).toISOString())), 'L15_INVALID_COMMAND', /OBSERVED_AT_UNEVIDENCED/);
    // Cross-tenant principal (member of A claiming B), suspended member -> eligibility refusal, nothing written.
    await rejects(svc(k.humanSignalSql(ctx.member, 'h-x', objectSubject('AGENT', other.objects.byKind.AGENT), [], [], null, B)), 'GV003');
    const suspended = await c.mkUser(A, [c.memberRole]);
    await owner(`update gov_repo.governance_users set status='suspended' where user_id='${suspended.id}'`);
    await rejects(svc(k.humanSignalSql(suspended, 'h-susp', objectSubject('AGENT', O.AGENT))), 'GV003');
    // The machine path refuses LOCAL_HUMAN / HUMAN_OBSERVATION.
    await rejects(machine({ org: A, key: 'm-h', kind: 'HUMAN_OBSERVATION', source: 'LOCAL_HUMAN', subject: objectSubject('AGENT', O.AGENT),
      tags: ['DISCOVERY_EVIDENCE'], ids: [evA] }), 'L15_INVALID_COMMAND', /LOCAL_HUMAN_REQUIRES_VERIFIED_MEMBER/);
  });

  const sigA1 = (await machine(detected(A, 'h-src-1', evA))).signal_id as string;
  const sigA2 = (await machine(detected(A, 'h-src-2', evA2, 'info', 'RISK-NO-README'))).signal_id as string;
  const sigB = (await machine(detected(B, 'h-src-b', evB))).signal_id as string;
  const hyp = (patch: Partial<L15MachineHypothesisCommand>): L15MachineHypothesisCommand => ({ organisationId: A, intakeKey: 'h-1',
    generatorKind: 'DETERMINISTIC_RULE', subject: { mode: 'CANONICAL_OBJECT', kind: 'AGENT_VERSION', canonicalObjectId: O.AGENT_VERSION },
    methodId: 'RULE_SET', methodVersion: '1', llm: null, traversalPolicyVersion: null, representationVersion: null, hintConfidence: null,
    citedSignalIds: [sigA1], ...patch });

  await t.test('hypothesis store: every generator with its exact provenance; INFERRED / none; disposition UNREVIEWED; contradictions coexist', async () => {
    const det = await machineH(hypothesisOps(hyp({ intakeKey: 'h-det', hintConfidence: 1 })));
    const graph = await machineH(hypothesisOps(hyp({ intakeKey: 'h-graph', generatorKind: 'GRAPH_ANALYSIS', traversalPolicyVersion: 'GOVIA_BLAST_RADIUS_V1', citedSignalIds: [sigA1, sigA2] })));
    const vector = await machineH(hypothesisOps(hyp({ intakeKey: 'h-vec', generatorKind: 'VECTOR_RETRIEVAL', representationVersion: 'text-embedding-3-small@1' })));
    const llm = await machineH(hypothesisOps(hyp({ intakeKey: 'h-llm', generatorKind: 'LLM_ASSISTED',
      llm: { modelProvider: 'anthropic', modelId: 'model-x', promptTemplateVersion: 'p-1' } })));
    const human = await k.run(svc, k.humanHypothesisSql(ctx.member, 'h-human', objectSubject('AGENT_VERSION', O.AGENT_VERSION), [sigA2]));
    const rows = await k.json(`select json_object_agg(hypothesis_id, json_build_array(generator_kind, trust_state, method_id, model_provider,
      traversal_policy_version, representation_version)) from gov_repo.l15_risk_hypotheses where organisation_id='${A}'`);
    assert.deepEqual(rows[det.hypothesis_id], ['DETERMINISTIC_RULE', 'INFERRED', 'RULE_SET', null, null, null]);
    assert.deepEqual(rows[graph.hypothesis_id], ['GRAPH_ANALYSIS', 'INFERRED', 'RULE_SET', null, 'GOVIA_BLAST_RADIUS_V1', null]);
    assert.deepEqual(rows[vector.hypothesis_id], ['VECTOR_RETRIEVAL', 'INFERRED', 'RULE_SET', null, null, 'text-embedding-3-small@1']);
    assert.deepEqual(rows[llm.hypothesis_id], ['LLM_ASSISTED', 'INFERRED', 'RULE_SET', 'anthropic', null, null]);
    assert.deepEqual(rows[human.hypothesis_id], ['HUMAN', null, null, null, null, null]);
    const dispositions = await k.json(k.dispositionsSql(ctx.member, objectSubject('AGENT_VERSION', O.AGENT_VERSION)), svc) as any[];
    assert.equal(dispositions.length, 5, 'contradictory / overlapping hypotheses coexist side by side, none selected');
    assert.ok(dispositions.every(d => d.disposition === 'UNREVIEWED' && d.authority === 'NON_AUTHORITATIVE'));
    assert.equal(dispositions.find(d => d.hypothesis_id === graph.hypothesis_id).cited_signal_count, 2);
    // The optional scenario reference is deferred to S2: no column, no fake registry.
    assert.equal(await k.one(`select count(*) from information_schema.columns where table_schema='gov_repo' and column_name like '%scenario%'`), '0');
    assert.equal(await k.one(`select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname ~ '^l15_'
      and relname ~ 'scenario|methodology|governed_risk|assessment|treatment|acceptance|residual'`), '0', 'no S2+ L15 store exists');
  });

  await t.test('O12 / hypothesis adversarial: zero signals, missing provenance tuples, UNRESOLVED subject, cross-tenant signal, human generator via machine', async () => {
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-0' })), signals: [] }), 'L15_INVALID_COMMAND', /HYPOTHESIS_REQUIRES_SIGNAL/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-null' })), signals: null }), 'L15_INVALID_COMMAND', /HYPOTHESIS_REQUIRES_SIGNAL/);
    await rejects(svc(k.humanHypothesisSql(ctx.member, 'hx-h0', objectSubject('AGENT', O.AGENT), [])), 'L15_INVALID_COMMAND', /HYPOTHESIS_REQUIRES_SIGNAL/);
    const llm = hypothesisOps(hyp({ intakeKey: 'hx-llm', generatorKind: 'LLM_ASSISTED', llm: { modelProvider: 'p', modelId: 'm', promptTemplateVersion: 'v' } }));
    for (const drop of ['modelProvider', 'modelId', 'promptVersion'] as const) {
      await rejects(machineH({ ...llm, [drop]: null }), 'L15_INVALID_COMMAND', /LLM_PROVENANCE_REQUIRED/);
    }
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-g' })), generator: 'GRAPH_ANALYSIS' }), 'L15_INVALID_COMMAND', /TRAVERSAL_POLICY_VERSION_REQUIRED/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-v' })), generator: 'VECTOR_RETRIEVAL' }), 'L15_INVALID_COMMAND', /REPRESENTATION_VERSION_REQUIRED/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-m' })), methodVersion: null }), 'L15_INVALID_COMMAND', /METHOD_VERSION_REQUIRED/);
    // A stray LLM tuple on a non-LLM generator is not silently stored.
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-stray' })), modelProvider: 'p', modelId: 'm', promptVersion: 'v' }), '23514', /provenance_check/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-u' })), subject: unresolved() }), 'L15_INVALID_COMMAND', /SUBJECT_SHAPE_INVALID/);
    await rejects(machineH(hypothesisOps(hyp({ intakeKey: 'hx-x', citedSignalIds: [sigB] }))), 'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-human' })), generator: 'HUMAN' }), 'L15_INVALID_COMMAND', /HUMAN_REQUIRES_VERIFIED_MEMBER/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-unknown' })), generator: 'ORACLE' }), 'L15_INVALID_COMMAND', /GENERATOR_KIND_UNKNOWN/);
    await rejects(machineH({ ...hypothesisOps(hyp({ intakeKey: 'hx-dup' })), signals: [sigA1, sigA1] }), 'L15_INVALID_COMMAND', /SUPPORT_DUPLICATE/);
  });

  await t.test('replay: identical retry returns the original id + recorded_at; changed content -> REPLAY_CONFLICT (signals, hypotheses, human)', async () => {
    const op = detected(A, 'replay-1', evA);
    const first = await machine(op);
    const again = await machine(op);
    assert.deepEqual([again.signal_id, again.recorded_at, again.semantic_fingerprint, again.replayed], [first.signal_id, first.recorded_at, first.semantic_fingerprint, true]);
    // Support order does not change the content; any semantic change does.
    const multi = { ...op, key: 'replay-2', tags: ['DISCOVERY_EVIDENCE', 'DISCOVERY_EVIDENCE'], ids: [evA, evA2] };
    const m1 = await machine(multi);
    assert.equal((await machine({ ...multi, ids: [evA2, evA] })).signal_id, m1.signal_id);
    for (const changed of [{ hintSeverity: 'info' }, { ids: [evA2] }, { methodVersion: '1.0.1' }, { trust: 'DECLARED' },
      { subject: objectSubject('TOOL', O.TOOL) }, { hintConfidence: 0.5 }]) {
      await rejects(machine({ ...op, ...changed }), 'L15_REPLAY_CONFLICT');
    }
    assert.equal(await k.one(`select count(*) from gov_repo.l15_risk_signals where organisation_id='${A}' and intake_key='replay-1'`), '1');
    const h = hypothesisOps(hyp({ intakeKey: 'replay-h' }));
    const h1 = await machineH(h);
    const h2 = await machineH(h);
    assert.deepEqual([h2.hypothesis_id, h2.recorded_at, h2.replayed], [h1.hypothesis_id, h1.recorded_at, true]);
    await rejects(machineH({ ...h, signals: [sigA1, sigA2] }), 'L15_REPLAY_CONFLICT');
    const hs = k.humanSignalSql(ctx.member, 'replay-human', objectSubject('AGENT', O.AGENT));
    const hs1 = await k.run(svc, hs);
    assert.equal((await k.run(svc, hs)).signal_id, hs1.signal_id);
    // Another actor reusing the same intake key is different content.
    await rejects(svc(k.humanSignalSql(ctx.as, 'replay-human', objectSubject('AGENT', O.AGENT))), 'L15_REPLAY_CONFLICT');
  });

  await t.test('concurrency: same intake_key identical -> one row, replay; conflicting -> REPLAY_CONFLICT', async () => {
    for (const conflicting of [false, true]) {
      const key = `race-${conflicting}`;
      const s1 = c.session(MACHINE as never), s2 = c.session(MACHINE as never);
      try {
        await s1.run('begin;');
        const first = await s1.run(machineSignalSql(detected(A, key, evA)));
        assert.equal(first.err, '', first.err);
        const pending = s2.run(machineSignalSql(detected(A, key, conflicting ? evA2 : evA)));
        // s2 waits on the intake-key guard held by s1 (observed, never assumed by sleeping).
        for (let i = 0; i < 200; i++) {
          if (lastLine(await bootstrapSql(`select count(*) from pg_stat_activity where usename='${MACHINE}' and wait_event_type='Lock'`)) === '1') break;
          await new Promise(r => setTimeout(r, 25));
        }
        assert.equal(lastLine(await bootstrapSql(`select count(*) from pg_stat_activity where usename='${MACHINE}' and wait_event_type='Lock'`)), '1');
        await s1.run('commit;');
        const second = await pending;
        const id = JSON.parse(first.out.split('\n').pop()!).signal_id;
        if (conflicting) assert.match(second.err, /L15_REPLAY_CONFLICT/);
        else {
          const r = JSON.parse(second.out.split('\n').pop()!);
          assert.deepEqual([r.signal_id, r.replayed], [id, true]);
        }
        assert.equal(await k.one(`select count(*) from gov_repo.l15_risk_signals where organisation_id='${A}' and intake_key='${key}'`), '1');
      } finally { await s1.close(); await s2.close(); }
    }
  });

  await t.test('adversarial suite (signals / support / identity)', async () => {
    const ok = detected(A, 'adv', evA);
    // 1. cross-tenant canonical subject; 2. cross-tenant relationship-state subject.
    await rejects(machine({ ...ok, key: 'adv-1', subject: objectSubject('AGENT_VERSION', other.objects.byKind.AGENT_VERSION) }), 'L15_INVALID_COMMAND', /SUBJECT_OBJECT_UNRESOLVED/);
    await rejects(machine({ ...ok, key: 'adv-2', subject: relSubject(other.rels.reads.relationshipId, other.rels.reads.relationshipStateId) }),
      'L15_INVALID_COMMAND', /SUBJECT_RELATIONSHIP_STATE_UNRESOLVED/);
    // Bare / mismatched relationship state ids and a wrong declared kind never resolve.
    await rejects(machine({ ...ok, key: 'adv-2b', subject: relSubject(ctx.rels.reads.relationshipId, ctx.rels.exposes.relationshipStateId) }),
      'L15_INVALID_COMMAND', /SUBJECT_RELATIONSHIP_STATE_UNRESOLVED/);
    await rejects(machine({ ...ok, key: 'adv-2c', subject: { mode: 'RELATIONSHIP_STATE', stateId: ctx.rels.reads.relationshipStateId } }),
      'L15_INVALID_COMMAND', /SUBJECT_SHAPE_INVALID/);
    await rejects(machine({ ...ok, key: 'adv-2d', subject: objectSubject('AGENT', O.AGENT_VERSION) }), 'L15_INVALID_COMMAND', /SUBJECT_OBJECT_UNRESOLVED/);
    await rejects(machine({ ...ok, key: 'adv-2e', subject: unresolved('BECAUSE') }), 'L15_INVALID_COMMAND', /SUBJECT_SHAPE_INVALID/);
    // 3. cross-tenant evidence target, one case per implemented rank-0 tag (signal path) + RISK_SIGNAL (hypothesis path).
    const crossTenant: Array<[string, string, string, string]> = [
      ['DETECTED_PATTERN', 'SYSTEM_DETECTOR', 'DISCOVERY_EVIDENCE', evB],
      ['DETECTED_PATTERN', 'SYSTEM_DETECTOR', 'SOURCE_ASSERTION', rt.assertionId],
      ['DETECTED_PATTERN', 'SYSTEM_DETECTOR', 'TECHNICAL_FIELD_STATE', techB],
      ['RUNTIME_OBSERVATION_REF', 'RUNTIME_SOURCE', 'RUNTIME_OBSERVATION', rt.observationId],
      ['CROSS_SIGNAL_RESULT_REF', 'GOVERNED_FACT_REFERENCE', 'CROSS_SIGNAL_RESULT', rt.conflict],
      ['EXECUTION_CONTEXT_REF', 'GOVERNED_FACT_REFERENCE', 'EXECUTION_FIELD_STATE', rt.executionStateId],
      ['LINEAGE_REF', 'GOVERNED_FACT_REFERENCE', 'LINEAGE_OBSERVATION', rt.lineageFindingId],
      ['CONTROL_ASSESSMENT_REF', 'GOVERNED_FACT_REFERENCE', 'L14_FACT_STATE', notSatForeign.stateId],
    ];
    for (const [kind, source, tag, id] of crossTenant) {
      const trust = source === 'SYSTEM_DETECTOR' ? 'INFERRED' : source === 'RUNTIME_SOURCE' ? 'OBSERVED' : null;
      await rejects(machine({ org: A, key: `adv-3-${tag}`, kind, source, subject: objectSubject('TOOL', O.TOOL), trust,
        methodId: 'M', methodVersion: '1', tags: [tag], ids: [id] }), 'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
      // and the human path (any rank-0 tag) refuses the same foreign target
      await rejects(svc(k.humanSignalSql(ctx.member, `adv-3h-${tag}`, objectSubject('TOOL', O.TOOL), [tag], [id])),
        'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
    }
    // 4. wrong evidence tag with a correct-looking id; unknown tag.
    await rejects(machine({ ...ok, key: 'adv-4a', tags: ['SOURCE_ASSERTION'], ids: [evA] }), 'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
    await rejects(machine({ ...ok, key: 'adv-4b', kind: 'RUNTIME_OBSERVATION_REF', source: 'RUNTIME_SOURCE', trust: 'OBSERVED', subject: unresolved(), hintSeverity: null,
      org: R, tags: ['RUNTIME_OBSERVATION'], ids: [notSatisfied.stateId] }), 'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
    await rejects(machine({ ...ok, key: 'adv-4c', tags: ['GOV_REPO_EVIDENCE'], ids: [evA] }), 'L15_INVALID_COMMAND', /SUPPORT_TAG_UNKNOWN/);
    await rejects(machine({ ...ok, key: 'adv-4d', tags: ['DISCOVERY_EVIDENCE'], ids: ['free text that is not an evidence id'] }),
      'L15_INVALID_COMMAND', /SUPPORT_TARGET_UNRESOLVED/);
    // 5. unsupported owner -> target (signal kind -> tag and signal -> signal / hypothesis).
    await rejects(machine({ org: R, key: 'adv-5a', kind: 'RUNTIME_OBSERVATION_REF', source: 'RUNTIME_SOURCE', trust: 'OBSERVED', subject: unresolved(),
      methodId: 'M', methodVersion: '1', tags: ['DISCOVERY_EVIDENCE'], ids: [evR] }), '23514', /signal_kind_target_check/);
    await rejects(machine({ ...ok, key: 'adv-5b', tags: ['RISK_SIGNAL'], ids: [sigA1] }), '23514', /owner_target_matrix_check/);
    // 8. forged VALIDATED trust; wrong trust for a source; trust on a GOVERNED_FACT_REFERENCE.
    await rejects(machine({ ...ok, key: 'adv-8a', trust: 'VALIDATED' }), 'L15_INVALID_COMMAND', /TRUST_VALIDATED_FORBIDDEN/);
    await rejects(machine({ ...ok, key: 'adv-8b', trust: 'OBSERVED' }), 'L15_INVALID_COMMAND', /TRUST_SOURCE_MISMATCH/);
    const ref = signalOps(executionContextSignal(base(R, 'adv-8c', 'AGENT_VERSION', rt.agentVersion), [rt.executionStateId]));
    await rejects(machine({ ...ref, trust: 'INFERRED' }), 'L15_INVALID_COMMAND', /TRUST_SOURCE_MISMATCH/);
    await rejects(machine({ ...ref, key: 'adv-8d', hintSeverity: 'critical' }), 'L15_INVALID_COMMAND', /HINT_NOT_ADMISSIBLE/);
    // 9. missing method / version; 10. missing machine evidence.
    await rejects(machine({ ...ok, key: 'adv-9a', methodId: null }), 'L15_INVALID_COMMAND', /METHOD_VERSION_REQUIRED/);
    await rejects(machine({ ...ok, key: 'adv-9b', methodVersion: null }), 'L15_INVALID_COMMAND', /METHOD_VERSION_REQUIRED/);
    await rejects(machine({ ...ok, key: 'adv-10a', tags: [], ids: [] }), 'L15_INVALID_COMMAND', /MACHINE_SIGNAL_REQUIRES_EVIDENCE/);
    await rejects(machine({ ...ok, key: 'adv-10b', tags: null, ids: null }), 'L15_INVALID_COMMAND', /MACHINE_SIGNAL_REQUIRES_EVIDENCE/);
    await rejects(machine({ ...ok, key: 'adv-10c', tags: ['DISCOVERY_EVIDENCE'], ids: [] }), 'L15_INVALID_COMMAND', /SUPPORT_SHAPE_INVALID/);
    // Unknown kind / source; wrong source x kind combination.
    await rejects(machine({ ...ok, key: 'adv-k1', kind: 'RISK_SCORE' }), 'L15_INVALID_COMMAND', /SIGNAL_KIND_UNKNOWN/);
    await rejects(machine({ ...ok, key: 'adv-k2', source: 'SCANNER' }), 'L15_INVALID_COMMAND', /SOURCE_CLASS_UNKNOWN/);
    await rejects(machine({ ...ok, key: 'adv-k3', source: 'SOURCE_CONNECTION', trust: 'IMPORTED' }), 'L15_INVALID_COMMAND', /SIGNAL_SOURCE_MISMATCH/);
    await rejects(machine({ ...ok, key: 'adv-k4', hintSeverity: 'CRITICAL' }), '23514', /hint_severity/);
    // 19. fabricated / defaulted observation time.
    await rejects(machine({ ...ok, key: 'adv-19a', observedAt: new Date(Date.now() + 3_600_000).toISOString() }), 'L15_INVALID_COMMAND', /OBSERVED_AT_UNEVIDENCED/);
    assert.equal(await k.one(`select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'l15\\_%'
      and column_default is not null`), '0', 'no column default: neither observed_at nor recorded_at is defaulted by the caller path');
    // Inactive organisation / unknown organisation.
    const inactive = await c.newOrg(false);
    await rejects(machine({ ...ok, org: inactive, key: 'adv-org' }), 'L15_INVALID_COMMAND', /ORGANISATION_INELIGIBLE/);
    // Intake key grammar.
    await rejects(machine({ ...ok, key: ' spaced key ' }), 'L15_INVALID_COMMAND', /INTAKE_KEY_INVALID/);
  });

  await t.test('O79 / O80 / O81 / O84: exhaustive owner x target matrix, self-links, cycles, single typed target (direct owner inserts, rolled back)', async () => {
    const memberA = ctx.member;
    const targets: Record<string, { org: string; user: string; column: string; id: string; l14Kind?: string }> = {
      DISCOVERY_EVIDENCE: { org: A, user: memberA.id, column: 'target_discovery_evidence_id', id: evA },
      SOURCE_ASSERTION: { org: A, user: memberA.id, column: 'target_source_assertion_id', id: toolA.assertion },
      RUNTIME_OBSERVATION: { org: R, user: memberR.id, column: 'target_runtime_observation_id', id: rt.observationId },
      CROSS_SIGNAL_RESULT: { org: R, user: memberR.id, column: 'target_cross_signal_comparison_id', id: rt.conflict },
      EXECUTION_FIELD_STATE: { org: R, user: memberR.id, column: 'target_execution_field_state_id', id: rt.executionStateId },
      TECHNICAL_FIELD_STATE: { org: A, user: memberA.id, column: 'target_technical_field_state_id', id: techA },
      LINEAGE_OBSERVATION: { org: R, user: memberR.id, column: 'target_lineage_observation_finding_id', id: rt.lineageFindingId },
      L14_FACT_STATE: { org: A, user: memberA.id, column: 'target_l14_fact_state_id', id: notSatisfied.stateId, l14Kind: 'CONTROL_ASSESSMENT' },
      RISK_SIGNAL: { org: A, user: memberA.id, column: 'target_risk_signal_id', id: sigA1 },
      RISK_HYPOTHESIS: { org: A, user: memberA.id, column: 'target_risk_hypothesis_id',
        id: await k.one(`select hypothesis_id from gov_repo.l15_risk_hypotheses where organisation_id='${A}' limit 1`) },
    };
    const owners = {
      RISK_SIGNAL: (org: string, user: string) => `insert into gov_repo.l15_risk_signals(organisation_id,signal_id,intake_key,semantic_fingerprint,
          signal_kind,source_class,subject_mode,unresolved_reason,support_status,submitted_by_user_id,recorded_at)
        values('${org}',gen_random_uuid(),'matrix-'||gen_random_uuid(),repeat('a',64),'HUMAN_OBSERVATION','LOCAL_HUMAN','UNRESOLVED','NO_EXACT_MAPPING',
          'PRESENT','${user}','2000-01-01') returning signal_id`,
      RISK_HYPOTHESIS: (org: string, user: string) => `insert into gov_repo.l15_risk_hypotheses(organisation_id,hypothesis_id,intake_key,semantic_fingerprint,
          generator_kind,subject_mode,subject_canonical_kind,subject_canonical_object_id,submitted_by_user_id,recorded_at)
        select '${org}',gen_random_uuid(),'matrix-'||gen_random_uuid(),repeat('a',64),'HUMAN','CANONICAL_OBJECT',kind,canonical_object_id,'${user}','2000-01-01'
        from gov_repo.canonical_objects where organisation_id='${org}' limit 1 returning hypothesis_id`,
    };
    const admissible: Record<string, readonly string[]> = {
      RISK_SIGNAL: ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'RUNTIME_OBSERVATION', 'CROSS_SIGNAL_RESULT', 'EXECUTION_FIELD_STATE',
        'TECHNICAL_FIELD_STATE', 'LINEAGE_OBSERVATION', 'L14_FACT_STATE'],
      RISK_HYPOTHESIS: ['RISK_SIGNAL'],
    };
    const link = (ownerKind: string, ownerRef: string, tag: string, column: string, id: string, l14Kind?: string) =>
      `insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,${ownerKind === 'RISK_SIGNAL' ? 'owner_signal_id,owner_signal_kind' : 'owner_hypothesis_id'},
        target_tag,${column}${l14Kind ? ',target_l14_fact_subject_kind' : ''},recorded_at)
       select organisation_id,gen_random_uuid(),'${ownerKind}',${ownerKind === 'RISK_SIGNAL' ? `${ownerRef},'HUMAN_OBSERVATION'` : ownerRef},'${tag}',
         ${lit(id)}${l14Kind ? `,'${l14Kind}'` : ''},now() from owner_row`;
    function lit(v: string) { return `'${v.replace(/'/g, "''")}'`; }
    const ownerRow = (kind: 'RISK_SIGNAL' | 'RISK_HYPOTHESIS', org: string, user: string) =>
      `create temporary table owner_row(organisation_id uuid, id uuid) on commit drop;
       with o as (${owners[kind](org, user)}) insert into owner_row select '${org}'::uuid, ${kind === 'RISK_SIGNAL' ? 'signal_id' : 'hypothesis_id'} from o;`;
    let accepted = 0, refused = 0;
    for (const ownerKind of ['RISK_SIGNAL', 'RISK_HYPOTHESIS'] as const) {
      for (const [tag, target] of Object.entries(targets)) {
        const idCol = ownerKind === 'RISK_SIGNAL' ? 'signal_id' : 'hypothesis_id';
        const query = `begin; ${ownerRow(ownerKind, target.org, target.user)}
          ${link(ownerKind, 'id', tag, target.column, target.id, target.l14Kind)}; rollback;`;
        if (admissible[ownerKind].includes(tag)) {
          await owner(query);
          accepted++;
        } else {
          await rejects(owner(query), '23514', /owner_target_matrix_check/);
          refused++;
        }
      }
    }
    assert.deepEqual([accepted, refused], [9, 11], 'exactly the 9 admissible §9.2 pairs for the S1 owners');
    // O80: self references (signal -> itself, hypothesis -> itself) are same-rank and refused by the matrix.
    await rejects(owner(`begin; ${ownerRow('RISK_SIGNAL', A, memberA.id)}
      insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_signal_id,owner_signal_kind,target_tag,target_risk_signal_id,recorded_at)
      select organisation_id,gen_random_uuid(),'RISK_SIGNAL',id,'HUMAN_OBSERVATION','RISK_SIGNAL',id,now() from owner_row; rollback;`), '23514', /owner_target_matrix_check/);
    await rejects(owner(`begin; ${ownerRow('RISK_HYPOTHESIS', A, memberA.id)}
      insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_hypothesis_id,target_tag,target_risk_hypothesis_id,recorded_at)
      select organisation_id,gen_random_uuid(),'RISK_HYPOTHESIS',id,'RISK_HYPOTHESIS',id,now() from owner_row; rollback;`), '23514', /owner_target_matrix_check/);
    // O84: zero / two typed targets, tag / column mismatch.
    const shape = (cols: string, vals: string) => owner(`begin; ${ownerRow('RISK_SIGNAL', A, memberA.id)}
      insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_signal_id,owner_signal_kind,target_tag${cols},recorded_at)
      select organisation_id,gen_random_uuid(),'RISK_SIGNAL',id,'HUMAN_OBSERVATION','DISCOVERY_EVIDENCE'${vals},now() from owner_row; rollback;`);
    await rejects(shape('', ''), '23514', /target_shape_check/);
    await rejects(shape(',target_discovery_evidence_id,target_technical_field_state_id', `,'${evA}','${techA}'`), '23514', /target_shape_check/);
    await rejects(shape(',target_technical_field_state_id', `,'${techA}'`), '23514', /target_shape_check/);
    // A direct cross-tenant link fails the composite FK (owner in A, evidence of B under the tag of A).
    await rejects(shape(',target_discovery_evidence_id', `,'${evB}'`), '23503', /discovery_evidence_fkey/);
    // A link to an owner recorded in another transaction (a later "evidence top-up") is refused.
    await rejects(owner(`insert into gov_repo.l15_support_links(organisation_id,link_id,owner_kind,owner_signal_id,owner_signal_kind,target_tag,target_discovery_evidence_id,recorded_at)
      values('${A}',gen_random_uuid(),'RISK_SIGNAL','${sigA1}','DETECTED_ABSENCE','DISCOVERY_EVIDENCE','${evA2}',now())`), 'L15_INVALID_COMMAND', /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    // A machine signal without any link, inserted directly, fails at commit (deferred completeness).
    await rejects(owner(`insert into gov_repo.l15_risk_signals(organisation_id,signal_id,intake_key,semantic_fingerprint,signal_kind,source_class,subject_mode,
        unresolved_reason,trust_state,method_id,method_version,support_status,admitted_by_technical_identity,recorded_at)
      values('${A}',gen_random_uuid(),'nolink',repeat('a',64),'DETECTED_PATTERN','SYSTEM_DETECTOR','UNRESOLVED','NO_EXACT_MAPPING','INFERRED','M','1','PRESENT','x',now())`),
      'L15_INVALID_COMMAND', /SIGNAL_SUPPORT_INCOMPLETE/);
    await rejects(owner(`insert into gov_repo.l15_risk_hypotheses(organisation_id,hypothesis_id,intake_key,semantic_fingerprint,generator_kind,subject_mode,
        subject_canonical_kind,subject_canonical_object_id,trust_state,method_id,method_version,admitted_by_technical_identity,recorded_at)
      values('${A}',gen_random_uuid(),'nolink',repeat('a',64),'DETERMINISTIC_RULE','CANONICAL_OBJECT','TOOL','${O.TOOL}','INFERRED','M','1','x',now())`),
      'L15_INVALID_COMMAND', /HYPOTHESIS_REQUIRES_SIGNAL/);
    // Forged trust VALIDATED / owned trust on a reference / a hypothesis UNRESOLVED subject fail the table CHECKs even for the owner.
    await rejects(owner(`insert into gov_repo.l15_risk_hypotheses(organisation_id,hypothesis_id,intake_key,semantic_fingerprint,generator_kind,subject_mode,
        subject_canonical_kind,subject_canonical_object_id,trust_state,method_id,method_version,admitted_by_technical_identity,recorded_at)
      values('${A}',gen_random_uuid(),'v',repeat('a',64),'DETERMINISTIC_RULE','CANONICAL_OBJECT','TOOL','${O.TOOL}','VALIDATED','M','1','x',now())`), '23514');
    await rejects(owner(`insert into gov_repo.l15_risk_signals(organisation_id,signal_id,intake_key,semantic_fingerprint,signal_kind,source_class,subject_mode,
        unresolved_reason,trust_state,method_id,method_version,support_status,admitted_by_technical_identity,recorded_at)
      values('${A}',gen_random_uuid(),'v',repeat('a',64),'LINEAGE_REF','GOVERNED_FACT_REFERENCE','UNRESOLVED','NO_EXACT_MAPPING','OBSERVED','M','1','PRESENT','x',now())`),
      '23514', /trust_source_check/);
    // The support table has no json / jsonb / array / free-text reference column (catalog).
    const types = await k.json(`select json_agg(distinct data_type) from information_schema.columns where table_schema='gov_repo' and table_name='l15_support_links'`);
    assert.deepEqual([...types].sort(), ['text', 'timestamp with time zone', 'uuid']);
    // Every text target column carries a composite same-tenant FK.
    const fks = await k.one(`select count(*) from pg_constraint where conrelid='gov_repo.l15_support_links'::regclass and contype='f'
      and cardinality(conkey) > 1
      and conkey[1] = (select attnum from pg_attribute where attrelid='gov_repo.l15_support_links'::regclass and attname='organisation_id')`);
    assert.equal(fks, '12', '10 target tags + 2 owners, every one composite on organisation_id');
  });

  await t.test('O13 / O14: admissions (incl. hint 1.0 / critical, repeated) create zero governance rows / states / heads; the intake identity has no governance path', async () => {
    for (let i = 0; i < 5; i++) {
      await machine({ ...detected(A, `o13-${i}`, evA), hintConfidence: 1 });
      await machineH(hypothesisOps(hyp({ intakeKey: `o13-h-${i}`, hintConfidence: 1, citedSignalIds: [sigA1, sigA2] })));
    }
    assert.deepEqual(await k.governanceCounts(), govBefore, 'no authorization / decision / proposal / result / fact / registry / head row');
    assert.equal(await ca.historyDigest(A), m16Before, 'no M16 history row of the organisation changed');
    // O14: the technical intake identity cannot execute any L14 / L15 propose / decide / admit RPC or read projection.
    const reachable = await k.json(`select coalesce(json_agg(p.proname order by p.proname), '[]') from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        and (p.prosecdef or p.pronamespace='gov_repo'::regnamespace) and has_function_privilege('${MACHINE}', p.oid, 'EXECUTE')`);
    assert.deepEqual(reachable, ['l15_admit_machine_hypothesis_v1', 'l15_admit_machine_signal_v1']);
    await rejects(k.machine(`select gov_repo.l14_submit_proposal_v1(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`),
      '42501', /permission denied/);
    await rejects(k.machine(`select * from gov_repo.l15_read_signals_v1(null,null,null,null,null,null,null,null,null,null)`), '42501', /permission denied/);
    await rejects(k.machine(`select count(*) from gov_repo.l15_risk_signals`), '42501', /permission denied/);
    // service_role (the M16 human-principal executor) cannot use the machine path; a capability-less LOGIN neither; a LOGIN that
    // also inherits service_role is refused by the in-RPC identity check.
    await rejects(svc(machineSignalSql(detected(A, 'o14-svc', evA))), '42501', /permission denied/);
    await rejects(k.as(UNBOUND)(machineSignalSql(detected(A, 'o14-unbound', evA))), '42501', /permission denied/);
    await bootstrapSql(`create role l15_detector_svc login inherit; grant govia_l15_machine_intake_caller to l15_detector_svc; grant service_role to l15_detector_svc;`);
    await rejects(k.as('l15_detector_svc')(machineSignalSql(detected(A, 'o14-mixed', evA))), '42501', /L15_INTAKE_IDENTITY_INELIGIBLE/);
    await bootstrapSql(`drop role l15_detector_svc;`);
    assert.deepEqual(await k.governanceCounts(), govBefore);
  });

  await t.test('O15 / S: every L15 history table refuses UPDATE / DELETE / TRUNCATE for the owner, a superuser in replica mode and application roles', async () => {
    for (const table of ['l15_risk_signals', 'l15_risk_hypotheses', 'l15_support_links']) {
      const before = await k.one(`select md5(string_agg(t::text, '|' order by t::text)) from gov_repo.${table} t`);
      await rejects(owner(`update gov_repo.${table} set recorded_at = recorded_at`), 'L15_HISTORY_IMMUTABLE');
      await rejects(owner(`delete from gov_repo.${table}`), 'L15_HISTORY_IMMUTABLE');
      await rejects(owner(`truncate gov_repo.${table} cascade`), 'L15_HISTORY_IMMUTABLE');
      await rejects(bootstrapSql(`set session_replication_role = replica; delete from gov_repo.${table};`), 'L15_HISTORY_IMMUTABLE');
      for (const role of ['service_role', 'authenticated', 'anon'] as const) {
        await rejects(c.sql(`select count(*) from gov_repo.${table}`, role), '42501', /permission denied/);
        await rejects(c.sql(`delete from gov_repo.${table}`, role), '42501', /permission denied/);
      }
      assert.equal(await k.one(`select md5(string_agg(t::text, '|' order by t::text)) from gov_repo.${table} t`), before);
    }
    // No FK can cascade-erase L15 history; deleting an upstream row cited by L15 is refused (evidence stays explicit).
    assert.equal(await k.one(`select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relname like 'l15\\_%' and k.contype='f'
      and (k.confdeltype in ('c','n','d') or k.confupdtype in ('c','n','d'))`), '0');
  });

  await t.test('O16 / O18 / O88: scanner severity stays a hint; DETECTED_ABSENCE reads "not detected"; legacy risk values never enter L15', async () => {
    const reads = await k.json(k.readSignalsSql(ctx.member, objectSubject('AGENT_VERSION', O.AGENT_VERSION)), svc) as any[];
    const absent = reads.filter(r => r.signal_kind === 'DETECTED_ABSENCE');
    assert.ok(absent.length > 0);
    assert.ok(absent.every(r => r.observation_presentation === 'not detected' && r.authority === 'NON_AUTHORITATIVE'));
    assert.ok(reads.every(r => !/absent|fail|not_satisfied|non.?compliant|false/i.test(r.observation_presentation)));
    // A critical hint changes no control assessment / applicability / Passport-visible M16 state.
    assert.deepEqual(await ca.current(A, ca.cak.objectTarget('TOOL', O.TOOL)), toolCurrentBefore);
    assert.equal(await ca.historyDigest(A), m16Before);
    // Legacy risk values seeded on the legacy surfaces create nothing in L15 and no L15 routine reads them.
    const l15Before = await k.l15Counts();
    await owner(`update gov_repo.agents set risk_level = 'critical' where true`).catch(() => undefined);
    assert.deepEqual(await k.l15Counts(), l15Before);
    assert.equal(await k.one(`select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15\\_%'
      and prosrc ~* '(risk_entries|risk_treatments|risk_level|ai_act_risk_class|agent_risk_propagation|risk_refs|residual_risk|risk_score|evidence\\.)'`), '0');
    assert.equal(await k.one(`select count(*) from pg_constraint where contype='f' and conrelid in (select oid from pg_class where relname like 'l15\\_%')
      and confrelid in (select oid from pg_class where relnamespace='gov_repo'::regnamespace and relname in ('evidence','risk_entries','risk_treatments','agents'))`), '0',
      'legacy gov_repo.evidence / risk stores are not admissible targets');
  });

  await t.test('inherited invariants: 11 kinds / 12 types / five M16 families / F2 / envelope vocabularies / definer surface 49', async () => {
    const vocab = async (rel: string, con: string) => (await k.json(`select json_agg(m[1] order by m[1]) from pg_constraint k,
      regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z0-9_]+)''', 'g') m where k.conrelid='gov_repo.${rel}'::regclass and k.conname='${con}'`)) as string[];
    assert.equal((await vocab('canonical_objects', 'canonical_objects_kind_check')).length, 11);
    assert.equal((await vocab('canonical_relationships', 'canonical_relationships_type_check')).length, 12);
    assert.deepEqual(await vocab('l14_fact_states', 'l14_fact_states_subject_kind_check'),
      ['BUSINESS_CONTEXT_ASSIGNMENT', 'CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT', 'POLICY_APPLICABILITY', 'RESPONSIBILITY_ASSIGNMENT']);
    for (const [rel, con] of [['l14_proposals', 'l14_proposals_subject_kind_check'], ['l14_governance_decisions', 'l14_governance_decisions_subject_kind_check'],
      ['l14_authorization_decisions', 'l14_authorization_decisions_subject_kind_check'], ['l14_command_results', 'l14_command_results_subject_kind_check']]) {
      const v = await vocab(rel, con);
      assert.equal(v.length, 17, rel);
      assert.ok(!v.includes('RISK_SIGNAL') && !v.includes('RISK_HYPOTHESIS'), rel);
    }
    assert.equal((await vocab('l14_authority_policy_rules', 'l14_authority_policy_rules_permission_check')).length, 23);
    assert.equal(await k.one(`select count(*) from pg_trigger where tgrelid='gov_repo.canonical_relationships'::regclass and not tgisinternal`), '0');
    assert.equal(await k.one(`select count(*) from pg_constraint where confrelid='gov_repo.canonical_relationships'::regclass
      and conrelid in (select oid from pg_class where relname like 'l15\\_%' or relname like 'l14\\_%')`), '0');
    assert.equal(await k.one(`select count(*) from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey::int2[])
      where i.indrelid='gov_repo.canonical_relationships'::regclass and a.attname='relationship_state_id'`), '0');
    assert.equal(await k.one(`select count(*) from pg_proc p where p.prosecdef and p.pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE'))`), '49');
    assert.equal(lastLine(await owner(`select count(*) from pg_proc where proname like 'l15\\_%' and proname ~ '(propose|decide|submit|validate|bootstrap)'`)), '0');
  });
});
