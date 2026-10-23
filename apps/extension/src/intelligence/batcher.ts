/**
 * Context Batcher
 * Aggregates workspace files into optimized chunks for LLM processing
 */

import { vscode } from '../utils/vscode-compat';
import * as path from 'path';

export interface FileContext {
    path: string;
    relativePath: string;
    content: string;
    language: string;
    tokenEstimate: number;
}

export interface BatchedContext {
    files: FileContext[];
    totalTokens: number;
    batchIndex: number;
}

/**
 * Supported file extensions for compliance scanning
 */
const SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',  // JavaScript/TypeScript
    '.py',                          // Python
    '.java',                        // Java
    '.cs',                          // C#
    '.go',                          // Go
    '.rb',                          // Ruby
    '.php',                         // PHP
    '.swift',                       // Swift
    '.kt', '.kts',                  // Kotlin
    '.rs',                          // Rust
    '.sql',                         // SQL
    '.yaml', '.yml',                // Config files
    '.json',                        // JSON configs
];

/**
 * Files/folders to always ignore
 */
const IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    '__pycache__',
    '.pytest_cache',
    'vendor',
    'packages',
    '.vscode',
    '.env',
    '.env.',
    '*.min.js',
    '*.bundle.js',
    '*.map',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
];

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Get language identifier from file extension
 */
function getLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.py': 'python',
        '.java': 'java',
        '.cs': 'csharp',
        '.go': 'go',
        '.rb': 'ruby',
        '.php': 'php',
        '.swift': 'swift',
        '.kt': 'kotlin',
        '.kts': 'kotlin',
        '.rs': 'rust',
        '.sql': 'sql',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.json': 'json'
    };
    return langMap[ext] || 'text';
}

/**
 * Check if file should be ignored
 */
function shouldIgnore(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return IGNORE_PATTERNS.some(pattern => {
        if (pattern.startsWith('*')) {
            return normalized.endsWith(pattern.slice(1));
        }
        return normalized.includes(pattern.toLowerCase());
    });
}

export class ContextBatcher {
    private maxTokensPerBatch: number;
    private acquisition = { state: 'UNKNOWN' as 'COMPLETE' | 'PARTIAL' | 'UNKNOWN', read_failures: 0, excluded_files: 0, truncated_files: 0 };

    getAcquisition() { return { ...this.acquisition }; }

    constructor(maxTokensPerBatch: number = 80000) {
        this.maxTokensPerBatch = maxTokensPerBatch;
    }

    /**
     * Collect all relevant files from the workspace or specific path
     */
    async collectWorkspaceFiles(rootPath?: string): Promise<FileContext[]> {
        this.acquisition = { state: 'COMPLETE', read_failures: 0, excluded_files: 0, truncated_files: 0 };
        const files: FileContext[] = [];
        const targetPath = rootPath || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);

        if (!targetPath) { this.acquisition.state = 'UNKNOWN'; return []; }

        try {
            const filePaths = await this.scanDirectory(targetPath);
            for (const filePath of filePaths) {
                try {
                    const uri = vscode.Uri.file(filePath);
                    const uint8Array = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(uint8Array).toString('utf-8');

                    if (content.length > 50000 || content.trim().length === 0) { this.acquisition.excluded_files++; continue; }

                    const relativePath = path.isAbsolute(filePath) 
                        ? path.relative(targetPath, filePath)
                        : filePath;

                    files.push({
                        path: filePath,
                        relativePath: relativePath.replace(/\\/g, '/'),
                        content,
                        language: getLanguage(filePath),
                        tokenEstimate: estimateTokens(content)
                    });
                } catch (e) {
                    this.acquisition.read_failures++;
                    this.acquisition.state = 'PARTIAL';
                    console.warn(`Failed to read file ${filePath}:`, e);
                }
            }
        } catch (err) {
            this.acquisition.read_failures++;
            this.acquisition.state = 'UNKNOWN';
            console.error('Error scanning repo directory:', err);
        }

        return files;
    }

    private async scanDirectory(dir: string): Promise<string[]> {
        const files: string[] = [];
        try {
            const uri = vscode.Uri.file(dir);
            const entries = await vscode.workspace.fs.readDirectory(uri);
            
            for (const [name, type] of entries) {
                const fullPath = path.join(dir, name);
                if (shouldIgnore(fullPath)) continue;

                if (type === 2) { // Directory
                    files.push(...await this.scanDirectory(fullPath));
                } else if (type === 1) { // File
                    const ext = path.extname(fullPath).toLowerCase();
                    if (SUPPORTED_EXTENSIONS.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (e) {
            this.acquisition.read_failures++;
            this.acquisition.state = 'PARTIAL';
            console.warn(`Skipping dir ${dir}:`, e);
        }
        return files;
    }

    batchFiles(files: FileContext[]): BatchedContext[] {
        const batches: BatchedContext[] = [];
        let currentBatch: FileContext[] = [];
        let currentTokens = 0;
        let batchIndex = 0;

        const sortedFiles = [...files].sort((a, b) => {
            const aIsSensitive = a.relativePath.includes('.env') || a.relativePath.includes('config');
            const bIsSensitive = b.relativePath.includes('.env') || b.relativePath.includes('config');
            if (aIsSensitive && !bIsSensitive) return -1;
            if (!aIsSensitive && bIsSensitive) return 1;
            return a.tokenEstimate - b.tokenEstimate;
        });

        for (const file of sortedFiles) {
            if (currentTokens + file.tokenEstimate > this.maxTokensPerBatch && currentBatch.length > 0) {
                batches.push({
                    files: currentBatch,
                    totalTokens: currentTokens,
                    batchIndex: batchIndex++
                });
                currentBatch = [];
                currentTokens = 0;
            }

            if (file.tokenEstimate > this.maxTokensPerBatch) {
                this.acquisition.truncated_files++;
                this.acquisition.state = 'PARTIAL';
                const maxChars = this.maxTokensPerBatch * 4;
                const truncatedContent = file.content.substring(0, maxChars) + '\n// ... [TRUNCATED]';

                batches.push({
                    files: [{
                        ...file,
                        content: truncatedContent,
                        tokenEstimate: this.maxTokensPerBatch
                    }],
                    totalTokens: this.maxTokensPerBatch,
                    batchIndex: batchIndex++
                });
                continue;
            }

            currentBatch.push(file);
            currentTokens += file.tokenEstimate;
        }

        if (currentBatch.length > 0) {
            batches.push({
                files: currentBatch,
                totalTokens: currentTokens,
                batchIndex: batchIndex
            });
        }

        return batches;
    }

    formatBatchForPrompt(batch: BatchedContext): string {
        return batch.files.map(file => `
### File: ${file.relativePath}
\`\`\`${file.language}
${file.content}
\`\`\`
`).join('\n---\n');
    }

    getStats(files: FileContext[], batches: BatchedContext[]): string {
        return `📊 Batcher Stats: ${files.length} files, ~${files.reduce((sum, f) => sum + f.tokenEstimate, 0).toLocaleString()} tokens, ${batches.length} batch(es)`;
    }
}
