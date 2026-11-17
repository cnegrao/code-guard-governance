import type { DetectedAgent } from './types';

const LEVELS = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_charge'] as const;
export type OversightLevel = typeof LEVELS[number];
export interface ScannerOversight {
  level: 'UNKNOWN';
  evidenceState: 'NOT_EVIDENCED';
  authority: 'NON_AUTHORITATIVE';
  source: { kind: 'LEGACY_SCANNER_HEURISTIC'; filePath: string | null };
  recommendation: {
    level: OversightLevel;
    basis: 'UNVERIFIED_LEGACY_INPUT' | 'FRAMEWORK_DEFAULT' | 'CRITICAL_AGENT_HEURISTIC' | 'HIGH_RISK_HEURISTIC' | 'AUTONOMY_HEURISTIC';
  } | null;
}

function isLevel(value: unknown): value is OversightLevel {
  return typeof value === 'string' && LEVELS.some(level => level === value);
}

/** Detection cannot establish effective oversight, applicability or sufficiency.
 * Even a recognized legacy input is unverified, never a governed decision. */
export function projectScannerOversight(agent: DetectedAgent): ScannerOversight {
  let recommendation: ScannerOversight['recommendation'] = null;
  if (isLevel(agent.oversightLevel)) {
    recommendation = { level: agent.oversightLevel, basis: 'UNVERIFIED_LEGACY_INPUT' };
  } else if (isLevel(agent.oversightSuggestion)) {
    recommendation = { level: agent.oversightSuggestion, basis: 'FRAMEWORK_DEFAULT' };
  } else if (agent.critical) {
    recommendation = { level: 'l3_human_approval', basis: 'CRITICAL_AGENT_HEURISTIC' };
  } else if (agent.riskLevel === 'high') {
    recommendation = { level: 'l2_human_review', basis: 'HIGH_RISK_HEURISTIC' };
  } else if (agent.isAutonomous) {
    recommendation = { level: 'l3_human_approval', basis: 'AUTONOMY_HEURISTIC' };
  }
  return {
    level: 'UNKNOWN', evidenceState: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    source: { kind: 'LEGACY_SCANNER_HEURISTIC', filePath: agent.filePath ?? null },
    recommendation,
  };
}
