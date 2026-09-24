import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, mock, test } from 'node:test';
import {
  asCanonicalObjectId, asIsoTimestamp, asOrganisationId, asRelationshipId, asRelationshipStateId, createCrossSignalComparisonResult,
  sortCrossSignalRelationshipStateSet, type CanonicalObjectIdentity, type CrossSignalComparisonResult,
} from '@council/canonical-contracts';
import { crossSignalComparisonIdentity } from '@council/governance-review';
import { fixture } from './helpers/runtime-fixtures';
import { runtimeToRow } from '../lib/governance/runtime-row';

// Reuses runtime-fixtures.ts's own baked-in organisationId/connectionId/observationId
// (as cross-signal-read.test.ts already does) so `right` evidence resolves through
// the SAME read_runtime_observation_exact RPC mock as the read-boundary tests.
const observation = fixture('MODEL_CALL');
const org = observation.organisationId;
const foreign = asOrganisationId('22222222-2222-2222-2222-222222222222');
const subjectId = 'agent-version-1';
const subject: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: org, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT_VERSION' };
const rightRef = { observationId: observation.observationId, connectionId: observation.sourceConnection.connectionId };

type Row = Record<string, any>;
let tables: Record<string, Row[]>;

function sortedChildContent(states: readonly { relationshipId: string; relationshipStateId: string; decisionId?: string }[]) {
  return [...states].sort((a, b) => a.relationshipStateId.localeCompare(b.relationshipStateId))
    .map(s => ({ relationshipId: s.relationshipId, relationshipStateId: s.relationshipStateId, decisionId: s.decisionId ?? null }));
}

/**
 * A JS-side emulation of gov_repo.record_cross_signal_comparison_result
 * (20260923060000_cross_signal_persistence_v1.sql), faithful enough to
 * exercise the TS adapter's atomicity/replay/tenancy/evidence-reuse
 * contract without a real Postgres connection (M15.3A is not authorized to
 * touch a hosted database). The SQL migration's own structural correctness
 * (grants, CHECK constraints, insert targets) is verified separately in
 * cross-signal-persistence-migration.test.ts.
 */
const M15_DEPENDENCY_RELATIONSHIP_TYPES = ['USES_MODEL', 'USES_TOOL', 'USES_MCP', 'INVOKES'];
const RUNTIME_KIND_TO_DEPENDENCY_TYPE: Record<string, string> = { MODEL_CALL: 'USES_MODEL', TOOL_CALL: 'USES_TOOL', MCP_CALL: 'USES_MCP', API_CALL: 'INVOKES' };

