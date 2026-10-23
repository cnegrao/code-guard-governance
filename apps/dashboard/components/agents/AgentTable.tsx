"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LegacyRiskBadge } from "@/components/ui/LegacyRiskBadge";
import { LEGACY_RISK_LABEL } from "@/lib/legacy-risk";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAgents } from "@/hooks/useAgents";

export function AgentTable() {
  const { agents, total, loading, error, refetch } = useAgents();

  if (loading) return <Spinner className="py-12" />;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-danger mb-4">{error}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">{total} agents</p>
        <Link href="/agents/new">
          <Button size="sm">+ New Agent</Button>
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-dark text-left text-gray-400">
              <th className="py-2 px-3 font-medium">Code</th>
              <th className="py-2 px-3 font-medium">Name</th>
              <th className="py-2 px-3 font-medium">Type</th>
              <th className="py-2 px-3 font-medium">Legacy risk label <span className="text-[10px] text-gray-500">({LEGACY_RISK_LABEL})</span></th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500">
                  No agents registered.{" "}
                  <Link href="/agents/new" className="text-primary hover:underline">
                    Create your first agent.
                  </Link>
                </td>
              </tr>
            ) : (
              agents.map((agent) => {
                return (
                  <tr key={agent.agent_id} className="border-b border-border-dark/50 hover:bg-white/5">
                    <td className="py-2 px-3 font-mono text-xs text-gray-300">
                      {agent.agent_code}
                    </td>
                    <td className="py-2 px-3 text-white">{agent.name}</td>
                    <td className="py-2 px-3">
                      <Badge variant="registered">{agent.agent_type}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <LegacyRiskBadge value={agent.risk_level} />
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          agent.status === "active"
                            ? "active"
                            : agent.status === "suspended"
                            ? "suspended"
                            : "registered"
                        }
                      >
                        {agent.status}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <Link
                        href={`/agents/${agent.agent_id}`}
                        className="text-primary text-xs hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}