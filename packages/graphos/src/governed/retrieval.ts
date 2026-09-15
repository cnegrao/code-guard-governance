import { createSemanticRepresentation, createSemanticContentFingerprint,
  type OrganisationId, type SemanticRepresentation, type SemanticContentFingerprint } from '@council/canonical-contracts';
// Import only the pure M5 module, never the scanner pipeline/barrel or provider.
import { compareSemanticRepresentations, semanticSpaceIdentity, semanticSpaceKey, snapshotEndpoint,
  type SemanticComparisonFamily, type SemanticSpaceIdentity, type SimilarityEndpoint,
  COSINE_ALGORITHM_VERSION } from '@council/scanner/semantic/similarity';
import { compareId, requireGraph, requireText, timestamp, type GovernedGraph, type GovernedNode } from './graph';
import { traverseCanonicalGraph, type GraphContribution } from './traversal';

export const VECTOR_RETRIEVAL_POLICY = 'GOVIA_CANONICAL_EXACT_REPRESENTATIONS_V1';
const families: readonly string[] = Object.freeze(['AGENT', 'AGENT_VERSION', 'DATA_ELEMENT', 'PROMPT']);
export interface RepresentationExplanation extends SimilarityEndpoint {
  readonly contentFingerprint: SemanticContentFingerprint;
  readonly generatedAt: string;
}
function representationExplanation(rep: SemanticRepresentation, org: OrganisationId,
  family: SemanticComparisonFamily): RepresentationExplanation {
  return Object.freeze({ ...snapshotEndpoint(rep, org, family),
    contentFingerprint: createSemanticContentFingerprint(rep.contentFingerprint), generatedAt: rep.generatedAt });
}
export interface VectorContribution {
  readonly authority: 'ANALYTICAL';
  readonly subjectKind: 'CANONICAL_OBJECT';
  readonly node: GovernedNode;
  readonly representation: RepresentationExplanation;
  readonly semanticSpace: SemanticSpaceIdentity;
  readonly cosineScore: number;
  readonly metric: 'COSINE';
  readonly algorithmVersion: typeof COSINE_ALGORITHM_VERSION;
}
export interface ExactRetrievalInput {
  readonly organisationId: OrganisationId;
  readonly graph: GovernedGraph;
  readonly seedCanonicalObjectId: string;
  /** Exact immutable anchor. No newest/first representation selection. */
  readonly anchorRepresentationId: string;
  readonly representations: readonly SemanticRepresentation[];
  readonly minimumCosine: number;
}
function canonicalRepresentation(rep: SemanticRepresentation, graph: GovernedGraph) {
  if (rep.subject.subjectKind !== 'CANONICAL_OBJECT') throw new TypeError('M12_CANONICAL_REPRESENTATION_REQUIRED');
  const subject = rep.subject;
  const node = graph.nodes.find(n => n.canonicalObjectId === subject.canonicalObjectId);
  if (!node || node.canonicalObjectKind !== subject.canonicalObjectKind) throw new TypeError('M12_REPRESENTATION_SUBJECT_MISMATCH');
  if (!families.includes(node.canonicalObjectKind)) throw new TypeError('M12_UNSUPPORTED_VECTOR_FAMILY');
  const checked = createSemanticRepresentation(rep);
  semanticSpaceIdentity(checked);
  snapshotEndpoint(checked, graph.organisationId, node.canonicalObjectKind as SemanticComparisonFamily);
  if (!checked.vector.some(v => v !== 0)) throw new TypeError('M12_ZERO_VECTOR');
  timestamp(checked.generatedAt);
  return { checked, node };
}

