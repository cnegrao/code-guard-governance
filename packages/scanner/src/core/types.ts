export interface ScannerRequest {
  repoUrl: string;
  branch?: string;
  githubToken?: string;
}

export interface ShadowAIFinding {
  file: string;
  provider: string;
  modelId: string | null;
  usage: string;
  governed: boolean;
  reason: string;
}

/** Applies to technical observations, including an empty or incomplete scan. */
export const SCANNER_ANALYSIS_BOUNDARY = Object.freeze({
  analysisKind: 'HEURISTIC',
  authority: 'NON_AUTHORITATIVE',
  limitations: Object.freeze(['NOT_CERTIFICATION', 'NOT_COMPLIANCE_DETERMINATION', 'NOT_ASSURANCE'] as const),
  interpretation: 'Technical scan observations only. Absence of a finding is not proof of satisfaction. Scanner output is not canonical governance truth.',
} as const);

export type ScannerAnalysisBoundary = typeof SCANNER_ANALYSIS_BOUNDARY;

export interface ScannerResult {
  analysisBoundary: ScannerAnalysisBoundary;
  repo: RepoMetadata;
  packages: PackageAnalysis;
  configs: ConfigAnalysis;
  source: SourceAnalysis;
  risks: DetectedRisk[];
  compliance: ComplianceAnalysis;
  owner: OwnerInfo;
  shadowAI: ShadowAIFinding[];
  violations: CodeViolation[];
  enrichment: ScannerEnrichment;
  agentClassifications?: import('./classifier').AgentClassification[];
  aiActSummary?: import('./classifier').RepoAIActSummary;
}

export interface RepoMetadata {
  name: string;
  owner: string;
  fullName: string;
  description: string;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  hasLicense: boolean;
  licenseName: string | null;
  fileCount: number;
  totalSize: number;
  topics: string[];
}

export interface PackageAnalysis {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  hasTestFramework: boolean;
  testFramework: string | null;
  hasLinter: boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  aiDependencies: string[];
  dbDependencies: string[];
  authDependencies: string[];
  paymentDependencies: string[];
  cloudDependencies: string[];
}

export interface ConfigAnalysis {
  hasEnvExample: boolean;
  hasLicense: boolean;
  hasReadme: boolean;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasDocker: boolean;
  hasCICD: boolean;
  hasDockerCompose: boolean;
  typescript: { strict: boolean; target: string; module: string } | null;
  eslint: boolean;
  prettier: boolean;
}

export interface SourceAnalysis {
  apiRoutes: ApiRoute[];
  databaseTables: string[];
  externalServices: ServiceEndpoint[];
  authPatterns: string[];
  aiModels: AIModel[];
  dataAssets: DataAssetDetected[];
  agents: DetectedAgent[];
  fileTree: string[];
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  // Enhanced discovery fields
  notebooks: NotebookAnalysis[];
  extractedPrompts: ExtractedPrompt[];
  frameworks: FrameworkUsage[];
  memorySystems: MemorySystem[];
  classification: RepoClassification | null;
}

export interface ApiRoute {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  authRequired: boolean;
  description: string;
}

export interface ServiceEndpoint {
  name: string;
  url: string | null;
  type: 'ai' | 'database' | 'auth' | 'payment' | 'storage' | 'monitoring' | 'other';
}

export interface AIModel {
  provider: string;
  modelId: string | null;
  usage: 'chat' | 'embedding' | 'completion' | 'vision' | 'unknown';
}

export interface DataAssetDetected {
  name: string;
  type: 'database_table' | 'file_store' | 'cache' | 'queue' | 'bucket';
  hasPII: boolean;
  legalBasis: string[];
}

export interface DetectedAgent {
  name: string;
  type: 'ai_persona' | 'service' | 'pipeline' | 'custom';
  tools: string[];
  models: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  critical: boolean;
  framework?: string;
  oversightLevel?: string;
  isAutonomous?: boolean;
  confidence?: number;
  filePath?: string;
}

export interface DetectedRisk {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'compliance' | 'legal' | 'operational' | 'financial' | 'architectural';
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
  cgagControl?: string;
}