function recordComparisonResult(params: { p_organisation_id: string; p_comparison_id: string | null; p_result: any }) {
  const { p_organisation_id: organisationId, p_comparison_id: assertedComparisonId, p_result: result } = params;
  if (result.organisationId !== organisationId) return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_TENANT_MISMATCH' } };
  if (result.subject?.organisationId !== organisationId || result.subject?.kind !== 'AGENT_VERSION') {
    return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID' } };
  }
  // Independently prove the persisted canonical object's ACTUAL kind is
  // AGENT_VERSION - never trust the caller's subject.kind string alone.
  const canonicalObject = (tables.canonical_objects ?? []).find(row =>
    row.organisation_id === organisationId && row.canonical_object_id === result.subject.objectId);
  if (!canonicalObject || canonicalObject.kind !== 'AGENT_VERSION') {
    return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID' } };
  }
  if (result.outcome === 'DRIFT_CANDIDATE') return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_OUTCOME_INVALID' } };

  // ONE authoritative transport representation for RELATIONSHIP_STATE_SET
  // evidence: result.left.states only - there is no second parameter.
  const states = result.left?.kind === 'RELATIONSHIP_STATE_SET'
    ? result.left.states.map((s: any) => ({ relationshipId: s.relationshipId, relationshipStateId: s.relationshipStateId, decisionId: s.decisionId ?? null }))
    : [];

  let expectedRelationshipType: string | undefined;
  try {
    if (result.right) {
      const runtimeRowMatch = (tables.runtime_observations ?? []).find(row =>
        row.organisation_id === organisationId && row.observation_id === result.right.observationId && row.connection_id === result.right.connectionId);
      if (!runtimeRowMatch) throw new Error('CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND');
      expectedRelationshipType = RUNTIME_KIND_TO_DEPENDENCY_TYPE[runtimeRowMatch.kind];
    }
    if (result.left?.kind === 'EXECUTION_FIELD_STATE') {
      const efs = (tables.execution_field_states ?? []).find(row => row.organisation_id === organisationId && row.state_id === result.left.executionFieldStateId);
      if (!efs || efs.canonical_object_id !== result.subject.objectId || efs.field_key !== 'PRINCIPAL' ||
        efs.decision_id !== result.left.decisionId || efs.snapshot_id !== result.left.snapshotId) {
        throw new Error('CROSS_SIGNAL_PRINCIPAL_EVIDENCE_MISMATCH');
      }
    } else if (result.left?.kind === 'RELATIONSHIP_STATE_SET') {
      for (const member of states) {
        const rel = (tables.canonical_relationships ?? []).find(row => row.organisation_id === organisationId && row.relationship_id === member.relationshipId);
        if (!rel || rel.relationship_state_id !== member.relationshipStateId || rel.source_canonical_object_id !== result.subject.objectId ||
          rel.source_kind !== 'AGENT_VERSION' ||
          !M15_DEPENDENCY_RELATIONSHIP_TYPES.includes(rel.relationship_type) ||
          (expectedRelationshipType !== undefined && rel.relationship_type !== expectedRelationshipType) ||
          (member.decisionId && rel.created_by_decision_id !== member.decisionId)) {
          throw new Error('CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH');
        }
      }
    }
  } catch (e) { return { data: null, error: { message: (e as Error).message } }; }

  // DATABASE-AUTHORITATIVE IDENTITY (ADR §13/§15): derived independently from
  // the already-verified evidence above, never trusted from the caller's
  // p_comparison_id. Reuses crossSignalComparisonIdentity as the oracle for
  // what the real SQL algorithm (gov_repo.frame_identity + extensions.digest)
  // must also compute for the same content - the real migration's own exact
  // framing/sorting/hashing is verified independently in
  // cross-signal-persistence-migration.test.ts and in governance-review's
  // known-vector test. A supplied p_comparison_id is at most a consistency
  // assertion: a mismatch fails closed before any row is read or written.
  const expectedComparisonId = crossSignalComparisonIdentity(result);
  if (assertedComparisonId != null && assertedComparisonId !== expectedComparisonId) {
    return { data: null, error: { message: 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH' } };
  }

  const existing = (tables.cross_signal_comparison_results ?? []).find(row => row.organisation_id === organisationId && row.comparison_id === expectedComparisonId);
  const newStates = sortedChildContent(states ?? []);
  if (existing) {
    const existingChildren = (tables.cross_signal_comparison_left_relationship_states ?? [])
      .filter(row => row.organisation_id === organisationId && row.comparison_id === expectedComparisonId)
      .map(row => ({ relationshipId: row.relationship_id, relationshipStateId: row.relationship_state_id, decisionId: row.decision_id }));
    const sortedExisting = sortedChildContent(existingChildren);
    const mismatch =
      existing.dimension !== result.dimension || existing.pairing_mode !== result.pairingMode ||
      existing.subject_object_id !== result.subject.objectId ||
      existing.method_code !== result.method.code || existing.method_version !== result.method.version ||
      existing.outcome !== result.outcome || (existing.reason ?? null) !== (result.reason ?? null) ||
      (existing.left_kind ?? null) !== (result.left?.kind ?? null) ||
      (existing.left_execution_field_state_id ?? null) !== (result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.executionFieldStateId : null) ||
      (existing.left_execution_field_state_decision_id ?? null) !== (result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.decisionId : null) ||
      (existing.left_execution_field_state_snapshot_id ?? null) !== (result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.snapshotId : null) ||
      (existing.right_observation_id ?? null) !== (result.right?.observationId ?? null) ||
      (existing.right_connection_id ?? null) !== (result.right?.connectionId ?? null) ||
      existing.left_temporal_basis !== result.leftTemporalBasis.basis ||
      existing.right_temporal_basis !== result.rightTemporalBasis.basis ||
      JSON.stringify(sortedExisting) !== JSON.stringify(newStates);
    if (mismatch) return { data: null, error: { message: 'CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT' } };
    return { data: [{ replay: true, comparison_id: expectedComparisonId, evaluated_at: existing.evaluated_at }], error: null };
  }

  const row: Row = {
    organisation_id: organisationId, comparison_id: expectedComparisonId, subject_object_id: result.subject.objectId,
    dimension: result.dimension, pairing_mode: result.pairingMode, method_code: result.method.code, method_version: result.method.version,
    left_kind: result.left?.kind ?? null,
    left_execution_field_state_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.executionFieldStateId : null,
    left_execution_field_state_decision_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.decisionId : null,
    left_execution_field_state_snapshot_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.snapshotId : null,
    right_observation_id: result.right?.observationId ?? null,
    right_connection_id: result.right?.connectionId ?? null,
    left_temporal_basis: result.leftTemporalBasis.basis,
    right_temporal_basis: result.rightTemporalBasis.basis,
    outcome: result.outcome, reason: result.reason ?? null,
    evaluated_at: result.evaluatedAt,
  };
  tables.cross_signal_comparison_results = [...(tables.cross_signal_comparison_results ?? []), row];
  if (result.left?.kind === 'RELATIONSHIP_STATE_SET') {
    tables.cross_signal_comparison_left_relationship_states = [
      ...(tables.cross_signal_comparison_left_relationship_states ?? []),
      ...result.left.states.map((s: any) => ({ organisation_id: organisationId, comparison_id: expectedComparisonId, relationship_id: s.relationshipId, relationship_state_id: s.relationshipStateId, decision_id: s.decisionId ?? null })),
    ];
  }
  return { data: [{ replay: false, comparison_id: expectedComparisonId, evaluated_at: row.evaluated_at }], error: null };
}

const db = {
  from(table: string) {
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      order() { return query; },
      range() { return Promise.resolve({ data: rows(), error: null }); },
      maybeSingle() { const r = rows(); return Promise.resolve({ data: r[0] ?? null, error: null }); },
      then(resolve: any, reject: any) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
    };
    return query;
  },
  rpc(name: string, params: Record<string, any>) {
    if (name === 'read_runtime_observation_exact') {
      const match = (tables.runtime_observations ?? []).filter(row =>
        row.organisation_id === params.p_organisation_id &&
        row.observation_id === params.p_observation_id &&
        row.connection_id === params.p_connection_id);
      return Promise.resolve({ data: match.map(row => ({ observation: row })), error: null });
    }
    if (name === 'record_cross_signal_comparison_result') return Promise.resolve(recordComparisonResult(params as any));
    return Promise.resolve({ data: null, error: { message: 'UNKNOWN_RPC' } });
  },
};

let mod: typeof import('../lib/governance/cross-signal-persistence');
before(async () => {
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: db } });
  mod = await import('../lib/governance/cross-signal-persistence');
});
beforeEach(() => {
  tables = {
    canonical_objects: [{ organisation_id: org, canonical_object_id: subjectId, kind: 'AGENT_VERSION' }],
    execution_field_states: [], canonical_relationships: [], runtime_observations: [{ ...runtimeRow() }],
    cross_signal_comparison_results: [], cross_signal_comparison_left_relationship_states: [],
  };
});

