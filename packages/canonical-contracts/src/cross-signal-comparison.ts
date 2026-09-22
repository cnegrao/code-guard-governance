import type { BehaviorBindingRelationshipType, CanonicalObjectIdentity } from './contracts.ts';
import type { CanonicalObjectId, IsoTimestamp, OrganisationId, RelationshipId, RelationshipStateId, SourceConnectionId } from './identifiers.ts';
import type { RuntimeObservationId } from './runtime-observation.ts';

/**
 * GOV IA M15 V1 - Cross-Signal Reconciliation & Drift.
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 * Pure typed contract only. No persistence, Supabase, SQL, Graph, Vector or LLM authority.
 */

/** Closed V1 comparison dimensions (ADR §7.1). No other dimension is supported. */
export const CROSS_SIGNAL_DIMENSION = {
  PRINCIPAL_IDENTITY: 'PRINCIPAL_IDENTITY',
  DEPENDENCY_TARGET_IDENTITY: 'DEPENDENCY_TARGET_IDENTITY',
} as const;
export type CrossSignalDimension = (typeof CROSS_SIGNAL_DIMENSION)[keyof typeof CROSS_SIGNAL_DIMENSION];

/**
 * Closed pairing-mode vocabulary (ADR §7.2). RUNTIME_VS_RUNTIME is reserved,
 * frozen vocabulary only - no V1 method targets it, and it never reaches a
 * persisted CrossSignalComparisonResult (see the pairingMode literal below).
 */
export const CROSS_SIGNAL_PAIRING_MODE = {
  DESIGN_TIME_VS_RUNTIME: 'DESIGN_TIME_VS_RUNTIME',
  RUNTIME_VS_RUNTIME: 'RUNTIME_VS_RUNTIME',
} as const;
export type CrossSignalPairingMode = (typeof CROSS_SIGNAL_PAIRING_MODE)[keyof typeof CROSS_SIGNAL_PAIRING_MODE];

/** The two closed V1 method codes (ADR §7.2, §19 DoD #2). No RUNTIME_VS_RUNTIME method code exists. */
export const CROSS_SIGNAL_METHOD_CODE = {
  CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1',
  CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1',
} as const;
export type CrossSignalMethodCode = (typeof CROSS_SIGNAL_METHOD_CODE)[keyof typeof CROSS_SIGNAL_METHOD_CODE];

/**
 * Closed outcome vocabulary (ADR §4). DRIFT_CANDIDATE is frozen vocabulary for
 * a future comparison method; no V1 method ever constructs it (ADR §7.1a).
 */
export const CROSS_SIGNAL_OUTCOME = {
  CONSISTENT: 'CONSISTENT',
  DRIFT_CANDIDATE: 'DRIFT_CANDIDATE',
  CONFLICT_CANDIDATE: 'CONFLICT_CANDIDATE',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
} as const;
export type CrossSignalOutcome = (typeof CROSS_SIGNAL_OUTCOME)[keyof typeof CROSS_SIGNAL_OUTCOME];

/** Closed INSUFFICIENT_EVIDENCE reason vocabulary (ADR §11, §18). */
export const CROSS_SIGNAL_INSUFFICIENT_EVIDENCE_REASON = {
  RUNTIME_BINDING_UNRESOLVED: 'RUNTIME_BINDING_UNRESOLVED',
  DESIGN_TIME_BASELINE_MISSING: 'DESIGN_TIME_BASELINE_MISSING',
  DESIGN_TIME_BASELINE_NOT_EFFECTIVE: 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE',
  RUNTIME_TARGET_NOT_PROVEN: 'RUNTIME_TARGET_NOT_PROVEN',
  RUNTIME_PRINCIPAL_NOT_PROVEN: 'RUNTIME_PRINCIPAL_NOT_PROVEN',
  SUBJECT_AMBIGUOUS: 'SUBJECT_AMBIGUOUS',
  CLOCK_UNCERTAIN: 'CLOCK_UNCERTAIN',
} as const;
export type CrossSignalInsufficientEvidenceReason =
  (typeof CROSS_SIGNAL_INSUFFICIENT_EVIDENCE_REASON)[keyof typeof CROSS_SIGNAL_INSUFFICIENT_EVIDENCE_REASON];

