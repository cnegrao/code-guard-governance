export type { GraphEntity, EntityKind, Relationship, RelKind, FullGraph } from './types';
export { GraphEngine } from './engine';

// Detailed entity types
export type {
  AgentNode, DecisionNode, ToolNode, ExternalSystemNode, DataAssetNode,
  ModelNode, RiskNode, RegulationNode, EvidenceNode, OwnerNode, PromptNode,
  ControlNode, CertificateNode, IncidentNode, CostCenterNode, MemoryNode, ClassificationNode,
} from './types/entities';

// Relationship defs
export type { RelationshipDef } from './types/relationships';
export { RELATIONSHIP_DEFS } from './types/relationships';

// Backward compat
export { buildFullGraph } from './compat';
export type { ViewResult, ViewName, GraphNodeType, GraphNode, GraphEdge } from './compat';
export { VIEW_META, VIEW_BUILDERS } from './compat';

export { projectL15RiskExposure, retrieveL15RiskVectors, runL15LlmBoundaryStub } from './governed/l15-risk-analysis';
export type { L15AnalyticalRiskIdentity } from './governed/l15-risk-analysis';
