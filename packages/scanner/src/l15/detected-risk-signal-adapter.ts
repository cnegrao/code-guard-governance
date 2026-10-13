import {
  validateL15MachineSignalCommand, type L15MachineSignalCommand, type L15Subject, type L15SupportRef,
} from '@council/canonical-contracts';
import type { DetectedRisk } from '../core/types';

/**
 * M17-S1 scanner `DetectedRisk` -> RISK_SIGNAL adapter (ADR-GOVIA-RISK-INTELLIGENCE-v1 §4.3, §23 "INPUT / SIGNAL ONLY").
 *
 * The scanner risk heuristic enters M17 ONLY as a non-authoritative signal:
 *  - signal kind is DETECTED_PATTERN or DETECTED_ABSENCE only (closed per rule below), source SYSTEM_DETECTOR, trust INFERRED;
 *  - method_id = `SCANNER_DETECTED_RISK:<rule id>` + the mandatory detector version (no unversioned detector);
 *  - exact source evidence (DISCOVERY_EVIDENCE / SOURCE_ASSERTION / TECHNICAL_FIELD_STATE refs) is required, never fabricated;
 *  - `severity` becomes `hintSeverity` ONLY; DetectedRisk has no confidence, so `hintConfidence` is null;
 *  - `category` is DROPPED: it never becomes a risk domain (legal / compliance / financial / architectural have no V1 domain);
 *  - `cgagControl`, `title`, `description`, `recommendation`, `file`, `line` are informational scanner text: never stored in
 *    L15, never a control, never a proposal, rating, lifecycle or authority input.
 * The output command has no domain / rating / score / status / owner / text field by construction.
 */
export const SCANNER_DETECTED_RISK_METHOD_PREFIX = 'SCANNER_DETECTED_RISK:';

export interface DetectedRiskRule {
  readonly signalKind: 'DETECTED_PATTERN' | 'DETECTED_ABSENCE';
  /** The artifact / pattern the detector looks for (presentation only: "<observation>: not detected" / "detected"). */
  readonly observation: string;
}

/** Every current scanner rule id (packages/scanner/src/core/risk-detector.ts): 30 rules, closed. */
export const DETECTED_RISK_RULES = {
  'RISK-NO-LICENSE': { signalKind: 'DETECTED_ABSENCE', observation: 'LICENSE file' },
  'RISK-NO-README': { signalKind: 'DETECTED_ABSENCE', observation: 'README file' },
  'RISK-NO-CICD': { signalKind: 'DETECTED_ABSENCE', observation: 'CI/CD pipeline configuration' },
  'RISK-NO-ENV-EXAMPLE': { signalKind: 'DETECTED_ABSENCE', observation: '.env.example file' },
  'RISK-NO-DOCKER': { signalKind: 'DETECTED_ABSENCE', observation: 'Dockerfile' },
  'RISK-AUTH-GAP': { signalKind: 'DETECTED_PATTERN', observation: 'API route without an authentication check' },
  'RISK-AI-NO-AUTH': { signalKind: 'DETECTED_ABSENCE', observation: 'authenticated AI route' },
  'RISK-PII-DETECTED': { signalKind: 'DETECTED_PATTERN', observation: 'potential personal-data field in a data asset' },
  'RISK-AI-ACT': { signalKind: 'DETECTED_PATTERN', observation: 'LLM / AI model usage' },
  'RISK-DEP-OVERLOAD': { signalKind: 'DETECTED_PATTERN', observation: 'more than 30 production dependencies' },
  'RISK-PAYMENT': { signalKind: 'DETECTED_PATTERN', observation: 'payment dependency' },
  'RISK-TS-STRICT': { signalKind: 'DETECTED_PATTERN', observation: 'TypeScript configuration without strict mode' },
  'RISK-NO-TESTS': { signalKind: 'DETECTED_ABSENCE', observation: 'test framework' },
  'RISK-SHADOW-AI': { signalKind: 'DETECTED_PATTERN', observation: 'LLM call without a registry reference' },
  'RISK-NO-RLS': { signalKind: 'DETECTED_ABSENCE', observation: 'row-level-security policy file' },
  'RISK-NO-CSP': { signalKind: 'DETECTED_ABSENCE', observation: 'content-security-policy configuration' },
  'RISK-NO-AUDIT-CHAIN': { signalKind: 'DETECTED_ABSENCE', observation: 'audit / log table' },
  'RISK-NO-OBSERVABILITY': { signalKind: 'DETECTED_ABSENCE', observation: 'observability tooling reference' },
  'RISK-NO-RATE-LIMIT': { signalKind: 'DETECTED_ABSENCE', observation: 'rate-limiting mechanism' },
  'RISK-DEV-UNLOCK': { signalKind: 'DETECTED_PATTERN', observation: 'debug / auth-bypass code pattern' },
  'RISK-NO-RETENTION': { signalKind: 'DETECTED_ABSENCE', observation: 'data-retention mechanism' },
  'RISK-NO-VENDOR-ASSESSMENT': { signalKind: 'DETECTED_ABSENCE', observation: 'vendor / DPA documentation' },
  'RISK-NO-DISASTER-RECOVERY': { signalKind: 'DETECTED_ABSENCE', observation: 'backup / disaster-recovery reference' },
  'RISK-NO-INCIDENT-RESPONSE': { signalKind: 'DETECTED_ABSENCE', observation: 'incident-response documentation' },
  'RISK-NO-DPO': { signalKind: 'DETECTED_ABSENCE', observation: 'DPO / privacy-officer reference' },
  'RISK-NO-API-VERSIONING': { signalKind: 'DETECTED_ABSENCE', observation: 'API version prefix' },
  'RISK-NO-DSR': { signalKind: 'DETECTED_ABSENCE', observation: 'data-subject-request endpoint' },
  'RISK-NO-DEP-AUDIT': { signalKind: 'DETECTED_ABSENCE', observation: 'dependency-audit configuration' },
  'RISK-VENDOR-LOCKIN': { signalKind: 'DETECTED_PATTERN', observation: 'single AI provider' },
  'RISK-NO-BIAS-TESTING': { signalKind: 'DETECTED_ABSENCE', observation: 'bias / fairness evaluation reference' },
} as const satisfies Record<string, DetectedRiskRule>;
export type DetectedRiskRuleId = keyof typeof DETECTED_RISK_RULES;

