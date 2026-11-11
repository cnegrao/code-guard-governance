import type { L14PassportGovernedFact } from '@council/canonical-contracts';
import type { PassportRiskOverlay, PassportRiskOverlayItem } from '../governance/agent-passport';

/** Disposable presentation only. Counts are observations in a named scope, never assurance results. */
export type ReadFailure = 'UNAVAILABLE' | 'TENANT_INTEGRITY' | 'CONTRACT_VIOLATION';
export type ReadResult<T> = { status: 'AVAILABLE'; value: T } | { status: 'UNKNOWN'; failure: ReadFailure };
type IdentityRow = { canonical_object_id: string; kind: string };
export interface ExecutiveSubject {
  id: string;
  facts: ReadResult<readonly L14PassportGovernedFact[]>;
  risks: ReadResult<PassportRiskOverlay>;
}
export interface ExecutiveInput {
  organisationId: string;
  objects: ReadResult<readonly IdentityRow[]>;
  subjects: readonly ExecutiveSubject[];
  page: number;
  pageSize: number;
}
export interface ExecutiveControl {
  id: string;
  subjectId: string;
  controlId: string;
  versionId: string;
  applicability: 'APPLIES' | 'DOES_NOT_APPLY';
  assessment: string;
  assessmentStateId: string | null;
  evidence: 'REFERENCED' | 'NOT EVIDENCED' | 'UNKNOWN';
  evidenceIds: readonly string[];
  fact: L14PassportGovernedFact;
  assessmentFact: L14PassportGovernedFact | null;
}
export interface ExecutiveAttention {
  id: string;
  subjectId: string;
  /** A recorded state to review is distinct from a gap in recorded assessment or evidence; neither is a severity. */
  kind: 'RECORDED_STATE' | 'ASSESSMENT_GAP' | 'EVIDENCE_GAP';
  title: string;
  basis: string;
  section: 'controls' | 'provenance';
}
export interface RiskOrdering {
  band: PassportRiskOverlayItem['inherentBand'];
  basis: 'CURRENT_RESIDUAL' | 'INHERENT' | 'UNRATED';
}
/** Per-Agent read coverage. Only an open state is a current risk observation; CLOSED history is not current coverage. */
export type RiskCoverage = 'OPEN_OBSERVED' | 'CLOSED_ONLY' | 'NONE_RETURNED' | 'UNAVAILABLE' | 'WITHHELD';
export type ControlCoverage = 'APPLICABILITY_RETURNED' | 'NONE_RETURNED' | 'UNAVAILABLE' | 'WITHHELD';
/** Page-scope attention coverage. Only EVALUATED supports "no attention items observed", and never beyond this page. */
export type AttentionCoverage = 'POPULATION_UNKNOWN' | 'NO_AGENTS' | 'NO_GOVERNED_INFORMATION' | 'PARTIAL' | 'EVALUATED';
export const executiveSubjectHref = (id: string, section = 'provenance') =>
  `/agents/canonical/${encodeURIComponent(id)}#passport-${section}`;

/**
 * OFFSET paging can repeat rows under concurrent inserts. canonical_object_id is the identity; a repeat with another kind
 * is not a paging artefact but a canonical identity contract violation, and fails closed.
 */
export function uniqueIdentities<T extends IdentityRow>(read: ReadResult<readonly T[]>): ReadResult<readonly T[]> {
  if (read.status !== 'AVAILABLE') return read;
  const byId = new Map<string, T>();
  for (const row of read.value) {
    const seen = byId.get(row.canonical_object_id);
    if (seen && seen.kind !== row.kind) return { status: 'UNKNOWN', failure: 'CONTRACT_VIOLATION' };
    if (!seen) byId.set(row.canonical_object_id, row);
  }
  return { status: 'AVAILABLE', value: [...byId.values()] };
}