function runtimeRow() {
  return { organisation_id: org, observation_id: observation.observationId, connection_id: observation.sourceConnection.connectionId, ...runtimeToRow(observation), recorded_at: '2026-09-17T00:00:00.000000+00:00' };
}

function principalEfs(overrides: Row = {}) {
  return { organisation_id: org, state_id: 'efs-1', canonical_object_id: subjectId, field_key: 'PRINCIPAL',
    decision_id: 'decision-1', snapshot_id: 'snapshot-1', previous_state_id: null, recorded_at: '2026-09-15T00:00:00.000Z', ...overrides };
}
function relationshipRow(overrides: Row = {}) {
  // relationship_type defaults to USES_MODEL to match rightRef's MODEL_CALL
  // runtime fixture, satisfying the new runtime-kind -> relationship_type
  // cross-check the write RPC performs when a paired RuntimeObservation is available.
  return { organisation_id: org, relationship_id: 'rel-1', relationship_state_id: 'rel-1:initial', source_canonical_object_id: subjectId,
    source_kind: 'AGENT_VERSION', relationship_type: 'USES_MODEL',
    valid_from: '2026-09-01T00:00:00.123456+00:00', valid_to: null, created_by_decision_id: 'decision-rel-1', ...overrides };
}

function principalResult(overrides: { executionFieldStateId?: string; decisionId?: string; snapshotId?: string; outcome?: 'CONSISTENT' | 'CONFLICT_CANDIDATE' | 'INSUFFICIENT_EVIDENCE'; reason?: string; evaluatedAt?: string } = {}): CrossSignalComparisonResult {
  return createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    left: { kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: overrides.executionFieldStateId ?? 'efs-1', decisionId: overrides.decisionId ?? 'decision-1', snapshotId: overrides.snapshotId ?? 'snapshot-1' },
    right: { kind: 'RUNTIME_OBSERVATION', observationId: rightRef.observationId, connectionId: rightRef.connectionId },
    method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' },
    rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp(overrides.evaluatedAt ?? '2026-09-20T00:05:00.000Z'),
    outcome: overrides.outcome ?? 'CONSISTENT',
    ...(overrides.reason ? { reason: overrides.reason } : {}),
  });
}

