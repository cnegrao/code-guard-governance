import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, mock, test } from 'node:test';
import {
  asCanonicalObjectId, asExternalId, asIsoTimestamp, asObjectSourceMappingId, asOrganisationId, asRuntimeObservationId,
  asRuntimeSpanId, asRuntimeTraceId, asRuntimeUnixNano, asSourceConnectionId, asSourceSystemId,
  runtimeKnown as known, runtimeUnknown as unknown,
  type RuntimeObservation, type RuntimeObservationEnvelope, type RuntimeObservationKind,
  type RuntimeSubjectBinding, type RuntimeTargetKind,
} from '@council/canonical-contracts';
import { crossSignalComparisonIdentity } from '@council/governance-review';
import { runtimeToRow } from '../lib/governance/runtime-row';

/**
 * GOV IA M15.3B - Cross-Signal Orchestration V1 tests.
 *
 * Mocks ONLY '../lib/governance/persistence' (the shared privilegedDb boundary
 * both cross-signal-read.ts and cross-signal-persistence.ts already depend
 * on) so the orchestration module's real code exercises the real, accepted
 * M15.2/M15.3A adapters end-to-end - never a second, parallel fake database
 * implementation. The record_cross_signal_comparison_result RPC emulation
 * mirrors the one already validated in cross-signal-persistence.test.ts.
 */

const org = asOrganisationId('33333333-3333-3333-3333-333333333333');
const foreign = asOrganisationId('44444444-4444-4444-4444-444444444444');
const subjectId = 'agent-version-orch-1';
const connectionId = asSourceConnectionId('orch-connection-a');

type Row = Record<string, any>;
let tables: Record<string, Row[]>;

// -----------------------------------------------------------------------------
// Runtime observation fixture builder - mirrors governance-review's own test
// fixture shape (packages/governance-review/test/cross-signal-comparison.test.ts)
// closely enough to exercise both KNOWN/UNKNOWN targets and EXACT/UNRESOLVED
// bindings, but round-tripped through runtimeToRow so it can be served back
// through the real read_runtime_observation_exact RPC boundary.
// -----------------------------------------------------------------------------

