import type { FinOpsCostEvidence } from '@council/scanner/codeguard/enrichment/finops';

export interface RepositoryProvider {
  name: string;
  fetchFiles(owner: string, repo: string, branch?: string, path?: string): Promise<RepoFile[]>;
  fetchFileContent(owner: string, repo: string, path: string, branch?: string): Promise<string>;
}

export interface RepoFile {
  path: string;
  name: string;
  type: "file" | "dir";
  size?: number;
}

export interface DiscoveryResult {
  repository: string;
  provider: string;
  branch: string;
  scannedAt: string;
  filesScanned: number;
  agentsDiscovered: DiscoveredAgent[];
  systemsDiscovered: DiscoveredSystem[];
}

export interface DiscoveredAgent {
  name: string;
  filePath: string;
  framework: string;
  frameworkVersion?: string;
  agentType: string;
  confidence: number;
  evidence: string[];
  suggestedRiskLevel: string;
  suggestedOversightLevel: string;
  isAutonomous: boolean;
  capabilities: string[];
  modelName?: string;
  modelProvider?: string;
  enrichment?: EnrichmentData;
}

export interface EnrichmentData {
  lineage: {
    containsPii: boolean;
    containsFinancialData: boolean;
    containsHealthData: boolean;
    containsCredentials: boolean;
    externalSinks: string[];
    internalSinks: string[];
    sensitiveSources: string[];
    transformations: string[];
    riskLevel: string;
    evidence: Array<{ filePath: string; lineNumber: number; matchText: string; category: string }>;
  };
  finops: {
    nPlusOneDetected: boolean;
    expensiveScans: boolean;
    missingTimeout: boolean;
    missingRateLimit: boolean;
    missingCircuitBreaker: boolean;
    monthlyCostEstimate: number;
    costRisk: string;
    costHotspots: string[];
    breakdown: Array<{ category: string; estimatedMonthly: number; costEvidence?: FinOpsCostEvidence }>;
    /** Optional for historical readers; new scanner results always label all cost fields. */
    costEvidence?: FinOpsCostEvidence;
  };
  lgpd: {
    findings: Array<{ category: string; severity: string; rule: string; match: string; line: number; filePath: string; message: string }>;
    piiExposure: boolean;
    credentialExposure: boolean;
    biometricExposure: boolean;
    severity: string;
  };
  fapi: {
    financialServices: boolean;
    openBanking: boolean;
    fapiCompliant: boolean;
    doraExposure: boolean;
    signals: string[];
    confidence: number;
    evidence: Array<{ filePath: string; lineNumber: number; matchText: string; signal: string }>;
  };
  trustZone: {
    trustZone: string;
    confidence: number;
    evidence: string[];
  };
  codeMap: {
    agentCodeLocations: string[];
    functions: string[];
    classes: string[];
    exports: string[];
    imports: string[];
    language: string;
  };
  governancePriority: string;
  complianceExposure: string;
  aiActExposure: string;
  doraExposure: boolean;
  annexIiiCategory: string | null;
  discoveryConfidence: number;
  governanceConfidence: number;
  complianceConfidence: number;
  summary: {
    framework_detected: string;
    agent_type: string;
    risk_level: string;
    ai_act_risk_class: string;
    trust_zone: string;
    governance_priority: string;
    contains_pii: boolean;
    contains_financial_data: boolean;
    contains_health_data: boolean;
    external_sinks: number;
    internal_sinks: number;
    monthly_cost_estimate: number;
    monthly_cost_estimate_evidence?: FinOpsCostEvidence;
    code_locations: number;
    compliance_exposure: string;
    ai_act_exposure: string;
    dora_exposure: boolean;
    annex_iii_category: string | null;
    discovery_confidence: number;
    governance_confidence: number;
    compliance_confidence: number;
  };
}

export interface DiscoveredSystem {
  name: string;
  agents: string[];
  confidence: number;
  evidence: string[];
}

export interface ClassificationResult {
  agentType: string;
  riskLevel: string;
  aiActRiskClass: string;
  oversightLevel: string;
  businessDomain: string;
  isAutonomous: boolean;
  confidence: number;
  reasoning: string[];
}
