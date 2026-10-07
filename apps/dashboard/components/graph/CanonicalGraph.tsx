"use client";
import { useMemo } from 'react';
import Link from 'next/link';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type { GovernedGraph } from '@council/graphos/governed';

export function CanonicalGraph({ graph }: { graph: GovernedGraph }) {
  const { nodes, edges } = useMemo(() => {
    const layout = new dagre.graphlib.Graph();
    layout.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
    layout.setDefaultEdgeLabel(() => ({}));
    graph.nodes.forEach(node => layout.setNode(node.nodeId, { width: 260, height: 100 }));
    graph.edges.forEach(edge => layout.setEdge(edge.source.nodeId, edge.target.nodeId));
    dagre.layout(layout);
    return {
      nodes: graph.nodes.map(node => ({ id: node.nodeId,
        position: { x: layout.node(node.nodeId).x - 130, y: layout.node(node.nodeId).y - 50 },
        style: { width: 260 },
        data: { label: <div><strong>{node.canonicalObjectKind}</strong><div className="break-all text-xs">{node.canonicalObjectId}</div>
          {node.canonicalObjectKind === 'AGENT' && <Link href={`/agents/canonical/${encodeURIComponent(node.canonicalObjectId)}`}>Open Passport</Link>}</div> },
      })),
      edges: graph.edges.map(edge => ({ id: edge.canonicalRelationshipId,
        source: edge.source.nodeId, target: edge.target.nodeId, label: edge.relationshipType })),
    };
  }, [graph]);
  if (nodes.length === 0) return <p className="text-gray-400">NO_DATA: No canonical objects in this organisation. Source discovery inventory is separate.</p>;
  return <div>
    <p className="text-sm text-gray-400 mb-2">{nodes.length} canonical objects · {edges.length} canonical relationships</p>
    <div style={{ height: 600 }}><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
      <Background /><Controls />
    </ReactFlow></div>
  </div>;
}
