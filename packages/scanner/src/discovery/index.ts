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
export type { AgentVersionTechnicalSignalCode } from './strategies/agent-version-technical-signal-declaration';
export {
  AGENT_VERSION_TECHNICAL_SIGNAL_CODES,
  BuildReferenceDeclarationSpecification,
  FrameworkReferenceDeclarationSpecification,
  GuardrailReferenceDeclarationSpecification,
  HitlReferenceDeclarationSpecification,
  MemoryReferenceDeclarationSpecification,
  OrchestrationReferenceDeclarationSpecification,
} from './strategies/agent-version-technical-signal-declaration';

export type { DiscoveryCandidate } from './evidence-assembly';
export { assembleDiscoveryCandidate } from './evidence-assembly';

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
