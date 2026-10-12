import type { CanonicalObjectKind, GovernedRelationshipType, TrustState } from './contracts.ts';
import {
  L14_PERMISSIONS, L14_PROPOSAL_SUBJECT_KINDS, type L14GovernanceOutcome, type L14RequestedAction,
} from './l14-authority-policy.ts';

/**
 * M17-S0 L15 Risk Intelligence V1 root contracts (ADR-GOVIA-RISK-INTELLIGENCE-v1, ACCEPTED / FROZEN, §§4-12, 15-16, 20;
 * ADR-GOVIA-M16-AUTHORITY-POLICY-M17-EXTENSION-v1 §§4-7). Closed vocabularies and pure mappings only: no persistence, no
 * L15 store, no authority. PostgreSQL remains the authority for every decision, hash and state. A vocabulary existing
 * here does not mean the family exists: signals / hypotheses (S1), registries (S2), governed risk (S3), assessment (S4),
 * treatment (S5), residual / acceptance (S6) and projections (S7) are created by their own slices.
 */

// ---------------------------------------------------------------------------------------------------------------------
// D-01: single Authority Policy and shared governance envelope (M16 amendment §§4-6).
// ---------------------------------------------------------------------------------------------------------------------

/** The eight L15 permissions. They live in the single organisation-local L14AuthorityPolicy; there is no L15 policy. */
export const L15_PERMISSIONS = [
  'L15_RISK_SCENARIO_ADMIT', 'L15_RISK_SCENARIO_VALIDATE', 'L15_RISK_METHODOLOGY_ADMIT', 'L15_RISK_METHODOLOGY_VALIDATE',
  'L15_GOVERNED_RISK_VALIDATE', 'L15_RISK_ASSESSMENT_VALIDATE', 'L15_RISK_TREATMENT_VALIDATE', 'L15_RISK_ACCEPTANCE_VALIDATE',
] as const;
export type L15Permission = (typeof L15_PERMISSIONS)[number];

/** L15 registry-administration permissions: organisation-local (ALL_ALLOWED_TARGETS) rules only (mirror of M16 D-14). */
export const L15_REGISTRY_PERMISSIONS = [
  'L15_RISK_SCENARIO_ADMIT', 'L15_RISK_SCENARIO_VALIDATE', 'L15_RISK_METHODOLOGY_ADMIT', 'L15_RISK_METHODOLOGY_VALIDATE',
] as const satisfies readonly L15Permission[];

/** The closed Authority Policy permission vocabulary after D-01: exactly 23 tags (15 L14_* + 8 L15_*). */
export const AUTHORITY_POLICY_PERMISSIONS = [...L14_PERMISSIONS, ...L15_PERMISSIONS] as const;
export type AuthorityPolicyPermission = (typeof AUTHORITY_POLICY_PERMISSIONS)[number];

/** The six L15 governance-decision subject kinds of the shared envelope. */
export const L15_GOVERNANCE_SUBJECT_KINDS = [
  'RISK_SCENARIO_DEFINITION', 'RISK_METHODOLOGY', 'GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE',
] as const;
export type L15GovernanceSubjectKind = (typeof L15_GOVERNANCE_SUBJECT_KINDS)[number];

/** The two L15 supporting registries (ADMIT != VALIDATE; organisation-local scope only). */
export const L15_REGISTRY_SUBJECT_KINDS = ['RISK_SCENARIO_DEFINITION', 'RISK_METHODOLOGY'] as const satisfies readonly L15GovernanceSubjectKind[];
export type L15RegistrySubjectKind = (typeof L15_REGISTRY_SUBJECT_KINDS)[number];

/** Exactly four L15 authoritative fact families (ADR §16). A fifth requires a future ADR. */
export const L15_FACT_FAMILIES = [
  'GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE',
] as const satisfies readonly L15GovernanceSubjectKind[];
export type L15FactFamily = (typeof L15_FACT_FAMILIES)[number];

