import assert from 'node:assert/strict';
import {
  asOrganisationId, asSourceConnectionId, asSourceSystemId, asIsoTimestamp, asCanonicalObjectId, asObjectSourceMappingId, asExternalId,
  asRuntimeObservationId, asRuntimeTraceId, asRuntimeSpanId, asRuntimeUnixNano, asRuntimeDurationNano, asRuntimeDecimal, asRuntimeDeploymentBindingId,
  runtimeKnown as known, runtimeUnknown as unknown, type RuntimeObservation, type RuntimeObservationEnvelope,
  type RuntimeObservationKind, type RuntimeSubjectBinding, type RuntimeDerivedCost,
} from '@council/canonical-contracts';
const org = asOrganisationId('14200000-0917-4142-8142-000000000001');
const connectionId = asSourceConnectionId('m142-20260917-runtime-a');
const id = asRuntimeObservationId('14200000-0917-4142-8142-000000000001');
const missing = () => unknown('NOT_SUPPLIED');
const evidence = () => ({ organisationId: org, connectionId, observationId: id });
export function fixture(kind: RuntimeObservationKind = 'MODEL_CALL'): RuntimeObservation {
  const traceId = asRuntimeTraceId('a'.repeat(32)); const spanId = asRuntimeSpanId('b'.repeat(16));
  const common: RuntimeObservationEnvelope = {
    observationId: id, organisationId: org, sourceConnection: { connectionId, sourceSystemId: asSourceSystemId('system') },
    sourceSystemId: asSourceSystemId('system'), providerCode: 'provider', sourceConfigurationVersion: '1', sourceEventKey: `${traceId}:${spanId}`,
    traceId, spanId, parent: { state: 'ROOT' }, startedAtUnixNano: asRuntimeUnixNano('1789516800000000001'),
    endedAtUnixNano: missing(), sourceObservedAtUnixNano: missing(), receivedAt: asIsoTimestamp('2026-09-16T00:00:00.000Z'), recordedAt: missing(),
    binding: { state: 'UNRESOLVED', coordinates: { producerIdentity: 'producer', deploymentReference: missing(), artifactDigest: missing() }, reason: 'MISSING_REVISION_EVIDENCE' },
    sourceStatus: 'UNSET', outcome: missing(), duration: missing(), error: missing(),
    context: { principal: missing(), environment: missing(), network: missing() },
    provenance: { trustState: 'OBSERVED', evidence: evidence(), method: { code: 'MANUAL_SPAN', version: '1.0.0' },
      adapterVersion: '1.0.0', schemaVersion: '1.0.0', mappingVersion: '1.0.0',
      instrumentation: { name: 'govia.producer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
      conventions: { coreTraceRevision: '1.41.0', http: missing(), genai: unknown('UNSUPPORTED'), mcp: unknown('UNSUPPORTED') } },
    coverage: { sampling: known({ mode: 'ALWAYS_ON', rate: 1 }), sampled: known(true), droppedAttributes: missing(), droppedEvents: missing(),
      droppedLinks: missing(), collectionScope: 'OPERATION_ONLY', limitations: ['PARTIAL_COLLECTION'] },
  };
  switch (kind) {
    case 'EXECUTION': return { ...common, kind, operation: 'GOVERNANCE_ANSWER', executionScope: 'OPERATION' };
    case 'MODEL_CALL': return { ...common, kind, operation: 'CHAT_COMPLETION',
      target: { observed: known({ kind: 'MODEL', providerCode: 'provider', sourceReference: 'requested-model' }), canonical: missing() }, reportedModel: missing(),
      tokens: { unit: 'TOKEN', input: missing(), output: missing(), total: missing() }, cost: { supplied: missing(), derived: missing() } };
    case 'TOOL_CALL': return { ...common, kind, operation: 'INVOKE', target: { observed: missing(), canonical: missing() } };
    case 'MCP_CALL': return { ...common, kind, operation: 'tools/call', target: { observed: missing(), canonical: missing() }, transport: known('STDIO'), toolReference: missing(), protocolResult: missing() };
    case 'API_CALL': return { ...common, kind, operation: 'REQUEST', target: { observed: missing(), canonical: missing() }, protocol: known('HTTP'), httpMethod: known('GET'), httpStatusCode: missing() };
  }
}
export function exact(): RuntimeSubjectBinding {
  return { state: 'EXACT', agentVersion: { organisationId: org, objectId: asCanonicalObjectId('m142-version'), kind: 'AGENT_VERSION' },
    coordinates: { producerIdentity: 'producer', deploymentReference: known('deployment'), artifactDigest: known('c'.repeat(64)) },
    proof: { organisationId: org, connectionId, deploymentBindingId: asRuntimeDeploymentBindingId('binding'), method: 'VERIFIED_RELEASE_ASSOCIATION_V1', version: '1.0.0' } };
}
export function derived(): RuntimeDerivedCost {
  return { kind: 'DERIVED', amount: asRuntimeDecimal('0.000001'), currency: 'USD', scope: { kind: 'SINGLE_CALL', observationId: id },
    pricing: { sourceReference: 'tariff', version: '1', effectiveFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'), effectiveUntil: missing(),
      providerCode: 'provider', modelReference: 'reported-model', serviceTier: 'standard', inputRate: asRuntimeDecimal('0.10'), outputRate: asRuntimeDecimal('0.20'),
      rateUnit: 'PER_MILLION_TOKENS', inputCoverage: 'ALL_INPUT_TOKENS', outputCoverage: 'ALL_OUTPUT_TOKENS', adjustments: 'NONE_APPLICABLE' },
    usageInputs: { unit: 'TOKEN', input: 2, output: 4 }, calculation: { method: 'FLAT_TWO_BUCKET_TOKEN_TARIFF', version: '1.0.0', rounding: 'HALF_EVEN', decimalPlaces: 9, roundingStage: 'FINAL_SUM' } };
}
export function modelWithCost(): RuntimeObservation {
  const base = fixture(); assert.equal(base.kind, 'MODEL_CALL'); if (base.kind !== 'MODEL_CALL') throw new Error('TEST_FIXTURE_INVALID');
  return { ...base, reportedModel: known('reported-model'), tokens: { unit: 'TOKEN', input: known(2), output: known(4), total: missing() },
    cost: { supplied: known({ kind: 'SUPPLIED', amount: asRuntimeDecimal('0.000002'), currency: 'USD', scope: { kind: 'SINGLE_CALL', observationId: id },
      source: { evidence: evidence(), chargeReference: 'charge' } }), derived: known(derived()) } };
}
