import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { L15GovernedRiskSubject } from '@council/canonical-contracts';
import { l14Cluster, type Actor, type L14Cluster } from '../helpers/m16-l14-fixtures';
import { responsibilityKit } from '../helpers/m16-l14-responsibility-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import { m17s3Kit, objectSubject } from '../helpers/m17-s3-fixtures';
import { lit, named } from '../helpers/m16-governed-write-fixtures';
import { val } from '../helpers/m17-s5-fixtures';

const project = (c: L14Cluster, actor: Actor, subject: L15GovernedRiskSubject, scenario: string) =>
  c.exec(`select to_json(r) from gov_repo.l15_read_risk_projections_v1(${named({
    ...c.principal(actor), p_subject_type: lit(subject.subjectType),
    p_subject_canonical_kind: val(subject.subjectType === 'CANONICAL_OBJECT' ? subject.canonicalKind : null),
    p_subject_canonical_object_id: val(subject.subjectType === 'CANONICAL_OBJECT' ? subject.canonicalObjectId : null),
    p_subject_relationship_id: val(subject.subjectType === 'RELATIONSHIP_STATE' ? subject.relationshipId : null),
    p_subject_relationship_state_id: val(subject.subjectType === 'RELATIONSHIP_STATE' ? subject.relationshipStateId : null),
    p_scenario_definition_id: val(scenario, 'uuid'), p_effective_at: 'null::timestamptz', p_recorded_cutoff: 'null::timestamptz',
  })}) r;`);

test('S7A O67: exact-key conflict is categorical, has no heuristic winner and writes nothing', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S7A' });
  t.after(() => c.stop());
  const k = await m17s3Kit(c), x = await k.setup();
  const scenario = await k.scenario(x, 'conflict', 'OPERATIONAL', ['AGENT_VERSION']);
  const subject = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
  const otherSubject = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION_2!);

  let result = await project(c, x.member, subject, scenario.id);
  assert.deepEqual([result.conflict_outcome, result.live_proposal_count, result.distinct_content_count],
    ['INSUFFICIENT_EVIDENCE', 0, 0]);

  await k.submit(x, 'off-key', k.proposalOf(otherSubject, scenario));
  const firstProposal = k.proposalOf(subject, scenario);
  const first = await k.submit(x, 'exact-first', firstProposal);
  result = await project(c, x.member, subject, scenario.id);
  assert.deepEqual([result.conflict_outcome, result.live_proposal_count, result.distinct_content_count],
    ['INSUFFICIENT_EVIDENCE', 1, 1]);

  const secondProposal = k.proposalOf(subject, scenario, { requestedEffectiveTo: await k.instant('10 days') });
  await k.submit(x, 'exact-second', secondProposal);
  result = await project(c, x.member, subject, scenario.id);
  assert.deepEqual([result.conflict_outcome, result.live_proposal_count, result.distinct_content_count], ['CONFLICT', 2, 2]);

  const definition = await c.owner(`select pg_get_functiondef(
    'gov_repo.l15_read_risk_projections_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)`);
  const executableDefinition = definition.replace(/--.*$/gm, '');
  assert.doesNotMatch(executableDefinition, /confidence|generator_kind|hint_severity|source_class/i);
  assert.doesNotMatch(executableDefinition, /order\s+by[^;]*submitted_at/i, 'recency filters the cutoff but never ranks a winner');

  const before = await k.historyDigest(x.org);
  await project(c, x.member, subject, scenario.id);
  assert.equal(await k.historyDigest(x.org), before, 'conflict projection persists and mutates nothing');

  await k.decide(x, 'exact-first', first, firstProposal);
  result = await project(c, x.member, subject, scenario.id);
  assert.equal(result.conflict_outcome, 'RESOLVED');
  assert.ok(result.governed_risk_state_id);
});

