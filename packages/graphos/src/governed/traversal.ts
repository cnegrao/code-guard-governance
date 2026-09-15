import type { GovernedRelationshipType, OrganisationId } from '@council/canonical-contracts';
import { requireGraph, type GovernedGraph, type GovernedEdge, type GovernedNode } from './graph';

export type TraversalPolicy = 'GOVIA_NEIGHBORHOOD_V1' | 'GOVIA_LINEAGE_UPSTREAM_V1'
  | 'GOVIA_LINEAGE_DOWNSTREAM_V1' | 'GOVIA_BLAST_RADIUS_V1';
export type TraversalDirection = 'STORED_FORWARD' | 'STORED_REVERSE';
export interface PathStep {
  readonly edge: GovernedEdge;
  readonly traversalDirection: TraversalDirection;
  readonly hop: number;
}
export interface GraphContribution {
  readonly node: GovernedNode;
  readonly authority: 'ANALYTICAL';
  readonly policyVersion: TraversalPolicy;
  readonly hopCount: number;
  readonly path: readonly PathStep[];
}
// A changed resource can affect its declared consumer. EXPOSES, HANDOFF_TO and
// WRITES_TO are deliberately excluded: no downstream impact rule is asserted.
const reverseDependencies: readonly GovernedRelationshipType[] = Object.freeze([
  'DERIVED_FROM', 'READS_FROM', 'USES_MODEL', 'USES_TOOL', 'USES_MCP', 'INVOKES',
  'USES_PROMPT', 'USES_KNOWLEDGE_BASE', 'USES_SKILL',
]);
function directions(policy: TraversalPolicy, type: GovernedRelationshipType): readonly TraversalDirection[] {
  switch (policy) {
    case 'GOVIA_NEIGHBORHOOD_V1': return ['STORED_FORWARD', 'STORED_REVERSE'];
    case 'GOVIA_LINEAGE_UPSTREAM_V1': return type === 'DERIVED_FROM' ? ['STORED_FORWARD'] : [];
    case 'GOVIA_LINEAGE_DOWNSTREAM_V1': return type === 'DERIVED_FROM' ? ['STORED_REVERSE'] : [];
    case 'GOVIA_BLAST_RADIUS_V1': return reverseDependencies.includes(type) ? ['STORED_REVERSE'] : [];
    default: throw new TypeError('M12_UNKNOWN_TRAVERSAL_POLICY');
  }
}
/** One deterministic shortest witness per reached node; not an exhaustive path enumeration. */
export function traverseCanonicalGraph(input: {
  readonly graph: GovernedGraph; readonly organisationId: OrganisationId;
  readonly seedCanonicalObjectId: string; readonly maxDepth: number; readonly policyVersion: TraversalPolicy;
}): readonly GraphContribution[] {
  const { graph, organisationId, seedCanonicalObjectId: seed, maxDepth, policyVersion } = input;
  requireGraph(graph, organisationId);
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 16) throw new TypeError('M12_INVALID_DEPTH');
  directions(policyVersion, 'DERIVED_FROM');
  if (!graph.nodes.some(n => n.canonicalObjectId === seed)) throw new TypeError('M12_SEED_NOT_CANONICAL');
  const queue: { id: string; path: readonly PathStep[] }[] = [{ id: seed, path: [] }];
  const visited = new Set([seed]), results: GraphContribution[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.path.length >= maxDepth) continue;
    for (const edge of graph.edges) {
      for (const direction of directions(policyVersion, edge.relationshipType)) {
        const from = direction === 'STORED_FORWARD' ? edge.source : edge.target;
        const to = direction === 'STORED_FORWARD' ? edge.target : edge.source;
        if (from.canonicalObjectId !== current.id || visited.has(to.canonicalObjectId)) continue;
        const path = Object.freeze([...current.path, Object.freeze({ edge, traversalDirection: direction, hop: current.path.length + 1 })]);
        visited.add(to.canonicalObjectId);
        queue.push({ id: to.canonicalObjectId, path });
        results.push(Object.freeze({ node: to, authority: 'ANALYTICAL', policyVersion, hopCount: path.length, path }));
      }
    }
  }
  return Object.freeze(results);
}