function exactBinding(objectId: string, bindingOrg = org): RuntimeSubjectBinding {
  return {
    state: 'EXACT', agentVersion: { organisationId: bindingOrg, objectId: asCanonicalObjectId(objectId), kind: 'AGENT_VERSION' },
    coordinates: { producerIdentity: 'producer', deploymentReference: known('deployment'), artifactDigest: known('c'.repeat(64)) },
    proof: { organisationId: bindingOrg, connectionId, deploymentBindingId: 'binding' as any, method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' },
  };
}
const unresolvedBinding: RuntimeSubjectBinding = {
  state: 'UNRESOLVED', coordinates: { producerIdentity: 'producer', deploymentReference: unknown('NOT_SUPPLIED'), artifactDigest: unknown('NOT_SUPPLIED') },
  reason: 'MISSING_REVISION_EVIDENCE',
};
function targetFor<K extends RuntimeTargetKind>(kind: K, objectId: string, targetKnown: boolean, targetOrg = org) {
  return {
    observed: known({ kind, providerCode: 'provider', sourceReference: objectId }),
    canonical: targetKnown ? known({
      canonicalObject: { organisationId: targetOrg, objectId: asCanonicalObjectId(objectId), kind },
      proof: { method: 'EXACT_SOURCE_COORDINATES_V1' as const, version: '1.0.0' as const, mappingId: asObjectSourceMappingId('mapping'), providerCode: 'provider',
        sourceObject: { connectionId, externalType: 'x', externalId: asExternalId(objectId) } },
    }) : unknown('NOT_SUPPLIED'),
  };
}
interface FixtureOpts {
  readonly observationId?: string;
  readonly startedAtUnixNano?: string;
  readonly binding?: RuntimeSubjectBinding;
  readonly targetKnown?: boolean;
  readonly targetObjectId?: string;
}
function runtimeFixture(kind: RuntimeObservationKind, opts: FixtureOpts = {}): RuntimeObservation {
  const observationId = asRuntimeObservationId(opts.observationId ?? '11111111-1111-4111-8111-111111111111');
  const traceId = asRuntimeTraceId('a'.repeat(32)); const spanId = asRuntimeSpanId('b'.repeat(16));
  const common: RuntimeObservationEnvelope = {
    observationId, organisationId: org, sourceConnection: { connectionId, sourceSystemId: asSourceSystemId('system') },
    sourceSystemId: asSourceSystemId('system'), providerCode: 'provider', sourceConfigurationVersion: '1', sourceEventKey: `${traceId}:${spanId}`,
    traceId, spanId, parent: { state: 'ROOT' }, startedAtUnixNano: asRuntimeUnixNano(opts.startedAtUnixNano ?? '1789516800000000000'),
    endedAtUnixNano: unknown('NOT_SUPPLIED'), sourceObservedAtUnixNano: unknown('NOT_SUPPLIED'), receivedAt: asIsoTimestamp('2026-09-16T00:00:00.000Z'),
    recordedAt: known(asIsoTimestamp('2026-09-16T00:01:00.000Z')),
    binding: opts.binding ?? exactBinding(subjectId),
    sourceStatus: 'UNSET', outcome: unknown('NOT_SUPPLIED'), duration: unknown('NOT_SUPPLIED'), error: unknown('NOT_SUPPLIED'),
    context: { principal: unknown('NOT_SUPPLIED'), environment: unknown('NOT_SUPPLIED'), network: unknown('NOT_SUPPLIED') },
    provenance: { trustState: 'OBSERVED', evidence: { organisationId: org, connectionId, observationId }, method: { code: 'MANUAL_SPAN', version: '1.0.0' },
      adapterVersion: '1.0.0', schemaVersion: '1.0.0', mappingVersion: '1.0.0',
      instrumentation: { name: 'govia.producer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
      conventions: { coreTraceRevision: '1.41.0', http: unknown('NOT_SUPPLIED'), genai: unknown('UNSUPPORTED'), mcp: unknown('UNSUPPORTED') } },
    coverage: { sampling: known({ mode: 'ALWAYS_ON', rate: 1 }), sampled: known(true), droppedAttributes: unknown('NOT_SUPPLIED'),
      droppedEvents: unknown('NOT_SUPPLIED'), droppedLinks: unknown('NOT_SUPPLIED'), collectionScope: 'OPERATION_ONLY', limitations: [] },
  };
  const targetKnown = opts.targetKnown ?? true; const targetObjectId = opts.targetObjectId ?? 'target-1';
  switch (kind) {
    case 'EXECUTION': return { ...common, kind, operation: 'GOVERNANCE_ANSWER', executionScope: 'OPERATION' };
    case 'MODEL_CALL': return { ...common, kind, operation: 'CHAT_COMPLETION', target: targetFor('MODEL', targetObjectId, targetKnown),
      reportedModel: unknown('NOT_SUPPLIED'), tokens: { unit: 'TOKEN', input: unknown('NOT_SUPPLIED'), output: unknown('NOT_SUPPLIED'), total: unknown('NOT_SUPPLIED') },
      cost: { supplied: unknown('NOT_SUPPLIED'), derived: unknown('NOT_SUPPLIED') } };
    case 'TOOL_CALL': return { ...common, kind, operation: 'INVOKE', target: targetFor('TOOL', targetObjectId, targetKnown) };
    case 'MCP_CALL': return { ...common, kind, operation: 'tools/call', target: targetFor('MCP_SERVER', targetObjectId, targetKnown),
      transport: unknown('NOT_SUPPLIED'), toolReference: unknown('NOT_SUPPLIED'), protocolResult: unknown('NOT_SUPPLIED') };
    case 'API_CALL': return { ...common, kind, operation: 'REQUEST', target: targetFor('API', targetObjectId, targetKnown),
      protocol: unknown('NOT_SUPPLIED'), httpMethod: unknown('NOT_SUPPLIED'), httpStatusCode: unknown('NOT_SUPPLIED') };
  }
}
function runtimeRow(observation: RuntimeObservation) {
  return { organisation_id: org, observation_id: observation.observationId, connection_id: observation.sourceConnection.connectionId,
    ...runtimeToRow(observation), recorded_at: '2026-09-17T00:00:00.000000+00:00' };
}

// -----------------------------------------------------------------------------
// In-memory record_cross_signal_comparison_result RPC emulation - reused
// verbatim in spirit from cross-signal-persistence.test.ts, kept local here so
// this file exercises the orchestration module without importing test-only
// helpers across package/app test boundaries.
// -----------------------------------------------------------------------------

const M15_DEPENDENCY_RELATIONSHIP_TYPES = ['USES_MODEL', 'USES_TOOL', 'USES_MCP', 'INVOKES'];
const RUNTIME_KIND_TO_DEPENDENCY_TYPE: Record<string, string> = { MODEL_CALL: 'USES_MODEL', TOOL_CALL: 'USES_TOOL', MCP_CALL: 'USES_MCP', API_CALL: 'INVOKES' };

function recordComparisonResult(params: { p_organisation_id: string; p_comparison_id: string | null; p_result: any }) {
  const { p_organisation_id: organisationId, p_comparison_id: assertedComparisonId, p_result: result } = params;
  if (result.organisationId !== organisationId) return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_TENANT_MISMATCH' } };
  const canonicalObject = (tables.canonical_objects ?? []).find(row => row.organisation_id === organisationId && row.canonical_object_id === result.subject.objectId);
  if (!canonicalObject || canonicalObject.kind !== 'AGENT_VERSION') return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_SUBJECT_INVALID' } };
  if (result.outcome === 'DRIFT_CANDIDATE') return { data: null, error: { message: 'CROSS_SIGNAL_RESULT_OUTCOME_INVALID' } };

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
          rel.source_kind !== 'AGENT_VERSION' || !M15_DEPENDENCY_RELATIONSHIP_TYPES.includes(rel.relationship_type) ||
          (expectedRelationshipType !== undefined && rel.relationship_type !== expectedRelationshipType) ||
          (member.decisionId && rel.created_by_decision_id !== member.decisionId)) {
          throw new Error('CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH');
        }
      }
    }
  } catch (e) { return { data: null, error: { message: (e as Error).message } }; }

  const expectedComparisonId = crossSignalComparisonIdentity(result);
  if (assertedComparisonId != null && assertedComparisonId !== expectedComparisonId) {
    return { data: null, error: { message: 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH' } };
  }

  const existing = (tables.cross_signal_comparison_results ?? []).find(row => row.organisation_id === organisationId && row.comparison_id === expectedComparisonId);
  if (existing) {
    return { data: [{ replay: true, comparison_id: expectedComparisonId, evaluated_at: existing.evaluated_at }], error: null };
  }

  const row: Row = {
    organisation_id: organisationId, comparison_id: expectedComparisonId, subject_object_id: result.subject.objectId,
    dimension: result.dimension, pairing_mode: result.pairingMode, method_code: result.method.code, method_version: result.method.version,
    left_kind: result.left?.kind ?? null,
    left_execution_field_state_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.executionFieldStateId : null,
    left_execution_field_state_decision_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.decisionId : null,
    left_execution_field_state_snapshot_id: result.left?.kind === 'EXECUTION_FIELD_STATE' ? result.left.snapshotId : null,
    right_observation_id: result.right?.observationId ?? null, right_connection_id: result.right?.connectionId ?? null,
    left_temporal_basis: result.leftTemporalBasis.basis, right_temporal_basis: result.rightTemporalBasis.basis,
    outcome: result.outcome, reason: result.reason ?? null, evaluated_at: result.evaluatedAt,
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
        row.organisation_id === params.p_organisation_id && row.observation_id === params.p_observation_id && row.connection_id === params.p_connection_id);
      return Promise.resolve({ data: match.map(row => ({ observation: row })), error: null });
    }
    if (name === 'record_cross_signal_comparison_result') return Promise.resolve(recordComparisonResult(params as any));
    return Promise.resolve({ data: null, error: { message: 'UNKNOWN_RPC' } });
  },
};

