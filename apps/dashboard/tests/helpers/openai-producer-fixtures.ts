import { OPENAI_INSTRUMENTATION, OPENAI_RUNTIME_FACTS } from '../../lib/runtime/runtime-producer-config';

/** Deterministic fixture only. Never an authorization or live source registration. */
export function openaiSourceConfiguration() {
  return {
    organisationId: '14400000-0918-4144-8144-000000000001', connectionId: 'm144-unit-source',
    sourceSystemId: 'govia-runtime', providerCode: 'govia', sourceConfigurationVersion: 'unit-v1',
    producerIdentity: 'm144-unit-producer', instrumentation: { ...OPENAI_INSTRUMENTATION },
    supportedKinds: ['EXECUTION', 'MODEL_CALL'], supportedFacts: [...OPENAI_RUNTIME_FACTS],
    approvedModels: ['gpt-4o-mini'], approvedTargets: [], approvedTools: [], approvedDeployments: [],
  };
}
