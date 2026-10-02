import { db } from "@/lib/db";

export interface AgentGraphNode {
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
  ai_system_id?: string | null;
}

export interface DiscoveryGraphNode {
  id: string;
  nodeType: "repository" | "domain" | "service" | "module" | "dependency" | "entrypoint" | "ai_system" | "incident" | "third_party" | "finding" | "regulation" | "evidence" | "control";
  label: string;
  layer: 1 | 2 | 3 | 4 | 5;
  metadata: Record<string, unknown>;
}

export type UnifiedGraphNode = AgentGraphNode | DiscoveryGraphNode;

export interface UnifiedGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface UnifiedGraph {
  nodes: UnifiedGraphNode[];
  edges: UnifiedGraphEdge[];
  agentCount: number;
  systemCount: number;
  discoveryCount: number;
  incidentCount: number;
  findingCount: number;
  regulationCount: number;
  summary: string;
}

export function isAgentNode(n: UnifiedGraphNode): n is AgentGraphNode {
  return "agent_id" in n;
}

function sanitizeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
}

export function buildDiscoveryGraph(
  nodes: UnifiedGraphNode[],
  edges: UnifiedGraphEdge[],
  repoIntel: Record<string, unknown>,
  repoName: string,
  agentsInRepo: string[]
): { nodes: UnifiedGraphNode[]; edges: UnifiedGraphEdge[] } {
  const repoId = sanitizeId(`kg_repo_${repoName}`);

  const existingRepo = nodes.find((n) => !isAgentNode(n) && n.id === repoId);
  if (!existingRepo) {
    nodes.push({
      id: repoId,
      nodeType: "repository",
      label: repoName,
      layer: 1,
      metadata: {
        trustZone: repoIntel.trustZone ?? "unknown",
        languages: repoIntel.languages ?? [],
        confidence: repoIntel.confidence ?? 0.5,
        agentCount: agentsInRepo.length,
      },
    } as DiscoveryGraphNode);
  }

  const domains = (repoIntel.domains as Array<{ name: string; confidence: number; signals: string[] }>) ?? [];
  for (const domain of domains) {
    const domainId = sanitizeId(`kg_domain_${domain.name}`);
    const existing = nodes.find((n) => !isAgentNode(n) && n.id === domainId);
    if (!existing) {
      nodes.push({
        id: domainId,
        nodeType: "domain",
        label: domain.name,
        layer: 1,
        metadata: { confidence: domain.confidence, signals: domain.signals },
      } as DiscoveryGraphNode);
    }
    edges.push({
      id: sanitizeId(`kg_edge_repo_${repoName}_domain_${domain.name}`),
      source: repoId,
      target: domainId,
      type: "contains",
      metadata: {},
    });

    for (const agentCode of agentsInRepo) {
      const agentNode = nodes.find((n) => isAgentNode(n) && n.agent_code === agentCode);
      if (agentNode && isAgentNode(agentNode)) {
        const agentName = (agentNode.name ?? "").toLowerCase();
        const matchesDomain = agentNode.business_domain?.toLowerCase().includes(domain.name.toLowerCase()) ||
          agentName.includes(domain.name.toLowerCase());
        if (matchesDomain) {
          edges.push({
            id: sanitizeId(`kg_edge_agent_${agentCode}_domain_${domain.name}`),
            source: agentNode.agent_id,
            target: domainId,
            type: "processes",
            metadata: {},
          });
        }
      }
    }
  }

  const services = (repoIntel.services as Array<{ name: string; type: string; path: string; confidence: number }>) ?? [];
  for (const service of services) {
    const svcId = sanitizeId(`kg_svc_${service.name}`);
    const existing = nodes.find((n) => !isAgentNode(n) && n.id === svcId);
    if (!existing) {
      nodes.push({
        id: svcId,
        nodeType: "service",
        label: service.name,
        layer: 2,
        metadata: { type: service.type, path: service.path, confidence: service.confidence },
      } as DiscoveryGraphNode);
    }

    edges.push({
      id: sanitizeId(`kg_edge_repo_${repoName}_svc_${service.name}`),
      source: repoId,
      target: svcId,
      type: "contains",
      metadata: {},
    });

    for (const agentCode of agentsInRepo) {
      const agentNode = nodes.find((n) => isAgentNode(n) && n.agent_code === agentCode);
      if (agentNode && isAgentNode(agentNode)) {
        const agentName = (agentNode.name ?? "").toLowerCase();
        if (agentName.includes(service.name.toLowerCase()) || service.name.toLowerCase().includes(agentName)) {
          edges.push({
            id: sanitizeId(`kg_edge_agent_${agentCode}_svc_${service.name}`),
            source: agentNode.agent_id,
            target: svcId,
            type: "belongs_to",
            metadata: {},
          });
        }
      }
    }

    for (const domain of domains) {
      if (service.name.toLowerCase().includes(domain.name) || service.path.toLowerCase().includes(domain.name)) {
        edges.push({
          id: sanitizeId(`kg_edge_svc_${service.name}_domain_${domain.name}`),
          source: svcId,
          target: sanitizeId(`kg_domain_${domain.name}`),
          type: "belongs_to",
          metadata: {},
        });
      }
    }
  }

  const modules = (repoIntel.modules as Array<{ name: string; type: string; path: string; symbols: unknown[] }>) ?? [];
  for (const mod of modules) {
    const modId = sanitizeId(`kg_module_${mod.name}`);
    const existing = nodes.find((n) => !isAgentNode(n) && n.id === modId);
    if (!existing) {
      nodes.push({
        id: modId,
        nodeType: "module",
        label: mod.name,
        layer: 2,
        metadata: { type: mod.type, path: mod.path, symbolCount: mod.symbols.length },
      } as DiscoveryGraphNode);
    }
    edges.push({
      id: sanitizeId(`kg_edge_repo_${repoName}_module_${mod.name}`),
      source: repoId,
      target: modId,
      type: "contains",
      metadata: {},
    });
  }

  const dependencies = (repoIntel.dependencies as Array<{ name: string; type: string; provider?: string }>) ?? [];
  for (const dep of dependencies) {
    const depId = sanitizeId(`kg_dep_${dep.name}`);
    const existing = nodes.find((n) => !isAgentNode(n) && n.id === depId);
    if (!existing) {
      nodes.push({
        id: depId,
        nodeType: "dependency",
        label: dep.name,
        layer: 4,
        metadata: { type: dep.type, provider: dep.provider ?? null },
      } as DiscoveryGraphNode);
    }
    edges.push({
      id: sanitizeId(`kg_edge_repo_${repoName}_dep_${dep.name}`),
      source: repoId,
      target: depId,
      type: "depends_on",
      metadata: {},
    });
  }

  const entrypoints = (repoIntel.entrypoints as string[]) ?? [];
  for (const ep of entrypoints) {
    const epId = sanitizeId(`kg_ep_${ep}`);
    const existing = nodes.find((n) => !isAgentNode(n) && n.id === epId);
    if (!existing) {
      nodes.push({
        id: epId,
        nodeType: "entrypoint",
        label: ep,
        layer: 2,
        metadata: { path: ep },
      } as DiscoveryGraphNode);
    }
    edges.push({
      id: sanitizeId(`kg_edge_repo_${repoName}_ep_${ep}`),
      source: repoId,
      target: epId,
      type: "exposes",
      metadata: {},
    });
  }

  return { nodes, edges };
}

