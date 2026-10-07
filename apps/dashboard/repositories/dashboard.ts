import { db } from "@/lib/db";
import { getUnifiedGraph, isAgentNode, type DiscoveryGraphNode } from "@/services/knowledge-graph";

export interface DashboardSummary {
  totalAgents: number;
  totalSystems: number;
  complianceRate: number | null;
  openFindings: number;
  openIncidents: number;
  upcomingReviews: number;
  highRiskAgents: number;
  agentsWithoutSystem: number;
  systemsWithoutAgents: number;
  highRiskSystems: number;
  openDoraIncidents: number;
  totalGovernanceGaps: number;
  auditEventsLast30Days: number;
  riskDistribution: { critical: number; high: number; medium: number; low: number };
  recentIncidents: Array<{
    incident_code: string;
    title: string;
    severity: string;
    status: string;
    occurred_at: string;
  }>;
  topGaps: Array<{
    agent_code: string;
    agent_name: string;
    risk_level: string;
    total_gaps: number;
    owner_name: string;
  }>;
  governanceQuestions: Array<{
    query: string;
    intent: string;
    confidence: number;
    timestamp: string;
  }>;
  repositoriesScanned: number;
  agentsDiscovered: number;
  repositoriesWithAI: number;
  governancePriorityCritical: number;
  criticalFindings: number;
  aiActExposureCount: number;
  doraMajorIncidents: number;
  cgSysComplianceRate: number | null;
  evidenceCoverage: number | null;
}

export async function getDashboardData(orgId: string): Promise<DashboardSummary> {
  const [
    totalAgents,
    totalSystems,
    complianceResult,
    openFindings,
    openIncidents,
    upcomingReviews,
    highRiskAgents,
    agentsWithoutSystem,
    systemsWithoutAgents,
    highRiskSystems,
    openDoraIncidents,
    totalGovernanceGaps,
    auditEventsLast30Days,
    riskDistribution,
    recentIncidents,
    topGaps,
    governanceQuestions,
    repositoriesScanned,
    agentsDiscovered,
    repositoriesWithAI,
    governancePriorityCritical,
    criticalFindings,
    aiActExposureCount,
    doraMajorIncidents,
    cgSysComplianceRate,
    evidenceCoverage,
  ] = await Promise.all([
    countAgents(orgId),
    countSystems(orgId),
    computeCompliance(orgId),
    countOpenFindings(orgId),
    countOpenIncidents(orgId),
    countUpcomingReviews(orgId),
    countHighRiskAgents(orgId),
    countAgentsWithoutSystem(orgId),
    countSystemsWithoutAgents(orgId),
    countHighRiskSystems(orgId),
    countOpenDoraIncidents(orgId),
    countTotalGovernanceGaps(orgId),
    countAuditEvents30Days(orgId),
    getRiskDistribution(orgId),
    getRecentIncidents(orgId),
    getTopGaps(orgId),
    getGovernanceQuestions(orgId),
    countRepositoriesScanned(orgId),
    countAgentsDiscovered(orgId),
    countRepositoriesWithAI(orgId),
    countGovernancePriorityCritical(orgId),
    countCriticalFindings(orgId),
    countAiActExposure(orgId),
    countDoraMajorIncidents(orgId),
    computeCgSysComplianceRate(orgId),
    computeEvidenceCoverage(orgId),
  ]);

  return {
    totalAgents,
    totalSystems,
    complianceRate: complianceResult.rate,
    openFindings,
    openIncidents,
    upcomingReviews,
    highRiskAgents,
    agentsWithoutSystem,
    systemsWithoutAgents,
    highRiskSystems,
    openDoraIncidents,
    totalGovernanceGaps,
    auditEventsLast30Days,
    riskDistribution,
    recentIncidents,
    topGaps,
    governanceQuestions,
    repositoriesScanned,
    agentsDiscovered,
    repositoriesWithAI,
    governancePriorityCritical,
    criticalFindings,
    aiActExposureCount,
    doraMajorIncidents,
    cgSysComplianceRate,
    evidenceCoverage,
  };
}

async function countAgents(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();
  return count ?? 0;
}

async function countSystems(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("ai_systems")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();
  return count ?? 0;
}

