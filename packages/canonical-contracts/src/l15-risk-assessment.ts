import {
  L15_ASSESSMENT_BASES, L15_ASSESSMENT_OUTCOMES, L15_RATING_BANDS, L15_SUPPORT_ADMISSIBILITY,
  type L15AssessmentBasis, type L15AssessmentOutcome, type L15RatingBand, type L15SupportTargetTag,
} from './l15-risk-intelligence.ts';

/**
 * M17-S4 INHERENT RISK_ASSESSMENT contracts (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§9.2, 10, 11, 12, 16-18, 20.1; migration
 * 20261013160000_m17_s4_inherent_risk_assessment_v1.sql). Types and pure mirrors of the closed DB vocabularies only. A
 * RISK_ASSESSMENT is the governed, human-authorized assessment of ONE exact current VALIDATED GOVERNED_RISK state under ONE
 * exact VALIDATED methodology version for a bounded validity interval. It is NOT a score: there is no numeric type here.
 * PostgreSQL is the arbiter of every shape, fingerprint, dependency, level membership, rating band, validity bound,
 * authorization, decision, state and resolution; nothing here grants authority or derives a band.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Basis, outcome, band (closed vocabularies)
// ---------------------------------------------------------------------------------------------------------------------

/** The frozen family vocabulary (INHERENT | RESIDUAL). RESIDUAL belongs to M17-S6 and is not executable in S4. */
export const L15_RISK_ASSESSMENT_BASES = L15_ASSESSMENT_BASES;
export type L15RiskAssessmentBasis = L15AssessmentBasis;
/** The executable S4 basis: INHERENT only (PostgreSQL refuses RESIDUAL with ASSESSMENT_BASIS_NOT_EXECUTABLE). */
export const L15_RISK_ASSESSMENT_EXECUTABLE_BASES = ['INHERENT'] as const;
export type L15ExecutableRiskAssessmentBasis = (typeof L15_RISK_ASSESSMENT_EXECUTABLE_BASES)[number];

/** Stored governed outcome: exactly RATED | INSUFFICIENT_EVIDENCE (UNKNOWN is a read result, never stored). */
export const L15_RISK_ASSESSMENT_OUTCOMES = L15_ASSESSMENT_OUTCOMES;
export type L15RiskAssessmentOutcome = L15AssessmentOutcome;

/** DB-derived band of the exact pinned methodology rating cell (never caller-supplied, never arithmetic). */
export const L15_RISK_RATING_BANDS = L15_RATING_BANDS;
export type L15RiskRatingBand = L15RatingBand;

/** Executable proposal source class. SYSTEM_SEED and SOURCE_CONNECTION are never admissible for RISK_ASSESSMENT. */
export const L15_RISK_ASSESSMENT_EXECUTABLE_SOURCE_CLASSES = ['LOCAL_HUMAN'] as const;
export type L15RiskAssessmentSourceClass = (typeof L15_RISK_ASSESSMENT_EXECUTABLE_SOURCE_CLASSES)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Dependency pins (never support)
// ---------------------------------------------------------------------------------------------------------------------

/** The exact GOVERNED_RISK state an assessment targets (the logical key part). Never a subject / scenario / latest risk. */
export interface L15RiskAssessmentGovernedRiskPin {
  readonly governedRiskStateId: string;
}

/**
 * The full S3 dependency key the state pins (organisation + state + subject key + scenario pins + VALIDATED), copied by
 * PostgreSQL from the pinned risk state and bound by a composite FK; never caller-supplied, never risk truth.
 */
export interface L15RiskAssessmentStateGovernedRiskPin extends L15RiskAssessmentGovernedRiskPin {
  readonly governedRiskSubjectKey: string;
  readonly governedRiskScenarioDefinitionId: string;
  readonly governedRiskScenarioDefinitionVersionId: string;
  readonly governedRiskScenarioContentHash: string;
  readonly governedRiskScenarioValidatedStateId: string;
}

/** The exact methodology version tuple a proposal names (never latest, never by label, never a default). */
export interface L15RiskAssessmentMethodologyPin {
  readonly methodologyId: string;
  readonly methodologyVersionId: string;
  /** PostgreSQL content hash of that exact version (lowercase hex SHA-256). */
  readonly methodologyContentHash: string;
}

