"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { CompliancePanel } from "@/components/agents/CompliancePanel";
import type { Agent } from "@/types/agents";
import {
  NO_APPLICABLE_METRIC,
  type AssessableState,
  type MetricResult,
} from "@/lib/metrics/compliance";

export default function AgentDetailPage() {
  const params = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [compliance, setCompliance] = useState<Record<string, AssessableState>>({});
  const [metric, setMetric] = useState<MetricResult>(NO_APPLICABLE_METRIC);
  const [gaps, setGaps] = useState<string[]>([]);
  const [ownerName, setOwnerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/agents/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Agent not found");
        return res.json();
      })
      .then((data) => {
        setAgent(data.agent);
        setCompliance(data.compliance ?? {});
        setMetric(data.compliance_metric ?? NO_APPLICABLE_METRIC);
        setGaps(data.compliance_gaps ?? []);
        setOwnerName(data.owner_name ?? "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <Spinner className="py-12" />;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-danger mb-4">{error}</p>
        <Link href="/agents">
          <Button variant="secondary">Back to Agents</Button>
        </Link>
      </div>
    );
  }
  if (!agent) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/agents" className="text-xs text-gray-400 hover:text-white mb-1 block">
            ← Back to Agents
          </Link>
          <h2 className="text-xl font-bold text-white">{agent.name}</h2>
          <p className="text-sm text-gray-400 mt-1">
            {agent.agent_code} · {agent.version}
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Details
            </h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">Agent Type</dt>
                <dd className="text-white mt-0.5">{agent.agent_type}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Risk Level</dt>
                <dd className="text-white mt-0.5">
                  <Badge variant={agent.risk_level as "critical" | "high" | "medium" | "low"}>
                    {agent.risk_level}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">AI Act Risk Class</dt>
                <dd className="text-white mt-0.5">{agent.ai_act_risk_class}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Oversight Level</dt>
                <dd className="text-white mt-0.5">{agent.oversight_level}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Model</dt>
                <dd className="text-white mt-0.5">
                  {agent.model_name ?? "—"} {agent.model_provider ? `(${agent.model_provider})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Deployment</dt>
                <dd className="text-white mt-0.5">{agent.deployment_env}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Owner</dt>
                <dd className="text-white mt-0.5">{ownerName || "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Business Domain</dt>
                <dd className="text-white mt-0.5">{agent.business_domain ?? "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Description
            </h3>
            <p className="text-sm text-gray-300">{agent.description}</p>
          </Card>
        </div>

        <div>
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Compliance
            </h3>
            <CompliancePanel compliance={compliance} metric={metric} gaps={gaps} />
          </Card>
        </div>
      </div>
    </div>
  );
}
