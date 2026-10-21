import type { Violation } from '../scanner/gdpr';
import type { PlanType } from '../license/manager';

/** Source rule IDs/categories are traceability metadata, never framework results. */
export type TechnicalFinding = Violation & { file?: string };

export interface SummaryCounts {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
}

export const ANALYSIS_BOUNDARY = Object.freeze({
    kind: 'TECHNICAL_SCAN',
    source: 'DETERMINISTIC_TECHNICAL_SCAN',
    authority: 'HEURISTIC_NON_AUTHORITATIVE',
    scope: 'SCANNED_INPUT_ONLY',
    compliance_determination: false,
    legal_conclusion: false,
    certification: false,
    assurance: false,
} as const);

export const ANALYSIS_LIMITATION = 'This does not establish legal compliance, framework satisfaction, control effectiveness, certification or completeness. It is not a legal conclusion or assurance.';
export type AcquisitionState = 'INPUT_PROVIDED' | 'EMPTY_INPUT' | 'NO_FILES' | 'PARTIAL_INPUT' | 'UNKNOWN';

export interface TechnicalScanReport {
    analysis_boundary: typeof ANALYSIS_BOUNDARY;
    findings: TechnicalFinding[];
    /** Counts include detected findings hidden by an existing plan limit. */
    summary_counts: SummaryCounts;
    reported_counts: SummaryCounts;
    findings_omitted: number;
    detection_state: 'DETECTED' | 'NO_FINDINGS_DETECTED_IN_SCANNED_INPUT' | 'NOT_ASSESSED';
    summary: string;
    recommendations: { rule: string; line: number; file?: string; text: string }[];
    files_analyzed: string[];
    acquisition: AcquisitionState;
    detectors_run: string[];
    plan: PlanType;
    detector_access: 'FREE' | 'PAID' | 'CREDITS';
    timestamp: string;
    limitations: string[];
}
