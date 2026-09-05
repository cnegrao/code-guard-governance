import { createHash, randomUUID } from 'node:crypto';

import {
  ACQUISITION_MODE,
  ACQUISITION_STATUS,
  asAcquisitionRunId,
  asIsoTimestamp,
  asSourceConnectionId,
  asSourceSystemId,
  providerReference,
  type AcquisitionRun,
  type AcquisitionStatus,
  type SourceConnectionReference,
  type SourceSystem,
} from '@council/canonical-contracts';

import type { SourceAdapter, SourceDescriptor } from './source-adapter';

/** Injectable so tests can produce deterministic timestamps/run identity. */
export interface ProvenanceClock {
  now(): string;
}

export const systemClock: ProvenanceClock = {
  now: () => new Date().toISOString(),
};

function stableConnectionSeed(descriptor: SourceDescriptor): string {
  return createHash('sha256')
    .update(`${descriptor.providerCode}:${descriptor.displayName}`)
    .digest('hex')
    .slice(0, 32);
}

/** Deterministic given the same descriptor: repeated runs reuse the same identity. */
export function createSourceSystem(descriptor: SourceDescriptor): SourceSystem {
  return {
    sourceSystemId: asSourceSystemId(`source-system:${descriptor.providerCode}`),
    family: descriptor.family,
    displayName: descriptor.displayName,
    provider: providerReference(descriptor.providerCode),
  };
}

export function createSourceConnection(
  system: SourceSystem,
  descriptor: SourceDescriptor,
): SourceConnectionReference {
  return {
    connectionId: asSourceConnectionId(
      `source-connection:${stableConnectionSeed(descriptor)}`,
    ),
    sourceSystemId: system.sourceSystemId,
  };
}

export function startAcquisitionRun(
  adapter: SourceAdapter,
  connection: SourceConnectionReference,
  clock: ProvenanceClock = systemClock,
): AcquisitionRun {
  return {
    runId: asAcquisitionRunId(`acquisition-run:${randomUUID()}`),
    connection,
    mode: ACQUISITION_MODE.FULL,
    status: ACQUISITION_STATUS.RUNNING,
    adapterName: adapter.adapterName,
    adapterVersion: adapter.adapterVersion,
    startedAt: asIsoTimestamp(clock.now()),
  };
}

export function completeAcquisitionRun(
  run: AcquisitionRun,
  status: Extract<AcquisitionStatus, 'SUCCEEDED' | 'PARTIAL' | 'FAILED'>,
  clock: ProvenanceClock = systemClock,
): AcquisitionRun {
  return {
    ...run,
    status,
    completedAt: asIsoTimestamp(clock.now()),
  };
}
