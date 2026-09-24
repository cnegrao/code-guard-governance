import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { frameIdentity } from '../src/canonical-endpoint-resolution.ts';
import {
  asOrganisationId, asCanonicalObjectId, asSourceConnectionId, asSourceSystemId, asIsoTimestamp, asObjectSourceMappingId, asExternalId,
  asRuntimeObservationId, asRuntimeTraceId, asRuntimeSpanId, asRuntimeUnixNano, asRuntimeDeploymentBindingId,
  asRelationshipId, asRelationshipStateId, crossSignalTimestampEpochNanos, createCrossSignalComparisonResult,
  runtimeKnown as known, runtimeUnknown as unknown,
  type CrossSignalComparisonResult, type RuntimeObservation, type RuntimeObservationEnvelope, type RuntimeObservationKind,
  type RuntimeSubjectBinding, type RuntimeAvailability, type CanonicalObjectIdentity, type ExecutionPrincipalReference,
} from '@council/canonical-contracts';
import {
  comparePrincipalIdentityDesignTimeVsRuntime, compareDependencyTargetIdentityDesignTimeVsRuntime, compareCrossSignal,
  crossSignalComparisonIdentity, crossSignalComparisonIdentityMaterial,
  type CrossSignalPrincipalComparisonRequest, type CrossSignalDependencyComparisonRequest, type CrossSignalDependencyGovernedState,
} from '../src/cross-signal-comparison.ts';

const org = asOrganisationId('tenant-a');
const foreignOrg = asOrganisationId('tenant-b');
const connectionId = asSourceConnectionId('runtime-a');
const observationId = asRuntimeObservationId('11111111-1111-4111-8111-111111111111');
const subject: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: org, objectId: asCanonicalObjectId('agent-version-1'), kind: 'AGENT_VERSION' };
const evaluatedAt = asIsoTimestamp('2026-09-20T00:00:00.000Z');

