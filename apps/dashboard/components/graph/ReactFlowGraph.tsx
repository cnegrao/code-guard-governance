"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useNodesState, useEdgesState,
  type Node, type Edge, MarkerType, Panel, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

interface AgentGraphNode {
  agent_id: string; agent_code: string; name: string; agent_type: string;
  risk_level: string; oversight_level: string; status: string;
  deployment_env: string; model_name: string | null;
  ai_system_id?: string | null;
  business_domain?: string;
  enrichment?: {
    trustZone?: string;
    governancePriority?: string;
    complianceExposure?: string;
    aiActExposure?: string;
    doraExposure?: boolean;
    containsPii?: boolean;
    containsFinancial?: boolean;
    containsHealth?: boolean;
    lineageRiskLevel?: string;
    costEstimate?: number;
    costRisk?: string;
    fapiCompliant?: boolean;
    financialServices?: boolean;
  };
}

interface DiscoveryGraphNode {
  id: string; nodeType: string; label: string; layer: number;
  metadata: Record<string, unknown>;
}

type UnifiedGraphNode = AgentGraphNode | DiscoveryGraphNode;

interface UnifiedGraphEdge {
  id: string; source: string; target: string;
  type: string; metadata: Record<string, unknown>;
}

function isAgentNode(n: UnifiedGraphNode): n is AgentGraphNode {
  return "agent_id" in n;
}

interface PropagationPath {
  propagation_id: string; affected_agent_id: string; propagation_type: string;
  propagation_depth: number; impact_score: number; criticality: string;
  financial_impact_eur: number;
}

const riskColors: Record<string, string> = { critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#10b981" };
const riskBgColors: Record<string, string> = { critical: "rgba(239,68,68,0.15)", high: "rgba(249,115,22,0.15)", medium: "rgba(245,158,11,0.15)", low: "rgba(16,185,129,0.15)" };
const discoveryColors: Record<string, string> = {
  repository: "#6366f1", domain: "#3b82f6", service: "#10b981", module: "#6b7280",
  dependency: "#f59e0b", entrypoint: "#14b8a6", ai_system: "#ec4899",
  incident: "#ef4444", third_party: "#f97316", finding: "#dc2626",
  regulation: "#8b5cf6", evidence: "#06b6d4", control: "#eab308",
};
const discoveryBgColors: Record<string, string> = {
  repository: "rgba(99,102,241,0.12)", domain: "rgba(59,130,246,0.12)", service: "rgba(16,185,129,0.12)",
  module: "rgba(107,114,128,0.12)", dependency: "rgba(245,158,11,0.12)", entrypoint: "rgba(20,184,166,0.12)",
  agent: "rgba(16,185,129,0.15)", ai_system: "rgba(236,72,153,0.12)",
  incident: "rgba(239,68,68,0.15)", third_party: "rgba(249,115,22,0.12)", finding: "rgba(220,38,38,0.15)",
  regulation: "rgba(139,92,246,0.12)", evidence: "rgba(6,182,212,0.12)", control: "rgba(234,179,8,0.12)",
};
const discoveryShapes: Record<string, string> = {
  repository: "50%", domain: "12px", service: "12px", module: "3px",
  dependency: "3px", entrypoint: "50%", ai_system: "12px",
  incident: "3px", third_party: "3px", finding: "8px",
  regulation: "50%", evidence: "3px", control: "3px",
};
const edgeLabels: Record<string, string> = { CALLS_AGENT: "calls", DELEGATES_TO: "delegates", SUPERVISES: "supervises", DEPENDS_ON: "depends", ESCALATES_TO: "escalates", ORCHESTRATES: "orchestrates", FALLBACK_TO: "fallback", PEER_COORDINATES: "coordinates", contains: "contains", belongs_to: "belongs to", processes: "processes", depends_on: "depends", exposes: "exposes" };

function dagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  for (const n of nodes) { g.setNode(n.id, { width: 180, height: 60 }); }
  for (const e of edges) { g.setEdge(e.source, e.target); }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 90, y: pos.y - 30 } };
  });
}

