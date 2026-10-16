import type { L15GovernedRiskSupport } from './l15-governed-risk.ts';

/** M17-S5: PostgreSQL alone resolves pins, authorizes decisions and creates governed state. */
export const L15_RISK_TREATMENT_OPTIONS = ['MITIGATE', 'AVOID', 'TRANSFER'] as const;
export const L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES = ['PLANNED', 'IMPLEMENTED'] as const;
export const L15_RISK_TREATMENT_REVOCATION_REASONS = ['TREATMENT_FAILED', 'TREATMENT_WITHDRAWN', 'RECORDED_IN_ERROR'] as const;
export type L15RiskTreatmentOption = (typeof L15_RISK_TREATMENT_OPTIONS)[number];
export type L15RiskTreatmentImplementationStatus = (typeof L15_RISK_TREATMENT_IMPLEMENTATION_STATUSES)[number];
export type L15RiskTreatmentRevocationReason = (typeof L15_RISK_TREATMENT_REVOCATION_REASONS)[number];
export type L15RiskTreatmentSupport = L15GovernedRiskSupport;
export interface L15RiskTreatmentKey {
  readonly governedRiskStateId: string;
  readonly treatmentOption: L15RiskTreatmentOption;
  readonly treatmentOrdinalKey: string;
}
export interface L15RiskTreatmentControlPin {
  readonly controlDefinitionId: string;
  readonly controlDefinitionVersionId: string;
  readonly contentHash: string;
  readonly validatedStateId: string;
}
export interface L15RiskTreatmentProposalContent extends L15RiskTreatmentKey {
  readonly intent: 'VALIDATE' | 'REVOKE';
  readonly sourceClass: 'LOCAL_HUMAN';
  readonly responsibleGovernancePartyId: string;
  readonly partyValidatedStateId: string;
  readonly implementationStatus: L15RiskTreatmentImplementationStatus | null;
  /** ISO calendar date; planning metadata only, never an effective end. */
  readonly targetImplementationDate: string | null;
  readonly treatmentRevocationReason: L15RiskTreatmentRevocationReason | null;
  /** MITIGATE only. DB resolves exact version tuples and validated states into normalized immutable pins at submission. */
  readonly controlDefinitionVersionIds: readonly string[];
  readonly requestedEffectiveFrom: string | null;
  readonly requestedEffectiveTo: string | null;
  readonly expectedCurrentStateId: string | null;
  readonly targetStateId: string | null;
}
export interface L15RiskTreatmentCommandResult extends L15RiskTreatmentKey {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
  readonly subjectKind: 'RISK_TREATMENT';
  readonly outcome: 'SUBMITTED' | 'DENIED' | 'VALIDATED' | 'REVOKED' | 'REJECTED' | 'DEFERRED';
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: string | null;
  readonly expectationKind: 'EXPECTED_NONE' | 'EXPECTED_CURRENT' | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string;
  readonly governanceDecisionId: string | null;
  readonly responsibleGovernancePartyId: string;
  readonly partyValidatedStateId: string;
  readonly implementationStatus: L15RiskTreatmentImplementationStatus | null;
  readonly targetImplementationDate: string | null;
  readonly treatmentRevocationReason: L15RiskTreatmentRevocationReason | null;
  readonly controlPins: readonly L15RiskTreatmentControlPin[];
  readonly stateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}
export interface L15RiskTreatmentReadRequest extends L15RiskTreatmentKey {
  readonly effectiveAt: string | null;
  readonly recordedCutoff: string | null;
}
export type L15RiskTreatmentResolution = 'CURRENT' | 'NO_STATE' | 'REVOKED' | 'NOT_YET_EFFECTIVE' | 'EXPIRED'
  | 'GOVERNED_RISK_DEPENDENCY_INVALID' | 'GOVERNANCE_PARTY_DEPENDENCY_INVALID' | 'CONTROL_DEFINITION_DEPENDENCY_INVALID';
export interface L15RiskTreatmentCurrentState extends L15RiskTreatmentKey {
  readonly stateId: string;
  readonly implementationStatus: L15RiskTreatmentImplementationStatus;
  readonly responsibleGovernancePartyId: string;
  readonly partyValidatedStateId: string;
  readonly targetImplementationDate: string | null;
  readonly controlPins: readonly L15RiskTreatmentControlPin[];
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
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
export type L15RiskTreatmentReadResult = {
  readonly effectiveAt: string;
  readonly recordedCutoff: string;
} & ({ readonly status: 'UNKNOWN'; readonly resolution: Exclude<L15RiskTreatmentResolution, 'CURRENT'>;
  readonly failingDependency: { readonly kind: 'GOVERNED_RISK' | 'GOVERNANCE_PARTY' | 'CONTROL_DEFINITION'; readonly stateId: string } | null;
  readonly current: null }
  | { readonly status: L15RiskTreatmentImplementationStatus; readonly resolution: 'CURRENT'; readonly failingDependency: null;
    readonly current: L15RiskTreatmentCurrentState });
