import { createHash } from 'node:crypto';
import {
  createCrossSignalComparisonResult, createExecutionFact, sortCrossSignalRelationshipStateSet,
  type CanonicalObjectIdentity, type CrossSignalComparisonResult, type CrossSignalDependencyRelationshipType,
  type CrossSignalEvidenceReference, type CrossSignalRelationshipStateSetMember, type CrossSignalTemporalBasis,
  type ExecutionPrincipalReference, type IsoTimestamp, type OrganisationId, type RelationshipId, type RelationshipStateId,
  type RuntimeObservation, type RuntimeTargetKind,
} from '@council/canonical-contracts';
import { stableCandidateContent } from './canonical-endpoint-resolution';
import { validatePersistedRuntimeObservation } from './runtime-observation.ts';

/**
 * GOV IA M15 V1 - Cross-Signal Reconciliation & Drift.
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 *
 * Pure domain comparison only: no persistence, Supabase, Graph, Vector or LLM
 * call. Both functions trust their `runtime` input only after re-running
 * validatePersistedRuntimeObservation (M14's own reject-before-attempt
 * boundary) - this module never treats an unvalidated shape as evidence.
 */

type CrossSignalRejectionCode =
  | 'CROSS_SIGNAL_PAIRING_UNSUPPORTED'
  | 'CROSS_SIGNAL_DIMENSION_UNSUPPORTED'
  | 'CROSS_SIGNAL_REQUEST_INVALID'
  | 'CROSS_SIGNAL_SUBJECT_CROSS_TENANT'
  | 'CROSS_SIGNAL_SUBJECT_MISMATCH'
  | 'CROSS_SIGNAL_RUNTIME_KIND_UNSUPPORTED'
  | 'CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH';
function reject(code: CrossSignalRejectionCode): never { throw new TypeError(code); }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) reject('CROSS_SIGNAL_REQUEST_INVALID');
  return value as Record<string, unknown>;
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const item = object(value);
  if (required.some(key => !Object.hasOwn(item, key)) ||
    Object.keys(item).some(key => !required.includes(key) && !optional.includes(key))) reject('CROSS_SIGNAL_REQUEST_INVALID');
  return item;
}
function subject(value: unknown, organisationId: OrganisationId): CanonicalObjectIdentity<'AGENT_VERSION'> {
  const s = closed(value, ['organisationId', 'objectId', 'kind']);
  if (s.kind !== 'AGENT_VERSION' || typeof s.objectId !== 'string' || !s.objectId) reject('CROSS_SIGNAL_REQUEST_INVALID');
  if (s.organisationId !== organisationId) reject('CROSS_SIGNAL_SUBJECT_CROSS_TENANT');
  return s as unknown as CanonicalObjectIdentity<'AGENT_VERSION'>;
}
function organisationId(value: unknown): OrganisationId {
  if (typeof value !== 'string' || !value.trim()) reject('CROSS_SIGNAL_REQUEST_INVALID');
  return value as OrganisationId;
}
function nonEmptyString(value: unknown): string { if (typeof value !== 'string' || !value.trim()) reject('CROSS_SIGNAL_REQUEST_INVALID'); return value; }
function isoTimestamp(value: unknown): IsoTimestamp {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) reject('CROSS_SIGNAL_REQUEST_INVALID');
  return value as IsoTimestamp;
}
function evaluatedAt(value: unknown): IsoTimestamp { return isoTimestamp(value); }
function nanosToIsoTimestamp(nanos: bigint): IsoTimestamp {
  return new Date(Number(nanos / BigInt(1000000))).toISOString() as IsoTimestamp;
}
function runtimeEvidence(runtime: RuntimeObservation): CrossSignalEvidenceReference {
  return { kind: 'RUNTIME_OBSERVATION', observationId: runtime.observationId, connectionId: runtime.sourceConnection.connectionId };
}
function checkRuntimeSubjectBinding(runtime: RuntimeObservation, organisationId: OrganisationId,
  subject: CanonicalObjectIdentity<'AGENT_VERSION'>): 'UNRESOLVED' | 'BOUND' {
  if (runtime.binding.state === 'UNRESOLVED') return 'UNRESOLVED';
  const { agentVersion } = runtime.binding;
  if (agentVersion.organisationId !== organisationId) reject('CROSS_SIGNAL_SUBJECT_CROSS_TENANT');
  if (agentVersion.kind !== 'AGENT_VERSION' || agentVersion.objectId !== subject.objectId) reject('CROSS_SIGNAL_SUBJECT_MISMATCH');
  return 'BOUND';
}