/** Non-authoritative L15 stores. They are NEVER governance subjects (no proposal, authorization, decision or command result). */
export const L15_NON_AUTHORITATIVE_STORE_KINDS = ['RISK_SIGNAL', 'RISK_HYPOTHESIS'] as const;
export type L15NonAuthoritativeStoreKind = (typeof L15_NON_AUTHORITATIVE_STORE_KINDS)[number];

/** The shared governance-envelope subject vocabulary after D-01: exactly 17 values (11 M16 + 6 L15). */
export const GOVERNANCE_ENVELOPE_SUBJECT_KINDS = [...L14_PROPOSAL_SUBJECT_KINDS, ...L15_GOVERNANCE_SUBJECT_KINDS] as const;
export type GovernanceEnvelopeSubjectKind = (typeof GOVERNANCE_ENVELOPE_SUBJECT_KINDS)[number];

/** Closed subject x action -> permission mapping; mirror of gov_repo.l15_governance_permission_v1. */
export const L15_SUBJECT_PERMISSIONS = {
  RISK_SCENARIO_DEFINITION: { admit: 'L15_RISK_SCENARIO_ADMIT', decide: 'L15_RISK_SCENARIO_VALIDATE' },
  RISK_METHODOLOGY: { admit: 'L15_RISK_METHODOLOGY_ADMIT', decide: 'L15_RISK_METHODOLOGY_VALIDATE' },
  GOVERNED_RISK: { admit: null, decide: 'L15_GOVERNED_RISK_VALIDATE' },
  RISK_ASSESSMENT: { admit: null, decide: 'L15_RISK_ASSESSMENT_VALIDATE' },
  RISK_TREATMENT: { admit: null, decide: 'L15_RISK_TREATMENT_VALIDATE' },
  RISK_ACCEPTANCE: { admit: null, decide: 'L15_RISK_ACCEPTANCE_VALIDATE' },
} as const satisfies Record<L15GovernanceSubjectKind, { admit: L15Permission | null; decide: L15Permission }>;

/**
 * The only L15 permission that can authorize `action` on `subjectKind`, or null (fail closed) for an L14 subject,
 * RISK_SIGNAL / RISK_HYPOTHESIS, an unknown value, or ADMIT on a non-registry subject. An L14_* permission is never returned.
 */
export function l15PermissionFor(subjectKind: string, action: string): L15Permission | null {
  if (!(L15_GOVERNANCE_SUBJECT_KINDS as readonly string[]).includes(subjectKind)) return null;
  if (!['ADMIT', 'VALIDATE', 'REJECT', 'DEFER', 'REVOKE'].includes(action)) return null;
  const entry = L15_SUBJECT_PERMISSIONS[subjectKind as L15GovernanceSubjectKind];
  return action === 'ADMIT' ? entry.admit : entry.decide;
}

/** The 24 L15 envelope reason codes: the UNCHANGED M16 rule `<SUBJECT>_{VALIDATED,REJECTED,DEFERRED,REVOKED}`. */
export const L15_GOVERNANCE_REASON_CODES = {
  RISK_SCENARIO_DEFINITION: { VALIDATE: 'RISK_SCENARIO_DEFINITION_VALIDATED', REJECT: 'RISK_SCENARIO_DEFINITION_REJECTED', DEFER: 'RISK_SCENARIO_DEFINITION_DEFERRED', REVOKE: 'RISK_SCENARIO_DEFINITION_REVOKED' },
  RISK_METHODOLOGY: { VALIDATE: 'RISK_METHODOLOGY_VALIDATED', REJECT: 'RISK_METHODOLOGY_REJECTED', DEFER: 'RISK_METHODOLOGY_DEFERRED', REVOKE: 'RISK_METHODOLOGY_REVOKED' },
  GOVERNED_RISK: { VALIDATE: 'GOVERNED_RISK_VALIDATED', REJECT: 'GOVERNED_RISK_REJECTED', DEFER: 'GOVERNED_RISK_DEFERRED', REVOKE: 'GOVERNED_RISK_REVOKED' },
  RISK_ASSESSMENT: { VALIDATE: 'RISK_ASSESSMENT_VALIDATED', REJECT: 'RISK_ASSESSMENT_REJECTED', DEFER: 'RISK_ASSESSMENT_DEFERRED', REVOKE: 'RISK_ASSESSMENT_REVOKED' },
  RISK_TREATMENT: { VALIDATE: 'RISK_TREATMENT_VALIDATED', REJECT: 'RISK_TREATMENT_REJECTED', DEFER: 'RISK_TREATMENT_DEFERRED', REVOKE: 'RISK_TREATMENT_REVOKED' },
  RISK_ACCEPTANCE: { VALIDATE: 'RISK_ACCEPTANCE_VALIDATED', REJECT: 'RISK_ACCEPTANCE_REJECTED', DEFER: 'RISK_ACCEPTANCE_DEFERRED', REVOKE: 'RISK_ACCEPTANCE_REVOKED' },
} as const satisfies Record<L15GovernanceSubjectKind, Record<L14GovernanceOutcome, string>>;
export type L15GovernanceReasonCode =
  (typeof L15_GOVERNANCE_REASON_CODES)[L15GovernanceSubjectKind][L14GovernanceOutcome];

