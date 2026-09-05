// Core scanner (graphos-complete canonical source of truth)
export type {
  DetectedAgent, DetectedRisk, ScannerRequest, ScannerResult,
  PackageAnalysis, ConfigAnalysis, SourceAnalysis, ShadowAIFinding,
  CertificationResult, ComplianceAnalysis, ApplicableRegulation,
  CodeViolation, ViolationScanResult,
  PIIEnrichment, PIIFinding,
  DataFlow, DataFlowNode, LineageResult,
  TrustZoneResult, TrustZone,
  CodeMapResult, ScannerEnrichment,
  RepoMetadata, OwnerInfo, AIModel, ApiRoute, ServiceEndpoint,
  DataAssetDetected, FrameworkUsage, MemorySystem, NotebookAnalysis,
  ExtractedPrompt, NotebookCell, RepoClassification,
} from './core/types';

export { detectAgentFrameworks, buildAgentsFromFrameworkMatches } from './core/agent-detector';
export { detectFrameworks, detectFrameworksFromFileTree } from './core/framework-detector';
export { detectMemorySystems } from './core/memory-detector';
export { estimateModelCost } from './core/model-parser';
export { parseNotebook } from './core/notebook-parser';
export { classifyAllAgents, summarizeAIAct } from './core/classifier';
export { detectRisks } from './core/risk-detector';
export { detectShadowAI } from './core/shadow-ai';
export { scanCodeViolations } from './core/violations';
export { certifySystem } from './core/certification';
export { CG_AG_CONTROLS, getCGAGControl, getCGAGControlByRisk, isCGAGImplemented, getCGAGScore } from './core/cg-ag-controls';
export type { CGAGControl } from './core/cg-ag-controls';
export { analyzePackageJson, analyzeConfigs, analyzeSourceCode, aggregatePackages } from './core/analyzer';
export { aggregatePII } from './core/enrichment/lgpd-pii';
export { traceDataFlows } from './core/enrichment/lineage';
export { cachedFetch } from './core/github-cache';
export { parseRepoUrl, fetchRepoMetadata, fetchFileContent, fetchFileTree, fetchLanguages } from './core/github';

// Connector SDK (multi-provider source control + CI/CD + IaC)
export {
  GitHubConnector, GitLabConnector, GiteaConnector, ForgejoConnector,
  BitbucketConnector, AzureDevOpsConnector,
  getConnector, getConnectorForUrl, detectProvider, buildConfig, normaliseRepoUrl,
  detectCiCd, detectIacAi,
  EntraIdConnector, OktaConnector, KeycloakConnector, getIdentityConnector, isGovernanceRelevant,
  ConfluenceConnector, SharePointConnector, NotionConnector, getDocsConnector, htmlToText,
} from './connectors';
export type {
  SourceConnector, ConnectorConfig, ConnectorFile, ConnectorRepoMeta,
  CiCdSignal, IacAiSignal, SourceProvider,
  IdentityConnector, IdentityConfig, IdentityUser, IdentityGroup, IdentitySyncResult, IdentityProvider,
  DocsConnector, DocsConfig, DocsPage, DocsProvider,
} from './connectors';

// Unified scanner
export { Scanner } from './unified';
export type { SourceConfig, SourceType, UnifiedScanResult } from './unified';

// Codeguard extensions (backward-compatible with codeguard-os API routes)
export type {
  DiscoveredAgent, DiscoveredSystem, ClassificationResult,
  RepoFile, EnrichmentData, DiscoveryResult,
} from './codeguard/types';

export { detectAgents, detectConfigAgents } from './codeguard/agent-detector';
export { classifyAgent } from './codeguard/classifier';
export { groupAgentsIntoLSystems } from './codeguard/system-detector';
export { enrichAgent, enrichSummary, analyseDataLineage, analyseFinOps, scanLGPDP, detectFAPI, inferTrustZone, computeGovernancePriority, extractCodeMap } from './codeguard/enrichment';
export { traceCrossFileLineage } from './codeguard/enrichment/cross-file-lineage';
export { buildKnowledgeGraph } from './codeguard/repo-knowledge-graph';
export type { KnowledgeGraph, KnowledgeGraphNode, KnowledgeGraphEdge } from './codeguard/repo-knowledge-graph';
export { generateRepoIntelligence } from './codeguard/repo-intelligence';
export type { RepoIntelligence, RepoFileInfo, AgentReference } from './codeguard/repo-intelligence/types';

// Discovery Engine v1 (source-agnostic runtime: adapter -> pipeline -> evidence-backed candidate)
export { isDiscoveryPathExcluded } from './discovery/path-policy';
export type {
  ReadArtifactOutcome,
  SourceAdapter,
  SourceArtifactContent,
  SourceArtifactRef,
  SourceDescriptor,
} from './discovery/source-adapter';
export { LocalRepositoryAdapter } from './discovery/adapters/local-repository-adapter';
export type { DetectionMatch, DetectionSpecification } from './discovery/detection-specification';
export { AgentKindDeclarationSpecification } from './discovery/strategies/agent-kind-declaration';
export { ModelReferenceDeclarationSpecification } from './discovery/strategies/model-reference-declaration';
export type { DiscoveryCandidate } from './discovery/evidence-assembly';
export { assembleDiscoveryCandidate } from './discovery/evidence-assembly';
export type {
  DiscoveryPipelineOptions,
  DiscoveryRunResult,
  DiscoveryRunWarning,
} from './discovery/pipeline';
export { DiscoveryPipeline } from './discovery/pipeline';
export type { ProvenanceClock } from './discovery/provenance';
export {
  completeAcquisitionRun,
  createSourceConnection,
  createSourceSystem,
  startAcquisitionRun,
  systemClock,
} from './discovery/provenance';