/**
 * PRINCIPAL_IDENTITY design-time side (ADR §7.1, §11): the exact materialized
 * state and its value. `canonicalObject`/`field` mirror ExecutionFieldDecision's
 * own subject/field pair (execution-context.ts) so the design-time side proves
 * its own AGENT_VERSION identity explicitly - never inferred from
 * decisionId/snapshotId, which are opaque references, not identity proof.
 */
export interface CrossSignalPrincipalDesignTimeBaseline {
  readonly canonicalObject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly field: 'PRINCIPAL';
  readonly executionFieldStateId: string;
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly principal: ExecutionPrincipalReference;
}
export interface CrossSignalPrincipalComparisonRequest {
  readonly organisationId: OrganisationId;
  readonly subject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  /** Absent when no ACCEPT_PROPOSED execution_field_states row exists yet for PRINCIPAL. */
  readonly designTime?: CrossSignalPrincipalDesignTimeBaseline;
  readonly runtime: RuntimeObservation;
  readonly evaluatedAt: IsoTimestamp;
}

/**
 * Pure DESIGN_TIME_VS_RUNTIME PRINCIPAL_IDENTITY comparison (ADR §7.1, §D).
 * decidedAt has zero influence - it is never read here. No confidence
 * threshold, no fuzzy/similarity matching, no trust promotion. Never emits
 * DRIFT_CANDIDATE (ADR §7.1a: no fact-valid-time source exists for this side).
 */
