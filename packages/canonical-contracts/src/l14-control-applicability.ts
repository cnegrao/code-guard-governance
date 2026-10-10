import type { CanonicalObjectKind } from './contracts.ts';
import type {
  L14AuthorizationDenyReason, L14CommandOutcome, L14GovernanceOutcome, L14ProposalIntent, L14ProposalSubjectKind,
  L14SourceClass,
} from './l14-authority-policy.ts';
import type { L14ControlDefinitionVersionSubject } from './l14-control-definition.ts';
import type { L14ExpectationKind, L14RegistryStateKind } from './l14-registries.ts';

/**
 * M16-S1C.4 CONTROL_APPLICABILITY contracts — the fourth authoritative M16 fact family
 * (ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1 §§2-4, 6-9, 14, 16-18; O30, O49). Closed vocabularies only.
 * PostgreSQL is the authority for every fingerprint, hash resolution, authorization, decision, fact state and resolver answer.
 *
 * - Meaning: an exact VALIDATED ControlDefinition version either APPLIES or DOES_NOT_APPLY to one exact governed target.
 *   Absence of a current governed fact is UNKNOWN — never DOES_NOT_APPLY. A validated DOES_NOT_APPLY is a positive governed
 *   assertion. Applicability never implies assessment, satisfaction or coverage (CONTROL_ASSESSMENT stays unimplemented).
 * - Target identity: the SAME closed discriminated union as POLICY_APPLICABILITY. CANONICAL_OBJECT = organisation +
 *   canonical kind (any of the 11) + canonical object id. RELATIONSHIP_STATE = organisation + relationship id +
 *   relationship state id, resolved exactly (never a bare state id, a relationship id alone, the latest / current state, a
 *   successor, an endpoint or a type). The relationship type is DB-resolved for Authority Policy scope only.
 * - Control identity: the S1B.6 stable controlDefinitionId. Exact version identity: controlDefinitionId +
 *   controlDefinitionVersionId + contentHash (computed by PostgreSQL; knowing a valid-looking SHA-256 grants nothing).
 *   controlDefinitionValidatedStateId is the pinned S1B.6 VALIDATED state: dependency lineage only, never an identity.
 *   Never the control code / title / description, a CG-AG id, a cg_* flag, the latest admitted / validated version or a
 *   same-code control (O30).
 * - Logical fact key: organisation + exact target + controlDefinitionId. The version id, content hash, pinned state and
 *   outcome are NOT part of the key: a version or outcome change is a governed lineage successor of the same key.
 * - O49: once the pinned VALIDATED state is revoked, the current answer is UNKNOWN; a re-validated or newer version is
 *   never auto-repinned (a new governed successor is required).
 */

export const L14_CONTROL_APPLICABILITY_SUBJECT_KIND = 'CONTROL_APPLICABILITY' as const satisfies L14ProposalSubjectKind;

/** Closed target union discriminants. */
export const L14_CONTROL_APPLICABILITY_TARGET_TYPES = ['CANONICAL_OBJECT', 'RELATIONSHIP_STATE'] as const;
export type L14ControlApplicabilityTargetType = (typeof L14_CONTROL_APPLICABILITY_TARGET_TYPES)[number];

/** Every existing canonical object kind is a structurally legal object target (subject to Authority Policy scope). */
export const L14_CONTROL_APPLICABILITY_OBJECT_KINDS = [
  'AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'PROMPT', 'KNOWLEDGE_BASE', 'DATA_ASSET', 'DATA_ELEMENT', 'SKILL',
] as const satisfies readonly CanonicalObjectKind[];

/** Closed stored outcome. UNKNOWN is never stored: it is the read outcome when no current governed fact exists. */
export const L14_CONTROL_APPLICABILITY_OUTCOMES = ['APPLIES', 'DOES_NOT_APPLY'] as const;
export type L14ControlApplicabilityOutcome = (typeof L14_CONTROL_APPLICABILITY_OUTCOMES)[number];
/** The read-side answer: a governed outcome, or UNKNOWN when no current valid governed fact exists. */
export type L14ControlApplicabilityReadOutcome = L14ControlApplicabilityOutcome | 'UNKNOWN';

