import { db } from "@/lib/db";
import { getUnifiedGraph, isAgentNode } from "@/services/knowledge-graph";
import type {
  AgentGraphNode,
  DiscoveryGraphNode,
  UnifiedGraphNode,
  UnifiedGraphEdge,
  UnifiedGraph,
} from "@/services/knowledge-graph";

export interface GraphNode {
  agent_id: string;
  agent_code: string;
  name: string;
  agent_type: string;
  risk_level: string;
  oversight_level: string;
  status: string;
  deployment_env: string;
  model_name: string | null;
  cg_ag_001_registered: boolean;
  cg_ag_002_owner: boolean;
  cg_ag_003_model_reg: boolean;
  cg_ag_007_oversight: boolean;
  cg_ag_008_audit_trail: boolean;
  cg_ag_010_classified: boolean;
  cg_ag_012_autonomous_governed: boolean;
  external_refs?: Record<string, unknown>;
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
  business_domain?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface EstateData {
  nodes: UnifiedGraphNode[];
  edges: UnifiedGraphEdge[];
  agentCount: number;
  discoveryCount: number;
  systemCount: number;
  incidentCount: number;
  findingCount: number;
  regulationCount: number;
  summary: string;
}

export interface TraversalResult {
  agent_id: string;
  agent_code: string;
  agent_name: string;
  depth: number;
  path: string[];
}

export interface PropagationPath {
  propagation_id: string;
  source_agent_id: string;
  affected_agent_id: string;
  propagation_type: string;
  propagation_depth: number;
  impact_score: number;
  criticality: string;
  financial_impact_eur: number;
  agents_in_chain: string[];
}

export async function getEstate(orgId: string): Promise<EstateData> {
  return getUnifiedGraph(orgId);
}

/** The root agent is not in the verified organisation; raised BEFORE any elevated traversal runs. */
export class CrossTenantAgentError extends Error {
  constructor() {
    super("Agent not found in this organisation");
    this.name = "CrossTenantAgentError";
  }
}

export async function getTraversal(
  orgId: string,
  agentId: string,
  maxDepth: number = 5
): Promise<TraversalResult[]> {
  // agent_graph_traverse takes no tenant argument and runs as a service-role-only definer:
  // bind the root to the verified organisation first, and fail closed otherwise.
  const { data: root, error } = await db.write
    .from("agents")
    .select("agent_id")
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!root) throw new CrossTenantAgentError();

  const { data } = await db.write.rpc("agent_graph_traverse", {
    p_root_agent_id: agentId,
    p_max_depth: maxDepth,
    p_edge_types: null,
    p_active_only: true,
  });

  return (data as TraversalResult[]) ?? [];
}

export async function getRiskPropagation(
  orgId: string,
  agentId: string
): Promise<PropagationPath[]> {
  const { data } = await db.read
    .from("agent_risk_propagation")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("risk_source_agent_id", agentId)
    .eq("is_active", true)
    .order("impact_score", { ascending: false });

  return (data as PropagationPath[]) ?? [];
}

export async function recomputePropagation(orgId: string): Promise<void> {
  await db.write.rpc("recompute_risk_propagation", {
    p_organisation_id: orgId,
  });
}