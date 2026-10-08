import type { BusinessDomainIdentity, InformationDomainIdentity } from './contracts.ts';
import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14ProposalIntent, L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14RegistrySubjectKind } from './l14-registries.ts';

/**
 * M16-S1B.5 BUSINESS_DOMAIN / INFORMATION_DOMAIN governed-registry contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-
 * CONTROL-ENRICHMENT-v1 §§4, 6-7, 10, 17 + the frozen S1B decisions). Closed vocabularies only. PostgreSQL is the
 * authority for every fingerprint, authorization, decision and state.
 *
 * The registry stable identity IS the existing L6 semantic identity (ADR §10): organisation + BusinessDomainId, or
 * organisation + InformationDomainId. No parallel id namespace exists (PostgreSQL mints no domain id), the two kinds
 * are distinct namespaces, and a label / description never defines identity (none is part of any L14 command).
 * Validating a domain never validates a BUSINESS_CONTEXT_ASSIGNMENT that references it.
 */

export const L14_DOMAIN_SUBJECT_KINDS = ['BUSINESS_DOMAIN', 'INFORMATION_DOMAIN'] as const satisfies readonly L14RegistrySubjectKind[];
export type L14DomainSubjectKind = (typeof L14_DOMAIN_SUBJECT_KINDS)[number];

/** Closed PostgreSQL identity bounds for a domain id (the L6 opaque identifier value, verbatim). */
export const L14_DOMAIN_ID_MAX_LENGTH = 500;

/** The exact governed domain (the organisation is always the verified principal's). */
export interface L14DomainSubject {
  readonly subjectKind: L14DomainSubjectKind;
  /** The existing L6 BusinessDomainId / InformationDomainId value, verbatim. */
  readonly domainId: string;
}

/** The L14 registry subject of an existing L6 domain identity: the same id, never a new namespace. */
export function l14DomainSubjectOf(identity: BusinessDomainIdentity | InformationDomainIdentity): L14DomainSubject {
  return identity.semanticIdentityKind === 'BUSINESS_DOMAIN'
    ? Object.freeze({ subjectKind: 'BUSINESS_DOMAIN', domainId: identity.businessDomainId as string })
    : Object.freeze({ subjectKind: 'INFORMATION_DOMAIN', domainId: identity.informationDomainId as string });
}

/** Domain ADMIT admits an identity that must not be admitted yet: the only admissible expectation is EXPECTED_NONE. */
export type L14DomainAdmitExpectation = 'EXPECTED_NONE';

/** Immutable typed domain proposal content (VALIDATE: no target; REVOKE: exact VALIDATED state of the same domain). */
export interface L14DomainProposalContent extends L14DomainSubject {
  readonly intent: L14ProposalIntent;
  /** Must equal the admission source class of the exact domain (PostgreSQL verifies it). */
  readonly sourceClass: L14SourceClass;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  readonly targetStateId: string | null;
}

export type L14DomainCommandKind = 'ADMIT_BUSINESS_DOMAIN' | 'ADMIT_INFORMATION_DOMAIN' | 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable domain command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14DomainCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14DomainCommandKind;
  readonly subjectKind: L14DomainSubjectKind;
  readonly outcome: L14CommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  /** The admitted / proposed L6 domain id (null only for a denied ADMIT: nothing was admitted). */
  readonly domainId: string | null;
  readonly registryStateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}