function dependencyResult(states: readonly { relationshipId: string; relationshipStateId: string; decisionId?: string; validFrom: string; validTo?: string }[], opts: { outcome?: 'CONSISTENT' | 'CONFLICT_CANDIDATE' | 'INSUFFICIENT_EVIDENCE'; reason?: string; evaluatedAt?: string } = {}): CrossSignalComparisonResult {
  return createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'DEPENDENCY_TARGET_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    left: { kind: 'RELATIONSHIP_STATE_SET', states: sortCrossSignalRelationshipStateSet(states.map(s => ({
      relationshipId: asRelationshipId(s.relationshipId), relationshipStateId: asRelationshipStateId(s.relationshipStateId),
      ...(s.decisionId ? { decisionId: s.decisionId } : {}), validFrom: asIsoTimestamp(s.validFrom), ...(s.validTo ? { validTo: asIsoTimestamp(s.validTo) } : {}),
    }))) },
    right: { kind: 'RUNTIME_OBSERVATION', observationId: rightRef.observationId, connectionId: rightRef.connectionId },
    method: { code: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'RELATIONSHIP_VALID_FROM_TO_SET' },
    rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp(opts.evaluatedAt ?? '2026-09-20T00:05:00.000Z'),
    outcome: opts.outcome ?? 'CONSISTENT',
    ...(opts.reason ? { reason: opts.reason } : {}),
  });
}

// -----------------------------------------------------------------------------
// 1. First persistence + principal exact state / runtime exact observation evidence
// -----------------------------------------------------------------------------

test('1. exact first persistence of a PRINCIPAL_IDENTITY comparison', async () => {
  tables.execution_field_states = [principalEfs()];
  const result = principalResult();
  const persisted = await mod.persistCrossSignalComparisonResult(result);
  assert.equal(persisted.replay, false);
  assert.equal(persisted.result.outcome, 'CONSISTENT');
  assert.equal((persisted.result.left as any).executionFieldStateId, 'efs-1');
  assert.equal((persisted.result.right as any).observationId, rightRef.observationId);
  assert.equal((persisted.result.right as any).connectionId, rightRef.connectionId);
  assert.equal(tables.cross_signal_comparison_results.length, 1);
});

test('2. exact replay returns the original durable result, including original evaluatedAt', async () => {
  tables.execution_field_states = [principalEfs()];
  const first = await mod.persistCrossSignalComparisonResult(principalResult({ evaluatedAt: '2026-09-20T00:05:00.000Z' }));
  assert.equal(first.replay, false);
  const replay = await mod.persistCrossSignalComparisonResult(principalResult({ evaluatedAt: '2026-09-21T00:00:00.000Z' }));
  assert.equal(replay.replay, true);
  assert.equal(replay.result.evaluatedAt, first.result.evaluatedAt);
  assert.equal(tables.cross_signal_comparison_results.length, 1);
});