function exactBinding(objectId = 'agent-version-1', bindingOrg = org): RuntimeSubjectBinding {
  return {
    state: 'EXACT', agentVersion: { organisationId: bindingOrg, objectId: asCanonicalObjectId(objectId), kind: 'AGENT_VERSION' },
    coordinates: { producerIdentity: 'producer', deploymentReference: known('deployment'), artifactDigest: known('c'.repeat(64)) },
    proof: { organisationId: bindingOrg, connectionId, deploymentBindingId: asRuntimeDeploymentBindingId('binding'), method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' },
  };
}
const unresolvedBinding: RuntimeSubjectBinding = {
  state: 'UNRESOLVED', coordinates: { producerIdentity: 'producer', deploymentReference: unknown('NOT_SUPPLIED'), artifactDigest: unknown('NOT_SUPPLIED') },
  reason: 'MISSING_REVISION_EVIDENCE',
};
const principalSupport = (evidenceOrg = org) => ({ evidence: { organisationId: evidenceOrg, connectionId, observationId }, method: { code: 'DIRECT_RUNTIME_MEASUREMENT' as const, version: '1.0.0' } });
function principal(overrides: Partial<ExecutionPrincipalReference> = {}): ExecutionPrincipalReference {
  return { kind: 'WORKLOAD_IDENTITY', providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload', ...overrides };
}
function targetFor<K extends 'MODEL' | 'TOOL' | 'MCP_SERVER' | 'API'>(kind: K, objectId: string, known_ = true, targetOrg = org) {
  return {
    observed: known({ kind, providerCode: 'provider', sourceReference: objectId }),
    canonical: known_ ? known({
      canonicalObject: { organisationId: targetOrg, objectId: asCanonicalObjectId(objectId), kind },
      proof: { method: 'EXACT_SOURCE_COORDINATES_V1' as const, version: '1.0.0' as const, mappingId: asObjectSourceMappingId('mapping'), providerCode: 'provider',
        sourceObject: { connectionId: asSourceConnectionId('catalog'), externalType: 'x', externalId: asExternalId(objectId) } },
    }) : unknown('NOT_SUPPLIED'),
  };
}
interface FixtureOpts {
  readonly runtimeOrg?: typeof org;
  readonly startedAtUnixNano?: string;
  readonly binding?: RuntimeSubjectBinding;
  readonly principal?: RuntimeAvailability<{ value: ExecutionPrincipalReference; support: ReturnType<typeof principalSupport> }>;
  readonly targetKnown?: boolean;
  readonly targetObjectId?: string;
}
function fixture(kind: RuntimeObservationKind, opts: FixtureOpts = {}): RuntimeObservation {
  const traceId = asRuntimeTraceId('a'.repeat(32)); const spanId = asRuntimeSpanId('b'.repeat(16));
  const common: RuntimeObservationEnvelope = {
    observationId, organisationId: opts.runtimeOrg ?? org, sourceConnection: { connectionId, sourceSystemId: asSourceSystemId('system') },
    sourceSystemId: asSourceSystemId('system'), providerCode: 'provider', sourceConfigurationVersion: '1', sourceEventKey: `${traceId}:${spanId}`,
    traceId, spanId, parent: { state: 'ROOT' }, startedAtUnixNano: asRuntimeUnixNano(opts.startedAtUnixNano ?? '1789516800000000000'),
    endedAtUnixNano: unknown('NOT_SUPPLIED'), sourceObservedAtUnixNano: unknown('NOT_SUPPLIED'), receivedAt: asIsoTimestamp('2026-09-16T00:00:00.000Z'),
    recordedAt: known(asIsoTimestamp('2026-09-16T00:01:00.000Z')),
    binding: opts.binding ?? exactBinding('agent-version-1', opts.runtimeOrg ?? org),
    sourceStatus: 'UNSET', outcome: unknown('NOT_SUPPLIED'), duration: unknown('NOT_SUPPLIED'), error: unknown('NOT_SUPPLIED'),
    context: { principal: opts.principal ?? known({ value: principal(), support: principalSupport(opts.runtimeOrg ?? org) }), environment: unknown('NOT_SUPPLIED'), network: unknown('NOT_SUPPLIED') },
    provenance: { trustState: 'OBSERVED', evidence: { organisationId: opts.runtimeOrg ?? org, connectionId, observationId }, method: { code: 'MANUAL_SPAN', version: '1.0.0' },
      adapterVersion: '1.0.0', schemaVersion: '1.0.0', mappingVersion: '1.0.0',
      instrumentation: { name: 'govia.producer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
      conventions: { coreTraceRevision: '1.41.0', http: unknown('NOT_SUPPLIED'), genai: unknown('UNSUPPORTED'), mcp: unknown('UNSUPPORTED') } },
    coverage: { sampling: known({ mode: 'ALWAYS_ON', rate: 1 }), sampled: known(true), droppedAttributes: unknown('NOT_SUPPLIED'),
      droppedEvents: unknown('NOT_SUPPLIED'), droppedLinks: unknown('NOT_SUPPLIED'), collectionScope: 'OPERATION_ONLY', limitations: [] },
  };
  const targetKnown = opts.targetKnown ?? true; const targetObjectId = opts.targetObjectId ?? 'target-1'; const targetOrg = opts.runtimeOrg ?? org;
  switch (kind) {
    case 'EXECUTION': return { ...common, kind, operation: 'GOVERNANCE_ANSWER', executionScope: 'OPERATION' };
    case 'MODEL_CALL': return { ...common, kind, operation: 'CHAT_COMPLETION', target: targetFor('MODEL', targetObjectId, targetKnown, targetOrg),
      reportedModel: unknown('NOT_SUPPLIED'), tokens: { unit: 'TOKEN', input: unknown('NOT_SUPPLIED'), output: unknown('NOT_SUPPLIED'), total: unknown('NOT_SUPPLIED') },
      cost: { supplied: unknown('NOT_SUPPLIED'), derived: unknown('NOT_SUPPLIED') } };
    case 'TOOL_CALL': return { ...common, kind, operation: 'INVOKE', target: targetFor('TOOL', targetObjectId, targetKnown, targetOrg) };
    case 'MCP_CALL': return { ...common, kind, operation: 'tools/call', target: targetFor('MCP_SERVER', targetObjectId, targetKnown, targetOrg),
      transport: unknown('NOT_SUPPLIED'), toolReference: unknown('NOT_SUPPLIED'), protocolResult: unknown('NOT_SUPPLIED') };
    case 'API_CALL': return { ...common, kind, operation: 'REQUEST', target: targetFor('API', targetObjectId, targetKnown, targetOrg),
      protocol: unknown('NOT_SUPPLIED'), httpMethod: unknown('NOT_SUPPLIED'), httpStatusCode: unknown('NOT_SUPPLIED') };
  }
}
function principalBaseline(overrides: Partial<ExecutionPrincipalReference> = {}, canonicalObject: CanonicalObjectIdentity<'AGENT_VERSION'> = subject) {
  return { canonicalObject, field: 'PRINCIPAL' as const, executionFieldStateId: 'field-state-1', decisionId: 'decision-1', snapshotId: 'snapshot-1', principal: principal(overrides) };
}
function principalRequest(overrides: Partial<CrossSignalPrincipalComparisonRequest> = {}): CrossSignalPrincipalComparisonRequest {
  return { organisationId: org, subject, designTime: principalBaseline(), runtime: fixture('MODEL_CALL'), evaluatedAt, ...overrides };
}
function governedState(overrides: Partial<CrossSignalDependencyGovernedState> = {}): CrossSignalDependencyGovernedState {
  return {
    relationshipId: asRelationshipId('rel-1'), relationshipStateId: asRelationshipStateId('rel-state-1'), decisionId: 'decision-1',
    source: subject, relationshipType: 'USES_MODEL', target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: 'MODEL' },
    validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), ...overrides,
  };
}
function dependencyRequest(overrides: Partial<CrossSignalDependencyComparisonRequest> = {}): CrossSignalDependencyComparisonRequest {
  return { organisationId: org, subject, governedStates: [governedState()], runtime: fixture('MODEL_CALL'), evaluatedAt, ...overrides };
}
const nanosOf = (iso: string): bigint => BigInt(Date.parse(iso)) * 1_000_000n;
// Nanosecond-exact companion to nanosOf above, reusing the same shared M15
// precision helper the implementation itself uses (single source of truth,
// not a second subtly different test-local parsing algorithm).
function preciseNanosOf(iso: string): bigint {
  const nanos = crossSignalTimestampEpochNanos(iso);
  if (nanos === undefined) throw new Error(`test fixture timestamp unparseable: ${iso}`);
  return nanos;
}

// ---------------------------------------------------------------------------
// PRINCIPAL_IDENTITY
// ---------------------------------------------------------------------------

test('1. exact same principal resolves CONSISTENT', () => {
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest());
  assert.equal(result.outcome, 'CONSISTENT');
  assert.equal(result.dimension, 'PRINCIPAL_IDENTITY'); assert.equal(result.pairingMode, 'DESIGN_TIME_VS_RUNTIME');
  assert.deepEqual(result.leftTemporalBasis, { basis: 'NOT_AVAILABLE' });
});