export interface DetectedRiskSignalContext {
  readonly organisationId: string;
  readonly intakeKey: string;
  readonly subject: L15Subject;
  /** Mandatory detector version (method_version). */
  readonly detectorVersion: string;
  /** Exact source evidence of the scan (never fabricated). */
  readonly evidence: readonly L15SupportRef[];
  /** Source observation time only when the evidence carries one; never defaulted. */
  readonly observedAt?: string | null;
}

export class DetectedRiskAdapterError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'DetectedRiskAdapterError'; }
}

export function detectedRiskToSignal(risk: DetectedRisk, ctx: DetectedRiskSignalContext): L15MachineSignalCommand {
  if (!Object.hasOwn(DETECTED_RISK_RULES, risk.id)) throw new DetectedRiskAdapterError('SCANNER_RULE_UNKNOWN');
  if (!ctx.detectorVersion) throw new DetectedRiskAdapterError('DETECTOR_VERSION_REQUIRED');
  if (ctx.evidence.length < 1) throw new DetectedRiskAdapterError('SCANNER_EVIDENCE_REQUIRED');
  const rule: DetectedRiskRule = DETECTED_RISK_RULES[risk.id as DetectedRiskRuleId];
  return validateL15MachineSignalCommand({
    organisationId: ctx.organisationId,
    intakeKey: ctx.intakeKey,
    signalKind: rule.signalKind,
    sourceClass: 'SYSTEM_DETECTOR',
    subject: ctx.subject,
    trustState: 'INFERRED',
    methodId: `${SCANNER_DETECTED_RISK_METHOD_PREFIX}${risk.id}`,
    methodVersion: ctx.detectorVersion,
    hintSeverity: risk.severity,
    hintConfidence: null,
    observedAt: ctx.observedAt ?? null,
    gap: null,
    support: ctx.evidence,
  });
}

/** Non-authoritative presentation of a scanner rule observation: absence is literally "not detected". */
export function presentDetectedRiskRule(ruleId: string): string {
  if (!Object.hasOwn(DETECTED_RISK_RULES, ruleId)) throw new DetectedRiskAdapterError('SCANNER_RULE_UNKNOWN');
  const rule: DetectedRiskRule = DETECTED_RISK_RULES[ruleId as DetectedRiskRuleId];
  return `${rule.observation}: ${rule.signalKind === 'DETECTED_ABSENCE' ? 'not detected' : 'detected'}`;
}