async function computeCompliance(orgId: string): Promise<{ rate: number | null }> {
  const { count: total } = await db.write
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();

  const { data: gaps } = await db.write.rpc("agent_compliance_gaps", {
    p_organisation_id: orgId,
  }).throwOnError();

  const gapCount = (gaps as Array<unknown>)?.length ?? 0;
  const totalCount = total ?? 0;
  const rate = totalCount > 0 ? Math.round((1 - gapCount / totalCount) * 100) : null;

  return { rate };
}

async function countOpenFindings(orgId: string): Promise<number> {
  const { data: assessments } = await db.write
    .from("control_assessments")
    .select("assessment_id")
    .eq("organisation_id", orgId).throwOnError();

  if (!assessments || assessments.length === 0) return 0;

  const ids = (assessments as Array<{ assessment_id: string }>).map(
    (a) => a.assessment_id
  );

  const { count } = await db.write
    .from("control_findings")
    .select("*", { count: "exact", head: true })
    .in("assessment_id", ids)
    .not("status", "in", '("closed","accepted")').throwOnError();

  return count ?? 0;
}

async function countOpenIncidents(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("ict_incidents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .not("status", "in", '("resolved","closed")').throwOnError();
  return count ?? 0;
}

async function countUpcomingReviews(orgId: string): Promise<number> {
  const [{ count: agentCount }, { count: linkCount }] = await Promise.all([
    db.write
      .from("agents")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .not("status", "in", '("decommissioned","suspended")')
      .lt("updated_at", new Date(Date.now() - 90 * 86400000).toISOString()).throwOnError(),

    db.write
      .from("agent_resource_links")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("is_active", true)
      .not("next_review_date", "is", null)
      .lt("next_review_date", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]).throwOnError(),
  ]);

  return (agentCount ?? 0) + (linkCount ?? 0);
}

async function countHighRiskSystems(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("ai_systems")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .in("risk_class", ["high", "unacceptable"])
    .neq("status", "decommissioned").throwOnError();
  return count ?? 0;
}

async function countHighRiskAgents(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .in("risk_level", ["critical", "high"])
    .neq("status", "decommissioned").throwOnError();
  return count ?? 0;
}

