import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GovernedGraph } from '@council/graphos/governed';
import { canonicalLayout, canonicalFocusGroup, CANONICAL_NODE_WIDTH, CANONICAL_NODE_HEIGHT, GROUP_PADDING, GROUP_HEADER_HEIGHT } from '../components/graph/canonical-layout';

test('canonical relationships rank groups independently of input order and version mapping links', () => {
  const nodes = [['repo', 'AGENT'], ['triagem', 'AGENT'], ['v1', 'AGENT_VERSION'], ['v2', 'AGENT_VERSION'], ['v3', 'AGENT_VERSION'], ['tool', 'TOOL'], ['model', 'MODEL'], ['shared', 'PROMPT'], ['orphan', 'API']]
    .map(([id, kind]) => ({ nodeId: `node:${id}`, canonicalObjectId: `object:${id}`, canonicalObjectKind: kind }));
  const edges = [['v1', 'tool'], ['v1', 'model'], ['v1', 'shared'], ['v2', 'shared'], ['tool', 'model']]
    .map(([source, target], i) => ({ canonicalRelationshipId: `r:${i}`, source: { nodeId: `node:${source}` }, target: { nodeId: `node:${target}` } }));
  const graph = { nodes, edges } as unknown as GovernedGraph;
  const parents = { 'object:v1': 'object:triagem', 'object:v2': 'object:repo', 'object:v3': 'object:repo' };
  const layout = canonicalLayout(graph, parents);
  assert.equal(layout.groups[0].agentId, 'object:triagem');
  assert.equal(layout.groups[0].relationshipCount, 4, 'mapping associations are excluded; internal edges count once');
  assert.deepEqual(layout.groups.map(g => g.relationshipCount), [4, 2, 1, 0]);
  assert.deepEqual(canonicalLayout({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, parents).groups, layout.groups);
  assert.equal(canonicalFocusGroup(layout.groups, 'object:repo')?.agentId, 'object:repo');
  assert.equal(canonicalFocusGroup(layout.groups, 'node:repo'), layout.groups[0], 'URL uses canonical object identity');
  assert.equal(canonicalFocusGroup(layout.groups, null), layout.groups[0]);
  assert.equal(canonicalFocusGroup([], 'missing'), undefined);
  for (const group of layout.groups) {
    const members = [...layout.positions.values()].filter(p => p.parentId === group.id);
    assert.equal(Math.min(...members.map(p => p.x)), GROUP_PADDING);
    assert.equal(Math.min(...members.map(p => p.y)), GROUP_HEADER_HEIGHT + GROUP_PADDING);
    assert.equal(group.width - Math.max(...members.map(p => p.x + CANONICAL_NODE_WIDTH)), GROUP_PADDING);
    assert.equal(group.height - Math.max(...members.map(p => p.y + CANONICAL_NODE_HEIGHT)), GROUP_PADDING);
  }
  const shared = layout.groups.find(g => g.id === 'agent-group:shared')!;
  assert.equal(shared.width, CANONICAL_NODE_WIDTH + 2 * GROUP_PADDING);
  for (let i = 0; i < layout.groups.length; i++) for (const b of layout.groups.slice(i + 1)) {
    const a = layout.groups[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});

test('equal relevance uses stable group identity and an empty graph has no bounds', () => {
  const graph = { nodes: ['b', 'a'].map(id => ({ nodeId: id, canonicalObjectId: id, canonicalObjectKind: 'AGENT' })), edges: [] } as unknown as GovernedGraph;
  const layout = canonicalLayout(graph, {});
  assert.deepEqual(layout.groups.map(g => g.agentId), ['a', 'b']);
  assert.ok(layout.groups.every(g => g.width === CANONICAL_NODE_WIDTH + 2 * GROUP_PADDING));
  assert.deepEqual(canonicalLayout({ ...graph, nodes: [] }, {}), { groups: [], positions: new Map(), associations: [], width: 0, height: 0 });
});