function buildNodes(list: UnifiedGraphNode[], highlight?: string, cluster?: string): Node[] {
  const ns = list.map((n) => {
    if (isAgentNode(n)) {
      const enrichment = n.enrichment;
      let borderColor = riskColors[n.risk_level] ?? riskColors.medium;
      if (enrichment?.complianceExposure === "critical") borderColor = "#ef4444";
      else if (enrichment?.complianceExposure === "high") borderColor = "#f97316";
      else if (enrichment?.governancePriority === "critical") borderColor = "#ef4444";

      return {
        id: n.agent_id,
        data: {
          label: n.name,
          code: n.agent_code,
          type: n.agent_type,
          risk: n.risk_level,
          status: n.status,
          nodeType: "agent",
          trustZone: enrichment?.trustZone,
          governancePriority: enrichment?.governancePriority,
          complianceExposure: enrichment?.complianceExposure,
          containsPii: enrichment?.containsPii,
          containsFinancial: enrichment?.containsFinancial,
          doraExposure: enrichment?.doraExposure,
          costEstimate: enrichment?.costEstimate,
        },
        position: { x: 0, y: 0 },
        style: {
          background: riskBgColors[n.risk_level] ?? riskBgColors.medium,
          border: `2px solid ${borderColor}`,
          borderRadius: "8px", padding: "10px 16px", color: "#fff", fontSize: "12px", width: 180,
        },
        ...(n.agent_id === highlight ? { boxShadow: "0 0 14px rgba(19,55,236,0.6)" } : {}),
        ...(cluster && n.ai_system_id !== cluster ? { opacity: 0.3 } : {}),
      };
    }

    const disc = n as DiscoveryGraphNode;
    const color = discoveryColors[disc.nodeType] ?? "#6b7280";
    const bg = discoveryBgColors[disc.nodeType] ?? "rgba(107,114,128,0.12)";

    return {
      id: disc.id,
      data: {
        label: disc.label,
        nodeType: disc.nodeType,
        layer: disc.layer,
        metadata: disc.metadata,
      },
      position: { x: 0, y: 0 },
      style: {
        background: bg,
        border: `2px solid ${color}`,
        borderRadius: discoveryShapes[disc.nodeType] ?? "8px",
        padding: "8px 14px", color: color, fontSize: "11px", width: 160,
      },
    };
  });
  return dagreLayout(ns, []);
}

function buildEdges(list: UnifiedGraphEdge[]): Edge[] {
  return list.map((e) => {
    const pii = (e.metadata?.carries_pii as boolean) ?? false;
    const discoveryType = ["contains", "belongs_to", "processes", "depends_on", "exposes"].includes(e.type);
    return {
      id: e.id || `${e.source}-${e.target}-${e.type}`,
      source: e.source, target: e.target,
      label: edgeLabels[e.type] ?? e.type,
      type: "smoothstep", animated: pii,
      style: {
        stroke: pii ? "#ef4444" : discoveryType ? "rgba(107,114,128,0.4)" : "#4b5563",
        strokeWidth: pii ? 2 : 1,
        strokeDasharray: discoveryType ? "5,5" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: pii ? "#ef4444" : discoveryType ? "rgba(107,114,128,0.4)" : "#4b5563", width: 12, height: 12 },
      labelStyle: { fill: "#9ca3af", fontSize: 9 },
      labelBgStyle: { fill: "#111111", fillOpacity: 0.8 },
    };
  });
}

export default function ReactFlowGraph() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

function GraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [allNodes, setAllNodes] = useState<UnifiedGraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<UnifiedGraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<UnifiedGraphNode | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [discCount, setDiscCount] = useState(0);
  const [propagation, setPropagation] = useState<PropagationPath[]>([]);
  const [mode, setMode] = useState<"estate" | "dependency" | "risk" | "compliance">("estate");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [cluster, setCluster] = useState("");
  const { fitView } = useReactFlow();
  const [scaleWarning, setScaleWarning] = useState(false);

  useEffect(() => {
    fetch("/api/graph/estate")
      .then((r) => r.json())
      .then((data) => {
        const ns: UnifiedGraphNode[] = data.nodes ?? [];
        const es: UnifiedGraphEdge[] = data.edges ?? [];
        setAllNodes(ns);
        setAllEdges(es);
        setAgentCount(data.agentCount ?? ns.filter(isAgentNode).length);
        setDiscCount(data.discoveryCount ?? ns.length - ns.filter(isAgentNode).length);
        if (ns.length > 300) setScaleWarning(true);
        applyFilters(ns, es, "", "", "", "", "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function applyFilters(ns: UnifiedGraphNode[], es: UnifiedGraphEdge[], risk: string, type: string, status: string, clusterId: string, searchTerm: string) {
    let filtered = ns;
    if (risk) filtered = filtered.filter((n) => isAgentNode(n) && n.risk_level === risk);
    if (type) filtered = filtered.filter((n) => isAgentNode(n) && n.agent_type === type);
    if (status) filtered = filtered.filter((n) => isAgentNode(n) && n.status === status);
    if (clusterId) filtered = filtered.filter((n) => isAgentNode(n) && n.ai_system_id === clusterId);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter((n) => {
        if (isAgentNode(n)) return n.name.toLowerCase().includes(q) || n.agent_code.toLowerCase().includes(q);
        return n.label.toLowerCase().includes(q);
      });
    }
    const ids = new Set(filtered.map((n) => isAgentNode(n) ? n.agent_id : n.id));
    const filteredEdges = es.filter((e) => ids.has(e.source) && ids.has(e.target));
    const highlightId = searchTerm && filtered.length > 0 && isAgentNode(filtered[0]) ? filtered[0].agent_id : undefined;
    const layoutNodes = buildNodes(filtered, highlightId, clusterId || undefined);
    setNodes(layoutNodes);
    setEdges(buildEdges(filteredEdges));
    setTimeout(() => fitView({ duration: 300 }), 100);
  }

  const onNodeClick = useCallback(async (_event: React.MouseEvent, node: Node) => {
    const n = allNodes.find((a) => (isAgentNode(a) ? a.agent_id : a.id) === node.id);
    setSelectedNode(n ?? null);
    if (!n || !isAgentNode(n)) {
      setPropagation([]);
      return;
    }
    if (mode === "dependency") {
      try {
        const res = await fetch(`/api/graph/node/${n.agent_id}`);
        const data = await res.json();
        const trav = (data.traversal ?? []) as Array<{ agent_id: string }>;
        const ids = new Set(trav.map((t) => t.agent_id));
        const filtered = allNodes.filter((a) => isAgentNode(a) && ids.has(a.agent_id));
        const fedges = allEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
        setNodes(buildNodes(filtered, n.agent_id));
        setEdges(buildEdges(fedges));
        setTimeout(() => fitView({ duration: 300 }), 100);
      } catch {}
    }
    if (mode === "compliance") {
      const agentId = n.agent_id;
      const connectedIds = new Set<string>([agentId]);
      for (const e of allEdges) {
        if (e.source === agentId || e.target === agentId) {
          connectedIds.add(e.source);
          connectedIds.add(e.target);
        }
      }
      const filtered = allNodes.filter((nd) => {
        if (isAgentNode(nd)) return connectedIds.has(nd.agent_id);
        return connectedIds.has(nd.id);
      });
      const fedges = allEdges.filter((e) => connectedIds.has(e.source) && connectedIds.has(e.target));
      setNodes(buildNodes(filtered, agentId));
      setEdges(buildEdges(fedges));
      setTimeout(() => fitView({ duration: 300 }), 100);
    }
    if (mode === "risk") {
      try {
        const res = await fetch(`/api/graph/risk/${n.agent_id}`);
        const data = await res.json();
        setPropagation(data.paths ?? []);
      } catch {}
    }
  }, [mode, allNodes, allEdges, fitView]);

  function resetView() {
    applyFilters(allNodes, allEdges, filterRisk, filterType, filterStatus, cluster, search);
    setSelectedNode(null);
    setPropagation([]);
  }

  const systemClusters = useMemo(() => {
    const ids = new Set(allNodes.filter(isAgentNode).map((n) => n.ai_system_id).filter(Boolean));
    return Array.from(ids).map((id) => ({ id: id as string, label: `System ${(id as string).slice(0, 8)}` }));
  }, [allNodes]);

  const riskOptions = [{ value: "", label: "All risks" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
  const typeOptions = [{ value: "", label: "All types" }, { value: "autonomous", label: "Autonomous" }, { value: "assistive", label: "Assistive" }, { value: "supervisory", label: "Supervisory" }, { value: "gateway", label: "Gateway" }, { value: "orchestrator", label: "Orchestrator" }, { value: "retrieval", label: "Retrieval" }, { value: "classifier", label: "Classifier" }];
  const statusOptions = [{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "registered", label: "Registered" }, { value: "suspended", label: "Suspended" }, { value: "under_review", label: "Under Review" }];

  if (loading) return <Spinner className="py-12" />;
  if (error) return <div className="text-center py-12"><p className="text-danger mb-2">{error}</p><Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button></div>;

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)]">
      <div className="flex-1 rounded-xl overflow-hidden border border-border-dark flex flex-col">
        <div className="flex gap-2 p-2 bg-surface-dark/80 border-b border-border-dark flex-wrap">
          <Input placeholder="Search agent..." value={search} onChange={(e) => { setSearch(e.target.value); applyFilters(allNodes, allEdges, filterRisk, filterType, filterStatus, cluster, e.target.value); }} className="max-w-[180px] text-xs h-8" />
          <Select options={riskOptions} value={filterRisk} onChange={(e) => { setFilterRisk(e.target.value); applyFilters(allNodes, allEdges, e.target.value, filterType, filterStatus, cluster, search); }} className="max-w-[120px] text-xs h-8" />
          <Select options={typeOptions} value={filterType} onChange={(e) => { setFilterType(e.target.value); applyFilters(allNodes, allEdges, filterRisk, e.target.value, filterStatus, cluster, search); }} className="max-w-[130px] text-xs h-8" />
          <Select options={statusOptions} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); applyFilters(allNodes, allEdges, filterRisk, filterType, e.target.value, cluster, search); }} className="max-w-[140px] text-xs h-8" />
          {systemClusters.length > 0 && (
            <Select options={[{ value: "", label: "All systems" }, ...systemClusters.map((s) => ({ value: s.id, label: s.label }))]} value={cluster} onChange={(e) => { setCluster(e.target.value); applyFilters(allNodes, allEdges, filterRisk, filterType, filterStatus, e.target.value, search); }} className="max-w-[150px] text-xs h-8" />
          )}
          <span className="text-xs text-gray-500 self-center ml-auto">{nodes.length} nodes</span>
        </div>
        {scaleWarning && (
          <div className="px-2 py-1 bg-warning/10 border-b border-warning/20 text-xs text-warning text-center">
            Large graph ({allNodes.length} nodes: {agentCount} agents + {discCount} discovered). Use filters to narrow. Performance may degrade.
          </div>
        )}
        <div className="flex-1">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} fitView attributionPosition="bottom-left" style={{ background: "#0a0a0a" }}>
            <Background color="#1f2937" gap={20} />
            <Controls className="!bg-surface-dark !border-border-dark !rounded-lg" />
            <MiniMap style={{ background: "#111111", border: "1px solid #232948" }} nodeColor={(n) => {
              const nd = n.data as { nodeType?: string; risk?: string };
              if (nd.nodeType && nd.nodeType !== "agent") return discoveryColors[nd.nodeType] ?? "#6b7280";
              return riskColors[nd.risk ?? ""] ?? "#6b7280";
            }} />
            <Panel position="top-right" className="flex gap-2">
              <Button size="sm" variant={mode === "estate" ? "primary" : "secondary"} onClick={() => { setMode("estate"); resetView(); }}>Estate</Button>
              <Button size="sm" variant={mode === "dependency" ? "primary" : "secondary"} onClick={() => { setMode("dependency"); resetView(); }}>Dependency</Button>
              <Button size="sm" variant={mode === "risk" ? "primary" : "secondary"} onClick={() => { setMode("risk"); resetView(); }}>Risk</Button>
              <Button size="sm" variant={mode === "compliance" ? "primary" : "secondary"} onClick={() => { setMode("compliance"); resetView(); }}>Compliance</Button>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      <div className="w-80 space-y-4 overflow-y-auto">
        {selectedNode && isAgentNode(selectedNode) && (
          <Card>
            <h3 className="text-sm font-semibold text-white mb-3">{selectedNode.name}</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Code</span><span className="text-white">{selectedNode.agent_code}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-white">{selectedNode.agent_type}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Risk</span><Badge variant={selectedNode.risk_level as "critical"|"high"|"medium"|"low"}>{selectedNode.risk_level}</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">Oversight</span><span className="text-white">{selectedNode.oversight_level}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="text-white">{selectedNode.status}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Model</span><span className="text-white">{selectedNode.model_name ?? "—"}</span></div>
            </div>
          </Card>
        )}
        {selectedNode && !isAgentNode(selectedNode) && (
          <Card>
            <h3 className="text-sm font-semibold text-white mb-3" style={{ color: discoveryColors[selectedNode.nodeType] ?? "#6b7280" }}>{selectedNode.label}</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Type</span><Badge variant={selectedNode.nodeType === "incident" || selectedNode.nodeType === "finding" ? "critical" : selectedNode.nodeType === "regulation" ? "high" : "low"}>{selectedNode.nodeType}</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">Layer</span><span className="text-white">{selectedNode.layer}</span></div>
              {Object.entries(selectedNode.metadata).map(([k, v]) => {
                const hidden = ["owner_id", "provider_id", "finding_id", "assessment_id", "conformity_assessment_id", "eu_ai_db_system_uuid", "eu_ai_db_ref", "system_code"];
                if (hidden.includes(k) && !v) return null;
                const label = k.replace(/_/g, " ");
                const color = k.includes("severity") && v === "critical" ? "text-danger" : "";
                return (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className={`text-white truncate max-w-[160px] ${color}`}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                  </div>
                );
              })}
              {selectedNode.nodeType === "control" && (
                <div className="mt-2 pt-2 border-t border-border-dark">
                  <span className={`text-xs ${selectedNode.label.includes("conformity") || selectedNode.label.includes("registered") ? "text-danger" : "text-warning"}`}>
                    {selectedNode.label.includes("conformity") ? "AI Act conformity required" :
                     selectedNode.label.includes("human") ? "Human oversight required" :
                     "Compliance gap detected"}
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}
        {mode === "risk" && propagation.length > 0 && (
          <Card>
            <h3 className="text-sm font-semibold text-white mb-3">Risk Propagation</h3>
            <div className="space-y-2">
              {propagation.map((p) => (
                <div key={p.propagation_id} className="p-2 rounded bg-surface-dark/50 border border-border-dark/30 text-xs">
                  <div className="flex justify-between"><span className="text-gray-400">Depth {p.propagation_depth}</span><Badge variant={p.criticality as "critical"|"high"|"medium"|"low"}>{p.criticality}</Badge></div>
                  <div className="text-white mt-1">Impact: {p.impact_score}</div>
                  {p.financial_impact_eur > 0 && <div className="text-danger mt-0.5">€{p.financial_impact_eur.toLocaleString()}</div>}
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Legend</h3>
          <div className="space-y-1.5 mb-3">
            {Object.entries({ ...riskColors, ...discoveryColors }).map(([level, color]) => (
              <div key={level} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-gray-400">{level}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-600 border-t border-border-dark pt-2">
            {agentCount} agents · {discCount} discovery ({allNodes.length - agentCount - discCount > 0 ? `${allNodes.length - agentCount - discCount} unclassified` : ""})
          </div>
        </Card>
      </div>
    </div>
  );
}