/** Exactly two new ADMIT command kinds; SUBMIT_PROPOSAL / DECIDE_PROPOSAL are reused unchanged. */
export const L15_ADMIT_COMMAND_SUBJECTS = {
  ADMIT_RISK_SCENARIO_DEFINITION_VERSION: 'RISK_SCENARIO_DEFINITION',
  ADMIT_RISK_METHODOLOGY_VERSION: 'RISK_METHODOLOGY',
} as const satisfies Record<string, L15RegistrySubjectKind>;
export type L15AdmitCommandKind = keyof typeof L15_ADMIT_COMMAND_SUBJECTS;

/** Requested actions are the unchanged M16 vocabulary; L15 adds none. */
export type L15RequestedAction = L14RequestedAction;

// ---------------------------------------------------------------------------------------------------------------------
// Closed V1 vocabularies (ADR §11 and the sections it cites). Each is enforced by a DB CHECK in its owning slice.
// ---------------------------------------------------------------------------------------------------------------------

/** Exactly nine risk domains (§7.1). Regulatory / compliance is metadata over a governed risk, never a domain. */
export const L15_RISK_DOMAINS = [
  'PRIVACY', 'CYBERSECURITY', 'AUTHORIZATION', 'AUTONOMY', 'MODEL', 'DATA', 'CONNECTIVITY', 'OPERATIONAL', 'FINOPS',
] as const;
export type L15RiskDomain = (typeof L15_RISK_DOMAINS)[number];

/** Closed V1 signal kinds (§4.3) with their only admissible source class. */
export const L15_SIGNAL_SOURCE_CLASSES = [
  'SYSTEM_DETECTOR', 'SOURCE_CONNECTION', 'RUNTIME_SOURCE', 'GOVERNED_FACT_REFERENCE', 'LOCAL_HUMAN',
] as const;
export type L15SignalSourceClass = (typeof L15_SIGNAL_SOURCE_CLASSES)[number];

export const L15_SIGNAL_KIND_SOURCES = {
  DETECTED_PATTERN: 'SYSTEM_DETECTOR',
  DETECTED_ABSENCE: 'SYSTEM_DETECTOR',
  RUNTIME_OBSERVATION_REF: 'RUNTIME_SOURCE',
  CROSS_SIGNAL_RESULT_REF: 'GOVERNED_FACT_REFERENCE',
  EXECUTION_CONTEXT_REF: 'GOVERNED_FACT_REFERENCE',
  CONTROL_ASSESSMENT_REF: 'GOVERNED_FACT_REFERENCE',
  GOVERNANCE_GAP_REF: 'GOVERNED_FACT_REFERENCE',
  LINEAGE_REF: 'GOVERNED_FACT_REFERENCE',
  IMPORTED_ASSERTION: 'SOURCE_CONNECTION',
  HUMAN_OBSERVATION: 'LOCAL_HUMAN',
} as const satisfies Record<string, L15SignalSourceClass>;
export type L15SignalKind = keyof typeof L15_SIGNAL_KIND_SOURCES;
export const L15_SIGNAL_KINDS = Object.keys(L15_SIGNAL_KIND_SOURCES) as readonly L15SignalKind[];

