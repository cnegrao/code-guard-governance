import { GraphEngine } from '@council/graphos';
import type { GraphEntity, Relationship } from '@council/graphos';
import type { RepoFile } from './codeguard/types';

export type SourceType = 'local' | 'github' | 'gitlab' | 'azure_devops' | 'bitbucket' | 'replit' | 'lovable' | 'n8n' | 'dify' | 'langgraph' | 'crewai' | 'openai_agents' | 'mcp_server';

export interface SourceConfig {
  type: SourceType;
  path?: string;
  url?: string;
  token?: string;
  branch?: string;
}

export interface UnifiedScanResult {
  source: SourceConfig;
  agents: GraphEntity[];
  decisions: GraphEntity[];
  tools: GraphEntity[];
  models: GraphEntity[];
  risks: GraphEntity[];
  evidence: GraphEntity[];
  regulations: GraphEntity[];
  dataAssets: GraphEntity[];
  controls: GraphEntity[];
  incidents: GraphEntity[];
  owners: GraphEntity[];
  prompts: GraphEntity[];
  certificates: GraphEntity[];
  relationships: Relationship[];
  certResult: { overall: string; levels: Record<string, { pass: boolean; evidence: string[]; fail: string[] }> };
  summary: { totalAgents: number; totalRisks: number; totalEvidence: number; complianceScore: number; certLevel: string; };
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
    if (!files || files.length === 0) return this.buildResult();

    // Phase 2: Analyze
    const { analyzePackageJson, analyzeConfigs, analyzeSourceCode, aggregatePackages } = await import('./core/analyzer');
    const { detectFrameworks } = await import('./core/framework-detector');
    const { detectAgentFrameworks, buildAgentsFromFrameworkMatches } = await import('./core/agent-detector');
    const { detectMemorySystems } = await import('./core/memory-detector');
    const { detectRisks } = await import('./core/risk-detector');
    const { scanCodeViolations } = await import('./core/violations');
    const { detectShadowAI } = await import('./core/shadow-ai');
    const { classifyAllAgents, summarizeAIAct } = await import('./core/classifier');
    const { certifySystem } = await import('./core/certification');
    const { aggregatePII } = await import('./core/enrichment/lgpd-pii');
    const { traceDataFlows } = await import('./core/enrichment/lineage');
    const { inferTrustZone } = await import('./core/enrichment/trust-zone');

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

    // Compliance chain
    const shadowAI = detectShadowAI(fileContents, sourceAnalysis);
    const risks = detectRisks(packages, configs, sourceAnalysis, fileTree, shadowAI);
    const violations = scanCodeViolations(fileContents);
    const pii = aggregatePII(fileContents);
    const fileInfos = Array.from(fileContents.entries()).map(([path, content]) => ({ path, content }));
    const dataFlows = traceDataFlows(fileInfos);
    const trustZone = inferTrustZone(fileContents, fileTree);
    const classifications = classifyAllAgents(sourceAnalysis.agents, sourceAnalysis, packages);
    const aiActSummary = summarizeAIAct(classifications);
    const hasPII = pii.piiExposure || pii.credentialExposure || pii.biometricExposure || pii.healthExposure || pii.financialExposure;
    const hasConsent = sourceAnalysis.authPatterns.some(a => /consent/i.test(a)) || sourceAnalysis.dataAssets.some(d => d.name.toLowerCase().includes('consent'));
    const violationList = violations.violations;
    const complianceAnalysis: import('./core/types').ComplianceAnalysis = {
      applicableRegulations: [
        {
          id: 'lgpd', name: 'Lei Geral de Proteção de Dados (LGPD)', authority: 'ANPD',
          status: hasPII ? (hasConsent ? 'partial' : 'non_compliant') : 'not_applicable',
          requirements: ['Consentimento', 'Registro de operações', 'Política de privacidade'],
          evidenceFound: hasPII ? [`${pii.findings.length} dados pessoais identificados`] : [],
          gaps: hasPII && !hasConsent ? ['Sem consentimento detectado'] : [],
        },
        {
          id: 'ai-act', name: 'EU AI Act', authority: 'European Commission',
          status: aiActSummary.highRiskCount > 0 ? 'partial' : aiActSummary.totalAgents > 0 ? 'compliant' : 'not_applicable',
          requirements: ['Classificação de risco', 'Avaliação de conformidade', 'Supervisão humana'],
          evidenceFound: [`${aiActSummary.totalAgents} agentes`, `${aiActSummary.highRiskCount} alto/${aiActSummary.limitedRiskCount} limitado/${aiActSummary.minimalRiskCount} mínimo`],
          gaps: aiActSummary.requiresConformityAssessment ? ['Requer avaliação de conformidade'] : [],
        },
        {
          id: 'sox', name: 'Sarbanes-Oxley (SOX)', authority: 'SEC',
          status: violationList.length > 0 ? 'partial' : 'not_applicable',
          requirements: ['Audit trail', 'Controles internos', 'Retenção'],
          evidenceFound: [`${violationList.length} violações mapeadas`],
          gaps: violationList.filter(v => v.severity === 'critical' || v.severity === 'high').length > 0 ? [`${violationList.filter(v => v.severity === 'critical' || v.severity === 'high').length} violações críticas`] : [],
        },
      ],
      overallScore: Math.round(
        ((risks.length > 0 ? risks.filter(r => r.severity !== 'critical' && r.severity !== 'high').length / Math.max(risks.length, 1) * 100 : 100) * 0.4) +
        ((violationList.length > 0 ? violationList.filter(v => v.severity !== 'critical').length / Math.max(violationList.length, 1) * 100 : 100) * 0.3) +
        (shadowAI.length === 0 ? 100 : Math.max(0, 100 - shadowAI.length * 15)) * 0.3
      ),
      summary: `${sourceAnalysis.agents.length} agentes, ${risks.length} riscos, ${violationList.length} violações, ${shadowAI.length} shadow AI`,
    };
    const certResult = certifySystem(sourceAnalysis, risks, complianceAnalysis, packages);