export async function getUnifiedGraph(orgId: string): Promise<UnifiedGraph> {
  const [
    { data: rawAgents },
    { data: rawEdges },
    { data: rawSystems },
    { data: rawIncidents },
    { data: rawThirdParties },
    { data: rawFindings },
    { data: rawOrgInfo },
  ] = await Promise.all([
    db.write
      .from("agents")
      .select(
        "agent_id, agent_code, name, agent_type, risk_level, oversight_level, status, deployment_env, model_name, cg_ag_001_registered, cg_ag_002_owner, cg_ag_003_model_reg, cg_ag_007_oversight, cg_ag_008_audit_trail, cg_ag_010_classified, cg_ag_012_autonomous_governed, external_refs, business_domain, ai_system_id"
      )
      .eq("organisation_id", orgId)
      .neq("status", "decommissioned").throwOnError(),

    db.write
      .from("agent_edges")
      .select(
        "source_agent_id, target_agent_id, relationship_type, is_active, weight, carries_pii, carries_phi, carries_financial"
      )
      .eq("organisation_id", orgId)
      .eq("is_active", true).throwOnError(),

    db.write
      .from("ai_systems")
      .select(
        "system_id, system_code, name, risk_class, lifecycle, status, owner_id:owner_user_id, cg_sys_001_registered, cg_sys_002_owner, cg_sys_003_risk_classified, cg_sys_004_tech_doc, cg_sys_005_risk_mgmt, cg_sys_006_human_oversight, cg_sys_007_conformity, cg_sys_008_post_market, annex_iii_sector, annex_iii_exception_claimed, conformity_procedure, conformity_assessment_id, eu_ai_db_registered, eu_ai_db_system_uuid, eu_ai_db_ref, external_refs"
      )
      .eq("organisation_id", orgId)
      .neq("status", "decommissioned").throwOnError(),

    db.write
      .from("ict_incidents")
      .select("incident_code, title, severity, status, is_major_incident, reporting_phase, occurred_at")
      .eq("organisation_id", orgId)
      .not("status", "in", '("resolved","closed")').throwOnError(),

    db.write
      .from("third_party_providers")
      .select("provider_id, provider_name:name, dora_criticality, concentration_risk_score, service_type, status")
      .eq("organisation_id", orgId)
      .eq("status", "active").throwOnError(),

    db.write
      .from("control_findings")
      .select("finding_id, title, severity, status, assessment_id, created_at, control_assessments!inner(organisation_id)")
      .eq("control_assessments.organisation_id", orgId)
      .not("status", "in", '("closed","accepted")').throwOnError(),

    db.write
      .from("organisations")
      .select("name:legal_name, country_code")
      .eq("organisation_id", orgId)
      .throwOnError().maybeSingle(),
  ]);

  const orgInfo = rawOrgInfo as { name: string; country_code: string; industry: string } | null;
  const orgCountry = orgInfo?.country_code ?? "";
  const orgIndustry = orgInfo?.industry ?? "";
  const isEuCountry = ["PT", "ES", "FR", "DE", "IT", "NL", "BE", "IE", "AT", "PL", "SE", "DK", "FI", "GR", "CZ", "RO", "HU", "SK", "BG", "HR", "LT", "SI", "LV", "EE", "CY", "MT", "LU"].includes(orgCountry);
  const isBrazil = orgCountry === "BR";
  const isUK = orgCountry === "GB";
  const isFinancial = orgIndustry === "financial_services" || orgIndustry === "insurance";

  const agents = (rawAgents as Record<string, unknown>[]) ?? [];
  const agentEdges = (rawEdges as Record<string, unknown>[]) ?? [];

  const agentNodes: AgentGraphNode[] = agents.map((a) => {
    const discovery = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
    const summary = discovery?.summary as Record<string, unknown> | undefined;
    const lineage = discovery?.lineage as Record<string, unknown> | undefined;
    const finops = discovery?.finops as Record<string, unknown> | undefined;
    const fapi = discovery?.fapi as Record<string, unknown> | undefined;

    return {
      agent_id: a.agent_id as string,
      agent_code: a.agent_code as string,
      name: a.name as string,
      agent_type: a.agent_type as string,
      risk_level: a.risk_level as string,
      oversight_level: a.oversight_level as string,
      status: a.status as string,
      deployment_env: a.deployment_env as string,
      model_name: a.model_name as string | null,
      cg_ag_001_registered: a.cg_ag_001_registered as boolean,
      cg_ag_002_owner: a.cg_ag_002_owner as boolean,
      cg_ag_003_model_reg: a.cg_ag_003_model_reg as boolean,
      cg_ag_007_oversight: a.cg_ag_007_oversight as boolean,
      cg_ag_008_audit_trail: a.cg_ag_008_audit_trail as boolean,
      cg_ag_010_classified: a.cg_ag_010_classified as boolean,
      cg_ag_012_autonomous_governed: a.cg_ag_012_autonomous_governed as boolean,
      external_refs: a.external_refs as Record<string, unknown> | undefined,
      business_domain: a.business_domain as string | undefined,
      ai_system_id: a.ai_system_id as string | undefined,
      enrichment: {
        trustZone: (summary?.trust_zone as string) ?? (discovery?.trust_zone as Record<string, string>)?.trustZone ?? undefined,
        governancePriority: (summary?.governance_priority as string) ?? (discovery?.governance_priority as string) ?? undefined,
        complianceExposure: (summary?.compliance_exposure as string) ?? (discovery?.compliance_exposure as string) ?? undefined,
        aiActExposure: (summary?.ai_act_exposure as string) ?? (discovery?.ai_act_exposure as string) ?? undefined,
        doraExposure: (summary?.dora_exposure as boolean) ?? (discovery?.dora_exposure as boolean) ?? undefined,
        containsPii: (lineage?.containsPii as boolean) ?? undefined,
        containsFinancial: (lineage?.containsFinancialData as boolean) ?? undefined,
        containsHealth: (lineage?.containsHealthData as boolean) ?? undefined,
        lineageRiskLevel: lineage?.riskLevel as string ?? undefined,
        costEstimate: finops?.monthlyCostEstimate as number ?? undefined,
        costRisk: finops?.costRisk as string ?? undefined,
        fapiCompliant: fapi?.fapiCompliant as boolean ?? undefined,
        financialServices: fapi?.financialServices as boolean ?? undefined,
      },
    };
  });

  const nodes: UnifiedGraphNode[] = [...agentNodes];
  const edges: UnifiedGraphEdge[] = agentEdges.map((e) => ({
    id: `${e.source_agent_id}-${e.target_agent_id}-${e.relationship_type}`,
    source: e.source_agent_id as string,
    target: e.target_agent_id as string,
    type: e.relationship_type as string,
    metadata: {
      carries_pii: e.carries_pii,
      carries_phi: e.carries_phi,
      carries_financial: e.carries_financial,
    },
  }));

  const systems = (rawSystems as Record<string, unknown>[]) ?? [];
  for (const s of systems) {
    const sysId = s.system_id as string;
    const cgSysControls = [
      s.cg_sys_001_registered as boolean,
      s.cg_sys_002_owner as boolean,
      s.cg_sys_003_risk_classified as boolean,
      s.cg_sys_004_tech_doc as boolean,
      s.cg_sys_005_risk_mgmt as boolean,
      s.cg_sys_006_human_oversight as boolean,
      s.cg_sys_007_conformity as boolean,
      s.cg_sys_008_post_market as boolean,
    ];
    const passedCount = cgSysControls.filter(Boolean).length;
    const systemComplianceScore = Math.round((passedCount / cgSysControls.length) * 100);
    const systemGapCount = cgSysControls.length - passedCount;

    nodes.push({
      id: sysId,
      nodeType: "ai_system",
      label: s.name as string,
      layer: 3,
      metadata: {
        system_code: s.system_code,
        risk_class: s.risk_class,
        lifecycle: s.lifecycle,
        status: s.status,
        owner_id: s.owner_id,
        cg_sys_001_registered: s.cg_sys_001_registered,
        cg_sys_002_owner: s.cg_sys_002_owner,
        cg_sys_003_risk_classified: s.cg_sys_003_risk_classified,
        cg_sys_004_tech_doc: s.cg_sys_004_tech_doc,
        cg_sys_005_risk_mgmt: s.cg_sys_005_risk_mgmt,
        cg_sys_006_human_oversight: s.cg_sys_006_human_oversight,
        cg_sys_007_conformity: s.cg_sys_007_conformity,
        cg_sys_008_post_market: s.cg_sys_008_post_market,
        systemComplianceScore,
        systemGapCount,
        annex_iii_sector: s.annex_iii_sector,
        annex_iii_exception_claimed: s.annex_iii_exception_claimed,
        conformity_procedure: s.conformity_procedure,
        conformity_assessment_id: s.conformity_assessment_id,
        eu_ai_db_registered: s.eu_ai_db_registered,
        eu_ai_db_system_uuid: s.eu_ai_db_system_uuid,
        eu_ai_db_ref: s.eu_ai_db_ref,
      },
    } as DiscoveryGraphNode);

    for (const a of agentNodes) {
      if (a.ai_system_id === sysId) {
        edges.push({
          id: `${a.agent_id}-system-${sysId}`,
          source: a.agent_id,
          target: sysId,
          type: "belongs_to",
          metadata: {},
        });
      }
    }

    for (const cgKey of Object.keys(s).filter((k) => k.startsWith("cg_sys_"))) {
      const controlStates: Record<string, string> = ((s.external_refs as Record<string, unknown>)?.controlStates ?? {}) as Record<string, string>;
      const state = controlStates[cgKey] ?? (s[cgKey] === true ? "passed" : "not_assessed");
      if (state !== "failed") continue;
      const ctrlId = sanitizeId(`ctrl_${cgKey}`);
      const existingCtrl = nodes.find((n) => !isAgentNode(n) && n.id === ctrlId);
      if (!existingCtrl) {
        nodes.push({
          id: ctrlId,
          nodeType: "control",
          label: cgKey,
          layer: 5,
          metadata: { control_key: cgKey, entity_type: "ai_system" },
        } as DiscoveryGraphNode);
      }
      edges.push({
        id: `${sysId}-violates-${ctrlId}`,
        source: sysId,
        target: ctrlId,
        type: "violates",
        metadata: {},
      });
    }
  }

  const incidents = (rawIncidents as Record<string, unknown>[]) ?? [];
  for (const inc of incidents) {
    const incId = sanitizeId(`inc_${inc.incident_code as string}`);
    nodes.push({
      id: incId,
      nodeType: "incident",
      label: inc.title as string,
      layer: 4,
      metadata: {
        incident_code: inc.incident_code,
        severity: inc.severity,
        status: inc.status,
        dora_criticality: null, // No incident-level criticality field exists in the canonical migration chain.
        is_major_incident: inc.is_major_incident,
        reporting_phase: inc.reporting_phase,
        occurred_at: inc.occurred_at,
      },
    } as DiscoveryGraphNode);

    for (const a of agentNodes) {
      if (a.risk_level === "critical" || a.risk_level === "high") {
        edges.push({
          id: `${incId}-affects-${a.agent_id}`,
          source: incId,
          target: a.agent_id,
          type: "affects",
          metadata: {},
        });
      }
    }
  }

  const thirdParties = (rawThirdParties as Record<string, unknown>[]) ?? [];
  for (const tp of thirdParties) {
    const tpId = sanitizeId(`tp_${tp.provider_name as string}`);
    nodes.push({
      id: tpId,
      nodeType: "third_party",
      label: tp.provider_name as string,
      layer: 4,
      metadata: {
        provider_id: tp.provider_id,
        dora_criticality: tp.dora_criticality,
        concentration_risk_score: tp.concentration_risk_score,
        service_type: tp.service_type,
        status: tp.status,
      },
    } as DiscoveryGraphNode);

    for (const inc of incidents) {
      const incId = sanitizeId(`inc_${inc.incident_code as string}`);
      edges.push({
        id: `${incId}-involves-${tpId}`,
        source: incId,
        target: tpId,
        type: "involves",
        metadata: {},
      });
    }

    for (const s of systems) {
      edges.push({
        id: `${tpId}-supports-${s.system_id}`,
        source: tpId,
        target: s.system_id as string,
        type: "supports",
        metadata: {},
      });
    }
  }

  const findings = (rawFindings as Record<string, unknown>[]) ?? [];
  for (const f of findings) {
    const fId = sanitizeId(`finding_${f.finding_id as string}`);
    nodes.push({
      id: fId,
      nodeType: "finding",
      label: f.title as string,
      layer: 5,
      metadata: {
        finding_id: f.finding_id,
        severity: f.severity,
        status: f.status,
        assessment_id: f.assessment_id,
        created_at: f.created_at,
      },
    } as DiscoveryGraphNode);

    for (const a of agentNodes) {
      if (a.risk_level === "critical" || a.risk_level === "high") {
        edges.push({
          id: `${fId}-relates-${a.agent_id}`,
          source: fId,
          target: a.agent_id,
          type: "relates_to",
          metadata: {},
        });
      }
    }
  }

  for (const a of agentNodes) {
    const controlStates: Record<string, string> = ((a.external_refs as Record<string, unknown>)?.controlStates ?? {}) as Record<string, string>;
    for (const cgKey of Object.keys(a).filter((k) => k.startsWith("cg_ag_"))) {
      const state = controlStates[cgKey] ?? (a[cgKey as keyof AgentGraphNode] === true ? "passed" : "not_assessed");
      if (state !== "failed") continue;
      const ctrlId = sanitizeId(`ctrl_${cgKey}`);
      const existingCtrl = nodes.find((n) => !isAgentNode(n) && n.id === ctrlId);
      if (!existingCtrl) {
        nodes.push({
          id: ctrlId,
          nodeType: "control",
          label: cgKey,
          layer: 5,
          metadata: { control_key: cgKey, entity_type: "agent" },
        } as DiscoveryGraphNode);
      }
      const edgeId = `${a.agent_id}-violates-${ctrlId}`;
      if (!edges.find((e) => e.id === edgeId)) {
        edges.push({
          id: edgeId,
          source: a.agent_id,
          target: ctrlId,
          type: "violates",
          metadata: {},
        });
      }
    }

    const evidenceList: string[] = [];
    const discovery = a.external_refs?.discovery as Record<string, unknown> | undefined;
    if (discovery?.evidence) {
      evidenceList.push(...(discovery.evidence as string[]));
    }
    if (a.enrichment?.trustZone && a.enrichment.trustZone !== "unknown") {
      evidenceList.push(`trust_zone:${a.enrichment.trustZone}`);
    }
    if (a.enrichment?.complianceExposure) {
      evidenceList.push(`compliance:${a.enrichment.complianceExposure}`);
    }

    const lineage = discovery?.lineage as Record<string, unknown> | undefined;
    const lineageEvidence = (lineage?.evidence as Array<Record<string, unknown>>) ?? [];
    const fapi = discovery?.fapi as Record<string, unknown> | undefined;
    const fapiEvidence = (fapi?.evidence as Array<Record<string, unknown>>) ?? [];
    const lgpdFindings = (discovery?.findings as Array<Record<string, unknown>>) ?? [];

    const allEvidence = [
      ...lineageEvidence,
      ...fapiEvidence,
      ...lgpdFindings.map((f) => ({ filePath: f.filePath, lineNumber: f.line, matchText: f.match })),
      ...evidenceList.map((e) => ({ filePath: "", lineNumber: 0, matchText: e })),
    ];

    for (let i = 0; i < Math.min(allEvidence.length, 5); i++) {
      const ev = allEvidence[i];
      const evId = sanitizeId(`ev_${a.agent_id}_${i}`);
      const existingEv = nodes.find((n) => !isAgentNode(n) && n.id === evId);
      if (!existingEv) {
        nodes.push({
          id: evId,
          nodeType: "evidence",
          label: typeof ev.matchText === "string" && ev.matchText.length > 60 ? ev.matchText.slice(0, 60) + "..." : String(ev.matchText),
          layer: 5,
          metadata: {
            source: a.agent_code,
            filePath: ev.filePath,
            lineNumber: ev.lineNumber,
            matchText: ev.matchText,
            evidence: evidenceList[i] ?? ev.matchText,
          },
        } as DiscoveryGraphNode);
      }
      const evEdgeId = `${evId}-supports-${a.agent_id}`;
      if (!edges.find((e) => e.id === evEdgeId)) {
        edges.push({
          id: evEdgeId,
          source: evId,
          target: a.agent_id,
          type: "supports",
          metadata: {},
        });
      }
    }
  }

  const regulationNodes: DiscoveryGraphNode[] = [
    { id: "reg_ai_act", nodeType: "regulation", label: "EU AI Act", layer: 5, metadata: { regulation_code: "EU 2024/1689", jurisdiction: "EU" } },
    { id: "reg_dora", nodeType: "regulation", label: "DORA", layer: 5, metadata: { regulation_code: "EU 2022/2554", jurisdiction: "EU" } },
    { id: "reg_lgpd", nodeType: "regulation", label: "LGPD", layer: 5, metadata: { regulation_code: "Lei 13.709/2018", jurisdiction: "Brazil" } },
    { id: "reg_gdpr", nodeType: "regulation", label: "GDPR", layer: 5, metadata: { regulation_code: "EU 2016/679", jurisdiction: "EU" } },
  ];
  for (const rn of regulationNodes) {
    nodes.push(rn);
  }

  for (const a of agentNodes) {
    if (a.enrichment?.aiActExposure && a.enrichment.aiActExposure !== "none" && a.enrichment.aiActExposure !== "minimal") {
      edges.push({ id: `${a.agent_id}-subject_to-ai_act`, source: a.agent_id, target: "reg_ai_act", type: "subject_to", metadata: {} });
    }
    if (a.enrichment?.doraExposure && isFinancial) {
      edges.push({ id: `${a.agent_id}-subject_to-dora`, source: a.agent_id, target: "reg_dora", type: "subject_to", metadata: {} });
    }
    if (a.enrichment?.containsPii && a.enrichment.trustZone === "production") {
      if (isBrazil) {
        edges.push({ id: `${a.agent_id}-subject_to-lgpd`, source: a.agent_id, target: "reg_lgpd", type: "subject_to", metadata: {} });
      } else if (isEuCountry || isUK) {
        edges.push({ id: `${a.agent_id}-subject_to-gdpr`, source: a.agent_id, target: "reg_gdpr", type: "subject_to", metadata: {} });
      }
    }
  }

  for (const s of systems) {
    const riskClass = s.risk_class as string;
    if (riskClass === "high" || riskClass === "unacceptable") {
      edges.push({ id: `${s.system_id}-subject_to-ai_act`, source: s.system_id as string, target: "reg_ai_act", type: "subject_to", metadata: {} });
    }
    if (isFinancial && (s.cg_sys_005_risk_mgmt === false || s.cg_sys_006_human_oversight === false)) {
      edges.push({ id: `${s.system_id}-subject_to-dora`, source: s.system_id as string, target: "reg_dora", type: "subject_to", metadata: {} });
    }
  }

  const repoMap = new Map<string, string[]>();
  for (const a of agents) {
    const discovery = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
    const repo = discovery?.repository as string | undefined;
    const ri = discovery?.repo_intelligence as Record<string, unknown> | undefined;
    if (repo && ri) {
      if (!repoMap.has(repo)) repoMap.set(repo, []);
      repoMap.get(repo)!.push(a.agent_code as string);
    }
  }

  for (const [repoName, agentCodes] of repoMap) {
    const sampleAgent = agents.find((a) => agentCodes.includes(a.agent_code as string));
    if (!sampleAgent) continue;
    const discovery = (sampleAgent.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
    const ri = (discovery?.repo_intelligence as Record<string, unknown> | undefined) ?? {};

    const result = buildDiscoveryGraph(nodes, edges, ri, repoName, agentCodes);
    nodes.splice(0, nodes.length, ...result.nodes);
    edges.splice(0, edges.length, ...result.edges);
  }

  const agentCount = agentNodes.length;
  const systemCount = nodes.filter((n) => !isAgentNode(n) && n.nodeType === "ai_system").length;
  const incidentCount = incidents.length;
  const findingCount = findings.length;
  const regulationCount = regulationNodes.length;
  const discCount = nodes.length - agentCount - systemCount - incidentCount - findingCount - regulationCount;

  const repoCount = nodes.filter((n) => !isAgentNode(n) && n.nodeType === "repository").length;
  const domainCount = nodes.filter((n) => !isAgentNode(n) && n.nodeType === "domain").length;
  const svcCount = nodes.filter((n) => !isAgentNode(n) && n.nodeType === "service").length;

  return {
    nodes,
    edges,
    agentCount,
    discoveryCount: discCount,
    systemCount,
    incidentCount,
    findingCount,
    regulationCount,
    summary: `Unified knowledge graph: ${nodes.length} nodes, ${edges.length} edges. ` +
      `${agentCount} agents, ${systemCount} systems, ${incidentCount} incidents, ` +
      `${findingCount} findings, ${repoCount} repos, ${domainCount} domains, ${svcCount} services.`,
  };
}
