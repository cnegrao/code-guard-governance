import { db } from "@/lib/db";
import { getUnifiedGraph, isAgentNode } from "@/services/knowledge-graph";
import type {
  UnifiedGraphNode,
  UnifiedGraphEdge,
  AgentGraphNode,
  DiscoveryGraphNode,
} from "@/services/knowledge-graph";

export interface GovernanceAnswer {
  answer: string;
  confidence: number;
  citations: Array<{ source: string; record: string; detail: string }>;
  supportingData: Record<string, unknown>[];
  intent: string;
  explanation: {
    source: string;
    intent_matched: string;
    rows_used: number;
    confidence_rationale: string;
  };
  evidence_count: number;
}

const INTENT_PRIORITY: string[] = [
  "open_incidents", "discovery", "what_repo_does", "repo_services",
  "repo_modules_agents", "repo_ai_providers", "repo_autonomous",
  "repo_pii_agents", "repo_financial_services", "repo_aml_workflows",
  "repo_fraud_agents", "repo_payments_domain",
  "personal_data_agents", "financial_data_agents",
  "credential_exposure", "external_sinks", "governance_findings", "dora_exposure",
  "autonomous_agents", "agents_without_owner",
  "high_risk_agents", "ai_act_exposure", "compliance_gaps",
  "violating_controls", "systems_failing_conformity", "dora_major_incidents",
  "unresolved_findings", "evidence_supports_risk", "why_agent_critical",
  "overview",
];