let mod: typeof import('../lib/governance/cross-signal-orchestration');
before(async () => {
  mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: db } });
  mod = await import('../lib/governance/cross-signal-orchestration');
});
beforeEach(() => {
  tables = {
    canonical_objects: [{ organisation_id: org, canonical_object_id: subjectId, kind: 'AGENT_VERSION' }],
    execution_field_states: [], execution_source_facts: [], canonical_relationships: [], runtime_observations: [],
    cross_signal_comparison_results: [], cross_signal_comparison_left_relationship_states: [],
  };
});

function principalState(overrides: Row = {}) {
  return { organisation_id: org, state_id: 'efs-1', canonical_object_id: subjectId, field_key: 'PRINCIPAL',
    snapshot_id: 'snapshot-1', decision_id: 'decision-1', previous_state_id: null, recorded_at: '2026-09-15T00:00:00.000Z', ...overrides };
}
function principalFact(overrides: Row = {}) {
  return { organisation_id: org, snapshot_id: 'snapshot-1', ordinal: 0, field_key: 'PRINCIPAL',
    principal_kind: 'SERVICE_ACCOUNT', principal_provider: 'provider', principal_authority: 'authority',
    principal_reference: 'reference', assertion_id: 'assertion', evidence_id: 'evidence', ...overrides };
}
function relationshipRow(overrides: Row = {}) {
  return { organisation_id: org, relationship_id: 'rel-1', relationship_state_id: 'rel-1:initial', relationship_type: 'USES_MODEL',
    source_canonical_object_id: subjectId, source_kind: 'AGENT_VERSION', target_canonical_object_id: 'target-1', target_kind: 'MODEL',
    valid_from: '2026-09-01T00:00:00.000000+00:00', valid_to: null, created_by_decision_id: 'decision-rel-1', ...overrides };
}
const t1 = asIsoTimestamp('2026-09-20T00:05:00.000Z');
const t2 = asIsoTimestamp('2026-09-21T00:00:00.000Z');

