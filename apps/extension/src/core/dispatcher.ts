import { ComplianceOrchestrator } from '../intelligence/orchestrator';
import { RepoIntelligence } from '../intelligence/ril';
import { ShadowAPIScanner } from '../scanner/shadowApi';
import { SecurityGuard } from './security';
import { LicenseManager } from '../license/LicenseManager';
import { CreditsManager } from '../credits/manager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AuditDispatcher - Unified Entry Point for all CodeGuard Tools
 * Decouples transport (MCP/API) from business logic and security enforcement.
 */
export class AuditDispatcher {
    private orchestrator = new ComplianceOrchestrator();
    private ril = new RepoIntelligence();

    /**
     * Executes a tool call with full security and license enforcement.
     * 
     * @param context Additional metadata like keys and user email for credit tracking
     */
    async dispatch(toolName: string, args: any, context: { 
        licenseKey?: string; 
        userEmail?: string; 
        bypassCredits?: boolean; // For free tools or BYOK
    } = {}): Promise<any> {
        
        // 1. License Check (Gating)
        const keyToValidate = context.licenseKey || process.env.CODEGUARD_LICENSE_KEY;
        const license = LicenseManager.validate(keyToValidate);
        const isAllowed = LicenseManager.checkGate(toolName, license.plan);

        // Logging attempt (Sensitive paths redacted in logs)
        console.error(`[Dispatcher] Calling ${toolName} key_fp=${SecurityGuard.fingerprint(keyToValidate || '')}`);

        if (!isAllowed) {
            return {
                error: 'PREMIUM_FEATURE_LOCKED',
                message: `The tool '${toolName}' requires a PRO or ENTERPRISE license.`,
                upgrade_url: 'https://codeguard.ai/pricing',
                current_plan: license.plan
            };
        }

        // 2. Credit Check & Deduction (For non-Enterprise users)
        const isEnterprise = license.plan === 'ENTERPRISE' || license.plan === 'PRO';
        
        if (toolName === 'codeguard_audit' && !isEnterprise && !context.bypassCredits) {
            if (!context.userEmail) {
                return { error: 'AUTH_REQUIRED', message: 'User email is required for credit tracking in community mode.' };
            }

            const AUDIT_COST = 5;
            const status = await CreditsManager.getBalance(context.userEmail);
            
            if (status.balance < AUDIT_COST) {
                return { 
                    error: 'INSUFFICIENT_CREDITS', 
                    message: `Technical framework review costs ${AUDIT_COST} credits. Current balance: ${status.balance}`,
                    required: AUDIT_COST,
                    current: status.balance
                };
            }

            // Deduct before execution (Safety first)
            const success = await CreditsManager.useCredit(context.userEmail, AUDIT_COST);
            if (!success) {
                return { error: 'TRANSACTION_FAILED', message: 'Failed to process credit deduction.' };
            }
        }

        try {
            switch (toolName) {
                case 'codeguard_audit': // LEGACY_TRANSPORT_IDENTIFIER; bounded technical review only
                    return await this.handleAudit(args);
                case 'codeguard_graph':
                    return await this.handleGraph(args);
                case 'detect_shadow_apis':
                    return await this.handleShadowApi(args);
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error) {
            console.error(`[Dispatcher Error] ${toolName} failed:`, error);
            return {
                error: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async handleAudit(args: any) {
        const region = args.region || 'BR';
        const frameworks = args.frameworks || [];
        const targetDir = args.filePath ? SecurityGuard.resolveSafePath(args.filePath) : undefined;

        const result = await this.orchestrator.runAudit(
            region,
            frameworks,
            undefined, // No progress in dispatcher
            { clientName: 'Unified Dispatcher' },
            targetDir
        );

        return result;
    }

    private async handleGraph(args: any) {
        const rootPath = args.filePath ? SecurityGuard.resolveSafePath(args.filePath) : process.cwd();
        
        const context = await this.ril.indexRepository(rootPath);
        const graph = await this.ril.buildDependencyGraph(context);

        return {
            nodes_count: context.files.length,
            edges_count: graph.edges.size,
            sensitive_files: graph.sensitiveFiles.map(f => path.basename(f)), // Privacy-first: relative basenames
            frameworks: context.frameworks,
            total_tokens: context.totalTokens
        };
    }

    private async handleShadowApi(args: any) {
        const violations = [];

        // Mode A: Context String
        if (args.content) {
            violations.push(...ShadowAPIScanner.scan(args.content));
        } 
        
        // Mode B: File Path
        if (args.filePath) {
            const resolved = SecurityGuard.resolveSafePath(args.filePath);
            const stat = fs.statSync(resolved);

            if (stat.isFile()) {
                const content = fs.readFileSync(resolved, 'utf-8');
                violations.push(...ShadowAPIScanner.scan(content));
            } else {
                // Bulk scan directory (with limits)
                const files = this.safeListFilesRecursive(resolved, 100);
                for (const file of files) {
                    const content = fs.readFileSync(file, 'utf-8');
                    violations.push(...ShadowAPIScanner.scan(content));
                }
            }
        }

        return {
            summary: {
                total_violations: violations.length,
                critical: violations.filter(v => v.severity === 'CRITICAL').length,
            },
            findings: violations
        };
    }

    private safeListFilesRecursive(dir: string, limit: number): string[] {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= limit) break;
            const full = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                if (!SecurityGuard.isDangerousFile(entry.name)) {
                    results.push(...this.safeListFilesRecursive(full, limit - results.length));
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                const allowed = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'];
                if (allowed.includes(ext)) {
                    results.push(full);
                }
            }
        }

        return results;
    }
}
