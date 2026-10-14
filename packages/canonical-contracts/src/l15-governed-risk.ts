import {
  L15_CLOSURE_REASONS, L15_OBJECT_SUBJECT_KINDS, L15_SUPPORT_ADMISSIBILITY, isLegalL15DomainSubject,
  type L15ClosureReason, type L15ObjectSubjectKind, type L15RiskDomain, type L15SupportCurrency, type L15SupportTargetTag,
} from './l15-risk-intelligence.ts';
import type { GovernedRelationshipType } from './contracts.ts';

/**
 * M17-S3 GOVERNED_RISK contracts (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§6, 8, 9.2, 11-13, 16-19; migration
 * 20261013140000_m17_s3_governed_risk_v1.sql). Types and pure mirrors of the closed DB vocabularies only. A GOVERNED_RISK is
 * an L15 authoritative fact: the organisation-local statement that an exact VALIDATED scenario version applies to an exact
 * subject, established only by an explicit authorized human decision. It is NOT a canonical object, a governed relationship,
 * a score, a hypothesis or a graph projection. PostgreSQL is the arbiter of every shape, fingerprint, authorization,
 * decision, state and resolution; nothing here grants authority.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Exact subject identity (closed union; no inheritance)
// ---------------------------------------------------------------------------------------------------------------------

export const L15_RISK_SUBJECT_TYPES = ['CANONICAL_OBJECT', 'RELATIONSHIP_STATE'] as const;
export type L15RiskSubjectType = (typeof L15_RISK_SUBJECT_TYPES)[number];

/** Object subject: organisation + canonical_object_id + declared canonical kind (one of the eight legal V1 kinds). */
export interface L15GovernedRiskObjectSubject {
  readonly subjectType: 'CANONICAL_OBJECT';
  readonly canonicalKind: L15ObjectSubjectKind;
  readonly canonicalObjectId: string;
}

/**
 * Relationship-state subject: organisation + relationship_id + relationship_state_id (the exact F2 triple; never a bare
 * state id). The relationship type is DB-resolved from exactly one row and never caller-supplied.
 */
export interface L15GovernedRiskRelationshipStateSubject {
  readonly subjectType: 'RELATIONSHIP_STATE';
  readonly relationshipId: string;
  readonly relationshipStateId: string;
}

export type L15GovernedRiskSubject = L15GovernedRiskObjectSubject | L15GovernedRiskRelationshipStateSubject;

/** PostgreSQL length() of a UTF-8 text = its number of code points (never UTF-16 units). */
const chars = (value: string) => [...value].length;

/** Mirror of gov_repo.l15_risk_subject_key_v1 (injective, length-prefixed, branch-tagged). null for an illegal shape. */
export function l15RiskSubjectKey(subject: L15GovernedRiskSubject): string | null {
  if (subject?.subjectType === 'CANONICAL_OBJECT') {
    if (!(L15_OBJECT_SUBJECT_KINDS as readonly string[]).includes(subject.canonicalKind) || !subject.canonicalObjectId) return null;
    return `CANONICAL_OBJECT|${chars(subject.canonicalKind)}:${subject.canonicalKind}|${chars(subject.canonicalObjectId)}:${subject.canonicalObjectId}`;
  }
  if (subject?.subjectType === 'RELATIONSHIP_STATE') {
    if (!subject.relationshipId || !subject.relationshipStateId) return null;
    return `RELATIONSHIP_STATE|${chars(subject.relationshipId)}:${subject.relationshipId}|${chars(subject.relationshipStateId)}:${subject.relationshipStateId}`;
  }
  return null;
}

/** The §8.2 subject token: the object kind, or REL:<DB-resolved relationship type>. */
export function l15RiskSubjectToken(subject: L15GovernedRiskSubject, resolvedRelationshipType?: GovernedRelationshipType): string | null {
  if (subject.subjectType === 'CANONICAL_OBJECT') return subject.canonicalKind;
  return resolvedRelationshipType ? `REL:${resolvedRelationshipType}` : null;
}

