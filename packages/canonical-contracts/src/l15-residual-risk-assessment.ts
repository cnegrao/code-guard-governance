import type { L15InherentRiskAssessmentProposalContent, L15RiskRatingBand } from './l15-risk-assessment.ts';

/** S6 uses the existing RISK_ASSESSMENT stores. Pins are dependencies, never evidence or effectiveness. */
export interface L15ResidualRiskAssessmentProposalContent extends Omit<L15InherentRiskAssessmentProposalContent, 'assessmentBasis'> {
  readonly assessmentBasis: 'RESIDUAL';
  readonly inherentAssessmentStateId: string;
  readonly methodologyValidatedStateId: string;
  readonly treatmentStateIds: readonly string[];
  readonly controlAssessmentStateIds: readonly string[];
}
export const L15_RISK_ASSESSMENT_V2_EXECUTABLE_BASES = ['INHERENT', 'RESIDUAL'] as const;
export const L15_RESIDUAL_RESOLUTIONS = ['CURRENT', 'DEPENDENCY_INVALID', 'EXPIRED', 'ABSENT'] as const;
export type L15ResidualDependencyKind = 'GOVERNED_RISK' | 'INHERENT_RISK_ASSESSMENT' | 'RISK_METHODOLOGY' | 'RISK_TREATMENT' | 'CONTROL_ASSESSMENT';
/** The immutable current state returned by PostgreSQL; no treatment/control outcome is copied. */
export interface L15ResidualCurrentState {
  readonly state_id: string;
  readonly assessment_basis: 'RESIDUAL';
  readonly governed_risk_state_id: string;
  readonly inherent_assessment_state_id: string;
  readonly methodology_validated_state_id: string;
  readonly treatment_state_ids: readonly string[];
  readonly control_assessment_state_ids: readonly string[];
  readonly assessment_outcome: 'RATED' | 'INSUFFICIENT_EVIDENCE';
  readonly likelihood_level_code: string | null;
  readonly impact_level_code: string | null;
  readonly rating_band: L15RiskRatingBand | null;
  readonly effective_from: string;
  readonly valid_until: string;
  readonly recorded_at: string;
}
export type L15ResidualRiskAssessmentReadResult = {
  readonly effectiveAt: string;
  readonly recordedCutoff: string;
  readonly causeKind: string | null;
  readonly causeId: string | null;
  readonly causeResolution: string | null;
} & (
  | { readonly status: 'RATED' | 'INSUFFICIENT_EVIDENCE'; readonly resolution: 'CURRENT'; readonly dependencyKind: null; readonly dependencyId: null; readonly current: L15ResidualCurrentState }
  | { readonly status: 'UNKNOWN'; readonly resolution: 'DEPENDENCY_INVALID'; readonly dependencyKind: L15ResidualDependencyKind; readonly dependencyId: string; readonly current: null }
  | { readonly status: 'UNKNOWN'; readonly resolution: 'EXPIRED' | 'ABSENT'; readonly dependencyKind: null; readonly dependencyId: null; readonly current: null }
);
