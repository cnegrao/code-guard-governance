import PDFDocument = require('pdfkit');
import type { TechnicalScanReport } from '../report/types';

export interface ReportConfig {
    companyInfo: { name: string; repository: string };
}

/** Local technical export; consumes exactly the same bounded contract as Quick Scan. */
export class TechnicalScanPDFGenerator {
    constructor(private report: TechnicalScanReport, private config: ReportConfig) {}

    async generate(): Promise<Buffer> {
        const doc = new PDFDocument({
            size: 'A4', margin: 50,
            info: { Title: `Technical Scan Report - ${this.config.companyInfo.name}`, Author: 'CodeGuard AI' },
        });
        const chunks: Buffer[] = [];
        const complete = new Promise<Buffer>((resolve, reject) => {
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
        });
        doc.fontSize(24).fillColor('#253e68').text('Technical Scan Report').moveDown();
        doc.fontSize(11).fillColor('#1f2937')
            .text(this.config.companyInfo.name)
            .text(`Input group: ${this.config.companyInfo.repository}`)
            .text(`Timestamp: ${this.report.timestamp}`)
            .text('Heuristic - Non-authoritative - Scanned input only').moveDown();
        doc.fontSize(16).text('Analysis Limitations').moveDown(0.5);
        doc.fontSize(10).text(this.report.summary);
        for (const limitation of this.report.limitations) doc.text(limitation).moveDown(0.5);
        doc.text(`Acquisition: ${this.report.acquisition}`)
            .text(`Boundary: ${JSON.stringify(this.report.analysis_boundary)}`)
            .text(`Detectors run: ${this.report.detectors_run.join(', ') || 'Not recorded'}`).moveDown();
        const c = this.report.summary_counts;
        doc.fontSize(16).text('Detected Findings').moveDown(0.5);
        doc.fontSize(10).text(`Total: ${c.total} | Critical: ${c.critical} | High: ${c.high} | Medium: ${c.medium} | Low: ${c.low}`)
            .text(`Shown: ${this.report.reported_counts.total}; omitted: ${this.report.findings_omitted}`).moveDown();
        for (const [i, f] of this.report.findings.entries()) {
            doc.fontSize(11).text(`${i + 1}. [${f.severity}] ${f.rule} (${f.category})`);
            doc.fontSize(10).text(f.message)
                .text(`Location: ${f.file || this.report.files_analyzed.join(', ')}:${f.line}`)
                .text(`Recommendation: ${this.report.recommendations[i]?.text || 'Review pattern in context.'}`)
                .text(`Fixability: ${f.suggestedFix ? 'Suggested fix available; review before applying.' : 'Manual review'}`).moveDown();
        }
        doc.fontSize(16).text('Files Analyzed').moveDown(0.5);
        for (const file of this.report.files_analyzed) doc.fontSize(10).text(file);
        doc.end();
        return complete;
    }
}
