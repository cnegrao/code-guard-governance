"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { CompliancePanel } from "@/components/agents/CompliancePanel";
import type { AISystem } from "@/types/systems";
import {
  NO_APPLICABLE_METRIC,
  type AssessableState,
  type MetricResult,
} from "@/lib/metrics/compliance";

export default function SystemDetailPage() {
  const params = useParams();
  const [system, setSystem] = useState<(AISystem & { owner_name?: string; agent_count?: number }) | null>(null);
  const [compliance, setCompliance] = useState<Record<string, AssessableState>>({});
  const [metric, setMetric] = useState<MetricResult>(NO_APPLICABLE_METRIC);
  const [gaps, setGaps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/systems/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("System not found");
        return res.json();
      })
      .then((data) => {
        setSystem(data.system ?? data);
        setCompliance(data.compliance ?? {});
        setMetric(data.compliance_metric ?? NO_APPLICABLE_METRIC);
        setGaps(data.compliance_gaps ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <Spinner className="py-12" />;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-danger mb-4">{error}</p>
        <Link href="/systems">
          <Button variant="secondary">Back to Systems</Button>
        </Link>
      </div>
    );
  }
  if (!system) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/systems" className="text-xs text-gray-400 hover:text-white mb-1 block">
            ← Back to Systems
          </Link>
          <h2 className="text-xl font-bold text-white">{system.name}</h2>
          <p className="text-sm text-gray-400 mt-1">
            {system.system_code} — {system.lifecycle ?? system.status}
          </p>
        </div>
        <Badge variant={system.status === "production" ? "active" : "registered"}>
          {system.status}
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
                <dt className="text-gray-500">Risk Class</dt>
                <dd className="text-white mt-0.5">
                  <Badge variant={system.risk_class === "high" ? "high" : system.risk_class === "critical" ? "critical" : "low"}>
                    {system.risk_class}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Lifecycle</dt>
                <dd className="text-white mt-0.5">{system.lifecycle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Role</dt>
                <dd className="text-white mt-0.5">{system.organisation_role ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Annex III</dt>
                <dd className="text-white mt-0.5">{system.annex_iii_sector ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Owner</dt>
                <dd className="text-white mt-0.5">{system.owner_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Linked Agents</dt>
                <dd className="text-white mt-0.5">{system.agent_count ?? 0}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500">Intended Purpose</dt>
                <dd className="text-white mt-0.5">{system.intended_purpose}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">
              Description
            </h3>
            <p className="text-sm text-gray-300">{system.description}</p>
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
