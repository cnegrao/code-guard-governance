/**
 * M17-S0 (ADR-GOVIA-RISK-INTELLIGENCE-v1 §23, D-05 / D-12): every remaining application display of the legacy risk
 * surfaces (gov_repo.agents.risk_level / ai_act_risk_class, ai_systems.risk_class, risk_entries / risk_treatments,
 * scanner heuristic labels) is LEGACY / NON-AUTHORITATIVE. These values are not governed risk, carry no method /
 * evidence provenance, and are never an L15 input. Absence of a governed risk is UNKNOWN, never "no risk".
 */
export const LEGACY_RISK_LABEL = "LEGACY / NON-AUTHORITATIVE" as const;
export const LEGACY_RISK_AUTHORITY = "LEGACY_NON_AUTHORITATIVE" as const;

export interface LegacyRiskLabelled {
  /** The stored legacy label exactly as persisted (or null when absent); never a governed risk value. */
  readonly value: string | null;
  readonly authority: typeof LEGACY_RISK_AUTHORITY;
  readonly label: typeof LEGACY_RISK_LABEL;
}

export function legacyRisk(value: unknown): LegacyRiskLabelled {
  return {
    value: typeof value === "string" && value.length > 0 ? value : null,
    authority: LEGACY_RISK_AUTHORITY,
    label: LEGACY_RISK_LABEL,
  };
}

/** Human-readable text for a legacy risk value; an absent value renders as "unknown", never as low / none. */
export function legacyRiskText(value: unknown): string {
  const labelled = legacyRisk(value);
  return `${labelled.value ?? "unknown"} (legacy risk label — ${LEGACY_RISK_LABEL})`;
}
