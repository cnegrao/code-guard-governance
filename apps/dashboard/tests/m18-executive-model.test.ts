import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExecutiveModel, executiveSubjectHref, type ExecutiveInput } from '../lib/workspace/executive-model';
import type { PassportRiskOverlayItem } from '../lib/governance/agent-passport';
import { agent13, agentId, applicability, assessedControl, assessment, closedOnlyRisks, emptyModel, fact, mixedReads, noGovernedFacts, org, overlay,
  populatedInput, populatedModel, portfolioInput, risk, scopedInput, unavailableRead } from './helpers/m18-executive-fixtures';

test('counts canonical identities without collapsing versions; missing ratings never become zero', () => {
  const m = populatedModel();
  assert.equal(m.objectCount, 3); assert.equal(m.aiObjectCount, 2); assert.equal(m.agentCount, 1);
  assert.equal(m.risks[0].residualBand, 'UNKNOWN'); assert.equal(m.risks[0].acceptanceStatus, 'UNKNOWN');
  assert.equal(m.applicableCount, 1); assert.equal(m.notEvidencedAssessments, 1);
  assert.deepEqual(m.attention.map(a => a.id), ['risk:risk:1', 'control:app:1']);
});

test('empty, unavailable, failed and successful unknown reads remain distinct', () => {
  const input = populatedInput();
  const failed = buildExecutiveModel({ ...input, objects: { status: 'UNKNOWN', failure: 'UNAVAILABLE' },
    subjects: [{ id: agentId, facts: { status: 'UNKNOWN', failure: 'UNAVAILABLE' }, risks: { status: 'UNKNOWN', failure: 'UNAVAILABLE' } }] });
  assert.equal(failed.objectCount, null); assert.equal(failed.aiObjectCount, null);
  assert.equal(failed.failedRiskReads, 1); assert.equal(failed.failedControlReads, 1);
  const unknown = buildExecutiveModel({ ...input, subjects: [{ id: agentId, facts: { status: 'AVAILABLE', value: [] }, risks: { status: 'AVAILABLE', value: overlay([]) } }] });
  assert.equal(unknown.unknownRiskSubjects, 1); assert.equal(unknown.unknownControlSubjects, 1);
  assert.equal(unknown.failedRiskReads, 0); assert.equal(unknown.attention.length, 0);
});

test('assessment never transfers to a successor applicability state or another target/control version', () => {
  for (const bad of [
    { ...assessment, targetCanonicalObjectId: 'other-agent' },
    fact('ass:wrong-pin', { ...assessment.value, family: 'CONTROL_ASSESSMENT', controlDefinitionId: 'control:oversight', controlDefinitionVersionId: 'control:v1', contentHash: 'hash', controlApplicabilityStateId: 'app:previous', assessmentOutcome: 'SATISFIED' }),
    { ...assessment, targetKind: 'AGENT_VERSION' as const },
    fact('ass:wrong-version', { family: 'CONTROL_ASSESSMENT', controlDefinitionId: 'control:oversight', controlDefinitionVersionId: 'control:v2', contentHash: 'hash', controlApplicabilityStateId: 'app:1', assessmentOutcome: 'SATISFIED' }),
  ]) {
    const input = populatedInput(); input.subjects[0].facts = { status: 'AVAILABLE', value: [applicability, bad] };
    const m = buildExecutiveModel(input);
    assert.equal(m.controls[0].assessment, 'UNKNOWN'); assert.equal(m.unknownAssessments, 1);
    assert.equal(m.notEvidencedAssessments, 0); assert.equal(m.controls[0].evidence, 'UNKNOWN');
  }
});

test('explicit negative applicability stays separate; duplicate assessments fail closed', () => {
  const input = populatedInput();
  input.subjects[0].facts = { status: 'AVAILABLE', value: [{ ...applicability, value: { ...applicability.value, family: 'CONTROL_APPLICABILITY', controlDefinitionId: 'control:oversight', controlDefinitionVersionId: 'control:v1', contentHash: 'hash', controlDefinitionValidatedStateId: 'control:state', applicability: 'DOES_NOT_APPLY' } }, assessment] };
  const negative = buildExecutiveModel(input);
  assert.equal(negative.applicableCount, 0); assert.equal(negative.controls[0].assessment, 'UNKNOWN');
  input.subjects[0].facts = { status: 'AVAILABLE', value: [applicability, assessment, { ...assessment, lineage: { ...assessment.lineage, factStateId: 'ass:competing' } }] };
  assert.equal(buildExecutiveModel(input).controls[0].assessment, 'UNKNOWN');
});

