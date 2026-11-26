"use client";
import { useMemo } from 'react';
import { CanonicalNodeLabel } from './CanonicalNodeLabel';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type { GovernedGraph } from '@council/graphos/governed';

export function CanonicalGraph({ graph, sourceNames }: { graph: GovernedGraph; sourceNames?: Readonly<Record<string, string | null>> }) {
  const { nodes, edges } = useMemo(() => {
    const layout = new dagre.graphlib.Graph();
    layout.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
    layout.setDefaultEdgeLabel(() => ({}));
    graph.nodes.forEach(node => layout.setNode(node.nodeId, { width: 300, height: 170 }));
    graph.edges.forEach(edge => layout.setEdge(edge.source.nodeId, edge.target.nodeId));
    dagre.layout(layout);
    return {
      nodes: graph.nodes.map(node => ({ id: node.nodeId,
        position: { x: layout.node(node.nodeId).x - 150, y: layout.node(node.nodeId).y - 85 },
        style: { width: 300, background: '#12151A', color: '#F2F4F7', border: '1px solid #3A414C', borderRadius: 8, textAlign: 'left' as const },
        data: { label: <CanonicalNodeLabel kind={node.canonicalObjectKind} objectId={node.canonicalObjectId} sourceName={sourceNames?.[node.canonicalObjectId]} /> },
      })),
      edges: graph.edges.map(edge => ({ id: edge.canonicalRelationshipId,
        source: edge.source.nodeId, target: edge.target.nodeId, label: edge.relationshipType })),
    };
  }, [graph, sourceNames]);
  if (nodes.length === 0) return <p className="text-gray-400">NO_DATA: No canonical objects in this organisation. Source discovery inventory is separate.</p>;
  return <div>
    <p className="text-sm text-gray-400 mb-2">{nodes.length} canonical objects · {edges.length} canonical relationships</p>
    <div className="overflow-hidden rounded-xl border border-[#3A414C] bg-[#0D1015]" style={{ height: 600 }}><ReactFlow colorMode="dark" nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
      <Background /><Controls />
    </ReactFlow></div>
  </div>;
}