test('2. different principal resolves CONFLICT_CANDIDATE, never DRIFT_CANDIDATE', () => {
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({
    runtime: fixture('MODEL_CALL', { principal: known({ value: principal({ principalReference: 'different' }), support: principalSupport() }) }),
  }));
  assert.equal(result.outcome, 'CONFLICT_CANDIDATE');
});

test('3. unresolved runtime binding resolves INSUFFICIENT_EVIDENCE / RUNTIME_BINDING_UNRESOLVED', () => {
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ runtime: fixture('MODEL_CALL', { binding: unresolvedBinding }) }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'RUNTIME_BINDING_UNRESOLVED');
  // The design-time reference is still real/resolvable evidence; only the runtime subject claim is unproven.
  assert.ok(result.left); assert.ok(result.right);
});

test('4. UNKNOWN runtime principal resolves INSUFFICIENT_EVIDENCE / RUNTIME_PRINCIPAL_NOT_PROVEN, never treated as absent', () => {
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ runtime: fixture('MODEL_CALL', { principal: unknown('NOT_SUPPLIED') }) }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'RUNTIME_PRINCIPAL_NOT_PROVEN');
});

test('5. decidedAt is never part of the request and never influences the outcome', () => {
  // decidedAt does not appear anywhere in CrossSignalPrincipalComparisonRequest;
  // varying evaluatedAt alone (the only time input accepted) leaves outcome unchanged.
  const early = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ evaluatedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z') }));
  const late = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ evaluatedAt: asIsoTimestamp('2030-01-01T00:00:00.000Z') }));
  assert.equal(early.outcome, 'CONSISTENT'); assert.equal(late.outcome, 'CONSISTENT');
});

test('6. cross-tenant subject fails closed before any comparison result', () => {
  assert.throws(() => comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ runtime: fixture('MODEL_CALL', { runtimeOrg: foreignOrg }) })),
    { message: 'CROSS_SIGNAL_SUBJECT_CROSS_TENANT' });
});

test('7. no PRINCIPAL_IDENTITY case ever emits DRIFT_CANDIDATE', () => {
  for (const request of [
    principalRequest(),
    principalRequest({ runtime: fixture('MODEL_CALL', { principal: known({ value: principal({ principalReference: 'different' }), support: principalSupport() }) }) }),
    principalRequest({ designTime: undefined }),
    principalRequest({ runtime: fixture('MODEL_CALL', { binding: unresolvedBinding }) }),
    principalRequest({ runtime: fixture('MODEL_CALL', { principal: unknown('NOT_SUPPLIED') }) }),
  ]) assert.notEqual(comparePrincipalIdentityDesignTimeVsRuntime(request).outcome, 'DRIFT_CANDIDATE');
});

test('missing design-time baseline resolves INSUFFICIENT_EVIDENCE / DESIGN_TIME_BASELINE_MISSING with no left reference', () => {
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ designTime: undefined }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_MISSING');
  assert.equal(result.left, undefined); assert.ok(result.right);
});

test('wrong AGENT_VERSION binding (same tenant) fails closed', () => {
  assert.throws(() => comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ runtime: fixture('MODEL_CALL', { binding: exactBinding('other-agent-version') }) })),
    { message: 'CROSS_SIGNAL_SUBJECT_MISMATCH' });
});

test('principal design-time baseline from another AGENT_VERSION, same tenant, fails closed before any comparison', () => {
  const foreignSubject: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: org, objectId: asCanonicalObjectId('other-agent-version'), kind: 'AGENT_VERSION' };
  assert.throws(() => comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ designTime: principalBaseline({}, foreignSubject) })),
    { message: 'CROSS_SIGNAL_SUBJECT_MISMATCH' });
});

test('principal design-time baseline from another tenant fails closed before any comparison', () => {
  const foreignSubject: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: foreignOrg, objectId: asCanonicalObjectId('agent-version-1'), kind: 'AGENT_VERSION' };
  assert.throws(() => comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ designTime: principalBaseline({}, foreignSubject) })),
    { message: 'CROSS_SIGNAL_SUBJECT_CROSS_TENANT' });
});

// ---------------------------------------------------------------------------
// DEPENDENCY_TARGET_IDENTITY
// ---------------------------------------------------------------------------

test('8. one active target, runtime matches it resolves CONSISTENT', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest());
  assert.equal(result.outcome, 'CONSISTENT');
});

test('9. multiple active targets, runtime matches one resolves CONSISTENT (set membership, not single-target equality)', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [
      governedState({ relationshipStateId: asRelationshipStateId('rel-state-1'), target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: 'MODEL' } }),
      governedState({ relationshipStateId: asRelationshipStateId('rel-state-2'), target: { organisationId: org, objectId: asCanonicalObjectId('target-2'), kind: 'MODEL' } }),
    ],
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('10. active targets exist, runtime matches none resolves CONFLICT_CANDIDATE', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    runtime: fixture('MODEL_CALL', { targetObjectId: 'ungoverned-target' }),
  }));
  assert.equal(result.outcome, 'CONFLICT_CANDIDATE');
});