// -----------------------------------------------------------------------------
// 1-4. PRINCIPAL_IDENTITY orchestration
// -----------------------------------------------------------------------------

test('1. PRINCIPAL consistent runtime + governed baseline persists CONSISTENT', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact({ principal_kind: 'SERVICE_ACCOUNT', principal_provider: 'provider', principal_authority: 'authority', principal_reference: 'reference' })];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  const runtimeWithPrincipal: RuntimeObservation = { ...runtime,
    context: { ...runtime.context, principal: known({ value: { kind: 'SERVICE_ACCOUNT', providerCode: 'provider', authorityReference: 'authority', principalReference: 'reference' },
      support: { evidence: { organisationId: org, connectionId, observationId: runtime.observationId }, method: { code: 'DIRECT_RUNTIME_MEASUREMENT', version: '1.0.0' } } }) } } as RuntimeObservation;
  tables.runtime_observations = [runtimeRow(runtimeWithPrincipal)];

  const persisted = await mod.orchestratePrincipalIdentityComparison({
    organisationId: org, subjectObjectId: subjectId,
    runtimeObservation: { observationId: runtimeWithPrincipal.observationId, connectionId },
  }, mod.fixedCrossSignalEvaluationClock(t1));

  assert.equal(persisted.replay, false);
  assert.equal(persisted.result.outcome, 'CONSISTENT');
  assert.equal(tables.cross_signal_comparison_results.length, 1);
});

test('2. PRINCIPAL disagreement persists CONFLICT_CANDIDATE', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact({ principal_reference: 'design-time-reference' })];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  const runtimeWithPrincipal: RuntimeObservation = { ...runtime,
    context: { ...runtime.context, principal: known({ value: { kind: 'SERVICE_ACCOUNT', providerCode: 'provider', authorityReference: 'authority', principalReference: 'different-runtime-reference' },
      support: { evidence: { organisationId: org, connectionId, observationId: runtime.observationId }, method: { code: 'DIRECT_RUNTIME_MEASUREMENT', version: '1.0.0' } } }) } } as RuntimeObservation;
  tables.runtime_observations = [runtimeRow(runtimeWithPrincipal)];

  const persisted = await mod.orchestratePrincipalIdentityComparison({
    organisationId: org, subjectObjectId: subjectId,
    runtimeObservation: { observationId: runtimeWithPrincipal.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'CONFLICT_CANDIDATE');
});

