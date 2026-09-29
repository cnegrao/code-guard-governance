import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14ProposalIntent, L14SourceClass,
} from './l14-authority-policy.ts';

/**
 * M16-S1B.1 GovernanceParty registry contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-
 * ENRICHMENT-v1 §§4, 6-7, 10, 13-14, 17 + the S1B decisions). Closed vocabularies only.
 * PostgreSQL mints every governance_party_id and is the authority for every fingerprint,
 * authorization and state. A GovernanceParty is never an authorization basis.
 */

export const L14_GOVERNANCE_PARTY_KINDS = ['PERSON', 'GROUP', 'ORGANISATIONAL_UNIT'] as const;
export type L14GovernancePartyKind = (typeof L14_GOVERNANCE_PARTY_KINDS)[number];

/** Erasure lifecycle of the NON-AUTHORITATIVE directory profile (never of the immutable Party). */
export const L14_PARTY_PROFILE_ERASURE_STATES = ['ACTIVE', 'PSEUDONYMISED', 'ERASED'] as const;
export type L14PartyProfileErasureState = (typeof L14_PARTY_PROFILE_ERASURE_STATES)[number];

/**
 * Profile fields that may exist ONLY in gov_repo.governance_party_directory_profiles. None of them
 * is ever part of an L14 command, fingerprint, authorization, decision, state or result.
 */
export const L14_PARTY_PROFILE_PII_FIELDS = [
  'display_name', 'email', 'phone', 'profile_text', 'governance_user_id', 'external_identity_ref',
] as const;
export type L14PartyProfilePiiField = (typeof L14_PARTY_PROFILE_PII_FIELDS)[number];

/** Party ADMIT always mints a new identity: the only admissible expectation is EXPECTED_NONE. */
export type L14GovernancePartyAdmitExpectation = 'EXPECTED_NONE';

/** Immutable typed Party proposal content (VALIDATE: no target; REVOKE: exact VALIDATED state). */
export interface L14GovernancePartyProposalContent {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  readonly governancePartyId: string;
  readonly partyKind: L14GovernancePartyKind;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  readonly targetStateId: string | null;
}

export type L14GovernancePartyCommandKind = 'ADMIT_GOVERNANCE_PARTY' | 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable Party command result exactly as PostgreSQL stored it (replay returns the original). No PII. */
export interface L14GovernancePartyCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14GovernancePartyCommandKind;
  readonly subjectKind: 'GOVERNANCE_PARTY';
  readonly outcome: L14CommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  /** PostgreSQL-minted opaque identity (null only for a denied ADMIT: nothing was minted). */
  readonly governancePartyId: string | null;
  readonly partyKind: L14GovernancePartyKind | null;
  readonly registryStateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}
