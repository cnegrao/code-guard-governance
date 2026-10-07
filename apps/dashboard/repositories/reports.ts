import { db } from "@/lib/db";
import { getUnifiedGraph, isAgentNode, type DiscoveryGraphNode } from "@/services/knowledge-graph";

export interface ReportData {
  org: { name: string; industry: string; date: string };
  agents: { total: number; byRisk: { critical: number; high: number; medium: number; low: number } };
  systems: { total: number; highRisk: number; byLifecycle: Array<{ lifecycle: string; count: number }> };
  compliance: { rate: number | null; totalGaps: number; topGaps: Array<{ agent: string; gaps: number; risk: string }>; controlCoverage: number | null };
  findings: { open: number; bySeverity: Array<{ severity: string; count: number }>; criticalFindings: number };
  incidents: { open: number; doraOpen: number; recent: Array<{ code: string; title: string; severity: string; status: string; date: string }> };
  dora: { totalIncidents: number; majorIncidents: number; reportingStatus: string; thirdPartyConcentration: number };
  aiAct: { highRiskSystems: number; agentsWithoutSystem: number; oversightLevels: Array<{ level: string; count: number }>; annexIiiDistribution: Array<{ sector: string; count: number }> };
  regulatory: { aiActExposure: number; doraExposure: number; lgpdExposure: number; evidenceCount: number };
}

