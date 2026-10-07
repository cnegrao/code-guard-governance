"use client";

import { Badge } from "@/components/ui/Badge";

interface CompliancePanelProps {
  compliance: Record<string, import("@/types/agents").ControlState>;
  score: number | null;
  gaps: string[];
}

const CONTROL_LABELS: Record<string, string> = {
  cg_ag_001_registered: "CG-AG-001 — Agent Inventory",
  cg_ag_002_owner: "CG-AG-002 — Agent Owner",
  cg_ag_003_model_reg: "CG-AG-003 — Model Registration",
  cg_ag_007_oversight: "CG-AG-007 — Human Oversight",
  cg_ag_008_audit_trail: "CG-AG-008 — Audit Trail",
  cg_ag_010_classified: "CG-AG-010 — Risk Classification",
  cg_ag_012_autonomous_governed: "CG-AG-012 — Autonomous Governance",
};

export function CompliancePanel({ compliance, score, gaps }: CompliancePanelProps) {
  const color = score === null ? "text-gray-400" : score >= 85 ? "text-success" : score >= 50 ? "text-warning" : "text-danger";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className={`text-3xl font-bold ${color}`}>{score === null ? "NOT_ASSESSED" : `${score}%`}</div>
        <div className="text-sm text-gray-400">
          {gaps.length === 0
            ? "No failed controls recorded; unassessed controls remain unknown"
            : `${gaps.length} gap${gaps.length > 1 ? "s" : ""} detected`}
        </div>
      </div>

      <div className="space-y-2">
        {Object.entries(compliance).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-dark/50 border border-border-dark/30"
          >
            <span className="text-sm text-gray-300">
              {CONTROL_LABELS[key] ?? key}
            </span>
            <Badge variant={value === "passed" ? "passed" : value === "failed" ? "failed" : "proposed"}>
              {value === "passed" ? "PASS" : value === "failed" ? "FAIL" : value === "waived" ? "WAIVED" : "NOT_ASSESSED"}
            </Badge>
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div className="mt-4 p-4 rounded-lg bg-warning/5 border border-warning/20">
          <h4 className="text-sm font-medium text-warning mb-2">Gaps</h4>
          <ul className="space-y-1">
            {gaps.map((gap) => (
              <li key={gap} className="text-xs text-gray-400">
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}