import 'server-only';
import {
  asIsoTimestamp, asRuntimeObservationId, asSourceConnectionId, createCrossSignalComparisonResult,
  sortCrossSignalRelationshipStateSet,
  type CrossSignalComparisonResult, type CrossSignalRelationshipStateSetMember, type IsoTimestamp, type OrganisationId,
} from '@council/canonical-contracts';
import { crossSignalComparisonIdentity, nanosToIsoTimestamp } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { executionRows } from './execution-context-read';
import { readPersistedRuntimeObservation } from './cross-signal-read';

/**
 * GOV IA M15.3A - typed persistence + readback for CrossSignalComparisonResult
 * (packages/canonical-contracts/src/cross-signal-comparison.ts).
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 * (esp. SS13, SS15). Migration: 20260923060000_cross_signal_persistence_v1.sql.
 *
 * This module confers no governance authority: it never writes
 * canonical_objects/canonical_relationships/execution_field_states/
 * runtime_observations, never assigns VALIDATED, and never invokes an LLM or
 * Graph/Vector write. RUNTIME ADMISSION != GOVERNANCE AUTHORITY.
 * OBSERVATION != GOVERNANCE AUTHORITY.
 */

export interface CrossSignalComparisonPersistenceResult {
  readonly replay: boolean;
  readonly result: CrossSignalComparisonResult;
}

const RESULT_COLUMNS = [
  'organisation_id', 'comparison_id', 'subject_object_id', 'dimension', 'pairing_mode', 'method_code', 'method_version',
  'left_kind', 'left_execution_field_state_id', 'left_execution_field_state_decision_id', 'left_execution_field_state_snapshot_id',
  'right_observation_id', 'right_connection_id', 'left_temporal_basis', 'right_temporal_basis', 'outcome', 'reason', 'evaluated_at',
].join(',');
const CHILD_COLUMNS = 'relationship_id,relationship_state_id,decision_id';
const RELATIONSHIP_COLUMNS = 'relationship_id,relationship_state_id,source_canonical_object_id,valid_from,valid_to,created_by_decision_id';

const safeErrors = new Set([
  'CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT', 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH', 'CROSS_SIGNAL_RESULT_INVALID',
  'CROSS_SIGNAL_RESULT_TENANT_MISMATCH', 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID', 'CROSS_SIGNAL_RESULT_PAIRING_INVALID',
  'CROSS_SIGNAL_RESULT_OUTCOME_INVALID', 'CROSS_SIGNAL_RESULT_DIMENSION_INVALID', 'CROSS_SIGNAL_RESULT_RIGHT_KIND_INVALID',
  'CROSS_SIGNAL_RESULT_LEFT_KIND_INVALID', 'CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND', 'CROSS_SIGNAL_PRINCIPAL_EVIDENCE_MISMATCH',
  'CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH',
]);

/**
 * Persists a CrossSignalComparisonResult atomically - parent row + every
 * RELATIONSHIP_STATE_SET child row in one transaction
 * (gov_repo.record_cross_signal_comparison_result), never as two independent
 * inserts that could leave a partial parent or partial child set.
 *
 * IDENTITY AUTHORITY (ADR SS13/SS15): the database, not this adapter, owns the
 * deterministic comparison identity. crossSignalComparisonIdentity(result) is
 * computed here only to send as a consistency ASSERTION (p_comparison_id) -
 * the RPC independently re-derives the same identity from its own validated
 * evidence lookups and fails closed with CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH
 * before returning any row if the two disagree. This adapter re-checks that
 * same equality on the RPC's response as a second, defense-in-depth guard
 * (trust but verify, mirroring persistRuntimeObservation's own re-validation
 * of an RPC's echoed-back identity elsewhere in this repository) - a
 * DB-returned comparison_id that ever differs from the independently
 * TypeScript-computed one is rejected here too, never silently used to read
 * back or report success.
 *
 * Exact replay returns the ORIGINAL durable row, revalidated through
 * readCrossSignalComparisonResult rather than trusted from the RPC's own
 * echo, with its original evaluatedAt preserved. A replay whose semantic
 * content differs from the stored row fails closed (the RPC raises
 * CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT, surfaced here unchanged).
 */