const HANDLERS: Array<{
  name: string;
  patterns: RegExp[];
  handler: (orgId: string) => Promise<GovernanceAnswer>;
}> = [
  {
    name: "high_risk_agents",
    patterns: [/high.risk.*agent|critical.*agent|most.*risk|riskiest/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, risk_level, oversight_level, status")
        .eq("organisation_id", orgId).in("risk_level", ["critical", "high"])
        .neq("status", "decommissioned").order("risk_level").throwOnError();
      const r = (data as Array<Record<string, string>>) ?? [];
      if (r.length === 0) return ans("No high-risk or critical agents found.", 95, [], r, "high_risk_agents", "Queried agents table for risk_level IN (critical, high). No matches.", 0);
      const list = r.map((a) => `${a.name} (${a.agent_code}) — ${a.risk_level}, ${a.oversight_level}`).join("\n");
      return ans(`${r.length} high-risk agents:\n${list}`, 95, r.map((a) => ({ source: "agents", record: a.agent_code, detail: `${a.risk_level} risk, ${a.oversight_level} oversight` })), r, "high_risk_agents", `Matched ${r.length} agents with risk_level critical or high from agents table.`, r.length);
    },
  },
  {
    name: "open_incidents",
    patterns: [/incident.*open|open.*incident|still.*open|unresolved/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("ict_incidents").select("incident_code, title, severity, status, occurred_at")
        .eq("organisation_id", orgId).not("status", "in", '("resolved","closed")')
        .order("occurred_at", { ascending: false }).limit(10).throwOnError();
      const r = (data as Array<Record<string, string>>) ?? [];
      if (r.length === 0) return ans("No open incident records returned; overall status is UNKNOWN.", 95, [], r, "open_incidents", "Queried ict_incidents. No open records returned; absence is not proof of resolution.", 0);
      const list = r.map((i) => `${i.incident_code}: ${i.title} (${i.severity}, ${i.status})`).join("\n");
      return ans(`${r.length} open incidents:\n${list}`, 95, r.map((i) => ({ source: "ict_incidents", record: i.incident_code, detail: `${i.severity}, ${i.status}` })), r, "open_incidents", `Matched ${r.length} incidents with status not resolved/closed.`, r.length);
    },
  },
  {
    name: "compliance_gaps",
    patterns: [/compliance.*gap|governance.*gap|not.*compliant|why.*compliance|what.*missing|top.*gap/i],
    handler: async (orgId) => {
      const { data } = await db.write.rpc("agent_compliance_gaps", { p_organisation_id: orgId }).throwOnError();
      const r = (data as Array<Record<string, unknown>>) ?? [];
      if (r.length === 0) return ans("No gap records returned. Compliance is NOT_ASSESSED.", 98, [], r, "compliance_gaps", "Ran agent_compliance_gaps(). Zero agents with gaps.", 0);
      const list = r.slice(0, 10).map((g) => `· ${g.agent_name} (${g.agent_code}) — ${g.total_gaps} gaps`).join("\n");
      return ans(`${r.length} agents with gaps. Top:\n${list}`, 90, r.slice(0, 10).map((g) => ({ source: "agent_compliance_gaps", record: g.agent_code as string, detail: `${g.total_gaps} gaps` })), r, "compliance_gaps", `agent_compliance_gaps() returned ${r.length} non-compliant agents.`, r.length);
    },
  },
  {
    name: "ai_act_exposure",
    patterns: [/ai act|high.risk.*system|annex.*iii|regulatory.*exposure/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("ai_systems").select("system_code, name, risk_class, lifecycle, status")
        .eq("organisation_id", orgId).in("risk_class", ["high", "unacceptable"])
        .neq("status", "decommissioned").throwOnError();
      const r = (data as Array<Record<string, string>>) ?? [];
      const { count: wo } = await db.write.from("agents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).is("ai_system_id", null).neq("status", "decommissioned").throwOnError();
      const answer = [`${r.length} high-risk AI systems (AI Act Annex III).`, `${wo ?? 0} agents not linked to any AI system.`, r.length > 0 ? `Systems: ${r.map((s) => s.name).join(", ")}` : ""].filter(Boolean).join("\n");
      return ans(answer, 92, r.map((s) => ({ source: "ai_systems", record: s.system_code, detail: s.risk_class })), r, "ai_act_exposure", `Queried ai_systems for risk_class IN (high, unacceptable). ${r.length} matched.`, r.length);
    },
  },
  {
    name: "agents_without_owner",
    patterns: [/without.*owner|no.*owner|orphan.*agent|missing.*owner|unowned/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, risk_level, status, cg_ag_002_owner")
        .eq("organisation_id", orgId).eq("cg_ag_002_owner", false)
        .neq("status", "decommissioned").throwOnError();
      const r = (data as Array<Record<string, string>>) ?? [];
      if (r.length === 0) return ans("No missing-owner records returned. Ownership coverage is UNKNOWN.", 95, [], r, "agents_without_owner", "Queried agents where cg_ag_002_owner = false. Zero results.", 0);
      const list = r.map((a) => `${a.name} (${a.agent_code}) — ${a.risk_level}`).join("\n");
      return ans(`${r.length} agents without owner:\n${list}`, 90, r.map((a) => ({ source: "agents", record: a.agent_code, detail: `Owner flag: false` })), r, "agents_without_owner", `Found ${r.length} agents with cg_ag_002_owner = false.`, r.length);
    },
  },
  {
    name: "autonomous_agents",
    patterns: [/autonomous.*agent|self.*operating|without.*human/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, oversight_level, cg_ag_012_autonomous_governed, status")
        .eq("organisation_id", orgId).eq("agent_type", "autonomous")
        .neq("status", "decommissioned").throwOnError();
      const r = (data as Array<Record<string, unknown>>) ?? [];
      if (r.length === 0) return ans("No autonomous agents registered.", 95, [], r, "autonomous_agents", "Queried agents with agent_type = autonomous. No results.", 0);
      const governed = r.filter((a) => a.cg_ag_012_autonomous_governed).length;
      const list = r.map((a) => `· ${a.name} (${a.agent_code}) — oversight: ${a.oversight_level}, governed: ${a.cg_ag_012_autonomous_governed}`).join("\n");
      return ans(`${r.length} autonomous agents. ${governed}/${r.length} governed.\n${list}`, 90, r.map((a) => ({ source: "agents", record: a.agent_code as string, detail: `oversight: ${a.oversight_level}` })), r, "autonomous_agents", `Queried agents where agent_type = autonomous. ${governed} of ${r.length} have CG-AG-012 governance.`, r.length);
    },
  },
  {
    name: "discovery",
    patterns: [/discover|unregistered|scanned.*agent|agent.*discovered|which.*repositor/i],
    handler: async (orgId) => {
      const { data: pending } = await db.write
        .from("agents").select("agent_code, name, agent_type, risk_level, external_refs, created_at")
        .eq("organisation_id", orgId).eq("status", "pending_registration")
        .not("external_refs", "is", null).order("created_at", { ascending: false }).throwOnError();
      const p = (pending as Array<Record<string, unknown>>) ?? [];
      const { count: total } = await db.write
        .from("agents").select("*", { count: "exact", head: true })
        .eq("organisation_id", orgId).not("external_refs", "is", null).throwOnError();
      if (p.length === 0) return ans("No discovered agents pending review.", 95, [], p, "discovery", "No agents with status pending_registration and external_refs set.", 0);
      const repos = new Set(p.map((a: Record<string, unknown>) => ((a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, string>)?.repository).filter(Boolean));
      const list = p.slice(0, 8).map((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        return `· ${a.name} (${a.agent_code}) — ${d?.framework ?? "unknown"}`;
      }).join("\n");
      return ans(`${p.length} agents pending review from ${repos.size} repos. Total discovered: ${total ?? 0}.\n${list}`, 90, p.slice(0, 8).map((a) => ({ source: "agents", record: a.agent_code as string, detail: "Pending review" })), p, "discovery", `Queried agents with status=pending_registration and discovery metadata. ${p.length} found.`, p.length);
    },
  },
  {
    name: "personal_data_agents",
    patterns: [/personal.*data|PII.*agent|data.*privacy.*agent|LGPD.*agent|process.*personal/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const pii = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.enrichment?.containsPii);
      if (pii.length === 0) return ans("No agents processing personal data detected.", 95, [], pii as unknown as Record<string, unknown>[], "personal_data_agents", "Scanned knowledge graph enrichment.containsPii. No matches.", 0);
      const list = pii.map((a) => `· ${a.name} (${a.agent_code}) — risk: ${a.risk_level}`).join("\n");
      return ans(`${pii.length} agents process personal data (PII).\n${list}`, 90, pii.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "Contains PII" })), pii as unknown as Record<string, unknown>[], "personal_data_agents", `Scanned ${graph.agentCount} agents via knowledge graph. ${pii.length} matched.`, pii.length);
    },
  },
  {
    name: "financial_data_agents",
    patterns: [/financial.*data|payment.*agent|banking.*agent|credit.*agent|transaction.*agent/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const fin = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.enrichment?.containsFinancial);
      if (fin.length === 0) return ans("No agents processing financial data detected.", 95, [], fin as unknown as Record<string, unknown>[], "financial_data_agents", "Scanned knowledge graph enrichment.containsFinancial. No matches.", 0);
      const list = fin.map((a) => `· ${a.name} (${a.agent_code}) — risk: ${a.risk_level}`).join("\n");
      return ans(`${fin.length} agents process financial data.\n${list}`, 90, fin.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "Financial data" })), fin as unknown as Record<string, unknown>[], "financial_data_agents", `Scanned ${graph.agentCount} agents via knowledge graph. ${fin.length} matched.`, fin.length);
    },
  },
  {
    name: "credential_exposure",
    patterns: [/credential.*expos|expos.*credential|api.*key.*expos|hardcoded.*secret|agent.*secret/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, risk_level, external_refs, status")
        .eq("organisation_id", orgId).not("external_refs", "is", null)
        .neq("status", "decommissioned").order("created_at", { ascending: false }).throwOnError();
      const all = (data as Array<Record<string, unknown>>) ?? [];
      const creds = all.filter((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lgpd = d?.lgpd as Record<string, unknown> | undefined;
        return lgpd?.credentialExposure === true || ((d?.lineage as Record<string, unknown>)?.containsCredentials === true);
      });
      if (creds.length === 0) return ans("No credential exposure detected in agent code.", 95, [], creds, "credential_exposure", "Scanned external_refs.discovery.lgpd.credentialExposure and lineage. No matches.", 0);
      const list = creds.map((a: Record<string, unknown>) => `· ${a.name} (${a.agent_code}) — risk: ${a.risk_level}`).join("\n");
      return ans(`${creds.length} agents have credential exposure risks.\n${list}`, 90, creds.map((a) => ({ source: "agents", record: a.agent_code as string, detail: "Credential exposure" })), creds, "credential_exposure", `Scanned ${all.length} agents for credential exposure. ${creds.length} matched.`, creds.length);
    },
  },
  {
    name: "external_sinks",
    patterns: [/external.*sink|send.*data.*external|data.*leaving|outbound.*api|data.*egress|sink.*detected/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, risk_level, external_refs, status")
        .eq("organisation_id", orgId).not("external_refs", "is", null)
        .neq("status", "decommissioned").order("created_at", { ascending: false }).throwOnError();
      const all = (data as Array<Record<string, unknown>>) ?? [];
      const sinks = all.filter((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lineage = d?.lineage as Record<string, unknown> | undefined;
        const extSinks = lineage?.externalSinks as string[] | undefined;
        return extSinks && extSinks.length > 0;
      });
      if (sinks.length === 0) return ans("No external data sinks detected.", 95, [], sinks, "external_sinks", "Scanned external_refs.discovery.lineage.externalSinks. No matches.", 0);
      const list = sinks.map((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lineage = d?.lineage as Record<string, unknown> | undefined;
        const count = (lineage?.externalSinks as string[] | undefined)?.length ?? 0;
        return `· ${a.name} (${a.agent_code}) — ${count} external sinks`;
      }).join("\n");
      return ans(`${sinks.length} agents have external data sinks.\n${list}`, 90, sinks.map((a) => ({ source: "agents", record: a.agent_code as string, detail: "External sinks" })), sinks, "external_sinks", `Scanned ${all.length} agents for external sinks. ${sinks.length} matched.`, sinks.length);
    },
  },
  {
    name: "governance_findings",
    patterns: [/governance.*finding|finding.*governance|agent.*finding|compliance.*finding|LGPD.*finding|issue.*agent/i],
    handler: async (orgId) => {
      const { data } = await db.write
        .from("agents").select("agent_code, name, risk_level, external_refs, status")
        .eq("organisation_id", orgId).not("external_refs", "is", null)
        .neq("status", "decommissioned").order("created_at", { ascending: false }).throwOnError();
      const all = (data as Array<Record<string, unknown>>) ?? [];
      const findings = all.filter((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lgpd = d?.lgpd as Record<string, unknown> | undefined;
        const findings = lgpd?.findings as Array<Record<string, string>> | undefined;
        return findings && findings.length > 0;
      });
      if (findings.length === 0) return ans("No governance findings in agent code.", 95, [], findings, "governance_findings", "Scanned external_refs.discovery.lgpd.findings. No results.", 0);
      const totalFindings = findings.reduce((sum: number, a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lgpd = d?.lgpd as Record<string, unknown> | undefined;
        const f = lgpd?.findings as unknown[] | undefined;
        return sum + (f?.length ?? 0);
      }, 0);
      const critical = findings.filter((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lgpd = d?.lgpd as Record<string, unknown> | undefined;
        const f = lgpd?.findings as Array<Record<string, string>> | undefined;
        return f?.some((x) => x.severity === "critical") ?? false;
      });
      const list = findings.slice(0, 8).map((a: Record<string, unknown>) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>>)?.discovery as Record<string, unknown> | undefined;
        const lgpd = d?.lgpd as Record<string, unknown> | undefined;
        const f = lgpd?.findings as Array<Record<string, string>> | undefined;
        return `· ${a.name} (${a.agent_code}) — ${f?.length ?? 0} findings`;
      }).join("\n");
      return ans(`${findings.length} agents have governance findings (${totalFindings} total, ${critical.length} with critical).\n${list}`, 90, findings.slice(0, 8).map((a) => ({ source: "agents", record: a.agent_code as string, detail: "Governance findings" })), findings, "governance_findings", `Scanned ${all.length} agents for LGPD findings. ${findings.length} with findings.`, findings.length);
    },
  },
  {
    name: "dora_exposure",
    patterns: [/DORA.*expos|expos.*DORA|operational.*resilience.*agent|ICT.*risk.*agent|DORA.*agent/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const dora = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.enrichment?.doraExposure);
      if (dora.length === 0) return ans("No agents with DORA exposure detected.", 95, [], dora as unknown as Record<string, unknown>[], "dora_exposure", "Scanned knowledge graph enrichment.doraExposure. No matches.", 0);
      const list = dora.map((a) => `· ${a.name} (${a.agent_code}) — risk: ${a.risk_level}`).join("\n");
      return ans(`${dora.length} agents have DORA exposure (Digital Operational Resilience Act).\n${list}`, 90, dora.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "DORA exposure" })), dora as unknown as Record<string, unknown>[], "dora_exposure", `Scanned ${graph.agentCount} agents via knowledge graph. ${dora.length} matched.`, dora.length);
    },
  },
  {
    name: "what_repo_does",
    patterns: [/what.*repositor.*do|what.*repo.*about|describe.*repositor|what.*project.*do|explain.*repositor|summarize.*repositor/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const repoNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "repository") as DiscoveryGraphNode[];
      if (repoNodes.length === 0) return ans("No repositories have been scanned yet. Scan a repository to build intelligence.", 85, [], [], "what_repo_does", "No repository nodes found in unified knowledge graph.", 0);
      const list = repoNodes.map((r) => `· ${r.label} (${r.metadata.trustZone ?? "unknown"}): ${r.metadata.agentCount ?? 0} agents`).join("\n");
      return ans(`${repoNodes.length} repositories scanned:\n${list}`, 90, repoNodes.map((r) => ({ source: "knowledge-graph", record: r.label, detail: "repository" })), repoNodes as unknown as Record<string, unknown>[], "what_repo_does", `Queried unified knowledge graph for repository nodes. ${repoNodes.length} found.`, repoNodes.length);
    },
  },
  {
    name: "repo_services",
    patterns: [/which.*service.*process|which.*service.*handl|service.*exist|what.*service/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const svcNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "service") as DiscoveryGraphNode[];
      if (svcNodes.length === 0) return ans("No services detected in scanned repositories.", 85, [], [], "repo_services", "No service nodes in unified knowledge graph.", 0);
      const list = svcNodes.map((s) => {
        const agentEdges = graph.edges.filter((e) => e.target === s.id && e.type === "belongs_to");
        return `· ${s.label} (${agentEdges.length} agents)`;
      }).join("\n");
      return ans(`${svcNodes.length} services detected:\n${list}`, 90, svcNodes.map((s) => ({ source: "knowledge-graph", record: s.label, detail: "service" })), svcNodes as unknown as Record<string, unknown>[], "repo_services", `Queried unified knowledge graph for service nodes. ${svcNodes.length} found.`, svcNodes.length);
    },
  },
  {
    name: "repo_modules_agents",
    patterns: [/which.*module.*agent|agent.*module|module.*contain.*agent|agent.*belong/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const agentNodes = graph.nodes.filter(isAgentNode);
      if (agentNodes.length === 0) return ans("No AI agents detected in repositories.", 85, [], [], "repo_modules_agents", "No agent nodes in unified knowledge graph.", 0);
      const agentList = agentNodes.map((a) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
        return { name: a.name, code: a.agent_code, type: a.agent_type, filePath: d?.filePath as string };
      });
      const byModule = agentList.reduce((acc, a) => {
        const dir = a.filePath ? a.filePath.split("/").slice(0, -1).join("/") || "root" : "root";
        if (!acc[dir]) acc[dir] = [];
        acc[dir].push(a);
        return acc;
      }, {} as Record<string, typeof agentList>);
      const entries = Object.entries(byModule).slice(0, 8);
      const list = entries.map(([mod, ags]) => `· ${mod}: ${ags.map((ag) => ag.name).join(", ")}`).join("\n");
      return ans(`${agentNodes.length} agents across ${Object.keys(byModule).length} modules:\n${list}`, 90, agentNodes.slice(0, 8).map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: a.name })), entries.map(([k, v]) => ({ module: k, agents: v })), "repo_modules_agents", `Grouped ${agentNodes.length} agents by directory from knowledge graph nodes.`, agentNodes.length);
    },
  },
  {
    name: "repo_ai_providers",
    patterns: [/which.*agent.*call.*(?:openai|anthropic|llm|AI|GPT|claude)|agent.*use.*(?:openai|anthropic|llm|AI|GPT|claude)|which.*AI.*provider/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const agentNodes = graph.nodes.filter(isAgentNode);
      const aiAgents = agentNodes.filter((a) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
        const framework = d?.framework as string | undefined;
        return framework && /openai|anthropic|claude|llm|GPT|deepseek|openrouter|groq|cohere|mistral|ollama/i.test(framework);
      });
      if (aiAgents.length === 0) return ans("No agents detected using external AI providers.", 85, [], [], "repo_ai_providers", "No agents with AI provider framework in knowledge graph.", 0);
      const byProvider = aiAgents.reduce((acc: Record<string, string[]>, a) => {
        const d = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
        const fw = d?.framework as string ?? "unknown";
        if (!acc[fw]) acc[fw] = [];
        acc[fw].push(a.name);
        return acc;
      }, {});
      const list = Object.entries(byProvider).map(([fw, names]) => `· ${fw}: ${names.join(", ")}`).join("\n");
      return ans(`${aiAgents.length} agents use AI providers:\n${list}`, 90, aiAgents.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: a.name })), Object.entries(byProvider).map(([k, v]) => ({ provider: k, agents: v })), "repo_ai_providers", `Found ${aiAgents.length} agents with AI provider frameworks via knowledge graph.`, aiAgents.length);
    },
  },
  {
    name: "repo_autonomous",
    patterns: [/which.*repositor.*autonomous|autonomous.*repositor|repo.*self.*operating|repo.*fully.*autonomous/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const autonomous = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && (n.agent_type === "autonomous" || (n.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery?.isAutonomous === true));
      if (autonomous.length === 0) return ans("No autonomous agents detected in any repository.", 95, [], [], "repo_autonomous", "No autonomous agents found in knowledge graph.", 0);
      const byRepo: Record<string, string[]> = {};
      for (const a of autonomous) {
        const d = (a.external_refs as Record<string, Record<string, unknown>> | undefined)?.discovery as Record<string, unknown> | undefined;
        const repo = d?.repository as string ?? "unknown";
        if (!byRepo[repo]) byRepo[repo] = [];
        byRepo[repo].push(`${a.name} (${a.agent_code})`);
      }
      const list = Object.entries(byRepo).map(([repo, names]) => `· ${repo}: ${names.join(", ")}`).join("\n");
      return ans(`${autonomous.length} autonomous agents across ${Object.keys(byRepo).length} repos:\n${list}`, 90, autonomous.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "autonomous" })), Object.entries(byRepo).map(([k, v]) => ({ repository: k, agents: v })), "repo_autonomous", `Found ${autonomous.length} autonomous agents across ${Object.keys(byRepo).length} repos via knowledge graph.`, autonomous.length);
    },
  },
  {
    name: "repo_pii_agents",
    patterns: [/which.*(?:agent|repositor).*PII|PII.*agent|personal.*data.*agent.*repo|agent.*sensitive.*repo/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const pii = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.enrichment?.containsPii);
      if (pii.length === 0) return ans("No agents processing PII detected in any repository.", 95, [], [], "repo_pii_agents", "No agents with enrichment.containsPii in knowledge graph.", 0);
      const list = pii.map((a) => `· ${a.name} (${a.agent_code}) — ${a.enrichment?.trustZone ?? "unknown"}`).join("\n");
      return ans(`${pii.length} agents process PII:\n${list}`, 90, pii.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "PII" })), pii as unknown as Record<string, unknown>[], "repo_pii_agents", `Found ${pii.length} agents with enrichment.containsPii via knowledge graph.`, pii.length);
    },
  },
  {
    name: "repo_financial_services",
    patterns: [/which.*(?:service|agent).*financial|financial.*(?:service|agent)|handl.*financial/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const fin = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && (!!n.enrichment?.containsFinancial || !!n.enrichment?.financialServices));
      if (fin.length === 0) return ans("No services handling financial data detected.", 95, [], [], "repo_financial_services", "No financial data agents found in knowledge graph.", 0);
      const list = fin.map((a) => `· ${a.name} (${a.agent_code})`).join("\n");
      return ans(`${fin.length} services handle financial data:\n${list}`, 90, fin.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "financial" })), fin as unknown as Record<string, unknown>[], "repo_financial_services", `Found ${fin.length} financial data agents via knowledge graph enrichment.`, fin.length);
    },
  },
  {
    name: "repo_aml_workflows",
    patterns: [/AML.*workflow|workflow.*AML|anti.?money.*laundering|KYC.*agent|suspicious.*activity|AML.*agent|show.*AML/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const aml = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.business_domain && /aml|fraud/i.test(n.business_domain!));
      if (aml.length === 0) return ans("No AML-related agents detected.", 95, [], [], "repo_aml_workflows", "No agents with AML/fraud business_domain in knowledge graph.", 0);
      const list = aml.map((a) => `· ${a.name} (${a.agent_code}) — ${a.business_domain}`).join("\n");
      return ans(`${aml.length} agents in AML/fraud domains:\n${list}`, 90, aml.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "AML/fraud" })), aml as unknown as Record<string, unknown>[], "repo_aml_workflows", `Found ${aml.length} AML/fraud domain agents via knowledge graph.`, aml.length);
    },
  },
  {
    name: "repo_fraud_agents",
    patterns: [/fraud.*agent|agent.*fraud|fraud.*detect|fraud.*related|show.*fraud/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const fraud = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.business_domain && /fraud/i.test(n.business_domain!));
      if (fraud.length === 0) return ans("No fraud-related agents detected.", 95, [], [], "repo_fraud_agents", "No fraud domain agents in knowledge graph.", 0);
      const list = fraud.map((a) => `· ${a.name} (${a.agent_code}) — ${a.agent_type}`).join("\n");
      return ans(`${fraud.length} fraud-related agents:\n${list}`, 90, fraud.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "fraud" })), fraud as unknown as Record<string, unknown>[], "repo_fraud_agents", `Found ${fraud.length} fraud domain agents via knowledge graph.`, fraud.length);
    },
  },
  {
    name: "repo_payments_domain",
    patterns: [/payment.*agent|agent.*payment.*domain|payment.*domain|agent.*belong.*payment/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const payments = graph.nodes.filter((n): n is AgentGraphNode => isAgentNode(n) && !!n.business_domain && /payment/i.test(n.business_domain!));
      if (payments.length === 0) return ans("No agents in the payments domain.", 95, [], [], "repo_payments_domain", "No payments domain agents in knowledge graph.", 0);
      const list = payments.map((a) => `· ${a.name} (${a.agent_code})`).join("\n");
      return ans(`${payments.length} agents in the payments domain:\n${list}`, 90, payments.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "payments" })), payments as unknown as Record<string, unknown>[], "repo_payments_domain", `Found ${payments.length} payments domain agents via knowledge graph.`, payments.length);
    },
  },
  {
    name: "violating_controls",
    patterns: [/violat.*control|control.*violat|which.*control.*fail|agent.*breach|governance.*breach|non.?compliant.*control/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const controlEdges = graph.edges.filter((e) => e.type === "violates");
      const agentsWithViolations = new Set(controlEdges.map((e) => e.source));
      const agentList = graph.nodes.filter(isAgentNode).filter((a) => agentsWithViolations.has(a.agent_id));
      if (agentList.length === 0) return ans("No legacy violation records returned. Control effectiveness is NOT_ASSESSED.", 95, [], [], "violating_controls", "Scanned knowledge graph for violates edges. None found.", 0);
      const list = agentList.map((a) => {
        const violations = controlEdges.filter((e) => e.source === a.agent_id).length;
        return `· ${a.name} (${a.agent_code}) — ${violations} control violations`;
      }).join("\n");
      return ans(`${agentList.length} agents with control violations:\n${list}`, 90, agentList.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: "Control violations" })), agentList as unknown as Record<string, unknown>[], "violating_controls", `Found ${agentList.length} agents with violates edges in knowledge graph.`, agentList.length);
    },
  },
  {
    name: "systems_failing_conformity",
    patterns: [/system.*(?:fail|non.?compliant|not.*conform|without.*conform|conformity.*missing)|which.*system.*conform/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const sysNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "ai_system") as DiscoveryGraphNode[];
      const failing = sysNodes.filter((s) => s.metadata?.cg_sys_007_conformity === false || s.metadata?.conformity_procedure === null);
      if (failing.length === 0) return ans("No failing system records returned. Regulatory conformity is NOT_ASSESSED.", 95, [], [], "systems_failing_conformity", "Checked legacy system flags; this does not establish regulatory conformity.", 0);
      const list = failing.map((s) => `· ${s.label} — conformity: ${s.metadata?.conformity_procedure ?? "none"}, risk: ${s.metadata?.risk_class ?? "unknown"}`).join("\n");
      return ans(`${failing.length} AI systems failing conformity requirements:\n${list}`, 90, failing.map((s) => ({ source: "knowledge-graph", record: s.label, detail: "Failing conformity" })), failing as unknown as Record<string, unknown>[], "systems_failing_conformity", `Found ${failing.length} ai_system nodes with missing conformity.`, failing.length);
    },
  },
  {
    name: "dora_major_incidents",
    patterns: [/dora.*major|major.*incident|dora.*incident|critical.*incident.*dora|show.*dora.*incident/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const incNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "incident") as DiscoveryGraphNode[];
      const major = incNodes.filter((i) => i.metadata?.is_major_incident === true);
      if (major.length === 0) return ans("No major DORA incidents currently open.", 95, [], [], "dora_major_incidents", "Scanned incident nodes for is_major_incident flag. None found.", 0);
      const list = major.map((i) => {
        const deps = graph.edges.filter((e) => e.source === i.id && e.type === "affects").length;
        return `· ${i.label} — ${i.metadata?.severity ?? "unknown"}, affects ${deps} agents`;
      }).join("\n");
      return ans(`${major.length} major DORA incidents:\n${list}`, 90, major.map((i) => ({ source: "knowledge-graph", record: i.label, detail: "Major incident" })), major as unknown as Record<string, unknown>[], "dora_major_incidents", `Found ${major.length} major incidents via graph incident nodes.`, major.length);
    },
  },
  {
    name: "unresolved_findings",
    patterns: [/unresolved.*finding|open.*finding|finding.*open|show.*finding|what.*finding|pending.*finding/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const findingNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "finding") as DiscoveryGraphNode[];
      if (findingNodes.length === 0) return ans("No unresolved findings.", 95, [], [], "unresolved_findings", "Counted finding nodes in graph. None found.", 0);
      const critical = findingNodes.filter((f) => f.metadata?.severity === "critical");
      const list = findingNodes.slice(0, 10).map((f) => `· ${f.label} (${f.metadata?.severity ?? "unknown"})`).join("\n");
      return ans(`${findingNodes.length} unresolved findings (${critical.length} critical).\n${list}`, 90, findingNodes.slice(0, 10).map((f) => ({ source: "knowledge-graph", record: f.label, detail: `severity: ${f.metadata?.severity ?? "unknown"}` })), findingNodes as unknown as Record<string, unknown>[], "unresolved_findings", `Retrieved ${findingNodes.length} finding nodes from graph.`, findingNodes.length);
    },
  },
  {
    name: "evidence_supports_risk",
    patterns: [/evidence.*risk|risk.*evidence|what.*evidence|evidence.*support|why.*risk.*base|show.*evidence/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const evNodes = graph.nodes.filter((n) => !isAgentNode(n) && n.nodeType === "evidence") as DiscoveryGraphNode[];
      if (evNodes.length === 0) return ans("No evidence nodes in the knowledge graph.", 95, [], [], "evidence_supports_risk", "Counted evidence nodes. None found.", 0);
      const list = evNodes.slice(0, 10).map((e) => {
        const supportedEdges = graph.edges.filter((ed) => ed.source === e.id && ed.type === "supports");
        const targets = supportedEdges.map((ed) => {
          const targetNode = graph.nodes.find((n) => isAgentNode(n) && n.agent_id === ed.target);
          return targetNode && isAgentNode(targetNode) ? targetNode.name : ed.target;
        }).join(", ");
        return `· ${e.label} → supports: ${targets || "agent"}`;
      }).join("\n");
      return ans(`${evNodes.length} evidence items supporting risk classifications.\n${list}`, 90, evNodes.slice(0, 10).map((e) => ({ source: "knowledge-graph", record: e.label, detail: "Evidence" })), evNodes as unknown as Record<string, unknown>[], "evidence_supports_risk", `Found ${evNodes.length} evidence nodes with supports edges in graph.`, evNodes.length);
    },
  },
  {
    name: "why_agent_critical",
    patterns: [/why.*(?:is|does).*(agent|system).*(?:critical|high.risk|problem|issue)|explain.*(?:agent|system).*(?:risk|critical)|agent.*(?:X|critical).*trace|what.*make.*(?:agent|system).*critical/i],
    handler: async (orgId) => {
      const graph = await getUnifiedGraph(orgId);
      const criticalAgents = graph.nodes.filter((n) => isAgentNode(n) && (n.risk_level === "critical" || n.risk_level === "high") && n.enrichment?.complianceExposure === "critical") as AgentGraphNode[];
      if (criticalAgents.length === 0) return ans("No agents with critical compliance exposure found.", 95, [], [], "why_agent_critical", "Filtered agent nodes by risk_level and complianceExposure. None critical.", 0);
      const details = criticalAgents.slice(0, 5).map((a) => {
        const violations = graph.edges.filter((e) => e.source === a.agent_id && e.type === "violates").length;
        const regulations = graph.edges.filter((e) => e.source === a.agent_id && e.type === "subject_to").length;
        const evidenceItems = graph.edges.filter((e) => e.target === a.agent_id && e.type === "supports").length;
        const findings = graph.edges.filter((e) => e.source.startsWith("finding") && e.target === a.agent_id && e.type === "relates_to").length;
        return `· ${a.name} (${a.agent_code})
  Risk: ${a.risk_level} | Compliance: ${a.enrichment?.complianceExposure ?? "none"} | Governance: ${a.enrichment?.governancePriority ?? "none"}
  Violations: ${violations} controls | Regulations: ${regulations} | Evidence: ${evidenceItems} | Findings: ${findings}`;
      }).join("\n");
      return ans(`${criticalAgents.length} agents with critical compliance exposure.\n${details}`, 90, criticalAgents.map((a) => ({ source: "knowledge-graph", record: a.agent_code, detail: `critical: violations=${graph.edges.filter((e) => e.source === a.agent_id && e.type === "violates").length}` })), criticalAgents as unknown as Record<string, unknown>[], "why_agent_critical", `Traced ${criticalAgents.length} critical agents through graph edges.`, criticalAgents.length);
    },
  },
  {
    name: "overview",
    patterns: [/overview|summary|estate|how many|total|count|status|which agent/i],
    handler: async (orgId) => {
      const [{ count: agents }, { count: systems }, { count: incidents }] = await Promise.all([
        db.write.from("agents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),
        db.write.from("ai_systems").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).neq("status", "decommissioned").throwOnError(),
        db.write.from("ict_incidents").select("*", { count: "exact", head: true }).eq("organisation_id", orgId).not("status", "in", '("resolved","closed")').throwOnError(),
      ]);
      return ans(`AI Governance Estate: ${agents ?? 0} agents, ${systems ?? 0} systems, ${incidents ?? 0} open incidents.`, 85, [{ source: "agents+systems+incidents", record: "aggregate", detail: "Live counts" }], [{ agents: agents ?? 0, systems: systems ?? 0, incidents: incidents ?? 0 }], "overview", "Aggregated counts from agents, ai_systems, and ict_incidents tables.", 3);
    },
  },
];