/** Trust a signal / hypothesis may carry: the four non-VALIDATED baseline states. Never VALIDATED (§§4.2, 5.1). */
export const L15_SIGNAL_TRUST_STATES = ['INFERRED', 'DECLARED', 'IMPORTED', 'OBSERVED'] as const satisfies readonly TrustState[];
export type L15SignalTrustState = (typeof L15_SIGNAL_TRUST_STATES)[number];

export const L15_HYPOTHESIS_GENERATOR_KINDS = [
  'DETERMINISTIC_RULE', 'GRAPH_ANALYSIS', 'VECTOR_RETRIEVAL', 'LLM_ASSISTED', 'HUMAN',
] as const;
export type L15HypothesisGeneratorKind = (typeof L15_HYPOTHESIS_GENERATOR_KINDS)[number];

/** Hypothesis disposition is a read projection (§5.2), never a stored status. */
export const L15_HYPOTHESIS_DISPOSITIONS = [
  'UNREVIEWED', 'CITED_BY_LIVE_PROPOSAL', 'CITED_BY_GOVERNED_RISK', 'CITED_BY_REJECTED_PROPOSAL',
] as const;
export type L15HypothesisDisposition = (typeof L15_HYPOTHESIS_DISPOSITIONS)[number];

export const L15_GOVERNED_STATE_KINDS = ['VALIDATED', 'REVOKED'] as const;
export type L15GovernedStateKind = (typeof L15_GOVERNED_STATE_KINDS)[number];

/** Governance outcomes: the unchanged M16 four (+ ADMIT for the two registries, as a requested action). */
export const L15_GOVERNANCE_OUTCOMES = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const satisfies readonly L14GovernanceOutcome[];

export const L15_ASSESSMENT_BASES = ['INHERENT', 'RESIDUAL'] as const;
export type L15AssessmentBasis = (typeof L15_ASSESSMENT_BASES)[number];

export const L15_ASSESSMENT_OUTCOMES = ['RATED', 'INSUFFICIENT_EVIDENCE'] as const;
export type L15AssessmentOutcome = (typeof L15_ASSESSMENT_OUTCOMES)[number];

/** Rating band: DB-derived from the pinned methodology matrix only; never caller-supplied, never a score. */
export const L15_RATING_BANDS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;
export type L15RatingBand = (typeof L15_RATING_BANDS)[number];

/** Methodology scale cardinality bounds (§7.3): each ordered scale has 2..7 levels. */
export const L15_METHODOLOGY_SCALE_LEVELS = { min: 2, max: 7 } as const;

export const L15_TREATMENT_OPTIONS = ['MITIGATE', 'AVOID', 'TRANSFER'] as const;
export type L15TreatmentOption = (typeof L15_TREATMENT_OPTIONS)[number];

export const L15_TREATMENT_IMPLEMENTATION_STATUSES = ['PLANNED', 'IMPLEMENTED'] as const;
export type L15TreatmentImplementationStatus = (typeof L15_TREATMENT_IMPLEMENTATION_STATUSES)[number];

/** Closed L15 fields of REVOKE proposals / tombstones (not shared envelope reason codes). */
export const L15_CLOSURE_REASONS = [
  'RISK_NO_LONGER_APPLICABLE', 'SUBJECT_RETIRED', 'DUPLICATE_OF_GOVERNED_RISK', 'RISK_ELIMINATED_BY_AVOIDANCE',
  'RECORDED_IN_ERROR',
] as const;
export type L15ClosureReason = (typeof L15_CLOSURE_REASONS)[number];

export const L15_TREATMENT_REVOCATION_REASONS = ['TREATMENT_FAILED', 'TREATMENT_WITHDRAWN', 'RECORDED_IN_ERROR'] as const;
export type L15TreatmentRevocationReason = (typeof L15_TREATMENT_REVOCATION_REASONS)[number];