export async function persistCrossSignalComparisonResult(result: CrossSignalComparisonResult): Promise<CrossSignalComparisonPersistenceResult> {
  const comparisonId = crossSignalComparisonIdentity(result);
  // ONE authoritative transport representation for RELATIONSHIP_STATE_SET
  // evidence: result (as p_result) alone. There is no second parameter that
  // could ever disagree with p_result.left.states - the RPC derives its own
  // relationship-state input exclusively from p_result#>'{left,states}'.
  let response;
  try {
    response = await privilegedDb.rpc('record_cross_signal_comparison_result', {
      p_organisation_id: result.organisationId,
      p_comparison_id: comparisonId,
      p_result: result,
    });
  } catch { throw new Error('CROSS_SIGNAL_COMPARISON_PERSISTENCE_FAILED'); }
  const { data, error } = response;
  if (error) throw new Error(safeErrors.has(error.message) ? error.message : 'CROSS_SIGNAL_COMPARISON_PERSISTENCE_FAILED');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.replay !== 'boolean' || typeof row.comparison_id !== 'string') throw new Error('CROSS_SIGNAL_COMPARISON_WRITE_INVALID');
  // The RPC itself already fails closed on this mismatch before ever
  // returning a row (see the migration's own p_comparison_id assertion
  // check), so this is expected to be unreachable in practice - it exists so
  // this adapter never trusts a future/alternate persistence implementation's
  // returned identity merely because a call succeeded.
  if (row.comparison_id !== comparisonId) throw new Error('CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH');
  const persisted = await readCrossSignalComparisonResult(result.organisationId, row.comparison_id);
  if (!persisted) throw new Error('CROSS_SIGNAL_COMPARISON_READBACK_INVALID');
  return Object.freeze({ replay: row.replay as boolean, result: persisted });
}

/**
 * Typed readback (ADR SS15's read model): rehydrates one persisted
 * CrossSignalComparisonResult through the canonical M15 contract
 * (createCrossSignalComparisonResult) - a persisted row is never trusted
 * merely because it came from the database. Every referenced evidence id is
 * independently re-resolved and cross-checked against its own
 * source-of-truth table (execution_field_states / canonical_relationships /
 * the runtime read boundary) before being accepted. No SELECT *, no
 * arbitrary JSON/EAV escape hatch: every column is explicit.
 */