test('3. PRINCIPAL missing design-time baseline persists INSUFFICIENT_EVIDENCE / DESIGN_TIME_BASELINE_MISSING - never treated as an orchestration failure', async () => {
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestratePrincipalIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'INSUFFICIENT_EVIDENCE');
  assert.equal(persisted.result.reason, 'DESIGN_TIME_BASELINE_MISSING');
  assert.equal(persisted.result.left, undefined);
});

test('4. PRINCIPAL with UNRESOLVED runtime binding persists INSUFFICIENT_EVIDENCE / RUNTIME_BINDING_UNRESOLVED - never a guessed subject', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact()];
  const runtime = runtimeFixture('MODEL_CALL', { binding: unresolvedBinding });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestratePrincipalIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'INSUFFICIENT_EVIDENCE');
  assert.equal(persisted.result.reason, 'RUNTIME_BINDING_UNRESOLVED');
});

// -----------------------------------------------------------------------------
// 5-9. DEPENDENCY_TARGET_IDENTITY orchestration
// -----------------------------------------------------------------------------

test('5. DEPENDENCY runtime target is a member of a plural effective set persists CONSISTENT', async () => {
  tables.canonical_relationships = [
    relationshipRow({ target_canonical_object_id: 'target-1' }),
    relationshipRow({ relationship_id: 'rel-2', relationship_state_id: 'rel-2:initial', target_canonical_object_id: 'target-2' }),
  ];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), targetObjectId: 'target-2' });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestrateDependencyTargetIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'CONSISTENT');
  assert.equal((persisted.result.left as any).states.length, 2);
});

test('6. DEPENDENCY runtime target outside a nonempty effective set persists CONFLICT_CANDIDATE', async () => {
  tables.canonical_relationships = [relationshipRow({ target_canonical_object_id: 'target-1' })];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), targetObjectId: 'ungoverned-target' });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestrateDependencyTargetIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'CONFLICT_CANDIDATE');
});

test('7. DEPENDENCY with no effective governed relationship persists INSUFFICIENT_EVIDENCE / DESIGN_TIME_BASELINE_NOT_EFFECTIVE', async () => {
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestrateDependencyTargetIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'INSUFFICIENT_EVIDENCE');
  assert.equal(persisted.result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
  assert.deepEqual((persisted.result.left as any).states, []);
});

test('8. an expired relationship (validTo before the runtime event) is excluded from the effective set, not treated as active', async () => {
  tables.canonical_relationships = [relationshipRow({
    target_canonical_object_id: 'target-1', valid_from: '2020-01-01T00:00:00.000000+00:00', valid_to: '2020-02-01T00:00:00.000000+00:00',
  })];
  // Runtime event is 2026-09-16 (far after the relationship's validTo).
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), targetObjectId: 'target-1' });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestrateDependencyTargetIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  assert.equal(persisted.result.outcome, 'INSUFFICIENT_EVIDENCE');
  assert.equal(persisted.result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('9. exact validFrom/validTo nanosecond boundary membership is owned entirely by the pure comparator - the orchestrator passes the unfiltered read straight through', async () => {
  // startedAtUnixNano below is exactly 1789516800000000000 (runtimeFixture's
  // default). One relationship's validTo lands EXACTLY at that nanosecond
  // (half-open interval [validFrom, validTo) excludes it); a second starts
  // exactly AT that nanosecond (included). The orchestrator itself does no
  // filtering - resolveDependencyGovernedStates returns both unfiltered, and
  // only the pure comparator's own effective-set resolution decides membership.
  const eventIso = '2026-09-16T00:00:00.000000000Z'; // corresponds to the fixture's default startedAtUnixNano base second
  tables.canonical_relationships = [
    relationshipRow({ relationship_id: 'rel-expiring', relationship_state_id: 'rel-expiring:initial', target_canonical_object_id: 'target-expiring',
      valid_from: '2020-01-01T00:00:00.000000+00:00', valid_to: eventIso }),
    relationshipRow({ relationship_id: 'rel-starting', relationship_state_id: 'rel-starting:initial', target_canonical_object_id: 'target-starting',
      valid_from: eventIso }),
  ];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), targetObjectId: 'target-starting',
    startedAtUnixNano: '1789516800000000000' });
  tables.runtime_observations = [runtimeRow(runtime)];

  const persisted = await mod.orchestrateDependencyTargetIdentityComparison({
    organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
  });

  // Only rel-starting is in the effective set (validFrom <= event); rel-expiring's
  // validTo == event is excluded by the half-open interval.
  assert.equal((persisted.result.left as any).states.length, 1);
  assert.equal((persisted.result.left as any).states[0].relationshipId, 'rel-starting');
  assert.equal(persisted.result.outcome, 'CONSISTENT');
});