/** Read projections only (§§11, 14.3, 19, 20.2): never stored, never manually edited. */
export const L15_RISK_LIFECYCLE_PROJECTION = [
  'IDENTIFIED', 'ASSESSED', 'TREATMENT_APPROVED', 'TREATMENT_IMPLEMENTED', 'RESIDUAL_ASSESSED', 'RESIDUAL_ACCEPTED', 'CLOSED',
] as const;
export type L15RiskLifecycle = (typeof L15_RISK_LIFECYCLE_PROJECTION)[number];

export const L15_RESIDUAL_ELIGIBILITY_PROJECTION = ['CURRENT', 'DEPENDENCY_INVALID', 'EXPIRED', 'ABSENT'] as const;
export type L15ResidualEligibility = (typeof L15_RESIDUAL_ELIGIBILITY_PROJECTION)[number];

export const L15_CONFLICT_PROJECTION = ['RESOLVED', 'CONFLICT', 'INSUFFICIENT_EVIDENCE'] as const;
export type L15ConflictOutcome = (typeof L15_CONFLICT_PROJECTION)[number];

export const L15_SUPPORT_CURRENCY_PROJECTION = ['SUPPORT_CURRENT', 'SUPPORT_DEGRADED', 'SUPPORT_NONE'] as const;
export type L15SupportCurrency = (typeof L15_SUPPORT_CURRENCY_PROJECTION)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Subjects (§8): legal V1 subject kinds and the closed domain x subject matrix (D-07). No inheritance.
// ---------------------------------------------------------------------------------------------------------------------

/** Legal V1 direct object subjects. PROMPT, KNOWLEDGE_BASE and SKILL are NOT direct subjects. */
export const L15_OBJECT_SUBJECT_KINDS = [
  'AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'DATA_ASSET', 'DATA_ELEMENT',
] as const satisfies readonly CanonicalObjectKind[];
export type L15ObjectSubjectKind = (typeof L15_OBJECT_SUBJECT_KINDS)[number];

const ALL_RELATIONSHIP_TYPES = [
  'USES_MODEL', 'USES_TOOL', 'USES_MCP', 'INVOKES', 'USES_PROMPT', 'USES_KNOWLEDGE_BASE', 'USES_SKILL', 'EXPOSES',
  'HANDOFF_TO', 'READS_FROM', 'WRITES_TO', 'DERIVED_FROM',
] as const satisfies readonly GovernedRelationshipType[];

export interface L15DomainSubjects {
  readonly objects: readonly L15ObjectSubjectKind[];
  readonly relationships: readonly GovernedRelationshipType[];
}

export const L15_DOMAIN_SUBJECT_MATRIX = {
  PRIVACY: { objects: ['AGENT_VERSION', 'DATA_ASSET', 'DATA_ELEMENT'], relationships: ['READS_FROM', 'WRITES_TO', 'DERIVED_FROM'] },
  CYBERSECURITY: {
    objects: ['AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API'],
    relationships: ['USES_TOOL', 'USES_MCP', 'INVOKES', 'EXPOSES', 'USES_PROMPT'],
  },
  AUTHORIZATION: {
    objects: ['AGENT_VERSION', 'TOOL', 'MCP_SERVER', 'API'],
    relationships: ['USES_TOOL', 'USES_MCP', 'INVOKES', 'READS_FROM', 'WRITES_TO'],
  },
  AUTONOMY: { objects: ['AGENT_VERSION'], relationships: ['HANDOFF_TO', 'USES_TOOL', 'USES_MCP', 'INVOKES', 'WRITES_TO'] },
  MODEL: { objects: ['MODEL', 'AGENT_VERSION'], relationships: ['USES_MODEL'] },
  DATA: {
    objects: ['DATA_ASSET', 'DATA_ELEMENT'],
    relationships: ['READS_FROM', 'WRITES_TO', 'DERIVED_FROM', 'USES_KNOWLEDGE_BASE'],
  },
  CONNECTIVITY: { objects: ['AGENT_VERSION', 'TOOL', 'MCP_SERVER', 'API'], relationships: ['INVOKES', 'USES_MCP', 'USES_TOOL'] },
  OPERATIONAL: { objects: ['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API'], relationships: ALL_RELATIONSHIP_TYPES },
  FINOPS: { objects: ['AGENT_VERSION', 'MODEL', 'API'], relationships: ['USES_MODEL', 'INVOKES'] },
} as const satisfies Record<L15RiskDomain, L15DomainSubjects>;

