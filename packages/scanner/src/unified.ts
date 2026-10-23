import { GraphEngine } from '@council/graphos';
import type { GraphEntity, Relationship } from '@council/graphos';
import type { RepoFile } from './codeguard/types';
import { SCANNER_ANALYSIS_BOUNDARY, type ScannerAnalysisBoundary, type SourceAnalysis, type DetectedRisk } from './core/types';
import type { AgentClassification } from './core/classifier';

export type SourceType = 'local' | 'github' | 'gitlab' | 'azure_devops' | 'bitbucket' | 'replit' | 'lovable' | 'n8n' | 'dify' | 'langgraph' | 'crewai' | 'openai_agents' | 'mcp_server';

export interface SourceConfig {
  type: SourceType;
  path?: string;
  url?: string;
  token?: string;
  branch?: string;
}

export interface UnifiedScanResult {
  analysisBoundary: ScannerAnalysisBoundary;
  acquisition: { discoveredFiles: number; analyzedFiles: number; unreadFiles: string[]; limitations: string[] };
  source: SourceConfig;
  agents: (GraphEntity & { kind: 'agent' })[];
  decisions: (GraphEntity & { kind: 'decision' })[];
  tools: (GraphEntity & { kind: 'tool' })[];
  models: (GraphEntity & { kind: 'model' })[];
  risks: (GraphEntity & { kind: 'risk' })[];
  evidence: (GraphEntity & { kind: 'evidence' })[];
  regulations: (GraphEntity & { kind: 'regulation' })[];
  dataAssets: (GraphEntity & { kind: 'data_asset' })[];
  controls: (GraphEntity & { kind: 'control' })[];
  incidents: (GraphEntity & { kind: 'incident' })[];
  owners: (GraphEntity & { kind: 'owner' })[];
  prompts: (GraphEntity & { kind: 'prompt' })[];
  relationships: Relationship[];
  summary: { totalAgents: number; totalRisks: number; totalEvidence: number; };
}

export class Scanner {
  private source!: SourceConfig;
  private result: Partial<UnifiedScanResult> = {};
  private relSeq = 0;
  private relId() { return `rel-${++this.relSeq}`; }

  async scan(source: SourceConfig): Promise<UnifiedScanResult> {
    this.source = source;
    this.relSeq = 0;
    this.result = {};

    // Phase 1: Load raw files
    const { files, fileContents, fileTree, languages } = await this.loadFiles(source);
    const unreadFiles = files.filter(f => !fileContents.has(f.path)).map(f => f.path);
    this.result.acquisition = {
      discoveredFiles: files.length,
      analyzedFiles: fileContents.size,
      unreadFiles,
      limitations: [
        'File discovery and pattern detection are bounded; unlisted, unsupported or undetected content may exist.',
        ...(source.type !== 'local' ? ['Remote acquisition reads at most 200 listed files; upstream failures can return an empty tree or unread content.'] : []),
        ...(files.length === 0 ? ['No files acquired; source absence, emptiness or acquisition failure is unresolved.'] : []),
        ...(unreadFiles.length > 0 ? ['Listed files were not analyzed because of read failure, size or acquisition limits.'] : []),
      ],
    };
    if (fileContents.size === 0) return this.buildResult();

    // Phase 2: Analyze
    const { analyzePackageJson, analyzeConfigs, analyzeSourceCode } = await import('./core/analyzer');
    const { detectFrameworks } = await import('./core/framework-detector');
    const { detectAgentFrameworks, buildAgentsFromFrameworkMatches } = await import('./core/agent-detector');
    const { detectMemorySystems } = await import('./core/memory-detector');
    const { detectRisks } = await import('./core/risk-detector');
    const { detectShadowAI } = await import('./core/shadow-ai');
    const { classifyAllAgents } = await import('./core/classifier');

    const packageJsonContent = fileContents.get('package.json') || null;
    const tsconfigContent = fileContents.get('tsconfig.json') || null;
    const eslintContent = fileContents.get('.eslintrc.json') || fileContents.get('.eslintrc') || null;
    const packages = analyzePackageJson(packageJsonContent);
    const configs = analyzeConfigs(packageJsonContent, fileTree, tsconfigContent, eslintContent);
    const sourceAnalysis = analyzeSourceCode(fileContents, fileTree, languages);
    sourceAnalysis.frameworks = [];
    for (const [filePath, content] of fileContents) {
      if (content.length > 500000) continue;
      try {
        const fws = detectFrameworks(content, filePath);
        sourceAnalysis.frameworks.push(...fws);
      } catch { /* skip binary */ }
    }
    sourceAnalysis.memorySystems = [];
    for (const content of fileContents.values()) {
      try {
        sourceAnalysis.memorySystems.push(...detectMemorySystems(content));
      } catch { /* skip */ }
    }
    const depNames = Object.keys(packages.dependencies || {});
    if (depNames.length > 0) {
      try {
        const { detectMemorySystemsFromDeps } = await import('./core/memory-detector');
        sourceAnalysis.memorySystems.push(...detectMemorySystemsFromDeps(depNames));
      } catch { /* skip */ }
    }

    // Agent detection
    const frameworkMap = detectAgentFrameworks(fileContents);
    const coreAgents = buildAgentsFromFrameworkMatches(frameworkMap);
    sourceAnalysis.agents = coreAgents.map((a: any) => ({
      ...a, id: a.name?.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      filePath: a.filePath || '',
    }));

    // Technical heuristic detection, with no aggregate assurance decision.
    const shadowAI = detectShadowAI(fileContents, sourceAnalysis);
    const risks = detectRisks(packages, configs, sourceAnalysis, fileTree, shadowAI);
    const classifications = classifyAllAgents(sourceAnalysis.agents, sourceAnalysis, packages);

    // Map to GraphOS
    this.mapToGraph({ sourceAnalysis, risks, classifications, fileContents });

    return this.buildResult();
  }