/** Exact scan after tenant/authority/family/space filtering. All eligible snapshots remain distinct. */
export function retrieveCanonicalVectors(input: ExactRetrievalInput) {
  const { graph, organisationId: org } = input;
  requireGraph(graph, org); requireText(input.anchorRepresentationId);
  if (!Number.isFinite(input.minimumCosine) || input.minimumCosine < -1 || input.minimumCosine > 1) {
    throw new TypeError('M12_INVALID_COSINE_THRESHOLD');
  }
  const ids = new Set<string>();
  for (const rep of input.representations) {
    if (rep.organisationId !== org || rep.subject.organisationId !== org) throw new TypeError('M12_TENANT_MISMATCH');
    requireText(rep.representationId);
    if (ids.has(rep.representationId)) throw new TypeError('M12_DUPLICATE_REPRESENTATION');
    ids.add(rep.representationId);
  }
  const anchor = input.representations.find(rep => rep.representationId === input.anchorRepresentationId);
  if (!anchor) throw new TypeError('M12_ANCHOR_NOT_FOUND');
  const { checked: source, node: seed } = canonicalRepresentation(anchor, graph);
  if (seed.canonicalObjectId !== input.seedCanonicalObjectId) throw new TypeError('M12_ANCHOR_SEED_MISMATCH');
  const space = semanticSpaceIdentity(source), key = semanticSpaceKey(space);
  const family = seed.canonicalObjectKind as SemanticComparisonFamily;
  const neighbors: VectorContribution[] = [];
  for (const rep of input.representations) {
    // Candidates and other spaces/families cannot participate in canonical similarity.
    if (rep.subject.subjectKind !== 'CANONICAL_OBJECT') {
      if (rep.subject.subjectKind !== 'NORMALIZED_CANDIDATE') throw new TypeError('M12_UNKNOWN_SUBJECT_CLASS');
      continue;
    }
    if (rep.subject.canonicalObjectKind !== family || semanticSpaceKey(semanticSpaceIdentity(rep)) !== key) continue;
    const { checked: target, node } = canonicalRepresentation(rep, graph);
    if (node.canonicalObjectId === seed.canonicalObjectId) continue;
    const result = compareSemanticRepresentations({ organisationId: org, source, target,
      computedAt: new Date(graph.asOf).toISOString(), policy: { policyVersion: VECTOR_RETRIEVAL_POLICY,
        comparisonFamily: family, metric: 'COSINE', threshold: input.minimumCosine } });
    if (result.score < input.minimumCosine) continue;
    neighbors.push(Object.freeze({ authority: 'ANALYTICAL', subjectKind: 'CANONICAL_OBJECT', node,
      representation: representationExplanation(target, org, family), semanticSpace: result.semanticSpace,
      cosineScore: result.score, metric: 'COSINE', algorithmVersion: result.algorithmVersion }));
  }
  neighbors.sort((a, b) => b.cosineScore - a.cosineScore || compareId(a.representation.representationId, b.representation.representationId));
  return Object.freeze({ policyVersion: VECTOR_RETRIEVAL_POLICY, minimumCosine: input.minimumCosine,
    presentationOrder: 'COSINE_DESC_THEN_REPRESENTATION_ID_ASC' as const,
    anchor: representationExplanation(source, org, family), semanticSpace: space, neighbors: Object.freeze(neighbors) });
}