/** The closed §8.2 matrix applied to a governed-risk subject (domain DB-derived from the pinned scenario version). */
export function isLegalGovernedRiskSubject(domain: L15RiskDomain, subject: L15GovernedRiskSubject,
  resolvedRelationshipType?: GovernedRelationshipType): boolean {
  return subject.subjectType === 'CANONICAL_OBJECT'
    ? isLegalL15DomainSubject(domain, { tag: 'OBJECT', kind: subject.canonicalKind })
    : resolvedRelationshipType !== undefined
      && isLegalL15DomainSubject(domain, { tag: 'RELATIONSHIP_STATE', relationshipType: resolvedRelationshipType });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenario dependency pin, proposal, closure
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The exact scenario dependency a proposal names (logical key part = scenarioDefinitionId; never the version). The state
 * additionally pins the exact VALIDATED scenario registry state the S2 exact resolver returned at decision time.
 */
export interface L15GovernedRiskScenarioPin {
  readonly scenarioDefinitionId: string;
  readonly scenarioDefinitionVersionId: string;
  /** PostgreSQL content hash of that exact version (lowercase hex SHA-256). */
  readonly scenarioContentHash: string;
}

export interface L15GovernedRiskStateScenarioPin extends L15GovernedRiskScenarioPin {
  readonly scenarioValidatedStateId: string;
}

/** Closed L15 closure field of REVOKE proposals / REVOKED states (the shared reason code stays GOVERNED_RISK_REVOKED). */
export const L15_GOVERNED_RISK_CLOSURE_REASONS = L15_CLOSURE_REASONS;
export type L15GovernedRiskClosureReason = L15ClosureReason;

/** Executable proposal source class in S3. SYSTEM_SEED is never admissible; SOURCE_CONNECTION is dependency-deferred (M19). */
export const L15_GOVERNED_RISK_EXECUTABLE_SOURCE_CLASSES = ['LOCAL_HUMAN'] as const;
export type L15GovernedRiskSourceClass = (typeof L15_GOVERNED_RISK_EXECUTABLE_SOURCE_CLASSES)[number];

/** Admissible support tags of a rank-3 GOVERNED_RISK owner (§9.2): RISK_HYPOTHESIS, RISK_SIGNAL, every rank-0 tag. */
export const L15_GOVERNED_RISK_SUPPORT_TAGS = L15_SUPPORT_ADMISSIBILITY.GOVERNED_RISK;
export const L15_GOVERNED_RISK_SUPPORT_MAX_ENTRIES = 64;
export interface L15GovernedRiskSupportEntry { readonly tag: L15SupportTargetTag; readonly targetId: string }
export type L15GovernedRiskSupport =
  | { readonly status: 'NONE'; readonly entries: readonly [] }
  | { readonly status: 'PRESENT'; readonly entries: readonly L15GovernedRiskSupportEntry[] };

/**
 * Immutable proposal content. There is deliberately NO domain, score, likelihood, impact, rating, lifecycle, owner, title,
 * description or rationale field: the domain is derived by PostgreSQL from the pinned scenario version.
 */
export interface L15GovernedRiskProposalContent extends L15GovernedRiskScenarioPin {
  readonly intent: 'VALIDATE' | 'REVOKE';
  readonly sourceClass: L15GovernedRiskSourceClass;
  readonly subject: L15GovernedRiskSubject;
  /** null = IMMEDIATE (DB transaction instant); else a canonical UTC microsecond instant (BACKDATED / FUTURE_DATED need policy). */
  readonly requestedEffectiveFrom: string | null;
  /** Optional immutable explicit end (VALIDATE only); null = open-ended. Never an automatic expiry. */
  readonly requestedEffectiveTo: string | null;
  /** null = explicit expected-none of the logical key; else the exact current head state. REVOKE: = targetStateId. */
  readonly expectedCurrentStateId: string | null;
  /** REVOKE only: the exact current VALIDATED state of the same logical key. */
  readonly targetStateId: string | null;
  /** REVOKE only: exactly one closure reason. */
  readonly closureReason: L15GovernedRiskClosureReason | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// State, results, resolver, support currency
// ---------------------------------------------------------------------------------------------------------------------

export const L15_GOVERNED_RISK_STATE_KINDS = ['VALIDATED', 'REVOKED'] as const;
export type L15GovernedRiskStateKind = (typeof L15_GOVERNED_RISK_STATE_KINDS)[number];

/** Immutable GOVERNED_RISK state (no score / likelihood / impact / rating / title / description / rationale). */
export interface L15GovernedRiskState {
  readonly stateId: string;
  readonly stateKind: L15GovernedRiskStateKind;
  readonly subject: L15GovernedRiskSubject;
  readonly subjectRelationshipType: GovernedRelationshipType | null;
  readonly scenario: L15GovernedRiskStateScenarioPin;
  /** DB-derived from the pinned scenario version; never caller-supplied. */
  readonly riskDomain: L15RiskDomain;
  readonly predecessorStateId: string | null;
  readonly revokesStateId: string | null;
  readonly closureReason: L15GovernedRiskClosureReason | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
  readonly proposalId: string;
  readonly governanceDecisionId: string;
  readonly authorizationDecisionId: string;
  readonly authorityPolicyId: string;
  readonly authorityPolicyVersionId: string;
  readonly authorityPolicyContentHash: string;
  readonly sourceClass: 'LOCAL_HUMAN' | 'SOURCE_CONNECTION';
  readonly supportStatus: 'NONE' | 'PRESENT';
}

export const L15_GOVERNED_RISK_COMMAND_OUTCOMES = ['SUBMITTED', 'VALIDATED', 'REJECTED', 'DEFERRED', 'REVOKED', 'DENIED'] as const;
export type L15GovernedRiskCommandOutcome = (typeof L15_GOVERNED_RISK_COMMAND_OUTCOMES)[number];

/** Durable command result (exact replay returns the original row with replay = true). */
export interface L15GovernedRiskCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
  readonly subjectKind: 'GOVERNED_RISK';
  readonly outcome: L15GovernedRiskCommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: string | null;
  readonly expectationKind: 'EXPECTED_NONE' | 'EXPECTED_CURRENT' | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly subject: L15GovernedRiskSubject | null;
  readonly subjectRelationshipType: GovernedRelationshipType | null;
  readonly scenario: L15GovernedRiskScenarioPin | null;
  readonly riskDomain: L15RiskDomain | null;
  readonly closureReason: L15GovernedRiskClosureReason | null;
  readonly stateId: string | null;
  readonly stateKind: L15GovernedRiskStateKind | null;
  readonly predecessorStateId: string | null;
  readonly scenarioValidatedStateId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
}

/** Closed resolution of one logical key at (effective_at, recorded_cutoff); read projection only. */
export const L15_GOVERNED_RISK_RESOLUTIONS = [
  'CURRENT', 'NO_STATE', 'REVOKED', 'NOT_YET_EFFECTIVE', 'EXPIRED', 'SUBJECT_UNRESOLVED', 'SCENARIO_DEPENDENCY_INVALID',
] as const;
export type L15GovernedRiskResolution = (typeof L15_GOVERNED_RISK_RESOLUTIONS)[number];

/** Closed per-link support failure reasons of the O44 projection. */
export const L15_SUPPORT_FAILURE_REASONS = [
  'L14_FACT_STATE_NOT_CURRENT', 'FIELD_STATE_SUPERSEDED', 'SIGNAL_SUPPORT_NOT_CURRENT', 'HYPOTHESIS_SUPPORT_NOT_CURRENT',
] as const;
export type L15SupportFailureReason = (typeof L15_SUPPORT_FAILURE_REASONS)[number];

/** Exact resolver request: the exact logical key at both coordinates (never latest-by-scenario). */
export interface L15GovernedRiskResolverRequest {
  readonly subject: L15GovernedRiskSubject;
  readonly scenarioDefinitionId: string;
  /** null = the DB instant. */
  readonly effectiveAt: string | null;
  /** null = the DB instant. */
  readonly recordedCutoff: string | null;
}

/**
 * O44 summary over the EXACT lineage support union of one state: the GOVERNED_RISK links owned by its proposal, its
 * governance decision and the state itself (M17-S3R1). SUPPORT_NONE iff zero lineage links.
 */
export interface L15GovernedRiskSupportCurrencySummary {
  readonly supportCurrency: L15SupportCurrency;
  /** Lineage links across PROPOSAL + DECISION + STATE. */
  readonly supportLinkCount: number;
  readonly degradedLinkCount: number;
  /** The first failing lineage link (PROPOSAL -> DECISION -> STATE, then link_id); SUPPORT_DEGRADED only. */
  readonly failingLinkId: string | null;
  readonly failingReason: L15SupportFailureReason | null;
  /** For a transitive failure (signal / hypothesis support): the exact upstream signal-owned link. */
  readonly failingUpstreamLinkId: string | null;
}

/** Exact resolver / read-projection result. The governed risk itself stays VALIDATED when its support degrades. */
export interface L15GovernedRiskResolverResult {
  readonly resolution: L15GovernedRiskResolution;
  readonly effectiveAt: string;
  readonly recordedCutoff: string;
  readonly stateId: string | null;
  readonly stateKind: L15GovernedRiskStateKind | null;
  readonly riskDomain: L15RiskDomain | null;
  readonly scenarioDefinitionVersionId: string | null;
  readonly scenarioContentHash: string | null;
  readonly scenarioValidatedStateId: string | null;
  readonly predecessorStateId: string | null;
  readonly revokesStateId: string | null;
  readonly closureReason: L15GovernedRiskClosureReason | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly recordedAt: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly authorizationDecisionId: string | null;
  readonly authorityPolicyId: string | null;
  readonly authorityPolicyVersionId: string | null;
  readonly authorityPolicyContentHash: string | null;
  readonly sourceClass: 'LOCAL_HUMAN' | 'SOURCE_CONNECTION' | null;
  readonly support: L15GovernedRiskSupportCurrencySummary | null;
}
