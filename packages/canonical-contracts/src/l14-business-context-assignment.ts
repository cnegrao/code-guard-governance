import type { CanonicalObjectKind } from './contracts.ts';
import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14GovernanceOutcome, L14ProposalIntent, L14ProposalSubjectKind,
  L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14DomainSubjectKind } from './l14-domain-registry.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1C.2 BUSINESS_CONTEXT_ASSIGNMENT contracts — the second authoritative M16 fact family
 * (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§2-4, 6-10, 12, 17-18). Closed vocabularies only.
 * PostgreSQL is the authority for every fingerprint, authorization, decision, fact state and resolver answer.
 *
 * - Meaning: an exact governed canonical target has ONE governed domain assignment for ONE semantic domain kind at a
 *   business instant ("what business / information domain is this object governed under?"). It is an L14 fact, never a
 *   canonical relationship / object, a label, a free-text category, a scanner classification, an AgentVersion attribute,
 *   an inherited domain or a BusinessTerm assignment.
 * - Target identity: exact organisation + targetKind (AGENT | DATA_ASSET | DATA_ELEMENT) + canonical object id. Never a
 *   name, label, agent_code, source-local name, external id, similarity or scanner output.
 * - Semantic kinds: exactly the EXISTING L6 identity kinds BUSINESS_DOMAIN | INFORMATION_DOMAIN (no parallel namespace).
 * - Domain identity: domainId is the existing L6 BusinessDomainId / InformationDomainId admitted by S1B.5 (never minted,
 *   never derived from a label / description / path / source system / similarity). domainValidatedStateId is dependency
 *   lineage only, never an alternative domain identity.
 * - Logical fact key: organisation + targetKind + targetCanonicalObjectId + semanticKind. The domain id is NOT part of the
 *   key: replacing Domain A by Domain B is a lineage successor of the same key (append-only; the predecessor's closure is
 *   derived from the visible successor, never written onto it).
 * - Absence of a current fact means UNKNOWN / no-current-fact — never a default, parent, inherited or legacy domain
 *   (agents.business_domain, ai_systems.business_domain, scanner classifications are never authority).
 */

export const L14_BUSINESS_CONTEXT_ASSIGNMENT_SUBJECT_KIND = 'BUSINESS_CONTEXT_ASSIGNMENT' as const satisfies L14ProposalSubjectKind;

/** The only canonical kinds a business context may target. */
export const L14_BUSINESS_CONTEXT_TARGET_KINDS = ['AGENT', 'DATA_ASSET', 'DATA_ELEMENT'] as const satisfies readonly CanonicalObjectKind[];
export type L14BusinessContextTargetKind = (typeof L14_BUSINESS_CONTEXT_TARGET_KINDS)[number];

/** Exactly the existing L6 semantic identity kinds (the S1B.5 domain registry subject kinds). */
export const L14_BUSINESS_CONTEXT_SEMANTIC_KINDS = ['BUSINESS_DOMAIN', 'INFORMATION_DOMAIN'] as const satisfies readonly L14DomainSubjectKind[];
export type L14BusinessContextSemanticKind = (typeof L14_BUSINESS_CONTEXT_SEMANTIC_KINDS)[number];

/** The complete closed target x semantic-kind matrix. Every other pairing is prohibited. */
export const L14_BUSINESS_CONTEXT_SEMANTIC_KIND_MATRIX = Object.freeze({
  AGENT: Object.freeze(['BUSINESS_DOMAIN'] as const),
  DATA_ASSET: Object.freeze(['BUSINESS_DOMAIN', 'INFORMATION_DOMAIN'] as const),
  DATA_ELEMENT: Object.freeze(['INFORMATION_DOMAIN'] as const),
}) satisfies Readonly<Record<L14BusinessContextTargetKind, readonly L14BusinessContextSemanticKind[]>>;

/** Closed reason codes: exactly one per governance outcome. No free-text rationale. */
export const L14_BUSINESS_CONTEXT_REASON_CODES = {
  VALIDATE: 'BUSINESS_CONTEXT_ASSIGNMENT_VALIDATED',
  REJECT: 'BUSINESS_CONTEXT_ASSIGNMENT_REJECTED',
  DEFER: 'BUSINESS_CONTEXT_ASSIGNMENT_DEFERRED',
  REVOKE: 'BUSINESS_CONTEXT_ASSIGNMENT_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14BusinessContextReasonCode = (typeof L14_BUSINESS_CONTEXT_REASON_CODES)[L14GovernanceOutcome];

/** One exact governed canonical target (the organisation is always the verified principal's). */
export interface L14BusinessContextTarget {
  readonly targetKind: L14BusinessContextTargetKind;
  readonly targetCanonicalObjectId: string;
}

/** The exact logical fact key (organisation implied by the verified principal). Never includes the domain. */
export interface L14BusinessContextAssignmentKey extends L14BusinessContextTarget {
  readonly semanticKind: L14BusinessContextSemanticKind;
}

/** The exact pinned VALIDATED domain state (dependency lineage only; never a domain identity). */
export interface L14BusinessContextDomainDependency {
  /** The existing L6 / S1B.5 domain id of the key's semantic kind, verbatim. */
  readonly domainId: string;
  readonly domainValidatedStateId: string;
}

/**
 * Immutable typed proposal content. VALIDATE: no target state; optional immutable explicit end (a VALIDATE on a key whose
 * current state is VALIDATED is a supersession). REVOKE: the exact current VALIDATED assignment state of the same key +
 * the same domain + the same pinned dependency; never an end of its own. Only LOCAL_HUMAN is executable in S1C.2.
 */
export interface L14BusinessContextAssignmentProposalContent extends L14BusinessContextAssignmentKey, L14BusinessContextDomainDependency {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  /** null = open-ended; otherwise canonical UTC microseconds strictly after the effective start (VALIDATE only). */
  readonly requestedEffectiveTo: string | null;
  readonly targetStateId: string | null;
}

export type L14BusinessContextAssignmentCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable BUSINESS_CONTEXT_ASSIGNMENT command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14BusinessContextAssignmentCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14BusinessContextAssignmentCommandKind;
  readonly subjectKind: typeof L14_BUSINESS_CONTEXT_ASSIGNMENT_SUBJECT_KIND;
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly targetKind: L14BusinessContextTargetKind | null;
  readonly targetCanonicalObjectId: string | null;
  readonly semanticKind: L14BusinessContextSemanticKind | null;
  readonly domainId: string | null;
  readonly domainValidatedStateId: string | null;
  readonly factStateId: string | null;
  readonly stateKind: L14RegistryStateKind | null;
  /** The lineage predecessor of the produced fact state (the superseded / revoked state), if any. */
  readonly predecessorStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}

/**
 * One current business context of an exact target, as PostgreSQL's bounded owner-only read primitive
 * (gov_repo.l14_business_context_assignments_current_v1) returns it at one effective instant + recorded cutoff. At most one
 * row per semantic kind; a semantic kind with no row is UNKNOWN / no-current-fact (never inherited or defaulted).
 */
export interface L14CurrentBusinessContext {
  readonly semanticKind: L14BusinessContextSemanticKind;
  readonly domainId: string;
  readonly factStateId: string;
  readonly domainValidatedStateId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}
