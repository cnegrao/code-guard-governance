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

export type { DiscoveryCandidate } from './evidence-assembly';
export { assembleDiscoveryCandidate } from './evidence-assembly';

export type { RelationshipCorrelationResult } from './relationship-correlation';
export {
  RelationshipCorrelationStrategy,
  correlateAgentUsesModelRelationships,
} from './relationship-correlation';

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
