import {
  L15_DOMAIN_SUBJECT_MATRIX, L15_METHODOLOGY_SCALE_LEVELS, L15_RATING_BANDS, L15_RISK_DOMAINS,
  type L15DomainSubjects, type L15RatingBand, type L15RegistrySubjectKind, type L15RiskDomain,
} from './l15-risk-intelligence.ts';

/**
 * M17-S2 RISK_SCENARIO_DEFINITION + RISK_METHODOLOGY governed L15 registry contracts (ADR-GOVIA-RISK-INTELLIGENCE-v1 §§7, 8.2,
 * 9.2, 11, 12, 17; migration 20261013120000_m17_s2_scenario_methodology_registries_v1.sql). Types and pure mirrors of the
 * closed DB vocabularies only. PostgreSQL is the arbiter of every shape, content hash, fingerprint, authorization, decision
 * and state; nothing here grants authority. Identities are opaque, caller-supplied, tenant-scoped UUIDs that are never derived
 * from a code, domain, scanner rule, CG-AG id, title, hash or label.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Shared registry envelope pieces
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Executable registry source classes. SYSTEM_SEED is provenance only (human-mediated, no authority, never self-validating);
 * SOURCE_CONNECTION has no trusted intake primitive and is rejected (SOURCE_CLASS_NOT_EXECUTABLE).
 */
export const L15_REGISTRY_SOURCE_CLASSES = ['LOCAL_HUMAN', 'SYSTEM_SEED'] as const;
export type L15RegistrySourceClass = (typeof L15_REGISTRY_SOURCE_CLASSES)[number];

/** Explicit admission concurrency: EXPECTED_NONE creates the identity; EXPECTED_CURRENT pins the exact latest admitted version. */
export type L15RegistryAdmitExpectation =
  | { readonly kind: 'EXPECTED_NONE' }
  | { readonly kind: 'EXPECTED_CURRENT'; readonly latestVersionId: string };

/** Rank-3 registry support targets (§9.2): DISCOVERY_EVIDENCE / SOURCE_ASSERTION only. */
export const L15_REGISTRY_SUPPORT_TAGS = ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION'] as const;
export type L15RegistrySupportTag = (typeof L15_REGISTRY_SUPPORT_TAGS)[number];
export const L15_REGISTRY_SUPPORT_MAX_ENTRIES = 64;

export interface L15RegistrySupportEntry { readonly tag: L15RegistrySupportTag; readonly targetId: string }
/** NONE = zero entries; PRESENT = 1..64 distinct entries. A SYSTEM_SEED proposal requires PRESENT. */
export type L15RegistrySupport =
  | { readonly status: 'NONE'; readonly entries: readonly [] }
  | { readonly status: 'PRESENT'; readonly entries: readonly L15RegistrySupportEntry[] };

/** Rank-3 owner artifacts of l15_support_links for the two registries. */
export const L15_REGISTRY_SUPPORT_OWNER_ARTIFACTS = ['PROPOSAL', 'DECISION', 'STATE'] as const;
export type L15RegistrySupportOwnerArtifact = (typeof L15_REGISTRY_SUPPORT_OWNER_ARTIFACTS)[number];

export const L15_REGISTRY_PROPOSAL_INTENTS = ['VALIDATE', 'REVOKE'] as const;
export type L15RegistryProposalIntent = (typeof L15_REGISTRY_PROPOSAL_INTENTS)[number];

/** The exact admitted version tuple a typed proposal / state pins. */
export interface L15RegistryVersionTuple {
  readonly identityId: string;
  readonly versionId: string;
  /** PostgreSQL-computed content hash (lowercase hex SHA-256). */
  readonly contentHash: string;
}

export interface L15RegistryProposalContent extends L15RegistryVersionTuple {
  readonly subjectKind: L15RegistrySubjectKind;
  readonly intent: L15RegistryProposalIntent;
  readonly sourceClass: L15RegistrySourceClass;
  /** null = IMMEDIATE (DB transaction instant); else canonical UTC microsecond instant (BACKDATED / FUTURE_DATED need policy). */
  readonly requestedEffectiveFrom: string | null;
  /** REVOKE only: the exact current VALIDATED state of the same tuple. */
  readonly targetStateId: string | null;
}

