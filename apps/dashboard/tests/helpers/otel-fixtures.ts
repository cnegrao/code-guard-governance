import {
  asIsoTimestamp, asOrganisationId, asRuntimeObservationId, asSourceConnectionId,
  asSourceSystemId, type RuntimeObservationKind,
} from '@council/canonical-contracts';
import type { OtelAdapterContext, SupportedOtelSpan } from '../../lib/runtime/otel-contract';

/** Synthetic adapter fixtures only; no producer execution or database admission. */
export function otelContext(): OtelAdapterContext {
  return {
    organisationId: asOrganisationId('14300000-0917-4143-8143-000000000001'),
    connectionId: asSourceConnectionId('runtime-fixture'), sourceSystemId: asSourceSystemId('otel-fixture'),
    providerCode: 'govia', sourceConfigurationVersion: 'fixture-v1',
    observationId: asRuntimeObservationId('14300000-0917-4143-8143-000000000002'),
    receivedAt: asIsoTimestamp('2026-09-17T20:00:00.000Z'), producerIdentity: 'fixture-producer',
    instrumentation: { name: 'govia.fixture', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1' },
    supportedKinds: ['EXECUTION', 'MODEL_CALL', 'TOOL_CALL', 'MCP_CALL', 'API_CALL'],
    supportedFacts: ['END_TIME', 'SOURCE_TIME', 'PARENT', 'TARGET', 'CANONICAL_TARGET', 'EXACT_BINDING',
      'OUTCOME', 'DURATION', 'ERROR', 'TOKENS', 'SAMPLING', 'DROPPED_COUNTS', 'PROTOCOL'],
    approvedTargets: [
      { kind: 'MODEL', providerCode: 'fixture', sourceReference: 'model-v1' },
      { kind: 'TOOL', providerCode: 'fixture', sourceReference: 'tool-v1' },
      { kind: 'MCP_SERVER', providerCode: 'fixture', sourceReference: 'mcp-v1' },
      { kind: 'API', providerCode: 'fixture', sourceReference: 'api-v1' },
    ],
    approvedModels: ['model-v1'], approvedTools: ['tool-v1'],
    approvedDeployments: [{ reference: 'release-v1', artifactDigest: 'c'.repeat(64) }],
  };
}

export function otelSpan(kind: RuntimeObservationKind = 'EXECUTION'): SupportedOtelSpan {
  const operations = { EXECUTION: 'GOVERNANCE_ANSWER', MODEL_CALL: 'CHAT_COMPLETION', TOOL_CALL: 'INVOKE',
    MCP_CALL: 'tools/call', API_CALL: 'REQUEST' } as const;
  const targets = { MODEL_CALL: 'model-v1', TOOL_CALL: 'tool-v1', MCP_CALL: 'mcp-v1', API_CALL: 'api-v1' } as const;
  return {
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), startTimeUnixNano: '1789675200000000001',
    status: { code: 0 }, instrumentationScope: { name: 'govia.fixture', version: '1.0.0' },
    resource: { 'govia.producer.id': 'fixture-producer', 'telemetry.sdk.name': 'opentelemetry', 'telemetry.sdk.version': '2.0.1' },
    attributes: { 'govia.observation.kind': kind, 'govia.operation': operations[kind],
      ...(kind === 'EXECUTION' ? {} : { 'govia.target.provider': 'fixture', 'govia.target.reference': targets[kind] }) },
  };
}