export async function readCrossSignalComparisonResult(
  organisationId: OrganisationId, comparisonId: string,
): Promise<CrossSignalComparisonResult | undefined> {
  const { data, error } = await privilegedDb.from('cross_signal_comparison_results')
    .select(RESULT_COLUMNS)
    .eq('organisation_id', organisationId)
    .eq('comparison_id', comparisonId)
    .maybeSingle();
  if (error) throw new Error('CROSS_SIGNAL_COMPARISON_READ_FAILED');
  if (!data) return undefined;
  const row = data as Record<string, any>;
  if (row.organisation_id !== organisationId || row.comparison_id !== comparisonId) throw new Error('CROSS_SIGNAL_COMPARISON_TENANT_MISMATCH');

  let left: Record<string, unknown> | undefined;
  if (row.left_kind === 'EXECUTION_FIELD_STATE') {
    const states = await executionRows(organisationId, 'execution_field_states', { state_id: row.left_execution_field_state_id });
    const efs = states[0];
    if (states.length !== 1 || efs.canonical_object_id !== row.subject_object_id || efs.field_key !== 'PRINCIPAL' ||
      efs.decision_id !== row.left_execution_field_state_decision_id || efs.snapshot_id !== row.left_execution_field_state_snapshot_id) {
      throw new Error('CROSS_SIGNAL_COMPARISON_EVIDENCE_INVALID');
    }
    left = { kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: row.left_execution_field_state_id,
      decisionId: row.left_execution_field_state_decision_id, snapshotId: row.left_execution_field_state_snapshot_id };
  } else if (row.left_kind === 'RELATIONSHIP_STATE_SET') {
    const { data: childRows, error: childError } = await privilegedDb.from('cross_signal_comparison_left_relationship_states')
      .select(CHILD_COLUMNS).eq('organisation_id', organisationId).eq('comparison_id', comparisonId);
    if (childError) throw new Error('CROSS_SIGNAL_COMPARISON_READ_FAILED');
    const children = (childRows ?? []) as Array<Record<string, any>>;
    const states: CrossSignalRelationshipStateSetMember[] = [];
    for (const child of children) {
      if (child.organisation_id !== undefined && child.organisation_id !== organisationId) throw new Error('CROSS_SIGNAL_COMPARISON_TENANT_MISMATCH');
      const { data: relData, error: relError } = await privilegedDb.from('canonical_relationships')
        .select(RELATIONSHIP_COLUMNS).eq('organisation_id', organisationId).eq('relationship_id', child.relationship_id);
      if (relError) throw new Error('CROSS_SIGNAL_COMPARISON_READ_FAILED');
      const rel = (relData ?? [])[0] as Record<string, any> | undefined;
      if (!rel || rel.relationship_state_id !== child.relationship_state_id || rel.source_canonical_object_id !== row.subject_object_id ||
        (child.decision_id !== null && rel.created_by_decision_id !== child.decision_id)) {
        throw new Error('CROSS_SIGNAL_COMPARISON_EVIDENCE_INVALID');
      }
      states.push({
        relationshipId: child.relationship_id, relationshipStateId: child.relationship_state_id,
        ...(child.decision_id ? { decisionId: child.decision_id } : {}),
        validFrom: asIsoTimestamp(rel.valid_from), ...(rel.valid_to ? { validTo: asIsoTimestamp(rel.valid_to) } : {}),
      } as CrossSignalRelationshipStateSetMember);
    }
    left = { kind: 'RELATIONSHIP_STATE_SET', states: sortCrossSignalRelationshipStateSet(states) };
  } else if (row.left_kind !== null) {
    throw new Error('CROSS_SIGNAL_COMPARISON_EVIDENCE_INVALID');
  }

  let right: Record<string, unknown> | undefined;
  let rightTemporalBasis: { readonly basis: string; readonly value?: IsoTimestamp } = { basis: row.right_temporal_basis };
  if (row.right_observation_id !== null && row.right_observation_id !== undefined) {
    const observation = await readPersistedRuntimeObservation(organisationId, {
      observationId: asRuntimeObservationId(row.right_observation_id),
      connectionId: asSourceConnectionId(row.right_connection_id),
    });
    right = { kind: 'RUNTIME_OBSERVATION', observationId: observation.observationId, connectionId: observation.sourceConnection.connectionId };
    if (row.right_temporal_basis === 'RUNTIME_EVENT_TIME') {
      rightTemporalBasis = { basis: 'RUNTIME_EVENT_TIME', value: nanosToIsoTimestamp(BigInt(observation.startedAtUnixNano)) };
    }
  }

  if (typeof row.evaluated_at !== 'string') throw new Error('CROSS_SIGNAL_COMPARISON_READ_FAILED');
  const result = createCrossSignalComparisonResult({
    organisationId,
    subject: { organisationId, objectId: row.subject_object_id, kind: 'AGENT_VERSION' },
    dimension: row.dimension,
    pairingMode: row.pairing_mode,
    ...(left !== undefined ? { left } : {}),
    ...(right !== undefined ? { right } : {}),
    method: { code: row.method_code, version: row.method_version },
    leftTemporalBasis: { basis: row.left_temporal_basis },
    rightTemporalBasis,
    // The raw trusted PostgREST timestamptz string, never round-tripped
    // through `new Date(...).toISOString()` - that collapses PostgreSQL's
    // fractional-second precision to JavaScript's fixed 3-digit millisecond
    // precision. evaluatedAt is comparison clock E (never a temporal-basis
    // or identity input, ADR §12.E), but there is no reason to destroy
    // durable precision on the one field this adapter does still surface.
    evaluatedAt: asIsoTimestamp(row.evaluated_at),
    outcome: row.outcome,
    ...(row.reason ? { reason: row.reason } : {}),
  });

  // Readback must verify its own deterministic identity (ADR §13): a
  // persisted row is never trusted merely because it rehydrated
  // structurally without error. Recompute the identity from the rehydrated,
  // fully-revalidated semantic result and require exact equality with both
  // the row's own stored key and the caller's requested comparisonId -
  // protecting against corrupted/manually-edited durable state where the
  // stored evidence references or child set no longer correspond to the key
  // they are filed under.
  const rehydratedIdentity = crossSignalComparisonIdentity(result);
  if (rehydratedIdentity !== row.comparison_id || rehydratedIdentity !== comparisonId) {
    throw new Error('CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH');
  }
  return result;
}
