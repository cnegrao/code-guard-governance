import { createHash } from 'node:crypto';
import {
  createCrossSignalComparisonResult, createExecutionFact, crossSignalTimestampEpochNanos, sortCrossSignalRelationshipStateSet,
  type CanonicalObjectIdentity, type CrossSignalComparisonResult, type CrossSignalDependencyRelationshipType,
  type CrossSignalEvidenceReference, type CrossSignalRelationshipStateSetMember, type CrossSignalTemporalBasis,
  type ExecutionPrincipalReference, type IsoTimestamp, type OrganisationId, type RelationshipId, type RelationshipStateId,
  type RuntimeObservation, type RuntimeTargetKind,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution';
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
/**
 * Renders a RuntimeObservation nanosecond instant (e.g. startedAtUnixNano) as
 * an exact RFC3339 timestamp, preserving up to 9 fractional digits. Unlike
 * `new Date(ms).toISOString()`, which only ever emits 3 fractional digits and
 * would silently collapse sub-millisecond precision, this reconstructs the
 * whole-second base via Date (safe: no fractional component reaches it) and
 * appends the exact sub-second nanosecond remainder as a zero-padded digit
 * string - never through float division.
 */
export function nanosToIsoTimestamp(nanos: bigint): IsoTimestamp {
  const nanosPerSecond = BigInt(1000000000);
  let wholeSeconds = nanos / nanosPerSecond;
  let remainderNanos = nanos % nanosPerSecond;
  if (remainderNanos < BigInt(0)) { remainderNanos += nanosPerSecond; wholeSeconds -= BigInt(1); }
  const base = new Date(Number(wholeSeconds) * 1000).toISOString();
  return `${base.slice(0, -5)}.${remainderNanos.toString().padStart(9, '0')}Z` as IsoTimestamp;
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

/**
 * The single frozen RuntimeObservationKind -> CrossSignalDependencyRelationshipType
 * mapping (ADR §7.1's dependency-target dimension). EXECUTION has no entry -
 * deliberately, since DEPENDENCY_TARGET_IDENTITY has no EXECUTION-shaped
 * governed relationship type to compare against. Exported so the dashboard
 * orchestration layer (M15.3B) can derive the same relationship type before
 * calling resolveDependencyGovernedStates, rather than maintaining a second,
 * divergence-prone copy of this frozen mapping.
 */
export const RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE: Readonly<Partial<Record<RuntimeObservation['kind'], CrossSignalDependencyRelationshipType>>> = {
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
  const fromNanos = crossSignalTimestampEpochNanos(validFrom);
  if (fromNanos === undefined) reject('CROSS_SIGNAL_REQUEST_INVALID');
  if (validTo !== undefined) {
    const toNanos = crossSignalTimestampEpochNanos(validTo);
    if (toNanos === undefined || toNanos <= fromNanos) reject('CROSS_SIGNAL_REQUEST_INVALID');
  }
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

/**
 * [validFrom, validTo) membership at nanosecond precision. validFrom/validTo
 * already passed validateGovernedState's own crossSignalTimestampEpochNanos
 * parse before a state ever reaches here, so `undefined` below should be
 * unreachable in practice; the reject() calls are defense-in-depth, never a
 * silent fallback to millisecond-truncated Date.parse arithmetic.
 */
function isEffectiveAt(state: { readonly validFrom: IsoTimestamp; readonly validTo?: IsoTimestamp }, eventNanos: bigint): boolean {
  const fromNanos = crossSignalTimestampEpochNanos(state.validFrom);
  if (fromNanos === undefined) reject('CROSS_SIGNAL_REQUEST_INVALID');
  if (eventNanos < fromNanos) return false;
  if (state.validTo === undefined) return true;
  const toNanos = crossSignalTimestampEpochNanos(state.validTo);
  if (toNanos === undefined) reject('CROSS_SIGNAL_REQUEST_INVALID');
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
 * Cross-language deterministic identity material for one CrossSignalComparisonResult
 * (ADR SS13). The database persistence boundary (record_cross_signal_comparison_result,
 * 20260923060000_cross_signal_persistence_v1.sql) independently re-derives this SAME
 * ordered part list from its own validated evidence lookups (the resolved
 * execution_field_states / canonical_relationships / runtime_observations rows), then
 * frames and hashes it with gov_repo.frame_identity + extensions.digest(...,'sha256') -
 * the identical pg_catalog-free algorithm this function uses. A caller-supplied
 * comparison_id is therefore never the authority on either side; it is at most a
 * consistency assertion the database independently verifies and rejects on mismatch
 * (CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH).
 *
 * Exactly (organisationId, subject, dimension, pairingMode, left, right, method) -
 * never evaluatedAt, outcome, an INSUFFICIENT_EVIDENCE reason, a database row id,
 * insertion order, or receipt order. Every part is emitted through frameIdentity's
 * length-prefixing, so no field boundary is ever ambiguous regardless of what
 * characters an opaque identifier happens to contain.
 *
 * A literal format-version tag ('CROSS_SIGNAL_COMPARISON_V1') is the first part, so
 * a future identity-material shape change is itself content-addressed distinctly
 * rather than silently colliding with this version's hashes.
 */
const CROSS_SIGNAL_IDENTITY_FORMAT_VERSION = 'CROSS_SIGNAL_COMPARISON_V1';

/**
 * One RELATIONSHIP_STATE_SET member's own identity fragment: relationshipId,
 * relationshipStateId, an explicit decisionId presence flag, and the decisionId
 * value (or an empty string when absent) - fixed arity regardless of presence, so
 * "no decisionId" can never be confused with "empty-string decisionId" or shift a
 * later field into the wrong position.
 */
function relationshipStateMemberIdentityFrame(member: CrossSignalRelationshipStateSetMember): string {
  return frameIdentity([
    member.relationshipId, member.relationshipStateId,
    member.decisionId !== undefined ? '1' : '0', member.decisionId ?? '',
  ]);
}

/**
 * Explicit canonical ordering for M15 identity purposes: lexicographic order
 * of each already-framed member string's UTF-8 BYTES - never JavaScript's
 * default Array.prototype.sort (UTF-16 code-unit order), never
 * Intl/localeCompare. UTF-16 code-unit order and UTF-8 byte order provably
 * diverge for characters outside plain ASCII (e.g. a supplementary-plane
 * character is one code point encoded as a UTF-16 surrogate PAIR, comparing
 * by its high-surrogate code unit, versus a 4-byte UTF-8 sequence compared
 * byte-by-byte from its leading byte - these are not guaranteed to agree),
 * so this repository never relies on that being an accidental equivalence.
 * PostgreSQL mirrors this exactly via `order by convert_to(member_frame,
 * 'UTF8')` (see record_cross_signal_comparison_result), so both languages
 * compare the identical byte sequence regardless of either side's default
 * collation/locale/ICU configuration. This ordering exists solely to make
 * identity order-independent of caller input order (ADR SS13) - it never
 * mutates, and is never reused for, the frozen sortCrossSignalRelationshipStateSet
 * contract-level ordering the pure comparison functions already return to callers.
 */
function compareUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function sortedRelationshipStateIdentityFrames(states: readonly CrossSignalRelationshipStateSetMember[]): readonly string[] {
  return states.map(relationshipStateMemberIdentityFrame).sort(compareUtf8Bytes);
}

function crossSignalIdentityLeftParts(left: CrossSignalEvidenceReference | undefined): readonly string[] {
  if (left === undefined) return ['LEFT_ABSENT'];
  if (left.kind === 'EXECUTION_FIELD_STATE') {
    return ['LEFT_EXECUTION_FIELD_STATE', left.executionFieldStateId, left.decisionId, left.snapshotId];
  }
  if (left.kind === 'RELATIONSHIP_STATE_SET') {
    const frames = sortedRelationshipStateIdentityFrames(left.states);
    // A present RELATIONSHIP_STATE_SET with zero members must never collide with
    // LEFT_ABSENT: the explicit kind tag plus the explicit "0" count guarantee that.
    return ['LEFT_RELATIONSHIP_STATE_SET', String(frames.length), ...frames];
  }
  throw new TypeError('CROSS_SIGNAL_IDENTITY_LEFT_KIND_INVALID');
}

function crossSignalIdentityRightParts(right: CrossSignalEvidenceReference | undefined): readonly string[] {
  if (right === undefined) return ['RIGHT_ABSENT'];
  if (right.kind === 'RUNTIME_OBSERVATION') return ['RIGHT_RUNTIME_OBSERVATION', right.observationId, right.connectionId];
  throw new TypeError('CROSS_SIGNAL_IDENTITY_RIGHT_KIND_INVALID');
}

/**
 * The full ordered, flat identity part list - exported so both the dashboard
 * persistence adapter and this package's own tests can assert against the exact
 * material the hash is computed from, independent of the hashing step itself.
 */
export function crossSignalComparisonIdentityMaterial(result: CrossSignalComparisonResult): readonly string[] {
  return [
    CROSS_SIGNAL_IDENTITY_FORMAT_VERSION,
    result.organisationId, result.subject.organisationId, result.subject.objectId, result.subject.kind,
    result.dimension, result.pairingMode, result.method.code, result.method.version,
    ...crossSignalIdentityLeftParts(result.left), ...crossSignalIdentityRightParts(result.right),
  ];
}

/**
 * Deterministic comparison identity (ADR §13): a pure function of
 * (organisationId, subject, dimension, pairingMode, left, right, method) -
 * never of evaluatedAt, a database row id, or receipt order. Uses the same
 * frameIdentity + sha256 convention as canonicalRelationshipId elsewhere in
 * this package, so the identical algorithm is trivially reproducible in SQL
 * via gov_repo.frame_identity + extensions.digest(...,'sha256') - see
 * record_cross_signal_comparison_result's own v_expected_comparison_id.
 */
export function crossSignalComparisonIdentity(result: CrossSignalComparisonResult): string {
  return `cross-signal-comparison:${createHash('sha256').update(frameIdentity(crossSignalComparisonIdentityMaterial(result))).digest('hex')}`;
}