  private async loadFiles(source: SourceConfig): Promise<{ files: RepoFile[]; fileContents: Map<string, string>; fileTree: string[]; languages: Record<string, number> }> {
    if (source.type === 'local' && source.path) return this.loadLocalFiles(source.path);

    const token = source.token || process.env.GITHUB_TOKEN || '';
    const { parseRepoUrl, fetchFileTree, fetchFileContent, fetchLanguages } = await import('./core/github');
    const repo = source.url ? parseRepoUrl(source.url) : null;
    if (!repo) return { files: [], fileContents: new Map(), fileTree: [], languages: {} };

    const tree = await fetchFileTree(repo.owner, repo.repo, source.branch, token);
    const languages = await fetchLanguages(repo.owner, repo.repo, token);
    const files: RepoFile[] = tree.map((f: any) => ({ path: f.path, name: f.path.split('/').pop() || f.path, type: 'file' as const, size: f.size }));
    const fileContents = new Map<string, string>();
    for (const f of files.slice(0, 200)) {
      try {
        const content = await fetchFileContent(repo.owner, repo.repo, f.path, token);
        if (content !== null) fileContents.set(f.path, content);
      } catch { /* skip */ }
    }
    return { files, fileContents, fileTree: tree.map((f: any) => f.path), languages };
  }

