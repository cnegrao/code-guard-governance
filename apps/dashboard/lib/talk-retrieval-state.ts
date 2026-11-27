/** Product-owned acquisition states. Containment is not semantic parity. */
export const CODING_MEMORY_UNAVAILABLE = Object.freeze({
  status: 'unavailable' as const,
  knowledge: 'UNKNOWN' as const,
  reason: 'SOURCE_NOT_ADMITTED' as const,
});

export interface TalkRetrievalState {
  agentLookup: { status: 'not_requested' | 'available' | 'no_matches' | 'unavailable'; mode: 'lexical'; knowledge: 'UNKNOWN'; };
  codingMemory: typeof CODING_MEMORY_UNAVAILABLE;
}

export function retrievalNotice(state: TalkRetrievalState): string {
  const agent = state.agentLookup.status;
  return `Code memory unavailable (UNKNOWN): repository/code context was not searched. Semantic parity is not available.${
    agent === 'unavailable' ? ' Agent text lookup unavailable (UNKNOWN).' :
    agent === 'no_matches' ? ' No agent text matches in the bounded lookup; this says nothing about semantic relevance.' :
    agent === 'available' ? ' Agent text matches are direct, non-authoritative records, not semantic results.' : ''}`;
}