const BAND_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN'] as const;
// M17 ADR §20.2: the lifecycle projection names a CURRENT residual assessment only in these states.
const CURRENT_RESIDUAL = ['RESIDUAL_ASSESSED', 'RESIDUAL_ACCEPTED'];
/** Which recorded band orders a risk: the current residual where one exists, else inherent. Never a new rating. */
export function riskOrdering(r: PassportRiskOverlayItem): RiskOrdering {
  if (CURRENT_RESIDUAL.includes(r.lifecycle) && r.residualBand !== 'UNKNOWN') return { band: r.residualBand, basis: 'CURRENT_RESIDUAL' };
  return r.inherentBand !== 'UNKNOWN' ? { band: r.inherentBand, basis: 'INHERENT' } : { band: 'UNKNOWN', basis: 'UNRATED' };
}

const readGap = (failure: ReadFailure) => failure === 'UNAVAILABLE' ? 'UNAVAILABLE' as const : 'WITHHELD' as const;
function riskCoverage(s: ExecutiveSubject): RiskCoverage {
  if (s.risks.status === 'UNKNOWN') return readGap(s.risks.failure);
  const own = s.risks.value.items.filter(r => r.subjectKind === 'AGENT' && r.subjectCanonicalObjectId === s.id);
  return own.some(r => r.lifecycle !== 'CLOSED') ? 'OPEN_OBSERVED' : own.length ? 'CLOSED_ONLY' : 'NONE_RETURNED';
}
function controlCoverage(s: ExecutiveSubject): ControlCoverage {
  if (s.facts.status === 'UNKNOWN') return readGap(s.facts.failure);
  return s.facts.value.some(f => f.targetKind === 'AGENT' && f.targetCanonicalObjectId === s.id && f.value.family === 'CONTROL_APPLICABILITY')
    ? 'APPLICABILITY_RETURNED' : 'NONE_RETURNED';
}
const tally = <T extends string>(values: readonly T[], value: T) => values.filter(v => v === value).length;

