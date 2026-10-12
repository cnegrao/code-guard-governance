import type { L14SourceClass, L14SupportStatus } from './l14-authority-policy.ts';
import type { L14ExecutableFactSubjectKind, L14ResponsibilityRole } from './l14-responsibility-assignment.ts';
import type { L14PolicyApplicabilityOutcome } from './l14-policy-applicability.ts';
import type { L14ControlAssessmentOutcome } from './l14-control-assessment.ts';

/**
 * M16 read-projection closure contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§18.1, 18.2, 22; O32, O41).
 * Read models only: no command, no fingerprint, no state. PostgreSQL computes every row through the existing exact resolvers.
 *
 * - O32: the Passport governed projection returns, for ONE exact AGENT (and optionally ONE exact selected AGENT_VERSION), the
 *   CURRENT VALID governed facts of the five M16 families that Passport families 3 / 4 / 12 render, each with its exact M16
 *   lineage (family 14). Absence of a row is UNKNOWN; nothing is defaulted, inherited across AGENT / AGENT_VERSION, taken
 *   from a legacy owner / business_domain / cg_* value or scored.
 * - O41: the conflict projection answers ONE exact logical fact key with a closed read outcome. These outcome values are a
 *   read vocabulary only: they never extend the trust (INFERRED .. VALIDATED) or applicability (APPLIES | DOES_NOT_APPLY)
 *   vocabularies and are never stored.
 */

/** The only targets a Passport projection row may carry. RESPONSIBILITY / BUSINESS_CONTEXT rows are always AGENT. */
export const L14_PASSPORT_TARGET_KINDS = ['AGENT', 'AGENT_VERSION'] as const;
export type L14PassportTargetKind = (typeof L14_PASSPORT_TARGET_KINDS)[number];

/** Exact M16 lineage of one rendered governed fact (ids and temporal coordinates only; never content or free text). */
export interface L14GovernedFactLineage {
  readonly factStateId: string;
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string;
  /** Explicit immutable end (for CONTROL_ASSESSMENT: valid_until). null = open-ended. */
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
  readonly trustState: 'VALIDATED';
  readonly sourceClass: L14SourceClass;
  readonly supportStatus: L14SupportStatus;
  readonly proposalId: string;
  readonly proposalSubmittedAt: string;
  readonly governanceDecisionId: string;
  readonly decisionOutcome: 'VALIDATE';
  readonly decisionReasonCode: string;
  readonly decidedAt: string;
  readonly authorizationDecisionId: string;
  readonly authorizationResult: 'ALLOW';
  readonly authorizationEvaluatedAt: string;
  readonly authorityPolicy: { readonly authorityPolicyId: string; readonly versionId: string; readonly contentHash: string };
  /** Normalized support evidence ids (never fabricated; empty when none was recorded). */
  readonly factSupportEvidenceIds: readonly string[];
  readonly decisionSupportEvidenceIds: readonly string[];
  readonly proposalSupportEvidenceIds: readonly string[];
  /** The single pair of coordinates every row of one projection was resolved at. */
  readonly readEffectiveAt: string;
  readonly readRecordedCutoff: string;
}

/** Closed per-family value of one current governed fact, with its exact pinned dependency. */
export type L14PassportGovernedValue =
  | { readonly family: 'RESPONSIBILITY_ASSIGNMENT'; readonly responsibilityRole: L14ResponsibilityRole;
      readonly governancePartyId: string; readonly partyValidatedStateId: string }
  | { readonly family: 'BUSINESS_CONTEXT_ASSIGNMENT'; readonly semanticKind: 'BUSINESS_DOMAIN'; readonly domainId: string;
      readonly domainValidatedStateId: string }
  | { readonly family: 'POLICY_APPLICABILITY'; readonly policyId: string; readonly policyVersionId: string; readonly contentHash: string;
      readonly policyVersionValidatedStateId: string; readonly applicability: L14PolicyApplicabilityOutcome }
  | { readonly family: 'CONTROL_APPLICABILITY'; readonly controlDefinitionId: string; readonly controlDefinitionVersionId: string;
      readonly contentHash: string; readonly controlDefinitionValidatedStateId: string; readonly applicability: L14PolicyApplicabilityOutcome }
  | { readonly family: 'CONTROL_ASSESSMENT'; readonly controlDefinitionId: string; readonly controlDefinitionVersionId: string;
      readonly contentHash: string; readonly controlApplicabilityStateId: string; readonly assessmentOutcome: L14ControlAssessmentOutcome };

