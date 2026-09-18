import 'server-only';
import type { LLMProvider } from '../llm';
import type { OpenAIAnswerMetadata } from './openai-answer-metadata';
import { createPrivateOpenAIProducer, type RuntimeProducerReport } from './otel-runtime-producer';
import { loadRuntimeProducerConfiguration } from './runtime-producer-config';

/** Server-internal report sink; never included in a Talk answer or its ledger. */
export type RuntimeObservationReport = RuntimeProducerReport | { readonly state: 'NOT_OBSERVED' };
function report(result: RuntimeObservationReport, sink?: (result: RuntimeObservationReport) => void): void {
  if (result.state === 'FAILED') console.warn('GOVIA_RUNTIME_OBSERVATION_FAILED', result.code);
  try { sink?.(result); } catch { console.warn('RUNTIME_PRODUCER_REPORT_FAILED'); }
}

/** Observe only the OpenAI answer invocation. Failure is fail-open for the answer,
 * fail-closed for evidence: a closed diagnostic and FAILED report, never success.
 */
export async function generateGovernanceAnswer(
  llm: LLMProvider, organisationId: string, systemPrompt: string, context: string, query: string,
  onObservation?: (result: RuntimeObservationReport) => void,
): Promise<string> {
  const configuration = llm.name === 'openai' ? loadRuntimeProducerConfiguration(organisationId) : { state: 'DISABLED' } as const;
  if (configuration.state !== 'ENABLED') {
    report(configuration.state === 'INVALID' ? { state: 'FAILED', code: configuration.code } : { state: 'NOT_OBSERVED' }, onObservation);
    return llm.generateAnswer(systemPrompt, context, query);
  }
  let producer: ReturnType<typeof createPrivateOpenAIProducer>;
  try { producer = createPrivateOpenAIProducer(configuration.source); }
  catch {
    report({ state: 'FAILED', code: 'RUNTIME_PRODUCER_SETUP_FAILED' }, onObservation);
    return llm.generateAnswer(systemPrompt, context, query);
  }
  let metadata: OpenAIAnswerMetadata | undefined;
  try {
    return await llm.generateAnswer(systemPrompt, context, query, value => { metadata = value; });
  } finally {
    report(await producer.finish(metadata), onObservation);
  }
}
