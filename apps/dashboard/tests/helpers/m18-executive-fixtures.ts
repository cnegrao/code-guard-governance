import type { L14PassportGovernedFact, L14PassportGovernedValue } from '@council/canonical-contracts';
import type { PassportRiskOverlayItem, PassportRiskOverlay } from '../../lib/governance/agent-passport';
import { buildExecutiveModel, type ExecutiveInput, type ExecutiveSubject } from '../../lib/workspace/executive-model';

export const org = '11111111-1111-1111-1111-111111111111';
export const agentId = 'agent:executive';
export function fact(id: string, value: L14PassportGovernedValue, target = agentId): L14PassportGovernedFact {
  return { targetKind: 'AGENT', targetCanonicalObjectId: target, value, lineage: {
    factStateId: id, predecessorStateId: null, effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: null,
    recordedAt: '2026-11-01T00:00:00Z', trustState: 'VALIDATED', sourceClass: 'LOCAL_HUMAN', supportStatus: 'NONE',
    proposalId: `proposal:${id}`, proposalSubmittedAt: '2026-11-01T00:00:00Z', governanceDecisionId: `decision:${id}`,
    decisionOutcome: 'VALIDATE', decisionReasonCode: 'CONTROL_APPLICABILITY_VALIDATED', decidedAt: '2026-11-01T00:00:00Z',
    authorizationDecisionId: `auth:${id}`, authorizationResult: 'ALLOW', authorizationEvaluatedAt: '2026-11-01T00:00:00Z',
    authorityPolicy: { authorityPolicyId: 'authority:1', versionId: 'authority:v1', contentHash: 'hash' },
    factSupportEvidenceIds: [], decisionSupportEvidenceIds: [], proposalSupportEvidenceIds: [],
    readEffectiveAt: '2026-11-03T12:00:00Z', readRecordedCutoff: '2026-11-03T12:00:00Z',
  } };
}
export const applicability = fact('app:1', { family: 'CONTROL_APPLICABILITY', controlDefinitionId: 'control:oversight',
  controlDefinitionVersionId: 'control:v1', contentHash: 'hash', controlDefinitionValidatedStateId: 'control:state', applicability: 'APPLIES' });
export const assessment = fact('assessment:1', { family: 'CONTROL_ASSESSMENT', controlDefinitionId: 'control:oversight',
  controlDefinitionVersionId: 'control:v1', contentHash: 'hash', controlApplicabilityStateId: 'app:1', assessmentOutcome: 'INSUFFICIENT_EVIDENCE' });
export const risk: PassportRiskOverlayItem = {
  governedRiskStateId: 'risk:1', scenarioDefinitionId: 'scenario:1', riskDomain: 'OPERATIONAL', subjectKind: 'AGENT',
  subjectCanonicalObjectId: agentId, familyId: 'runtime', lifecycle: 'ASSESSED', inherentBand: 'HIGH', residualBand: 'UNKNOWN',
  acceptanceStatus: 'UNKNOWN', acceptanceValidity: 'UNKNOWN', supportCurrency: 'SUPPORT_DEGRADED', accountableParties: [],
  controlAssessmentStateIds: [], lineage: { proposalId: 'proposal:risk', governanceDecisionId: 'decision:risk',
    authorizationDecisionId: 'auth:risk', authorityPolicyId: 'authority:1', authorityPolicyVersionId: 'authority:v1', recordedAt: '2026-11-01T00:00:00Z' },
};
export function overlay(items: readonly PassportRiskOverlayItem[] = [risk]): PassportRiskOverlay {
  return { status: items.length ? 'PRESENT' : 'UNKNOWN', authority: 'GOVERNED_READ', items,
    nonAuthoritativeAnalysis: { label: 'NON-AUTHORITATIVE ANALYSIS', hypotheses: [] } };
}
export function populatedInput(): ExecutiveInput {
  return { organisationId: org, page: 1, pageSize: 12,
    objects: { status: 'AVAILABLE', value: [{ canonical_object_id: agentId, kind: 'AGENT' }, { canonical_object_id: 'version:1', kind: 'AGENT_VERSION' }, { canonical_object_id: 'data:1', kind: 'DATA_ASSET' }] },
    subjects: [{ id: agentId, facts: { status: 'AVAILABLE', value: [applicability, assessment] }, risks: { status: 'AVAILABLE', value: overlay() } }] };
}
export const populatedModel = () => buildExecutiveModel(populatedInput());

