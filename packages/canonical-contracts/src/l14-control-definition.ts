import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14ProposalIntent, L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1B.6 CONTROL_DEFINITION governed-registry contracts (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1
 * §§4, 6-9, 14, 17-18 + the frozen S1B.6 identity decision). Closed vocabularies only. PostgreSQL is the authority for
 * every content hash, fingerprint, authorization, decision and state.
 *
 * - controlDefinitionId: opaque caller-supplied UUID, tenant scoped, stable across versions; never derived from the
 *   control code, title, description, a CG-AG id or a CanonicalObjectId. CONTROL_DEFINITION is NOT a canonical object kind.
 * - controlDefinitionVersionId: opaque caller-supplied UUID, immutable, belonging to exactly one controlDefinitionId.
 * - Version content is EXACTLY controlCode + title + description; controlCode is a descriptive / external reference,
 *   never identity. No metadata, score, weight, severity, maturity, coverage, waiver, applicability or hierarchy.
 * - ADMITTED is not VALIDATED: a later admitted version never validates itself, never revokes an earlier one and never
 *   becomes an implicit "current governed version".
 * - Legacy CG-AG material (scanner CG_AG_CONTROLS, cg_* flags, CG-AG scores) is proposal input only and is never authority.
 */

export const L14_CONTROL_DEFINITION_SUBJECT_KIND = 'CONTROL_DEFINITION' as const;

/** Closed PostgreSQL bounds of the immutable version content (characters / code points). */
export const L14_CONTROL_DEFINITION_CONTENT_BOUNDS = Object.freeze({
  controlCode: 128,
  title: 512,
  description: 8192,
} as const);

/** The stable tenant-scoped identity (the organisation is always the verified principal's). */
export interface L14ControlDefinitionIdentity {
  readonly controlDefinitionId: string;
}

/** The exact immutable content of one definition version. */
export interface L14ControlDefinitionVersionContent {
  readonly controlCode: string;
  readonly title: string;
  readonly description: string;
}

/** The exact governed validation subject: identity + version + DB-computed content hash. */
export interface L14ControlDefinitionVersionSubject extends L14ControlDefinitionIdentity {
  readonly controlDefinitionVersionId: string;
  /** Lowercase hex SHA-256 computed by PostgreSQL (the TypeScript value is only an assertion). */
  readonly contentHash: string;
}

/** Explicit expected-latest-version semantics of a version ADMIT (never a blind latest overwrite). */
export type L14ControlDefinitionAdmitExpectation =
  | { readonly kind: 'EXPECTED_NONE' }
  | { readonly kind: 'EXPECTED_CURRENT'; readonly latestVersionId: string };

/** Immutable typed proposal content (VALIDATE: no target; REVOKE: exact VALIDATED state of the same tuple). */
export interface L14ControlDefinitionProposalContent extends L14ControlDefinitionVersionSubject {
  readonly intent: L14ProposalIntent;
  /** Must equal the admission source class of the exact version (PostgreSQL verifies it). */
  readonly sourceClass: L14SourceClass;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  readonly targetStateId: string | null;
}

export type L14ControlDefinitionCommandKind = 'ADMIT_CONTROL_DEFINITION_VERSION' | 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable CONTROL_DEFINITION command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14ControlDefinitionCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14ControlDefinitionCommandKind;
  readonly subjectKind: typeof L14_CONTROL_DEFINITION_SUBJECT_KIND;
  readonly outcome: L14CommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  /** ADMIT only: the DB-computed content hash the authorization was evaluated for. */
  readonly attemptedContentHash: string | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedLatestVersionId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  /** The admitted / proposed tuple (null only for a denied ADMIT: nothing was admitted). */
  readonly controlDefinitionId: string | null;
  readonly controlDefinitionVersionId: string | null;
  /** ADMIT only: the admitted version this one succeeds (null = first version). */
  readonly predecessorVersionId: string | null;
  readonly contentHash: string | null;
  readonly registryStateId: string | null;
  readonly stateKind: L14RegistryStateKind | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}

/**
 * The exact dependency a future CONTROL_APPLICABILITY fact pins (ADR §14 / §18.1): never "the latest control version",
 * never a control code or CG-AG match. PostgreSQL resolves it with gov_repo.l14_control_definition_valid_state_v1 at
 * both temporal coordinates.
 */
export interface L14ControlDefinitionValidatedDependency extends L14ControlDefinitionVersionSubject {
  readonly organisationId: string;
  readonly validatedStateId: string;
}
