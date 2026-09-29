import type { CanonicalObjectKind, GovernedRelationshipType } from './contracts.ts';

/**
 * M16-S1A L14 Authority Policy contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1
 * §§4-7, 17). Closed vocabularies only; PostgreSQL is the authority for every hash, fingerprint,
 * authorization and state. Nothing here grants authority by itself.
 */

export const L14_PERMISSIONS = [
  'L14_AUTHORITY_POLICY_ADMIT', 'L14_PARTY_ADMIT', 'L14_DOMAIN_ADMIT', 'L14_CONTROL_DEFINITION_ADMIT',
  'L14_POLICY_CONTENT_ADMIT', 'L14_AUTHORITY_POLICY_ADMIN', 'L14_PARTY_VALIDATE', 'L14_DOMAIN_VALIDATE',
  'L14_CONTROL_DEFINITION_VALIDATE', 'L14_POLICY_VERSION_VALIDATE', 'L14_RESPONSIBILITY_VALIDATE',
  'L14_BUSINESS_CONTEXT_VALIDATE', 'L14_POLICY_APPLICABILITY_VALIDATE', 'L14_CONTROL_APPLICABILITY_VALIDATE',
  'L14_CONTROL_ASSESSMENT_VALIDATE',
] as const;
export type L14Permission = (typeof L14_PERMISSIONS)[number];

export const L14_REQUESTED_ACTIONS = ['ADMIT', 'VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
export type L14RequestedAction = (typeof L14_REQUESTED_ACTIONS)[number];

export const L14_SCOPE_TAGS = [
  'ALL_ALLOWED_TARGETS', 'CANONICAL_KIND', 'CANONICAL_OBJECT', 'RELATIONSHIP_TYPE', 'RELATIONSHIP_STATE',
] as const;
export type L14ScopeTag = (typeof L14_SCOPE_TAGS)[number];

export const L14_SOURCE_CLASSES = ['SYSTEM_SEED', 'LOCAL_HUMAN', 'SOURCE_CONNECTION'] as const;
export type L14SourceClass = (typeof L14_SOURCE_CLASSES)[number];

export const L14_SOURCE_DISPOSITIONS = ['AUTHORITATIVE', 'CONTRIBUTING', 'NON_AUTHORITATIVE'] as const;
export type L14SourceDisposition = (typeof L14_SOURCE_DISPOSITIONS)[number];

export const L14_SUPPORT_STATUSES = ['NONE', 'PRESENT'] as const;
export type L14SupportStatus = (typeof L14_SUPPORT_STATUSES)[number];

export const L14_PROPOSAL_SUBJECT_KINDS = [
  'AUTHORITY_POLICY_VERSION', 'GOVERNANCE_PARTY', 'BUSINESS_DOMAIN', 'INFORMATION_DOMAIN', 'CONTROL_DEFINITION',
  'POLICY_VERSION', 'RESPONSIBILITY_ASSIGNMENT', 'BUSINESS_CONTEXT_ASSIGNMENT', 'POLICY_APPLICABILITY',
  'CONTROL_APPLICABILITY', 'CONTROL_ASSESSMENT',
] as const;
export type L14ProposalSubjectKind = (typeof L14_PROPOSAL_SUBJECT_KINDS)[number];

export const L14_PROPOSAL_INTENTS = ['VALIDATE', 'REVOKE'] as const;
export type L14ProposalIntent = (typeof L14_PROPOSAL_INTENTS)[number];

export const L14_GOVERNANCE_OUTCOMES = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
export type L14GovernanceOutcome = (typeof L14_GOVERNANCE_OUTCOMES)[number];

/** Closed AUTHORITY_POLICY_VERSION reason codes, one per governance outcome. No free text. */
export const L14_AUTHORITY_POLICY_REASON_CODES = {
  VALIDATE: 'AUTHORITY_POLICY_VALIDATED',
  REJECT: 'AUTHORITY_POLICY_REJECTED',
  DEFER: 'AUTHORITY_POLICY_DEFERRED',
  REVOKE: 'AUTHORITY_POLICY_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14AuthorityPolicyReasonCode =
  (typeof L14_AUTHORITY_POLICY_REASON_CODES)[keyof typeof L14_AUTHORITY_POLICY_REASON_CODES];

export const L14_AUTHORIZATION_DENY_REASONS = [
  'BOOTSTRAP_ROLE_REQUIRED', 'BOOTSTRAP_ACTION_NOT_PERMITTED', 'NO_EFFECTIVE_AUTHORITY', 'NO_MATCHING_AUTHORITY_RULE',
  'SELF_VALIDATION_NOT_PERMITTED', 'SOURCE_NOT_AUTHORIZED', 'SCOPE_NOT_AUTHORIZED', 'TEMPORAL_ACTION_NOT_AUTHORIZED',
  'SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN',
] as const;
export type L14AuthorizationDenyReason = (typeof L14_AUTHORIZATION_DENY_REASONS)[number];

export const L14_BOOTSTRAP_AUTHORITY = 'SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1' as const;
export type L14AuthorityBasis = typeof L14_BOOTSTRAP_AUTHORITY | 'AUTHORITY_POLICY_VERSION';

/** Reserved typed SQLSTATEs. A DENY is a durable result, never one of these errors. */
export const L14_SQLSTATES = {
  REPLAY_CONFLICT: 'GV007',
  FINGERPRINT_MISMATCH: 'GV008',
  STALE_EXPECTATION: 'GV009',
  INVALID_COMMAND: 'GV010',
  CONTINUITY_VIOLATION: 'GV011',
} as const;

export type L14CommandKind = 'ADMIT_AUTHORITY_POLICY_VERSION' | 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
export type L14CommandOutcome = 'ADMITTED' | 'SUBMITTED' | 'VALIDATED' | 'REJECTED' | 'DEFERRED' | 'REVOKED' | 'DENIED';

/**
 * One typed Authority Policy rule. Every operand is present; absence is an explicit null.
 * roleId is a persisted governance_roles.role_id (lower-case canonical UUID).
 */
export interface L14AuthorityPolicyRule {
  readonly roleId: string;
  readonly permission: L14Permission;
  readonly requestedAction: L14RequestedAction;
  readonly sourceClass: L14SourceClass;
  readonly sourceDisposition: L14SourceDisposition;
  readonly scopeTag: L14ScopeTag;
  readonly scopeCanonicalKind: CanonicalObjectKind | null;
  readonly scopeCanonicalObjectId: string | null;
  readonly scopeRelationshipType: GovernedRelationshipType | null;
  readonly scopeRelationshipId: string | null;
  readonly scopeRelationshipStateId: string | null;
  readonly allowSelfValidation: boolean;
  readonly allowFutureDating: boolean;
  readonly allowBackdating: boolean;
}

export interface L14Support {
  readonly status: L14SupportStatus;
  /** Exact gov_repo.discovery_evidence ids of the same organisation; empty iff NONE. */
  readonly evidenceIds: readonly string[];
}

/** Durable command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14CommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14CommandKind;
  readonly outcome: L14CommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly authorityPolicyId: string | null;
  readonly versionId: string | null;
  readonly contentHash: string | null;
  readonly stateId: string | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}
