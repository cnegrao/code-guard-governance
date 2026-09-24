import 'server-only';
import {
  asIsoTimestamp,
  type IsoTimestamp, type OrganisationId, type RuntimeObservationId, type SourceConnectionId,
} from '@council/canonical-contracts';
import {
  RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE,
  compareDependencyTargetIdentityDesignTimeVsRuntime, comparePrincipalIdentityDesignTimeVsRuntime,
} from '@council/governance-review';
import {
  assertRuntimeSubjectProven, readPersistedRuntimeObservation, resolveDependencyGovernedStates,
  resolvePrincipalDesignTimeBaseline, resolveTrustedAgentVersionSubject,
} from './cross-signal-read';
import { persistCrossSignalComparisonResult, type CrossSignalComparisonPersistenceResult } from './cross-signal-persistence';

/**
 * GOV IA M15.3B - Cross-Signal Orchestration V1.
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 *
 * Narrow application-level composition ONLY:
 *   trusted subject/runtime inputs -> exact read adapters (cross-signal-read.ts)
 *   -> pure comparison (governance-review/cross-signal-comparison.ts)
 *   -> typed persistence (cross-signal-persistence.ts).
 *
 * No comparison rule is duplicated here. No evidence is guessed. A request that
 * cannot be legitimately formed into a comparison (missing/ambiguous subject,
 * unsupported dimension/pairing, an unsupported runtime kind for the requested
 * dimension) is rejected BEFORE any read of design-time/runtime evidence beyond
 * what is needed to make that determination, and BEFORE persistence is ever
 * attempted - it is a pre-comparison rejection, never a persisted
 * INSUFFICIENT_EVIDENCE row (ADR §4, §7.2, §18 case D).
 *
 * This module writes nothing except through persistCrossSignalComparisonResult's
 * single accepted boundary. It never writes canonical_objects,
 * canonical_relationships, execution_field_states or runtime_observations,
 * never assigns VALIDATED, never promotes trust, and calls no Graph/Vector/LLM
 * path (ADR §9).
 */

type CrossSignalOrchestrationRejectionCode =
  | 'CROSS_SIGNAL_ORCHESTRATION_REQUEST_INVALID'
  | 'CROSS_SIGNAL_ORCHESTRATION_PAIRING_UNSUPPORTED'
  | 'CROSS_SIGNAL_ORCHESTRATION_DIMENSION_UNSUPPORTED'
  | 'CROSS_SIGNAL_ORCHESTRATION_SUBJECT_NOT_FOUND'
  | 'CROSS_SIGNAL_ORCHESTRATION_RUNTIME_KIND_UNSUPPORTED';
function reject(code: CrossSignalOrchestrationRejectionCode): never { throw new TypeError(code); }

// -----------------------------------------------------------------------------
// E. Trusted evaluation clock (ADR §12.E) - the orchestration layer is the
// trusted server boundary that assigns comparison clock E. It is never
// accepted from a browser/client caller.
// -----------------------------------------------------------------------------

export interface CrossSignalEvaluationClock {
  now(): IsoTimestamp;
}

/** Production clock: real server time, assigned once per newly attempted comparison. */
export const systemCrossSignalEvaluationClock: CrossSignalEvaluationClock = {
  now: () => asIsoTimestamp(new Date().toISOString()),
};

/** Deterministic test clock: always returns the same fixed instant. */
export function fixedCrossSignalEvaluationClock(value: IsoTimestamp): CrossSignalEvaluationClock {
  return Object.freeze({ now: () => value });
}

/**
 * Deterministic test clock that returns each queued instant once, in order,
 * then throws - useful for proving that a SECOND orchestration attempt (e.g.
 * an exact replay) may observe a later server evaluatedAt before persistence,
 * without that later attempted time ever reaching the durable row (ADR §12.E,
 * §F "exact replay").
 */
export function queuedCrossSignalEvaluationClock(values: readonly IsoTimestamp[]): CrossSignalEvaluationClock {
  const queue = [...values];
  return Object.freeze({
    now: () => {
      const next = queue.shift();
      if (next === undefined) reject('CROSS_SIGNAL_ORCHESTRATION_REQUEST_INVALID');
      return next;
    },
  });
}