/** Applicable control with one exactly pinned assessment; `supported` gives it a referenced, PRESENT support set. */
export function assessedControl(target: string, outcome: 'SATISFIED' | 'NOT_SATISFIED', supported: boolean, control = 'control:oversight') {
  const app = fact(`app:${target}:${control}`, { family: 'CONTROL_APPLICABILITY', controlDefinitionId: control, controlDefinitionVersionId: 'control:v1',
    contentHash: 'hash', controlDefinitionValidatedStateId: 'control:state', applicability: 'APPLIES' }, target);
  const assessed = fact(`assessment:${target}:${control}`, { family: 'CONTROL_ASSESSMENT', controlDefinitionId: control, controlDefinitionVersionId: 'control:v1',
    contentHash: 'hash', controlApplicabilityStateId: app.lineage.factStateId, assessmentOutcome: outcome }, target);
  return [app, supported ? { ...assessed, lineage: { ...assessed.lineage, supportStatus: 'PRESENT' as const, factSupportEvidenceIds: [`evidence:${target}`] } } : assessed];
}

/** F1 portfolio: 24 logical Agents, 12 per page. Agent 13 (first on page 2) alone has a CRITICAL risk and NOT_SATISFIED control. */
export const portfolioIds = Array.from({ length: 24 }, (_, i) => `agent:${String(i + 1).padStart(2, '0')}`);
export const agent13 = 'agent:13';
export function portfolioFacts(id: string) {
  return assessedControl(id, id === agent13 ? 'NOT_SATISFIED' : 'SATISFIED', true);
}
export function portfolioOverlay(id: string) {
  return overlay([{ ...risk, governedRiskStateId: `risk:${id}`, subjectCanonicalObjectId: id, inherentBand: id === agent13 ? 'CRITICAL' : 'LOW',
    supportCurrency: 'SUPPORT_CURRENT' }]);
}
export function portfolioInput(page: 1 | 2): ExecutiveInput {
  return { organisationId: org, page, pageSize: 12,
    objects: { status: 'AVAILABLE', value: portfolioIds.map(id => ({ canonical_object_id: id, kind: 'AGENT' })) },
    subjects: portfolioIds.slice((page - 1) * 12, page * 12).map(id => ({ id,
      facts: { status: 'AVAILABLE', value: portfolioFacts(id) }, risks: { status: 'AVAILABLE', value: portfolioOverlay(id) } })) };
}
export const emptyModel = () => buildExecutiveModel({ organisationId: org, page: 1, pageSize: 12,
  objects: { status: 'AVAILABLE', value: [] }, subjects: [] });

/** R-01..R-04: the same 24-Agent, 2-page portfolio with per-Agent reads chosen by the test (`index` is 1-based, estate-wide). */
export type SubjectReads = Pick<ExecutiveSubject, 'facts' | 'risks'>;
export const unavailableRead = { status: 'UNKNOWN', failure: 'UNAVAILABLE' } as const;
export const withheldRead = { status: 'UNKNOWN', failure: 'CONTRACT_VIOLATION' } as const;
export const noGovernedFacts = (): SubjectReads => ({ facts: { status: 'AVAILABLE', value: [] }, risks: { status: 'AVAILABLE', value: overlay([]) } });
/** A revoked state only: CRITICAL and SUPPORT_NONE, so any leak of history into current coverage or attention is visible. */
export const closedOnlyRisks = (id: string) => overlay([{ ...risk, governedRiskStateId: `risk:closed:${id}`, subjectCanonicalObjectId: id,
  lifecycle: 'CLOSED', inherentBand: 'CRITICAL', supportCurrency: 'SUPPORT_NONE' }]);
export function scopedInput(page: 1 | 2, reads: (id: string, index: number) => SubjectReads): ExecutiveInput {
  return { organisationId: org, page, pageSize: 12,
    objects: { status: 'AVAILABLE', value: portfolioIds.map(id => ({ canonical_object_id: id, kind: 'AGENT' })) },
    subjects: portfolioIds.slice((page - 1) * 12, page * 12).map((id, i) => ({ id, ...reads(id, (page - 1) * 12 + i + 1) })) };
}
/** Page 1: open risks 01–04, CLOSED-only history 05–08, no states 09–12. Page 2: CRITICAL on 13, risk reads unavailable 14–18, withheld 19–24. */
export function mixedReads(id: string, index: number): SubjectReads {
  const facts = { status: 'AVAILABLE', value: portfolioFacts(id) } as const;
  if (index <= 4 || index === 13) return { facts, risks: { status: 'AVAILABLE', value: portfolioOverlay(id) } };
  if (index <= 8) return { facts, risks: { status: 'AVAILABLE', value: closedOnlyRisks(id) } };
  if (index <= 12) return { facts, risks: { status: 'AVAILABLE', value: overlay([]) } };
  return { facts, risks: index <= 18 ? unavailableRead : withheldRead };
}
