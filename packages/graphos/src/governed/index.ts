/** Dedicated canonical read boundary; deliberately independent of legacy GraphEngine. */
export { projectCanonicalGraph, governedNodeId } from './graph';
export type { CanonicalObjectRow, CanonicalRelationshipRow, GovernedGraph, GovernedNode, GovernedEdge } from './graph';
export { traverseCanonicalGraph } from './traversal';
export type { TraversalPolicy, TraversalDirection, GraphContribution, PathStep } from './traversal';
export { retrieveCanonicalVectors, buildAnalyticalContext, VECTOR_RETRIEVAL_POLICY } from './retrieval';
export type { ExactRetrievalInput, VectorContribution, HybridResult, AnalyticalCopilotContext, RepresentationExplanation } from './retrieval';
