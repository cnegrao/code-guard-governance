import type { L15ConflictOutcome, L15RiskLifecycle } from './l15-risk-intelligence.ts';
export interface L15RiskProjectionReadRequest {
  readonly subjectType: 'CANONICAL_OBJECT'|'RELATIONSHIP_STATE'; readonly subjectCanonicalKind: string|null;
  readonly subjectCanonicalObjectId: string|null; readonly subjectRelationshipId: string|null;
  readonly subjectRelationshipStateId: string|null; readonly scenarioDefinitionId: string;
  readonly effectiveAt: string|null; readonly recordedCutoff: string|null;
}
export interface L15AccountablePartyProjection { readonly responsibilityRole: string; readonly governancePartyId: string; readonly factStateId: string }
export interface L15ControlCoverageProjection { readonly controlDefinitionId: string; readonly controlDefinitionVersionId: string;
  readonly applicability: 'APPLIES'|'DOES_NOT_APPLY'; readonly assessmentOutcome: 'SATISFIED'|'PARTIALLY_SATISFIED'|'NOT_SATISFIED'|'NOT_ASSESSED'|'INSUFFICIENT_EVIDENCE'|'UNKNOWN';
  readonly applicabilityFactStateId: string; readonly assessmentFactStateId: string|null }
export interface L15RiskProjectionReadResult {
  readonly governedRiskStateId: string|null; readonly lifecycle: L15RiskLifecycle|null;
  readonly conflictOutcome: L15ConflictOutcome; readonly liveProposalCount: number; readonly distinctContentCount: number;
  readonly accountablePartyStatus: 'CURRENT'|'UNKNOWN'; readonly accountableParties: readonly L15AccountablePartyProjection[];
  readonly controlCoverage: readonly L15ControlCoverageProjection[]; readonly effectiveAt: string; readonly recordedCutoff: string;
}
