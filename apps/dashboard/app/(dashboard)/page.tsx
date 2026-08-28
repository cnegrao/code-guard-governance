"use client";

import { useState, useEffect } from "react";
import { StatCard } from "@/components/dashboard/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import type { MetricResult } from "@/lib/metrics/compliance";

interface DashboardData {
  totalAgents: number;
  totalSystems: number;
  complianceMetric: MetricResult;
  complianceRate: number | null;
  openFindings: number;
  openIncidents: number;
  upcomingReviews: number;
  highRiskAgents: number;
  agentsWithoutSystem: number;
  systemsWithoutAgents: number;
  highRiskSystems: number;
  openDoraIncidents: number;
  totalGovernanceGaps: number;
  riskDistribution: { critical: number; high: number; medium: number; low: number };
  recentIncidents: Array<{
    incident_code: string;
    title: string;
    severity: string;
    status: string;
    occurred_at: string;
  }>;
  topGaps: Array<{
    agent_code: string;
    agent_name: string;
    risk_level: string;
    total_gaps: number;
    owner_name: string;
  }>;
  industry: string;
  repositoriesScanned: number;
  agentsDiscovered: number;
  repositoriesWithAI: number;
  governancePriorityCritical: number;
}

function cColor(rate: number): "green" | "yellow" | "red" {
  if (rate >= 85) return "green";
  if (rate >= 50) return "yellow";
  return "red";
}

function riskColor(v: number): "green" | "yellow" | "red" {
  if (v === 0) return "green";
  if (v <= 5) return "yellow";
  return "red";
}

