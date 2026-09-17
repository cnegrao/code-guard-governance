import 'server-only';
import type { OrganisationId, RuntimeObservation, SourceConnectionId } from '@council/canonical-contracts';
import { validateRuntimeObservation, validatePersistedRuntimeObservation } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { runtimeFromRow, runtimeToRow } from './runtime-row';

/** Supplied by trusted server orchestration, never by raw telemetry or HTTP headers. */
export interface RuntimePersistenceContext {
  readonly organisationId: OrganisationId;
  readonly connectionId: SourceConnectionId;
}
export interface RuntimePersistenceResult {
  readonly replay: boolean;
  readonly observation: RuntimeObservation;
}
const safeErrors = new Set([
  'RUNTIME_REPLAY_CONFLICT', 'RUNTIME_SOURCE_INACTIVE', 'RUNTIME_CONFIGURATION_MISMATCH',
  'RUNTIME_SOURCE_MISMATCH', 'RUNTIME_ADMISSION_WINDOW_CLOSED', 'RUNTIME_PAYLOAD_LIMIT',
  'RUNTIME_QUOTA_EXHAUSTED', 'RUNTIME_FACT_UNSUPPORTED', 'RUNTIME_COORDINATE_NOT_APPROVED',
  'RUNTIME_BINDING_INVALID', 'RUNTIME_TARGET_INVALID', 'RUNTIME_OBSERVATION_INVALID',
]);

/** Service RPC only. Does not register sources, resolve identity or accept raw spans. */
export async function persistRuntimeObservation(context: RuntimePersistenceContext, input: RuntimeObservation): Promise<RuntimePersistenceResult> {
  const observation = validateRuntimeObservation(input);
  const { organisationId, connectionId } = context;
  if (observation.organisationId !== organisationId || observation.sourceConnection.connectionId !== connectionId) {
    throw new Error('RUNTIME_SOURCE_MISMATCH');
  }
  let response;
  try {
    response = await privilegedDb.rpc('admit_runtime_observation', {
      p_organisation_id: organisationId, p_connection_id: connectionId, p_observation: runtimeToRow(observation),
    });
  } catch { throw new Error('RUNTIME_ADMISSION_REJECTED'); }
  const { data, error } = response;
  if (error) throw new Error(safeErrors.has(error.message) ? error.message : 'RUNTIME_ADMISSION_REJECTED');
  try {
    if (!Array.isArray(data) || data.length !== 1 || typeof data[0]?.replay !== 'boolean') throw new Error();
    const persisted = validatePersistedRuntimeObservation(runtimeFromRow(data[0].observation));
    if (persisted.organisationId !== organisationId || persisted.sourceConnection.connectionId !== connectionId ||
      persisted.traceId !== observation.traceId || persisted.spanId !== observation.spanId ||
      persisted.sourceConfigurationVersion !== observation.sourceConfigurationVersion) throw new Error();
    return Object.freeze({ replay: data[0].replay, observation: persisted });
  } catch { throw new Error('RUNTIME_READBACK_INVALID'); }
}
