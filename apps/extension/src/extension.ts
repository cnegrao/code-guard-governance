import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { reloadEnvConfig } from './core/llm-config';
import { LicenseManager } from './license/manager';
import { TechnicalScanEngine } from './scanner/compliance';
import { getWebviewContent, getComplianceAuditWebviewContent } from './ui/dashboard';
import { RepoIntelligence } from './intelligence/ril';
import { PatchEngine } from './intelligence/patch';
import { CreditsManager } from './credits/manager';
import { ComplianceOrchestrator } from './intelligence/orchestrator';
import { getFrameworksByRegion } from './intelligence/frameworks';
import { t } from './utils/i18n';
import { DiagnosticsManager } from './ui/diagnostics';
import { CodeGuardCodeActionProvider } from './ui/quickFix';
import { GithubService } from './intelligence/github';
import { UserService } from './services/UserService';
import { ConfigManager } from './services/ConfigManager';
import { AuditDispatcher } from './core/dispatcher';

const dispatcher = new AuditDispatcher();

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeGuard AI is active!');

    // Load .env from workspace root if available
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        try {
            const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const envPath = path.join(rootPath, '.env');
            const result = dotenv.config({ path: envPath });

            if (result.error) {
                console.log('[CodeGuard] No .env file found or failed to load:', result.error.message);
            } else {
                console.log('[CodeGuard] .env loaded successfully from', envPath);
                reloadEnvConfig();
            }
        } catch (error) {
            console.warn('[CodeGuard] Failed to load .env:', error);
        }
    }

    // 0. Initialize Services
    ConfigManager.initialize(context);

    // 1. Register Native Diagnostics & Quick Fix
    const diagnosticsManager = DiagnosticsManager.getInstance();
    context.subscriptions.push(diagnosticsManager.getCollection());

    const quickFixProvider = vscode.languages.registerCodeActionsProvider(
        ['javascript', 'typescript', 'python', 'java', 'csharp', 'php', 'go', 'ruby', 'sql', 'terraform'],
        new CodeGuardCodeActionProvider(),
        { providedCodeActionKinds: CodeGuardCodeActionProvider.providedCodeActionKinds }
    );
    context.subscriptions.push(quickFixProvider);

    // Initial Credit Check
    const config = vscode.workspace.getConfiguration('codeguard');
    const userEmail = config.get<string>('userEmail');
    if (userEmail) {
        CreditsManager.getBalance(userEmail, context.globalState).catch(err => console.error('Credit check error:', err));
    }

    // --- COMMAND REGISTRATIONS ---

    // 1. Scan Command
    let disposable = vscode.commands.registerCommand('codeguard.scan', async () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor && vscode.window.visibleTextEditors.length > 0) {
            editor = vscode.window.visibleTextEditors[0];
        }

        if (!editor) {
            vscode.window.showErrorMessage('CodeGuard: Please open a code file to scan.');
            return;
        }

        const config = vscode.workspace.getConfiguration('codeguard');
        const licenseKey = config.get<string>('licenseKey') || '';

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "CodeGuard AI: Scanning...",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "Analyzing code patterns..." });
            
            const userEmail = config.get<string>('userEmail');
            let creditBalance = 0;
            if (userEmail) {
                const status = await CreditsManager.getBalance(userEmail, context.globalState);
                creditBalance = status.balance;
            }

            const licenseStatus = await LicenseManager.checkLicense(licenseKey, context.globalState);
            const report = TechnicalScanEngine.scanCode(editor!.document.getText(), licenseStatus, creditBalance > 0, editor!.document.uri.toString());

            const panel = vscode.window.createWebviewPanel('codeGuardTechnicalScan', 'Technical Scan Report', vscode.ViewColumn.Two, { enableScripts: true });
            panel.webview.html = getWebviewContent(report);
            
            panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'upgrade') {
                    const upgradeLink = config.get<string>('stripePaymentLink') || 'https://buy.stripe.com/00w8wRgIt0Td5hS1JE2wU01';
                    vscode.env.openExternal(vscode.Uri.parse(upgradeLink));
                } else if (message.command === 'fixViolation') {
                    vscode.commands.executeCommand('codeguard.fix', message);
                }
            }, undefined, context.subscriptions);
        });
    });

    // 2. Fix Command
    let fixDisposable = vscode.commands.registerCommand('codeguard.fix', async (args: any) => {
        const config = vscode.workspace.getConfiguration('codeguard');
        const licenseKey = config.get<string>('licenseKey') || '';
        const userEmail = await UserService.ensureUserEmail();
        if (!userEmail) return;

        const apiKey = await ConfigManager.getInstance().getApiKey() || '';
        const licenseStatus = await LicenseManager.checkLicense(licenseKey, context.globalState);
        const isPro = licenseStatus.plan === 'PROFESSIONAL' || licenseStatus.plan === 'ENTERPRISE';
        const isBYOK = (config.get<string>('aiProvider') !== 'codeguard-cloud') && (apiKey.length > 5);

        if (!isPro && !isBYOK) {
            const hasCredits = await CreditsManager.checkAndNotify(userEmail, context.globalState);
            if (!hasCredits) return;
            await CreditsManager.useCredit(userEmail, 1);
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || !args.line) return;

        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Generating Smart Fix..." }, async () => {
            const generatedCode = await PatchEngine.generateFix(editor.document, args.violation || args, args.line);
            if (generatedCode && await PatchEngine.applyFix(editor.document, generatedCode, args.line)) {
                vscode.window.showInformationMessage('Smart Fix Applied Successfully. 🤖');
            }
        });
    });

    // 3. Index Command
    let indexDisposable = vscode.commands.registerCommand('codeguard.index', async () => {
        const apiKey = vscode.workspace.getConfiguration('codeguard').get<string>('userApiKey');
        if (!apiKey) {
            vscode.window.showWarningMessage('CodeGuard Intelligence requires an API Key.');
            return;
        }
        await RepoIntelligence.indexWorkspace();
        vscode.window.showInformationMessage('Workspace Indexing Completed.');
    });

    // 4. Check Credits Command
    let creditsDisposable = vscode.commands.registerCommand('codeguard.credits', async () => {
        const userEmail = vscode.workspace.getConfiguration('codeguard').get<string>('userEmail');
        if (!userEmail) {
            vscode.window.showWarningMessage('Configure your email in Settings.');
            return;
        }
        const status = await CreditsManager.getBalance(userEmail, context.globalState);
        vscode.window.showInformationMessage(`💰 Your balance: ${status.balance} credits`);
    });

    // 5. Buy Credits Command
    let buyDisposable = vscode.commands.registerCommand('codeguard.buyCredits', async () => {
        const config = vscode.workspace.getConfiguration('codeguard');
        const link = config.get<string>('stripePaymentLink') || 'https://buy.stripe.com/00w8wRgIt0Td5hS1JE2wU01';
        vscode.env.openExternal(vscode.Uri.parse(link));
    });

    // 6. Technical Framework Review Command (LEGACY_TRANSPORT_IDENTIFIER: codeguard.complianceAudit) (Consolidated via Dispatcher)
    let complianceAuditDisposable = vscode.commands.registerCommand('codeguard.complianceAudit', async () => {
        const config = vscode.workspace.getConfiguration('codeguard');
        const region = config.get<'BR' | 'EU'>('region') || 'BR';
        const licenseKey = config.get<string>('licenseKey') || '';
        const userEmail = await UserService.ensureUserEmail();
        if (!userEmail) return;

        const apiKey = await ConfigManager.getInstance().getApiKey() || '';
        const provider = config.get<string>('aiProvider') || 'openrouter';
        const isBYOK = (provider !== 'codeguard-cloud') && (apiKey.length > 5);

        const frameworks = getFrameworksByRegion(region);
        const selectedItems = await vscode.window.showQuickPick(frameworks.map(f => ({ label: f.name, description: f.description, id: f.id, picked: true })), { canPickMany: true, title: 'CodeGuard: Select Frameworks' });
        if (!selectedItems || selectedItems.length === 0) return;

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeGuard: Running Technical Framework Review...' }, async (progress) => {
            const result = await dispatcher.dispatch('codeguard_audit', {
                region,
                frameworks: selectedItems.map(i => i.id)
            }, {
                licenseKey,
                userEmail,
                bypassCredits: isBYOK
            });

            if (result.error) {
                if (result.error === 'INSUFFICIENT_CREDITS') {
                    const buy = t('buyCredits');
                    if (await vscode.window.showErrorMessage(result.message, buy) === buy) vscode.commands.executeCommand('codeguard.buyCredits');
                } else vscode.window.showErrorMessage(`Technical review execution failed: ${result.message}`);
                return;
            }

            const panel = vscode.window.createWebviewPanel('complianceAuditResult', `Technical Framework Review - ${region}`, vscode.ViewColumn.One, { enableScripts: true });
            panel.webview.html = getComplianceAuditWebviewContent(result);
            
            panel.webview.onDidReceiveMessage(async msg => {
                if (msg.command === 'applyFix') {
                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (!root) return;
                    const resolved = path.resolve(path.isAbsolute(msg.filePath) ? msg.filePath : path.join(root, msg.filePath));
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
                    if (await PatchEngine.applyFixRange(doc, msg.code, msg.lineStart || 1, msg.lineEnd || 1)) {
                        vscode.window.showInformationMessage('Engineering suggestion applied; review the code change. This does not establish compliance.');
                    }
                }
            });

            DiagnosticsManager.getInstance().updateDiagnostics(result);
            vscode.window.showInformationMessage(`Technical review returned ${result.total_findings} potential findings; ${result.frameworks_unknown} incomplete/unknown reviews.`);
        });
    });

    // 7. Status Bar Helper
    const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'codeguard.showMenu';
    myStatusBarItem.text = '$(shield) CodeGuard';
    myStatusBarItem.show();

    // 8. Show Menu
    let menuDisposable = vscode.commands.registerCommand('codeguard.showMenu', async () => {
        const choice = await vscode.window.showQuickPick([
            { label: '$(search) Quick Technical Scan', detail: 'Local/Free - heuristic technical findings' },
            { label: '$(hubot) Deep Technical Framework Review', detail: 'LLM-assisted, non-authoritative technical findings' },
            { label: '$(credit-card) Credits', detail: 'Balance & Buy' }
        ]);
        if (choice) {
            if (choice.label.includes('Quick')) vscode.commands.executeCommand('codeguard.scan');
            if (choice.label.includes('Deep')) vscode.commands.executeCommand('codeguard.complianceAudit');
            if (choice.label.includes('Credits')) vscode.commands.executeCommand('codeguard.credits');
        }
    });

    context.subscriptions.push(disposable, fixDisposable, indexDisposable, creditsDisposable, buyDisposable, complianceAuditDisposable, menuDisposable, myStatusBarItem);
}

export function deactivate() { }