/** DESIGN_TIME_VS_RUNTIME's four governed relationship types eligible for DEPENDENCY_TARGET_IDENTITY (ADR §7.1). */
export type CrossSignalDependencyRelationshipType = Extract<BehaviorBindingRelationshipType,
  'USES_MODEL' | 'USES_TOOL' | 'USES_MCP' | 'INVOKES'>;

/** PRINCIPAL_IDENTITY design-time side (ADR §11): the exact materialized state, never a decision/candidate id alone. */
export interface CrossSignalExecutionFieldStateReference {
  readonly kind: 'EXECUTION_FIELD_STATE';
  readonly executionFieldStateId: string;
  readonly decisionId: string;
  readonly snapshotId: string;
}

/** One member of a DEPENDENCY_TARGET_IDENTITY effective relationship-state set (ADR §11). Never relationshipCandidateId. */
export interface CrossSignalRelationshipStateSetMember {
  readonly relationshipId: RelationshipId;
  readonly relationshipStateId: RelationshipStateId;
  readonly decisionId?: string;
  readonly validFrom: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
}

/** DEPENDENCY_TARGET_IDENTITY design-time side: the resolved effective set (ADR §7.1, §11). May be empty. */
export interface CrossSignalRelationshipStateSetReference {
  readonly kind: 'RELATIONSHIP_STATE_SET';
  readonly states: readonly CrossSignalRelationshipStateSetMember[];
}

/** The runtime side of V1's sole pairing (ADR §11). */
export interface CrossSignalRuntimeObservationReference {
  readonly kind: 'RUNTIME_OBSERVATION';
  readonly observationId: RuntimeObservationId;
  readonly connectionId: SourceConnectionId;
}

export type CrossSignalEvidenceReference =
  | CrossSignalExecutionFieldStateReference
  | CrossSignalRelationshipStateSetReference
  | CrossSignalRuntimeObservationReference;

/**
 * Closed, boundary-tagged temporal-basis vocabulary (ADR §11-§12). Never an
 * ambiguous generic tag; a reader never has to infer which clock/boundary a
 * stored time meant.
 */
export type CrossSignalTemporalBasis =
  | { readonly basis: 'RELATIONSHIP_VALID_FROM'; readonly value: IsoTimestamp }
  | { readonly basis: 'RELATIONSHIP_VALID_TO'; readonly value: IsoTimestamp }
  | { readonly basis: 'RELATIONSHIP_VALID_FROM_TO_SET' }
  | { readonly basis: 'RUNTIME_EVENT_TIME'; readonly value: IsoTimestamp }
  | { readonly basis: 'NOT_AVAILABLE' };

/**
 * The single durable M15 V1 output (ADR §2, §11). pairingMode is fixed to the
 * one V1-supported literal: RUNTIME_VS_RUNTIME never reaches this field
 * (ADR §7.2, §11). left/right are the exact materialized-state references,
 * never copied values; both are present for CONSISTENT/CONFLICT_CANDIDATE/
 * DRIFT_CANDIDATE outcomes, and are omitted only for the side that could not
 * be resolved when outcome is INSUFFICIENT_EVIDENCE (ADR §11: "never persisted
 * with an invented value in its place").
 */
export interface CrossSignalComparisonResult {
  readonly organisationId: OrganisationId;
  readonly subject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly dimension: CrossSignalDimension;
  readonly pairingMode: 'DESIGN_TIME_VS_RUNTIME';
  readonly left?: CrossSignalEvidenceReference;
  readonly right?: CrossSignalEvidenceReference;
  readonly method: { readonly code: CrossSignalMethodCode; readonly version: string };
  readonly leftTemporalBasis: CrossSignalTemporalBasis;
  readonly rightTemporalBasis: CrossSignalTemporalBasis;
  readonly evaluatedAt: IsoTimestamp;
  readonly outcome: CrossSignalOutcome;
  readonly reason?: CrossSignalInsufficientEvidenceReason;
}