test('11. only expired state resolves INSUFFICIENT_EVIDENCE / DESIGN_TIME_BASELINE_NOT_EFFECTIVE', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-01-01T00:00:00.000Z'), validTo: asIsoTimestamp('2026-02-01T00:00:00.000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(nanosOf('2026-09-01T00:00:00.000Z')) }),
  }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('12. only a future state resolves the same insufficient result', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2027-01-01T00:00:00.000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(nanosOf('2026-09-01T00:00:00.000Z')) }),
  }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('13. event == validFrom is active (included)', () => {
  const validFrom = '2026-09-01T00:00:00.000Z';
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp(validFrom), validTo: asIsoTimestamp('2026-10-01T00:00:00.000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(nanosOf(validFrom)) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('14. event immediately before validTo is active (included)', () => {
  const validTo = '2026-10-01T00:00:00.000Z';
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), validTo: asIsoTimestamp(validTo) })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(nanosOf(validTo) - 1n) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('15. event == validTo is inactive (excluded)', () => {
  const validTo = '2026-10-01T00:00:00.000Z';
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), validTo: asIsoTimestamp(validTo) })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(nanosOf(validTo)) }),
  }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('16. runtime canonical target UNKNOWN resolves INSUFFICIENT_EVIDENCE / RUNTIME_TARGET_NOT_PROVEN', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ runtime: fixture('MODEL_CALL', { targetKnown: false }) }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'RUNTIME_TARGET_NOT_PROVEN');
});

test('17. unresolved binding resolves INSUFFICIENT_EVIDENCE / RUNTIME_BINDING_UNRESOLVED', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ runtime: fixture('MODEL_CALL', { binding: unresolvedBinding }) }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'RUNTIME_BINDING_UNRESOLVED');
  assert.equal(result.left, undefined);
});

test('18. target kind / relationship type mismatch fails closed', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ relationshipType: 'USES_TOOL', target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: 'TOOL' } })],
  })), { message: 'CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH' });
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ runtime: fixture('EXECUTION') })),
    { message: 'CROSS_SIGNAL_RUNTIME_KIND_UNSUPPORTED' });
});

test('19. shuffled relationship-state input order yields an identical normalized set and result', () => {
  const states = [
    governedState({ relationshipStateId: asRelationshipStateId('rel-state-a'), target: { organisationId: org, objectId: asCanonicalObjectId('target-a'), kind: 'MODEL' } }),
    governedState({ relationshipStateId: asRelationshipStateId('rel-state-b'), target: { organisationId: org, objectId: asCanonicalObjectId('target-b'), kind: 'MODEL' } }),
    governedState({ relationshipStateId: asRelationshipStateId('rel-state-c'), target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: 'MODEL' } }),
  ];
  const forward = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ governedStates: states }));
  const shuffled = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ governedStates: [...states].reverse() }));
  assert.deepEqual(forward.left, shuffled.left);
  assert.deepEqual(forward, { ...shuffled, evaluatedAt: forward.evaluatedAt });
  assert.equal(crossSignalComparisonIdentity(forward), crossSignalComparisonIdentity(shuffled));
});

test('20. no DEPENDENCY_TARGET_IDENTITY case ever emits DRIFT_CANDIDATE', () => {
  for (const request of [
    dependencyRequest(),
    dependencyRequest({ runtime: fixture('MODEL_CALL', { targetObjectId: 'ungoverned-target' }) }),
    dependencyRequest({ governedStates: [] }),
    dependencyRequest({ runtime: fixture('MODEL_CALL', { binding: unresolvedBinding }) }),
    dependencyRequest({ runtime: fixture('MODEL_CALL', { targetKnown: false }) }),
  ]) assert.notEqual(compareDependencyTargetIdentityDesignTimeVsRuntime(request).outcome, 'DRIFT_CANDIDATE');
});

test('runtime kind maps exactly: TOOL_CALL/USES_TOOL, MCP_CALL/USES_MCP, API_CALL/INVOKES', () => {
  const cases: readonly [RuntimeObservationKind, CrossSignalDependencyGovernedState['relationshipType'], 'TOOL' | 'MCP_SERVER' | 'API'][] = [
    ['TOOL_CALL', 'USES_TOOL', 'TOOL'], ['MCP_CALL', 'USES_MCP', 'MCP_SERVER'], ['API_CALL', 'INVOKES', 'API'],
  ];
  for (const [kind, relationshipType, targetKind] of cases) {
    const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
      governedStates: [governedState({ relationshipType, target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: targetKind } })],
      runtime: fixture(kind),
    }));
    assert.equal(result.outcome, 'CONSISTENT');
  }
});

test('cross-tenant dependency subject fails closed', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ runtime: fixture('MODEL_CALL', { runtimeOrg: foreignOrg }) })),
    { message: 'CROSS_SIGNAL_SUBJECT_CROSS_TENANT' });
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ target: { organisationId: foreignOrg, objectId: asCanonicalObjectId('target-1'), kind: 'MODEL' } })],
  })), { message: 'CROSS_SIGNAL_RELATIONSHIP_TYPE_MISMATCH' });
});

