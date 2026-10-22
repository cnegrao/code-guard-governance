/**
 * LLM-assisted technical framework review orchestration.
 * 
 * ESTRATÉGIA DE LLM (docs/LLM_API_STRATEGY.md):
 * - Scan: Kimi K2.5 (contexto 262k, $0.15/M)
 * - Patch: GPT-4o-mini ($0.60/M output - 85% mais barato que Haiku)
 * - Embeddings: SiliconFlow (~$0.01/M - 10x mais barato que OpenAI)
 * - Explain: Kimi K2.5 (contexto longo)
 * - Fallback: OpenRouter (+5.5% markup - apenas emergência)
 */

import type * as vscodeTypes from 'vscode';
import { vscode } from '../utils/vscode-compat';
import { AIClient } from './ai_client';
import { ContextBatcher, BatchedContext, FileContext } from './batcher';
import { FrameworkConfig, getFrameworksByRegion, getLLMForFramework } from './frameworks';
import { getPromptForFramework } from './prompts';
import { LLMRouter, getLLMRouter } from '../core/llm-router';
import { getProviderForTask, estimateCost, PROVIDERS, TaskType, ROUTING_CONFIG } from '../core/llm-config';

// Cost Management System
import { costAnalytics, getCostAnalytics } from '../dashboard/cost-analytics';
import { budgetAlerts, getBudgetAlerts } from '../alerts/budget-alerts';
import { smartRouter, getSmartRouter } from '../optimization/smart-router';

// Antigravity Core (MCP)
import { RepoIntelligence } from './ril';
import { CodingMemory } from './memory';
import { PatchEngine, Violation } from './patch';
import { REVIEW_BOUNDARY, REVIEW_LIMITATIONS, FrameworkReviewResult, TechnicalFrameworkReviewResult,
    TechnicalFrameworkFinding, ReviewAcquisition, parseFrameworkReview, reviewSummary } from './review-contract';

// LEGACY_TRANSPORT_IDENTIFIER: class name and runAudit retained for existing callers only.
export class ComplianceOrchestrator {
    private batcher: ContextBatcher;
    private router: LLMRouter;

    // Antigravity Core
    private ril: RepoIntelligence;
    private memory: CodingMemory;
    private patcher: PatchEngine;

    private usageStats: {
        scans: number;
        tokensUsed: number;
        estimatedCost: number;
        providers: Record<string, number>;
    };

    constructor() {
        this.batcher = new ContextBatcher(80000); // 80k tokens per batch
        this.router = getLLMRouter();

        // Initialize Antigravity Core
        this.memory = new CodingMemory();
        this.ril = new RepoIntelligence({ memory: this.memory });
        this.patcher = new PatchEngine();

        this.usageStats = {
            scans: 0,
            tokensUsed: 0,
            estimatedCost: 0,
            providers: {}
        };

        // Initialize cost management system
        this.setupCostManagement();
        console.error('[Orchestrator] Stack Antigravity v2.0 inicializado (RIL + Memory + Patch)');
    }

    /**
     * Configure cost management system with alerts and monitoring
     */
    private setupCostManagement(): void {
        // Set budget limit from config
        const monthlyLimit = ROUTING_CONFIG.costLimits.maxMonthly || 1000;
        budgetAlerts.setLimit(monthlyLimit);

        // Listen for budget alerts
        budgetAlerts.on('alert', (alert) => {
            console.error(`🚨 [BUDGET ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`);
            console.error(`   Spend: $${alert.currentSpend.toFixed(2)} / $${alert.limit} (${alert.percentage.toFixed(1)}%)`);
        });

        // Listen for circuit breaker events
        smartRouter.on('circuitOpen', ({ provider, resetAt }) => {
            console.warn(`⚠️ [SmartRouter] Circuit OPENED for ${provider}, reset at ${resetAt}`);
        });

        smartRouter.on('circuitClose', ({ provider }) => {
            console.error(`✅ [SmartRouter] Circuit CLOSED for ${provider}`);
        });

        // Listen for routing decisions
        smartRouter.on('route', (decision) => {
            console.error(`[SmartRouter] Routed to ${decision.provider} (${decision.reason})`);
        });

        console.error(`[CostManagement] Configurado: limite $${monthlyLimit}/mês`);
    }