test('evidence references do not establish availability or sufficiency; support absent is NOT EVIDENCED', () => {
  const input = populatedInput();
  input.subjects[0].facts = { status: 'AVAILABLE', value: [applicability, { ...assessment, lineage: { ...assessment.lineage, supportStatus: 'PRESENT', factSupportEvidenceIds: ['evidence:1', 'evidence:1'] } }] };
  const m = buildExecutiveModel(input);
  assert.equal(m.controls[0].evidence, 'REFERENCED'); assert.deepEqual(m.controls[0].evidenceIds, ['evidence:1']);
  assert.equal(m.controls[0].assessment, 'INSUFFICIENT_EVIDENCE');
});

test('priority uses only recorded bands; closed risks and foreign targets cannot create attention', () => {
  const input = populatedInput();
  input.subjects[0].risks = { status: 'AVAILABLE', value: overlay([
    { ...risk, governedRiskStateId: 'risk:unknown', inherentBand: 'UNKNOWN', supportCurrency: 'SUPPORT_NONE' },
    { ...risk, governedRiskStateId: 'risk:closed', lifecycle: 'CLOSED' }, risk,
    { ...risk, governedRiskStateId: 'risk:foreign', subjectCanonicalObjectId: 'other-agent' },
  ]) };
  const m = buildExecutiveModel(input);
  assert.deepEqual(m.priorityRisks.map(r => r.governedRiskStateId), ['risk:1', 'risk:unknown']);
  assert.equal(m.attention.filter(a => a.id.startsWith('risk:')).length, 1);
  assert.equal(executiveSubjectHref('agent:1/x', 'controls'), '/agents/canonical/agent%3A1%2Fx#passport-controls');
});

const riskOf = (id: string, over: Partial<PassportRiskOverlayItem>): PassportRiskOverlayItem =>
  ({ ...risk, governedRiskStateId: id, supportCurrency: 'SUPPORT_CURRENT', ...over });
const withRisks = (items: PassportRiskOverlayItem[]) => {
  const input = populatedInput(); input.subjects[0].risks = { status: 'AVAILABLE', value: overlay(items) };
  input.subjects[0].facts = { status: 'AVAILABLE', value: [] }; return buildExecutiveModel(input);
};

test('F1: page-local observations carry their exact page scope; Agent 13 facts surface only on page 2', () => {
  const one = buildExecutiveModel(portfolioInput(1)), two = buildExecutiveModel(portfolioInput(2));
  assert.deepEqual([one.page, one.pageCount, one.pageFirst, one.pageLast, one.agentCount, one.subjects.length], [1, 2, 1, 12, 24, 12]);
  assert.deepEqual([two.page, two.pageCount, two.pageFirst, two.pageLast], [2, 2, 13, 24]);
  assert.equal(one.attention.length, 0); assert.ok(one.priorityRisks.every(r => r.inherentBand === 'LOW'));
  assert.ok(one.subjects.every(s => s.id !== agent13)); assert.ok(!one.priorityRisks.some(r => r.subjectCanonicalObjectId === agent13));
  assert.equal(two.priorityRisks[0].subjectCanonicalObjectId, agent13); assert.equal(two.priorityRisks[0].ordering.band, 'CRITICAL');
  assert.deepEqual(two.attention.map(a => [a.subjectId, a.kind, a.basis]), [[agent13, 'RECORDED_STATE', 'control:oversight · NOT_SATISFIED']]);
});

