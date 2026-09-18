import * as talkRepo from "@/repositories/talk";
import { db } from "@/lib/db";
import { getLLMProvider, GOVERNANCE_SYSTEM_PROMPT } from "@/lib/llm";
import { generateGovernanceAnswer } from "@/lib/runtime/openai-governance-answer-producer";
import { semanticSearch } from "@/services/coding-memory";
import type { GovernanceAnswer } from "@/repositories/talk";

const MEMORY: Map<string, Array<{ query: string; answer: string }>> = new Map();

function getSessionId(): string {
  return `t2g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logToLedger(orgId: string, userId: string, event: string, payload: Record<string, unknown>) {
  try {
    await db.write.rpc("ledger_append", {
      p_event_type: event,
      p_event_desc: (payload.query as string)?.slice(0, 100) ?? event,
      p_subject_type: "governance_query",
      p_subject_id: userId,
      p_actor_user_id: userId,
      p_actor_ip: null,
      p_organisation_id: orgId,
      p_payload: payload,
    });
  } catch {}
}

export async function ask(orgId: string, userId: string, query: string): Promise<GovernanceAnswer> {
  const sessionId = getSessionId();
  const history = MEMORY.get(sessionId) ?? [];

  const contextualQuery = history.length > 0
    ? `Previous: ${history.map((h) => h.query).join(" | ")}. Now: ${query}`
    : query;

  await logToLedger(orgId, userId, "talk_to_governance.query", { query: query.slice(0, 500), history_length: history.length });

  const llm = getLLMProvider();

  const match = await talkRepo.executeQuery(orgId, contextualQuery);

  if (match.confidence >= 80) {
    history.push({ query, answer: match.answer });
    if (history.length > 10) history.shift();
    MEMORY.set(sessionId, history);

    await logToLedger(orgId, userId, "talk_to_governance.response", {
      query: query.slice(0, 200),
      intent: match.intent,
      confidence: match.confidence,
      source: "intent_router",
      citations_count: match.citations.length,
      llm_used: false,
    });

    return { ...match, evidence_count: match.citations.length };
  }

  const evidence = await talkRepo.buildGovernanceContext(orgId);

if (llm.available) {
    let enhancedContext = talkRepo.formatContextForLLM(evidence);

    try {
      const embedding = await llm.generateEmbedding(query);
      if (embedding.length > 0) {
        const semanticResults = await talkRepo.semanticSearch(orgId, embedding, 5);
        if (semanticResults.length > 0) {
          enhancedContext += "\n\n--- Semantic Matches (Agents) ---\n" + talkRepo.formatContextForLLM(semanticResults);
        }
      }
    } catch {}

    try {
      const codingMemoryContext = await semanticSearch(orgId, query, 5);
      if (codingMemoryContext) {
        enhancedContext += "\n\n--- Coding Memory (Repository Intelligence) ---\n" + codingMemoryContext;
      }
    } catch {}

    try {
      const llmAnswer = await generateGovernanceAnswer(llm, orgId, GOVERNANCE_SYSTEM_PROMPT, enhancedContext, query);

      if (llmAnswer.trim()) {
        const citations = evidence.slice(0, 5).map((e) => ({
          source: e.source,
          record: e.record,
          detail: `${e.type}: ${e.record}`,
        }));

        const answer: GovernanceAnswer = {
          answer: llmAnswer.trim(),
          confidence: 78,
          citations,
          supportingData: evidence.map((e) => e.fields),
          intent: "llm_generated",
          explanation: {
            source: "llm",
            intent_matched: "semantic_search",
            rows_used: evidence.length,
            confidence_rationale: `LLM-generated answer based on ${evidence.length} governance records from agents, systems, incidents, and compliance gaps.`,
          },
          evidence_count: evidence.length,
        };

        history.push({ query, answer: answer.answer });
        if (history.length > 10) history.shift();
        MEMORY.set(sessionId, history);

        await logToLedger(orgId, userId, "talk_to_governance.response", {
          query: query.slice(0, 200),
          intent: "llm_generated",
          confidence: 78,
          source: "llm",
          citations_count: citations.length,
          evidence_count: evidence.length,
          llm_used: true,
          llm_provider: llm.name,
        });

        return answer;
      }
    } catch {}
  }

  const citations = evidence.slice(0, 3).map((e) => ({
    source: e.source,
    record: e.record,
    detail: `${e.type}: ${e.record}`,
  }));

  const evidenceSummary = evidence.slice(0, 5).map((e) => `· ${e.type}: ${e.record} (${e.source})`).join("\n");

  const answer: GovernanceAnswer = {
    answer: match.intent === "overview"
      ? `${match.answer}\n\nRelevant records:\n${evidenceSummary}`
      : match.answer,
    confidence: 72,
    citations: citations.length > 0 ? citations : evidence.slice(0, 1).map((e) => ({ source: e.source, record: e.record, detail: `${e.type}: ${e.record}` })),
    supportingData: evidence.map((e) => e.fields),
    intent: match.intent,
    explanation: {
      source: "intent_router",
      intent_matched: match.intent,
      rows_used: evidence.length,
      confidence_rationale: `Intent router matched "${match.intent}" with ${match.confidence}% confidence. ${evidence.length} governance records provided as context.`,
    },
    evidence_count: evidence.length,
  };

  history.push({ query, answer: answer.answer });
  if (history.length > 10) history.shift();
  MEMORY.set(sessionId, history);

  await logToLedger(orgId, userId, "talk_to_governance.response", {
    query: query.slice(0, 200),
    intent: match.intent,
    confidence: answer.confidence,
    source: "intent_router",
    citations_count: citations.length,
    evidence_count: evidence.length,
    llm_used: false,
  });

  return answer;
}

export function getHistory(): Array<{ query: string; answer: string }> {
  return MEMORY.get(getSessionId()) ?? [];
}