const DIMENSION_METHOD_CODE: Readonly<Record<CrossSignalDimension, CrossSignalMethodCode>> = {
  PRINCIPAL_IDENTITY: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1',
  DEPENDENCY_TARGET_IDENTITY: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1',
};

function invalid(): never { throw new TypeError('CROSS_SIGNAL_COMPARISON_RESULT_INVALID'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) invalid();
  return value as Record<string, unknown>;
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const item = object(value);
  if (required.some(key => !Object.hasOwn(item, key)) ||
    Object.keys(item).some(key => !required.includes(key) && !optional.includes(key))) invalid();
  return item;
}
function nonEmptyString(value: unknown): string { if (typeof value !== 'string' || !value.trim()) invalid(); return value; }
function isoTimestamp(value: unknown): IsoTimestamp {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return value as IsoTimestamp;
}
function canonicalObjectIdentity(value: unknown, kind: 'AGENT_VERSION'): CanonicalObjectIdentity<'AGENT_VERSION'> {
  const c = closed(value, ['organisationId', 'objectId', 'kind']);
  if (c.kind !== kind) invalid();
  return Object.freeze({ organisationId: nonEmptyString(c.organisationId) as OrganisationId,
    objectId: nonEmptyString(c.objectId) as CanonicalObjectId, kind }) as CanonicalObjectIdentity<'AGENT_VERSION'>;
}

function executionFieldStateReference(value: unknown): CrossSignalExecutionFieldStateReference {
  const r = closed(value, ['kind', 'executionFieldStateId', 'decisionId', 'snapshotId']);
  if (r.kind !== 'EXECUTION_FIELD_STATE') invalid();
  return Object.freeze({ kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: nonEmptyString(r.executionFieldStateId),
    decisionId: nonEmptyString(r.decisionId), snapshotId: nonEmptyString(r.snapshotId) });
}
function relationshipStateSetMember(value: unknown): CrossSignalRelationshipStateSetMember {
  const m = closed(value, ['relationshipId', 'relationshipStateId', 'validFrom'], ['decisionId', 'validTo']);
  const validFrom = isoTimestamp(m.validFrom);
  const validTo = m.validTo === undefined ? undefined : isoTimestamp(m.validTo);
  if (validTo !== undefined && Date.parse(validTo) <= Date.parse(validFrom)) invalid();
  return Object.freeze({ relationshipId: nonEmptyString(m.relationshipId) as RelationshipId,
    relationshipStateId: nonEmptyString(m.relationshipStateId) as RelationshipStateId,
    ...(m.decisionId === undefined ? {} : { decisionId: nonEmptyString(m.decisionId) }),
    validFrom, ...(validTo === undefined ? {} : { validTo }) });
}
function relationshipStateSetReference(value: unknown): CrossSignalRelationshipStateSetReference {
  const r = closed(value, ['kind', 'states']);
  if (r.kind !== 'RELATIONSHIP_STATE_SET' || !Array.isArray(r.states)) invalid();
  return Object.freeze({ kind: 'RELATIONSHIP_STATE_SET', states: Object.freeze((r.states as unknown[]).map(relationshipStateSetMember)) });
}
function runtimeObservationReference(value: unknown): CrossSignalRuntimeObservationReference {
  const r = closed(value, ['kind', 'observationId', 'connectionId']);
  if (r.kind !== 'RUNTIME_OBSERVATION') invalid();
  return Object.freeze({ kind: 'RUNTIME_OBSERVATION', observationId: nonEmptyString(r.observationId) as RuntimeObservationId,
    connectionId: nonEmptyString(r.connectionId) as SourceConnectionId });
}
function evidenceReference(value: unknown, dimension: CrossSignalDimension, side: 'left' | 'right'): CrossSignalEvidenceReference {
  const r = object(value);
  if (side === 'right') { if (r.kind !== 'RUNTIME_OBSERVATION') invalid(); return runtimeObservationReference(value); }
  if (dimension === 'PRINCIPAL_IDENTITY') { if (r.kind !== 'EXECUTION_FIELD_STATE') invalid(); return executionFieldStateReference(value); }
  if (r.kind !== 'RELATIONSHIP_STATE_SET') invalid();
  return relationshipStateSetReference(value);
}
function temporalBasis(value: unknown): CrossSignalTemporalBasis {
  const t = object(value);
  switch (t.basis) {
    case 'RELATIONSHIP_VALID_FROM': case 'RELATIONSHIP_VALID_TO': case 'RUNTIME_EVENT_TIME':
      { const b = closed(value, ['basis', 'value']); return Object.freeze({ basis: b.basis, value: isoTimestamp(b.value) }) as CrossSignalTemporalBasis; }
    case 'RELATIONSHIP_VALID_FROM_TO_SET': case 'NOT_AVAILABLE':
      closed(value, ['basis']); return Object.freeze({ basis: t.basis }) as CrossSignalTemporalBasis;
    default: return invalid();
  }
}

