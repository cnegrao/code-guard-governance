import { directOpenAIUsage, OPENAI_GOVERNANCE_MODEL, type OpenAIAnswerMetadata, type OpenAIAnswerObserver } from './runtime/openai-answer-metadata';

export interface LLMProvider {
  name: string;
  generateAnswer(systemPrompt: string, context: string, query: string, observeOpenAI?: OpenAIAnswerObserver): Promise<string>;
  generateEmbedding(text: string): Promise<number[]>;
  available: boolean;
}

function getEnv(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

function getOpenAIProvider(): LLMProvider {
  const apiKey = getEnv("OPENAI_API_KEY");
  return {
    name: "openai",
    available: !!apiKey,
    generateEmbedding: async (text: string) => {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
      });
      const json = await res.json();
      return json.data?.[0]?.embedding ?? [];
    },
    generateAnswer: async (systemPrompt: string, context: string, query: string, observeOpenAI?: OpenAIAnswerObserver) => {
      let metadata: OpenAIAnswerMetadata = { state: 'ERROR', code: 'CONNECTION_FAILED' };
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: OPENAI_GOVERNANCE_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer concisely. Cite specific records.` },
            ],
            max_tokens: 500,
            temperature: 0.1,
          }),
        });
        metadata = { state: 'ERROR', code: res.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR' };
        const json = await res.json();
        if (observeOpenAI && res.ok && typeof json?.choices?.[0]?.message?.content === 'string') {
          metadata = directOpenAIUsage(json.usage);
        }
        return json.choices?.[0]?.message?.content ?? "";
      } finally {
        // This port receives only closed status/count metadata, never the response.
        // A broken internal observer cannot change the existing business result.
        try { observeOpenAI?.(metadata); }
        catch { console.warn('RUNTIME_PRODUCER_CALLBACK_FAILED'); }
      }
    },
  };
}

function getDeepSeekProvider(): LLMProvider {
  const apiKey = getEnv("DEEPSEEK_API_KEY");
  return {
    name: "deepseek",
    available: !!apiKey,
    generateEmbedding: async () => [],
    generateAnswer: async (systemPrompt: string, context: string, query: string) => {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer concisely. Cite specific records.` },
          ],
          max_tokens: 500,
          temperature: 0.1,
        }),
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? "";
    },
  };
}

function getOllamaProvider(): LLMProvider {
  const baseUrl = getEnv("OLLAMA_BASE_URL", "http://localhost:11434");
  const model = getEnv("OLLAMA_MODEL", "llama3.2");
  return {
    name: "ollama",
    available: true,
    generateEmbedding: async (text: string) => {
      try {
        const res = await fetch(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
        });
        const json = await res.json();
        return json.embedding ?? [];
      } catch { return []; }
    },
    generateAnswer: async (systemPrompt: string, context: string, query: string) => {
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer concisely. Cite specific records.` },
            ],
            stream: false,
          }),
        });
        const json = await res.json();
        return json.message?.content ?? "";
      } catch { return ""; }
    },
  };
}

function getNoopProvider(): LLMProvider {
  return {
    name: "none",
    available: false,
    generateEmbedding: async () => [],
    generateAnswer: async () => "",
  };
}

export function getLLMProvider(): LLMProvider {
  const provider = getEnv("LLM_PROVIDER", "none").toLowerCase();
  if (provider === "openai" && getEnv("OPENAI_API_KEY")) return getOpenAIProvider();
  if (provider === "deepseek" && getEnv("DEEPSEEK_API_KEY")) return getDeepSeekProvider();
  if (provider === "ollama") return getOllamaProvider();
  return getNoopProvider();
}

export const GOVERNANCE_SYSTEM_PROMPT = `You are the CodeGuard AI Governance Copilot. You answer questions about AI governance, compliance, and risk.

Rules:
1. Only answer based on the provided context. Never invent data.
2. Cite specific records from the context (agent codes, incident codes, system codes).
3. If the context is insufficient, say so clearly.
4. Be concise. Use bullet points for lists.
5. Never mention "the context" or "the provided data" in your answer.
6. Answer as if you are the governance system itself.`;