test('wrong AGENT_VERSION binding (same tenant) fails closed for dependency comparison too', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ runtime: fixture('MODEL_CALL', { binding: exactBinding('other-agent-version') }) })),
    { message: 'CROSS_SIGNAL_SUBJECT_MISMATCH' });
});

test('dependency governed-state source from another AGENT_VERSION, same tenant, fails closed before effective-set filtering', () => {
  const foreignSource: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: org, objectId: asCanonicalObjectId('other-agent-version'), kind: 'AGENT_VERSION' };
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ governedStates: [governedState({ source: foreignSource })] })),
    { message: 'CROSS_SIGNAL_SUBJECT_MISMATCH' });
});

test('dependency governed-state source from another tenant fails closed before effective-set filtering', () => {
  const foreignSource: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: foreignOrg, objectId: asCanonicalObjectId('agent-version-1'), kind: 'AGENT_VERSION' };
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({ governedStates: [governedState({ source: foreignSource })] })),
    { message: 'CROSS_SIGNAL_SUBJECT_CROSS_TENANT' });
});

test('a relationship matching target/type but sourced from another AGENT_VERSION is never accepted as this subject\'s evidence', () => {
  const foreignSource: CanonicalObjectIdentity<'AGENT_VERSION'> = { organisationId: org, objectId: asCanonicalObjectId('other-agent-version'), kind: 'AGENT_VERSION' };
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ source: foreignSource, target: { organisationId: org, objectId: asCanonicalObjectId('target-1'), kind: 'MODEL' } })],
  })), { message: 'CROSS_SIGNAL_SUBJECT_MISMATCH' });
});

test('malformed validFrom fails closed before Date.parse/effective-set logic can influence a result', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: 'not-a-timestamp' as unknown as ReturnType<typeof asIsoTimestamp> })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
});

test('a validFrom the M15 grammar rejects (no Z/offset) fails closed even with no validTo present, never reaching isEffectiveAt', () => {
  // Date.parse('2026-09-01T00:00:00') is finite (interpreted as local time), so this
  // passes the loose isoTimestamp() gate; only the stricter M15 grammar's own
  // required Z/explicit-offset suffix catches it - and must do so unconditionally,
  // not only when a validTo happens to be present to trigger the pairwise check.
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00') })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
});

test('a validFrom with a Date.parse-accepted but M15-unsupported over-precision fraction fails closed with no validTo present', () => {
  // Date.parse silently accepts and truncates a 10-digit fraction; the M15 grammar
  // caps at 9 fractional digits and refuses to guess which are significant.
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.1234567890Z') })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
});

test('a valid standalone validFrom with microsecond precision and no validTo still resolves correctly end to end', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.123456Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123456000Z')) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('validTo <= validFrom fails closed before effective-set logic', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), validTo: asIsoTimestamp('2026-09-01T00:00:00.000Z') })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), validTo: asIsoTimestamp('2026-08-01T00:00:00.000Z') })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
});

// ---------------------------------------------------------------------------
// M15.1B - nanosecond temporal-boundary precision (never collapsed through
// Date.parse's millisecond truncation)
// ---------------------------------------------------------------------------

test('sub-millisecond boundary: event 1ns before validFrom is not yet effective', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.123456Z'), validTo: asIsoTimestamp('2026-09-01T00:00:01.000000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123455999Z')) }),
  }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('sub-millisecond boundary: event exactly at validFrom to the nanosecond is effective (inclusive lower bound)', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.123456Z'), validTo: asIsoTimestamp('2026-09-01T00:00:01.000000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123456000Z')) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('sub-millisecond boundary: event 1ns before validTo is still effective (exclusive upper bound not yet reached)', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000000Z'), validTo: asIsoTimestamp('2026-09-01T00:00:00.123789Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123788999Z')) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('sub-millisecond boundary: event exactly at validTo to the nanosecond is NOT effective (exclusive upper bound)', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.000000Z'), validTo: asIsoTimestamp('2026-09-01T00:00:00.123789Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123789000Z')) }),
  }));
  assert.equal(result.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.reason, 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE');
});

test('a validFrom/validTo pair within the same JavaScript millisecond is accepted, never collapsed to an equal/invalid interval', () => {
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.123456Z'), validTo: asIsoTimestamp('2026-09-01T00:00:00.123789Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf('2026-09-01T00:00:00.123600000Z')) }),
  }));
  assert.equal(result.outcome, 'CONSISTENT');
});

test('a reversed same-millisecond microsecond interval fails closed, never accepted by a millisecond-collapsed comparison', () => {
  assert.throws(() => compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-09-01T00:00:00.123789Z'), validTo: asIsoTimestamp('2026-09-01T00:00:00.123456Z') })],
  })), { message: 'CROSS_SIGNAL_REQUEST_INVALID' });
});

test('RUNTIME_EVENT_TIME temporal basis preserves startedAtUnixNano to full nanosecond precision, never collapsed to .123Z', () => {
  const instant = '2026-09-01T00:00:00.123456789Z';
  const result = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf(instant)) }),
  }));
  assert.deepEqual(result.rightTemporalBasis, { basis: 'RUNTIME_EVENT_TIME', value: instant });
});

