"use client";

import { LEGACY_CONTROL_AUTHORITY, LEGACY_CONTROL_LIMITATION } from "@/lib/legacy-control-dto";

interface LegacyControlRecordsPanelProps {
  states: Record<string, import("@/types/agents").ControlState>;
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

export function LegacyControlRecordsPanel({ states, gaps }: LegacyControlRecordsPanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">{LEGACY_CONTROL_AUTHORITY}</p>
      <p className="text-sm text-gray-400">{LEGACY_CONTROL_LIMITATION}</p>
      <p className="text-sm text-gray-400">
        {gaps.length === 0
          ? "No failed legacy records returned. This does not establish compliance or assurance."
          : `${gaps.length} recorded legacy control gap${gaps.length > 1 ? "s" : ""}`}
      </p>
      {Object.keys(states).length === 0 && <p className="text-sm text-gray-400">No legacy control states recorded.</p>}

      <div className="space-y-2">
        {Object.entries(states).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-dark/50 border border-border-dark/30"
          >
            <span className="text-sm text-gray-300">
              {CONTROL_LABELS[key] ?? key}
            </span>
            <span className="text-xs text-gray-400">
              {value === "passed" ? "RECORDED_PASS" : value === "failed" ? "RECORDED_FAIL" : value === "waived" ? "RECORDED_WAIVED" : "NOT_ASSESSED"}
              {" - legacy/non-authoritative"}
            </span>
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div className="mt-4 p-4 rounded-lg bg-warning/5 border border-warning/20">
          <h4 className="text-sm font-medium text-warning mb-2">Legacy Control Gap Records</h4>
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