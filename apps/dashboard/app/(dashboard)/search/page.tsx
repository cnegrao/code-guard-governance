"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import Link from "next/link";

interface SearchResult {
  id: string;
  type: "agent" | "system" | "incident" | "finding";
  title: string;
  subtitle: string;
  risk_level?: string;
  status?: string;
  url: string | null;
}

const typeIcon: Record<string, string> = {
  agent: "◆",
  system: "▣",
  incident: "⚠",
  finding: "◈",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function doSearch(q: string) {
    setQuery(q);
    setError("");
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
      setError("ERROR: Search could not be read");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Search</h2>
        <p className="text-sm text-gray-400 mt-1">
          Search agents, systems, and incidents across your organisation
        </p>
      </div>

      <div className="max-w-2xl mb-6">
        <Input
          placeholder="Search agents, systems, incidents..."
          value={query}
          onChange={(e) => doSearch(e.target.value)}
          autoFocus
        />
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      {loading && <Spinner className="py-6" />}

      {!loading && !error && searched && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400">No results for &quot;{query}&quot;</p>
          <p className="text-sm text-gray-500 mt-1">Try a different search term</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {results.length} result{results.length !== 1 ? "s" : ""} for &quot;{query}&quot;
          </p>
          {results.map((r) => (
            <div key={`${r.type}-${r.id}`}>
              <Card className="hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{typeIcon[r.type] ?? "○"}</span>
                    <div>
                      <div className="text-sm text-white">{r.url ? <Link href={r.url}>{r.title}</Link> : r.title}</div>
                      <div className="text-xs text-gray-500">{r.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="registered">{r.type}</Badge>
                    {r.risk_level && (
                      <Badge variant={r.risk_level as "critical" | "high" | "medium" | "low"}>
                        {r.risk_level}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-12">
          <p className="text-gray-500">Type to search across your AI governance estate</p>
          <div className="flex justify-center gap-2 mt-4">
            {["fraud", "credit", "compliance", "model", "risk"].map((term) => (
              <button
                key={term}
                onClick={() => doSearch(term)}
                className="px-3 py-1 text-xs rounded-full bg-surface-dark border border-border-dark text-gray-400 hover:text-white hover:border-primary/50 transition-colors"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