    /**
     * Run a technical review of the declared acquired source input.
     * runAudit is a LEGACY_TRANSPORT_IDENTIFIER; it grants no audit authority.
     */
    async runAudit(
        region: 'BR' | 'EU' | 'US',
        selectedFrameworks?: string[],
        progress?: any, // Use any to avoid runtime dependency on types
        metadata?: { clientName?: string; repoUrl?: string },
        targetDir?: string,
        suppliedInputOnly = false
    ): Promise<TechnicalFrameworkReviewResult> {
        const startTime = Date.now();
        const results: FrameworkReviewResult[] = [];

        // 1. Get frameworks for region
        const allFrameworks = getFrameworksByRegion(region);
        const frameworks = selectedFrameworks
            ? allFrameworks.filter(f => selectedFrameworks.includes(f.id))
            : allFrameworks;

        if (frameworks.length === 0) {
            throw new Error('No framework references selected for technical review');
        }

        progress?.report({ message: 'Collecting workspace files...' });

        // 2. Collect and batch files
        let files: FileContext[] = [];
        let collectionFailed = false;
        try { files = await this.batcher.collectWorkspaceFiles(targetDir); }
        catch { collectionFailed = true; }


        const batches = this.batcher.batchFiles(files);
        const acquisition: ReviewAcquisition = this.batcher.getAcquisition?.() || {
            state: 'UNKNOWN', read_failures: 0, excluded_files: 0, truncated_files: 0
        };
        if (collectionFailed || files.length === 0 || batches.length === 0) acquisition.state = 'UNKNOWN';
        // console.debug(this.batcher.getStats(files, batches));

        // --- ANTIGRAVITY PHASE 1: INTELLIGENCE ---
        progress?.report({ message: '🧠 Antigravity: Indexing repository & Graph...' });
        const rootPath = suppliedInputOnly ? undefined : targetDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        let contextAvailable = true;
        try {
            if (rootPath) {
                const repoContext = await this.ril.indexRepository(rootPath);
                await this.ril.buildDependencyGraph(repoContext);
                await this.ril.identifySensitiveFiles(repoContext);
            }
            await this.memory.initialize({ files });
        } catch {
            contextAvailable = false;
            acquisition.state = 'PARTIAL';
        }

        let totalTokensUsed = 0;
        let totalEstimatedCost = 0;
        const incrementPerFramework = 100 / frameworks.length;

        // NOVO: Selecionar provider otimizado para scan
        const scanRouting = this.router.route('scan');
        console.error(`[Orchestrator] Scan Provider: ${scanRouting.provider} (${scanRouting.reason})`);
        console.error(`[Orchestrator] Custo estimado por batch: $${scanRouting.estimatedCost.toFixed(4)}`);

        // 3. Run each framework audit
        for (const framework of frameworks) {
            const frameworkStartTime = Date.now();
            progress?.report({
                message: `Reviewing technical signals for ${framework.name} via ${scanRouting.provider}...`,
                increment: incrementPerFramework / 2
            });

            try {
                const frameworkResult = await this.auditFramework(framework, batches, scanRouting.provider, acquisition, contextAvailable);
                frameworkResult.execution_time_ms = Date.now() - frameworkStartTime;
                results.push(frameworkResult);

                // Calcular tokens e custo real
                const batchTokens = batches.reduce((sum, b) => sum + b.totalTokens, 0);
                const outputTokens = frameworkResult.findings.length * 200;
                totalTokensUsed += batchTokens;

                // Registrar uso no router para tracking
                this.router.trackUsage(scanRouting.provider, batchTokens, outputTokens);
                const actualCost = scanRouting.estimatedCost * batches.length;
                totalEstimatedCost += actualCost;

                // 🆕 Registrar métricas no CostAnalytics
                costAnalytics.record({
                    provider: scanRouting.provider,
                    task: 'scan',
                    tokensIn: batchTokens,
                    tokensOut: outputTokens,
                    cost: actualCost,
                    latency: frameworkResult.execution_time_ms,
                    // Operational execution/completeness only, independent of finding count/severity.
                    success: frameworkResult.completeness === 'COMPLETE'
                });

            } catch (error) {
                console.error(`Error auditing ${framework.id}:`, error);

                // 🆕 Registrar falha no CostAnalytics
                costAnalytics.record({
                    provider: scanRouting.provider,
                    task: 'scan',
                    tokensIn: 0,
                    tokensOut: 0,
                    cost: 0,
                    latency: Date.now() - frameworkStartTime,
                    success: false
                });

                results.push(this.unknownFramework(framework, batches, 'ANALYSIS_FAILURE', scanRouting.provider));
            }

            progress?.report({ increment: incrementPerFramework / 2 });
        }

        // --- ANTIGRAVITY PHASE 3: AUTO-FIX ---
        progress?.report({ message: '🔧 Antigravity: Generating patches for high-priority technical findings...' });

        for (const res of results) {
            for (const issue of res.findings) {
                // Generate patch for High severity issues if no fix exists
                if (issue.severity === 'High' && !issue.code_fix) {
                    const violation: Violation = {
                        id: Math.random().toString(36).substring(7),
                        ruleId: issue.reference_hint || 'technical-review',
                        filePath: issue.file_path,
                        line: issue.line_start,
                        message: issue.technical_observation,
                        severity: 'high',
                        fixable: true,
                        source: 'ai'
                    };

                    try {
                        // Use OpenAI (GPT-4o-mini) for patches as per strategy
                        const patch = await this.patcher.generatePatch(violation);
                        if (patch) {
                            issue.code_fix = patch.fixedCode;
                            console.error(`[PatchEngine] Generated fix for ${issue.file_path} (Rule: ${violation.ruleId})`);
                        }
                    } catch (err) {
                        console.warn(`[PatchEngine] Failed to generate patch:`, err);
                    }
                }
            }
        }

        // 🆕 Atualizar alertas de orçamento após audit completo
        const currentMonthlySpend = costAnalytics.getSummary().thisMonth.cost;
        budgetAlerts.updateSpend(currentMonthlySpend);
        console.error(`[Orchestrator] Technical review execution finished. Custo total: $${totalEstimatedCost.toFixed(4)}, Mensal: $${currentMonthlySpend.toFixed(2)}`);

        // Descriptive technical counts only; no aggregate attainment state.
        const allFindings = results.flatMap(r => r.findings);
        return {
            analysis_boundary: REVIEW_BOUNDARY,
            region,
            frameworks_requested: frameworks.map(f => f.id),
            frameworks_analyzed: results.filter(r => r.completeness === 'COMPLETE').length,
            frameworks_unknown: results.filter(r => r.completeness !== 'COMPLETE').length,
            total_findings: allFindings.length,
            high_priority_findings: allFindings.filter(f => f.severity === 'High').length,
            results,
            files_analyzed: files.length,
            source_files: files.map(f => f.relativePath),
            acquisition,
            limitations: REVIEW_LIMITATIONS,
            total_tokens_used: totalTokensUsed,
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            metadata: {
                clientName: metadata?.clientName,
                repoUrl: metadata?.repoUrl,
                consultationDate: new Date().toLocaleDateString()
            }
        };
    }