/**
 * Closed structural constructor, mirroring createRuntimeObservation's
 * reject-before-attempt discipline. Validates shape and the closed vocabulary
 * only - it never resolves a reference, authenticates a tenant, or asserts
 * the outcome is semantically correct; that domain logic lives in
 * governance-review's pure comparison functions (ADR §19 DoD #3).
 */
export function createCrossSignalComparisonResult(value: unknown): CrossSignalComparisonResult {
  const r = closed(value, ['organisationId', 'subject', 'dimension', 'pairingMode', 'method',
    'leftTemporalBasis', 'rightTemporalBasis', 'evaluatedAt', 'outcome'], ['left', 'right', 'reason']);
  if (!Object.hasOwn(CROSS_SIGNAL_DIMENSION, r.dimension as string)) invalid();
  const dimension = r.dimension as CrossSignalDimension;
  if (r.pairingMode !== 'DESIGN_TIME_VS_RUNTIME') invalid();
  if (!Object.hasOwn(CROSS_SIGNAL_OUTCOME, r.outcome as string)) invalid();
  const outcome = r.outcome as CrossSignalOutcome;
  const method = closed(r.method, ['code', 'version']);
  if (method.code !== DIMENSION_METHOD_CODE[dimension]) invalid();
  const reasonRequired = outcome === 'INSUFFICIENT_EVIDENCE';
  if (reasonRequired !== Object.hasOwn(r, 'reason')) invalid();
  if (reasonRequired && !Object.hasOwn(CROSS_SIGNAL_INSUFFICIENT_EVIDENCE_REASON, r.reason as string)) invalid();
  const evidenceRequired = !reasonRequired;
  if (evidenceRequired && (!Object.hasOwn(r, 'left') || !Object.hasOwn(r, 'right'))) invalid();
  return Object.freeze({
    organisationId: nonEmptyString(r.organisationId) as OrganisationId,
    subject: canonicalObjectIdentity(r.subject, 'AGENT_VERSION'),
    dimension, pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    ...(Object.hasOwn(r, 'left') ? { left: evidenceReference(r.left, dimension, 'left') } : {}),
    ...(Object.hasOwn(r, 'right') ? { right: evidenceReference(r.right, dimension, 'right') } : {}),
    method: Object.freeze({ code: method.code as CrossSignalMethodCode, version: nonEmptyString(method.version) }),
    leftTemporalBasis: temporalBasis(r.leftTemporalBasis), rightTemporalBasis: temporalBasis(r.rightTemporalBasis),
    evaluatedAt: isoTimestamp(r.evaluatedAt), outcome,
    ...(reasonRequired ? { reason: r.reason as CrossSignalInsufficientEvidenceReason } : {}),
  });
}

/**
 * Deterministic normalization of a DEPENDENCY_TARGET_IDENTITY effective set:
 * sorted by relationshipStateId so identical sets compare/serialize
 * identically regardless of caller/input order (ADR §13, §15).
 */
export function sortCrossSignalRelationshipStateSet(
  members: readonly CrossSignalRelationshipStateSetMember[],
): readonly CrossSignalRelationshipStateSetMember[] {
  if (!Array.isArray(members)) invalid();
  return Object.freeze([...members]
    .sort((a, b) => String(a.relationshipStateId).localeCompare(String(b.relationshipStateId)))
    .map(m => Object.freeze({ ...m })));
}
