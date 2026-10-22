/**
 * @codeguard/sdk
 * 
 * Universal SDK for CodeGuard AI non-authoritative Technical Framework Review API
 * Works with: Vercel, Lovable, Bolt, v0, React, Node.js
 */

// Types
export interface ScanRequest {
    /** Code to scan (for single-file scans) */
    code?: string;
    /** Multiple files to scan */
    files?: Array<{ path: string; content: string }>;
    /** Reference-topic region; no applicability inferred */
    region: 'BR' | 'EU';
    /** Framework IDs to check (optional, checks all if not provided) */
    frameworks?: string[];
}

export interface AnalysisBoundary {
    readonly kind: 'LLM_ASSISTED_TECHNICAL_FRAMEWORK_REVIEW';
    readonly authority: 'HEURISTIC_NON_AUTHORITATIVE';
    readonly legal_conclusion: false;
    readonly compliance_determination: false;
    readonly framework_satisfaction: false;
    readonly control_effectiveness: false;
    readonly certification: false;
    readonly attestation: false;
    readonly assurance: false;
}

export type AnalysisState = 'FINDINGS_DETECTED' | 'NO_FINDINGS_DETECTED' | 'UNKNOWN';
export type ReviewCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type ReviewFailure = 'MODEL_FAILURE' | 'MALFORMED_OUTPUT' | 'UNSUPPORTED_OUTPUT' | 'MODEL_UNCERTAINTY' | 'ACQUISITION_INCOMPLETE' | 'ANALYSIS_FAILURE';

export interface TechnicalFrameworkFinding {
    file_path: string;
    line_start: number;
    line_end: number;
    technical_observation: string;
    reference_hint?: string;
    severity: 'High' | 'Medium' | 'Low';
    recommendation: string;
    code_fix?: string;
}

export interface ReviewAcquisition {
    state: ReviewCompleteness;
    read_failures: number;
    excluded_files: number;
    truncated_files: number;
}

export interface FrameworkReviewResult {
    analysis_boundary: AnalysisBoundary;
    framework: string;
    frameworkName: string;
    analysis_state: AnalysisState;
    completeness: ReviewCompleteness;
    findings: TechnicalFrameworkFinding[];
    summary: string;
    limitations: readonly string[];
    batches: { required: number; analyzed: number; failed: number };
    failures: Array<{ batch_index: number | null; reason: ReviewFailure }>;
    source_files: string[];
    llm_used: string;
    execution_time_ms: number;
}

export interface TechnicalFrameworkReviewResult {
    analysis_boundary: AnalysisBoundary;
    region: 'BR' | 'EU' | 'US' | 'GLOBAL';
    frameworks_requested: string[];
    frameworks_analyzed: number;
    frameworks_unknown: number;
    total_findings: number;
    high_priority_findings: number;
    results: FrameworkReviewResult[];
    files_analyzed: number;
    source_files: string[];
    acquisition: ReviewAcquisition;
    limitations: readonly string[];
    total_tokens_used: number;
    execution_time_ms: number;
    timestamp: string;
    metadata?: { clientName?: string; repoUrl?: string; consultationDate?: string };
}

/** HTTP execution success only; inspect per-framework completeness and UNKNOWN. */
export interface ScanResult {
    success: boolean;
    result?: TechnicalFrameworkReviewResult;
    error?: string;
    usage?: { creditsUsed: number; tokensUsed: number; cost: number };
}

export interface PatchRequest {
    filePath: string;
    line: number;
    violation: string;
    code: string;
    ruleId?: string;
}

export interface PatchResult {
    success: boolean;
    patch?: {
        originalCode: string;
        fixedCode: string;
        description: string;
        confidence: number;
    };
    error?: string;
    creditsUsed?: number;
}

export interface CreditsResult {
    balance: number;
    email?: string;
    message?: string;
}

export interface CodeGuardConfig {
    /** API base URL (default: https://api.codeguard.ai) */
    baseUrl?: string;
    /** API Key for authentication */
    apiKey?: string;
    /** User email for credits */
    email?: string;
    /** Request timeout in ms (default: 30000) */
    timeout?: number;
}

// Client
export class CodeGuardClient {
    private config: Required<CodeGuardConfig>;

    constructor(config: CodeGuardConfig = {}) {
        this.config = {
            baseUrl: config.baseUrl || 'https://api.codeguard.ai',
            apiKey: config.apiKey || '',
            email: config.email || '',
            timeout: config.timeout || 30000
        };
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.config.baseUrl}/api/v1${endpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {})
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        if (this.config.email) {
            headers['X-User-Email'] = this.config.email;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data as T;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Review supplied source for potential technical findings; never a compliance determination
     */
    async scan(request: ScanRequest): Promise<ScanResult> {
        return this.request<ScanResult>('/scan', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    /**
     * Generate a patch for a specific violation
     */
    async patch(request: PatchRequest): Promise<PatchResult> {
        return this.request<PatchResult>('/patch', {
            method: 'POST',
            body: JSON.stringify(request)
        });
    }

    /**
     * Get credit balance
     */
    async getCredits(): Promise<CreditsResult> {
        const params = this.config.email ? `?email=${encodeURIComponent(this.config.email)}` : '';
        return this.request<CreditsResult>(`/credits${params}`, {
            method: 'GET'
        });
    }

    /**
     * Check API health
     */
    async health(): Promise<{ status: string; version: string }> {
        return this.request<{ status: string; version: string }>('/health', {
            method: 'GET'
        });
    }
}

// Convenience factory
export function createClient(config?: CodeGuardConfig): CodeGuardClient {
    return new CodeGuardClient(config);
}

// Default export
export default CodeGuardClient;