/** Closed reason codes: exactly one per governance outcome. No free-text rationale. */
export const L14_CONTROL_APPLICABILITY_REASON_CODES = {
  VALIDATE: 'CONTROL_APPLICABILITY_VALIDATED',
  REJECT: 'CONTROL_APPLICABILITY_REJECTED',
  DEFER: 'CONTROL_APPLICABILITY_DEFERRED',
  REVOKE: 'CONTROL_APPLICABILITY_REVOKED',
} as const satisfies Record<L14GovernanceOutcome, string>;
export type L14ControlApplicabilityReasonCode = (typeof L14_CONTROL_APPLICABILITY_REASON_CODES)[L14GovernanceOutcome];

/** One exact canonical object target (the organisation is always the verified principal's). */
export interface L14ControlApplicabilityObjectTarget {
  readonly targetType: 'CANONICAL_OBJECT';
  readonly targetCanonicalKind: CanonicalObjectKind;
  readonly targetCanonicalObjectId: string;
}

/** One exact relationship state (both ids; never a bare state id; the type is DB-resolved, never supplied). */
export interface L14ControlApplicabilityRelationshipStateTarget {
  readonly targetType: 'RELATIONSHIP_STATE';
  readonly relationshipId: string;
  readonly relationshipStateId: string;
}

/** The closed discriminated target union. No generic JSON target, no hybrid. */
export type L14ControlApplicabilityTarget = L14ControlApplicabilityObjectTarget | L14ControlApplicabilityRelationshipStateTarget;

/**
 * The exact immutable control definition version tuple (S1B.6 identity + version + DB-computed content hash) + the pinned
 * VALIDATED CONTROL_DEFINITION state (dependency lineage only). This is the S1B.6 published dependency key
 * (organisation, state_id, control_definition_id, control_definition_version_id, content_hash, VALIDATED).
 */
export interface L14ControlDefinitionDependency extends L14ControlDefinitionVersionSubject {
  readonly controlDefinitionValidatedStateId: string;
}

/**
 * Immutable typed proposal content. VALIDATE: no target state; optional immutable explicit end (a VALIDATE on a key whose
 * current state is VALIDATED is a supersession). REVOKE: the exact current VALIDATED state of the same key + the same tuple,
 * dependency and outcome; never an end of its own. Only LOCAL_HUMAN is executable in S1C.4.
 */
export interface L14ControlApplicabilityProposalContent {
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  readonly target: L14ControlApplicabilityTarget;
  readonly dependency: L14ControlDefinitionDependency;
  readonly applicability: L14ControlApplicabilityOutcome;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  /** null = open-ended; otherwise canonical UTC microseconds strictly after the effective start (VALIDATE only). */
  readonly requestedEffectiveTo: string | null;
  readonly targetStateId: string | null;
}

export type L14ControlApplicabilityCommandKind = 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';

/** Durable CONTROL_APPLICABILITY command result exactly as PostgreSQL stored it (replay returns the original). */
export interface L14ControlApplicabilityCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: L14ControlApplicabilityCommandKind;
  readonly subjectKind: typeof L14_CONTROL_APPLICABILITY_SUBJECT_KIND;
  readonly outcome: Exclude<L14CommandOutcome, 'ADMITTED'>;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: L14AuthorizationDenyReason | null;
  readonly expectationKind: L14ExpectationKind | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly target: L14ControlApplicabilityTarget | null;
  readonly dependency: L14ControlDefinitionDependency | null;
  readonly applicability: L14ControlApplicabilityOutcome | null;
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
 * (gov_repo.l14_control_applicabilities_current_v1) returns it at one effective instant + recorded cutoff. At most one row
 * per control definition; a control definition with no row is UNKNOWN (never DOES_NOT_APPLY, never inherited / rolled up / rolled forward).
 */
export interface L14CurrentControlApplicability extends L14ControlDefinitionDependency {
  readonly applicability: L14ControlApplicabilityOutcome;
  readonly factStateId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}
