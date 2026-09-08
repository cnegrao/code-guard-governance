export { isDiscoveryPathExcluded } from './path-policy';

export type {
  ReadArtifactOutcome,
  SourceAdapter,
  SourceArtifactContent,
  SourceArtifactRef,
  SourceDescriptor,
} from './source-adapter';

export { LocalRepositoryAdapter } from './adapters/local-repository-adapter';

export type { DetectionMatch, DetectionSpecification } from './detection-specification';
export { AgentKindDeclarationSpecification } from './strategies/agent-kind-declaration';
export { ModelReferenceDeclarationSpecification } from './strategies/model-reference-declaration';
export { ToolListDeclarationSpecification } from './strategies/tool-list-declaration';
export { PromptDeclarationSpecification } from './strategies/prompt-declaration';
export { McpServerDeclarationSpecification } from './strategies/mcp-server-declaration';
export { ApiDeclarationSpecification } from './strategies/api-declaration';
export { KnowledgeBaseDeclarationSpecification } from './strategies/knowledge-base-declaration';
export { SkillListDeclarationSpecification } from './strategies/skill-list-declaration';
export {
  FRAMEWORK_IMPORT_PATTERNS,
  FrameworkImportSignalSpecification,
  OrchestrationFrameworkSignalSpecification,
} from './strategies/framework-import-signal';
export { MEMORY_IMPORT_PATTERNS, MemoryImportSignalSpecification } from './strategies/memory-import-signal';

export type { DiscoveryCandidate } from './evidence-assembly';
export { assembleDiscoveryCandidate } from './evidence-assembly';

export type {
  TechnicalProfileSignal,
  TechnicalProfileSignalKind,
  TechnicalProfileSignalMatch,
  TechnicalProfileSignalSpecification,
} from './technical-profile-signal';
export { TECHNICAL_PROFILE_SIGNAL_KIND, assembleTechnicalProfileSignal } from './technical-profile-signal';

export type {
  ObjectCandidateNormalizationResult,
  ObjectCandidateNormalizationStrategy,
  ObjectNormalizationReasonCode,
} from './object-candidate-normalization';
export {
  AgentCandidateNormalizationStrategy,
  ApiCandidateNormalizationStrategy,
  KnowledgeBaseCandidateNormalizationStrategy,
  McpServerCandidateNormalizationStrategy,
  ModelCandidateNormalizationStrategy,
  OBJECT_NORMALIZATION_REASON_CODE,
  PromptCandidateNormalizationStrategy,
  SkillCandidateNormalizationStrategy,
  ToolCandidateNormalizationStrategy,
  normalizeObjectCandidate,
} from './object-candidate-normalization';

export type { RelationshipCorrelationResult } from './relationship-correlation';
export {
  RelationshipCorrelationStrategy,
  correlateAgentUsesModelRelationships,
  correlateAgentUsesToolRelationships,
} from './relationship-correlation';

export type { AgentVersionCorrelationResult } from './agent-version-correlation';
export { AgentVersionCorrelationStrategy, correlateAgentVersions } from './agent-version-correlation';

export type {
  DiscoveryPipelineOptions,
  DiscoveryRunResult,
  DiscoveryRunWarning,
} from './pipeline';
export { DiscoveryPipeline } from './pipeline';

export type { ProvenanceClock } from './provenance';
export {
  completeAcquisitionRun,
  createSourceConnection,
  createSourceSystem,
  startAcquisitionRun,
  systemClock,
} from './provenance';
