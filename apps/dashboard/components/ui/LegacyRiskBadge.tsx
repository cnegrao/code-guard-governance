import { Badge } from "@/components/ui/Badge";
import { LEGACY_RISK_AUTHORITY, LEGACY_RISK_LABEL, legacyRisk } from "@/lib/legacy-risk";

const LEVELS = ["critical", "high", "medium", "low"] as const;
type Level = (typeof LEVELS)[number];

/**
 * Renders a legacy risk label (agents.risk_level, ai_act_risk_class, ai_systems.risk_class, scanner heuristics) with the
 * mandatory LEGACY / NON-AUTHORITATIVE marker (M17-S0). It is never a governed risk and never an M17 input.
 */
export function LegacyRiskBadge({ value }: { value: unknown }) {
  const labelled = legacyRisk(value);
  const variant: Level | undefined = (LEVELS as readonly string[]).includes(labelled.value ?? "")
    ? (labelled.value as Level) : undefined;
  return (
    <span className="inline-flex items-center gap-1" data-authority={LEGACY_RISK_AUTHORITY} title={LEGACY_RISK_LABEL}>
      <Badge variant={variant ?? "detected"}>{labelled.value ?? "unknown"}</Badge>
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{LEGACY_RISK_LABEL}</span>
    </span>
  );
}