test('3. conflicting replay (same identity, different outcome) fails closed', async () => {
  tables.execution_field_states = [principalEfs()];
  await mod.persistCrossSignalComparisonResult(principalResult({ outcome: 'CONSISTENT' }));
  await assert.rejects(
    mod.persistCrossSignalComparisonResult(principalResult({ outcome: 'CONFLICT_CANDIDATE' })),
    /CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT/,
  );
  // The original row must remain untouched - no partial overwrite.
  assert.equal(tables.cross_signal_comparison_results.length, 1);
  assert.equal(tables.cross_signal_comparison_results[0].outcome, 'CONSISTENT');
});

test('4. changed evidence produces a new, additional comparison', async () => {
  tables.execution_field_states = [principalEfs(), principalEfs({ state_id: 'efs-2', decision_id: 'decision-2', snapshot_id: 'snapshot-2' })];
  const first = await mod.persistCrossSignalComparisonResult(principalResult({ executionFieldStateId: 'efs-1' }));
  const second = await mod.persistCrossSignalComparisonResult(principalResult({ executionFieldStateId: 'efs-2', decisionId: 'decision-2', snapshotId: 'snapshot-2' }));
  assert.equal(first.replay, false);
  assert.equal(second.replay, false);
  assert.notEqual(crossSignalComparisonIdentity(first.result), crossSignalComparisonIdentity(second.result));
  assert.equal(tables.cross_signal_comparison_results.length, 2);
});

// -----------------------------------------------------------------------------
// 5-7. DEPENDENCY_TARGET_IDENTITY relationship-state-set behavior
// -----------------------------------------------------------------------------

