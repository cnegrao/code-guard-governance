import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComplianceOrchestrator } from '../../src/intelligence/orchestrator';
import { ContextBatcher } from '../../src/intelligence/batcher';
import { CodingMemory } from '../../src/intelligence/memory';
import { parseFrameworkReview } from '../../src/intelligence/review-contract';
import { getComplianceAuditWebviewContent } from '../../src/ui/dashboard';
import { vscode } from '../../src/utils/vscode-compat';
import { files, potentialFinding, output, assertSafe, localDependencies } from './fixtures';

for (const [label, response, state, complete, findingCount] of [
    ['potential high-priority finding', output('GDPR', [potentialFinding]), 'FINDINGS_DETECTED', 'COMPLETE', 1],
    ['clean source, zero findings', output(), 'NO_FINDINGS_DETECTED', 'COMPLETE', 0],
    ['malformed JSON', '{invalid RAW_SECRET', 'UNKNOWN', 'UNKNOWN', 0],
    ['model throws', new Error('RAW_SECRET provider failure'), 'UNKNOWN', 'UNKNOWN', 0],
    ['empty model response', null, 'UNKNOWN', 'UNKNOWN', 0],
    ['legacy pass-only response', '{"framework":"GDPR","status_overall":"pass","compliant":true,"certified":true}', 'UNKNOWN', 'UNKNOWN', 0],
] as const) {
    test(label, async t => {
        const { calls } = localDependencies(t, [response]);
        const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
        assertSafe(result);
        const review = result.results[0];
        assert.equal(review.analysis_state, state);
        assert.equal(review.completeness, complete);
        assert.equal(result.total_findings, findingCount);
        assert.equal(result.high_priority_findings, findingCount);
        assert.equal(calls[0].success, complete === 'COMPLETE');
        assert.equal(review.batches.failed, complete === 'COMPLETE' ? 0 : 1);
        assert.doesNotMatch(JSON.stringify(result), /RAW_SECRET/);
        if (findingCount) assert.equal(review.findings[0].code_fix, 'const count = 2;');
    });
}

for (const [label, responses, state, completeness, count] of [
    ['zero findings then required batch failure', [output(), new Error('failure')], 'UNKNOWN', 'PARTIAL', 0],
    ['finding then required batch failure', [output('GDPR', [potentialFinding]), new Error('failure')], 'FINDINGS_DETECTED', 'PARTIAL', 1],
    ['failure then finding (continue required batches)', [new Error('failure'), output('GDPR', [potentialFinding])], 'FINDINGS_DETECTED', 'PARTIAL', 1],
    ['all required batches fail', [new Error('failure'), '{bad'], 'UNKNOWN', 'UNKNOWN', 0],
    ['all required batches return zero findings', [output(), output()], 'NO_FINDINGS_DETECTED', 'COMPLETE', 0],
] as const) {
    test(label, async t => {
        localDependencies(t, [...responses], 2);
        const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
        assertSafe(result);
        assert.equal(result.results[0].analysis_state, state);
        assert.equal(result.results[0].completeness, completeness);
        assert.equal(result.total_findings, count);
        assert.equal(result.results[0].batches.required, 2);
    });
}