test('10. DEPENDENCY_TARGET_IDENTITY against an EXECUTION runtime kind is rejected before persistence, never as INSUFFICIENT_EVIDENCE', async () => {
  const runtime = runtimeFixture('EXECUTION', { binding: exactBinding(subjectId) });
  tables.runtime_observations = [runtimeRow(runtime)];

  await assert.rejects(
    mod.orchestrateDependencyTargetIdentityComparison({
      organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId },
    }),
    /CROSS_SIGNAL_ORCHESTRATION_RUNTIME_KIND_UNSUPPORTED/,
  );
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

// -----------------------------------------------------------------------------
// 11-14. Pre-comparison rejections that must never persist
// -----------------------------------------------------------------------------

test('11. a runtime observation stored under another tenant is never resolved or compared, and nothing is persisted', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact()];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  tables.runtime_observations = [{ ...runtimeRow(runtime), organisation_id: foreign }];

  await assert.rejects(
    mod.orchestratePrincipalIdentityComparison({ organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId } }),
    /CROSS_SIGNAL_RUNTIME_OBSERVATION_NOT_FOUND/,
  );
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('12. a missing AGENT_VERSION subject is rejected before persistence - never a guessed/fabricated subject', async () => {
  tables.canonical_objects = [];
  await assert.rejects(
    mod.orchestratePrincipalIdentityComparison({ organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: asRuntimeObservationId('11111111-1111-4111-8111-111111111111'), connectionId } }),
    /CROSS_SIGNAL_ORCHESTRATION_SUBJECT_NOT_FOUND/,
  );
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('13. an unsupported dimension is rejected before persistence via the discriminated entry point', async () => {
  await assert.rejects(
    mod.orchestrateCrossSignalComparison({
      dimension: 'TOPOLOGY_DRIFT', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
      organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: 'x', connectionId },
    }),
    /CROSS_SIGNAL_ORCHESTRATION_DIMENSION_UNSUPPORTED/,
  );
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

test('14. a RUNTIME_VS_RUNTIME pairing request is rejected before persistence, never as INSUFFICIENT_EVIDENCE', async () => {
  await assert.rejects(
    mod.orchestrateCrossSignalComparison({
      dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'RUNTIME_VS_RUNTIME',
      organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: 'x', connectionId },
    }),
    /CROSS_SIGNAL_ORCHESTRATION_PAIRING_UNSUPPORTED/,
  );
  assert.equal(tables.cross_signal_comparison_results.length, 0);
});

// -----------------------------------------------------------------------------
// 15-17. Replay / change semantics through the full orchestration path
// -----------------------------------------------------------------------------

test('15. exact replay returns the original durable evaluatedAt, never the later attempted one', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact()];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId) });
  tables.runtime_observations = [runtimeRow(runtime)];
  const request = { organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId } };

  const first = await mod.orchestratePrincipalIdentityComparison(request, mod.fixedCrossSignalEvaluationClock(t1));
  assert.equal(first.replay, false);
  assert.equal(first.result.evaluatedAt, t1);

  const second = await mod.orchestratePrincipalIdentityComparison(request, mod.fixedCrossSignalEvaluationClock(t2));
  assert.equal(second.replay, true);
  assert.equal(second.result.evaluatedAt, t1, 'the later server-assigned evaluatedAt must never overwrite the original durable one');
  assert.equal(tables.cross_signal_comparison_results.length, 1);
});