test('5. relationship-state set ordering does not change identity or replay behavior', async () => {
  tables.canonical_relationships = [relationshipRow(), relationshipRow({ relationship_id: 'rel-2', relationship_state_id: 'rel-2:initial' })];
  const memberA = { relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' };
  const memberB = { relationshipId: 'rel-2', relationshipStateId: 'rel-2:initial', validFrom: '2026-09-01T00:00:00.123456+00:00' };
  const inOrder = dependencyResult([memberA, memberB]);
  const reversed = dependencyResult([memberB, memberA]);
  assert.equal(crossSignalComparisonIdentity(inOrder), crossSignalComparisonIdentity(reversed));
  const first = await mod.persistCrossSignalComparisonResult(inOrder);
  const second = await mod.persistCrossSignalComparisonResult(reversed);
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
});

test('6. two simultaneously effective relationship states persist as two child rows', async () => {
  tables.canonical_relationships = [relationshipRow(), relationshipRow({ relationship_id: 'rel-2', relationship_state_id: 'rel-2:initial' })];
  const result = dependencyResult([
    { relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' },
    { relationshipId: 'rel-2', relationshipStateId: 'rel-2:initial', validFrom: '2026-09-01T00:00:00.123456+00:00' },
  ], { outcome: 'CONFLICT_CANDIDATE' });
  const persisted = await mod.persistCrossSignalComparisonResult(result);
  assert.equal((persisted.result.left as any).states.length, 2);
  assert.equal(tables.cross_signal_comparison_left_relationship_states.length, 2);
});

test('7. empty relationship effective set is represented distinctly from an absent baseline', async () => {
  const result = dependencyResult([], { outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE' });
  const persisted = await mod.persistCrossSignalComparisonResult(result);
  assert.equal(persisted.result.left?.kind, 'RELATIONSHIP_STATE_SET');
  assert.deepEqual((persisted.result.left as any).states, []);
  assert.equal(tables.cross_signal_comparison_left_relationship_states.length, 0);
  assert.equal(tables.cross_signal_comparison_results[0].left_kind, 'RELATIONSHIP_STATE_SET');
});

// -----------------------------------------------------------------------------
// 8. PRINCIPAL_IDENTITY with an entirely absent left baseline (DESIGN_TIME_BASELINE_MISSING)
// -----------------------------------------------------------------------------

test('8. absent left baseline persists distinctly from an empty relationship set', async () => {
  const result = createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    right: { kind: 'RUNTIME_OBSERVATION', observationId: rightRef.observationId, connectionId: rightRef.connectionId },
    method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' },
    rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp('2026-09-20T00:05:00.000Z'), outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_MISSING',
  });
  const persisted = await mod.persistCrossSignalComparisonResult(result);
  assert.equal(persisted.result.left, undefined);
  assert.equal(tables.cross_signal_comparison_results[0].left_kind, null);
});

// -----------------------------------------------------------------------------
// 9-11. Cross-tenant rejection
// -----------------------------------------------------------------------------

test('9. cross-tenant subject rejection', async () => {
  tables.execution_field_states = [principalEfs()];
  const foreignSubjectResult = createCrossSignalComparisonResult({
    organisationId: org, subject: { organisationId: foreign, objectId: asCanonicalObjectId(subjectId), kind: 'AGENT_VERSION' },
    dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    left: { kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: 'efs-1', decisionId: 'decision-1', snapshotId: 'snapshot-1' },
    right: { kind: 'RUNTIME_OBSERVATION', observationId: rightRef.observationId, connectionId: rightRef.connectionId },
    method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' }, rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp('2026-09-20T00:05:00.000Z'), outcome: 'CONSISTENT',
  });
  await assert.rejects(mod.persistCrossSignalComparisonResult(foreignSubjectResult), /CROSS_SIGNAL_RESULT_SUBJECT_INVALID/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('10. cross-tenant runtime evidence rejection', async () => {
  tables.execution_field_states = [principalEfs()];
  tables.runtime_observations = [{ ...runtimeRow(), organisation_id: foreign }];
  await assert.rejects(mod.persistCrossSignalComparisonResult(principalResult()), /CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('11. cross-tenant relationship evidence rejection', async () => {
  tables.canonical_relationships = [{ ...relationshipRow(), organisation_id: foreign }];
  const result = dependencyResult([{ relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' }]);
  await assert.rejects(mod.persistCrossSignalComparisonResult(result), /CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

// -----------------------------------------------------------------------------
// 11b-11d. Hardening: independent subject-kind proof, and dependency
// relationship evidence proof beyond "the id happens to exist".
// -----------------------------------------------------------------------------

test('11b. subject claiming AGENT_VERSION over a real canonical object of another kind is rejected', async () => {
  tables.canonical_objects = [{ organisation_id: org, canonical_object_id: subjectId, kind: 'TOOL' }];
  tables.execution_field_states = [principalEfs()];
  await assert.rejects(mod.persistCrossSignalComparisonResult(principalResult()), /CROSS_SIGNAL_RESULT_SUBJECT_INVALID/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('11c. a dependency relationship row with the wrong source_kind is rejected, even though relationshipId/relationshipStateId/source id all match', async () => {
  tables.canonical_relationships = [relationshipRow({ source_kind: 'TOOL' })];
  const result = dependencyResult([{ relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' }]);
  await assert.rejects(mod.persistCrossSignalComparisonResult(result), /CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('11d. a dependency relationship row with an unsupported (non-M15-V1) relationship_type is rejected', async () => {
  tables.canonical_relationships = [relationshipRow({ relationship_type: 'EXPOSES' })];
  const result = dependencyResult([{ relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' }]);
  await assert.rejects(mod.persistCrossSignalComparisonResult(result), /CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('11e. a dependency relationship row whose type disagrees with the paired runtime observation kind is rejected', async () => {
  // rightRef comes from a MODEL_CALL fixture (expects USES_MODEL); this row
  // claims USES_TOOL instead - a closed, valid M15 V1 type, but the wrong one
  // for this runtime observation's own kind.
  tables.canonical_relationships = [relationshipRow({ relationship_type: 'USES_TOOL' })];
  const result = dependencyResult([{ relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' }]);
  await assert.rejects(mod.persistCrossSignalComparisonResult(result), /CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

// -----------------------------------------------------------------------------
// 12. Atomicity: a rejected write leaves no partial parent/child rows
// -----------------------------------------------------------------------------

test('12. rejected persistence leaves no partial parent or child row (atomic contract)', async () => {
  tables.canonical_relationships = [relationshipRow()]; // only rel-1 exists; rel-2 does not
  const result = dependencyResult([
    { relationshipId: 'rel-1', relationshipStateId: 'rel-1:initial', decisionId: 'decision-rel-1', validFrom: '2026-09-01T00:00:00.123456+00:00' },
    { relationshipId: 'rel-2', relationshipStateId: 'rel-2:initial', validFrom: '2026-09-01T00:00:00.123456+00:00' },
  ], { outcome: 'CONFLICT_CANDIDATE' });
  await assert.rejects(mod.persistCrossSignalComparisonResult(result), /CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH/);
  assert.equal(tables.cross_signal_comparison_results.length, 0);
  assert.equal(tables.cross_signal_comparison_left_relationship_states.length, 0);
});

// -----------------------------------------------------------------------------
// 13. Readback revalidation - a persisted row is never trusted merely because
//     it came from the database.
// -----------------------------------------------------------------------------

test('13. readback revalidates evidence and fails closed on a corrupted stored reference', async () => {
  tables.execution_field_states = [principalEfs()];
  await mod.persistCrossSignalComparisonResult(principalResult());
  const comparisonId = crossSignalComparisonIdentity(principalResult());
  tables.cross_signal_comparison_results[0].left_execution_field_state_decision_id = 'tampered-decision-id';
  await assert.rejects(mod.readCrossSignalComparisonResult(org, comparisonId), /CROSS_SIGNAL_COMPARISON_EVIDENCE_INVALID/);
});

test('13b. readback of an unknown comparison id returns undefined, never fabricated', async () => {
  const result = await mod.readCrossSignalComparisonResult(org, 'cross-signal-comparison:does-not-exist');
  assert.equal(result, undefined);
});

test('13c. readback rejects a persisted row that rehydrates structurally but hashes to a different id than its own stored key (corrupted/manually-edited durable state)', async () => {
  tables.execution_field_states = [principalEfs()];
  const persisted = await mod.persistCrossSignalComparisonResult(principalResult());
  const trueId = crossSignalComparisonIdentity(persisted.result);
  assert.equal(tables.cross_signal_comparison_results[0].comparison_id, trueId);
  const forgedKey = 'cross-signal-comparison:' + 'f'.repeat(64);
  // Simulates corrupted/manually-edited durable state: the row's own content
  // (evidence references, method, dimension, ...) still rehydrates without a
  // structural error, but no longer corresponds to the key it is filed
  // under. Readback must independently recompute the identity and reject.
  tables.cross_signal_comparison_results[0].comparison_id = forgedKey;
  await assert.rejects(mod.readCrossSignalComparisonResult(org, forgedKey), /CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH/);
});

test('13d. evaluated_at microsecond precision is preserved on readback, never collapsed to JavaScript millisecond precision', async () => {
  tables.execution_field_states = [principalEfs()];
  await mod.persistCrossSignalComparisonResult(principalResult());
  const comparisonId = tables.cross_signal_comparison_results[0].comparison_id;
  const microsecondValue = '2026-09-23T10:15:30.123456+00:00';
  // Simulates the raw trusted PostgREST timestamptz string a real Postgres
  // column would return - readback must surface this exact string, never
  // `new Date(...).toISOString()`'s fixed 3-digit millisecond precision.
  tables.cross_signal_comparison_results[0].evaluated_at = microsecondValue;
  const reread = await mod.readCrossSignalComparisonResult(org, comparisonId);
  assert.equal(reread?.evaluatedAt, microsecondValue);
});

// -----------------------------------------------------------------------------
// 14. No update/delete overwrite path; no canonical/relationship/trust/runtime write
// -----------------------------------------------------------------------------

const source = readFileSync(new URL('../lib/governance/cross-signal-persistence.ts', import.meta.url), 'utf8');

test('14. no update/upsert/delete path exists; writes only through the single record RPC', () => {
  assert.doesNotMatch(source, /\.(update|upsert|delete)\(/);
  assert.doesNotMatch(source, /\.insert\(/);
  const rpcCalls = [...source.matchAll(/privilegedDb\.rpc\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(new Set(rpcCalls), new Set(['record_cross_signal_comparison_result']));
});

test('15. no SELECT * and no arbitrary JSON/EAV table read path', () => {
  assert.doesNotMatch(source, /select\(\s*['"]\*['"]\s*\)/);
  assert.doesNotMatch(source, /\.select\([^)]*\bjsonb?\b[^)]*\)/i);
});

test('15b. relationship-state evidence has exactly ONE transport source (p_result only) - a second/duplicate parameter is impossible because it no longer exists', () => {
  assert.doesNotMatch(source, /p_relationship_states/);
  const rpcCallSites = [...source.matchAll(/privilegedDb\.rpc\(\s*'record_cross_signal_comparison_result',\s*\{([^}]*)\}/g)];
  assert.ok(rpcCallSites.length > 0);
  for (const [, argsText] of rpcCallSites) {
    const paramNames = [...argsText.matchAll(/(p_\w+)\s*:/g)].map(m => m[1]);
    assert.deepEqual(new Set(paramNames), new Set(['p_organisation_id', 'p_comparison_id', 'p_result']));
  }
});

// -----------------------------------------------------------------------------
// 16-17. DATABASE-AUTHORITATIVE IDENTITY (ADR §13/§15): a caller-supplied
// comparison_id is never the authority on either side of this boundary.
// -----------------------------------------------------------------------------

test('16. a forged caller comparison_id that disagrees with the verified evidence is rejected, never creates an alternate durable row', async () => {
  tables.execution_field_states = [principalEfs()];
  const result = principalResult();
  const forgedId = 'cross-signal-comparison:' + '0'.repeat(64);
  assert.notEqual(forgedId, crossSignalComparisonIdentity(result));
  const response = await (db as any).rpc('record_cross_signal_comparison_result', {
    p_organisation_id: org, p_comparison_id: forgedId, p_result: result,
  });
  assert.equal(response.data, null);
  assert.equal(response.error?.message, 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH');
  assert.equal(tables.cross_signal_comparison_results.length, 0);
  // The caller cannot use a forged id to "steal"/collide with a different,
  // unrelated comparison's row either - the RPC never falls back to trusting
  // p_comparison_id merely because a row already happens to exist under it.
  await mod.persistCrossSignalComparisonResult(result);
  assert.equal(tables.cross_signal_comparison_results.length, 1);
  tables.execution_field_states.push(principalEfs({ state_id: 'efs-2', decision_id: 'decision-2', snapshot_id: 'snapshot-2' }));
  const differentResult = principalResult({ executionFieldStateId: 'efs-2', decisionId: 'decision-2', snapshotId: 'snapshot-2' });
  const forgedAttempt = await (db as any).rpc('record_cross_signal_comparison_result', {
    p_organisation_id: org, p_comparison_id: forgedId, p_result: differentResult,
  });
  assert.equal(forgedAttempt.data, null);
  assert.equal(forgedAttempt.error?.message, 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH');
  assert.equal(tables.cross_signal_comparison_results.length, 1, 'the forged attempt must never create a second row under the wrong id');
});

test('17. persistence adapter rejects a DB-returned comparison_id that differs from the independently computed TypeScript identity', async () => {
  tables.execution_field_states = [principalEfs()];
  const originalRpc = db.rpc;
  (db as any).rpc = (name: string, params: Record<string, any>) => {
    if (name === 'record_cross_signal_comparison_result') {
      return Promise.resolve({ data: [{ replay: false, comparison_id: 'cross-signal-comparison:' + '1'.repeat(64), evaluated_at: '2026-09-20T00:05:00.000Z' }], error: null });
    }
    return originalRpc(name, params);
  };
  try {
    await assert.rejects(mod.persistCrossSignalComparisonResult(principalResult()), /CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH/);
  } finally {
    db.rpc = originalRpc;
  }
  // Never silently used the forged id to write or read anything.
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});
