import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TechnicalScanEngine } from '../../src/scanner/compliance';
import { ReportGenerator } from '../../src/report/generator';
import { ANALYSIS_BOUNDARY, ANALYSIS_LIMITATION } from '../../src/report/types';
import type { TechnicalFinding, TechnicalScanReport } from '../../src/report/types';
import type { LicenseStatus, PlanType } from '../../src/license/manager';
import { getWebviewContent } from '../../src/ui/dashboard';

const free: LicenseStatus = { plan: 'FREE' as PlanType, isValid: true, maxViolations: 5 };
const paid: LicenseStatus = { plan: 'PROFESSIONAL' as PlanType, isValid: true, maxViolations: Infinity };
const scan = (code: string, license = paid, credits = false) => TechnicalScanEngine.scanCode(code, license, credits, 'fixture.ts');
const finding = (severity: TechnicalFinding['severity'], category: TechnicalFinding['category'] = 'GDPR'): TechnicalFinding => ({
    rule: 'TEST_PATTERN', severity, category, line: 3, match: 'pattern', message: 'Potential pattern',
    suggestedFix: 'replacement', fixDescription: 'Review replacement', file: 'fixture.ts',
});

export function assertBoundary(report: TechnicalScanReport) {
    assert.deepEqual(report.analysis_boundary, ANALYSIS_BOUNDARY);
    assert.deepEqual(Object.keys(report).sort(), [
        'analysis_boundary', 'findings', 'summary_counts', 'reported_counts', 'findings_omitted',
        'detection_state', 'summary', 'recommendations', 'files_analyzed', 'acquisition', 'detectors_run',
        'plan', 'detector_access', 'timestamp', 'limitations',
    ].sort());
    const json = JSON.parse(JSON.stringify(report));
    for (const key of ['score', 'grade', 'complianceMapping', 'aligned', 'compliant', 'certified', 'certification', 'readiness']) {
        assert.equal(Object.prototype.hasOwnProperty.call(json, key), false, key);
    }
    for (const value of ['compliance_determination', 'legal_conclusion', 'certification', 'assurance']) {
        assert.equal(json.analysis_boundary[value], false);
    }
    assert.ok(report.limitations.includes(ANALYSIS_LIMITATION));
}

test('zero findings is neutral, scope-limited, and carries no positive determination', () => {
    const report = scan('const count = 1;');
    assertBoundary(report);
    assert.equal(report.summary_counts.total, 0);
    assert.equal(report.detection_state, 'NO_FINDINGS_DETECTED_IN_SCANNED_INPUT');
    assert.equal(report.summary, 'No findings were detected by this scan in the analyzed input.');
    assert.deepEqual(report.files_analyzed, ['fixture.ts']);
    assert.deepEqual(report.recommendations, []);
    assert.doesNotMatch(report.summary, /aligned|compliant|pass|secure|certified/i);
});

for (const [label, code, category, severity] of [
    ['low AI Act pattern', 'const creditScore = 1;', 'AI_ACT', 'LOW'],
    ['critical GDPR pattern', 'const email = "someone@example.com";', 'GDPR', 'CRITICAL'],
    ['LGPD pattern', 'const cpf = value;', 'LGPD', 'MEDIUM'],
    ['security PCI pattern', 'const card = "4111111111111111";', 'SECURITY', 'CRITICAL'],
] as const) {
    test(label, () => {
        const report = scan(code);
        assertBoundary(report);
        assert.equal(report.findings.length, 1);
        assert.equal(report.findings[0].category, category);
        assert.equal(report.findings[0].severity, severity);
        assert.equal(report.detection_state, 'DETECTED');
        assert.equal(report.recommendations.length, 1);
        assert.equal(report.recommendations[0].rule, report.findings[0].rule);
    });
}

