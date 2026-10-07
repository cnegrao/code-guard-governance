import type { CanonicalObjectKind, GovernedRelationshipType } from './contracts.ts';
import type { L14GovernanceOutcome, L14Permission, L14ProposalSubjectKind, L14ScopeTag } from './l14-authority-policy.ts';

/**
 * M16-S1B.0 governed-registry framework contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-
 * ENRICHMENT-v1 §§4, 6-7, 10, 13-14, 17 + S1B decisions D-1..D-14). Closed vocabularies only; no
 * registry subject is executable yet and PostgreSQL remains the authority for every decision.
 */

/** The five registry subjects sharing the l14_registry_states envelope (AUTHORITY_POLICY_VERSION keeps its S1A path). */
export const L14_REGISTRY_SUBJECT_KINDS = [
  'GOVERNANCE_PARTY', 'BUSINESS_DOMAIN', 'INFORMATION_DOMAIN', 'CONTROL_DEFINITION', 'POLICY_VERSION',
] as const satisfies readonly L14ProposalSubjectKind[];
export type L14RegistrySubjectKind = (typeof L14_REGISTRY_SUBJECT_KINDS)[number];

/** Registry-administration permissions: organisation-local (ALL_ALLOWED_TARGETS) only for new rules (D-14). */
export const L14_REGISTRY_PERMISSIONS = [
  'L14_PARTY_ADMIT', 'L14_DOMAIN_ADMIT', 'L14_CONTROL_DEFINITION_ADMIT', 'L14_POLICY_CONTENT_ADMIT',
  'L14_PARTY_VALIDATE', 'L14_DOMAIN_VALIDATE', 'L14_CONTROL_DEFINITION_VALIDATE', 'L14_POLICY_VERSION_VALIDATE',
] as const satisfies readonly L14Permission[];
export type L14RegistryPermission = (typeof L14_REGISTRY_PERMISSIONS)[number];

/** Request-target shapes (D-7). CANONICAL_KIND and RELATIONSHIP_TYPE are rule selectors only. */
export const L14_REQUEST_TARGET_TAGS = [
  'ALL_ALLOWED_TARGETS', 'CANONICAL_OBJECT', 'RELATIONSHIP_STATE',
] as const satisfies readonly L14ScopeTag[];
export type L14RequestTargetTag = (typeof L14_REQUEST_TARGET_TAGS)[number];

export type L14RequestTarget =
  | { readonly tag: 'ALL_ALLOWED_TARGETS' }
  | { readonly tag: 'CANONICAL_OBJECT'; readonly canonicalKind: CanonicalObjectKind; readonly canonicalObjectId: string }
  | {
    readonly tag: 'RELATIONSHIP_STATE'; readonly relationshipType: GovernedRelationshipType;
    readonly relationshipId: string; readonly relationshipStateId: string;
  };

/** F-4 audit evidence recorded on every non-legacy authorization decision. */
export const L14_EXPECTATION_KINDS = ['EXPECTED_NONE', 'EXPECTED_CURRENT', 'NOT_APPLICABLE'] as const;
export type L14ExpectationKind = (typeof L14_EXPECTATION_KINDS)[number];

export const L14_REGISTRY_STATE_KINDS = ['VALIDATED', 'REVOKED'] as const;
export type L14RegistryStateKind = (typeof L14_REGISTRY_STATE_KINDS)[number];

/** Admission command kinds reserved for the registry subjects (each belongs to exactly one subject). */
export const L14_REGISTRY_ADMIT_COMMAND_SUBJECTS = {
  ADMIT_GOVERNANCE_PARTY: 'GOVERNANCE_PARTY',
  ADMIT_BUSINESS_DOMAIN: 'BUSINESS_DOMAIN',
  ADMIT_INFORMATION_DOMAIN: 'INFORMATION_DOMAIN',
  ADMIT_CONTROL_DEFINITION_VERSION: 'CONTROL_DEFINITION',
  ADMIT_GOVERNANCE_POLICY: 'POLICY_VERSION',
  ADMIT_POLICY_VERSION: 'POLICY_VERSION',
} as const satisfies Record<string, L14RegistrySubjectKind>;
export type L14RegistryAdmitCommandKind = keyof typeof L14_REGISTRY_ADMIT_COMMAND_SUBJECTS;

/** Closed registry reason codes: exactly one per subject x governance outcome. No free text. */
export const L14_REGISTRY_REASON_CODES = {
  GOVERNANCE_PARTY: { VALIDATE: 'GOVERNANCE_PARTY_VALIDATED', REJECT: 'GOVERNANCE_PARTY_REJECTED', DEFER: 'GOVERNANCE_PARTY_DEFERRED', REVOKE: 'GOVERNANCE_PARTY_REVOKED' },
  BUSINESS_DOMAIN: { VALIDATE: 'BUSINESS_DOMAIN_VALIDATED', REJECT: 'BUSINESS_DOMAIN_REJECTED', DEFER: 'BUSINESS_DOMAIN_DEFERRED', REVOKE: 'BUSINESS_DOMAIN_REVOKED' },
  INFORMATION_DOMAIN: { VALIDATE: 'INFORMATION_DOMAIN_VALIDATED', REJECT: 'INFORMATION_DOMAIN_REJECTED', DEFER: 'INFORMATION_DOMAIN_DEFERRED', REVOKE: 'INFORMATION_DOMAIN_REVOKED' },
  CONTROL_DEFINITION: { VALIDATE: 'CONTROL_DEFINITION_VALIDATED', REJECT: 'CONTROL_DEFINITION_REJECTED', DEFER: 'CONTROL_DEFINITION_DEFERRED', REVOKE: 'CONTROL_DEFINITION_REVOKED' },
  POLICY_VERSION: { VALIDATE: 'POLICY_VERSION_VALIDATED', REJECT: 'POLICY_VERSION_REJECTED', DEFER: 'POLICY_VERSION_DEFERRED', REVOKE: 'POLICY_VERSION_REVOKED' },
} as const satisfies Record<L14RegistrySubjectKind, Record<L14GovernanceOutcome, string>>;
export type L14RegistryReasonCode =
  (typeof L14_REGISTRY_REASON_CODES)[L14RegistrySubjectKind][L14GovernanceOutcome];

/** Normalized support-link owners after S1B.0 (the evidence target stays gov_repo.discovery_evidence). */
export const L14_SUPPORT_LINK_OWNER_KINDS = [
  'AUTHORITY_POLICY_VERSION_ADMISSION', 'PROPOSAL', 'GOVERNANCE_DECISION', 'AUTHORITY_POLICY_STATE', 'ADMISSION', 'REGISTRY_STATE',
] as const;
export type L14SupportLinkOwnerKind = (typeof L14_SUPPORT_LINK_OWNER_KINDS)[number];