export async function gatherReportData(orgId: string): Promise<ReportData> {
  const [
    org,
    agentCount,
    systemCount,
    riskDist,
    gaps,
    findings,
    findingsBySev,
    incidentCount,
    doraIncidentCount,
    recentIncidents,
    highRiskSystems,
    agentsWithoutSystem,
    oversightLevels,
    systemLifecycles,
    doraMajorIncidents,
    graph,
  ] = await Promise.all([
    db.write.from("organisations").select("name:legal_name").eq("organisation_id", orgId).throwOnError().maybeSingle(),

    db.write.from("agents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),

    db.write.from("ai_systems").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),

    db.write.from("agents").select("risk_level").eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),

    db.write.rpc("agent_compliance_gaps", { p_organisation_id: orgId }).throwOnError(),

    db.write.from("control_findings").select("finding_id, severity, status, control_assessments!inner(organisation_id)").eq("control_assessments.organisation_id", orgId).not("status", "in", '("closed","accepted")').throwOnError(),

    db.write.from("control_findings").select("severity, control_assessments!inner(organisation_id)").eq("control_assessments.organisation_id", orgId).not("status", "in", '("closed","accepted")').throwOnError(),

    db.write.from("ict_incidents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).not("status", "in", '("resolved","closed")').throwOnError(),

    db.write.from("ict_incidents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).neq("reporting_phase", "not_required").not("status", "in", '("resolved","closed")').throwOnError(),

    db.write.from("ict_incidents").select("incident_code, title, severity, status, occurred_at").eq("organisation_id", orgId).order("occurred_at", { ascending: false }).limit(5).throwOnError(),

    db.write.from("ai_systems").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).in("risk_class", ["high", "unacceptable"]).neq("status", "decommissioned").throwOnError(),

    db.write.from("agents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).is("ai_system_id", null).neq("status", "decommissioned").throwOnError(),

    db.write.from("agents").select("oversight_level").eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),

    db.write.from("ai_systems").select("lifecycle").eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),

    db.write.from("ict_incidents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).eq("is_major_incident", true).not("status", "in", '("resolved","closed")').throwOnError(),

    getUnifiedGraph(orgId),
  ]);

  const orgName = (org.data as { name: string } | null)?.name ?? "Organisation";
  const industry = ((org.data as { external_refs: Record<string, unknown> } | null)?.external_refs as Record<string, string>)?.industry_profile ?? "other";

  const agents = (riskDist.data as Array<{ risk_level: string }>) ?? [];
  const gapsData = (gaps.data as Array<{ agent_name: string; total_gaps: number; risk_level: string }>) ?? [];
  const complianceTotal = agentCount.count ?? 0;
  const complianceWithGaps = gapsData.length;
  const complianceRate = complianceTotal > 0 ? Math.round((1 - complianceWithGaps / complianceTotal) * 100) : null;

  const findingsData = (findingsBySev.data as Array<{ severity: string }>) ?? [];
  const sevMap = new Map<string, number>();
  for (const f of findingsData) {
    sevMap.set(f.severity, (sevMap.get(f.severity) ?? 0) + 1);
  }

  const oversightData = (oversightLevels.data as Array<{ oversight_level: string }>) ?? [];
  const oversightMap = new Map<string, number>();
  for (const o of oversightData) {
    oversightMap.set(o.oversight_level, (oversightMap.get(o.oversight_level) ?? 0) + 1);
  }

  const lifecycleData = (systemLifecycles.data as Array<{ lifecycle: string }>) ?? [];
  const lifecycleMap = new Map<string, number>();
  for (const l of lifecycleData) {
    lifecycleMap.set(l.lifecycle, (lifecycleMap.get(l.lifecycle) ?? 0) + 1);
  }

  const sysNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "ai_system") as DiscoveryGraphNode[];
  const sysScore = sysNodes.length > 0 ? Math.round(sysNodes.reduce((s, n) => s + ((n.metadata?.systemComplianceScore as number) ?? 0), 0) / sysNodes.length) : null;
  const findingNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "finding") as DiscoveryGraphNode[];
  const critFindings = findingNodes.filter((f) => f.metadata?.severity === "critical").length;
  const annexIiiMap = new Map<string, number>();
  for (const s of sysNodes) {
    const sector = s.metadata?.annex_iii_sector as string | undefined;
    if (sector && sector !== "not_annex_iii") {
      annexIiiMap.set(sector, (annexIiiMap.get(sector) ?? 0) + 1);
    }
  }
  const thirdPartyCount = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "third_party").length;
  const aiActExp = graph.nodes.filter((n) => isAgentNode(n) && (n.enrichment?.aiActExposure === "high" || n.enrichment?.aiActExposure === "critical")).length;
  const doraExp = graph.nodes.filter((n) => isAgentNode(n) && n.enrichment?.doraExposure).length;
  const lgpdExp = graph.nodes.filter((n) => isAgentNode(n) && n.enrichment?.containsPii && n.enrichment?.trustZone === "production").length;
  const evCount = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "evidence").length;

  return {
    org: { name: orgName, industry, date: new Date().toISOString().split("T")[0] },
    agents: {
      total: complianceTotal,
      byRisk: {
        critical: agents.filter((a) => a.risk_level === "critical").length,
        high: agents.filter((a) => a.risk_level === "high").length,
        medium: agents.filter((a) => a.risk_level === "medium").length,
        low: agents.filter((a) => a.risk_level === "low").length,
      },
    },
    systems: {
      total: systemCount.count ?? 0,
      highRisk: highRiskSystems.count ?? 0,
      byLifecycle: Array.from(lifecycleMap.entries()).map(([lifecycle, count]) => ({ lifecycle, count })),
    },
    compliance: {
      rate: complianceRate,
      totalGaps: gapsData.reduce((sum, g) => sum + g.total_gaps, 0),
      topGaps: gapsData.sort((a, b) => b.total_gaps - a.total_gaps).slice(0, 5).map((g) => ({ agent: g.agent_name, gaps: g.total_gaps, risk: g.risk_level })),
      controlCoverage: sysScore,
    },
    findings: {
      open: (findings.data as Array<unknown>)?.length ?? 0,
      bySeverity: Array.from(sevMap.entries()).map(([severity, count]) => ({ severity, count })),
      criticalFindings: critFindings,
    },
    incidents: {
      open: incidentCount.count ?? 0,
      doraOpen: doraIncidentCount.count ?? 0,
      recent: ((recentIncidents.data as Array<{ incident_code: string; title: string; severity: string; status: string; occurred_at: string }>) ?? []).map((i) => ({ code: i.incident_code, title: i.title, severity: i.severity, status: i.status, date: i.occurred_at })),
    },
    dora: {
      totalIncidents: doraIncidentCount.count ?? 0,
      majorIncidents: doraMajorIncidents.count ?? 0,
      reportingStatus: (doraIncidentCount.count ?? 0) > 0 ? "Active" : "No DORA incidents",
      thirdPartyConcentration: thirdPartyCount,
    },
    aiAct: {
      highRiskSystems: highRiskSystems.count ?? 0,
      agentsWithoutSystem: agentsWithoutSystem.count ?? 0,
      oversightLevels: Array.from(oversightMap.entries()).map(([level, count]) => ({ level, count })),
      annexIiiDistribution: Array.from(annexIiiMap.entries()).map(([sector, count]) => ({ sector, count })),
    },
    regulatory: {
      aiActExposure: aiActExp,
      doraExposure: doraExp,
      lgpdExposure: lgpdExp,
      evidenceCount: evCount,
    },
  };
}