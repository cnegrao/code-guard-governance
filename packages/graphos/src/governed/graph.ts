import {
  CANONICAL_OBJECT_KIND, hasCanonicalRelationshipEndpoints,
  type CanonicalObjectKind, type GovernedRelationshipType, type OrganisationId,
} from '@council/canonical-contracts';

/** These scalar rows must come from canonical persistence, never Discovery or legacy topology. */
export interface CanonicalObjectRow {
  readonly organisation_id: string;
  readonly canonical_object_id: string;
  readonly kind: CanonicalObjectKind;
  readonly created_by_decision_id: string;
  readonly created_at: string;
  readonly revision: number;
}
export interface CanonicalRelationshipRow {
  readonly organisation_id: string;
  readonly relationship_id: string;
  readonly relationship_state_id: string;
  readonly relationship_type: GovernedRelationshipType;
  readonly source_canonical_object_id: string;
  readonly source_kind: CanonicalObjectKind;
  readonly target_canonical_object_id: string;
  readonly target_kind: CanonicalObjectKind;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly recorded_at: string;
  readonly revision: number;
  readonly created_by_decision_id: string;
}
export interface GovernedNode {
  readonly nodeId: string;
  readonly organisationId: OrganisationId;
  readonly canonicalObjectId: string;
  readonly canonicalObjectKind: CanonicalObjectKind;
  readonly authority: 'CANONICAL_OBJECT_PROJECTION';
  readonly createdByDecisionId: string;
  readonly createdAt: string;
  readonly revision: number;
}
export interface GovernedEdge {
  readonly organisationId: OrganisationId;
  readonly canonicalRelationshipId: string;
  readonly relationshipStateId: string;
  readonly relationshipType: GovernedRelationshipType;
  readonly source: GovernedNode;
  readonly target: GovernedNode;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly recordedAt: string;
  readonly revision: number;
  readonly createdByDecisionId: string;
  readonly authority: 'CANONICAL_RELATIONSHIP_PROJECTION';
}
export interface GovernedGraph {
  readonly organisationId: OrganisationId;
  readonly asOf: string;
  readonly authority: 'CANONICAL_READ_PROJECTION';
  readonly nodes: readonly GovernedNode[];
  readonly edges: readonly GovernedEdge[];
}
const projections = new WeakSet<GovernedGraph>();
export function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('M12_IDENTIFIER_REQUIRED');
}
export function timestamp(value: string): bigint {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value) : null;
  if (!match || !Number.isFinite(Date.parse(value))
    || new Date(`${match[1]}Z`).toISOString().slice(0, 19) !== match[1]) throw new TypeError('M12_INVALID_TIME');
  // PostgreSQL timestamptz has microsecond precision; Date.parse alone truncates it.
  return BigInt(Date.parse(`${match[1]}${match[3]}`)) * BigInt(1000)
    + BigInt((match[2] ?? '').padEnd(6, '0'));
}
export const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('M12_INVALID_REVISION');
}
export function governedNodeId(organisationId: OrganisationId, canonicalObjectId: string): string {
  requireText(organisationId); requireText(canonicalObjectId);
  return JSON.stringify(['GOVIA_CANONICAL_NODE_V1', organisationId, canonicalObjectId]);
}
export function requireGraph(graph: GovernedGraph, organisationId: OrganisationId): void {
  requireText(organisationId);
  if (!projections.has(graph) || graph.organisationId !== organisationId) throw new TypeError('M12_UNTRUSTED_GRAPH_OR_TENANT');
}

/** Effective-time view of currently persisted rows, not a historical knowledge snapshot. */
export function projectCanonicalGraph(input: {
  readonly organisationId: OrganisationId;
  readonly asOf: string;
  readonly source: 'CANONICAL_PERSISTENCE';
  readonly objects: readonly CanonicalObjectRow[];
  readonly relationships: readonly CanonicalRelationshipRow[];
}): GovernedGraph {
  const org = input.organisationId, at = timestamp(input.asOf);
  requireText(org);
  if (input.source !== 'CANONICAL_PERSISTENCE') throw new TypeError('M12_CANONICAL_SOURCE_REQUIRED');
  const allNodes = new Map<string, GovernedNode>();
  for (const row of input.objects) {
    if (row.organisation_id !== org) throw new TypeError('M12_TENANT_MISMATCH');
    if (!(Object.values(CANONICAL_OBJECT_KIND) as string[]).includes(row.kind)) throw new TypeError('M12_UNKNOWN_KIND');
    [row.canonical_object_id, row.created_by_decision_id].forEach(requireText);
    revision(row.revision); timestamp(row.created_at);
    if (allNodes.has(row.canonical_object_id)) throw new TypeError('M12_DUPLICATE_OBJECT');
    allNodes.set(row.canonical_object_id, Object.freeze({ nodeId: governedNodeId(org, row.canonical_object_id),
      organisationId: org, canonicalObjectId: row.canonical_object_id, canonicalObjectKind: row.kind,
      authority: 'CANONICAL_OBJECT_PROJECTION', createdByDecisionId: row.created_by_decision_id,
      createdAt: row.created_at, revision: row.revision }));
  }
  const edges: GovernedEdge[] = [], ids = new Set<string>();
  for (const row of input.relationships) {
    if (row.organisation_id !== org) throw new TypeError('M12_TENANT_MISMATCH');
    if (!hasCanonicalRelationshipEndpoints(row.relationship_type, row.source_kind, row.target_kind)) {
      throw new TypeError('M12_INVALID_CANONICAL_ENDPOINTS');
    }
    [row.relationship_id, row.relationship_state_id, row.created_by_decision_id].forEach(requireText);
    revision(row.revision); timestamp(row.recorded_at);
    const from = timestamp(row.valid_from), to = row.valid_to === null ? null : timestamp(row.valid_to);
    if (to !== null && to <= from) throw new TypeError('M12_INVALID_INTERVAL');
    if (ids.has(row.relationship_id)) throw new TypeError('M12_DUPLICATE_RELATIONSHIP');
    ids.add(row.relationship_id);
    const source = allNodes.get(row.source_canonical_object_id), target = allNodes.get(row.target_canonical_object_id);
    if (!source || !target || source.canonicalObjectKind !== row.source_kind || target.canonicalObjectKind !== row.target_kind) {
      throw new TypeError('M12_MISSING_OR_INVALID_ENDPOINT');
    }
    if (from > at || (to !== null && at >= to) || timestamp(source.createdAt) > at || timestamp(target.createdAt) > at) continue;
    edges.push(Object.freeze({ organisationId: org, canonicalRelationshipId: row.relationship_id,
      relationshipStateId: row.relationship_state_id, relationshipType: row.relationship_type, source, target,
      validFrom: row.valid_from, validTo: row.valid_to, recordedAt: row.recorded_at, revision: row.revision,
      createdByDecisionId: row.created_by_decision_id, authority: 'CANONICAL_RELATIONSHIP_PROJECTION' }));
  }
  const graph: GovernedGraph = Object.freeze({ organisationId: org, asOf: input.asOf,
    authority: 'CANONICAL_READ_PROJECTION',
    nodes: Object.freeze([...allNodes.values()].filter(n => timestamp(n.createdAt) <= at)
      .sort((a, b) => compareId(a.canonicalObjectId, b.canonicalObjectId))),
    edges: Object.freeze(edges.sort((a, b) => compareId(a.canonicalRelationshipId, b.canonicalRelationshipId))) });
  projections.add(graph);
  return graph;
}