    // Map to GraphOS
    this.mapToGraph({ packages, sourceAnalysis, risks, violations, shadowAI, pii, dataFlows, trustZone, classifications, aiActSummary, certResult, fileContents, fileTree });

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
        if (content) fileContents.set(f.path, content);
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
          const rel = relative(dir, full);
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
    packages: any; sourceAnalysis: any; risks: any[]; violations: any; shadowAI: any[];
    pii: any; dataFlows: any; trustZone: any; classifications: any; aiActSummary: any;
    certResult: any; fileContents: Map<string, string>; fileTree: string[];
  }): void {
    const agents: GraphEntity[] = [];
    const risks: GraphEntity[] = [];
    const evidence: GraphEntity[] = [];
    const tools: GraphEntity[] = [];
    const models: GraphEntity[] = [];
    const regulations: GraphEntity[] = [];
    const dataAssets: GraphEntity[] = [];
    const controls: GraphEntity[] = [];
    const incidents: GraphEntity[] = [];
    const prompts: GraphEntity[] = [];
    const owners: GraphEntity[] = [];
    const certificates: GraphEntity[] = [];
    const decisions: GraphEntity[] = [];
    const relationships: Relationship[] = [];

    // Owner
    const ownerId = 'owner-default';
    owners.push({ id: ownerId, kind: 'owner', label: 'Repository Owner', description: 'Default owner', attrs: { role: 'owner' } });

    // Agents
    const agentIds: string[] = [];
    for (const a of data.sourceAnalysis.agents || []) {
      const id = a.id || `agent-${(a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const cls = (data.classifications || []).find((c: any) => c.agentId === a.name);
      agents.push({
        id, kind: 'agent', label: a.name || 'Unknown Agent',
        description: a.description || `Type: ${a.type || 'ai_persona'} | Risk: ${a.riskLevel || 'medium'}`,
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
      const mid = `model-${(m.provider || '').toLowerCase()}-${(m.modelId || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      models.push({ id: mid, kind: 'model', label: m.modelId || `${m.provider} Model`,
        description: `Provider: ${m.provider} | Cost: ${m.costPerToken || 0}`,
        attrs: { provider: m.provider, modelId: m.modelId || 'unknown', costPerToken: m.costPerToken } as Record<string, unknown>,
      });
      // Legacy, non-authoritative model correlation has no AGENT_VERSION
      // evidence. Fail closed: model discovery remains, behavior edges do not.
    }

    // Evidence (source files)
    for (const f of data.fileTree.slice(0, 200)) {
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

    // Certificates
    const cert = data.certResult;
    if (cert) {
      certificates.push({ id: 'cert-main', kind: 'certificate', label: `Certification: ${cert.overall}`,
        attrs: { status: cert.overall === 'none' ? 'pending' : 'valid', certType: 'SOC2' } as Record<string, unknown> });
    }

    this.result = {
      agents, decisions, tools, models, risks, evidence, regulations, dataAssets,
      controls, incidents, owners, prompts, certificates, relationships,
      certResult: cert || { overall: 'none', levels: {} },
    };
  }

  private buildResult(): UnifiedScanResult {
    return {
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
      certificates: this.result.certificates || [],
      relationships: this.result.relationships || [],
      certResult: this.result.certResult || { overall: 'none', levels: {} },
      summary: {
        totalAgents: (this.result.agents || []).length,
        totalRisks: (this.result.risks || []).length,
        totalEvidence: (this.result.evidence || []).length,
        complianceScore: this.result.certResult?.overall === 'platinum' ? 100 : this.result.certResult?.overall === 'gold' ? 80 : this.result.certResult?.overall === 'silver' ? 60 : this.result.certResult?.overall === 'bronze' ? 40 : 0,
        certLevel: this.result.certResult?.overall || 'none',
      },
    };
  }

  toGraph(scanResult?: UnifiedScanResult): GraphEngine {
    const engine = new GraphEngine();
    const r = scanResult || this.result as UnifiedScanResult;
    const allEntities = [
      ...r.agents, ...r.decisions, ...r.tools, ...r.models,
      ...r.risks, ...r.evidence, ...r.regulations, ...r.dataAssets,
      ...r.controls, ...r.incidents, ...r.owners, ...r.prompts, ...r.certificates,
    ];
    engine.load(allEntities, r.relationships);
    return engine;
  }
}
