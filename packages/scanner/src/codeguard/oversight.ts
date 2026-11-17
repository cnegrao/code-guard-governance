import type { DiscoveredAgent } from './types';

const LEVELS = ['l1_automated', 'l2_human_review', 'l3_human_approval', 'l4_human_in_charge'] as const;
type LegacyOversightLevel = typeof LEVELS[number];

export function normalizeOversightSuggestion(value: unknown): LegacyOversightLevel | 'UNKNOWN' {
  return typeof value === 'string' && LEVELS.some(level => level === value)
    ? value as LegacyOversightLevel : 'UNKNOWN';
}

export interface CodeguardOversight {
  level: 'UNKNOWN';
  evidenceState: 'NOT_EVIDENCED';
  authority: 'NON_AUTHORITATIVE';
  source: { kind: 'LEGACY_CODEGUARD_HEURISTIC'; filePath: string };
  recommendation: {
    level: 'l2_human_review' | 'l3_human_approval';
    basis: 'CLASSIFIER_DEFAULT' | 'AUTONOMY_HEURISTIC' | 'CRITICAL_PRIORITY_HEURISTIC';
    authority: 'NON_AUTHORITATIVE';
  };
}

/** Neither source patterns nor enrichment are an authorized oversight decision.
 * This classifier has no admitted evidence input, so it cannot emit a known level. */
export function projectCodeguardOversight(agent: DiscoveredAgent, criticalPriority: boolean): CodeguardOversight {
  return {
    level: 'UNKNOWN', evidenceState: 'NOT_EVIDENCED', authority: 'NON_AUTHORITATIVE',
    source: { kind: 'LEGACY_CODEGUARD_HEURISTIC', filePath: agent.filePath },
    recommendation: {
      level: criticalPriority || agent.isAutonomous ? 'l3_human_approval' : 'l2_human_review',
      basis: criticalPriority ? 'CRITICAL_PRIORITY_HEURISTIC' : agent.isAutonomous ? 'AUTONOMY_HEURISTIC' : 'CLASSIFIER_DEFAULT',
      authority: 'NON_AUTHORITATIVE',
    },
  };
}