test('F2: UNKNOWN assessments and SUPPORT_NONE become explicit gaps, never failures or severities', () => {
  const input = populatedInput();
  const bare = (control: string) => assessedControl(agentId, 'SATISFIED', true, control)[0];
  input.subjects[0].facts = { status: 'AVAILABLE', value: [...assessedControl(agentId, 'SATISFIED', true, 'control:assessed'), bare('control:a'), bare('control:b'),
    ...assessedControl(agentId, 'SATISFIED', false, 'control:unsupported')] };
  input.subjects[0].risks = { status: 'AVAILABLE', value: overlay([riskOf('risk:critical', { inherentBand: 'CRITICAL', supportCurrency: 'SUPPORT_NONE' })]) };
  const m = buildExecutiveModel(input);
  assert.deepEqual(m.attention.map(a => [a.id, a.kind]), [
    ['risk-evidence:risk:critical', 'EVIDENCE_GAP'],
    [`control-assessment:app:${agentId}:control:a`, 'ASSESSMENT_GAP'], [`control-assessment:app:${agentId}:control:b`, 'ASSESSMENT_GAP'],
    [`control-evidence:app:${agentId}:control:unsupported`, 'EVIDENCE_GAP'],
  ]);
  assert.ok(m.attention.every(a => !/NOT_SATISFIED|CRITICAL|HIGH/.test(a.basis)), 'gap basis carries no failure or severity');
  assert.equal(m.unknownAssessments, 2); assert.equal(m.controls.find(c => c.controlId === 'control:assessed')!.assessment, 'SATISFIED');
  assert.deepEqual(m.priorityRisks[0].ordering, { band: 'CRITICAL', basis: 'INHERENT' }); assert.equal(m.priorityRisks[0].supportCurrency, 'SUPPORT_NONE');
  assert.equal(withRisks([riskOf('risk:unrated', { inherentBand: 'UNKNOWN' })]).attention[0].kind, 'ASSESSMENT_GAP');
});

test('F2: an empty governed result stays distinct from an unavailable read', () => {
  const empty = populatedInput(); empty.subjects[0].facts = { status: 'AVAILABLE', value: [] }; empty.subjects[0].risks = { status: 'AVAILABLE', value: overlay([]) };
  const failed = populatedInput(); failed.subjects[0].facts = { status: 'UNKNOWN', failure: 'UNAVAILABLE' }; failed.subjects[0].risks = { status: 'UNKNOWN', failure: 'UNAVAILABLE' };
  const e = buildExecutiveModel(empty), f = buildExecutiveModel(failed);
  assert.deepEqual([e.controlEvaluatedSubjects, e.riskEvaluatedSubjects, e.failedControlReads, e.readFailures.unavailable], [1, 1, 0, 0]);
  assert.deepEqual([f.controlEvaluatedSubjects, f.riskEvaluatedSubjects, f.failedControlReads, f.readFailures.unavailable], [0, 0, 1, 2]);
  assert.equal(e.unknownControlSubjects, 1); assert.equal(f.unknownControlSubjects, 1);
});

test('F3: ordering uses the current residual where recorded, else inherent; acceptance stays distinct', () => {
  const m = withRisks([
    riskOf('risk:a-accepted', { inherentBand: 'HIGH', residualBand: 'LOW', lifecycle: 'RESIDUAL_ACCEPTED', acceptanceStatus: 'ACCEPTED', acceptanceValidity: 'CURRENT' }),
    riskOf('risk:b-residual', { inherentBand: 'MODERATE', residualBand: 'MODERATE', lifecycle: 'RESIDUAL_ASSESSED' }),
    riskOf('risk:c-no-residual', { inherentBand: 'HIGH', residualBand: 'UNKNOWN', lifecycle: 'ASSESSED' }),
    riskOf('risk:d-closed', { inherentBand: 'CRITICAL', lifecycle: 'CLOSED' }),
    // A valid residual state whose eligibility is not CURRENT never orders the risk (lifecycle below RESIDUAL_ASSESSED).
    riskOf('risk:e-stale-residual', { inherentBand: 'CRITICAL', residualBand: 'LOW', lifecycle: 'TREATMENT_IMPLEMENTED' }),
    riskOf('risk:f-low-open', { inherentBand: 'LOW', lifecycle: 'ASSESSED' }),
  ]);
  assert.deepEqual(m.priorityRisks.map(r => [r.governedRiskStateId, r.ordering.basis, r.ordering.band]), [
    ['risk:e-stale-residual', 'INHERENT', 'CRITICAL'], ['risk:c-no-residual', 'INHERENT', 'HIGH'],
    ['risk:b-residual', 'CURRENT_RESIDUAL', 'MODERATE'], ['risk:f-low-open', 'INHERENT', 'LOW'], ['risk:a-accepted', 'CURRENT_RESIDUAL', 'LOW'],
  ]);
  const accepted = m.priorityRisks.at(-1)!;
  assert.deepEqual([accepted.inherentBand, accepted.residualBand, accepted.lifecycle], ['HIGH', 'LOW', 'RESIDUAL_ACCEPTED'], 'recorded bands preserved');
  const reversed = withRisks([...m.priorityRisks].reverse());
  assert.deepEqual(reversed.priorityRisks.map(r => r.governedRiskStateId), m.priorityRisks.map(r => r.governedRiskStateId), 'deterministic');
});

