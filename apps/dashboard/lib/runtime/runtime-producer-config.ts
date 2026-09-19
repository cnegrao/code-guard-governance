import 'server-only';
import { z } from 'zod';
import { asOrganisationId, asSourceConnectionId, asSourceSystemId } from '@council/canonical-contracts';
import type { OtelAdapterContext } from './otel-contract';
import { OPENAI_GOVERNANCE_MODEL } from './openai-answer-metadata';

export const OPENAI_INSTRUMENTATION = Object.freeze({
  name: 'govia.openai.governance-answer', version: '1.0.0', sdkName: 'opentelemetry', sdkVersion: '2.0.1',
});
export const OPENAI_RUNTIME_FACTS = Object.freeze([
  'END_TIME', 'PARENT', 'TARGET', 'OUTCOME', 'DURATION', 'ERROR', 'TOKENS', 'SAMPLING', 'DROPPED_COUNTS',
] as const);
export type RuntimeProducerSource = Omit<OtelAdapterContext, 'observationId' | 'receivedAt'>;
export type RuntimeProducerErrorCode = 'RUNTIME_PRODUCER_CONFIGURATION_INVALID' | 'RUNTIME_PRODUCER_SETUP_FAILED'
  | 'RUNTIME_PRODUCER_BRIDGE_FAILED' | 'RUNTIME_PRODUCER_INGESTION_FAILED' | 'RUNTIME_PRODUCER_TIMEOUT';

const reference = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(value => !/(?:sk[-_]|gh[pousr]_|AKIA|eyJ|password|secret|authorization|bearer|cookie|api[-_]?key|access[-_]?token)/i.test(value));
const schema = z.object({
  organisationId: z.string().uuid(), connectionId: reference, sourceSystemId: reference,
  providerCode: reference, sourceConfigurationVersion: reference, producerIdentity: reference,
  instrumentation: z.object({ name: z.literal(OPENAI_INSTRUMENTATION.name), version: z.literal('1.0.0'),
    sdkName: z.literal('opentelemetry'), sdkVersion: z.literal('2.0.1') }).strict(),
  supportedKinds: z.tuple([z.literal('EXECUTION'), z.literal('MODEL_CALL')]),
  supportedFacts: z.array(z.enum(OPENAI_RUNTIME_FACTS)).length(OPENAI_RUNTIME_FACTS.length)
    .refine(values => new Set(values).size === OPENAI_RUNTIME_FACTS.length),
  approvedModels: z.tuple([z.literal(OPENAI_GOVERNANCE_MODEL)]),
  approvedTargets: z.array(z.never()).length(0), approvedTools: z.array(z.never()).length(0),
  approvedDeployments: z.array(z.never()).length(0),
}).strict();

export type ProducerConfiguration = { readonly state: 'DISABLED' }
  | { readonly state: 'INVALID'; readonly code: 'RUNTIME_PRODUCER_CONFIGURATION_INVALID' }
  | { readonly state: 'ENABLED'; readonly source: RuntimeProducerSource };

/** Deployment-owned, credential-free projection of an ALREADY authorized M14.2
 * configuration. Strictly tenant-bound; no fallback connection, source registration,
 * privileged SELECT, inferred binding or telemetry-derived authority.
 */
export function loadRuntimeProducerConfiguration(organisationId: string): ProducerConfiguration {
  if (process.env.GOVIA_RUNTIME_OPENAI_ENABLED !== '1') return { state: 'DISABLED' };
  const invalid = { state: 'INVALID', code: 'RUNTIME_PRODUCER_CONFIGURATION_INVALID' } as const;
  try {
    const raw = process.env.GOVIA_RUNTIME_OPENAI_SOURCE;
    if (!raw || Buffer.byteLength(raw, 'utf8') > 8192) return invalid;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.organisationId !== organisationId) return invalid;
    const data = parsed.data;
    return { state: 'ENABLED', source: Object.freeze({
      organisationId: asOrganisationId(organisationId), connectionId: asSourceConnectionId(data.connectionId),
      sourceSystemId: asSourceSystemId(data.sourceSystemId), providerCode: data.providerCode,
      sourceConfigurationVersion: data.sourceConfigurationVersion, producerIdentity: data.producerIdentity,
      instrumentation: OPENAI_INSTRUMENTATION, supportedKinds: Object.freeze(data.supportedKinds),
      supportedFacts: Object.freeze(data.supportedFacts), approvedModels: Object.freeze(data.approvedModels),
      approvedTargets: Object.freeze([]), approvedTools: Object.freeze([]), approvedDeployments: Object.freeze([]),
    }) };
  } catch { return invalid; }
}