    private unknownFramework(framework: FrameworkConfig, batches: BatchedContext[], reason: 'ANALYSIS_FAILURE', model: string): FrameworkReviewResult {
        return {
            analysis_boundary: REVIEW_BOUNDARY, framework: framework.id, frameworkName: framework.name,
            analysis_state: 'UNKNOWN', completeness: 'UNKNOWN', findings: [], summary: reviewSummary('UNKNOWN', 0),
            limitations: REVIEW_LIMITATIONS, batches: { required: batches.length, analyzed: 0, failed: batches.length },
            failures: [{ batch_index: null, reason }], source_files: batches.flatMap(b => b.files.map(f => f.relativePath)),
            llm_used: model, execution_time_ms: 0
        };
    }

    /** Analyze each required batch independently. Failures never become source findings. */
    private async auditFramework(
        framework: FrameworkConfig,
        batches: BatchedContext[],
        provider?: string,
        acquisition: ReviewAcquisition = { state: 'UNKNOWN', read_failures: 0, excluded_files: 0, truncated_files: 0 },
        contextAvailable = true
    ): Promise<FrameworkReviewResult> {
        const prompt = getPromptForFramework(framework.id);
        const findings: TechnicalFrameworkFinding[] = [];
        const failures: FrameworkReviewResult['failures'] = [];
        let analyzed = 0;
        const modelToUse = provider ? this.getModelForProvider(provider, 'scan') : framework.llm;
        if (acquisition.state !== 'COMPLETE' || !contextAvailable) failures.push({ batch_index: null, reason: 'ACQUISITION_INCOMPLETE' });
        for (const batch of batches) {
            let contextMsg = '';
            let contextComplete = contextAvailable;
            try {
                const query = `source-code technical signals relevant to ${framework.name} references regarding: ${batch.files.map(f => f.relativePath).join(', ')}`;
                const ragResult = await this.memory.query({ query, maxResults: 3 });
                if (ragResult.contextString) contextMsg = `\nInformational untrusted retrieved context; not operative law or authority:\n${ragResult.contextString}\n`;
            } catch {
                contextComplete = false;
            }
            try {
                const userPrompt = prompt.userPromptTemplate.replace('{CODE_CONTENT}', this.batcher.formatBatchForPrompt(batch)) + contextMsg;
                const response = await AIClient.complete(userPrompt, { modelOverride: modelToUse, systemPrompt: prompt.systemPrompt, maxTokens: 4000 });
                const parsed = typeof response === 'string' && response.trim()
                    ? parseFrameworkReview(response, framework.id, batch.files)
                    : { findings: [], completed: false, reason: 'MODEL_FAILURE' as const };
                findings.push(...parsed.findings);
                if (parsed.completed && contextComplete) analyzed++;
                else failures.push({ batch_index: batch.batchIndex, reason: parsed.reason || 'ACQUISITION_INCOMPLETE' });
            } catch {
                failures.push({ batch_index: batch.batchIndex, reason: 'MODEL_FAILURE' });
            }
        }
        const complete = batches.length > 0 && analyzed === batches.length && failures.length === 0;
        const completeness = complete ? 'COMPLETE' : analyzed > 0 || findings.length > 0 ? 'PARTIAL' : 'UNKNOWN';
        const analysis_state = analyzed === 0 ? 'UNKNOWN' : findings.length > 0 ? 'FINDINGS_DETECTED' : complete ? 'NO_FINDINGS_DETECTED' : 'UNKNOWN';
        return {
            analysis_boundary: REVIEW_BOUNDARY, framework: framework.id, frameworkName: framework.name,
            analysis_state, completeness, findings, summary: reviewSummary(analysis_state, findings.length),
            limitations: REVIEW_LIMITATIONS,
            batches: { required: batches.length, analyzed, failed: batches.length - analyzed }, failures,
            source_files: batches.flatMap(b => b.files.map(f => f.relativePath)),
            llm_used: modelToUse, execution_time_ms: 0
        };
    }