export type L15SubjectRef =
  | { readonly tag: 'OBJECT'; readonly kind: string }
  | { readonly tag: 'RELATIONSHIP_STATE'; readonly relationshipType: string };

/** Closed V1 domain x subject legality (every other pairing MUST be rejected). */
export function isLegalL15DomainSubject(domain: string, subject: L15SubjectRef): boolean {
  if (!(L15_RISK_DOMAINS as readonly string[]).includes(domain)) return false;
  const entry: L15DomainSubjects = L15_DOMAIN_SUBJECT_MATRIX[domain as L15RiskDomain];
  return subject.tag === 'OBJECT'
    ? (entry.objects as readonly string[]).includes(subject.kind)
    : (entry.relationships as readonly string[]).includes(subject.relationshipType);
}

// ---------------------------------------------------------------------------------------------------------------------
// Evidence / support (§§9.1-9.2, D-03): closed tagged union and the acyclic owner -> target matrix.
// ---------------------------------------------------------------------------------------------------------------------

export const L15_SUPPORT_TARGET_TAGS = [
  'DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'RUNTIME_OBSERVATION', 'CROSS_SIGNAL_RESULT', 'EXECUTION_FIELD_STATE',
  'TECHNICAL_FIELD_STATE', 'LINEAGE_OBSERVATION', 'L14_FACT_STATE', 'RISK_SIGNAL', 'RISK_HYPOTHESIS',
] as const;
export type L15SupportTargetTag = (typeof L15_SUPPORT_TARGET_TAGS)[number];

/** Rank-0 upstream evidence tags. */
export const L15_UPSTREAM_EVIDENCE_TAGS = [
  'DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION', 'RUNTIME_OBSERVATION', 'CROSS_SIGNAL_RESULT', 'EXECUTION_FIELD_STATE',
  'TECHNICAL_FIELD_STATE', 'LINEAGE_OBSERVATION', 'L14_FACT_STATE',
] as const satisfies readonly L15SupportTargetTag[];

export const L15_SUPPORT_OWNER_KINDS = [
  'RISK_SIGNAL', 'RISK_HYPOTHESIS', ...L15_GOVERNANCE_SUBJECT_KINDS,
] as const;
export type L15SupportOwnerKind = (typeof L15_SUPPORT_OWNER_KINDS)[number];

export const L15_SUPPORT_ADMISSIBILITY = {
  RISK_SIGNAL: L15_UPSTREAM_EVIDENCE_TAGS,
  RISK_HYPOTHESIS: ['RISK_SIGNAL'],
  RISK_SCENARIO_DEFINITION: ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION'],
  RISK_METHODOLOGY: ['DISCOVERY_EVIDENCE', 'SOURCE_ASSERTION'],
  GOVERNED_RISK: ['RISK_HYPOTHESIS', 'RISK_SIGNAL', ...L15_UPSTREAM_EVIDENCE_TAGS],
  RISK_ASSESSMENT: ['RISK_HYPOTHESIS', 'RISK_SIGNAL', ...L15_UPSTREAM_EVIDENCE_TAGS],
  RISK_TREATMENT: ['RISK_HYPOTHESIS', 'RISK_SIGNAL', ...L15_UPSTREAM_EVIDENCE_TAGS],
  RISK_ACCEPTANCE: ['RISK_HYPOTHESIS', 'RISK_SIGNAL', ...L15_UPSTREAM_EVIDENCE_TAGS],
} as const satisfies Record<L15SupportOwnerKind, readonly L15SupportTargetTag[]>;

export function isAdmissibleL15SupportLink(owner: string, target: string): boolean {
  if (!(L15_SUPPORT_OWNER_KINDS as readonly string[]).includes(owner)) return false;
  return (L15_SUPPORT_ADMISSIBILITY[owner as L15SupportOwnerKind] as readonly string[]).includes(target);
}