export interface HybridResult {
  readonly authority: 'ANALYTICAL';
  readonly subjectKind: 'CANONICAL_OBJECT';
  readonly node: GovernedNode;
  readonly contribution: 'GRAPH_ONLY' | 'VECTOR_ONLY' | 'GRAPH_AND_VECTOR';
  readonly graph: GraphContribution | null;
  readonly vector: VectorContribution | null;
}
export interface AnalyticalCopilotContext {
  readonly schemaVersion: 'GOVIA_ANALYTICAL_COPILOT_CONTEXT_V1';
  readonly organisationId: OrganisationId;
  readonly asOf: string;
  readonly authority: 'ANALYTICAL';
  readonly canonicalWriteAuthority: 'NONE';
  readonly llmAuthority: 'NONE';
  readonly presentationOrder: 'VECTOR_ORDER_THEN_GRAPH_ONLY_BFS_CANONICAL_EDGE_ID_ASC';
  readonly seed: GovernedNode;
  readonly vector: ReturnType<typeof retrieveCanonicalVectors> | null;
  readonly neighborhood: readonly GraphContribution[];
  readonly lineage: { readonly upstream: readonly GraphContribution[]; readonly downstream: readonly GraphContribution[] };
  readonly blastRadius: readonly GraphContribution[];
  readonly results: readonly HybridResult[];
  readonly limitations: readonly string[];
}
/** Read-only future Copilot input. No provider, reconciliation or canonical write port exists. */
export function buildAnalyticalContext(input: Omit<ExactRetrievalInput, 'anchorRepresentationId' | 'minimumCosine'> & {
  readonly vectorQuery: { readonly anchorRepresentationId: string; readonly minimumCosine: number } | null;
  readonly maxDepth: number;
}): AnalyticalCopilotContext {
  requireGraph(input.graph, input.organisationId);
  const seed = input.graph.nodes.find(n => n.canonicalObjectId === input.seedCanonicalObjectId);
  if (!seed) throw new TypeError('M12_SEED_NOT_CANONICAL');
  // Even graph-only calls must not silently accept foreign analytical input.
  if (!input.vectorQuery && input.representations.length) throw new TypeError('M12_VECTOR_QUERY_REQUIRED');
  const traverse = (policyVersion: Parameters<typeof traverseCanonicalGraph>[0]['policyVersion']) =>
    traverseCanonicalGraph({ ...input, policyVersion });
  const neighborhood = traverse('GOVIA_NEIGHBORHOOD_V1');
  const vector = input.vectorQuery ? retrieveCanonicalVectors({ ...input, ...input.vectorQuery }) : null;
  const results: HybridResult[] = [];
  for (const v of vector?.neighbors ?? []) {
    const graph = neighborhood.find(n => n.node.canonicalObjectId === v.node.canonicalObjectId) ?? null;
    results.push(Object.freeze({ authority: 'ANALYTICAL', subjectKind: 'CANONICAL_OBJECT', node: v.node,
      contribution: graph ? 'GRAPH_AND_VECTOR' : 'VECTOR_ONLY', graph, vector: v }));
  }
  for (const graph of neighborhood) {
    if (vector?.neighbors.some(v => v.node.canonicalObjectId === graph.node.canonicalObjectId)) continue;
    results.push(Object.freeze({ authority: 'ANALYTICAL', subjectKind: 'CANONICAL_OBJECT', node: graph.node,
      contribution: 'GRAPH_ONLY', graph, vector: null }));
  }
  return Object.freeze({ schemaVersion: 'GOVIA_ANALYTICAL_COPILOT_CONTEXT_V1', organisationId: input.organisationId,
    asOf: input.graph.asOf, authority: 'ANALYTICAL', canonicalWriteAuthority: 'NONE', llmAuthority: 'NONE', seed,
    presentationOrder: 'VECTOR_ORDER_THEN_GRAPH_ONLY_BFS_CANONICAL_EDGE_ID_ASC',
    vector, neighborhood, lineage: Object.freeze({ upstream: traverse('GOVIA_LINEAGE_UPSTREAM_V1'),
      downstream: traverse('GOVIA_LINEAGE_DOWNSTREAM_V1') }), blastRadius: traverse('GOVIA_BLAST_RADIUS_V1'),
    results: Object.freeze(results), limitations: Object.freeze([
      'EFFECTIVE_TIME_VIEW_OF_PERSISTED_ROWS_NOT_HISTORICAL_KNOWLEDGE',
      'REPRESENTATIONS_ARE_EXPLICIT_IMMUTABLE_SNAPSHOTS_NOT_CURRENT_OR_AS_OF_EMBEDDINGS',
      'ONE_SHORTEST_WITNESS_PER_NODE_MAX_DEPTH_16',
      'MISSING_RELATIONSHIPS_AND_EMPTY_RESULTS_ARE_UNKNOWN_NOT_FALSE',
      'READS_FROM_WRITES_TO_DISCOVERY_BLOCKED_WITHOUT_AGENT_VERSION_BINDING',
      'NO_GOVERNANCE_APPROVAL_OR_PREDICTION_OF_ACTUAL_RUNTIME_IMPACT',
      ...(vector ? [] : ['VECTOR_RETRIEVAL_NOT_REQUESTED']),
    ]) });
}
