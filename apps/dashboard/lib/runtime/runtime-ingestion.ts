import 'server-only';
import {
  persistRuntimeObservation,
  type RuntimePersistenceContext, type RuntimePersistenceResult,
} from '../governance/runtime-persistence';
import type { OtelAdapterContext, SupportedOtelSpan } from './otel-contract';
import { adaptOtelSpan } from './otel-span-adapter';

export type RuntimeIngestionErrorCode =
  | 'RUNTIME_INGESTION_CONTEXT_MISMATCH'
  | 'RUNTIME_INGESTION_ADAPTER_REJECTED'
  | 'RUNTIME_INGESTION_ADMISSION_REJECTED'
  | 'RUNTIME_INGESTION_READBACK_INVALID';

/** Closed, value-free failure. Never carries telemetry, database details or cause. */
export class RuntimeIngestionError extends Error {
  constructor(readonly code: RuntimeIngestionErrorCode) {
    super(code);
    this.name = 'RuntimeIngestionError';
  }
}

/** Internal server orchestration only; both contexts must already be authorized.
 * This function does not authenticate or load source configuration. observationId
 * and server-owned receivedAt come from adapterContext, never from telemetry.
 * The adapter alone consumes the raw snapshot. M14.2 owns admission, validation,
 * durable readback and replay; its original result is returned without rewriting.
 */
export async function ingestSupportedRuntimeSpan(
  persistenceContext: RuntimePersistenceContext,
  adapterContext: OtelAdapterContext,
  span: SupportedOtelSpan,
): Promise<RuntimePersistenceResult> {
  if (persistenceContext.organisationId !== adapterContext.organisationId ||
    persistenceContext.connectionId !== adapterContext.connectionId) {
    throw new RuntimeIngestionError('RUNTIME_INGESTION_CONTEXT_MISMATCH');
  }

  const adapted = adaptOtelSpan(adapterContext, span);
  if (adapted.state === 'REJECTED') {
    throw new RuntimeIngestionError('RUNTIME_INGESTION_ADAPTER_REJECTED');
  }

  try {
    return await persistRuntimeObservation(persistenceContext, adapted.observation);
  } catch (error) {
    // Recognize only M14.2's exact safe readback sentinel; all other failures
    // collapse to admission rejection. No upstream message or cause is exposed.
    const code = error instanceof Error && error.message === 'RUNTIME_READBACK_INVALID'
      ? 'RUNTIME_INGESTION_READBACK_INVALID' : 'RUNTIME_INGESTION_ADMISSION_REJECTED';
    throw new RuntimeIngestionError(code);
  }
}