function ans(answer: string, confidence: number, citations: Array<{ source: string; record: string; detail: string }>, data: Record<string, unknown>[], intent: string, rationale: string, rowsUsed: number): GovernanceAnswer {
  return { answer, confidence, citations, supportingData: data, intent, explanation: { source: "operational_legacy", intent_matched: intent, rows_used: rowsUsed, confidence_rationale: rationale }, evidence_count: citations.length };
}

function matchIntent(query: string): { intent: string; confidence: number } {
  for (const name of INTENT_PRIORITY) {
    const h = HANDLERS.find((h) => h.name === name)!;
    for (const pattern of h.patterns) {
      if (pattern.test(query)) {
        if (name === "overview") return { intent: name, confidence: 70 };
        return { intent: name, confidence: 88 };
      }
    }
  }
  return { intent: "overview", confidence: 60 };
}

export async function executeQuery(orgId: string, query: string): Promise<GovernanceAnswer> {
  const match = matchIntent(query);
  const handler = HANDLERS.find((i) => i.name === match.intent) ?? HANDLERS.find((i) => i.name === "overview")!;
  const result = await handler.handler(orgId);

  return {
    ...result,
    confidence: match.intent === "overview" && match.confidence === 60
      ? Math.min(result.confidence, match.confidence)
      : result.confidence,
  };
}