export interface CrossSignalRuntimeObservationLocator {
  readonly observationId: RuntimeObservationId;
  readonly connectionId: SourceConnectionId;
}

// -----------------------------------------------------------------------------
// B. PRINCIPAL_IDENTITY orchestration flow (ADR §7.1, ADR-implementation task §B)
// -----------------------------------------------------------------------------

export interface CrossSignalPrincipalOrchestrationRequest {
  readonly organisationId: OrganisationId;
  /** The exact AGENT_VERSION canonical_object_id for this tenant - never a candidate/proposal id. */
  readonly subjectObjectId: string;
  readonly runtimeObservation: CrossSignalRuntimeObservationLocator;
}

/**
 * PRINCIPAL_IDENTITY x DESIGN_TIME_VS_RUNTIME (ADR §7.1). Stages, in order:
 *   1. resolve exact trusted AGENT_VERSION subject;
 *   2. read exact RuntimeObservation by (organisationId, observationId, connectionId);
 *   3. independently prove the runtime subject when binding is EXACT
 *      (a no-op for UNRESOLVED - that stays the pure comparator's own
 *      RUNTIME_BINDING_UNRESOLVED / INSUFFICIENT_EVIDENCE responsibility);
 *   4. read the exact current governed PRINCIPAL baseline (may be absent -
 *      that stays the pure comparator's own DESIGN_TIME_BASELINE_MISSING
 *      responsibility, never an orchestration failure);
 *   5. call the pure comparison, with a server-assigned evaluatedAt;
 *   6. persist the returned result through the single accepted boundary;
 *   7. return the durable persisted result (original evaluatedAt on replay).
 *
 * A missing/ambiguous SUBJECT is different from missing evidence: it means no
 * legitimate comparison can even be formed, so it is a pre-comparison
 * rejection (never persisted), thrown before any RuntimeObservation or
 * PRINCIPAL baseline is read.
 */
export async function orchestratePrincipalIdentityComparison(
  request: CrossSignalPrincipalOrchestrationRequest,
  clock: CrossSignalEvaluationClock = systemCrossSignalEvaluationClock,
): Promise<CrossSignalComparisonPersistenceResult> {
  const { organisationId } = request;

  const subject = await resolveTrustedAgentVersionSubject(organisationId, request.subjectObjectId);
  if (!subject) reject('CROSS_SIGNAL_ORCHESTRATION_SUBJECT_NOT_FOUND');

  const runtime = await readPersistedRuntimeObservation(organisationId, request.runtimeObservation);
  await assertRuntimeSubjectProven(organisationId, runtime);

  const designTime = await resolvePrincipalDesignTimeBaseline(organisationId, subject);

  const comparison = comparePrincipalIdentityDesignTimeVsRuntime({
    organisationId, subject, ...(designTime ? { designTime } : {}), runtime, evaluatedAt: clock.now(),
  });

  return persistCrossSignalComparisonResult(comparison);
}

// -----------------------------------------------------------------------------
// C. DEPENDENCY_TARGET_IDENTITY orchestration flow (ADR §7.1, ADR-implementation task §C)
// -----------------------------------------------------------------------------

export interface CrossSignalDependencyOrchestrationRequest {
  readonly organisationId: OrganisationId;
  /** The exact AGENT_VERSION canonical_object_id for this tenant - never a candidate/proposal id. */
  readonly subjectObjectId: string;
  readonly runtimeObservation: CrossSignalRuntimeObservationLocator;
}

