import { createRuntimeObservation, type RuntimeEvidenceReference, type RuntimeObservation } from '@council/canonical-contracts';

function reject(code: 'RUNTIME_SOURCE_MISMATCH' | 'RUNTIME_EVENT_IDENTITY_INVALID' | 'RUNTIME_REFERENCE_INVALID'
  | 'RUNTIME_BINDING_INVALID' | 'RUNTIME_TARGET_INVALID' | 'RUNTIME_TIME_INVALID' | 'RUNTIME_OUTCOME_INVALID'
  | 'RUNTIME_COST_INVALID' | 'RUNTIME_COVERAGE_INVALID' | 'RUNTIME_PROTOCOL_INVALID'): never {
  throw new TypeError(code);
}

/**
 * Pure domain validation. Returns an isolated, deeply frozen value. It does not
 * authenticate a tenant, verify database existence, resolve a binding, establish
 * source support, admit telemetry or grant authority. Those are later-wave gates.
 */
export function validateRuntimeObservation(value: unknown): RuntimeObservation {
  const observation = createRuntimeObservation(value);
  const { organisationId, sourceConnection, binding } = observation;
  const checkEvidence = (reference: RuntimeEvidenceReference): void => {
    if (reference.organisationId !== organisationId || reference.connectionId !== sourceConnection.connectionId ||
      reference.observationId !== observation.observationId) reject('RUNTIME_REFERENCE_INVALID');
  };
  if (sourceConnection.sourceSystemId !== observation.sourceSystemId) reject('RUNTIME_SOURCE_MISMATCH');
  if (observation.sourceEventKey !== `${observation.traceId}:${observation.spanId}` ||
    (observation.parent.state === 'SPAN_REFERENCE' && observation.parent.parentSpanId === observation.spanId)) reject('RUNTIME_EVENT_IDENTITY_INVALID');
  checkEvidence(observation.provenance.evidence);
  for (const context of [observation.context.principal, observation.context.environment, observation.context.network]) {
    if (context.state === 'KNOWN') checkEvidence(context.value.support.evidence);
  }
  if (binding.state === 'EXACT') {
    if (binding.agentVersion.organisationId !== organisationId || binding.proof.organisationId !== organisationId ||
      binding.proof.connectionId !== sourceConnection.connectionId || binding.coordinates.deploymentReference.state !== 'KNOWN' ||
      binding.coordinates.artifactDigest.state !== 'KNOWN') reject('RUNTIME_BINDING_INVALID');
  }
  if (observation.kind !== 'EXECUTION') {
    const { observed, canonical } = observation.target;
    if (canonical.state === 'KNOWN' && (observed.state !== 'KNOWN' || canonical.value.canonicalObject.organisationId !== organisationId ||
      canonical.value.proof.providerCode !== observed.value.providerCode || canonical.value.proof.sourceObject.externalId !== observed.value.sourceReference)) reject('RUNTIME_TARGET_INVALID');
  }
  const start = BigInt(observation.startedAtUnixNano);
  if (observation.endedAtUnixNano.state === 'KNOWN' && BigInt(observation.endedAtUnixNano.value) < start) reject('RUNTIME_TIME_INVALID');
  if (observation.recordedAt.state === 'UNKNOWN' && observation.recordedAt.reason !== 'NOT_SUPPLIED') reject('RUNTIME_TIME_INVALID');
  if (observation.duration.state === 'KNOWN' && observation.duration.value.basis === 'START_END_DIFFERENCE') {
    if (observation.endedAtUnixNano.state !== 'KNOWN' ||
      BigInt(observation.duration.value.value) !== BigInt(observation.endedAtUnixNano.value) - start) reject('RUNTIME_TIME_INVALID');
  }
  // Different clocks are not ordered against server receipt/recording clocks.
  const outcome = observation.outcome;
  if (outcome.state !== 'UNKNOWN') {
    if (outcome.basis === 'OTEL_STATUS' && !((observation.sourceStatus === 'OK' && outcome.state === 'SUCCESS') ||
      (observation.sourceStatus === 'ERROR' && outcome.state === 'ERROR'))) reject('RUNTIME_OUTCOME_INVALID');
    if (outcome.basis === 'HTTP_STATUS') {
      if (observation.kind !== 'API_CALL' || observation.httpStatusCode.state !== 'KNOWN') reject('RUNTIME_OUTCOME_INVALID');
      const status = observation.httpStatusCode.value;
      if (!(status >= 200 && status < 300 ? outcome.state === 'SUCCESS' : status >= 400 && outcome.state === 'FAILURE')) reject('RUNTIME_OUTCOME_INVALID');
    }
    if (outcome.state === 'SUCCESS' && (observation.sourceStatus === 'ERROR' || observation.error.state === 'KNOWN')) reject('RUNTIME_OUTCOME_INVALID');
  }
  if (observation.kind === 'API_CALL') {
    if ((observation.httpMethod.state === 'KNOWN' || observation.httpStatusCode.state === 'KNOWN') &&
      (observation.protocol.state !== 'KNOWN' || !['HTTP', 'GRAPHQL'].includes(observation.protocol.value))) reject('RUNTIME_PROTOCOL_INVALID');
  }
  if (observation.kind === 'MCP_CALL') {
    if (observation.toolReference.state === 'KNOWN' && observation.operation !== 'tools/call') reject('RUNTIME_PROTOCOL_INVALID');
    if (observation.protocolResult.state === 'KNOWN' && outcome.state !== 'UNKNOWN' && outcome.basis === 'DIRECT_RESULT' &&
      (observation.protocolResult.value === 'SUCCESS' ? outcome.state !== 'SUCCESS' : !['ERROR', 'FAILURE'].includes(outcome.state))) reject('RUNTIME_OUTCOME_INVALID');
  }
  if (observation.coverage.sampling.state === 'KNOWN' && observation.coverage.sampling.value.mode === 'ALWAYS_ON' &&
    observation.coverage.sampling.value.rate !== 1) reject('RUNTIME_COVERAGE_INVALID');
  if (observation.kind === 'MODEL_CALL') {
    const { supplied, derived } = observation.cost;
    if (supplied.state === 'KNOWN') {
      if (supplied.value.scope.observationId !== observation.observationId) reject('RUNTIME_COST_INVALID');
      checkEvidence(supplied.value.source.evidence);
    }
    if (derived.state === 'KNOWN') {
      const cost = derived.value;
      if (cost.scope.observationId !== observation.observationId || observation.target.observed.state !== 'KNOWN' ||
        cost.pricing.providerCode !== observation.target.observed.value.providerCode || observation.reportedModel.state !== 'KNOWN' ||
        cost.pricing.modelReference !== observation.reportedModel.value ||
        observation.tokens.input.state !== 'KNOWN' || observation.tokens.output.state !== 'KNOWN' ||
        cost.usageInputs.input !== observation.tokens.input.value || cost.usageInputs.output !== observation.tokens.output.value) reject('RUNTIME_COST_INVALID');
      const from = BigInt(Date.parse(cost.pricing.effectiveFrom)) * BigInt(1000000);
      if (start < from) reject('RUNTIME_COST_INVALID');
      if (cost.pricing.effectiveUntil.state === 'KNOWN') {
        const until = BigInt(Date.parse(cost.pricing.effectiveUntil.value)) * BigInt(1000000);
        if (until <= from || start >= until) reject('RUNTIME_COST_INVALID');
      }
    }
    // No token inference, pricing calculation or supplied/derived spend aggregation.
  }
  return observation;
}