test('multiple references: UNKNOWN alongside findings has only descriptive counts', async t => {
    localDependencies(t, [new Error('model error'), output('ISO27001', [potentialFinding])]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR', 'ISO27001']);
    assertSafe(result);
    assert.equal(result.frameworks_unknown, 1);
    assert.equal(result.frameworks_analyzed, 1);
    assert.equal(result.total_findings, 1);
    assert.deepEqual(result.results.map(r => r.analysis_state), ['UNKNOWN', 'FINDINGS_DETECTED']);
});

test('arbitrary affirmative model keys and raw summaries are excluded by the allowlist', async t => {
    const extras = { status_overall: 'pass', overall_status: 'pass', compliant: true, certified: true, alignment: '100%', risk_classification: 'minimal', analysis_boundary: { certification: true }, arbitrary: 'yes' };
    localDependencies(t, [output('GDPR', [{ ...potentialFinding, ...extras }], extras)]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    assertSafe(result);
    assert.equal(result.results[0].analysis_state, 'FINDINGS_DETECTED');
    assert.equal(JSON.stringify(result).includes('arbitrary'), false);
    assert.deepEqual(Object.keys(result.results[0].findings[0]).sort(), ['file_path','line_start','line_end','technical_observation','reference_hint','severity','recommendation','code_fix'].sort());
});

for (const value of [null, [], {}, { framework: 'GDPR', findings: [] },
    { framework: 'GDPR', analysis_state: 'pass', findings: [] },
    { framework: 'GDPR', analysis_state: 'FINDINGS_DETECTED', findings: [] },
    { framework: 'GDPR', analysis_state: 'NO_FINDINGS_DETECTED', findings: [potentialFinding] },
    { framework: 'GDPR', analysis_state: 'FINDINGS_DETECTED', findings: [{ ...potentialFinding, line_start: -1 }] },
    { framework: 'GDPR', analysis_state: 'FINDINGS_DETECTED', findings: [{ ...potentialFinding, file_path: '../outside.ts' }] },
    { framework: 'GDPR', analysis_state: 'FINDINGS_DETECTED', findings: [{ ...potentialFinding, severity: 'pass' }] },
]) {
    test(`parser fails closed on unsupported shape ${JSON.stringify(value).slice(0, 95)}`, () => {
        const parsed = parseFrameworkReview(JSON.stringify(value), 'GDPR', files);
        assert.equal(parsed.completed, false);
        assert.deepEqual(parsed.findings, []);
    });
}

test('model uncertainty can preserve potential findings without claiming completeness', async t => {
    localDependencies(t, [output('GDPR', [potentialFinding], { analysis_state: 'UNKNOWN' })]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    assertSafe(result);
    assert.equal(result.results[0].analysis_state, 'UNKNOWN');
    assert.equal(result.results[0].completeness, 'PARTIAL');
    assert.equal(result.total_findings, 1);
    assert.equal(result.results[0].failures[0].reason, 'MODEL_UNCERTAINTY');
});

for (const state of ['PARTIAL', 'UNKNOWN'] as const) {
    test(`acquisition ${state} cannot become a complete no-findings review`, async t => {
        localDependencies(t, [output()]);
        (ContextBatcher.prototype.getAcquisition as any).mock.mockImplementation(() => ({ state, read_failures: 1, excluded_files: 0, truncated_files: 0 }));
        const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
        assert.equal(result.results[0].analysis_state, 'UNKNOWN');
        assert.notEqual(result.results[0].completeness, 'COMPLETE');
        assert.equal(result.results[0].failures[0].reason, 'ACQUISITION_INCOMPLETE');
    });
}

test('RAG acquisition failure is separate from detected source findings', async t => {
    localDependencies(t, [output('GDPR', [potentialFinding])]);
    (CodingMemory.prototype.query as any).mock.mockImplementation(async () => { throw new Error('private context failure'); });
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    assert.equal(result.results[0].analysis_state, 'UNKNOWN');
    assert.equal(result.results[0].completeness, 'PARTIAL');
    assert.equal(result.results[0].failures[0].reason, 'ACQUISITION_INCOMPLETE');
});

test('zero acquired input/batches remains UNKNOWN without any model call', async t => {
    const { prompts } = localDependencies(t, [], 0);
    (ContextBatcher.prototype.collectWorkspaceFiles as any).mock.mockImplementation(async () => []);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    assert.equal(result.results[0].analysis_state, 'UNKNOWN');
    assert.equal(result.results[0].completeness, 'UNKNOWN');
    assert.equal(prompts.length, 0);
});

for (const [label, response] of [['findings', output('GDPR', [potentialFinding])], ['neutral zero', output()], ['unknown', '{broken']] as const) {
    test(`deep UI: ${label}, boundary/scope/uncertainty without certification affordances`, async t => {
        localDependencies(t, [response]);
        const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
        const html = getComplianceAuditWebviewContent(result);
        assert.match(html, /LLM-Assisted Technical Framework Review/);
        assert.match(html, /HEURISTIC_NON_AUTHORITATIVE/);
        assert.match(html, /This does not establish framework satisfaction or legal compliance/);
        assert.match(html, /Completeness:/);
        assert.match(html, /Declared source scope/);
        assert.doesNotMatch(html, /CERTIFIED COMPLIANT|certificate-container|copyBadge|shields\.io|linkedin|twitter|✅|PASS|fully compliant|passed GDPR/i);
        if (label === 'neutral zero') assert.match(html, /No findings were detected in the analyzed input for this review/);
        if (label === 'unknown') assert.match(html, /Unable to establish a complete technical review/);
        if (label === 'findings') assert.match(html, /Reference hint for human review only/);
    });
}

test('deep UI escapes model findings and source metadata', async t => {
    localDependencies(t, [output('GDPR', [{ ...potentialFinding, technical_observation: '<script>bad()</script>' }])]);
    const result = await new ComplianceOrchestrator().runAudit('EU', ['GDPR']);
    const html = getComplianceAuditWebviewContent(result);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>bad/);
});

test('actual batcher records read failure and exclusions without erasing uncertainty', async t => {
    t.mock.method(vscode.workspace.fs, 'readDirectory', async () => [['input.ts', 1], ['unread.ts', 1], ['empty.ts', 1], ['large.ts', 1]]);
    t.mock.method(vscode.workspace.fs, 'readFile', async (uri: any) => {
        if (uri.fsPath.endsWith('unread.ts')) throw new Error('private filesystem reason');
        return Buffer.from(uri.fsPath.endsWith('empty.ts') ? '' : uri.fsPath.endsWith('large.ts') ? 'a'.repeat(50001) : 'const count = 1;');
    });
    const batcher = new ContextBatcher();
    const acquired = await batcher.collectWorkspaceFiles('D:/local-review-fixture');
    assert.equal(acquired.length, 1);
    assert.deepEqual(batcher.getAcquisition(), { state: 'PARTIAL', read_failures: 1, excluded_files: 2, truncated_files: 0 });
});

test('actual batcher marks truncation separately from source findings', () => {
    const batcher = new ContextBatcher(1);
    const batches = batcher.batchFiles(files);
    assert.equal(batches.length, 1);
    assert.equal(batcher.getAcquisition().state, 'PARTIAL');
    assert.equal(batcher.getAcquisition().truncated_files, 1);
});
