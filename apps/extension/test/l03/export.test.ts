import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import PDFDocument = require('pdfkit');
import { TechnicalScanPDFGenerator } from '../../src/reports/pdf-generator';
import { ReportGenerator } from '../../src/report/generator';
import type { PlanType } from '../../src/license/manager';
import type { TechnicalFinding } from '../../src/report/types';

test('actual PDF export renders bounded authority and all severity levels, no score or positive absence', async () => {
    const text: string[] = [];
    const original = PDFDocument.prototype.text;
    PDFDocument.prototype.text = function (this: PDFKit.PDFDocument, ...args: Parameters<typeof original>) {
        text.push(String(args[0]));
        return original.apply(this, args);
    } as typeof original;
    try {
        for (const findings of [[], ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity, i) => ({
            severity, rule: `PATTERN_${i}`, category: 'SECURITY', line: i + 1,
            match: 'pattern', message: `Potential pattern ${i}`, file: 'input.ts',
        } as TechnicalFinding))]) {
            const report = ReportGenerator.generate(findings, 'FREE' as PlanType, ['input.ts'], { acquisition: 'INPUT_PROVIDED', detectors_run: ['fixture'] });
            const pdf = await new TechnicalScanPDFGenerator(report, { companyInfo: { name: 'Local Fixture', repository: 'input' } }).generate();
            assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
            assert.match(pdf.toString('latin1'), /Technical Scan Report/);
        }
    } finally {
        PDFDocument.prototype.text = original;
    }
    const rendered = text.join('\n');
    assert.match(rendered, /Analysis Limitations/);
    assert.match(rendered, /No findings were detected by this scan in the analyzed input/);
    assert.match(rendered, /HEURISTIC_NON_AUTHORITATIVE/);
    assert.match(rendered, /"certification":false/);
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) assert.match(rendered, new RegExp(`\\[${severity}\\]`));
    assert.match(rendered, /Location: input.ts:4/);
    assert.match(rendered, /Recommendation:/);
    assert.doesNotMatch(rendered, /\bscore\b|\bgrade\b|\/100|\baligned\b|\bcompliant\b|\bcertified\b|Great job/i);
});

test('CLI report source entry produces a bounded local PDF, including a zero-file input', () => {
    const extension = resolve(__dirname, '../..');
    const artifactRoot = resolve(extension, '../../.artifacts/l03');
    mkdirSync(artifactRoot, { recursive: true });
    const work = mkdtempSync(join(artifactRoot, 'export-'));
    const empty = join(work, 'empty');
    mkdirSync(empty);
    const input = join(work, 'input');
    mkdirSync(input);
    writeFileSync(join(input, 'routes.ts'), "app.get('/admin', handler);\n");
    for (const target of [empty, input]) {
        const output = execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, resolve(extension, 'bin/codeguard.ts'), 'report', target], {
            cwd: work, env: { ...process.env, CODEGUARD_LICENSE_KEY: '' }, encoding: 'utf8', timeout: 30000,
        });
        assert.match(output, /Generating Technical Scan Report/);
        const pdf = readFileSync(join(work, 'report.pdf'));
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.match(pdf.toString('latin1'), /Technical Scan Report/);
    }
});
