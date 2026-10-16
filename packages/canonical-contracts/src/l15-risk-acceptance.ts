import type { L15GovernedRiskSupport } from './l15-governed-risk.ts';

/** Acceptance is an independent bounded decision about one exact residual state. */
export const L15_RISK_ACCEPTANCE_RESOLUTIONS = ['CURRENT', 'DEPENDENCY_INVALID', 'EXPIRED', 'ABSENT'] as const;
export type L15RiskAcceptanceResolution = (typeof L15_RISK_ACCEPTANCE_RESOLUTIONS)[number];
export type L15RiskAcceptanceSupport = L15GovernedRiskSupport;
export interface L15RiskAcceptanceKey { readonly residualAssessmentStateId: string }
export interface L15RiskAcceptanceProposalContent extends L15RiskAcceptanceKey {
  readonly intent: 'VALIDATE' | 'REVOKE';
  readonly sourceClass: 'LOCAL_HUMAN';
  readonly requestedEffectiveFrom: string | null;
  readonly requestedValidUntil: string | null;
  readonly expectedCurrentStateId: string | null;
  readonly targetStateId: string | null;
}
export interface L15RiskAcceptanceCommandResult extends L15RiskAcceptanceKey {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
  readonly subjectKind: 'RISK_ACCEPTANCE';
  readonly outcome: 'SUBMITTED' | 'DENIED' | 'VALIDATED' | 'REVOKED' | 'REJECTED' | 'DEFERRED';
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: string | null;
  readonly expectationKind: 'EXPECTED_NONE' | 'EXPECTED_CURRENT' | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string;
  readonly governanceDecisionId: string | null;
  readonly governedRiskStateId: string;
  readonly stateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly validUntil: string | null;
  readonly recordedAt: string;
}
export interface L15RiskAcceptanceReadRequest extends L15RiskAcceptanceKey {
  readonly effectiveAt: string | null;
  readonly recordedCutoff: string | null;
}
export interface L15RiskAcceptanceCurrentState extends L15RiskAcceptanceKey {
  readonly stateId: string;
  readonly stateKind: 'VALIDATED';
  readonly governedRiskStateId: string;
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string;
  readonly validUntil: string;
  readonly recordedAt: string;
  readonly proposalId: string;
  readonly governanceDecisionId: string;
  readonly authorizationDecisionId: string;
  readonly authorityPolicyId: string;
  readonly authorityPolicyVersionId: string;
  readonly authorityPolicyContentHash: string;
  readonly sourceClass: 'LOCAL_HUMAN';
  readonly supportStatus: 'NONE' | 'PRESENT';
}
export type L15RiskAcceptanceReadResult = {
  readonly effectiveAt: string; readonly recordedCutoff: string;
} & ({ readonly status: 'ACCEPTED'; readonly resolution: 'CURRENT'; readonly failingDependency: null; readonly current: L15RiskAcceptanceCurrentState }
  | { readonly status: 'UNKNOWN'; readonly resolution: Exclude<L15RiskAcceptanceResolution, 'CURRENT'>;
    readonly failingDependency: { readonly kind: 'RESIDUAL_RISK_ASSESSMENT'; readonly stateId: string } | null; readonly current: null });
