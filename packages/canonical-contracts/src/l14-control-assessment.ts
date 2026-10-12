import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14GovernanceOutcome, L14ProposalIntent, L14ProposalSubjectKind,
  L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1C.5 CONTROL_ASSESSMENT contracts — the fifth and final authoritative M16 fact family
 * (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§2-4, 6-9, 15-18; O31, O38, O40, O55). Closed vocabularies
 * only. PostgreSQL is the authority for every fingerprint, resolution, authorization, decision, fact state and resolver answer.
 *
 * - Meaning: a governed assessment of ONE exact VALIDATED CONTROL_APPLICABILITY state whose outcome is APPLIES. The closed
 *   outcomes are exactly SATISFIED | PARTIALLY_SATISFIED | NOT_SATISFIED | NOT_ASSESSED | INSUFFICIENT_EVIDENCE. WAIVED
 *   is unsupported in M16 V1 (refused); there is no score, coverage, maturity or residual computation. An explicit
 *   NOT_ASSESSED is a positive governed assertion; absence of a current valid assessment is UNKNOWN (never stored).
 * - Target identity: the exact controlApplicabilityStateId (never a target / control pair, a successor or the current /
 *   latest applicability). PostgreSQL resolves and mirrors the immutable tuple of that state (target, control definition
 *   version, pinned CONTROL_DEFINITION state); the caller never supplies it. DOES_NOT_APPLY or REVOKED states refuse.
 * - Logical fact key: organisation + controlApplicabilityStateId. Renewals / corrections are governed lineage successors.
 * - validUntil is MANDATORY on VALIDATE, strictly later than the effective start, and IS the fact effective_to (never a
 *   second end date): validity is [effectiveFrom, validUntil). Expiry needs no write; a head never overrides it.
 * - No carry-over: an assessment never transfers to a successor applicability state. When the pinned applicability is
 *   superseded / revoked / dependency-invalid the assessment is historical and the current answer is UNKNOWN.
 * - CONTROL_FINDING is not a fact family (no subject kind, no head, no table) — ADR §3 / O38.
 */

export const L14_CONTROL_ASSESSMENT_SUBJECT_KIND = 'CONTROL_ASSESSMENT' as const satisfies L14ProposalSubjectKind;

/** Closed stored outcome. UNKNOWN is never stored: it is the read outcome when no current valid assessment exists. */
export const L14_CONTROL_ASSESSMENT_OUTCOMES = [
  'SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'NOT_ASSESSED', 'INSUFFICIENT_EVIDENCE',
] as const;
export type L14ControlAssessmentOutcome = (typeof L14_CONTROL_ASSESSMENT_OUTCOMES)[number];
/** Explicitly unsupported in M16 V1 (the exception / waiver lifecycle is deferred): always refused, never stored. */
export const L14_CONTROL_ASSESSMENT_UNSUPPORTED_OUTCOMES = ['WAIVED'] as const;
/** The read-side answer: a governed outcome, or UNKNOWN when no current valid assessment exists. */
export type L14ControlAssessmentReadOutcome = L14ControlAssessmentOutcome | 'UNKNOWN';

/** Closed reason codes: exactly one per governance outcome. No free-text rationale. */
export const L14_CONTROL_ASSESSMENT_REASON_CODES = {
  VALIDATE: 'CONTROL_ASSESSMENT_VALIDATED',
  REJECT: 'CONTROL_ASSESSMENT_REJECTED',
  DEFER: 'CONTROL_ASSESSMENT_DEFERRED',
  REVOKE: 'CONTROL_ASSESSMENT_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14ControlAssessmentReasonCode = (typeof L14_CONTROL_ASSESSMENT_REASON_CODES)[L14GovernanceOutcome];

/**
 * Immutable typed proposal content. VALIDATE: no target state; MANDATORY validUntil (a VALIDATE on a key whose current
 * state exists is a renewal / correction). REVOKE: the exact current VALIDATED assessment of the same key + the same
 * outcome; never a validUntil of its own. Only LOCAL_HUMAN is executable in S1C.5.
 */
export interface L14ControlAssessmentProposalContent {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  /** The exact S1C.4 VALIDATED APPLIES state being assessed (the logical key). */
  readonly controlApplicabilityStateId: string;
  readonly assessmentOutcome: L14ControlAssessmentOutcome;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  /** VALIDATE: canonical UTC microseconds strictly after the effective start (becomes effective_to). REVOKE: null. */
  readonly requestedValidUntil: string | null;
  readonly targetStateId: string | null;
}

export type L14ControlAssessmentCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable CONTROL_ASSESSMENT command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14ControlAssessmentCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14ControlAssessmentCommandKind;
  readonly subjectKind: typeof L14_CONTROL_ASSESSMENT_SUBJECT_KIND;
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly controlApplicabilityStateId: string | null;
  /** The DB-mirrored exact control definition version of the pinned applicability state (audit only). */
  readonly controlDefinitionId: string | null;
  readonly controlDefinitionVersionId: string | null;
  readonly contentHash: string | null;
  readonly assessmentOutcome: L14ControlAssessmentOutcome | null;
  readonly factStateId: string | null;
  readonly stateKind: L14RegistryStateKind | null;
  /** The lineage predecessor of the produced fact state (the renewed / corrected / revoked state), if any. */
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string | null;
  /** The fact effective_to (mandatory on VALIDATED; null on REVOKED and on non-state outcomes). */
  readonly validUntil: string | null;
  readonly recordedAt: string;
}

/**
 * One current governed assessment of an exact target, as PostgreSQL's bounded owner-only read primitive
 * (gov_repo.l14_control_assessments_current_v1) returns it at one effective instant + recorded cutoff: at most one row per
 * control definition whose current applicability is APPLIES, assessing exactly that current applicability state. An
 * applicable control with no row is UNKNOWN; a DOES_NOT_APPLY / UNKNOWN applicability never yields a row.
 */
export interface L14CurrentControlAssessment {
  readonly controlDefinitionId: string;
  readonly controlDefinitionVersionId: string;
  readonly contentHash: string;
  readonly controlApplicabilityStateId: string;
  readonly factStateId: string;
  readonly assessmentOutcome: L14ControlAssessmentOutcome;
  readonly effectiveFrom: string;
  readonly validUntil: string;
  readonly recordedAt: string;
}
