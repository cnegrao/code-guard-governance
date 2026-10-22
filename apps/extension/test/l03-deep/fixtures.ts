import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { AIClient } from '../../src/intelligence/ai_client';
import { ComplianceOrchestrator } from '../../src/intelligence/orchestrator';
import { ContextBatcher, FileContext } from '../../src/intelligence/batcher';
import { CodingMemory } from '../../src/intelligence/memory';
import { RepoIntelligence } from '../../src/intelligence/ril';
import { PatchEngine } from '../../src/intelligence/patch';
import { getLLMRouter } from '../../src/core/llm-router';
import { costAnalytics } from '../../src/dashboard/cost-analytics';
import { parseFrameworkReview, REVIEW_BOUNDARY, REVIEW_LIMITATIONS } from '../../src/intelligence/review-contract';
import type { TechnicalFrameworkReviewResult } from '../../src/intelligence/review-contract';
import { getComplianceAuditWebviewContent } from '../../src/ui/dashboard';
import { smartRouter } from '../../src/optimization/smart-router';
import { budgetAlerts } from '../../src/alerts/budget-alerts';

// Production monitoring singletons own recurring timers; test workers need neither.
// Their health checks are simulated, but the timers would keep Node alive indefinitely.
smartRouter.stop();
budgetAlerts.stop();

export const files: FileContext[] = [{ path: 'input.ts', relativePath: 'input.ts', content: 'const count = 1;\n', language: 'typescript', tokenEstimate: 4 }];
export const potentialFinding = {
    file_path: 'input.ts', line_start: 1, line_end: 1, technical_observation: 'Potential sensitive value logging pattern',
    reference_hint: 'Art. 32 (mapping hint)', severity: 'High', recommendation: 'Review logging at this source location',
};
export const output = (framework = 'GDPR', findings: object[] = [], extras: object = {}) => JSON.stringify({
    framework, analysis_state: findings.length ? 'FINDINGS_DETECTED' : 'NO_FINDINGS_DETECTED', findings,
    summary: 'fully compliant, passed GDPR, certified', limitations: ['model says satisfied'], ...extras,
});

export function assertSafe(result: TechnicalFrameworkReviewResult) {
    assert.deepEqual(result.analysis_boundary, REVIEW_BOUNDARY);
    assert.deepEqual(result.limitations, REVIEW_LIMITATIONS);
    const reject = ['status_overall', 'overall_status', 'compliant', 'certified', 'alignment', 'score', 'compliance_score', 'certification_status', 'risk_classification', 'risk_class', 'entity_type'];
    const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
            assert.ok(!reject.includes(key), key);
            visit(nested);
        }
    };
    visit(JSON.parse(JSON.stringify(result)));
    for (const review of result.results) {
        assert.deepEqual(review.analysis_boundary, REVIEW_BOUNDARY);
        assert.doesNotMatch(review.summary, /fully compliant|passed GDPR|certified|satisfied/i);
    }
}

/** Local deterministic substitutes only. No provider, embeddings, hosted DB or credits calls. */
export function localDependencies(t: TestContext, responses: Array<string | null | Error>, batchCount = 1) {
    const calls: any[] = [];
    const prompts: any[] = [];
    t.mock.method(ComplianceOrchestrator.prototype as any, 'setupCostManagement', () => {});
    t.mock.method(ContextBatcher.prototype, 'collectWorkspaceFiles', async () => files);
    t.mock.method(ContextBatcher.prototype, 'getAcquisition', () => ({ state: 'COMPLETE', read_failures: 0, excluded_files: 0, truncated_files: 0 }));
    t.mock.method(ContextBatcher.prototype, 'batchFiles', () => Array.from({ length: batchCount }, (_, batchIndex) => ({ files, totalTokens: 4, batchIndex })));
    t.mock.method(CodingMemory.prototype, 'initialize', async () => {});
    t.mock.method(CodingMemory.prototype, 'query', async () => ({ contextString: '', chunks: [], totalTokens: 0, relevanceScores: [] }));
    t.mock.method(RepoIntelligence.prototype, 'indexRepository', async () => ({} as any));
    t.mock.method(RepoIntelligence.prototype, 'buildDependencyGraph', async () => ({} as any));
    t.mock.method(RepoIntelligence.prototype, 'identifySensitiveFiles', async () => []);
    t.mock.method(PatchEngine.prototype, 'generatePatch', async () => ({ fixedCode: 'const count = 2;' } as any));
    t.mock.method(getLLMRouter(), 'route', () => ({ provider: 'openai', estimatedCost: 0, reason: 'local fixture' } as any));
    t.mock.method(getLLMRouter(), 'trackUsage', () => {});
    t.mock.method(costAnalytics, 'record', (entry: any) => { calls.push(entry); });
    t.mock.method(AIClient, 'complete', async (prompt: string, options: any) => {
        prompts.push({ prompt, options });
        const value = responses.shift();
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error('Unexpected model call in test');
        return value;
    });
    return { calls, prompts };
}