test('S7A O45: accountable parties use only the exact M16 subject', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S7A' });
  t.after(() => c.stop());
  const k = await responsibilityKit(c), x = await k.setup(), party = await k.party(x, 'owner');
  const assignments = [
    ['AGENT', x.objects.agent, 'BUSINESS_OWNER'],
    ['DATA_ASSET', x.objects.asset, 'DATA_OWNER'],
    ['DATA_ELEMENT', x.objects.element, 'DATA_STEWARD'],
  ] as const;
  for (const [kind, id, role] of assignments) {
    await k.assign(x, `assign-${kind}`, k.keyOf(kind, id, role, party.partyId), party);
    const result = await project(c, x.member, objectSubject(kind, id), randomUUID());
    assert.equal(result.accountable_party_status, 'CURRENT', kind);
    assert.deepEqual(result.accountable_parties.map((p: Record<string, string>) => [p.responsibilityRole, p.governancePartyId]),
      [[role, party.partyId]], kind);
  }

  const otherKinds = ['AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API'] as const;
  for (const kind of otherKinds) {
    const id = kind === 'AGENT_VERSION' ? x.objects.agent : `${x.label}-${kind.toLowerCase()}`;
    const result = await project(c, x.member, objectSubject(kind, id), randomUUID());
    assert.equal(result.accountable_party_status, 'UNKNOWN', kind);
    assert.deepEqual(result.accountable_parties, [], kind);
  }
  const relationship: L15GovernedRiskSubject = {
    subjectType: 'RELATIONSHIP_STATE', relationshipId: `${x.label}-relationship`, relationshipStateId: `${x.label}-state`,
  };
  const relationshipResult = await project(c, x.member, relationship, randomUUID());
  assert.equal(relationshipResult.accountable_party_status, 'UNKNOWN');
  assert.deepEqual(relationshipResult.accountable_parties, []);
});

test('S7A control coverage is categorical and never infers coverage', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(message => t.diagnostic(message), { horizon: 'M17S7A' });
  t.after(() => c.stop());
  const k = await controlAssessmentKit(c), x = await k.setup();
  const target = k.cak.objectTarget('AGENT', x.objects.byKind.AGENT);

  const satisfied = await k.applicability(x, 'satisfied', target);
  await k.assess(x, 'satisfied', satisfied.stateId, { outcome: 'SATISFIED' });
  const notAssessed = await k.applicability(x, 'not-assessed', target);
  await k.assess(x, 'not-assessed', notAssessed.stateId, { outcome: 'NOT_ASSESSED' });
  const doesNotApply = await k.applicability(x, 'does-not-apply', target, { applicability: 'DOES_NOT_APPLY' });
  const unassessed = await k.applicability(x, 'unassessed', target);
  const absent = await k.cak.control(x, 'absent');

  const before = await k.historyDigest(x.org);
  const result = await project(c, x.member, objectSubject('AGENT', x.objects.byKind.AGENT), randomUUID());
  assert.equal(await k.historyDigest(x.org), before, 'control-coverage projection persists and mutates nothing');
  const coverage = new Map<string, Record<string, string | null>>(result.control_coverage.map((row: Record<string, string | null>) =>
    [row.controlDefinitionId, row]));
  assert.deepEqual([coverage.get(satisfied.pin.subject.controlDefinitionId)?.applicability,
    coverage.get(satisfied.pin.subject.controlDefinitionId)?.assessmentOutcome], ['APPLIES', 'SATISFIED']);
  assert.deepEqual([coverage.get(notAssessed.pin.subject.controlDefinitionId)?.applicability,
    coverage.get(notAssessed.pin.subject.controlDefinitionId)?.assessmentOutcome], ['APPLIES', 'NOT_ASSESSED']);
  assert.deepEqual([coverage.get(doesNotApply.pin.subject.controlDefinitionId)?.applicability,
    coverage.get(doesNotApply.pin.subject.controlDefinitionId)?.assessmentOutcome], ['DOES_NOT_APPLY', 'UNKNOWN']);
  assert.deepEqual([coverage.get(unassessed.pin.subject.controlDefinitionId)?.applicability,
    coverage.get(unassessed.pin.subject.controlDefinitionId)?.assessmentOutcome], ['APPLIES', 'UNKNOWN']);
  assert.equal(coverage.has(absent.subject.controlDefinitionId), false, 'absence creates no inferred coverage row');
  for (const row of coverage.values()) assert.deepEqual(Object.keys(row).sort(), [
    'applicability', 'applicabilityFactStateId', 'assessmentFactStateId', 'assessmentOutcome',
    'controlDefinitionId', 'controlDefinitionVersionId',
  ]);
});