test('F4: current risk counts exclude CLOSED states, which are counted separately and raise no attention', () => {
  const m = withRisks([riskOf('risk:1', { lifecycle: 'ASSESSED' }), riskOf('risk:2', { lifecycle: 'RESIDUAL_ACCEPTED' }), riskOf('risk:3', { lifecycle: 'TREATMENT_APPROVED' }),
    riskOf('risk:4', { lifecycle: 'CLOSED', supportCurrency: 'SUPPORT_NONE', inherentBand: 'UNKNOWN' }), riskOf('risk:5', { lifecycle: 'CLOSED', supportCurrency: 'SUPPORT_DEGRADED' })]);
  assert.deepEqual([m.openRiskCount, m.closedRiskCount, m.risks.length, m.priorityRisks.length], [3, 2, 5, 3]);
  assert.ok(!m.priorityRisks.some(r => r.lifecycle === 'CLOSED')); assert.equal(m.attention.length, 0);
});

test('R-03: only open states are current risk coverage; CLOSED-only history stays UNKNOWN and is never modified', () => {
  const input = scopedInput(1, mixedReads), before = JSON.stringify(input);
  const one = buildExecutiveModel(input);
  assert.equal(JSON.stringify(input), before, 'governed lifecycle data is never modified');
  assert.deepEqual(one.riskCoverage, { openObserved: 4, closedOnly: 4, noneReturned: 4, unavailable: 0, withheld: 0 });
  assert.deepEqual([one.unknownRiskSubjects, one.riskEvaluatedSubjects, one.openRiskCount, one.closedRiskCount, one.priorityRisks.length], [8, 12, 4, 4, 4]);
  assert.ok(one.risks.filter(r => r.lifecycle === 'CLOSED').every(r => r.governedRiskStateId.startsWith('risk:closed:') && r.inherentBand === 'CRITICAL'));
  assert.equal(one.attention.length, 0, 'CLOSED CRITICAL / SUPPORT_NONE history raises no attention');
  // The reviewed defect: a CLOSED-only overlay is PRESENT, yet it is not current coverage.
  const closed = withRisks([riskOf('risk:closed', { lifecycle: 'CLOSED' })]);
  assert.equal(overlay(closed.risks).status, 'PRESENT');
  assert.deepEqual([closed.unknownRiskSubjects, closed.riskCoverage.closedOnly, closed.riskEvaluatedSubjects, closed.openRiskCount], [1, 1, 1, 0]);
  assert.equal(withRisks([riskOf('risk:closed', { lifecycle: 'CLOSED' }), riskOf('risk:open', {})]).riskCoverage.openObserved, 1);
  const foreign = withRisks([riskOf('risk:closed', { lifecycle: 'CLOSED' }), riskOf('risk:foreign', { subjectCanonicalObjectId: 'other-agent' })]);
  assert.deepEqual([foreign.riskCoverage.closedOnly, foreign.unknownRiskSubjects, foreign.openRiskCount], [1, 1, 0], 'a foreign open state is never coverage');
  const two = buildExecutiveModel(scopedInput(2, mixedReads));
  assert.deepEqual(two.riskCoverage, { openObserved: 1, closedOnly: 0, noneReturned: 0, unavailable: 5, withheld: 6 });
  assert.deepEqual([two.unknownRiskSubjects, two.failedRiskReads, two.priorityRisks[0].subjectCanonicalObjectId], [11, 11, agent13]);
});

