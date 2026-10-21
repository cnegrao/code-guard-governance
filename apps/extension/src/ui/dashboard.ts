
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
 * Generate webview content for Deep Compliance Audit results
 */
export function getComplianceAuditWebviewContent(result: any): string {
    const statusColors: Record<string, string> = {
        'pass': '#4caf50',
        'warn': '#ff9800',
        'fail': '#d32f2f'
    };

    const statusEmojis: Record<string, string> = {
        'pass': '✅',
        'warn': '⚠️',
        'fail': '❌'
    };

    const severityColors: Record<string, string> = {
        'High': '#d32f2f',
        'Alta': '#d32f2f',
        'Medium': '#ff9800',
        'Média': '#ff9800',
        'Low': '#4caf50',
        'Baixa': '#4caf50'
    };

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>CodeGuard Compliance Audit Report</title>
    <style>
        :root {
            --primary: #007acc;
            --success: #4caf50;
            --warning: #ff9800;
            --danger: #d32f2f;
            --bg-dark: #1e1e1e;
            --bg-card: #252526;
            --border: #3c3c3c;
            --text: #cccccc;
            --text-muted: #888888;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-dark);
            color: var(--text);
            padding: 20px;
            line-height: 1.6;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 12px;
            margin-bottom: 20px;
            border: 1px solid var(--border);
        }
        
        .header h1 {
            font-size: 1.5em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .header .logo {
            font-size: 1.8em;
        }
        
        .status-badge {
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 0.9em;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: var(--primary);
        }
        
        .stat-label {
            color: var(--text-muted);
            font-size: 0.85em;
            margin-top: 5px;
        }
        
        .framework-section {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 15px;
            overflow: hidden;
        }
        
        .framework-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid var(--border);
            cursor: pointer;
        }
        
        .framework-header:hover {
            background: rgba(255,255,255,0.05);
        }
        
        .framework-name {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .framework-stats {
            display: flex;
            gap: 15px;
            align-items: center;
        }
        
        .issue-count {
            background: var(--danger);
            color: white;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 0.85em;
        }
        
        .issue-count.zero {
            background: var(--success);
        }
        
        .framework-body {
            padding: 15px 20px;
        }
        
        .issue-item {
            background: rgba(0,0,0,0.2);
            border-left: 3px solid var(--danger);
            padding: 12px 15px;
            margin-bottom: 10px;
            border-radius: 0 6px 6px 0;
        }
        
        .issue-item.medium {
            border-color: var(--warning);
        }
        
        .issue-item.low {
            border-color: var(--success);
        }
        
        .issue-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }
        
        .issue-title {
            font-weight: 500;
            flex: 1;
        }
        
        .severity-badge {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .issue-meta {
            color: var(--text-muted);
            font-size: 0.85em;
            display: flex;
            gap: 15px;
            margin-bottom: 8px;
        }
        
        .issue-recommendation {
            background: rgba(0,122,204,0.1);
            border: 1px solid rgba(0,122,204,0.3);
            padding: 10px;
            border-radius: 4px;
            font-size: 0.9em;
            margin-top: 10px;
        }
        
        .issue-recommendation strong {
            color: var(--primary);
        }
        
        .code-fix {
            background: var(--bg-dark);
            border: 1px solid var(--border);
            padding: 10px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.85em;
            margin-top: 10px;
            white-space: pre-wrap;
            overflow-x: auto;
        }
        
        .btn {
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            transition: opacity 0.2s;
        }
        
        .btn:hover { opacity: 0.8; }
        
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        
        .btn-success {
            background: var(--success);
            color: white;
        }
        
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        
        .summary-box {
            background: rgba(0,122,204,0.1);
            border: 1px solid var(--primary);
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
        }
        
        .timestamp {
            color: var(--text-muted);
            font-size: 0.85em;
            text-align: right;
            margin-top: 20px;
        }
        
    <style>
        /* ... existing styles ... */
        
        .certificate-container {
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(33, 150, 243, 0.1) 100%);
            border: 2px solid #4caf50;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 25px;
            text-align: center;
            position: relative;
            overflow: hidden;
            animation: slideDown 0.5s ease-out;
        }

        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .cert-badge-icon {
            font-size: 3em;
            margin-bottom: 10px;
            display: inline-block;
            filter: drop-shadow(0 0 10px rgba(76, 175, 80, 0.5));
        }

        .cert-title {
            font-size: 1.8em;
            font-weight: 800;
            background: linear-gradient(to right, #4caf50, #2196f3);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }

        .cert-desc {
            color: var(--text);
            margin-bottom: 20px;
            font-size: 1.1em;
        }

        .share-actions {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn-social {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            color: white;
            font-size: 0.95em;
            text-decoration: none;
        }

        .btn-social:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            text-decoration: none;
        }

        .btn-linkedin { background: #0077b5; }
        .btn-twitter { background: #000000; border: 1px solid #333; }
        .btn-copy { background: #424242; border: 1px solid #666; }
        // ... existing styles ...
        .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.6); }
        .modal-content { background-color: var(--bg-card); margin: 10% auto; padding: 20px; border: 1px solid var(--border); width: 80%; max-width: 600px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); animation: slideDown 0.3s; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border); }
        .loader { border: 4px solid var(--bg-dark); border-top: 4px solid var(--primary); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .confetti {
            position: absolute;
            width: 10px;
            height: 10px;
            background-color: #f00;
            animation: fall 3s linear infinite;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>
                <span class="logo">🛡️</span>
                CodeGuard Compliance Audit
            </h1>
            ${result.metadata?.clientName ? `<div style="color: var(--text-muted); font-size: 0.9em; margin-top: 5px;">Prepared for: <strong>${escapeHtml(String(result.metadata.clientName))}</strong> ${result.metadata.repoUrl ? `• ${escapeHtml(String(result.metadata.repoUrl))}` : ''}</div>` : ''}
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <button class="btn btn-primary" data-action="exportReport">📥 Export Report</button>
            <span class="status-badge" style="background: ${statusColors[result.overall_status] || statusColors.fail}; color: white;">
                ${statusEmojis[result.overall_status] || '❌'} ${result.overall_status.toUpperCase()}
            </span>
        </div>
    </div>
    
    ${result.overall_status === 'pass' ? `
    <div class="certificate-container" id="successBanner">
        <div class="cert-badge-icon">🏆</div>
        <div class="cert-title">CERTIFIED COMPLIANT</div>
        <p class="cert-desc">This repository has passed all CodeGuard AI compliance & security checks.</p>
        
        <div class="share-actions">
            <a href="https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent('Just verified my code compliance with CodeGuard AI! 🛡️ \n\nCertified secure and GDPR/LGPD compliant.\n\n#CodeGuard #DevSecOps #Compliance #CleanCode')}" target="_blank" class="btn-social btn-linkedin">
                <span>🔗</span> Share on LinkedIn
            </a>
            <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Just verified my code compliance with CodeGuard AI! 🛡️  Certified secure and GDPR/LGPD compliant. #CodeGuard #DevSecOps')}" target="_blank" class="btn-social btn-twitter">
                <span>𝕏</span> Share on X
            </a>
            <button class="btn-social btn-copy" data-action="copyBadge">
                <span>📋</span> Copy Badge Markdown
            </button>
        </div>
    </div>
    ` : ''}
    
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${result.files_analyzed}</div>
            <div class="stat-label">Arquivos Analisados</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${result.frameworks_audited.length}</div>
            <div class="stat-label">Frameworks</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: ${result.total_issues > 0 ? 'var(--danger)' : 'var(--success)'}">${result.total_issues}</div>
            <div class="stat-label">Total Issues</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: ${result.critical_issues > 0 ? 'var(--danger)' : 'var(--success)'}">${result.critical_issues}</div>
            <div class="stat-label">Issues Críticas</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${(result.execution_time_ms / 1000).toFixed(1)}s</div>
            <div class="stat-label">Tempo de Execução</div>
        </div>
    </div>
    
    ${result.results.map((fw: any) => `
        <div class="framework-section">
            <div class="framework-header" data-action="toggleCollapse">
                <div class="framework-name">
                    <span class="expand-icon">▼</span>
                    ${statusEmojis[fw.status_overall] || '❌'} ${escapeHtml(String(fw.frameworkName || fw.framework || ''))}
                </div>
                <div class="framework-stats">
                    <span class="issue-count ${fw.issues.length === 0 ? 'zero' : ''}">${fw.issues.length} issues</span>
                    <small style="color: var(--text-muted)">${escapeHtml(String(fw.llm_used || ''))}</small>
                </div>
            </div>
            <div class="framework-body">
                ${fw.issues.length === 0 ? `
                    <div class="no-issues">✅ Nenhum problema detectado para este framework.</div>
                ` : fw.issues.map((issue: any) => {
        const severityClass = (issue.severity === 'High' || issue.severity === 'Alta') ? '' :
            (issue.severity === 'Medium' || issue.severity === 'Média') ? 'medium' : 'low';
        return `
                        <div class="issue-item ${severityClass}">
                            <div class="issue-header">
                                <div class="issue-title">${escapeHtml(String(issue.issue || ''))}</div>
                                <span class="severity-badge" style="background: ${severityColors[issue.severity] || severityColors.Low}; color: white;">
                                    ${escapeHtml(String(issue.severity || ''))}
                                </span>
                            </div>
                            <div class="issue-meta">
                                <span>📍 ${escapeHtml(String(issue.file_path || ''))}</span>
                                ${issue.line_start ? `<span>📍 Linha ${issue.line_start}${issue.line_end && issue.line_end !== issue.line_start ? '-' + issue.line_end : ''}</span>` : ''}
                                ${issue.article || issue.control || issue.regulation ? `<span>📜 ${escapeHtml(String(issue.article || issue.control || issue.regulation || ''))}</span>` : ''}
                            </div>
                            ${issue.recommendation ? `
                                <div class="issue-recommendation">
                                    <strong>💡 Recomendação:</strong> ${escapeHtml(String(issue.recommendation || ''))}
                                </div>
                            ` : ''}
                            ${issue.code_fix ? `
                                <div class="code-fix">${escapeHtml(String(issue.code_fix || ''))}</div>
                                <div class="actions">
                                    <button class="btn btn-success" data-action="applyFix" data-code="${encodeURIComponent(String(issue.code_fix || ''))}" data-file="${encodeURIComponent(String(issue.file_path || ''))}" data-line-start="${encodeURIComponent(String(issue.line_start || 1))}" data-line-end="${encodeURIComponent(String(issue.line_end || issue.line_start || 1))}">✨ Aplicar Correção</button>
                                </div>
                            ` : ''}
                        </div>
                    `;
    }).join('')}
                
                ${fw.summary ? `
                    <div class="summary-box">
                        <strong>📋 Resumo:</strong> ${escapeHtml(String(fw.summary || ''))}
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('')}
    
    <div class="timestamp">
        Região: ${result.region} | Gerado em: ${new Date(result.timestamp).toLocaleString('pt-BR')}
    </div>
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function copyBadge() {
            const badgeMarkdown = '[![CodeGuard Compliance](https://img.shields.io/badge/CodeGuard-Certified-success?style=for-the-badge&logo=shield)](https://codeguard.ai)';
            navigator.clipboard.writeText(badgeMarkdown).then(() => {
                const btn = document.querySelector('.btn-copy');
                const originalText = btn ? btn.innerHTML : '';
                if (btn) btn.innerHTML = '<span>✅</span> Copied!';
                setTimeout(() => {
                    if (btn) btn.innerHTML = originalText;
                }, 2000);
            });
        }

        document.addEventListener('click', (e) => {
            const target = e.target;
            const el = target && target.closest ? target.closest('[data-action]') : null;
            if (!el) return;

            const action = el.getAttribute('data-action');

            if (action === 'exportReport') {
                vscode.postMessage({ command: 'exportReport' });
                return;
            }

            if (action === 'copyBadge') {
                copyBadge();
                return;
            }

            if (action === 'toggleCollapse') {
                el.classList.toggle('collapsed');
                return;
            }

            if (action === 'applyFix') {
                const code = decodeURIComponent(el.getAttribute('data-code') || '');
                const filePath = decodeURIComponent(el.getAttribute('data-file') || '');
                const lineStart = parseInt(decodeURIComponent(el.getAttribute('data-line-start') || '1'), 10) || 1;
                const lineEnd = parseInt(decodeURIComponent(el.getAttribute('data-line-end') || String(lineStart)), 10) || lineStart;

                vscode.postMessage({
                    command: 'applyFix',
                    code,
                    filePath,
                    lineStart,
                    lineEnd
                });
            }
        });
    </script>
</body>
</html>`;
}