export { HANDLERS };

export interface GovernanceEvidence {
  type: string;
  source: string;
  record: string;
  fields: Record<string, unknown>;
}

export async function buildGovernanceContext(orgId: string): Promise<GovernanceEvidence[]> {
  const evidence: GovernanceEvidence[] = [];

  const [{ data: agents }, { data: systems }, { data: gaps }, { data: incidents }] = await Promise.all([
    db.write.from("agents").select("agent_code, name, risk_level, agent_type, oversight_level, status, cg_ag_002_owner, cg_ag_008_audit_trail").eq("organisation_id", orgId).neq("status", "decommissioned").limit(15).throwOnError(),
    db.write.from("ai_systems").select("system_code, name, risk_class, lifecycle, status").eq("organisation_id", orgId).neq("status", "decommissioned").limit(10).throwOnError(),
    db.write.rpc("agent_compliance_gaps", { p_organisation_id: orgId }).throwOnError(),
    db.write.from("ict_incidents").select("incident_code, title, severity, status, occurred_at").eq("organisation_id", orgId).not("status", "in", '("resolved","closed")').order("occurred_at", { ascending: false }).limit(5).throwOnError(),
  ]);

  for (const a of (agents as Array<Record<string, unknown>>) ?? []) {
    evidence.push({ type: "agent", source: "agents", record: a.agent_code as string, fields: a });
  }
  for (const s of (systems as Array<Record<string, unknown>>) ?? []) {
    evidence.push({ type: "system", source: "ai_systems", record: s.system_code as string, fields: s });
  }
  for (const g of ((gaps as Array<Record<string, unknown>>) ?? []).slice(0, 10)) {
    evidence.push({ type: "gap", source: "agent_compliance_gaps", record: g.agent_code as string, fields: g });
  }
  for (const i of (incidents as Array<Record<string, unknown>>) ?? []) {
    evidence.push({ type: "incident", source: "ict_incidents", record: i.incident_code as string, fields: i });
  }

  return evidence.slice(0, 15);
}

export async function semanticSearch(orgId: string, embedding: number[], limit: number = 10): Promise<GovernanceEvidence[]> {
  const { data } = await db.write.rpc("agent_semantic_search", {
    p_query_embedding: embedding,
    p_organisation_id: orgId,
    p_limit: limit,
    p_similarity_threshold: 0.65,
  }).throwOnError();

  const results = (data as Array<Record<string, unknown>>) ?? [];
  return results.map((r) => ({
    type: "semantic",
    source: "agent_embeddings",
    record: r.agent_code as string,
    fields: r,
  }));
}

export function formatContextForLLM(evidence: GovernanceEvidence[]): string {
  return evidence.map((e) => {
    const label = `${e.type.toUpperCase()}: ${e.record}`;
    const fields = Object.entries(e.fields)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n");
    return `${label}\n${fields}`;
  }).join("\n\n");
}