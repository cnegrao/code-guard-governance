import type { PlanType } from '../license/manager';
import { ANALYSIS_BOUNDARY, ANALYSIS_LIMITATION } from './types';
import type { AcquisitionState, TechnicalFinding, TechnicalScanReport, SummaryCounts } from './types';

interface ScanOptions {
    acquisition?: AcquisitionState;
    detectors_run?: string[];
    detector_access?: TechnicalScanReport['detector_access'];
    finding_limit?: number;
}

export class ReportGenerator {
    static generate(
        detected: TechnicalFinding[], plan: PlanType, filesAnalyzed: string[], options: ScanOptions = {}
    ): TechnicalScanReport {
        const acquisition = filesAnalyzed.length === 0 ? 'NO_FILES' : (options.acquisition ?? 'UNKNOWN');
        const limit = options.finding_limit ?? detected.length;
        const findings = detected.slice(0, Math.max(0, limit));
        const notAssessed = acquisition === 'NO_FILES' || acquisition === 'EMPTY_INPUT';
        return {
            analysis_boundary: ANALYSIS_BOUNDARY,
            findings,
            summary_counts: this.calculateCounts(detected),
            reported_counts: this.calculateCounts(findings),
            findings_omitted: detected.length - findings.length,
            detection_state: detected.length > 0 ? 'DETECTED' : notAssessed ? 'NOT_ASSESSED' : 'NO_FINDINGS_DETECTED_IN_SCANNED_INPUT',
            summary: detected.length > 0
                ? `${detected.length} technical findings detected in the analyzed input; ${findings.length} shown.`
                : notAssessed ? 'No non-empty input was available for assessment.'
                : 'No findings were detected by this scan in the analyzed input.',
            recommendations: findings.map(f => ({
                rule: f.rule, line: f.line, file: f.file,
                text: f.fixDescription || `Review the detected ${f.rule} pattern in its source context.`,
            })),
            files_analyzed: [...filesAnalyzed],
            acquisition,
            detectors_run: [...(options.detectors_run ?? [])],
            plan,
            detector_access: options.detector_access ?? (plan === 'FREE' ? 'FREE' : 'PAID'),
            timestamp: new Date().toISOString(),
            limitations: [
                ANALYSIS_LIMITATION,
                'Heuristic, non-authoritative pattern detection in scanned input only; false positives and false negatives are possible. Categories and rule IDs identify detector sources only.',
                'Only the listed detectors ran. Unexecuted detectors and inputs outside the listed files were not assessed.',
                ...(acquisition !== 'INPUT_PROVIDED' ? [`Input acquisition: ${acquisition}. No completeness conclusion is available.`] : []),
                ...(detected.length > findings.length ? ['Some detected findings are omitted by the current plan display limit.'] : []),
            ],
        };
    }

    private static calculateCounts(findings: TechnicalFinding[]): SummaryCounts {
        return {
            total: findings.length,
            critical: findings.filter(f => f.severity === 'CRITICAL').length,
            high: findings.filter(f => f.severity === 'HIGH').length,
            medium: findings.filter(f => f.severity === 'MEDIUM').length,
            low: findings.filter(f => f.severity === 'LOW').length,
        };
    }
}