export interface L14PassportGovernedFact {
  readonly targetKind: L14PassportTargetKind;
  readonly targetCanonicalObjectId: string;
  readonly value: L14PassportGovernedValue;
  readonly lineage: L14GovernedFactLineage;
}

/** O41 closed read outcomes (exactly three; never stored, never a trust / applicability value). */
export const L14_CONFLICT_READ_OUTCOMES = ['RESOLVED', 'CONFLICT', 'INSUFFICIENT_EVIDENCE'] as const;
export type L14ConflictReadOutcome = (typeof L14_CONFLICT_READ_OUTCOMES)[number];

/** One exact logical fact key (ADR §3). Keys are never collapsed: a different party / policy / control / target is another key. */
export type L14FactKey =
  | { readonly subjectKind: 'RESPONSIBILITY_ASSIGNMENT'; readonly targetCanonicalKind: string; readonly targetCanonicalObjectId: string;
      readonly responsibilityRole: L14ResponsibilityRole; readonly governancePartyId: string }
  | { readonly subjectKind: 'BUSINESS_CONTEXT_ASSIGNMENT'; readonly targetCanonicalKind: string; readonly targetCanonicalObjectId: string;
      readonly semanticKind: 'BUSINESS_DOMAIN' | 'INFORMATION_DOMAIN' }
  | { readonly subjectKind: 'POLICY_APPLICABILITY' | 'CONTROL_APPLICABILITY'; readonly target: L14FactKeyTarget;
      /** policyId (POLICY_APPLICABILITY) or controlDefinitionId (CONTROL_APPLICABILITY). */
      readonly definitionId: string }
  | { readonly subjectKind: 'CONTROL_ASSESSMENT'; readonly controlApplicabilityStateId: string };
export type L14FactKeyTarget =
  | { readonly targetType: 'CANONICAL_OBJECT'; readonly targetCanonicalKind: string; readonly targetCanonicalObjectId: string }
  | { readonly targetType: 'RELATIONSHIP_STATE'; readonly relationshipId: string; readonly relationshipStateId: string };

/** A live competing proposal: identity + support preserved, never ranked (ordered by opaque proposal id only). */
export interface L14LiveProposal {
  readonly proposalId: string;
  readonly submittedAt: string;
  readonly sourceClass: L14SourceClass;
  readonly supportStatus: L14SupportStatus;
  readonly supportEvidenceIds: readonly string[];
  readonly deferred: boolean;
  /** Digest of the closed typed asserted content: equal digests corroborate, different digests compete. */
  readonly assertedContentDigest: string;
}

export interface L14ConflictReadResult {
  readonly subjectKind: L14ExecutableFactSubjectKind;
  readonly outcome: L14ConflictReadOutcome;
  readonly liveProposalCount: number;
  readonly distinctContentCount: number;
  /** RESOLVED only: the exact current governed fact state and its governance decision. */
  readonly governedFact: { readonly factStateId: string; readonly governanceDecisionId: string; readonly effectiveFrom: string;
    readonly effectiveTo: string | null; readonly recordedAt: string } | null;
  /** CONFLICT / INSUFFICIENT_EVIDENCE only. */
  readonly liveProposals: readonly L14LiveProposal[];
  readonly readEffectiveAt: string;
  readonly readRecordedCutoff: string;
}