test('RUNTIME_EVENT_TIME precision also holds for the DEPENDENCY_TARGET_IDENTITY dimension', () => {
  const instant = '2026-09-01T00:00:00.987654321Z';
  const result = compareDependencyTargetIdentityDesignTimeVsRuntime(dependencyRequest({
    governedStates: [governedState({ validFrom: asIsoTimestamp('2026-01-01T00:00:00.000Z') })],
    runtime: fixture('MODEL_CALL', { startedAtUnixNano: String(preciseNanosOf(instant)) }),
  }));
  assert.deepEqual(result.rightTemporalBasis, { basis: 'RUNTIME_EVENT_TIME', value: instant });
});

// ---------------------------------------------------------------------------
// GLOBAL
// ---------------------------------------------------------------------------

test('21. RUNTIME_VS_RUNTIME request resolves CROSS_SIGNAL_PAIRING_UNSUPPORTED and no result', () => {
  assert.throws(() => compareCrossSignal({ ...principalRequest(), dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'RUNTIME_VS_RUNTIME' }),
    { message: 'CROSS_SIGNAL_PAIRING_UNSUPPORTED' });
});

test('22. unsupported dimension resolves CROSS_SIGNAL_DIMENSION_UNSUPPORTED and no result', () => {
  assert.throws(() => compareCrossSignal({ ...principalRequest(), dimension: 'TOPOLOGY_DRIFT', pairingMode: 'DESIGN_TIME_VS_RUNTIME' }),
    { message: 'CROSS_SIGNAL_DIMENSION_UNSUPPORTED' });
});

test('23. no Graph/Vector/LLM/canonical-write import path exists in this module', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/cross-signal-comparison.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(new Set(imports), new Set(['node:crypto', '@council/canonical-contracts', './canonical-endpoint-resolution', './runtime-observation.ts']));
});

test('24. input objects remain unmodified', () => {
  const request = principalRequest(); const before = structuredClone(request);
  comparePrincipalIdentityDesignTimeVsRuntime(request);
  assert.deepEqual(request, before);
  const depRequest = dependencyRequest(); const depBefore = structuredClone(depRequest);
  compareDependencyTargetIdentityDesignTimeVsRuntime(depRequest);
  assert.deepEqual(depRequest, depBefore);
});

test('compareCrossSignal dispatches both dimensions identically to their direct functions', () => {
  const viaDispatch = compareCrossSignal({ ...principalRequest(), dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME' });
  const direct = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest());
  assert.deepEqual({ ...viaDispatch, evaluatedAt: direct.evaluatedAt }, direct);
});

test('comparison identity is deterministic from inputs and unaffected by evaluatedAt', () => {
  const a = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ evaluatedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z') }));
  const b = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ evaluatedAt: asIsoTimestamp('2030-01-01T00:00:00.000Z') }));
  assert.notEqual(a.evaluatedAt, b.evaluatedAt);
  assert.equal(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(b));
  // A different design-time state is a different left reference, so identity legitimately changes;
  // the observed value alone (same evidence references) never does - see idempotent replay (ADR §13).
  const differentBaseline = comparePrincipalIdentityDesignTimeVsRuntime(principalRequest({ designTime: { ...principalBaseline(), executionFieldStateId: 'field-state-2' } }));
  assert.notEqual(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(differentBaseline));
});

// -----------------------------------------------------------------------------
// Cross-language deterministic identity (ADR SS13). The database persistence
// boundary (record_cross_signal_comparison_result,
// 20260923060000_cross_signal_persistence_v1.sql) independently re-derives the
// SAME ordered part list from its own validated evidence lookups and hashes it
// with gov_repo.frame_identity + extensions.digest(...,'sha256') - the identical
// algorithm crossSignalComparisonIdentity uses here via frameIdentity + sha256.
// A caller-supplied comparison_id is therefore never authoritative on either
// side. These tests build CrossSignalComparisonResult values directly via
// createCrossSignalComparisonResult, independent of the pure comparison
// functions above, so every identity-relevant field (including method.version,
// which the pure functions hard-code to '1.0.0') can be varied in isolation.
// -----------------------------------------------------------------------------

// Independently computed offline (plain length-prefix concatenation + sha256,
// no code under test involved) for the exact material asserted in the
// known-vector test below - see that test for the full part list.
const KNOWN_PRINCIPAL_IDENTITY_VECTOR = 'cross-signal-comparison:60df32277733917a5ab7e5b055ade3e48ae9875bd4f3c8f858c92ddca1732680';
const efsLeft = { kind: 'EXECUTION_FIELD_STATE' as const, executionFieldStateId: 'efs-1', decisionId: 'decision-1', snapshotId: 'snapshot-1' };
const runtimeRight = { kind: 'RUNTIME_OBSERVATION' as const, observationId, connectionId };
function principalIdentityResult(overrides: {
  left?: typeof efsLeft; right?: typeof runtimeRight; methodVersion?: string; evaluatedAt?: string;
  outcome?: 'CONSISTENT' | 'CONFLICT_CANDIDATE' | 'INSUFFICIENT_EVIDENCE'; reason?: string;
} = {}): CrossSignalComparisonResult {
  return createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    left: overrides.left ?? efsLeft, right: overrides.right ?? runtimeRight,
    method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: overrides.methodVersion ?? '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' }, rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp(overrides.evaluatedAt ?? '2026-09-20T00:05:00.000Z'),
    outcome: overrides.outcome ?? 'CONSISTENT', ...(overrides.reason ? { reason: overrides.reason } : {}),
  });
}
function dependencyIdentityResult(states: readonly { relationshipId: string; relationshipStateId: string; decisionId?: string }[], opts: { evaluatedAt?: string; outcome?: 'CONSISTENT' | 'CONFLICT_CANDIDATE' | 'INSUFFICIENT_EVIDENCE'; reason?: string } = {}): CrossSignalComparisonResult {
  return createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'DEPENDENCY_TARGET_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    left: { kind: 'RELATIONSHIP_STATE_SET', states: states.map(s => ({
      relationshipId: asRelationshipId(s.relationshipId), relationshipStateId: asRelationshipStateId(s.relationshipStateId),
      ...(s.decisionId ? { decisionId: s.decisionId } : {}), validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'),
    })) },
    right: runtimeRight, method: { code: 'CROSS_SIGNAL_DEPENDENCY_TARGET_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'RELATIONSHIP_VALID_FROM_TO_SET' }, rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp(opts.evaluatedAt ?? '2026-09-20T00:05:00.000Z'),
    outcome: opts.outcome ?? 'CONSISTENT', ...(opts.reason ? { reason: opts.reason } : {}),
  });
}