async function countOpenDoraIncidents(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("ict_incidents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .neq("reporting_phase", "not_required")
    .not("status", "in", '("resolved","closed")').throwOnError();
  return count ?? 0;
}

async function countTotalGovernanceGaps(orgId: string): Promise<number> {
  const { data } = await db.write.rpc("agent_compliance_gaps", {
    p_organisation_id: orgId,
  }).throwOnError();
  const gaps = data as Array<{ total_gaps: number }> | null;
  return gaps?.reduce((sum, g) => sum + (g.total_gaps ?? 0), 0) ?? 0;
}

async function countAgentsWithoutSystem(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .is("ai_system_id", null)
    .neq("status", "decommissioned").throwOnError();
  return count ?? 0;
}

async function countSystemsWithoutAgents(orgId: string): Promise<number> {
  const { data: systems } = await db.write
    .from("ai_systems")
    .select("system_id")
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();

  if (!systems || systems.length === 0) return 0;

  const systemIds = (systems as Array<{ system_id: string }>).map((s) => s.system_id);

  const { data: linkedAgents } = await db.write
    .from("agents")
    .select("ai_system_id")
    .eq("organisation_id", orgId)
    .in("ai_system_id", systemIds)
    .neq("status", "decommissioned").throwOnError();

  const linkedSystemIds = new Set(
    (linkedAgents as Array<{ ai_system_id: string }>)?.map((a) => a.ai_system_id) ?? []
  );

  return systemIds.filter((id) => !linkedSystemIds.has(id)).length;
}

async function getRiskDistribution(
  orgId: string
): Promise<{ critical: number; high: number; medium: number; low: number }> {
  const { data } = await db.write
    .from("agents")
    .select("risk_level")
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();

  const agents = (data as Array<{ risk_level: string }>) ?? [];
  return {
    critical: agents.filter((a) => a.risk_level === "critical").length,
    high: agents.filter((a) => a.risk_level === "high").length,
    medium: agents.filter((a) => a.risk_level === "medium").length,
    low: agents.filter((a) => a.risk_level === "low").length,
  };
}

async function getRecentIncidents(
  orgId: string
): Promise<DashboardSummary["recentIncidents"]> {
  const { data } = await db.write
    .from("ict_incidents")
    .select("incident_code, title, severity, status, occurred_at")
    .eq("organisation_id", orgId)
    .order("occurred_at", { ascending: false })
    .limit(5).throwOnError();

  return (data as DashboardSummary["recentIncidents"]) ?? [];
}

async function getTopGaps(
  orgId: string
): Promise<DashboardSummary["topGaps"]> {
  const { data } = await db.write.rpc("agent_compliance_gaps", {
    p_organisation_id: orgId,
  }).throwOnError();

  const gaps = (data as Array<{
    agent_code: string;
    agent_name: string;
    risk_level: string;
    total_gaps: number;
    owner_name: string;
  }>) ?? [];

  return gaps.sort((a, b) => b.total_gaps - a.total_gaps).slice(0, 5);
}

async function countAuditEvents30Days(orgId: string): Promise<number> {
  const { count } = await db.write
    .from("governance_ledger")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .gte("event_timestamp", new Date(Date.now() - 30 * 86400000).toISOString()).throwOnError();
  return count ?? 0;
}

async function getGovernanceQuestions(orgId: string): Promise<DashboardSummary["governanceQuestions"]> {
  const { data } = await db.write
    .from("governance_ledger")
    .select("payload, event_timestamp")
    .eq("organisation_id", orgId)
    .eq("event_type", "talk_to_governance.query")
    .order("event_timestamp", { ascending: false })
    .limit(8).throwOnError();

  return ((data as Array<{ payload: { query?: string; intent?: string; confidence?: number }; event_timestamp: string }>) ?? []).map((e) => ({
    query: (e.payload?.query ?? "").slice(0, 80),
    intent: e.payload?.intent ?? "unknown",
    confidence: e.payload?.confidence ?? 0,
    timestamp: e.event_timestamp,
  }));
}

async function countRepositoriesScanned(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "repository").length;
}

async function countAgentsDiscovered(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.agentCount;
}

async function countRepositoriesWithAI(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  const reposWithAI = new Set<string>();
  for (const n of graph.nodes) {
    if (!isAgentNode(n)) continue;
    const d = (n.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
    if (d?.framework) {
      const repo = d?.repository as string | undefined;
      if (repo) reposWithAI.add(repo);
    }
  }
  return reposWithAI.size;
}

async function countGovernancePriorityCritical(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.nodes.filter((n) =>
    isAgentNode(n) && (n.enrichment?.governancePriority === "critical" || n.enrichment?.complianceExposure === "critical")
  ).length;
}

async function countCriticalFindings(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "finding" && (n as DiscoveryGraphNode).metadata?.severity === "critical").length;
}

async function countAiActExposure(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.nodes.filter((n) =>
    isAgentNode(n) && (n.enrichment?.aiActExposure === "high" || n.enrichment?.aiActExposure === "critical")
  ).length;
}

async function countDoraMajorIncidents(orgId: string): Promise<number> {
  const graph = await getUnifiedGraph(orgId);
  return graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "incident" && (n as DiscoveryGraphNode).metadata?.is_major_incident === true).length;
}

async function computeCgSysComplianceRate(orgId: string): Promise<number | null> {
  const graph = await getUnifiedGraph(orgId);
  const sysNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "ai_system") as DiscoveryGraphNode[];
  if (sysNodes.length === 0) return null;
  if (sysNodes.some(s => typeof s.metadata?.systemComplianceScore !== "number")) return null;
  const totalScore = sysNodes.reduce((sum, s) => sum + ((s.metadata?.systemComplianceScore as number) ?? 0), 0);
  return Math.round(totalScore / sysNodes.length);
}

async function computeEvidenceCoverage(orgId: string): Promise<number | null> {
  const graph = await getUnifiedGraph(orgId);
  const evCount = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "evidence").length;
  const agCount = graph.agentCount;
  return agCount > 0 ? Math.round((evCount / agCount) * 100) : null;
}