/** The state additionally pins the exact VALIDATED methodology registry state the S2 exact resolver returned. */
export interface L15RiskAssessmentStateMethodologyPin extends L15RiskAssessmentMethodologyPin {
  readonly methodologyValidatedStateId: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Support (provenance only)
// ---------------------------------------------------------------------------------------------------------------------

/** Admissible support tags of a rank-3 RISK_ASSESSMENT owner (§9.2): RISK_HYPOTHESIS, RISK_SIGNAL, every rank-0 tag. */
export const L15_RISK_ASSESSMENT_SUPPORT_TAGS = L15_SUPPORT_ADMISSIBILITY.RISK_ASSESSMENT;
export const L15_RISK_ASSESSMENT_SUPPORT_MAX_ENTRIES = 64;
/** Rank-3 support owner artifacts (first-class: proposal, decision, state). */
export const L15_RISK_ASSESSMENT_SUPPORT_OWNER_ARTIFACTS = ['PROPOSAL', 'DECISION', 'STATE'] as const;
export type L15RiskAssessmentSupportOwnerArtifact = (typeof L15_RISK_ASSESSMENT_SUPPORT_OWNER_ARTIFACTS)[number];
export interface L15RiskAssessmentSupportEntry { readonly tag: L15SupportTargetTag; readonly targetId: string }
export type L15RiskAssessmentSupport =
  | { readonly status: 'NONE'; readonly entries: readonly [] }
  | { readonly status: 'PRESENT'; readonly entries: readonly L15RiskAssessmentSupportEntry[] };

// ---------------------------------------------------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Immutable INHERENT proposal content (flat, mirroring the typed DB proposal). There is deliberately NO rating band, score,
 * weight, percentage, domain, subject, scenario, title, description or rationale field.
 *  - VALIDATE: assessmentOutcome REQUIRED; RATED requires both level codes, INSUFFICIENT_EVIDENCE forbids both;
 *    requestedValidUntil REQUIRED; targetStateId null.
 *  - REVOKE: targetStateId = expectedCurrentStateId (the exact current VALIDATED assessment); no outcome / level / validUntil;
 *    the methodology tuple equals the target's.
 */
export interface L15InherentRiskAssessmentProposalContent extends L15RiskAssessmentGovernedRiskPin, L15RiskAssessmentMethodologyPin {
  readonly intent: 'VALIDATE' | 'REVOKE';
  readonly sourceClass: L15RiskAssessmentSourceClass;
  readonly assessmentBasis: L15ExecutableRiskAssessmentBasis;
  readonly assessmentOutcome: L15RiskAssessmentOutcome | null;
  /** RATED only: a level code of the PINNED likelihood scale (exact code; never an ordinal, never folded). */
  readonly likelihoodLevelCode: string | null;
  /** RATED only: a level code of the PINNED impact scale. */
  readonly impactLevelCode: string | null;
  /** null = IMMEDIATE (DB transaction instant); else a canonical UTC microsecond instant (BACKDATED / FUTURE_DATED need policy). */
  readonly requestedEffectiveFrom: string | null;
  /** VALIDATE: mandatory effective end, [effective_from, valid_until), <= effective_from + the methodology maximum. */
  readonly requestedValidUntil: string | null;
  /** null = explicit expected-none of the logical key; else the exact current head state. REVOKE: = targetStateId. */
  readonly expectedCurrentStateId: string | null;
  /** REVOKE only. */
  readonly targetStateId: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// State, results, resolver, read projection
// ---------------------------------------------------------------------------------------------------------------------

export const L15_RISK_ASSESSMENT_STATE_KINDS = ['VALIDATED', 'REVOKED'] as const;
export type L15RiskAssessmentStateKind = (typeof L15_RISK_ASSESSMENT_STATE_KINDS)[number];

/** Immutable RISK_ASSESSMENT state (no score; band DB-derived; validity mandatory on VALIDATED). */
export interface L15RiskAssessmentState {
  readonly stateId: string;
  readonly stateKind: L15RiskAssessmentStateKind;
  readonly assessmentBasis: L15RiskAssessmentBasis;
  readonly governedRisk: L15RiskAssessmentStateGovernedRiskPin;
  readonly methodology: L15RiskAssessmentStateMethodologyPin;
  readonly assessmentOutcome: L15RiskAssessmentOutcome | null;
  readonly likelihoodLevelCode: string | null;
  readonly impactLevelCode: string | null;
  readonly ratingBand: L15RiskRatingBand | null;
  readonly predecessorStateId: string | null;
  readonly revokesStateId: string | null;
  readonly effectiveFrom: string;
  /** The effective end of a VALIDATED state (half-open); null on a REVOKED tombstone. */
  readonly validUntil: string | null;
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

export const L15_RISK_ASSESSMENT_COMMAND_OUTCOMES = ['SUBMITTED', 'VALIDATED', 'REJECTED', 'DEFERRED', 'REVOKED', 'DENIED'] as const;
export type L15RiskAssessmentCommandOutcome = (typeof L15_RISK_ASSESSMENT_COMMAND_OUTCOMES)[number];

/** Durable command result (exact replay returns the original row with replay = true). */
export interface L15RiskAssessmentCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
  readonly subjectKind: 'RISK_ASSESSMENT';
  readonly outcome: L15RiskAssessmentCommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: string | null;
  readonly expectationKind: 'EXPECTED_NONE' | 'EXPECTED_CURRENT' | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly governedRiskStateId: string | null;
  readonly assessmentBasis: L15RiskAssessmentBasis | null;
  readonly methodology: L15RiskAssessmentMethodologyPin | null;
  readonly assessmentOutcome: L15RiskAssessmentOutcome | null;
  readonly likelihoodLevelCode: string | null;
  readonly impactLevelCode: string | null;
  readonly ratingBand: L15RiskRatingBand | null;
  readonly requestedValidUntil: string | null;
  readonly stateId: string | null;
  readonly stateKind: L15RiskAssessmentStateKind | null;
  readonly predecessorStateId: string | null;
  readonly methodologyValidatedStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly validUntil: string | null;
  readonly recordedAt: string;
}

/** Closed resolution of one assessment key at (effective_at, recorded_cutoff); read projection only. */
export const L15_RISK_ASSESSMENT_RESOLUTIONS = [
  'CURRENT', 'NO_STATE', 'REVOKED', 'NOT_YET_EFFECTIVE', 'EXPIRED', 'GOVERNED_RISK_DEPENDENCY_INVALID',
  'METHODOLOGY_DEPENDENCY_INVALID',
] as const;
export type L15RiskAssessmentResolution = (typeof L15_RISK_ASSESSMENT_RESOLUTIONS)[number];

/**
 * Closed member read status (O36). UNKNOWN = no current valid INHERENT assessment of the exact governed-risk state at the
 * coordinates (never LOW, never 0, never a default level / band); INSUFFICIENT_EVIDENCE = a current governed assessment
 * that explicitly concluded the evidence is insufficient; RATED = current, with exact levels and the DB-derived band.
 */
export const L15_RISK_ASSESSMENT_READ_STATUSES = ['UNKNOWN', 'RATED', 'INSUFFICIENT_EVIDENCE'] as const;
export type L15RiskAssessmentReadStatus = (typeof L15_RISK_ASSESSMENT_READ_STATUSES)[number];

/** Exact read request: the exact governed-risk state + basis at both coordinates (never latest-by-subject). */
export interface L15RiskAssessmentReadRequest {
  readonly governedRiskStateId: string;
  readonly assessmentBasis: L15ExecutableRiskAssessmentBasis;
  /** null = the DB instant. */
  readonly effectiveAt: string | null;
  /** null = the DB instant. */
  readonly recordedCutoff: string | null;
}

/** The exact current assessment lineage (present only when the read status is RATED / INSUFFICIENT_EVIDENCE). */
export interface L15CurrentRiskAssessmentLineage {
  readonly stateId: string;
  readonly methodology: L15RiskAssessmentStateMethodologyPin;
  readonly effectiveFrom: string;
  readonly validUntil: string;
  readonly recordedAt: string;
  readonly predecessorStateId: string | null;
  readonly proposalId: string;
  readonly governanceDecisionId: string;
  readonly authorizationDecisionId: string;
  readonly authorityPolicyId: string;
  readonly authorityPolicyVersionId: string;
  readonly authorityPolicyContentHash: string;
  readonly sourceClass: 'LOCAL_HUMAN';
  readonly supportStatus: 'NONE' | 'PRESENT';
}

interface L15RiskAssessmentReadBase {
  readonly effectiveAt: string;
  readonly recordedCutoff: string;
  readonly governedRiskStateId: string;
  readonly assessmentBasis: L15ExecutableRiskAssessmentBasis;
}

/** The three read results never collapse into one representation (UNKNOWN carries no assessment content at all). */
export type L15RiskAssessmentReadResult =
  | (L15RiskAssessmentReadBase & {
      readonly status: 'UNKNOWN';
      readonly resolution: Exclude<L15RiskAssessmentResolution, 'CURRENT'>;
      readonly current: null;
    })
  | (L15RiskAssessmentReadBase & {
      readonly status: 'INSUFFICIENT_EVIDENCE';
      readonly resolution: 'CURRENT';
      readonly current: L15CurrentRiskAssessmentLineage;
    })
  | (L15RiskAssessmentReadBase & {
      readonly status: 'RATED';
      readonly resolution: 'CURRENT';
      readonly likelihoodLevelCode: string;
      readonly impactLevelCode: string;
      readonly ratingBand: L15RiskRatingBand;
      readonly current: L15CurrentRiskAssessmentLineage;
    });