test('16. changed relationship evidence produces a new, additional durable comparison', async () => {
  tables.canonical_relationships = [relationshipRow({ target_canonical_object_id: 'target-1' })];
  const runtime = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), targetObjectId: 'target-1' });
  tables.runtime_observations = [runtimeRow(runtime)];
  const request = { organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtime.observationId, connectionId } };

  const first = await mod.orchestrateDependencyTargetIdentityComparison(request);
  assert.equal(first.replay, false);

  // A later governance decision adds a second simultaneously-effective governed
  // relationship for the same subject/type - a genuinely new left reference.
  tables.canonical_relationships.push(relationshipRow({ relationship_id: 'rel-2', relationship_state_id: 'rel-2:initial', target_canonical_object_id: 'target-2' }));
  const second = await mod.orchestrateDependencyTargetIdentityComparison(request);
  assert.equal(second.replay, false);
  assert.notEqual(crossSignalComparisonIdentity(first.result), crossSignalComparisonIdentity(second.result));
  assert.equal(tables.cross_signal_comparison_results.length, 2);
});

test('17. a changed RuntimeObservation (different observationId) produces a new, additional durable comparison', async () => {
  tables.execution_field_states = [principalState()];
  tables.execution_source_facts = [principalFact()];
  const runtimeA = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), observationId: '11111111-1111-4111-8111-111111111111' });
  const runtimeB = runtimeFixture('MODEL_CALL', { binding: exactBinding(subjectId), observationId: '22222222-2222-4222-8222-222222222222' });
  tables.runtime_observations = [runtimeRow(runtimeA), runtimeRow(runtimeB)];

  const first = await mod.orchestratePrincipalIdentityComparison({ organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtimeA.observationId, connectionId } });
  const second = await mod.orchestratePrincipalIdentityComparison({ organisationId: org, subjectObjectId: subjectId, runtimeObservation: { observationId: runtimeB.observationId, connectionId } });

  assert.equal(first.replay, false);
  assert.equal(second.replay, false);
  assert.notEqual(crossSignalComparisonIdentity(first.result), crossSignalComparisonIdentity(second.result));
  assert.equal(tables.cross_signal_comparison_results.length, 2);
});

// -----------------------------------------------------------------------------
// 18-19. No authority escalation: static source checks
// -----------------------------------------------------------------------------

const rawSource = readFileSync(new URL('../lib/governance/cross-signal-orchestration.ts', import.meta.url), 'utf8');
// Strip block/line comments before scanning for forbidden CODE constructs -
// this module's own prose deliberately explains what it does NOT do (e.g.
// "calls no Graph/Vector/LLM path"), and those explanatory words must never
// make an ACTUAL-usage check false-positive on the documentation praising its
// own absence.
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('18. the orchestrator performs no direct database access of its own - only through the accepted read/persistence adapter boundary', () => {
  assert.doesNotMatch(source, /privilegedDb/);
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(source, /from\(['"]/);
});

test('19. no Graph/Vector/LLM/canonical-write/trust-promotion CODE path exists in the orchestration module', () => {
  assert.doesNotMatch(source, /\bgraph\b/i);
  assert.doesNotMatch(source, /\bvector\b/i);
  assert.doesNotMatch(source, /\bopenai\b|\bllm\b|\bchatcompletion\b/i);
  assert.doesNotMatch(source, /trustState\s*[:=]/);
  assert.doesNotMatch(source, /['"]VALIDATED['"]/);
  assert.doesNotMatch(source, /canonical_objects|canonical_relationships|execution_field_states|runtime_observations/);
});

test('19b. no M16/M17/M18 or UI reference exists in the orchestration module\'s code', () => {
  assert.doesNotMatch(source, /\bM16\b|\bM17\b|\bM18\b/);
  assert.doesNotMatch(source, /react|jsx|useState|useEffect/i);
});