export interface ComplianceAnalysis {
  applicableRegulations: ApplicableRegulation[];
  overallScore: number;
  summary: string;
}

export interface ApplicableRegulation {
  id: string;
  name: string;
  authority: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'not_applicable';
  requirements: string[];
  evidenceFound: string[];
  gaps: string[];
}

export interface OwnerInfo {
  id: string;
  label: string;
  email: string;
  role: string;
  teams: string[];
}

export interface ScannerGraphOSOutput {
  entities: any[];
  relationships: any[];
}

// ── Enhanced Discovery Types ──────────────────────────────

export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw';
  source: string;
  lineCount: number;
}

export interface ExtractedPrompt {
  type: 'system' | 'user' | 'assistant' | 'template' | 'few_shot' | 'chain_of_thought' | 'react' | 'role';
  content: string;
  source: string;
  hash: string;
  framework?: string;
}

export interface FrameworkUsage {
  framework: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  files: string[];
}

export interface MemorySystem {
  type: 'vector_store' | 'long_term' | 'session' | 'semantic' | 'knowledge' | 'agent';
  technology: string;
  evidence: string;
  governed: boolean;
}

export interface NotebookAnalysis {
  totalCells: number;
  codeCells: number;
  markdownCells: number;
  hasAPIKeys: boolean;
  apiKeyCount: number;
  prompts: ExtractedPrompt[];
  frameworks: FrameworkUsage[];
  memorySystems: MemorySystem[];
  externalServices: string[];
  agentRoles: string[];
  isEducational: boolean;
  isProduction: boolean;
  isEnterprise: boolean;
  educationalScore: number;
  productionScore: number;
}

export interface RepoClassification {
  category: 'educational' | 'prototype' | 'production' | 'enterprise';
  confidence: number;
  evidence: string[];
}

// Extended ScannerResult with enhanced discovery fields
export interface ScannerEnhancements {
  notebooks: NotebookAnalysis[];
  extractedPrompts: ExtractedPrompt[];
  frameworks: FrameworkUsage[];
  memorySystems: MemorySystem[];
  classification: RepoClassification;
}

// ── Violation Detection (PCI, SQLI, XSS, secrets, etc.) ──

export interface CodeViolation {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'pci' | 'owasp' | 'gdpr' | 'shadow_api' | 'best_practice';
  message: string;
  file: string;
  line: number;
  match: string;
  recommendation: string;
}

export interface ViolationScanResult {
  violations: CodeViolation[];
  summary: string;
}

// ── Enrichment: LGPD/PII Scanner (16 rules) ──

export interface PIIFinding {
  category: 'PII' | 'CREDENTIAL' | 'BIOMETRIC' | 'FINANCIAL' | 'HEALTH';
  severity: 'critical' | 'high' | 'medium' | 'low';
  rule: string;
  match: string;
  line: number;
  file: string;
  message: string;
}

export interface PIIEnrichment {
  findings: PIIFinding[];
  piiExposure: boolean;
  credentialExposure: boolean;
  biometricExposure: boolean;
  healthExposure: boolean;
  financialExposure: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ── Enrichment: Cross-File Data Lineage ──

export interface DataFlowNode {
  type: 'source' | 'transform' | 'sink';
  category: string;
  file: string;
  line: number;
  content: string;
}

export interface DataFlow {
  id: string;
  source: DataFlowNode;
  transformation: DataFlowNode | null;
  sink: DataFlowNode;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  evidence: string[];
}

export interface LineageResult {
  flows: DataFlow[];
  totalFlows: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
}

// ── Enrichment: Trust Zone ──

export type TrustZone = 'production' | 'staging' | 'development' | 'sandbox';

export interface TrustZoneResult {
  trustZone: TrustZone;
  confidence: number;
  evidence: string[];
}

// ── Enrichment: Code Map ──

export interface CodeMapResult {
  functions: string[];
  classes: string[];
  exports: string[];
  imports: string[];
  language: string;
}

// ── Full Enrichment Container ──

export interface ScannerEnrichment {
  pii: PIIEnrichment | null;
  lineage: LineageResult | null;
  trustZone: TrustZoneResult | null;
  codeMap: CodeMapResult | null;
}