test('identity 1. TypeScript identity is deterministic - identical input always yields the identical id', () => {
  assert.equal(crossSignalComparisonIdentity(principalIdentityResult()), crossSignalComparisonIdentity(principalIdentityResult()));
  assert.deepEqual(crossSignalComparisonIdentityMaterial(principalIdentityResult()), crossSignalComparisonIdentityMaterial(principalIdentityResult()));
});

test('identity 2. relationship members in reverse order produce the same id', () => {
  const forward = dependencyIdentityResult([{ relationshipId: 'rel-a', relationshipStateId: 'rel-a:initial', decisionId: 'decision-a' }, { relationshipId: 'rel-b', relationshipStateId: 'rel-b:initial' }]);
  const reversed = dependencyIdentityResult([{ relationshipId: 'rel-b', relationshipStateId: 'rel-b:initial' }, { relationshipId: 'rel-a', relationshipStateId: 'rel-a:initial', decisionId: 'decision-a' }]);
  assert.equal(crossSignalComparisonIdentity(forward), crossSignalComparisonIdentity(reversed));
});

test('identity 2b. Unicode adversarial case: canonical member order follows explicit UTF-8 byte order, not JavaScript UTF-16 code-unit order', () => {
  // 'rel-x-ＡA' contains a BMP non-ASCII character (U+FF21, FULLWIDTH LATIN
  // CAPITAL LETTER A), padded with one ASCII byte so its UTF-8 byte length
  // (10 bytes) exactly matches the other member's framed length below.
  // 'rel-x-\u{1F600}' contains a supplementary-plane character (U+1F600,
  // GRINNING FACE - a UTF-16 SURROGATE PAIR in JavaScript).
  //
  // JavaScript's default Array.prototype.sort (UTF-16 code-unit order) would
  // place the supplementary-plane member FIRST: its high surrogate code unit
  // (0xD83D) is numerically less than U+FF21 (0xFF21), even though U+1F600's
  // true Unicode code point (0x1F600 = 128512) is far LARGER than U+FF21's
  // (0xFF21 = 65313). UTF-8 byte order preserves true code-point order (a
  // 4-byte UTF-8 sequence for a supplementary-plane code point always starts
  // with a byte >= 0xF0, strictly greater than any 3-byte BMP sequence's
  // leading byte, which is <= 0xEF) and therefore places the BMP member
  // first. This is exactly the divergence class the M15 identity algorithm
  // must never depend on JS default sort or PostgreSQL default/session
  // collation to avoid (ADR SS13; both languages instead compare explicit
  // UTF-8 bytes: Buffer.compare(...,'utf8') here, convert_to(...,'UTF8') in
  // gov_repo.record_cross_signal_comparison_result).
  const bmpMember = { relationshipId: 'rel-x', relationshipStateId: 'rel-x-ＡA' };
  const supplementaryMember = { relationshipId: 'rel-x', relationshipStateId: 'rel-x-\u{1F600}' };

  const bmpFrame = frameIdentity([bmpMember.relationshipId, bmpMember.relationshipStateId, '0', '']);
  const supplementaryFrame = frameIdentity([supplementaryMember.relationshipId, supplementaryMember.relationshipStateId, '0', '']);
  assert.equal(Buffer.byteLength(bmpFrame, 'utf8'), Buffer.byteLength(supplementaryFrame, 'utf8'), 'test fixture must keep both frames the same byte length so the divergence is driven by content, not by frameIdentity\'s own length prefix');
  // Confirms the adversarial premise itself: plain JS default sort disagrees
  // with UTF-8 byte order for these two exact frames.
  assert.deepEqual([bmpFrame, supplementaryFrame].slice().sort(), [supplementaryFrame, bmpFrame]);
  assert.deepEqual([bmpFrame, supplementaryFrame].slice().sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))), [bmpFrame, supplementaryFrame]);

  const forward = dependencyIdentityResult([bmpMember, supplementaryMember]);
  const reversed = dependencyIdentityResult([supplementaryMember, bmpMember]);

  // Reversing caller input still produces the same comparison identity.
  assert.equal(crossSignalComparisonIdentity(forward), crossSignalComparisonIdentity(reversed));

  // The canonical member order in the identity material follows the
  // explicitly defined UTF-8-byte rule: the BMP member's frame appears
  // before the supplementary-plane member's frame - never the reverse,
  // which is what relying on JS's default sort would have produced.
  const material = crossSignalComparisonIdentityMaterial(forward);
  const bmpIndex = material.indexOf(bmpFrame);
  const supplementaryIndex = material.indexOf(supplementaryFrame);
  assert.ok(bmpIndex > -1 && supplementaryIndex > -1, 'both member frames must appear verbatim in the identity material');
  assert.ok(bmpIndex < supplementaryIndex, 'UTF-8 byte order must place the BMP member frame before the supplementary-plane member frame');
});

