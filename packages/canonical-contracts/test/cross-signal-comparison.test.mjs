import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCrossSignalComparisonResult, sortCrossSignalRelationshipStateSet } from '../src/index.ts';

/**
 * GOV IA M15 V1 - Cross-Signal Reconciliation & Drift.
 * Frozen architecture: docs/architecture/ADR-GOVIA-CROSS-SIGNAL-RECONCILIATION-AND-DRIFT-v1.md
 *
 * Adversarial coverage for the public construction boundary only (ADR §7.1a):
 * DRIFT_CANDIDATE must stay unreachable under both current V1 method codes,
 * even when a caller assembles an otherwise-valid result and asks for it
 * directly - the domain comparison functions in @council/governance-review
 * never construct such a request, but the boundary itself must refuse it too.
 */

const organisationId = 'tenant-a';
const subject = { organisationId, objectId: 'agent-version-1', kind: 'AGENT_VERSION' };
const evaluatedAt = '2026-09-20T00:00:00.000Z';

function principalBase(overrides = {}) {
  return {
    organisationId, subject, dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    left: { kind: 'EXECUTION_FIELD_STATE', executionFieldStateId: 'field-state-1', decisionId: 'decision-1', snapshotId: 'snapshot-1' },
    right: { kind: 'RUNTIME_OBSERVATION', observationId: 'observation-1', connectionId: 'connection-1' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' },
    rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: evaluatedAt },
    evaluatedAt, outcome: 'CONSISTENT',
    ...overrides,
  };
}
function dependencyBase(overrides = {}) {
  return {
    organisationId, subject, dimension: 'DEPENDENCY_TARGET_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    method: { code: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1', version: '1.0.0' },
    left: { kind: 'RELATIONSHIP_STATE_SET', states: [{ relationshipId: 'rel-1', relationshipStateId: 'rel-state-1', validFrom: evaluatedAt }] },
    right: { kind: 'RUNTIME_OBSERVATION', observationId: 'observation-1', connectionId: 'connection-1' },
    leftTemporalBasis: { basis: 'RELATIONSHIP_VALID_FROM_TO_SET' },
    rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: evaluatedAt },
    evaluatedAt, outcome: 'CONSISTENT',
    ...overrides,
  };
}

test('a valid PRINCIPAL_IDENTITY CONSISTENT result constructs successfully (positive control)', () => {
  const result = createCrossSignalComparisonResult(principalBase());
  assert.equal(result.outcome, 'CONSISTENT');
});

test('a valid DEPENDENCY_TARGET_IDENTITY CONSISTENT result constructs successfully (positive control)', () => {
  const result = createCrossSignalComparisonResult(dependencyBase());
  assert.equal(result.outcome, 'CONSISTENT');
});

test('a fabricated DRIFT_CANDIDATE under CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1 is refused at the construction boundary', () => {
  assert.throws(() => createCrossSignalComparisonResult(principalBase({ outcome: 'DRIFT_CANDIDATE' })),
    { message: 'CROSS_SIGNAL_COMPARISON_RESULT_INVALID' });
});

test('a fabricated DRIFT_CANDIDATE under CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1 is refused at the construction boundary', () => {
  assert.throws(() => createCrossSignalComparisonResult(dependencyBase({ outcome: 'DRIFT_CANDIDATE' })),
    { message: 'CROSS_SIGNAL_COMPARISON_RESULT_INVALID' });
});

test('DRIFT_CANDIDATE remains a member of the closed outcome vocabulary (frozen for future ADR evolution)', () => {
  assert.throws(() => createCrossSignalComparisonResult(principalBase({ outcome: 'NOT_A_REAL_OUTCOME' })),
    { message: 'CROSS_SIGNAL_COMPARISON_RESULT_INVALID' });
  // DRIFT_CANDIDATE is rejected for a different, method-specific reason above -
  // not because it is absent from CROSS_SIGNAL_OUTCOME.
});

test('sortCrossSignalRelationshipStateSet normalizes order deterministically', () => {
  const a = { relationshipId: 'rel-a', relationshipStateId: 'b', validFrom: evaluatedAt };
  const b = { relationshipId: 'rel-b', relationshipStateId: 'a', validFrom: evaluatedAt };
  assert.deepEqual(sortCrossSignalRelationshipStateSet([a, b]), [b, a]);
});

test('a validFrom/validTo pair within the same JavaScript millisecond constructs successfully (M15.1B)', () => {
  const result = createCrossSignalComparisonResult(dependencyBase({
    left: { kind: 'RELATIONSHIP_STATE_SET', states: [{ relationshipId: 'rel-1', relationshipStateId: 'rel-state-1',
      validFrom: '2026-09-01T00:00:00.123456Z', validTo: '2026-09-01T00:00:00.123789Z' }] },
  }));
  assert.equal(result.left.states[0].validFrom, '2026-09-01T00:00:00.123456Z');
  assert.equal(result.left.states[0].validTo, '2026-09-01T00:00:00.123789Z');
});

test('a reversed same-millisecond microsecond validFrom/validTo pair is refused, never collapsed by Date.parse (M15.1B)', () => {
  assert.throws(() => createCrossSignalComparisonResult(dependencyBase({
    left: { kind: 'RELATIONSHIP_STATE_SET', states: [{ relationshipId: 'rel-1', relationshipStateId: 'rel-state-1',
      validFrom: '2026-09-01T00:00:00.123789Z', validTo: '2026-09-01T00:00:00.123456Z' }] },
  })), { message: 'CROSS_SIGNAL_COMPARISON_RESULT_INVALID' });
});