export function buildExecutiveModel(input: ExecutiveInput) {
  const objectsRead = uniqueIdentities(input.objects);
  const objects = objectsRead.status === 'AVAILABLE' ? objectsRead.value : null;
  // Identity duplicates never reach counts, rows, risk presentation or React keys.
  const subjects = input.subjects.filter((s, i, all) => all.findIndex(o => o.id === s.id) === i);
  const controls: ExecutiveControl[] = [];
  const risks: PassportRiskOverlayItem[] = [];
  const attention: ExecutiveAttention[] = [];
  for (const subject of subjects) {
    if (subject.risks.status === 'AVAILABLE') {
      for (const risk of subject.risks.value.items) {
        if (risk.subjectKind !== 'AGENT' || risk.subjectCanonicalObjectId !== subject.id) continue;
        risks.push(risk);
        if (risk.lifecycle === 'CLOSED') continue;
        const id = risk.governedRiskStateId;
        if (risk.supportCurrency === 'SUPPORT_DEGRADED') attention.push({ id: `risk:${id}`, subjectId: subject.id,
          kind: 'RECORDED_STATE', title: 'Review degraded risk support', basis: `${id} · SUPPORT_DEGRADED`, section: 'provenance' });
        // M17 ADR §13.2: support currency never changes the decided risk, so SUPPORT_NONE is shown as a gap, not a severity.
        if (risk.supportCurrency === 'SUPPORT_NONE') attention.push({ id: `risk-evidence:${id}`, subjectId: subject.id,
          kind: 'EVIDENCE_GAP', title: 'No current recorded support for an open risk', basis: `${id} · SUPPORT_NONE · recorded rating unchanged`, section: 'provenance' });
        if (risk.inherentBand === 'UNKNOWN' && risk.residualBand === 'UNKNOWN') attention.push({ id: `risk-assessment:${id}`, subjectId: subject.id,
          kind: 'ASSESSMENT_GAP', title: 'No recorded rating band for an open risk', basis: `${id} · ${risk.lifecycle} · inherent UNKNOWN · residual UNKNOWN`, section: 'provenance' });
      }
    }
    if (subject.facts.status !== 'AVAILABLE') continue;
    const facts = subject.facts.value.filter(f => f.targetKind === 'AGENT' && f.targetCanonicalObjectId === subject.id);
    for (const fact of facts) {
      const value = fact.value;
      if (value.family !== 'CONTROL_APPLICABILITY') continue;
      // Assessment belongs to the EXACT applicability state, never just the same control/version.
      const assessments = facts.filter(f => f.value.family === 'CONTROL_ASSESSMENT'
        && f.value.controlApplicabilityStateId === fact.lineage.factStateId
        && f.value.controlDefinitionId === value.controlDefinitionId
        && f.value.controlDefinitionVersionId === value.controlDefinitionVersionId);
      const assessmentFact = value.applicability === 'APPLIES' && assessments.length === 1 ? assessments[0] : null;
      const assessment = assessmentFact?.value.family === 'CONTROL_ASSESSMENT' ? assessmentFact.value.assessmentOutcome : 'UNKNOWN';
      const evidenceIds = assessmentFact ? [...new Set(assessmentFact.lineage.factSupportEvidenceIds)] : [];
      const evidence = !assessmentFact ? 'UNKNOWN' : assessmentFact.lineage.supportStatus === 'NONE' && !evidenceIds.length
        ? 'NOT EVIDENCED' : evidenceIds.length ? 'REFERENCED' : 'UNKNOWN';
      controls.push({ id: fact.lineage.factStateId, subjectId: subject.id, controlId: value.controlDefinitionId,
        versionId: value.controlDefinitionVersionId, applicability: value.applicability,
        assessment, assessmentStateId: assessmentFact?.lineage.factStateId ?? null, evidence, evidenceIds, fact, assessmentFact });
      if (value.applicability !== 'APPLIES') continue;
      const stateId = fact.lineage.factStateId;
      if (['NOT_SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_ASSESSED', 'INSUFFICIENT_EVIDENCE'].includes(assessment)) attention.push({
        id: `control:${stateId}`, subjectId: subject.id, kind: 'RECORDED_STATE',
        title: 'Review recorded control assessment', basis: `${value.controlDefinitionId} · ${assessment}`, section: 'controls' });
      // UNKNOWN is absence of a recorded assessment, never a failed one.
      else if (assessment === 'UNKNOWN') attention.push({ id: `control-assessment:${stateId}`, subjectId: subject.id, kind: 'ASSESSMENT_GAP',
        title: 'No current recorded assessment of an applicable control', basis: `${value.controlDefinitionId} · APPLIES · assessment UNKNOWN`, section: 'controls' });
      else if (evidence !== 'REFERENCED') attention.push({ id: `control-evidence:${stateId}`, subjectId: subject.id, kind: 'EVIDENCE_GAP',
        title: 'Recorded assessment without referenced support', basis: `${value.controlDefinitionId} · ${assessment} · evidence ${evidence}`, section: 'controls' });
    }
  }
  const openRisks = risks.filter(r => r.lifecycle !== 'CLOSED');
  // Categorical display ordering of recorded bands only: no score, rating, treatment or acceptance decision is created.
  const priorityRisks = openRisks.map(r => ({ ...r, ordering: riskOrdering(r) })).sort((a, b) =>
    BAND_ORDER.indexOf(a.ordering.band) - BAND_ORDER.indexOf(b.ordering.band)
    || Number(a.lifecycle === 'RESIDUAL_ACCEPTED') - Number(b.lifecycle === 'RESIDUAL_ACCEPTED')
    || a.governedRiskStateId.localeCompare(b.governedRiskStateId));
  const applicable = controls.filter(c => c.applicability === 'APPLIES');
  const agentCount = objects ? objects.filter(o => o.kind === 'AGENT').length : null;
  const failures = [objectsRead, ...subjects.flatMap(s => [s.facts, s.risks])].flatMap(r => r.status === 'UNKNOWN' ? [r.failure] : []);
  const pageFirst = subjects.length ? (input.page - 1) * input.pageSize + 1 : 0;
  const riskCov = subjects.map(riskCoverage), controlCov = subjects.map(controlCoverage);
  const governedSubjects = subjects.filter((_, i) => riskCov[i] === 'OPEN_OBSERVED' || controlCov[i] === 'APPLICABILITY_RETURNED').length;
  const fullyCovered = subjects.filter((_, i) => riskCov[i] === 'OPEN_OBSERVED' && controlCov[i] === 'APPLICABILITY_RETURNED').length;
  // An empty attention list is a page-local observation only where every Agent has current risk and control information.
  const attentionCoverage: AttentionCoverage = agentCount === null ? 'POPULATION_UNKNOWN' : !subjects.length ? 'NO_AGENTS'
    : !governedSubjects ? 'NO_GOVERNED_INFORMATION' : fullyCovered < subjects.length ? 'PARTIAL' : 'EVALUATED';
  return {
    ...input, objects: undefined, subjects,
    objectCount: objects?.length ?? null,
    agentCount,
    aiObjectCount: objects ? objects.filter(o => ['AGENT', 'AGENT_VERSION'].includes(o.kind)).length : null,
    kinds: objects ? [...new Set(objects.map(o => o.kind))].sort().map(kind => ({ kind, count: objects.filter(o => o.kind === kind).length })) : [],
    // Page scope: every risk / control / attention observation below covers only these Agents.
    pageCount: agentCount === null ? null : Math.max(1, Math.ceil(agentCount / input.pageSize)),
    pageFirst, pageLast: pageFirst ? pageFirst + subjects.length - 1 : 0,
    risks, priorityRisks, controls, attention,
    openRiskCount: openRisks.length,
    closedRiskCount: risks.length - openRisks.length,
    identityFailure: objectsRead.status === 'UNKNOWN' ? objectsRead.failure : null,
    readFailures: {
      unavailable: failures.filter(f => f === 'UNAVAILABLE').length,
      tenantIntegrity: failures.filter(f => f === 'TENANT_INTEGRITY').length,
      contractViolation: failures.filter(f => f === 'CONTRACT_VIOLATION').length,
    },
    riskEvaluatedSubjects: subjects.filter(s => s.risks.status === 'AVAILABLE').length,
    controlEvaluatedSubjects: subjects.filter(s => s.facts.status === 'AVAILABLE').length,
    riskCoverage: { openObserved: tally(riskCov, 'OPEN_OBSERVED'), closedOnly: tally(riskCov, 'CLOSED_ONLY'),
      noneReturned: tally(riskCov, 'NONE_RETURNED'), unavailable: tally(riskCov, 'UNAVAILABLE'), withheld: tally(riskCov, 'WITHHELD') },
    controlCoverage: { applicabilityReturned: tally(controlCov, 'APPLICABILITY_RETURNED'), noneReturned: tally(controlCov, 'NONE_RETURNED'),
      unavailable: tally(controlCov, 'UNAVAILABLE'), withheld: tally(controlCov, 'WITHHELD') },
    governedSubjects, attentionCoverage,
    // Current coverage: a CLOSED-only history, an empty result and a failed read all leave current risk coverage UNKNOWN.
    unknownRiskSubjects: subjects.length - tally(riskCov, 'OPEN_OBSERVED'),
    unknownControlSubjects: subjects.length - tally(controlCov, 'APPLICABILITY_RETURNED'),
    failedRiskReads: subjects.filter(s => s.risks.status === 'UNKNOWN').length,
    failedControlReads: subjects.filter(s => s.facts.status === 'UNKNOWN').length,
    applicableCount: applicable.length,
    unknownAssessments: applicable.filter(c => c.assessment === 'UNKNOWN').length,
    notEvidencedAssessments: applicable.filter(c => c.evidence === 'NOT EVIDENCED').length,
    unknownEvidenceAssessments: applicable.filter(c => c.evidence === 'UNKNOWN').length,
  };
}
export type ExecutiveModel = ReturnType<typeof buildExecutiveModel>;
