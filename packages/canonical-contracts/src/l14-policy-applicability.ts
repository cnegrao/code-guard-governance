import type { CanonicalObjectKind } from './contracts.ts';
import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14GovernanceOutcome, L14ProposalIntent, L14ProposalSubjectKind,
  L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1C.3 POLICY_APPLICABILITY contracts — the third authoritative M16 fact family
 * (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§2-4, 6-9, 13, 16-18). Closed vocabularies only.
 * PostgreSQL is the authority for every fingerprint, hash resolution, authorization, decision, fact state and resolver answer.
 *
 * - Meaning: an exact VALIDATED policy version either APPLIES or DOES_NOT_APPLY to one exact governed target. Absence of a
 *   current governed fact is UNKNOWN — never DOES_NOT_APPLY. A validated DOES_NOT_APPLY is a positive governed assertion.
 * - Target identity: a closed discriminated union. CANONICAL_OBJECT = organisation + canonical kind (any of the 11) +
 *   canonical object id. RELATIONSHIP_STATE = organisation + relationship id + relationship state id, resolved exactly
 *   (never a bare state id, a relationship id alone, the latest / current state, a successor, an endpoint or a type).
 *   The relationship type is DB-resolved for Authority Policy scope only; a caller never supplies it.
 * - Policy identity: the S1B.3-admitted policyId. Exact version identity: policyId + versionId + contentHash (the
 *   DB-verified hash; PostgreSQL resolves it — knowing a valid-looking SHA-256 grants nothing). policyVersionValidatedStateId
 *   is the pinned S1B.4 VALIDATED state: dependency lineage only, never an identity.
 * - Logical fact key: organisation + exact target + policyId. versionId, contentHash, the pinned state and the outcome are
 *   NOT part of the key: a version or outcome change is a governed lineage successor of the same key.
 * - Never a canonical relationship / object, the legacy current-version pointer, legacy status / approval, mapping row, scanner match, LLM
 *   analysis or text similarity.
 */

export const L14_POLICY_APPLICABILITY_SUBJECT_KIND = 'POLICY_APPLICABILITY' as const satisfies L14ProposalSubjectKind;

/** Closed target union discriminants. */
export const L14_POLICY_APPLICABILITY_TARGET_TYPES = ['CANONICAL_OBJECT', 'RELATIONSHIP_STATE'] as const;
export type L14PolicyApplicabilityTargetType = (typeof L14_POLICY_APPLICABILITY_TARGET_TYPES)[number];

/** Every existing canonical object kind is a structurally legal object target (subject to Authority Policy scope). */
export const L14_POLICY_APPLICABILITY_OBJECT_KINDS = [
  'AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'PROMPT', 'KNOWLEDGE_BASE', 'DATA_ASSET', 'DATA_ELEMENT', 'SKILL',
] as const satisfies readonly CanonicalObjectKind[];

/** Closed stored outcome. UNKNOWN is never stored: it is the read outcome when no current governed fact exists. */
export const L14_POLICY_APPLICABILITY_OUTCOMES = ['APPLIES', 'DOES_NOT_APPLY'] as const;
export type L14PolicyApplicabilityOutcome = (typeof L14_POLICY_APPLICABILITY_OUTCOMES)[number];
/** The read-side answer: a governed outcome, or UNKNOWN when no current valid governed fact exists. */
export type L14PolicyApplicabilityReadOutcome = L14PolicyApplicabilityOutcome | 'UNKNOWN';

/** Closed reason codes: exactly one per governance outcome. No free-text rationale. */
export const L14_POLICY_APPLICABILITY_REASON_CODES = {
  VALIDATE: 'POLICY_APPLICABILITY_VALIDATED',
  REJECT: 'POLICY_APPLICABILITY_REJECTED',
  DEFER: 'POLICY_APPLICABILITY_DEFERRED',
  REVOKE: 'POLICY_APPLICABILITY_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14PolicyApplicabilityReasonCode = (typeof L14_POLICY_APPLICABILITY_REASON_CODES)[L14GovernanceOutcome];

/** One exact canonical object target (the organisation is always the verified principal's). */
export interface L14PolicyApplicabilityObjectTarget {
  readonly targetType: 'CANONICAL_OBJECT';
  readonly targetCanonicalKind: CanonicalObjectKind;
  readonly targetCanonicalObjectId: string;
}

/** One exact relationship state (both ids; never a bare state id; the type is DB-resolved, never supplied). */
export interface L14PolicyApplicabilityRelationshipStateTarget {
  readonly targetType: 'RELATIONSHIP_STATE';
  readonly relationshipId: string;
  readonly relationshipStateId: string;
}

/** The closed discriminated target union. No generic JSON target, no hybrid. */
export type L14PolicyApplicabilityTarget = L14PolicyApplicabilityObjectTarget | L14PolicyApplicabilityRelationshipStateTarget;

/** The exact immutable policy version tuple + the pinned VALIDATED POLICY_VERSION state (dependency lineage only). */
export interface L14PolicyVersionDependency {
  readonly policyId: string;
  readonly versionId: string;
  /** Lowercase hex SHA-256 of the exact admitted content; PostgreSQL resolves it against the admitted tuple. */
  readonly contentHash: string;
  readonly policyVersionValidatedStateId: string;
}

/**
 * Immutable typed proposal content. VALIDATE: no target state; optional immutable explicit end (a VALIDATE on a key whose
 * current state is VALIDATED is a supersession). REVOKE: the exact current VALIDATED state of the same key + the same tuple,
 * dependency and outcome; never an end of its own. Only LOCAL_HUMAN is executable in S1C.3.
 */
export interface L14PolicyApplicabilityProposalContent {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  readonly target: L14PolicyApplicabilityTarget;
  readonly dependency: L14PolicyVersionDependency;
  readonly applicability: L14PolicyApplicabilityOutcome;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  /** null = open-ended; otherwise canonical UTC microseconds strictly after the effective start (VALIDATE only). */
  readonly requestedEffectiveTo: string | null;
  readonly targetStateId: string | null;
}

export type L14PolicyApplicabilityCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable POLICY_APPLICABILITY command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14PolicyApplicabilityCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14PolicyApplicabilityCommandKind;
  readonly subjectKind: typeof L14_POLICY_APPLICABILITY_SUBJECT_KIND;
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly target: L14PolicyApplicabilityTarget | null;
  readonly dependency: L14PolicyVersionDependency | null;
  readonly applicability: L14PolicyApplicabilityOutcome | null;
  readonly factStateId: string | null;
  readonly stateKind: L14RegistryStateKind | null;
  /** The lineage predecessor of the produced fact state (the superseded / revoked state), if any. */
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}

/**
 * One current governed applicability of an exact target, as PostgreSQL's bounded owner-only read primitive
 * (gov_repo.l14_policy_applicabilities_current_v1) returns it at one effective instant + recorded cutoff. At most one row
 * per policy; a policy with no row is UNKNOWN (never DOES_NOT_APPLY, never inherited / rolled up / rolled forward).
 */
export interface L14CurrentPolicyApplicability extends L14PolicyVersionDependency {
  readonly applicability: L14PolicyApplicabilityOutcome;
  readonly factStateId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}
