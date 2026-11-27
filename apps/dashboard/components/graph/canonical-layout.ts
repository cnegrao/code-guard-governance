import dagre from 'dagre';
import type { GovernedGraph } from '@council/graphos/governed';

export const CANONICAL_NODE_WIDTH = 320;
export const CANONICAL_NODE_HEIGHT = 210;
export const CANONICAL_READABLE_ZOOM = 0.85;
export const CANONICAL_MIN_ZOOM = 0.2;
export const GROUP_PADDING = 24;
export const GROUP_HEADER_HEIGHT = 48;

/** Layout only. Parent mappings never enter GovernedGraph's relationship set. */
export function canonicalLayout(graph: GovernedGraph, versionParents: Readonly<Record<string, string | null>>) {
  const byObject = new Map(graph.nodes.map(n => [n.canonicalObjectId, n]));
  const byNode = new Map(graph.nodes.map(n => [n.nodeId, n]));
  const agents = graph.nodes.filter(n => n.canonicalObjectKind === 'AGENT').toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
  const owners = new Map(graph.nodes.map(n => [n.nodeId, new Set<string>()]));
  const associations: { id: string; source: string; target: string }[] = [];
  for (const agent of agents) owners.get(agent.nodeId)!.add(agent.nodeId);
  for (const version of graph.nodes.filter(n => n.canonicalObjectKind === 'AGENT_VERSION')) {
    const agent = byObject.get(versionParents[version.canonicalObjectId] ?? '');
    if (agent?.canonicalObjectKind !== 'AGENT') continue;
    owners.get(version.nodeId)!.add(agent.nodeId);
    associations.push({ id: `version-association:${version.nodeId}`, source: agent.nodeId, target: version.nodeId });
  }
  // A dependency used by several agents is rendered once in a shared group.
  for (const edge of graph.edges) {
    const source = byNode.get(edge.source.nodeId);
    const target = byNode.get(edge.target.nodeId);
    if (source?.canonicalObjectKind !== 'AGENT_VERSION' || !target || ['AGENT', 'AGENT_VERSION'].includes(target.canonicalObjectKind)) continue;
    for (const owner of owners.get(source.nodeId)!) owners.get(target.nodeId)!.add(owner);
  }
  const bucket = (id: string) => {
    const own = owners.get(id)!;
    return own.size === 1 ? [...own][0] : own.size > 1 ? 'shared' : 'other';
  };
  const relationshipCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    // Count each incident canonical relationship once per group, including shared dependencies.
    for (const key of new Set([bucket(edge.source.nodeId), bucket(edge.target.nodeId)])) {
      relationshipCounts.set(key, (relationshipCounts.get(key) ?? 0) + 1);
    }
  }
  const groups: { id: string; agentId?: string; label: string; relationshipCount: number; x: number; y: number; width: number; height: number }[] = [];
  const positions = new Map<string, { x: number; y: number; parentId: string }>();
  for (const key of [...agents.map(n => n.nodeId), 'shared', 'other']) {
    const members = graph.nodes.filter(n => bucket(n.nodeId) === key).toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
    if (!members.length) continue;
    const ids = new Set(members.map(n => n.nodeId));
    const layout = new dagre.graphlib.Graph();
    layout.setGraph({ rankdir: 'LR', nodesep: 64, ranksep: 170 });
    layout.setDefaultEdgeLabel(() => ({}));
    for (const node of members) layout.setNode(node.nodeId, { width: CANONICAL_NODE_WIDTH, height: CANONICAL_NODE_HEIGHT });
    for (const edge of [...graph.edges.map(e => ({ source: e.source.nodeId, target: e.target.nodeId })), ...associations]) {
      if (ids.has(edge.source) && ids.has(edge.target)) layout.setEdge(edge.source, edge.target);
    }
    dagre.layout(layout);
    const groupId = `agent-group:${key}`;
    // Fixed columns preserve the three layers even for isolated canonical objects.
    for (const node of members) positions.set(node.nodeId, {
      x: node.canonicalObjectKind === 'AGENT' ? 32 : node.canonicalObjectKind === 'AGENT_VERSION' ? 522 : 1012,
      y: 72 + layout.node(node.nodeId).y - CANONICAL_NODE_HEIGHT / 2, parentId: groupId,
    });
    // Different dagre ranks can collapse into the dependency column (e.g. MCP → TOOL).
    // Keep those cards disjoint after enforcing the canonical type columns.
    for (const x of [32, 522, 1012]) {
      let bottom = 72;
      for (const node of members.filter(n => positions.get(n.nodeId)!.x === x)
        .toSorted((a, b) => positions.get(a.nodeId)!.y - positions.get(b.nodeId)!.y)) {
        const position = positions.get(node.nodeId)!;
        position.y = Math.max(position.y, bottom);
        bottom = position.y + CANONICAL_NODE_HEIGHT + 64;
      }
    }
    // Trim unused ranks and empty columns while retaining Agent → Version → Dependencies.
    const columns = [...new Set(members.map(n => positions.get(n.nodeId)!.x))].sort((a, b) => a - b);
    const top = Math.min(...members.map(n => positions.get(n.nodeId)!.y));
    for (const node of members) {
      const position = positions.get(node.nodeId)!;
      position.x = GROUP_PADDING + columns.indexOf(position.x) * 490;
      position.y += GROUP_HEADER_HEIGHT + GROUP_PADDING - top;
    }
    const width = Math.max(...members.map(n => positions.get(n.nodeId)!.x + CANONICAL_NODE_WIDTH)) + GROUP_PADDING;
    const height = Math.max(...members.map(n => positions.get(n.nodeId)!.y + CANONICAL_NODE_HEIGHT)) + GROUP_PADDING;
    groups.push({ id: groupId, agentId: agents.find(a => a.nodeId === key)?.canonicalObjectId,
      label: key === 'shared' ? 'Shared dependencies' : key === 'other' ? 'Other canonical objects' : 'Agent',
      relationshipCount: relationshipCounts.get(key) ?? 0, x: 0, y: 0, width, height });
  }
  groups.sort((a, b) => b.relationshipCount - a.relationshipCount || a.id.localeCompare(b.id));
  const columns = Math.ceil(Math.sqrt(groups.length));
  let top = 0;
  for (let start = 0; start < groups.length; start += columns) {
    const row = groups.slice(start, start + columns);
    let left = 0;
    for (const group of row) {
      group.x = left; group.y = top;
      left += group.width + 72;
    }
    top += Math.max(...row.map(group => group.height)) + 72;
  }
  const width = Math.max(0, ...groups.map(group => group.x + group.width));
  const height = Math.max(0, ...groups.map(group => group.y + group.height));
  return { groups, positions, associations, width, height };
}

export function canonicalFocusGroup(groups: ReturnType<typeof canonicalLayout>['groups'], objectId: string | null) {
  return groups.find(group => group.agentId === objectId) ?? groups[0];
}