  private async loadLocalFiles(dir: string): Promise<{ files: RepoFile[]; fileContents: Map<string, string>; fileTree: string[]; languages: Record<string, number> }> {
    const { readdir, readFile, stat } = await import('fs/promises');
    const { join, relative, extname } = await import('path');
    const files: RepoFile[] = [];
    const fileContents = new Map<string, string>();
    const EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.json', '.yaml', '.yml', '.md', '.mjs', '.cjs', '.css', '.html', '.env', '.xml']);

    async function walk(dirPath: string): Promise<void> {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dirPath, entry.name);
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist' || entry.name === 'build') continue;
        if (entry.isDirectory()) { await walk(full); continue; }
        const ext = extname(entry.name).toLowerCase();
        if (EXTENSIONS.has(ext) || ext === '') {
          const rel = relative(dir, full).replace(/\\/g, '/');
          try {
            const s = await stat(full);
            files.push({ path: rel, name: entry.name, type: 'file', size: s.size });
            if (s.size < 500000) {
              const content = await readFile(full, 'utf-8');
              fileContents.set(rel, content);
            }
          } catch { /* skip */ }
        }
      }
    }
    await walk(dir);
    const languages: Record<string, number> = {};
    for (const f of files) {
      const ext = extname(f.name).toLowerCase();
      languages[ext] = (languages[ext] || 0) + 1;
    }
    return { files, fileContents, fileTree: files.map(f => f.path), languages };
  }

  private mapToGraph(data: {
    sourceAnalysis: SourceAnalysis; risks: DetectedRisk[]; classifications: AgentClassification[];
    fileContents: Map<string, string>;
  }): void {
    const agents: UnifiedScanResult['agents'] = [];
    const risks: UnifiedScanResult['risks'] = [];
    const evidence: UnifiedScanResult['evidence'] = [];
    const tools: UnifiedScanResult['tools'] = [];
    const models: UnifiedScanResult['models'] = [];
    const regulations: UnifiedScanResult['regulations'] = [];
    const dataAssets: UnifiedScanResult['dataAssets'] = [];
    const controls: UnifiedScanResult['controls'] = [];
    const incidents: UnifiedScanResult['incidents'] = [];
    const prompts: UnifiedScanResult['prompts'] = [];
    const owners: UnifiedScanResult['owners'] = [];
    const decisions: UnifiedScanResult['decisions'] = [];
    const relationships: Relationship[] = [];

    // Owner
    const ownerId = 'owner-default';
    owners.push({ id: ownerId, kind: 'owner', label: 'Repository Owner', description: 'Default owner', attrs: { role: 'owner' } });

    // Agents
    const agentIds: string[] = [];
    for (const a of data.sourceAnalysis.agents || []) {
      const id = a.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const cls = (data.classifications || []).find((c: any) => c.agentId === a.name);
      agents.push({
        id, kind: 'agent', label: a.name || 'Unknown Agent',
        description: ('description' in a && typeof a.description === 'string' && a.description) || `Type: ${a.type || 'ai_persona'} | Risk: ${a.riskLevel || 'medium'}`,
        attrs: {
          agentType: a.type || 'ai_persona', riskLevel: a.riskLevel || 'medium',
          aiActRiskClass: cls?.aiActCategory, critical: a.critical || false,
          tools: a.tools || [], models: a.models || [], status: 'active',
        } as Record<string, unknown>,
      });
      agentIds.push(id);
      relationships.push({ id: this.relId(), kind: 'OWNED_BY', sourceId: id, targetId: ownerId });
    }

    // Models
    for (const m of data.sourceAnalysis.aiModels || []) {
      const costPerToken = 'costPerToken' in m && typeof m.costPerToken === 'number' ? m.costPerToken : undefined;
      const mid = `model-${(m.provider || '').toLowerCase()}-${(m.modelId || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      models.push({ id: mid, kind: 'model', label: m.modelId || `${m.provider} Model`,
        description: `Provider: ${m.provider} | Cost: ${costPerToken || 0}`,
        attrs: { provider: m.provider, modelId: m.modelId || 'unknown', costPerToken } as Record<string, unknown>,
      });
      // Legacy, non-authoritative model correlation has no AGENT_VERSION
      // evidence. Fail closed: model discovery remains, behavior edges do not.
    }

    // Evidence candidates from acquired source files, never proof of satisfaction.
    for (const f of Array.from(data.fileContents.keys()).slice(0, 200)) {
      const eid = `ev-${f.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
      evidence.push({ id: eid, kind: 'evidence', label: f.split('/').pop() || f, description: `Source: ${f}`, attrs: { source: f } });
    }

    // Risks
    for (const r of data.risks || []) {
      const rid = `risk-${(r.id || r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      risks.push({ id: rid, kind: 'risk', label: r.title || 'Risk',
        description: r.description?.slice(0, 200) || '',
        attrs: { severity: r.severity || 'medium', riskType: r.category, impact: r.severity === 'critical' ? 100000 : 50000 } as Record<string, unknown>,
      });
      for (const aid of agentIds.slice(0, 5)) {
        relationships.push({ id: this.relId(), kind: 'IMPACTS_RISK', sourceId: aid, targetId: rid });
      }
    }

    this.result = {
      acquisition: this.result.acquisition,
      agents, decisions, tools, models, risks, evidence, regulations, dataAssets,
      controls, incidents, owners, prompts, relationships,
    };
    for (const entity of [...agents, ...models, ...risks, ...evidence, ...owners]) {
      entity.attrs = { ...entity.attrs, analysisBoundary: SCANNER_ANALYSIS_BOUNDARY };
    }
  }

  private buildResult(): UnifiedScanResult {
    return {
      analysisBoundary: SCANNER_ANALYSIS_BOUNDARY,
      acquisition: this.result.acquisition!,
      source: this.source,
      agents: this.result.agents || [],
      decisions: this.result.decisions || [],
      tools: this.result.tools || [],
      models: this.result.models || [],
      risks: this.result.risks || [],
      evidence: this.result.evidence || [],
      regulations: this.result.regulations || [],
      dataAssets: this.result.dataAssets || [],
      controls: this.result.controls || [],
      incidents: this.result.incidents || [],
      owners: this.result.owners || [],
      prompts: this.result.prompts || [],
      relationships: this.result.relationships || [],
      summary: {
        totalAgents: (this.result.agents || []).length,
        totalRisks: (this.result.risks || []).length,
        totalEvidence: (this.result.evidence || []).length,
      },
    };
  }

  toGraph(scanResult?: UnifiedScanResult): GraphEngine {
    const engine = new GraphEngine();
    const r = scanResult || this.buildResult();
    const allEntities = [
      ...r.agents, ...r.decisions, ...r.tools, ...r.models,
      ...r.risks, ...r.evidence, ...r.regulations, ...r.dataAssets,
      ...r.controls, ...r.incidents, ...r.owners, ...r.prompts,
    ];
    engine.load(allEntities, r.relationships);
    return engine;
  }
}
