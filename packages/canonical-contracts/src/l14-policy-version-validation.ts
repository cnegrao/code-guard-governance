import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14ProposalIntent, L14SourceClass,
} from './l14-authority-policy.ts';

/**
 * M16-S1B.4 POLICY_VERSION governance validation contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-
 * ENRICHMENT-v1 §§4, 6-7, 9, 13, 16-18, 20-21 + the frozen S1B decisions). Closed vocabularies only. PostgreSQL is
 * the authority for every fingerprint, authorization, decision and state.
 *
 * The governed subject is the exact S1B.3-admitted tuple organisation + policy id + version id + content hash. A
 * version id alone, a policy id alone, a version number / label, a legacy version pointer or legacy status /
 * approval / QES is never the subject. Admission is not validation: only this lifecycle produces a governed
 * VALIDATED dependency, and it never edits policy content, legacy fields or admission lineage.
 */

/** The exact governed POLICY_VERSION tuple (the organisation is always the verified principal's). */
export interface L14PolicyVersionSubject {
  readonly policyId: string;
  readonly versionId: string;
  /** Lowercase hex SHA-256 of the exact admitted UTF-8 content (the S1B.3 DB-computed hash). */
  readonly contentHash: string;
}

/** Immutable typed POLICY_VERSION proposal content (VALIDATE: no target; REVOKE: exact VALIDATED state). */
export interface L14PolicyVersionProposalContent extends L14PolicyVersionSubject {
  readonly intent: L14ProposalIntent;
  /** Must equal the S1B.3 admission lineage source class of the exact tuple (PostgreSQL verifies it). */
  readonly sourceClass: L14SourceClass;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  readonly targetStateId: string | null;
}

export type L14PolicyVersionValidationCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable POLICY_VERSION governance result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14PolicyVersionValidationCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14PolicyVersionValidationCommandKind;
  readonly subjectKind: 'POLICY_VERSION';
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly proposalId: string;
  readonly governanceDecisionId: string | null;
  readonly policyId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly registryStateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}
