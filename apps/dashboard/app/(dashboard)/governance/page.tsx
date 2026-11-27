"use client";

import { useState, useRef, useEffect } from "react";
import { retrievalNotice, type TalkRetrievalState } from "@/lib/talk-retrieval-state";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

interface Message {
  role: "user" | "system";
  content: string;
  retrieval?: TalkRetrievalState;
  citations?: Array<{ source: string; record: string; detail: string }>;
  confidence?: number;
  intent?: string;
  explanation?: { source: string; intent_matched: string; rows_used: number; confidence_rationale: string };
}

const SUGGESTIONS = [
  "Which agents have the highest risk?",
  "How many open incidents?",
  "What are the top governance gaps?",
  "Show AI Act high-risk systems",
  "Which autonomous agents lack oversight?",
  "Show agents without owners",
];

export default function GovernancePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(query: string) {
    const q = query.trim();
    if (!q || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await fetch("/api/talk-to-governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) throw new Error("Failed");
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: data.answer,
          retrieval: data.retrieval,
          citations: data.citations,
          confidence: data.confidence,
          intent: data.intent,
          explanation: data.explanation,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: "Sorry, I couldn't process that query. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-120px)]">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white">Talk-to-Governance</h2>
        <p className="text-sm text-gray-400 mt-1">Ask questions about your AI governance estate</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-6">Ask a question about your AI governance:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3 py-2 text-xs rounded-lg bg-surface-dark border border-border-dark text-gray-400 hover:text-white hover:border-primary/50 transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] ${m.role === "user" ? "bg-primary/20 border border-primary/30" : "bg-surface-dark/70 border border-border-dark/50"} rounded-xl p-4`}>
              <div className="text-sm text-white whitespace-pre-wrap">{m.content}</div>
              {m.retrieval && <p role="status" className="mt-2 text-xs text-amber-300">{retrievalNotice(m.retrieval)}</p>}
              {m.confidence && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant={m.confidence >= 85 ? "passed" : m.confidence >= 60 ? "medium" : "failed"}>
                    {m.confidence}% confidence
                  </Badge>
                  {m.intent && <Badge variant="registered">{m.intent}</Badge>}
                </div>
              )}
              {m.explanation && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Why this answer?</summary>
                  <div className="mt-2 p-2 bg-surface-dark/50 rounded text-xs text-gray-400">
                    <p><span className="text-gray-500">Intent:</span> {m.explanation.intent_matched}</p>
                    <p><span className="text-gray-500">Source:</span> {m.explanation.source}</p>
                    <p><span className="text-gray-500">Rows used:</span> {m.explanation.rows_used}</p>
                    <p className="mt-1"><span className="text-gray-500">Rationale:</span> {m.explanation.confidence_rationale}</p>
                  </div>
                </details>
              )}
              {m.citations && m.citations.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    {m.citations.length} citation{m.citations.length !== 1 ? "s" : ""}
                  </summary>
                  <div className="mt-2 space-y-1">
                    {m.citations.map((c, j) => (
                      <div key={j} className="text-xs text-gray-500 bg-surface-dark/50 p-2 rounded">
                        <span className="text-primary">{c.source}</span> → {c.record}: {c.detail}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-dark/70 border border-border-dark/50 rounded-xl p-4">
              <Spinner />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about agents, incidents, compliance..."
          disabled={loading}
          className="flex-1"
        />
        <Button onClick={() => send(input)} disabled={loading || !input.trim()}>
          Ask
        </Button>
      </div>
    </div>
  );
}