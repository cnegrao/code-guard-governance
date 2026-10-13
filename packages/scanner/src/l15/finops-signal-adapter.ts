import {
  validateL15MachineSignalCommand, type L15MachineSignalCommand, type L15Subject, type L15SupportRef,
} from '@council/canonical-contracts';
import type { FinOpsResult } from '../codeguard/enrichment/finops';

/**
 * M17-S1 FinOps detector -> RISK_SIGNAL adapter (ADR §23: "Flags INPUT / SIGNAL ONLY; estimate QUARANTINED").
 *
 * Only the five boolean pattern flags become DETECTED_PATTERN / DETECTED_ABSENCE signals. `monthlyCostEstimate`,
 * `breakdown[].estimatedMonthly`, `breakdown[].confidence`, `callCount`, `costHotspots` and `costRisk` (itself derived from the
 * heuristic estimate) are never read: no estimated amount becomes an L15 stored cost and no estimate becomes a governed fact or
 * a severity hint. Observed runtime cost exists only in L12 and can be cited later through RUNTIME_OBSERVATION_REF.
 */
export const SCANNER_FINOPS_METHOD_PREFIX = 'SCANNER_FINOPS:';

export const FINOPS_FLAG_RULES = {
  N_PLUS_ONE: { flag: 'nPlusOneDetected', signalKind: 'DETECTED_PATTERN', observation: 'N+1 call pattern' },
  EXPENSIVE_SCAN: { flag: 'expensiveScans', signalKind: 'DETECTED_PATTERN', observation: 'full-scan query pattern' },
  NETWORK_CALL_TIMEOUT: { flag: 'missingTimeout', signalKind: 'DETECTED_ABSENCE', observation: 'timeout on network calls' },
  NETWORK_CALL_RATE_LIMIT: { flag: 'missingRateLimit', signalKind: 'DETECTED_ABSENCE', observation: 'rate limiting on network calls' },
  NETWORK_CALL_CIRCUIT_BREAKER: { flag: 'missingCircuitBreaker', signalKind: 'DETECTED_ABSENCE', observation: 'circuit breaker / retry on network calls' },
} as const satisfies Record<string, { flag: keyof FinOpsResult; signalKind: 'DETECTED_PATTERN' | 'DETECTED_ABSENCE'; observation: string }>;
export type FinOpsFlagRuleId = keyof typeof FINOPS_FLAG_RULES;

export interface FinOpsSignalContext {
  readonly organisationId: string;
  /** Per-flag intake keys are `${intakeKeyPrefix}:${rule id}`. */
  readonly intakeKeyPrefix: string;
  readonly subject: L15Subject;
  readonly detectorVersion: string;
  readonly evidence: readonly L15SupportRef[];
}

export function finOpsToSignals(result: FinOpsResult, ctx: FinOpsSignalContext): L15MachineSignalCommand[] {
  if (!ctx.detectorVersion) throw new Error('DETECTOR_VERSION_REQUIRED');
  if (ctx.evidence.length < 1) throw new Error('SCANNER_EVIDENCE_REQUIRED');
  const commands: L15MachineSignalCommand[] = [];
  for (const [ruleId, rule] of Object.entries(FINOPS_FLAG_RULES) as [FinOpsFlagRuleId, (typeof FINOPS_FLAG_RULES)[FinOpsFlagRuleId]][]) {
    if (result[rule.flag] !== true) continue;
    commands.push(validateL15MachineSignalCommand({
      organisationId: ctx.organisationId,
      intakeKey: `${ctx.intakeKeyPrefix}:${ruleId}`,
      signalKind: rule.signalKind,
      sourceClass: 'SYSTEM_DETECTOR',
      subject: ctx.subject,
      trustState: 'INFERRED',
      methodId: `${SCANNER_FINOPS_METHOD_PREFIX}${ruleId}`,
      methodVersion: ctx.detectorVersion,
      hintSeverity: null,
      hintConfidence: null,
      observedAt: null,
      gap: null,
      support: ctx.evidence,
    }));
  }
  return commands;
}