test('R-04: attention coverage separates no governed information, partial coverage and an evaluated page', () => {
  const coverage = (input: ExecutiveInput) => buildExecutiveModel(input).attentionCoverage;
  assert.equal(coverage(portfolioInput(1)), 'EVALUATED');
  assert.equal(coverage(scopedInput(1, mixedReads)), 'PARTIAL'); assert.equal(coverage(scopedInput(2, mixedReads)), 'PARTIAL');
  const ungoverned = buildExecutiveModel(scopedInput(1, noGovernedFacts));
  assert.deepEqual([ungoverned.attentionCoverage, ungoverned.governedSubjects, ungoverned.attention.length, ungoverned.unknownRiskSubjects, ungoverned.unknownControlSubjects],
    ['NO_GOVERNED_INFORMATION', 0, 0, 12, 12]);
  assert.equal(coverage(scopedInput(1, () => ({ facts: unavailableRead, risks: unavailableRead }))), 'NO_GOVERNED_INFORMATION');
  assert.equal(coverage(scopedInput(1, id => ({ facts: { status: 'AVAILABLE', value: [] }, risks: { status: 'AVAILABLE', value: closedOnlyRisks(id) } }))), 'NO_GOVERNED_INFORMATION');
  // Explicit gaps are attention items; the missing dimension keeps the page PARTIAL.
  const unassessed = buildExecutiveModel(scopedInput(1, id => ({ facts: { status: 'AVAILABLE', value: [assessedControl(id, 'SATISFIED', true)[0]] }, risks: { status: 'AVAILABLE', value: overlay([]) } })));
  assert.deepEqual([unassessed.attentionCoverage, unassessed.unknownAssessments, unassessed.attention.length, unassessed.attention.every(a => a.kind === 'ASSESSMENT_GAP')], ['PARTIAL', 12, 12, true]);
  const unsupported = buildExecutiveModel(scopedInput(1, id => ({ facts: { status: 'AVAILABLE', value: [] },
    risks: { status: 'AVAILABLE', value: overlay([riskOf(`risk:${id}`, { subjectCanonicalObjectId: id, supportCurrency: 'SUPPORT_NONE' })]) } })));
  assert.deepEqual([unsupported.attentionCoverage, unsupported.attention.length, unsupported.attention.every(a => a.kind === 'EVIDENCE_GAP')], ['PARTIAL', 12, true]);
  assert.equal(emptyModel().attentionCoverage, 'NO_AGENTS');
  for (const failure of ['UNAVAILABLE', 'TENANT_INTEGRITY', 'CONTRACT_VIOLATION'] as const)
    assert.equal(coverage({ organisationId: org, objects: { status: 'UNKNOWN', failure }, subjects: [], page: 1, pageSize: 12 }), 'POPULATION_UNKNOWN');
});

test('F8: duplicate canonical identities never double count, repeat rows, repeat risks or collide React keys', () => {
  const input = populatedInput();
  const subject = input.subjects[0];
  const m = buildExecutiveModel({ ...input, objects: { status: 'AVAILABLE', value: [...(input.objects.status === 'AVAILABLE' ? input.objects.value : []),
    { canonical_object_id: agentId, kind: 'AGENT' }, { canonical_object_id: 'version:1', kind: 'AGENT_VERSION' }] }, subjects: [subject, subject] });
  assert.deepEqual([m.objectCount, m.agentCount, m.aiObjectCount, m.subjects.length, m.pageLast], [3, 1, 2, 1, 1]);
  assert.deepEqual(m.kinds, [{ kind: 'AGENT', count: 1 }, { kind: 'AGENT_VERSION', count: 1 }, { kind: 'DATA_ASSET', count: 1 }]);
  assert.deepEqual([m.risks.length, m.openRiskCount, m.controls.length, m.applicableCount, m.attention.length], [1, 1, 1, 1, 2]);
  for (const keys of [m.priorityRisks.map(r => r.governedRiskStateId), m.controls.map(c => c.id), m.attention.map(a => a.id), m.kinds.map(k => k.kind)])
    assert.equal(new Set(keys).size, keys.length);
  const conflicting = buildExecutiveModel({ ...input, objects: { status: 'AVAILABLE', value: [{ canonical_object_id: agentId, kind: 'AGENT' }, { canonical_object_id: agentId, kind: 'TOOL' }] } });
  assert.equal(conflicting.identityFailure, 'CONTRACT_VIOLATION'); assert.equal(conflicting.objectCount, null);
  assert.equal(conflicting.organisationId, org);
});
