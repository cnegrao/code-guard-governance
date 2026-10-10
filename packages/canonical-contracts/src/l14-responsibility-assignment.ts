import type { CanonicalObjectKind } from './contracts.ts';
import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14GovernanceOutcome, L14ProposalIntent, L14ProposalSubjectKind,
  L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1C.1 RESPONSIBILITY_ASSIGNMENT contracts — the first authoritative M16 fact family
 * (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§2-3, 6-11, 17-18). Closed vocabularies only.
 * PostgreSQL is the authority for every fingerprint, authorization, decision, fact state and resolver answer.
 *
 * - Meaning: a VALIDATED GovernanceParty holds ONE closed responsibility role on ONE exact governed canonical target.
 *   It is an L14 fact, never a canonical relationship / object, an AgentVersion attribute, a free-text owner, a
 *   governance-user or directory-profile assignment, or an inferred ownership relation.
 * - Target identity: exact organisation + targetKind (AGENT | DATA_ASSET | DATA_ELEMENT) + canonical object id. Never a
 *   name, label, agent_code, source-local name, external id, similarity or scanner inference. AGENT_VERSION is excluded.
 * - Party identity: governancePartyId ONLY. partyValidatedStateId is dependency lineage, never an alternative identity.
 *   No PII (name, email, phone, profile text, directory id) is ever part of a proposal, decision, fact or result.
 * - Logical fact key: organisation + targetKind + targetCanonicalObjectId + role + governancePartyId. Replacing an owner
 *   with another Party is a DIFFERENT key: the prior assignment must be explicitly revoked / ended first.
 * - Absence of a current fact means UNKNOWN / no-current-fact — never "unowned", "no responsibility required" or a
 *   default owner. Legacy owner fields (owner_user_id, owner_email, ...) are never authority.
 */

export const L14_RESPONSIBILITY_ASSIGNMENT_SUBJECT_KIND = 'RESPONSIBILITY_ASSIGNMENT' as const satisfies L14ProposalSubjectKind;

/**
 * The five M16 fact families share the l14_fact_states envelope; exactly RESPONSIBILITY_ASSIGNMENT (S1C.1),
 * BUSINESS_CONTEXT_ASSIGNMENT (S1C.2), POLICY_APPLICABILITY (S1C.3) and CONTROL_APPLICABILITY (S1C.4) are executable.
 * CONTROL_ASSESSMENT stays unimplemented.
 */
export const L14_EXECUTABLE_FACT_SUBJECT_KINDS = [
  'RESPONSIBILITY_ASSIGNMENT', 'BUSINESS_CONTEXT_ASSIGNMENT', 'POLICY_APPLICABILITY', 'CONTROL_APPLICABILITY',
] as const satisfies readonly L14ProposalSubjectKind[];
export type L14ExecutableFactSubjectKind = (typeof L14_EXECUTABLE_FACT_SUBJECT_KINDS)[number];

/** The closed support-link owner of fact support (never REGISTRY_STATE). */
export const L14_FACT_STATE_SUPPORT_OWNER_KIND = 'FACT_STATE' as const;

/** Closed responsibility role vocabulary. No custom role string, no hierarchy, no inferred role. */
export const L14_RESPONSIBILITY_ROLES = ['BUSINESS_OWNER', 'TECHNICAL_OWNER', 'DATA_OWNER', 'DATA_STEWARD'] as const;
export type L14ResponsibilityRole = (typeof L14_RESPONSIBILITY_ROLES)[number];

/** The only canonical kinds a responsibility may target. */
export const L14_RESPONSIBILITY_TARGET_KINDS = ['AGENT', 'DATA_ASSET', 'DATA_ELEMENT'] as const satisfies readonly CanonicalObjectKind[];
export type L14ResponsibilityTargetKind = (typeof L14_RESPONSIBILITY_TARGET_KINDS)[number];

/** The complete closed target x role matrix (ADR §11). Every other pairing is prohibited. */
export const L14_RESPONSIBILITY_ROLE_MATRIX = Object.freeze({
  AGENT: Object.freeze(['BUSINESS_OWNER', 'TECHNICAL_OWNER'] as const),
  DATA_ASSET: Object.freeze(['DATA_OWNER', 'DATA_STEWARD'] as const),
  DATA_ELEMENT: Object.freeze(['DATA_OWNER', 'DATA_STEWARD'] as const),
}) satisfies Readonly<Record<L14ResponsibilityTargetKind, readonly L14ResponsibilityRole[]>>;

