import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { TechnicalScanReport } from '../../src/report/types';
// @ts-expect-error legacy determination contract was removed, with no compatibility alias
import type { ComplianceReport, ComplianceMapping, ScanResult } from '../../src/report/types';

const root = resolve(__dirname, '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

test('closed type contract rejects former determination fields and affirmative authority', () => {
    function typeContract(report: TechnicalScanReport) {
        // @ts-expect-error no score
        report.score;
        // @ts-expect-error no grade
        report.grade;
        // @ts-expect-error no framework mapping
        report.complianceMapping;
        // @ts-expect-error no compliance claim
        report.compliant;
        // @ts-expect-error no certificate claim
        report.certified;
        // @ts-expect-error no readiness result
        report.readiness;
        // @ts-expect-error no top-level certification result
        report.certification;
        // @ts-expect-error closed non-authoritative authority
        const authority: TechnicalScanReport['analysis_boundary']['authority'] = 'CERTIFIED';
        // @ts-expect-error cannot issue a certificate
        const certificate: TechnicalScanReport['analysis_boundary']['certification'] = true;
        // @ts-expect-error cannot infer alignment from absence
        const state: TechnicalScanReport['detection_state'] = 'aligned';
        return [authority, certificate, state];
    }
    assert.equal(typeof typeContract, 'function');
});

test('local producer/export graph has no old contract or score/mapping computation', () => {
    const dashboard = source('src/ui/dashboard.ts').split('/**\n * Generate webview content for Deep Compliance Audit')[0];
    const cliReport = source('bin/codeguard.ts').split('async function runReport()')[1].split('async function installMcp')[0];
    for (const text of [dashboard, cliReport, ...[
        'src/report/types.ts', 'src/report/generator.ts', 'src/scanner/compliance.ts', 'src/reports/pdf-generator.ts',
    ].map(source)]) {
        assert.doesNotMatch(text, /ComplianceReport|ComplianceMapping|CompliancePDFGenerator|\bScanResult\b|\bscore\b|\bgrade\b|complianceMapping|\baligned\b|\bcompliant\b|\bcertified\b|\breadiness\b/i);
        assert.doesNotMatch(text, /(?:certification|assurance|legal_conclusion|compliance_determination)\s*:\s*true/);
    }
    assert.match(source('src/extension.ts'), /TechnicalScanEngine\.scanCode\(.*document\.uri\.toString\(\)/);
    assert.doesNotMatch(source('src/extension.ts'), /ComplianceEngine|Compliance Risk Report/);
    const command = JSON.parse(source('package.json')).contributes.commands.find((c: { command: string }) => c.command === 'codeguard.scan');
    assert.equal(command.title, 'CodeGuard: Quick Technical Scan (Local/Free)');
});

test('API/dispatcher do not serialize or depend on the Quick Scan report; LLM path is deferred', () => {
    for (const file of ['api/scan.ts', 'api/v1/scan.ts', 'src/core/dispatcher.ts']) {
        assert.doesNotMatch(source(file), /TechnicalScanReport|ComplianceReport|ComplianceEngine|TechnicalScanEngine|report\/generator|report\/types/);
    }
    assert.match(source('api/scan.ts'), /dispatcher\.dispatch\('codeguard_audit'/);
    assert.match(source('src/core/dispatcher.ts'), /this\.orchestrator\.runAudit/);
    assert.match(source('src/extension.ts'), /getComplianceAuditWebviewContent\(result\)/);
});