export const L15_REGISTRY_COMMAND_OUTCOMES = ['ADMITTED', 'SUBMITTED', 'VALIDATED', 'REJECTED', 'DEFERRED', 'REVOKED', 'DENIED'] as const;
export type L15RegistryCommandOutcome = (typeof L15_REGISTRY_COMMAND_OUTCOMES)[number];

/** Durable command result (replay returns the original row, `replay = true`). */
export interface L15RegistryCommandResult {
  readonly replay: boolean;
  readonly commandId: string;
  readonly commandKind: 'ADMIT_RISK_SCENARIO_DEFINITION_VERSION' | 'ADMIT_RISK_METHODOLOGY_VERSION' | 'SUBMIT_PROPOSAL' | 'DECIDE_PROPOSAL';
  readonly subjectKind: L15RegistrySubjectKind;
  readonly outcome: L15RegistryCommandOutcome;
  readonly commandFingerprint: string;
  readonly authorizationDecisionId: string | null;
  readonly authorizationResult: 'ALLOW' | 'DENY' | null;
  readonly denyReason: string | null;
  readonly attemptedContentHash: string | null;
  readonly expectationKind: 'EXPECTED_NONE' | 'EXPECTED_CURRENT' | null;
  readonly expectedLatestVersionId: string | null;
  readonly expectedCurrentStateId: string | null;
  readonly proposalId: string | null;
  readonly governanceDecisionId: string | null;
  readonly identityId: string | null;
  readonly versionId: string | null;
  readonly predecessorVersionId: string | null;
  readonly contentHash: string | null;
  /** The exact L15 state id (VALIDATED / REVOKED decision results only). */
  readonly stateId: string | null;
  readonly stateKind: 'VALIDATED' | 'REVOKED' | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// RISK_SCENARIO_DEFINITION content
// ---------------------------------------------------------------------------------------------------------------------

/** Closed subject-kind tokens: the eight legal object kinds and `REL:<type>` for exact relationship-state subjects. */
export const L15_SCENARIO_SUBJECT_TOKENS = [
  'AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'DATA_ASSET', 'DATA_ELEMENT',
  'REL:USES_MODEL', 'REL:USES_TOOL', 'REL:USES_MCP', 'REL:INVOKES', 'REL:USES_PROMPT', 'REL:USES_KNOWLEDGE_BASE',
  'REL:USES_SKILL', 'REL:EXPOSES', 'REL:HANDOFF_TO', 'REL:READS_FROM', 'REL:WRITES_TO', 'REL:DERIVED_FROM',
] as const;
export type L15ScenarioSubjectToken = (typeof L15_SCENARIO_SUBJECT_TOKENS)[number];
export const L15_SCENARIO_MAX_SUBJECT_KINDS = 20;

/** Mirror of gov_repo.l15_risk_domain_subject_legal_v1 (closed §8.2 matrix; no inheritance). */
export function isLegalL15ScenarioSubject(domain: string, token: string): boolean {
  if (!(L15_RISK_DOMAINS as readonly string[]).includes(domain)) return false;
  if (!(L15_SCENARIO_SUBJECT_TOKENS as readonly string[]).includes(token)) return false;
  const entry: L15DomainSubjects = L15_DOMAIN_SUBJECT_MATRIX[domain as L15RiskDomain];
  return token.startsWith('REL:')
    ? (entry.relationships as readonly string[]).includes(token.slice(4))
    : (entry.objects as readonly string[]).includes(token);
}

/** Closed typed reference namespaces with their exact bounded code syntax. Descriptive provenance only. */
export const L15_SCENARIO_REFERENCE_PATTERNS = {
  SCANNER_RULE_ID: /^RISK-[A-Z0-9]+(-[A-Z0-9]+)*$/,
  CG_AG_CONTROL_ID: /^CG-AG-[0-9]{3}$/,
  ORGANISATION_SCENARIO_CODE: /^[A-Z][A-Z0-9]*([_.-][A-Z0-9]+)*$/,
} as const;
export type L15ScenarioReferenceNamespace = keyof typeof L15_SCENARIO_REFERENCE_PATTERNS;
export const L15_SCENARIO_REFERENCE_NAMESPACES = Object.keys(L15_SCENARIO_REFERENCE_PATTERNS) as readonly L15ScenarioReferenceNamespace[];
export const L15_SCENARIO_REFERENCE_BOUNDS = { minReferences: 1, maxReferences: 32, maxCodeLength: 64 } as const;

export interface L15ScenarioReference { readonly namespace: L15ScenarioReferenceNamespace; readonly code: string }

export function isValidL15ScenarioReference(namespace: string, code: string): boolean {
  if (!(L15_SCENARIO_REFERENCE_NAMESPACES as readonly string[]).includes(namespace)) return false;
  return typeof code === 'string' && code.length >= 1 && code.length <= L15_SCENARIO_REFERENCE_BOUNDS.maxCodeLength
    && L15_SCENARIO_REFERENCE_PATTERNS[namespace as L15ScenarioReferenceNamespace].test(code);
}

/** Immutable scenario version content. No free-text title / description / rationale. */
export interface L15ScenarioDefinitionVersionContent {
  readonly riskDomain: L15RiskDomain;
  readonly subjectKinds: readonly L15ScenarioSubjectToken[];
  readonly references: readonly L15ScenarioReference[];
}

// ---------------------------------------------------------------------------------------------------------------------
// RISK_METHODOLOGY content
// ---------------------------------------------------------------------------------------------------------------------

export const L15_METHODOLOGY_LEVEL_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;
export const L15_METHODOLOGY_DEFINITION_NAMESPACES = ['ORGANISATION_DEFINITION_CODE'] as const;
export type L15MethodologyDefinitionNamespace = (typeof L15_METHODOLOGY_DEFINITION_NAMESPACES)[number];
export const L15_METHODOLOGY_DEFINITION_CODE = /^[A-Z][A-Z0-9]*([_.-][A-Z0-9]+)*$/;

export interface L15MethodologyDefinitionReference {
  readonly namespace: L15MethodologyDefinitionNamespace;
  readonly code: string;
}

/** One level of an ordered closed scale. `ordinal` (1..n, contiguous) is the only numeric field of any L15 registry. */
export interface L15MethodologyLevel {
  readonly levelCode: string;
  readonly ordinal: number;
  readonly definition: L15MethodologyDefinitionReference;
}
export type L15LikelihoodLevel = L15MethodologyLevel;
export type L15ImpactLevel = L15MethodologyLevel;

/** One cell of the TOTAL lookup matrix (never arithmetic). */
export interface L15RatingMatrixCell {
  readonly likelihoodLevelCode: string;
  readonly impactLevelCode: string;
  readonly ratingBand: L15RatingBand;
}

/** Positive interval: months, days, time-of-day microseconds, each a non-negative integer, not all zero. */
export interface L15AssessmentValidityMaximum {
  readonly months: number;
  readonly days: number;
  readonly microseconds: number;
}

export interface L15MethodologyVersionContent {
  readonly likelihoodScale: readonly L15LikelihoodLevel[];
  readonly impactScale: readonly L15ImpactLevel[];
  readonly ratingMatrix: readonly L15RatingMatrixCell[];
  readonly assessmentValidityMaximum: L15AssessmentValidityMaximum;
}

export const L15_METHODOLOGY_SCALE_BOUNDS = L15_METHODOLOGY_SCALE_LEVELS;
export const L15_METHODOLOGY_RATING_BANDS = L15_RATING_BANDS;

// ---------------------------------------------------------------------------------------------------------------------
// Exact validated dependency pins (what S3 / S4 store; resolved only by the owner-only exact bitemporal resolvers)
// ---------------------------------------------------------------------------------------------------------------------

/** Pin of a VALIDATED scenario version state (S3 GOVERNED_RISK). Never "latest", never by code / label / domain. */
export interface L15ValidatedScenarioDefinitionPin {
  readonly organisationId: string;
  readonly scenarioDefinitionId: string;
  readonly scenarioDefinitionVersionId: string;
  readonly contentHash: string;
  readonly stateId: string;
}

/** Pin of a VALIDATED methodology version state (S4 RISK_ASSESSMENT). Never an implicit default methodology. */
export interface L15ValidatedMethodologyPin {
  readonly organisationId: string;
  readonly methodologyId: string;
  readonly methodologyVersionId: string;
  readonly contentHash: string;
  readonly stateId: string;
}

/** Exact bitemporal resolver request (both coordinates mandatory). */
export interface L15RegistryResolverRequest extends L15RegistryVersionTuple {
  readonly organisationId: string;
  readonly effectiveAt: string;
  readonly recordedCutoff: string;
}
