"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { StateBadge } from "@/components/workspace/StateBadge";

interface WorkspaceSummary {
  needsReview: number;
  detected: number;
  proposed: number;
  confirmed: number;
  certified: number;
  objectFindingsNeedingReview: number;
  relationshipFindingsNeedingReview: number;
}

interface ReviewQueueItem {
  reviewSubjectId: string;
  candidateKind: string;
  state: string;
  findingId: string;
  sourceConnectionId: string;
  sourceExternalType: string;
  sourceExternalId: string;
  detectedAt: string;
  evidenceCount: number;
  assertionCount: number;
}

interface ReviewQueuePage {
  items: ReviewQueueItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const STATE_OPTIONS = [
  { value: "", label: "All states" },
  { value: "DETECTED", label: "Detected" },
  { value: "PROPOSED", label: "Proposed" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "CERTIFIED", label: "Certified" },
  { value: "REJECTED", label: "Rejected" },
];

const KIND_OPTIONS = [
  { value: "", label: "All kinds" },
  { value: "AGENT", label: "Agent" },
  { value: "AGENT_VERSION", label: "Agent Version" },
  { value: "MODEL", label: "Model" },
  { value: "TOOL", label: "Tool" },
  { value: "MCP_SERVER", label: "MCP Server" },
  { value: "API", label: "API" },
  { value: "PROMPT", label: "Prompt" },
  { value: "KNOWLEDGE_BASE", label: "Knowledge Base" },
  { value: "DATA_ASSET", label: "Data Asset" },
  { value: "DATA_ELEMENT", label: "Data Element" },
  { value: "SKILL", label: "Skill" },
  { value: "RELATIONSHIP", label: "Relationship" },
];

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function GovernanceReviewQueuePage() {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [queue, setQueue] = useState<ReviewQueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/governance/workspace/summary");
      if (!res.ok) throw new Error("failed");
      setSummary(await res.json());
      setSummaryError(null);
    } catch {
      setSummaryError("Unable to load the workspace summary.");
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (kind) params.set("kind", kind);
      if (source) params.set("source", source);
      if (search) params.set("search", search);
      params.set("page", String(page));
      const res = await fetch(`/api/governance/workspace/reviews?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unable to load the review queue.");
      }
      setQueue(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the review queue.");
      setQueue(null);
    } finally {
      setLoading(false);
    }
  }, [state, kind, source, search, page]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  function applyFilters(next: Partial<{ state: string; kind: string; source: string; search: string }>) {
    if ("state" in next) setState(next.state ?? "");
    if ("kind" in next) setKind(next.kind ?? "");
    if ("source" in next) setSource(next.source ?? "");
    if ("search" in next) setSearch(next.search ?? "");
    setPage(1);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Governance Review Queue</h2>
        <p className="text-sm text-gray-400 mt-1">
          Triage discovered AI/data findings: inspect evidence and provenance, then confirm, certify, or reject.
        </p>
      </div>

      {summaryError && <p className="text-sm text-danger mb-4">{summaryError}</p>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Needs Review</h3>
          <div className="text-2xl font-bold text-warning">{summary?.needsReview ?? "–"}</div>
        </Card>
        <Card>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Detected</h3>
          <div className="text-2xl font-bold text-gray-300">{summary?.detected ?? "–"}</div>
        </Card>
        <Card>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Proposed</h3>
          <div className="text-2xl font-bold text-warning">{summary?.proposed ?? "–"}</div>
        </Card>
        <Card>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Confirmed</h3>
          <div className="text-2xl font-bold text-accent-cyan">{summary?.confirmed ?? "–"}</div>
        </Card>
        <Card>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Certified</h3>
          <div className="text-2xl font-bold text-success">{summary?.certified ?? "–"}</div>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Select
            options={STATE_OPTIONS}
            value={state}
            onChange={(e) => applyFilters({ state: e.target.value })}
          />
          <Select
            options={KIND_OPTIONS}
            value={kind}
            onChange={(e) => applyFilters({ kind: e.target.value })}
          />
          <Input
            placeholder="Source connection ID"
            value={source}
            onChange={(e) => applyFilters({ source: e.target.value })}
          />
          <Input
            placeholder="Search finding / external ID"
            value={search}
            onChange={(e) => applyFilters({ search: e.target.value })}
          />
        </div>
      </Card>

      {loading && <Spinner className="py-12" />}

      {!loading && error && (
        <div className="text-center py-12">
          <p className="text-danger mb-4">{error}</p>
          <Button variant="secondary" onClick={() => loadQueue()}>Retry</Button>
        </div>
      )}

      {!loading && !error && queue && queue.items.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No review subjects match these filters.</p>
          <p className="text-sm text-gray-600 mt-1">Try widening the state or kind filter.</p>
        </div>
      )}

      {!loading && !error && queue && queue.items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wide border-b border-border-dark">
                <th className="pb-3 pr-4">State</th>
                <th className="pb-3 pr-4">Kind</th>
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4">Detected</th>
                <th className="pb-3 pr-4">Evidence</th>
                <th className="pb-3 pr-4">Assertions</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((item) => (
                <tr key={item.reviewSubjectId} className="border-b border-border-dark/50 last:border-0">
                  <td className="py-3 pr-4"><StateBadge state={item.state} /></td>
                  <td className="py-3 pr-4 text-gray-300">{item.candidateKind}</td>
                  <td className="py-3 pr-4 text-gray-300">
                    <div>{item.sourceExternalId}</div>
                    <div className="text-xs text-gray-500">{item.sourceConnectionId} · {item.sourceExternalType}</div>
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">{formatTimestamp(item.detectedAt)}</td>
                  <td className="py-3 pr-4 text-gray-300">{item.evidenceCount}</td>
                  <td className="py-3 pr-4 text-gray-300">{item.assertionCount}</td>
                  <td className="py-3">
                    <Link href={`/governance/reviews/${item.reviewSubjectId}`}>
                      <Button size="sm" variant="ghost">Review</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-dark">
            <span className="text-xs text-gray-500">Page {queue.page}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!queue.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