    /**
     * Get quick stats without running full audit
     */
    async getWorkspaceStats(): Promise<{ files: number; tokens: number; batches: number }> {
        const files = await this.batcher.collectWorkspaceFiles();
        const batches = this.batcher.batchFiles(files);
        const tokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);

        return {
            files: files.length,
            tokens,
            batches: batches.length
        };
    }

    /**
     * Retorna estatísticas combinadas de uso e custo (LLMRouter + CostAnalytics)
     */
    getUsageStats(): {
        monthlySpend: number;
        byProvider: Record<string, { calls: number; tokens: number; cost: number }>;
        savings: number;
        forecast: { projectedSpend: number; daysUntilLimit: number | null };
        recommendations: Array<{ type: string; severity: string; message: string }>;
    } {
        // Dados do LLMRouter
        const routerStats = this.router.getStats();

        // Dados do CostAnalytics (mais detalhados)
        const analyticsSummary = costAnalytics.getSummary();
        const recommendations = costAnalytics.getRecommendations();

        // Dados de forecast do BudgetAlerts
        const forecast = budgetAlerts.getForecast();

        // Usar CostAnalytics como fonte principal (mais preciso)
        const totalCost = analyticsSummary.thisMonth.cost;

        return {
            monthlySpend: totalCost,
            byProvider: analyticsSummary.byProvider as any,
            savings: analyticsSummary.savings.vsOpenAI - analyticsSummary.savings.actual,
            forecast: {
                projectedSpend: forecast.projectedSpend,
                daysUntilLimit: forecast.daysUntilLimit
            },
            recommendations: recommendations.map(r => ({
                type: r.type,
                severity: r.severity,
                message: r.message
            }))
        };
    }

    /**
     * Verifica limite mensal de custo
     */
    checkCostLimit(): { exceeded: boolean; percentage: number; warning?: string } {
        return this.router.checkMonthlyLimit();
    }

    /**
     * Mapeia provider para modelo específico por task
     */
    private getModelForProvider(provider: string, task: TaskType): string {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig) {
            console.warn(`[getModelForProvider] Provider ${provider} não encontrado, usando fallback`);
            return 'gpt-4o-mini';
        }
        return providerConfig.models[task];
    }
}
