
import type { TechnicalScanReport } from '../report/types';

/**
 * SECURITY: HTML escaping utility to prevent XSS attacks
 * Escapes user-controlled data before inserting into HTML
 */
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

export function getWebviewContent(report: TechnicalScanReport): string {
    const nonce = getNonce();
    const isPaid = report.detector_access !== 'FREE';
    const counts = report.summary_counts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Technical Scan Report</title>
<style>
body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 28px; background: #141820; color: #e2e8f0; }
header, .metrics { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
h1 { margin: 0; font-size: 24px; } h2 { font-size: 18px; }
section, .metric { background: #1d2430; border: 1px solid #394457; border-radius: 8px; padding: 18px; margin-top: 20px; }
.metrics { gap: 12px; } .metric { flex: 1; min-width: 100px; } .metric strong { display: block; font-size: 26px; }
.muted { color: #b7c3d5; } .limitations { border-left: 4px solid #8aa3c7; } .neutral { color: #cbd5e1; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 12px; border-bottom: 1px solid #394457; vertical-align: top; }
.table { overflow-x: auto; } code { overflow-wrap: anywhere; } button { background: #253e68; color: #fff; border: 1px solid #8aa3c7; border-radius: 5px; padding: 8px; cursor: pointer; }
.critical { color: #fda4af; } .high { color: #fdba74; } .medium { color: #fde68a; }
</style>
</head>
<body>
<header><div><h1>Technical Scan</h1><div class="muted">Heuristic - Non-authoritative - Scanned input only</div></div>
<div>${escapeHtml(report.plan)} plan / ${escapeHtml(report.detector_access)} detector access
${!isPaid ? '<button data-action="upgrade">Upgrade Plan</button>' : ''}</div></header>
<section class="limitations" aria-label="Analysis Limitations">
<h2>Analysis Limitations</h2>
<p>${escapeHtml(report.summary)}</p>
${report.limitations.map(l => `<p>${escapeHtml(l)}</p>`).join('')}
<div class="muted">Acquisition: ${escapeHtml(report.acquisition)} | Scope: SCANNED_INPUT_ONLY</div>
</section>
<div class="metrics">
<div class="metric">Detected Findings<strong>${counts.total}</strong></div>
<div class="metric">Critical<strong>${counts.critical}</strong></div>
<div class="metric">High<strong>${counts.high}</strong></div>
<div class="metric">Medium<strong>${counts.medium}</strong></div>
<div class="metric">Low<strong>${counts.low}</strong></div>
</div>
<section><h2>Scanned Input</h2>
<ul>${report.files_analyzed.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>
<p>Detectors run: ${report.detectors_run.map(escapeHtml).join(', ') || 'Not recorded'}. Detector labels do not establish framework satisfaction.</p>
<p>Findings shown: ${report.reported_counts.total}; omitted by display limit: ${report.findings_omitted}.</p>
<div class="muted">${escapeHtml(report.timestamp)}</div></section>
<section><h2>Detected Findings</h2><div class="table"><table>
<thead><tr><th>Severity</th><th>Source / Rule</th><th>Detected Pattern</th><th>Location</th><th>Recommendation / Fixability</th></tr></thead>
<tbody>${report.findings.map((f, i) => `<tr>
<td class="${f.severity.toLowerCase()}">${escapeHtml(f.severity)}</td>
<td>${escapeHtml(f.category)}<br><code>${escapeHtml(f.rule)}</code></td>
<td>${escapeHtml(f.message)}</td>
<td><code>${escapeHtml(f.file || report.files_analyzed.join(', '))}</code><br>Line ${f.line}</td>
<td>${escapeHtml(report.recommendations[i]?.text || 'Review detected pattern in context.')}<br>
${f.suggestedFix ? `<button data-action="applyFix" data-fix="${encodeURIComponent(f.suggestedFix)}">Suggested Fix</button>` : 'Manual review'}</td>
</tr>`).join('')}
${report.findings.length === 0 ? `<tr><td colspan="5" class="neutral">${escapeHtml(report.summary)}<p>${escapeHtml(report.limitations[0])}</p></td></tr>` : ''}
</tbody></table></div></section>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'upgrade') vscode.postMessage({ command: 'upgrade' });
    if (action === 'applyFix') vscode.postMessage({ command: 'fixViolation', id: decodeURIComponent(btn.getAttribute('data-fix') || '') });
});
</script>
</body></html>`;
}

/**
 * Generate webview content for Deep Compliance Audit (LEGACY_TRANSPORT_IDENTIFIER).
 * Display only the closed technical-review contract; no fallback renderer.
 */
export function getComplianceAuditWebviewContent(result: import('../intelligence/review-contract').TechnicalFrameworkReviewResult): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LLM-Assisted Technical Framework Review</title>
<style>
body { font-family: system-ui, sans-serif; background: #111827; color: #e5e7eb; padding: 24px; }
section, aside { border: 1px solid #64748b; border-radius: 8px; padding: 16px; margin: 16px 0; }
.unknown { border: 2px dashed #fbbf24; }
.finding { border-left: 3px solid #fb923c; margin: 12px 0; padding: 12px; }
.scope, small { color: #cbd5e1; } pre { white-space: pre-wrap; } button { padding: 8px; }
</style></head><body>
<h1>LLM-Assisted Technical Framework Review</h1>
<aside aria-label="Analysis boundary">
<strong>${escapeHtml(result.analysis_boundary.authority)}</strong>
<p>Source: ${escapeHtml(result.analysis_boundary.kind)} — declared supplied input only.</p>
${result.limitations.map(limit => `<p>${escapeHtml(limit)}</p>`).join('')}
</aside>
${result.metadata?.clientName ? `<p>Prepared for: ${escapeHtml(result.metadata.clientName)} ${escapeHtml(result.metadata.repoUrl || '')}</p>` : ''}
<p>Technical counts: ${result.total_findings} potential findings; ${result.high_priority_findings} high-priority findings;
${result.frameworks_requested.length} references requested; ${result.frameworks_analyzed} complete reviews; ${result.frameworks_unknown} incomplete/unknown reviews.</p>
<p class="scope">${result.files_analyzed} supplied files. Acquisition: ${escapeHtml(result.acquisition.state)};
${result.acquisition.read_failures} read failures; ${result.acquisition.excluded_files} excluded files; ${result.acquisition.truncated_files} truncated files.</p>
<details><summary>Declared source scope</summary><pre>${escapeHtml(result.source_files.join('\n'))}</pre></details>
${result.results.map(fw => `<section class="${fw.completeness !== 'COMPLETE' ? 'unknown' : 'review'}">
<h2>${escapeHtml(fw.frameworkName)} (${escapeHtml(fw.framework)})</h2>
<p><strong>${escapeHtml(fw.analysis_state)}</strong> — ${fw.findings.length} potential technical finding(s)</p>
<p>Completeness: ${escapeHtml(fw.completeness)}. Required batches: ${fw.batches.required}; analyzed: ${fw.batches.analyzed}; failed: ${fw.batches.failed}.</p>
${fw.completeness !== 'COMPLETE' ? '<p>Unable to establish a complete technical review of the declared input.</p>' : ''}
<p>${escapeHtml(fw.summary)}</p>
<p class="scope">Model: ${escapeHtml(fw.llm_used)}. Source files: ${escapeHtml(fw.source_files.join(', '))}</p>
${fw.failures.map(f => `<p>Execution/acquisition uncertainty: ${escapeHtml(f.reason)} (batch ${f.batch_index === null ? 'scope' : f.batch_index})</p>`).join('')}
${fw.limitations.map(limit => `<p class="scope">${escapeHtml(limit)}</p>`).join('')}
${fw.findings.map(finding => `<article class="finding">
<strong>Potential technical finding — ${escapeHtml(finding.severity)} engineering priority</strong>
<p>Untrusted model-generated observation: ${escapeHtml(finding.technical_observation)}</p>
<p>${escapeHtml(finding.file_path)}:${finding.line_start}-${finding.line_end}</p>
${finding.reference_hint ? `<p>Reference hint for human review only: ${escapeHtml(finding.reference_hint)}. This does not establish applicability, violation or satisfaction.</p>` : ''}
<p>Engineering suggestion (untrusted model output): ${escapeHtml(finding.recommendation)}</p>
${finding.code_fix ? `<pre>${escapeHtml(finding.code_fix)}</pre><button data-action="applyFix" data-code="${encodeURIComponent(finding.code_fix)}" data-file="${encodeURIComponent(finding.file_path)}" data-line-start="${finding.line_start}" data-line-end="${finding.line_end}">Apply engineering suggestion</button>` : ''}
</article>`).join('')}
</section>`).join('')}
<p>Region: ${escapeHtml(result.region)}. Generated: ${escapeHtml(result.timestamp)}.</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', event => {
    const el = event.target && event.target.closest ? event.target.closest('[data-action="applyFix"]') : null;
    if (!el) return;
    vscode.postMessage({ command: 'applyFix', code: decodeURIComponent(el.getAttribute('data-code') || ''),
        filePath: decodeURIComponent(el.getAttribute('data-file') || ''),
        lineStart: Number(el.getAttribute('data-line-start')), lineEnd: Number(el.getAttribute('data-line-end')) });
});
</script></body></html>`;
}