test('identity 3. evaluatedAt change alone does not change the id', () => {
  const a = principalIdentityResult({ evaluatedAt: '2020-01-01T00:00:00.000Z' });
  const b = principalIdentityResult({ evaluatedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(b));
});

test('identity 4. outcome (and reason) change alone does not change the id', () => {
  const consistent = principalIdentityResult({ outcome: 'CONSISTENT' });
  const conflict = principalIdentityResult({ outcome: 'CONFLICT_CANDIDATE' });
  assert.equal(crossSignalComparisonIdentity(consistent), crossSignalComparisonIdentity(conflict));
});

test('identity 5. a different runtime observation reference changes the id', () => {
  const a = principalIdentityResult();
  const otherObservation = asRuntimeObservationId('22222222-2222-4222-8222-222222222222');
  const b = principalIdentityResult({ right: { kind: 'RUNTIME_OBSERVATION', observationId: otherObservation, connectionId } });
  assert.notEqual(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(b));
  const c = principalIdentityResult({ right: { kind: 'RUNTIME_OBSERVATION', observationId, connectionId: asSourceConnectionId('runtime-b') } });
  assert.notEqual(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(c));
});

test('identity 6. a different relationship-state-set membership changes the id (add/remove/substitute a member)', () => {
  const base = dependencyIdentityResult([{ relationshipId: 'rel-a', relationshipStateId: 'rel-a:initial' }]);
  const added = dependencyIdentityResult([{ relationshipId: 'rel-a', relationshipStateId: 'rel-a:initial' }, { relationshipId: 'rel-b', relationshipStateId: 'rel-b:initial' }]);
  const substituted = dependencyIdentityResult([{ relationshipId: 'rel-c', relationshipStateId: 'rel-c:initial' }]);
  const empty = dependencyIdentityResult([], { outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE' });
  const ids = [base, added, substituted, empty].map(crossSignalComparisonIdentity);
  assert.equal(new Set(ids).size, ids.length, 'every distinct membership must produce a distinct id');
});

test('identity 7. a different principal executionFieldStateId changes the id (already covered above; re-asserted here for the full adversarial set)', () => {
  const a = principalIdentityResult();
  const b = principalIdentityResult({ left: { ...efsLeft, executionFieldStateId: 'efs-2' } });
  assert.notEqual(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(b));
});

test('identity 8. a different method version changes the id', () => {
  const a = principalIdentityResult({ methodVersion: '1.0.0' });
  const b = principalIdentityResult({ methodVersion: '1.1.0' });
  assert.notEqual(crossSignalComparisonIdentity(a), crossSignalComparisonIdentity(b));
});

test('identity: an absent left reference is distinct from a present RELATIONSHIP_STATE_SET with zero members', () => {
  const absentLeft = createCrossSignalComparisonResult({
    organisationId: org, subject, dimension: 'PRINCIPAL_IDENTITY', pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    right: runtimeRight, method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' }, rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME', value: asIsoTimestamp('2026-09-20T00:00:00.000Z') },
    evaluatedAt: asIsoTimestamp('2026-09-20T00:05:00.000Z'), outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_MISSING',
  });
  const emptySet = dependencyIdentityResult([], { outcome: 'INSUFFICIENT_EVIDENCE', reason: 'DESIGN_TIME_BASELINE_NOT_EFFECTIVE' });
  assert.notEqual(crossSignalComparisonIdentity(absentLeft), crossSignalComparisonIdentity(emptySet));
});

test('identity material: known-vector regression lock for the frame + sha256 algorithm', () => {
  const result = principalIdentityResult();
  assert.deepEqual(crossSignalComparisonIdentityMaterial(result), [
    'CROSS_SIGNAL_COMPARISON_V1', 'tenant-a', 'tenant-a', 'agent-version-1', 'AGENT_VERSION',
    'PRINCIPAL_IDENTITY', 'DESIGN_TIME_VS_RUNTIME', 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', '1.0.0',
    'LEFT_EXECUTION_FIELD_STATE', 'efs-1', 'decision-1', 'snapshot-1',
    'RIGHT_RUNTIME_OBSERVATION', observationId, connectionId,
  ]);
  // Independently re-derives the same value using directly-imported primitives
  // (frameIdentity + createHash), not by calling crossSignalComparisonIdentity's
  // own internals a second time - proves the export matches its documented formula.
  assert.equal(crossSignalComparisonIdentity(result),
    'cross-signal-comparison:' + createHash('sha256').update(frameIdentity(crossSignalComparisonIdentityMaterial(result))).digest('hex'));
  // Fixed known-vector regression lock: this exact hex digest must never change
  // for this exact input unless the framing/hashing algorithm itself changes.
  assert.equal(crossSignalComparisonIdentity(result), KNOWN_PRINCIPAL_IDENTITY_VECTOR);
});

test('no code in this slice assigns VALIDATED', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/cross-signal-comparison.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('VALIDATED'));
});
