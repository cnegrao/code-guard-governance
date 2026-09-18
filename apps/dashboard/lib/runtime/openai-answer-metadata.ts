/** Internal metadata port. No prompt, response, credential or SDK object crosses it. */
export const OPENAI_GOVERNANCE_MODEL = 'gpt-4o-mini';
export type OpenAIAnswerMetadata =
  | { readonly state: 'SUCCESS'; readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number }
  | { readonly state: 'ERROR'; readonly code: 'HTTP_ERROR' | 'CONNECTION_FAILED' | 'INVALID_RESPONSE' };
export type OpenAIAnswerObserver = (metadata: OpenAIAnswerMetadata) => void;

/** Called in the HTTP client, before the telemetry boundary. No raw usage is retained.
 * Independent absent/invalid counts stay absent. Contradictory complete usage is
 * discarded, never repaired, estimated or recomputed.
 */
export function directOpenAIUsage(usage: unknown): Extract<OpenAIAnswerMetadata, { state: 'SUCCESS' }> {
  const fields = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {};
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const inputTokens = count(fields.prompt_tokens);
  const outputTokens = count(fields.completion_tokens);
  const totalTokens = count(fields.total_tokens);
  if (inputTokens !== undefined && outputTokens !== undefined && totalTokens !== undefined &&
    BigInt(inputTokens) + BigInt(outputTokens) !== BigInt(totalTokens)) return { state: 'SUCCESS' };
  return { state: 'SUCCESS', inputTokens, outputTokens, totalTokens };
}
