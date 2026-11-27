"use client";
import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { CanonicalNodeLabel } from './CanonicalNodeLabel';
import { canonicalLayout, canonicalFocusGroup, CANONICAL_NODE_HEIGHT, CANONICAL_NODE_WIDTH, CANONICAL_READABLE_ZOOM, CANONICAL_MIN_ZOOM } from './canonical-layout';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, useReactFlow, useNodesInitialized, type Node, type NodeProps } from '@xyflow/react';
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

export function InitialGraphViewport({ groups }: { groups: ReturnType<typeof canonicalLayout>['groups'] }) {
  const searchParams = useSearchParams();
  const group = canonicalFocusGroup(groups, searchParams.get('focus'));
  const initialized = useNodesInitialized();
  const { setCenter } = useReactFlow();
  useEffect(() => {
    if (initialized && group) {
      void setCenter(group.x + group.width / 2, group.y + group.height / 2, { zoom: CANONICAL_READABLE_ZOOM });
    }
  }, [initialized, group, setCenter]);
  return null;
}

export function CanonicalGraph({ graph, sourceNames, versionParents = NO_PARENTS }: {
  graph: GovernedGraph; sourceNames?: Readonly<Record<string, string | null>>;
  versionParents?: Readonly<Record<string, string | null>>;
}) {
  const { nodes, edges, groups } = useMemo(() => {
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
    return { nodes, groups: layout.groups, edges: [
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
    <p className="mb-3 text-xs text-gray-400">Drag to explore the grid. Use the controls to zoom or fit all groups.</p>
    <div className="overflow-auto rounded-xl border border-[#3A414C] bg-[#0D1015]" style={{ height: 'max(800px, calc(100dvh - 260px))' }}
      tabIndex={0} role="region" aria-label="Canonical graph, scroll to explore">
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow colorMode="dark" nodeTypes={NODE_TYPES} nodes={nodes} edges={edges}
          fitViewOptions={{ padding: 0.02, minZoom: CANONICAL_MIN_ZOOM, maxZoom: 1 }} minZoom={CANONICAL_MIN_ZOOM}
          zoomOnScroll={false} preventScrolling={false} nodesDraggable={false} nodesConnectable={false}>
          <Suspense fallback={null}><InitialGraphViewport groups={groups} /></Suspense>
          <Background /><Controls position="top-left" />
        </ReactFlow>
      </div>
    </div>
  </div>;
}