export function comparePrincipalIdentityDesignTimeVsRuntime(request: CrossSignalPrincipalComparisonRequest): CrossSignalComparisonResult {
  const r = closed(request, ['organisationId', 'subject', 'runtime', 'evaluatedAt'], ['designTime']);
  const org = organisationId(r.organisationId);
  const sub = subject(r.subject, org);
  const at = evaluatedAt(r.evaluatedAt);
  const runtime = validatePersistedRuntimeObservation(r.runtime);
  if (runtime.organisationId !== org) reject('CROSS_SIGNAL_SUBJECT_CROSS_TENANT');

  const designTimeInput = r.designTime === undefined ? undefined
    : closed(r.designTime, ['canonicalObject', 'field', 'executionFieldStateId', 'decisionId', 'snapshotId', 'principal']);
  if (designTimeInput) {
    if (designTimeInput.field !== 'PRINCIPAL') reject('CROSS_SIGNAL_REQUEST_INVALID');
    const designSubject = subject(designTimeInput.canonicalObject, org);
    if (designSubject.objectId !== sub.objectId) reject('CROSS_SIGNAL_SUBJECT_MISMATCH');
  }

  const right = runtimeEvidence(runtime);
  const rightTemporalBasis: CrossSignalTemporalBasis = { basis: 'RUNTIME_EVENT_TIME', value: nanosToIsoTimestamp(BigInt(runtime.startedAtUnixNano)) };
  const leftTemporalBasis: CrossSignalTemporalBasis = { basis: 'NOT_AVAILABLE' };
  const method = { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1' as const, version: '1.0.0' };
  const base = { organisationId: org, subject: sub, dimension: 'PRINCIPAL_IDENTITY' as const, pairingMode: 'DESIGN_TIME_VS_RUNTIME' as const,
    method, leftTemporalBasis, rightTemporalBasis, evaluatedAt: at };

  if (!designTimeInput) return createCrossSignalComparisonResult({ ...base, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_MISSING' });
  const designFact = createExecutionFact({ field: 'PRINCIPAL', principal: designTimeInput.principal as ExecutionPrincipalReference });
  if (designFact.field !== 'PRINCIPAL') reject('CROSS_SIGNAL_REQUEST_INVALID');
  const designPrincipal = designFact.principal;
  if (typeof designTimeInput.executionFieldStateId !== 'string' || !designTimeInput.executionFieldStateId ||
    typeof designTimeInput.decisionId !== 'string' || !designTimeInput.decisionId ||
    typeof designTimeInput.snapshotId !== 'string' || !designTimeInput.snapshotId) reject('CROSS_SIGNAL_REQUEST_INVALID');
  const left: CrossSignalEvidenceReference = { kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: designTimeInput.executionFieldStateId as string,
    decisionId: designTimeInput.decisionId as string, snapshotId: designTimeInput.snapshotId as string };

  if (checkRuntimeSubjectBinding(runtime, org, sub) === 'UNRESOLVED') {
    return createCrossSignalComparisonResult({ ...base, left, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'RUNTIME_BINDING_UNRESOLVED' });
  }
  if (runtime.context.principal.state === 'UNKNOWN') {
    return createCrossSignalComparisonResult({ ...base, left, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'RUNTIME_PRINCIPAL_NOT_PROVEN' });
  }
  const runtimePrincipal = runtime.context.principal.value.value;
  const equal = designPrincipal.kind === runtimePrincipal.kind && designPrincipal.providerCode === runtimePrincipal.providerCode &&
    designPrincipal.authorityReference === runtimePrincipal.authorityReference && designPrincipal.principalReference === runtimePrincipal.principalReference;
  return createCrossSignalComparisonResult({ ...base, left, right, outcome: equal ? 'CONSISTENT' : 'CONFLICT_CANDIDATE' });
}

const RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE: Readonly<Partial<Record<RuntimeObservation['kind'], CrossSignalDependencyRelationshipType>>> = {
  MODEL_CALL: 'USES_MODEL', TOOL_CALL: 'USES_TOOL', MCP_CALL: 'USES_MCP', API_CALL: 'INVOKES',
};
const DEPENDENCY_RELATIONSHIP_TYPE_TO_TARGET_KIND: Readonly<Record<CrossSignalDependencyRelationshipType, RuntimeTargetKind>> = {
  USES_MODEL: 'MODEL', USES_TOOL: 'TOOL', USES_MCP: 'MCP_SERVER', INVOKES: 'API',
};
const CROSS_SIGNAL_DEPENDENCY_TARGET_KINDS: ReadonlySet<string> = new Set(Object.values(DEPENDENCY_RELATIONSHIP_TYPE_TO_TARGET_KIND));

/**
 * Reject-before-attempt structural validation of one supplied governed
 * relationship state (ADR §7.1, §11): shape, relationship type, target
 * identity, temporal bounds and - critically - the relationship's own source
 * AGENT_VERSION identity are all checked here, before any Date.parse or
 * effective-set membership logic runs. A relationship sourced from another
 * AGENT_VERSION is rejected even when its target/type happen to match; a
 * malformed validFrom/validTo never reaches isEffectiveAt.
 */
function validateGovernedState(value: unknown, organisationId: OrganisationId,
  expectedSubject: CanonicalObjectIdentity<'AGENT_VERSION'>): CrossSignalDependencyGovernedState {
  const s = closed(value, ['relationshipId', 'relationshipStateId', 'source', 'relationshipType', 'target', 'validFrom'], ['decisionId', 'validTo']);
  const relationshipId = nonEmptyString(s.relationshipId) as RelationshipId;
  const relationshipStateId = nonEmptyString(s.relationshipStateId) as RelationshipStateId;
  const decisionId = s.decisionId === undefined ? undefined : nonEmptyString(s.decisionId);
  if (!Object.hasOwn(DEPENDENCY_RELATIONSHIP_TYPE_TO_TARGET_KIND, s.relationshipType as string)) reject('CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH');
  const relationshipType = s.relationshipType as CrossSignalDependencyRelationshipType;
  const target = closed(s.target, ['organisationId', 'objectId', 'kind']);
  if (typeof target.organisationId !== 'string' || !target.organisationId || typeof target.objectId !== 'string' || !target.objectId ||
    !CROSS_SIGNAL_DEPENDENCY_TARGET_KINDS.has(target.kind as string)) reject('CROSS_SIGNAL_REQUEST_INVALID');
  if (target.kind !== DEPENDENCY_RELATIONSHIP_TYPE_TO_TARGET_KIND[relationshipType]) reject('CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH');
  const validFrom = isoTimestamp(s.validFrom);
  const validTo = s.validTo === undefined ? undefined : isoTimestamp(s.validTo);
  if (validTo !== undefined && Date.parse(validTo) <= Date.parse(validFrom)) reject('CROSS_SIGNAL_REQUEST_INVALID');
  const source = subject(s.source, organisationId);
  if (source.objectId !== expectedSubject.objectId) reject('CROSS_SIGNAL_SUBJECT_MISMATCH');
  return Object.freeze({ relationshipId, relationshipStateId, ...(decisionId === undefined ? {} : { decisionId }), source,
    relationshipType, target: Object.freeze({ ...target }) as unknown as CanonicalObjectIdentity,
    validFrom, ...(validTo === undefined ? {} : { validTo }) });
}

/**
 * One governed relationship state supplied for DEPENDENCY_TARGET_IDENTITY
 * (ADR §7.1). Never relationshipCandidateId. `source` is the relationship's
 * own AGENT_VERSION identity - required so a relationship belonging to
 * another AGENT_VERSION can never be accepted merely because its target/type
 * happen to match the requested subject.
 */
export interface CrossSignalDependencyGovernedState {
  readonly relationshipId: RelationshipId;
  readonly relationshipStateId: RelationshipStateId;
  readonly decisionId?: string;
  readonly source: CanonicalObjectIdentity<'AGENT_VERSION'>;
  readonly relationshipType: CrossSignalDependencyRelationshipType;
  readonly target: CanonicalObjectIdentity;
  readonly validFrom: IsoTimestamp;
  readonly validTo?: IsoTimestamp;
}
export interface CrossSignalDependencyComparisonRequest {
  readonly organisationId: OrganisationId;
  readonly subject: CanonicalObjectIdentity<'AGENT_VERSION'>;
  /** All governed states for this subject/relationship type; not assumed pre-filtered to the effective window. */
  readonly governedStates: readonly CrossSignalDependencyGovernedState[];
  readonly runtime: RuntimeObservation;
  readonly evaluatedAt: IsoTimestamp;
}

function isEffectiveAt(state: { readonly validFrom: IsoTimestamp; readonly validTo?: IsoTimestamp }, eventNanos: bigint): boolean {
  const fromNanos = BigInt(Date.parse(state.validFrom)) * BigInt(1000000);
  if (eventNanos < fromNanos) return false;
  if (state.validTo === undefined) return true;
  const toNanos = BigInt(Date.parse(state.validTo)) * BigInt(1000000);
  return eventNanos < toNanos;
}
function toSetMember(state: CrossSignalDependencyGovernedState): CrossSignalRelationshipStateSetMember {
  return Object.freeze({ relationshipId: state.relationshipId, relationshipStateId: state.relationshipStateId,
    ...(state.decisionId === undefined ? {} : { decisionId: state.decisionId }),
    validFrom: state.validFrom, ...(state.validTo === undefined ? {} : { validTo: state.validTo }) });
}

/**
 * Pure DESIGN_TIME_VS_RUNTIME DEPENDENCY_TARGET_IDENTITY comparison (ADR
 * §7.1, §E). Resolves the effective governed set at the runtime event's own
 * time using the half-open interval [validFrom, validTo); cardinality is
 * never assumed to be one. Never emits DRIFT_CANDIDATE (ADR §7.1a): a
 * disagreement here always resolves to CONFLICT_CANDIDATE.
 */
export function compareDependencyTargetIdentityDesignTimeVsRuntime(request: CrossSignalDependencyComparisonRequest): CrossSignalComparisonResult {
  const r = closed(request, ['organisationId', 'subject', 'governedStates', 'runtime', 'evaluatedAt']);
  const org = organisationId(r.organisationId);
  const sub = subject(r.subject, org);
  const at = evaluatedAt(r.evaluatedAt);
  const runtime = validatePersistedRuntimeObservation(r.runtime);
  if (runtime.organisationId !== org) reject('CROSS_SIGNAL_SUBJECT_CROSS_TENANT');
  if (!Array.isArray(r.governedStates)) reject('CROSS_SIGNAL_REQUEST_INVALID');
  const governedStates = (r.governedStates as readonly unknown[]).map(state => validateGovernedState(state, org, sub));

  const relationshipType = RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE[runtime.kind];
  if (!relationshipType) reject('CROSS_SIGNAL_RUNTIME_KIND_UNSUPPORTED');
  const targetKind = DEPENDENCY_RELATIONSHIP_TYPE_TO_TARGET_KIND[relationshipType];
  for (const state of governedStates) {
    if (state.relationshipType !== relationshipType || state.target?.kind !== targetKind || state.target?.organisationId !== org) {
      reject('CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH');
    }
  }

  const right = runtimeEvidence(runtime);
  const eventNanos = BigInt(runtime.startedAtUnixNano);
  const rightTemporalBasis: CrossSignalTemporalBasis = { basis: 'RUNTIME_EVENT_TIME', value: nanosToIsoTimestamp(eventNanos) };
  const leftTemporalBasis: CrossSignalTemporalBasis = { basis: 'RELATIONSHIP_VALID_FROM_TO_SET' };
  const method = { code: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1' as const, version: '1.0.0' };
  const base = { organisationId: org, subject: sub, dimension: 'DEPENDENCY_TARGET_IDENTITY' as const, pairingMode: 'DESIGN_TIME_VS_RUNTIME' as const,
    method, leftTemporalBasis, rightTemporalBasis, evaluatedAt: at };

  if (checkRuntimeSubjectBinding(runtime, org, sub) === 'UNRESOLVED') {
    return createCrossSignalComparisonResult({ ...base, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'RUNTIME_BINDING_UNRESOLVED' });
  }

  const effectiveStates = governedStates.filter(state => isEffectiveAt(state, eventNanos));
  const left: CrossSignalEvidenceReference = { kind: 'RELATIONSHIP_STATE_SET', states: sortCrossSignalRelationshipStateSet(effectiveStates.map(toSetMember)) };

  if (effectiveStates.length === 0) {
    return createCrossSignalComparisonResult({ ...base, left, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE' });
  }
  if (runtime.kind === 'EXECUTION') reject('CROSS_SIGNAL_RUNTIME_KIND_UNSUPPORTED');
  const canonicalTarget = runtime.target.canonical;
  if (canonicalTarget.state !== 'KNOWN') {
    return createCrossSignalComparisonResult({ ...base, left, right, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'RUNTIME_TARGET_NOT_PROVEN' });
  }
  const runtimeTargetObject = canonicalTarget.value.canonicalObject;
  const isMember = effectiveStates.some(state => state.target.organisationId === runtimeTargetObject.organisationId &&
    state.target.objectId === runtimeTargetObject.objectId && state.target.kind === runtimeTargetObject.kind);
  return createCrossSignalComparisonResult({ ...base, left, right, outcome: isMember ? 'CONSISTENT' : 'CONFLICT_CANDIDATE' });
}

export type CrossSignalComparisonRequest =
  | ({ readonly dimension: 'PRINCIPAL_IDENTITY'; readonly pairingMode: 'DESIGN_TIME_VS_RUNTIME' } & CrossSignalPrincipalComparisonRequest)
  | ({ readonly dimension: 'DEPENDENCY_TARGET_IDENTITY'; readonly pairingMode: 'DESIGN_TIME_VS_RUNTIME' } & CrossSignalDependencyComparisonRequest);

/**
 * Single entry point enforcing the two pre-comparison gates (ADR §4, §7.2):
 * an unsupported dimension or a requested RUNTIME_VS_RUNTIME pairing is
 * rejected before any comparison is attempted - never persisted, not even
 * as INSUFFICIENT_EVIDENCE.
 */
export function compareCrossSignal(request: unknown): CrossSignalComparisonResult {
  const r = object(request) as Record<string, unknown> & { dimension?: unknown; pairingMode?: unknown };
  if (r.pairingMode !== 'DESIGN_TIME_VS_RUNTIME') reject('CROSS_SIGNAL_PAIRING_UNSUPPORTED');
  const { dimension, pairingMode: _pairingMode, ...rest } = r;
  if (dimension === 'PRINCIPAL_IDENTITY') return comparePrincipalIdentityDesignTimeVsRuntime(rest as unknown as CrossSignalPrincipalComparisonRequest);
  if (dimension === 'DEPENDENCY_TARGET_IDENTITY') return compareDependencyTargetIdentityDesignTimeVsRuntime(rest as unknown as CrossSignalDependencyComparisonRequest);
  reject('CROSS_SIGNAL_DIMENSION_UNSUPPORTED');
}

/**
 * Deterministic comparison identity (ADR §13): a pure function of
 * (organisationId, subject, dimension, pairingMode, left, right, method) -
 * never of evaluatedAt, a database row id, or receipt order. Follows the
 * same sha256(stableCandidateContent(...)) convention as executionDigest
 * and canonicalRelationshipId elsewhere in this package.
 */
export function crossSignalComparisonIdentity(result: CrossSignalComparisonResult): string {
  const content = { organisationId: result.organisationId, subject: result.subject, dimension: result.dimension,
    pairingMode: result.pairingMode, left: result.left, right: result.right, method: result.method };
  return `cross-signal-comparison:${createHash('sha256').update(stableCandidateContent(content)).digest('hex')}`;
}