export default function DashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/summary")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load dashboard");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner className="py-12" />;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-danger mb-2">{error}</p>
        <p className="text-gray-400 text-sm">Ensure agents and systems are registered.</p>
      </div>
    );
  }
  if (!data) return null;

  const isDora = data.industry === "financial_services" || data.industry === "insurance";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Dashboard</h2>
        <p className="text-sm text-gray-400 mt-1">
          {session?.org?.name} — AI Governance Executive Overview
        </p>
      </div>

      {/* ROW 1 — Estate Overview */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Estate Overview
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Agents" value={data.totalAgents} color="blue" />
          <StatCard label="Total AI Systems" value={data.totalSystems} color="blue" />
          <StatCard
            label="Compliance Rate"
            value={data.complianceMetric.value === null ? "N/A" : `${data.complianceMetric.value}%`}
            color={data.complianceMetric.value === null ? "gray" : cColor(data.complianceMetric.value)}
            subtitle={
              data.complianceMetric.value === null
                ? "Not Assessed"
                : data.complianceMetric.status === "PARTIALLY_ASSESSED"
                  ? `${data.complianceMetric.assessedCount} of ${data.complianceMetric.applicableCount} assessed`
                  : data.complianceMetric.value < 85
                    ? "Review gaps"
                    : "On track"
            }
          />
        </div>
      </div>

      {/* ROW 2 — Operations */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Operations
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <Link href="/compliance">
            <StatCard
              label="Open Findings"
              value={data.openFindings}
              color={riskColor(data.openFindings)}
            />
          </Link>
          <Link href="/incidents">
            <StatCard
              label="Open Incidents"
              value={data.openIncidents}
              color={riskColor(data.openIncidents)}
            />
          </Link>
          <Link href="/compliance">
            <StatCard
              label="Upcoming Reviews"
              value={data.upcomingReviews}
              color={data.upcomingReviews > 5 ? "yellow" : "gray"}
              subtitle="Agents + resources due"
            />
          </Link>
        </div>
      </div>

      {/* ROW 2.5 — Discovery Coverage */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Discovery Coverage
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <Link href="/discovery">
            <StatCard
              label="Repositories Scanned"
              value={data.repositoriesScanned}
              color={data.repositoriesScanned > 0 ? "blue" : "gray"}
              subtitle="Via Discovery Engine"
            />
          </Link>
          <Link href="/discovery">
            <StatCard
              label="Agents Discovered"
              value={data.agentsDiscovered}
              color={data.agentsDiscovered > 0 ? "blue" : "gray"}
              subtitle="Detected via Discovery"
            />
          </Link>
          <Link href="/discovery">
            <StatCard
              label="Repos With AI"
              value={data.repositoriesWithAI}
              color={data.repositoriesWithAI > 0 ? "yellow" : "gray"}
              subtitle="Contain AI agents"
            />
          </Link>
          <Link href="/discovery">
            <StatCard
              label="Critical Priority"
              value={data.governancePriorityCritical}
              color={data.governancePriorityCritical > 0 ? "red" : "green"}
              subtitle="Governance findings"
            />
          </Link>
        </div>
      </div>

      {/* ROW 3 — Governance */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Governance
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <Link href="/agents?risk=critical">
            <StatCard
              label="High Risk Agents"
              value={data.highRiskAgents}
              color={riskColor(data.highRiskAgents)}
              subtitle="Critical + High"
            />
          </Link>
          <Link href="/compliance">
            <StatCard
              label="Agents Without AI System"
              value={data.agentsWithoutSystem}
              color={riskColor(data.agentsWithoutSystem)}
              subtitle="AI Act gap"
            />
          </Link>
          <StatCard
            label="AI Systems Without Agents"
            value={data.systemsWithoutAgents}
            color={data.systemsWithoutAgents > 0 ? "yellow" : "green"}
            subtitle="Orphan systems"
          />
        </div>
      </div>

      {/* ROW 4 — Executive Exposure */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Executive Exposure
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="High-Risk AI Systems"
            value={data.highRiskSystems}
            color={riskColor(data.highRiskSystems)}
            subtitle="AI Act Annex III"
          />
          {isDora ? (
            <Link href="/incidents">
              <StatCard
                label="Open DORA Incidents"
                value={data.openDoraIncidents}
                color={riskColor(data.openDoraIncidents)}
                subtitle="DORA Art. 17-21"
              />
            </Link>
          ) : (
            <StatCard
              label="Total Governance Gaps"
              value={data.totalGovernanceGaps}
              color={riskColor(data.totalGovernanceGaps)}
              subtitle="All CG-AG controls"
            />
          )}
          {isDora && (
            <StatCard
              label="Total Governance Gaps"
              value={data.totalGovernanceGaps}
              color={riskColor(data.totalGovernanceGaps)}
              subtitle="All CG-AG controls"
            />
          )}
        </div>
      </div>

      {/* DETAILS */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
            Risk Distribution
          </h3>
          <div className="space-y-3">
            {[
              { label: "Critical", value: data.riskDistribution.critical, color: "bg-danger" },
              { label: "High", value: data.riskDistribution.high, color: "bg-orange-500" },
              { label: "Medium", value: data.riskDistribution.medium, color: "bg-warning" },
              { label: "Low", value: data.riskDistribution.low, color: "bg-success" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-16">{item.label}</span>
                <div className="flex-1 h-2 bg-surface-dark rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all`}
                    style={{
                      width: `${data.totalAgents > 0 ? (item.value / data.totalAgents) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-gray-300 w-8 text-right">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
            Top Compliance Gaps
          </h3>
          {data.topGaps.length === 0 ? (
            <p className="text-sm text-gray-500">No compliance gaps detected.</p>
          ) : (
            <div className="space-y-2">
              {data.topGaps.map((gap) => (
                <div
                  key={gap.agent_code}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-dark/50 border border-border-dark/30"
                >
                  <div>
                    <span className="text-sm text-white">{gap.agent_name}</span>
                    <span className="text-xs text-gray-500 ml-2">{gap.owner_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={gap.risk_level as "critical" | "high" | "medium" | "low"}>
                      {gap.risk_level}
                    </Badge>
                    <span className="text-xs text-danger">{gap.total_gaps} gaps</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {data.recentIncidents.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
            Recent Incidents
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dark text-left text-gray-400">
                  <th className="py-2 px-3 font-medium">Code</th>
                  <th className="py-2 px-3 font-medium">Title</th>
                  <th className="py-2 px-3 font-medium">Severity</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recentIncidents.map((inc) => (
                  <tr key={inc.incident_code} className="border-b border-border-dark/50">
                    <td className="py-2 px-3 font-mono text-xs">{inc.incident_code}</td>
                    <td className="py-2 px-3 text-white">{inc.title}</td>
                    <td className="py-2 px-3">
                      <Badge variant={inc.severity as "critical" | "high" | "medium" | "low"}>
                        {inc.severity}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-gray-400 text-xs">{inc.status}</td>
                    <td className="py-2 px-3 text-gray-400 text-xs">
                      {new Date(inc.occurred_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
