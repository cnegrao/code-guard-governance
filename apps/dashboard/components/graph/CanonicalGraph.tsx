"use client";
import { useMemo, type ReactNode } from 'react';
import { CanonicalNodeLabel } from './CanonicalNodeLabel';
import { canonicalLayout, CANONICAL_NODE_HEIGHT, CANONICAL_NODE_WIDTH } from './canonical-layout';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GovernedGraph } from '@council/graphos/governed';
import type { CanonicalObjectKind } from '@council/canonical-contracts';
import { SOURCE_NAME_LABEL } from '@/lib/governance/source-name';

type CanonicalFlowNode = Node<{ kind: CanonicalObjectKind; objectId: string; sourceName?: string | null }, 'canonical'>;
function CanonicalFlowLabel({ data }: NodeProps<CanonicalFlowNode>) {
  return <>
    <Handle type="target" position={Position.Left} />
    <div className="nowheel h-full overflow-auto p-3"><CanonicalNodeLabel kind={data.kind} objectId={data.objectId} sourceName={data.sourceName} /></div>
    <Handle type="source" position={Position.Right} />
  </>;
}
function AgentGroupLabel({ data }: NodeProps<Node<{ label: ReactNode }, 'agentGroup'>>) {
  return <>{data.label}</>;
}
const NODE_TYPES = { canonical: CanonicalFlowLabel, agentGroup: AgentGroupLabel };
const NO_PARENTS: Readonly<Record<string, string | null>> = {};
const EDGE_STYLE = {
  type: 'smoothstep', style: { stroke: '#91B5FF', strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#91B5FF' },
  labelStyle: { fill: '#F2F4F7', fontSize: 13, fontWeight: 600 },
  labelBgStyle: { fill: '#12151A', stroke: '#566173', strokeWidth: 1 },
  labelBgPadding: [10, 6] as [number, number], labelBgBorderRadius: 4,
};

export function CanonicalGraph({ graph, sourceNames, versionParents = NO_PARENTS }: {
  graph: GovernedGraph; sourceNames?: Readonly<Record<string, string | null>>;
  versionParents?: Readonly<Record<string, string | null>>;
}) {
  const { nodes, edges } = useMemo(() => {
    const layout = canonicalLayout(graph, versionParents);
    const nodes: Node[] = layout.groups.map(group => ({ id: group.id, type: 'agentGroup', zIndex: -1, position: { x: group.x, y: group.y },
      style: { width: group.width, height: group.height, background: '#101720', border: '1px solid #3A506E', borderRadius: 12 },
      data: { label: <div className="px-5 py-3 text-left text-sm text-gray-200">
        <strong>{group.agentId ? sourceNames?.[group.agentId] ?? 'AGENT' : group.label}</strong>
        {group.agentId && <span className="ml-3 text-xs text-gray-400">{SOURCE_NAME_LABEL}</span>}
      </div> }, selectable: false }));
    nodes.push(...graph.nodes.map(node => ({ id: node.nodeId, type: 'canonical', parentId: layout.positions.get(node.nodeId)!.parentId,
      position: { x: layout.positions.get(node.nodeId)!.x, y: layout.positions.get(node.nodeId)!.y },
      style: { width: CANONICAL_NODE_WIDTH, height: CANONICAL_NODE_HEIGHT, background: '#12151A', color: '#F2F4F7', border: '1px solid #566173', borderRadius: 8 },
      data: { kind: node.canonicalObjectKind, objectId: node.canonicalObjectId, sourceName: sourceNames?.[node.canonicalObjectId] },
    })));
    return { nodes, edges: [
      ...graph.edges.map(edge => ({ ...EDGE_STYLE, id: edge.canonicalRelationshipId,
        source: edge.source.nodeId, target: edge.target.nodeId, label: edge.relationshipType })),
      ...layout.associations.map(edge => ({ ...EDGE_STYLE, ...edge, label: 'Version · governed mapping',
        style: { stroke: '#8995A8', strokeDasharray: '6 4' } })),
    ] };
  }, [graph, sourceNames, versionParents]);
  if (graph.nodes.length === 0) return <p className="text-gray-400">NO_DATA: No canonical objects in this organisation. Source discovery inventory is separate.</p>;
  return <div>
    <p className="mb-2 text-sm text-gray-400">{graph.nodes.length} canonical objects · {graph.edges.length} canonical relationships</p>
    <p className="mb-3 text-xs text-gray-400">Agent → Version → Dependencies. Dashed links show version mappings; shared dependencies appear once.</p>
    <div className="overflow-hidden rounded-xl border border-[#3A414C] bg-[#0D1015]" style={{ height: 680 }}>
      <ReactFlow colorMode="dark" nodeTypes={NODE_TYPES} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.05}
        nodesDraggable={false} nodesConnectable={false}>
        <Background /><Controls />
      </ReactFlow>
    </div>
  </div>;
}