test('mixed severity has exact counts and preserves rule, match, location, recommendation and fixability', () => {
    const findings = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => finding(s as TechnicalFinding['severity']));
    const report = ReportGenerator.generate(findings, paid.plan, ['fixture.ts']);
    assertBoundary(report);
    assert.deepEqual(report.summary_counts, { total: 4, critical: 1, high: 1, medium: 1, low: 1 });
    assert.deepEqual(report.findings, findings);
    assert.deepEqual(report.recommendations[0], { rule: 'TEST_PATTERN', line: 3, file: 'fixture.ts', text: 'Review replacement' });
});

for (const [name, license, credits, count, access] of [
    ['free', free, false, 0, 'FREE'],
    ['paid', paid, false, 2, 'PAID'],
    ['credits', free, true, 2, 'CREDITS'],
] as const) {
    test(`${name} changes detector access without changing authority`, () => {
        const report = scan('const cpf = input;\nconst creditScore = 1;', license, credits);
        assertBoundary(report);
        assert.equal(report.findings.length, count);
        assert.equal(report.detector_access, access);
        assert.equal(report.plan, license.plan);
        assert.equal(report.detectors_run.includes('AI Act'), count > 0);
    });
}

test('display limits preserve total detected counts and cannot turn hidden findings into absence', () => {
    const report = scan(Array(7).fill('const email = "person@example.com";').join('\n'), free);
    assert.equal(report.summary_counts.total, 7);
    assert.equal(report.reported_counts.total, 5);
    assert.equal(report.findings_omitted, 2);
    const hidden = scan('const email = "person@example.com";', { ...free, maxViolations: 0 });
    assert.equal(hidden.detection_state, 'DETECTED');
    assert.match(getWebviewContent(hidden), /1 technical findings detected/);
    assert.doesNotMatch(getWebviewContent(hidden), /No findings were detected/);
});

for (const [name, report] of [
    ['empty active file', scan('   ')],
    ['zero files', ReportGenerator.generate([], free.plan, [])],
    ['partial input', ReportGenerator.generate([], free.plan, ['part.ts'], { acquisition: 'PARTIAL_INPUT' })],
    ['unknown acquisition', ReportGenerator.generate([], free.plan, ['unknown.ts'])],
] as const) {
    test(`${name} stays bounded and cannot imply completeness`, () => {
        assertBoundary(report);
        assert.notEqual(report.acquisition, 'INPUT_PROVIDED');
        assert.doesNotMatch(report.summary, /aligned|compliant|pass|secure|certified/i);
        assert.match(report.limitations.join(' '), /No completeness conclusion/);
        if (report.acquisition === 'EMPTY_INPUT' || report.acquisition === 'NO_FILES') assert.equal(report.detection_state, 'NOT_ASSESSED');
    });
}

test('active webview has immediately visible limits and neutral absence; no score/certificate/share panel', () => {
    for (const report of [scan('const count = 1;'), scan('const creditScore = 1;'), scan('const cpf = input;', free)]) {
        const html = getWebviewContent(report);
        assert.ok(html.indexOf(ANALYSIS_LIMITATION) < html.indexOf('<table>'));
        assert.match(html, /Technical Scan/);
        assert.match(html, /SCANNED_INPUT_ONLY/);
        assert.doesNotMatch(html, /Overall Security Score|Compliance Overview|Active Violations|Detailed Compliance Reports|\/\s*100|scoreColor|scoreGradient|check_circle|text-success|certificate-container|CERTIFIED COMPLIANT|shareActive|intent\/tweet|Great job|aligned/i);
        assert.doesNotMatch(html, /\b(?:compliant|certified|pass)\b/i);
    }
});

test('webview escapes source details and retains suggested fixes', () => {
    const report = ReportGenerator.generate([{ ...finding('LOW'), message: '<script>attack</script>' }], paid.plan, ['<input>.ts']);
    const html = getWebviewContent(report);
    assert.match(html, /&lt;script&gt;attack&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>attack/);
    assert.match(html, /Suggested Fix/);
    assert.match(html, /data-fix="replacement"/);
    assert.match(html, /Review replacement/);
});
