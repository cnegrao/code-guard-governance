/** Closed technical-review contract. Model output never supplies product authority. */
export const REVIEW_BOUNDARY = Object.freeze({
    kind: 'LLM_ASSISTED_TECHNICAL_FRAMEWORK_REVIEW',
    authority: 'HEURISTIC_NON_AUTHORITATIVE',
    legal_conclusion: false,
    compliance_determination: false,
    framework_satisfaction: false,
    control_effectiveness: false,
    certification: false,
    attestation: false,
    assurance: false,
} as const);

export const REVIEW_LIMITATIONS = Object.freeze([
    'This does not establish framework satisfaction or legal compliance.',
    'No legal applicability, regulatory classification, control effectiveness, audit outcome, readiness, certification, attestation or assurance is determined.',
    'Only the declared supplied source input is reviewed; excluded, unread and external organizational facts are outside scope.',
    'Potential findings and reference hints are untrusted model-generated engineering suggestions requiring human/domain/legal review where applicable.',
    'Reference hints do not establish applicability, violation or satisfaction; reference topics and retrieved context are informational, not verified current operative law.',
    'A generated or applied engineering fix does not establish compliance.',
] as const);

export type AnalysisState = 'FINDINGS_DETECTED' | 'NO_FINDINGS_DETECTED' | 'UNKNOWN';
export type ReviewCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type ReviewFailure = 'MODEL_FAILURE' | 'MALFORMED_OUTPUT' | 'UNSUPPORTED_OUTPUT' | 'MODEL_UNCERTAINTY' | 'ACQUISITION_INCOMPLETE' | 'ANALYSIS_FAILURE';

export interface TechnicalFrameworkFinding {
    file_path: string;
    line_start: number;
    line_end: number;
    technical_observation: string;
    reference_hint?: string;
    severity: 'High' | 'Medium' | 'Low';
    recommendation: string;
    code_fix?: string;
}

export interface ReviewAcquisition {
    state: ReviewCompleteness;
    read_failures: number;
    excluded_files: number;
    truncated_files: number;
}

export interface FrameworkReviewResult {
    analysis_boundary: typeof REVIEW_BOUNDARY;
    framework: string;
    frameworkName: string;
    analysis_state: AnalysisState;
    completeness: ReviewCompleteness;
    findings: TechnicalFrameworkFinding[];
    summary: string;
    limitations: readonly string[];
    batches: { required: number; analyzed: number; failed: number };
    failures: Array<{ batch_index: number | null; reason: ReviewFailure }>;
    source_files: string[];
    llm_used: string;
    execution_time_ms: number;
}

export interface TechnicalFrameworkReviewResult {
    analysis_boundary: typeof REVIEW_BOUNDARY;
    region: 'BR' | 'EU' | 'US' | 'GLOBAL';
    frameworks_requested: string[];
    frameworks_analyzed: number;
    frameworks_unknown: number;
    total_findings: number;
    high_priority_findings: number;
    results: FrameworkReviewResult[];
    files_analyzed: number;
    source_files: string[];
    acquisition: ReviewAcquisition;
    limitations: readonly string[];
    total_tokens_used: number;
    execution_time_ms: number;
    timestamp: string;
    metadata?: { clientName?: string; repoUrl?: string; consultationDate?: string };
}

export interface ParsedReview {
    findings: TechnicalFrameworkFinding[];
    completed: boolean;
    reason?: ReviewFailure;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 16000;

/** Strict shape validation plus field allowlisting; no legacy fallback or raw summary. */
export function parseFrameworkReview(raw: string, framework: string, sources: Array<{ relativePath: string; path: string; content: string }>): ParsedReview {
    const unknown = (reason: ReviewFailure): ParsedReview => ({ findings: [], completed: false, reason });
    let value: unknown;
    try {
        const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
        value = JSON.parse(fenced ? fenced[1] : raw);
    } catch { return unknown('MALFORMED_OUTPUT'); }
    if (!record(value) || value.framework !== framework || !Array.isArray(value.findings) ||
        !['FINDINGS_DETECTED', 'NO_FINDINGS_DETECTED', 'UNKNOWN'].includes(String(value.analysis_state))) return unknown('UNSUPPORTED_OUTPUT');
    const findings: TechnicalFrameworkFinding[] = [];
    for (const item of value.findings) {
        if (!record(item) || !text(item.file_path) || !text(item.technical_observation) || !text(item.recommendation) ||
            !Number.isInteger(item.line_start) || !Number.isInteger(item.line_end) ||
            !['High', 'Medium', 'Low'].includes(String(item.severity)) ||
            (item.reference_hint !== undefined && !text(item.reference_hint)) ||
            (item.code_fix !== undefined && !text(item.code_fix))) return unknown('UNSUPPORTED_OUTPUT');
        const source = sources.find(f => f.relativePath === item.file_path || f.path === item.file_path);
        if (!source || (item.line_start as number) < 1 || (item.line_end as number) < (item.line_start as number) ||
            (item.line_end as number) > source.content.split('\n').length) return unknown('UNSUPPORTED_OUTPUT');
        findings.push({
            file_path: source.relativePath, line_start: item.line_start as number, line_end: item.line_end as number,
            technical_observation: item.technical_observation, severity: item.severity as TechnicalFrameworkFinding['severity'],
            recommendation: item.recommendation,
            ...(item.reference_hint === undefined ? {} : { reference_hint: item.reference_hint }),
            ...(item.code_fix === undefined ? {} : { code_fix: item.code_fix }),
        });
    }
    if (value.analysis_state === 'UNKNOWN') return { findings, completed: false, reason: 'MODEL_UNCERTAINTY' };
    if ((findings.length > 0) !== (value.analysis_state === 'FINDINGS_DETECTED')) return unknown('UNSUPPORTED_OUTPUT');
    return { findings, completed: true };
}

export function reviewSummary(state: AnalysisState, count: number): string {
    if (state === 'UNKNOWN') return 'Unable to establish a complete technical review of the declared input.';
    if (state === 'NO_FINDINGS_DETECTED') return 'No findings were detected in the analyzed input for this review.';
    return `${count} potential technical finding(s) detected in the analyzed input.`;
}
