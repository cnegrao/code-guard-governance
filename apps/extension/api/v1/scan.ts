/**
 * CodeGuard API v1 - Scan Endpoint
 * 
 * POST /api/v1/scan
 * 
 * Reviews supplied source for potential technical findings; non-authoritative.
 * LEGACY_TRANSPORT_IDENTIFIER: /api/v1/scan.
 * Compatível com: Vercel Edge, Supabase Functions, Node.js
 */

import 'dotenv/config';

// Types
interface ScanRequest {
    code?: string;
    files?: Array<{ path: string; content: string }>;
    region: 'BR' | 'EU';
    frameworks?: string[];
}

interface ScanResponse {
    success: boolean;
    result?: import('../../src/intelligence/review-contract').TechnicalFrameworkReviewResult;
    error?: string;
    usage?: {
        creditsUsed: number;
        tokensUsed: number;
        cost: number;
    };
}

// Mock vscode for standalone usage
const mockVscode = {
    workspace: {
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        getConfiguration: () => ({
            get: (key: string) => process.env[key.toUpperCase()] || ''
        }),
        findFiles: async () => [],
        openTextDocument: async (path: string) => ({
            getText: () => '',
            lineAt: () => ({ text: '' })
        })
    },
    window: {
        withProgress: async (_: any, task: any) => task({ report: () => { } }),
        showErrorMessage: console.error,
        showInformationMessage: console.log
    },
    ProgressLocation: { Notification: 1 }
};

(global as any).vscode = mockVscode;

// Import after mock
import { ComplianceOrchestrator } from '../../src/intelligence/orchestrator';
import { ContextBatcher } from '../../src/intelligence/batcher';
import { costAnalytics } from '../../src/dashboard/cost-analytics';

/**
 * Main handler for HTTP requests
 */
export async function handler(req: Request): Promise<Response> {
    // CORS headers
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers
        });
    }

    try {
        const body: ScanRequest = await req.json();

        // Validate request
        if (!body.region) {
            return new Response(JSON.stringify({ error: 'region is required' }), {
                status: 400,
                headers
            });
        }

        if (!body.code && (!body.files || body.files.length === 0)) {
            return new Response(JSON.stringify({ error: 'code or files is required' }), {
                status: 400,
                headers
            });
        }

        // Security: API Key Validation (FAIL-CLOSED)
        const authHeader = req.headers.get('Authorization') || '';
        const internalKey = process.env.CODEGUARD_API_SECRET; // REQUIRED in production

        if (!internalKey || internalKey.trim().length < 16) {
            return new Response(JSON.stringify({ error: 'Service misconfigured: CODEGUARD_API_SECRET is required' }), {
                status: 503,
                headers
            });
        }

        const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
        if (!token || token !== internalKey) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid API Key' }), {
                status: 401,
                headers
            });
        }

        // Run the bounded technical review
        const orchestrator = new ComplianceOrchestrator();

        // If single code snippet, wrap it
        const files = body.files || [{ path: 'input.ts', content: body.code! }];

        // Acquire only the explicitly supplied files; do not scan the server workspace
        const mockBatcher = {
            getAcquisition: () => ({ state: 'COMPLETE', read_failures: 0, excluded_files: 0, truncated_files: 0 }),
            collectWorkspaceFiles: async () => files.map(f => ({
                path: f.path,
                relativePath: f.path,
                content: f.content,
                language: 'typescript',
                tokenEstimate: Math.ceil(f.content.length / 4)
            })),
            batchFiles: (files: any[]) => [{
                files,
                totalTokens: files.reduce((s, f) => s + f.tokenEstimate, 0),
                batchIndex: 0
            }],
            formatBatchForPrompt: (batch: any) => batch.files.map((f: any) =>
                `### File: ${f.relativePath}\n\`\`\`${f.language}\n${f.content}\n\`\`\``
            ).join('\n---\n')
        };

        // Inject mock batcher
        (orchestrator as any).batcher = mockBatcher;

        const result = await orchestrator.runAudit(body.region, body.frameworks, undefined, undefined, undefined, true);

        // Get usage from analytics
        const summary = costAnalytics.getSummary();

        const response: ScanResponse = {
            success: true,
            result,
            usage: {
                creditsUsed: 1 * result.files_analyzed,
                tokensUsed: result.total_tokens_used,
                cost: summary.thisMonth.cost
            }
        };

        return new Response(JSON.stringify(response), { status: 200, headers });

    } catch (error) {
        console.error('[API] Scan error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: (error as Error).message
        }), { status: 500, headers });
    }
}

// For Vercel Edge Functions
export const config = {
    runtime: 'nodejs'
};

export default handler;