/** At most ONE effective assignment per target + role at any business instant, whatever the Party. */
export const L14_SINGLE_OWNER_RESPONSIBILITY_ROLES = ['BUSINESS_OWNER', 'TECHNICAL_OWNER', 'DATA_OWNER'] as const satisfies readonly L14ResponsibilityRole[];
/** Many Parties may hold it on one target; still one effective assignment per target + role + Party. */
export const L14_MULTI_PARTY_RESPONSIBILITY_ROLES = ['DATA_STEWARD'] as const satisfies readonly L14ResponsibilityRole[];

/** Closed reason codes: exactly one per governance outcome. No free-text rationale. */
export const L14_RESPONSIBILITY_REASON_CODES = {
  VALIDATE: 'RESPONSIBILITY_ASSIGNMENT_VALIDATED',
  REJECT: 'RESPONSIBILITY_ASSIGNMENT_REJECTED',
  DEFER: 'RESPONSIBILITY_ASSIGNMENT_DEFERRED',
  REVOKE: 'RESPONSIBILITY_ASSIGNMENT_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14ResponsibilityReasonCode = (typeof L14_RESPONSIBILITY_REASON_CODES)[L14GovernanceOutcome];

/** One exact governed canonical target (the organisation is always the verified principal's). */
export interface L14ResponsibilityTarget {
  readonly targetKind: L14ResponsibilityTargetKind;
  readonly targetCanonicalObjectId: string;
}

/** The exact logical fact key (organisation implied by the verified principal). */
export interface L14ResponsibilityAssignmentKey extends L14ResponsibilityTarget {
  readonly responsibilityRole: L14ResponsibilityRole;
  readonly governancePartyId: string;
}

/** The exact pinned VALIDATED GovernanceParty state (dependency lineage only; never a Party identity). */
export interface L14ResponsibilityPartyDependency {
  readonly governancePartyId: string;
  readonly partyValidatedStateId: string;
}

/**
 * Immutable typed proposal content. VALIDATE: no target state; optional immutable explicit end. REVOKE: the exact current
 * VALIDATED assignment state of the same key + the same pinned dependency; never an end of its own (its effective_from is
 * the closure instant). Only LOCAL_HUMAN is executable in S1C.1.
 */
export interface L14ResponsibilityAssignmentProposalContent extends L14ResponsibilityAssignmentKey {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  readonly partyValidatedStateId: string;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  /** null = open-ended; otherwise canonical UTC microseconds strictly after the effective start (VALIDATE only). */
  readonly requestedEffectiveTo: string | null;
  readonly targetStateId: string | null;
}

export type L14ResponsibilityAssignmentCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** The identity of one immutable fact state (organisation + fact_state_id + subject kind). */
export interface L14FactStateIdentity {
  readonly organisationId: string;
  readonly factStateId: string;
  readonly subjectKind: L14ExecutableFactSubjectKind;
}

/** Durable RESPONSIBILITY_ASSIGNMENT command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14ResponsibilityAssignmentCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14ResponsibilityAssignmentCommandKind;
  readonly subjectKind: typeof L14_RESPONSIBILITY_ASSIGNMENT_SUBJECT_KIND;
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly targetKind: L14ResponsibilityTargetKind | null;
  readonly targetCanonicalObjectId: string | null;
  readonly responsibilityRole: L14ResponsibilityRole | null;
  readonly governancePartyId: string | null;
  readonly partyValidatedStateId: string | null;
  readonly factStateId: string | null;
  readonly stateKind: L14RegistryStateKind | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}

/**
 * One current legal responsibility of an exact target, as PostgreSQL's bounded owner-only read primitive
 * (gov_repo.l14_responsibility_assignments_current_v1) returns it at one effective instant + recorded cutoff. A role
 * with no row is UNKNOWN / no-current-fact.
 */
export interface L14CurrentResponsibility {
  readonly responsibilityRole: L14ResponsibilityRole;
  readonly governancePartyId: string;
  readonly factStateId: string;
  readonly partyValidatedStateId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}
