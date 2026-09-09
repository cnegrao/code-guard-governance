import { semanticRepresentationSubjectKey, type OrganisationId,
  type SemanticRepresentationSubjectReference } from '@council/canonical-contracts';
import { analyticalHash, candidateIdentity, COSINE_ALGORITHM_VERSION, endpointKey, policyKey,
  semanticSpaceIdentity, semanticSpaceKey, snapshotEndpoint, snapshotPolicy, validateComputedAt,
  requireText, type PossibleMatchCandidate, type SemanticComparisonFamily,
  type SemanticSpaceIdentity, type SimilarityPolicy } from './similarity';

export interface PossibleMatchCluster {
  readonly clusterId: string;
  readonly organisationId: OrganisationId;
  readonly comparisonFamily: SemanticComparisonFamily;
  readonly semanticSpace: SemanticSpaceIdentity;
  readonly policy: SimilarityPolicy;
  readonly algorithmVersion: 'GOVIA_L8_CONNECTED_COMPONENTS_V1';
  readonly status: 'ANALYTICAL';
  readonly members: readonly SemanticRepresentationSubjectReference[];
  readonly candidateIds: readonly string[];
  readonly computedAt: string;
}

export interface ClusterPossibleMatchesInput {
  readonly organisationId: OrganisationId;
  readonly semanticSpace: SemanticSpaceIdentity;
  readonly policy: SimilarityPolicy;
  readonly candidates: readonly PossibleMatchCandidate[];
  readonly computedAt: string;
}

/**
 * Connected components of threshold-eligible edges, never merge sets or all-pairs similarity claims.
 * Inputs are outputs of the trusted domain engine, not untrusted client attestations.
 * Validation checks consistency; it cannot recompute cosine without the L7 vectors.
 */
export function clusterPossibleMatches(input: ClusterPossibleMatchesInput): readonly PossibleMatchCluster[] {
  requireText(input.organisationId);
  validateComputedAt(input.computedAt);
  const policy = snapshotPolicy(input.policy);
  const space = semanticSpaceIdentity({ projectionSchemaVersion: input.semanticSpace.projectionSchemaVersion,
    embeddingProvider: input.semanticSpace });
  const adjacency = new Map<string, Set<string>>();
  const subjects = new Map<string, SemanticRepresentationSubjectReference>();
  const edges = new Map<string, readonly [string, string]>();
  const scores = new Map<string, number>();
  const representationSubjects = new Map<string, string>();
  // Validate the complete batch before deriving any output; never silently drop incompatible edges.
  for (const candidate of input.candidates) {
    if (candidate.organisationId !== input.organisationId) throw new TypeError('L8_TENANT_MISMATCH');
    if (semanticSpaceKey(candidate.semanticSpace) !== semanticSpaceKey(space)) throw new TypeError('L8_INCOMPATIBLE_SEMANTIC_SPACE');
    if (policyKey(candidate.policy) !== policyKey(policy)
      || candidate.comparisonFamily !== policy.comparisonFamily) throw new TypeError('L8_CLUSTER_POLICY_MISMATCH');
    if (candidate.status !== 'ANALYTICAL' || candidate.metric !== 'COSINE'
      || candidate.algorithmVersion !== COSINE_ALGORITHM_VERSION
      || candidate.eligibility !== 'SAME_TENANT_SPACE_AND_ENTITY_FAMILY'
      || !Number.isFinite(candidate.score) || candidate.score < policy.threshold || candidate.score > 1) {
      throw new TypeError('L8_INVALID_ANALYTICAL_EDGE');
    }
    validateComputedAt(candidate.computedAt);
    const left = snapshotEndpoint(candidate.left, input.organisationId, policy.comparisonFamily);
    const right = snapshotEndpoint(candidate.right, input.organisationId, policy.comparisonFamily);
    const a = semanticRepresentationSubjectKey(left.subject), b = semanticRepresentationSubjectKey(right.subject);
    if (a === b || left.representationId === right.representationId) throw new TypeError('L8_SELF_MATCH_EXCLUDED');
    if (endpointKey(left) >= endpointKey(right) || candidateIdentity(candidate) !== candidate.candidateId) {
      throw new TypeError('L8_INVALID_PAIR_IDENTITY');
    }
    if (scores.has(candidate.candidateId) && scores.get(candidate.candidateId) !== candidate.score) {
      throw new TypeError('L8_CONFLICTING_EDGE_REPLAY');
    }
    scores.set(candidate.candidateId, candidate.score);
    for (const endpoint of [left, right]) {
      const subjectKey = semanticRepresentationSubjectKey(endpoint.subject);
      const existing = representationSubjects.get(endpoint.representationId);
      if (existing !== undefined && existing !== subjectKey) throw new TypeError('L8_REPRESENTATION_SUBJECT_CONFLICT');
      representationSubjects.set(endpoint.representationId, subjectKey);
    }
    subjects.set(a, left.subject); subjects.set(b, right.subject);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b); adjacency.get(b)!.add(a);
    edges.set(candidate.candidateId, [a, b]);
  }
  const seen = new Set<string>();
  const clusters: PossibleMatchCluster[] = [];
  for (const start of [...subjects.keys()].sort()) {
    if (seen.has(start)) continue;
    const pending = [start], members: string[] = [];
    seen.add(start);
    while (pending.length) {
      const key = pending.pop()!;
      members.push(key);
      for (const neighbor of adjacency.get(key)!) {
        if (!seen.has(neighbor)) { seen.add(neighbor); pending.push(neighbor); }
      }
    }
    members.sort();
    const memberSet = new Set(members);
    const candidateIds = [...edges].filter(([, [a]]) => memberSet.has(a)).map(([id]) => id).sort();
    clusters.push(Object.freeze({
      clusterId: analyticalHash('GOVIA_L8_CONNECTED_COMPONENTS_V1', [input.organisationId,
        policy.comparisonFamily, semanticSpaceKey(space), policyKey(policy), members]),
      organisationId: input.organisationId, comparisonFamily: policy.comparisonFamily,
      semanticSpace: space, policy, algorithmVersion: 'GOVIA_L8_CONNECTED_COMPONENTS_V1',
      status: 'ANALYTICAL', members: Object.freeze(members.map(key => subjects.get(key)!)),
      candidateIds: Object.freeze(candidateIds), computedAt: input.computedAt,
    }));
  }
  return Object.freeze(clusters.sort((a, b) => a.clusterId < b.clusterId ? -1 : 1));
}
