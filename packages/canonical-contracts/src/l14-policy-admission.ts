import type { L14AuthorizationDenyReason, L14SourceClass } from './l14-authority-policy.ts';
import type { L14ExpectationKind } from './l14-registries.ts';

/**
 * M16-S1B.3 POLICY CONTENT ADMISSION contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1
 * §§4, 6-7, 13, 17 + the S1B.3 ACP rulings). Closed vocabularies only. PostgreSQL mints every policy_id,
 * version_id, version_number and version_label, computes every content hash and fingerprint, and is the sole
 * authority for every authorization. Admission is never validation: until S1B.4 every admitted version is
 * NOT_VALIDATED. The legacy owner, status, approval, QES and version-pointer fields are never M16 authority.
 */

/** The legacy gov_repo.policy_type enum, closed. */
export const L14_POLICY_TYPES = ['operational', 'risk', 'security', 'data', 'ethics', 'compliance'] as const;
export type L14PolicyType = (typeof L14_POLICY_TYPES)[number];

/** Legacy compatibility filler PostgreSQL writes into change_summary for every admitted version (never caller input). */
export const L14_POLICY_VERSION_CHANGE_SUMMARY = 'M16_POLICY_VERSION_ADMISSION' as const;

/** Validation marker of the controlled descriptor read. S1B.3 can only ever report NOT_VALIDATED. */
export const L14_POLICY_VALIDATION_STATES = ['NOT_VALIDATED'] as const;
export type L14PolicyValidationState = (typeof L14_POLICY_VALIDATION_STATES)[number];

export type L14PolicyAdmissionCommandKind = 'ADMIT_GOVERNANCE_POLICY' | 'ADMIT_POLICY_VERSION';

/** The admitted policy descriptor (the whole attempted content of a policy identity ADMIT). No owner, no hierarchy. */
export interface L14GovernancePolicyDescriptor {
  /** 1..20 chars: ^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$, unique per organisation. */
  readonly policyCode: string;
  /** 1..255 characters, no leading/trailing spaces, no control characters. */
  readonly title: string;
  readonly policyType: L14PolicyType;
}

/** Durable policy admission result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14PolicyAdmissionCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14PolicyAdmissionCommandKind;
  readonly subjectKind: 'POLICY_VERSION';
  readonly outcome: 'ADMITTED' | 'DENIED';
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string;
  readonly authorizationResult: 'ALLOW' | 'DENY';
  readonly denyReason: L14AuthorizationDenyReason | null;
  /** F-4 evidence: the DB-computed descriptor hash (identity) or exact UTF-8 content hash (version). */
  readonly attemptedContentHash: string;
  readonly expectationKind: Extract<L14ExpectationKind, 'EXPECTED_NONE' | 'EXPECTED_CURRENT'>;
  readonly expectedLatestVersionId: string | null;
  /** PostgreSQL-minted policy id (null only when nothing was admitted). */
  readonly policyId: string | null;
  readonly versionId: string | null;
  readonly versionNumber: number | null;
  readonly versionLabel: string | null;
  readonly contentHash: string | null;
  readonly recordedAt: string;
}

/** One row of the S1B2-I1 controlled descriptor read. Never content bodies or legacy authority fields. */
export interface L14PolicyDescriptor {
  readonly policyId: string;
  readonly policyCode: string;
  readonly title: string;
  readonly policyType: L14PolicyType;
  readonly policyAdmissionAuthorizationDecisionId: string;
  readonly policyRecordedAt: string;
  /** null when the admitted policy has no admitted version yet. */
  readonly versionId: string | null;
  readonly versionNumber: number | null;
  readonly versionLabel: string | null;
  readonly contentHash: string | null;
  readonly versionAdmissionAuthorizationDecisionId: string | null;
  readonly versionRecordedAt: string | null;
  readonly validationState: L14PolicyValidationState;
}

/** Shape bounds shared by the PostgreSQL RPCs and the TypeScript mirror. */
export const L14_POLICY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$/;
export const L14_POLICY_TITLE_MAX_CHARACTERS = 255;
export const L14_POLICY_CONTENT_MAX_BYTES = 1_048_576;