/**
 * DEPENDENCY_TARGET_IDENTITY x DESIGN_TIME_VS_RUNTIME (ADR §7.1). Stages:
 *   1. resolve exact trusted AGENT_VERSION subject;
 *   2. read exact RuntimeObservation;
 *   3. independently prove the runtime subject when binding is EXACT;
 *   4. derive ONLY the relationship type the frozen runtime-kind mapping
 *      allows (RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE, reused as the
 *      one source of truth from governance-review rather than a second
 *      copy). EXECUTION - and any future unmapped kind - has no entry and is
 *      rejected here, BEFORE resolveDependencyGovernedStates or the pure
 *      comparator ever run, so it can never reach persistence;
 *   5. read ALL relevant governed relationship states for
 *      tenant + exact subject + that relationship type, unfiltered by
 *      validFrom/validTo - the pure comparator alone owns the exact
 *      nanosecond [validFrom, validTo) effective-set resolution;
 *   6. call the pure comparison, with a server-assigned evaluatedAt;
 *   7. persist the returned result;
 *   8. return the durable persisted result.
 */
export async function orchestrateDependencyTargetIdentityComparison(
  request: CrossSignalDependencyOrchestrationRequest,
  clock: CrossSignalEvaluationClock = systemCrossSignalEvaluationClock,
): Promise<CrossSignalComparisonPersistenceResult> {
  const { organisationId } = request;

  const subject = await resolveTrustedAgentVersionSubject(organisationId, request.subjectObjectId);
  if (!subject) reject('CROSS_SIGNAL_ORCHESTRATION_SUBJECT_NOT_FOUND');

  const runtime = await readPersistedRuntimeObservation(organisationId, request.runtimeObservation);
  await assertRuntimeSubjectProven(organisationId, runtime);

  const relationshipType = RUNTIME_KIND_TO_DEPENDENCY_RELATIONSHIP_TYPE[runtime.kind];
  if (!relationshipType) reject('CROSS_SIGNAL_ORCHESTRATION_RUNTIME_KIND_UNSUPPORTED');

  const governedStates = await resolveDependencyGovernedStates(organisationId, subject, relationshipType);

  const comparison = compareDependencyTargetIdentityDesignTimeVsRuntime({
    organisationId, subject, governedStates, runtime, evaluatedAt: clock.now(),
  });

  return persistCrossSignalComparisonResult(comparison);
}

// -----------------------------------------------------------------------------
// Single closed discriminated entry point (alternative to calling the two
// dimension-specific functions above directly). Gates on pairingMode/dimension
// BEFORE either flow runs a single read, so RUNTIME_VS_RUNTIME and any
// unsupported dimension are rejected pre-comparison with no evidence read at
// all - never persisted, not even as INSUFFICIENT_EVIDENCE (ADR §4, §7.2).
// -----------------------------------------------------------------------------

export type CrossSignalOrchestrationRequest =
  | ({ readonly dimension: 'PRINCIPAL_IDENTITY'; readonly pairingMode: 'DESIGN_TIME_VS_RUNTIME' } & CrossSignalPrincipalOrchestrationRequest)
  | ({ readonly dimension: 'DEPENDENCY_TARGET_IDENTITY'; readonly pairingMode: 'DESIGN_TIME_VS_RUNTIME' } & CrossSignalDependencyOrchestrationRequest);

export async function orchestrateCrossSignalComparison(
  request: unknown,
  clock: CrossSignalEvaluationClock = systemCrossSignalEvaluationClock,
): Promise<CrossSignalComparisonPersistenceResult> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) reject('CROSS_SIGNAL_ORCHESTRATION_REQUEST_INVALID');
  const r = request as Record<string, unknown>;
  if (r.pairingMode !== 'DESIGN_TIME_VS_RUNTIME') reject('CROSS_SIGNAL_ORCHESTRATION_PAIRING_UNSUPPORTED');
  if (r.dimension === 'PRINCIPAL_IDENTITY') {
    return orchestratePrincipalIdentityComparison(request as unknown as CrossSignalPrincipalOrchestrationRequest, clock);
  }
  if (r.dimension === 'DEPENDENCY_TARGET_IDENTITY') {
    return orchestrateDependencyTargetIdentityComparison(request as unknown as CrossSignalDependencyOrchestrationRequest, clock);
  }
  reject('CROSS_SIGNAL_ORCHESTRATION_DIMENSION_UNSUPPORTED');
}
