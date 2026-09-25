import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { getProvider } from "@/lib/discovery/providers";
import { detectAgents } from "@council/scanner/codeguard/agent-detector";
import { groupAgentsIntoLSystems } from "@council/scanner/codeguard/system-detector";
import { classifyAgent } from "@council/scanner/codeguard/classifier";
import { enrichAgent, enrichSummary } from "@council/scanner/codeguard/enrichment";
import { generateRepoIntelligence } from "@council/scanner/codeguard/repo-intelligence";
import { buildKnowledgeGraph } from "@council/scanner/codeguard/repo-knowledge-graph";
import { indexRepoIntelligence, indexAgentCode } from "@/services/coding-memory";
import { db } from "@/lib/db";
import { traceCrossFileLineage } from "@council/scanner/codeguard/enrichment/cross-file-lineage";
import type { DiscoveryResult } from "@council/scanner/codeguard/types";

async function logToLedger(orgId: string, userId: string, event: string, payload: Record<string, unknown>) {
  try {
    await db.write.rpc("ledger_append", {
      p_event_type: event,
      p_event_desc: (payload.summary as string)?.slice(0, 200) ?? event,
      p_subject_type: "discovery",
      p_subject_id: userId,
      p_actor_user_id: userId,
      p_actor_ip: null,
      p_organisation_id: orgId,
      p_payload: payload,
    });
  } catch {}
}

export async function POST(request: Request) {
  try {
    const { organisationId: orgId, userId } = await requireVerifiedGovernancePrincipal();
    const { provider, owner, repo, branch, token, baseUrl } = await request.json();

    if (!provider || !owner || !repo) {
      return NextResponse.json({ error: "provider, owner, and repo are required" }, { status: 400 });
    }

    const repositoryName = `${owner}/${repo}`;
    const repositoryId = `repo_${owner}_${repo}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

    await logToLedger(orgId, userId, "discovery.scan.started", {
      provider, repository: repositoryName, branch: branch ?? "main",
    });

    const repoProvider = getProvider(provider, token, baseUrl);
    const files = await repoProvider.fetchFiles(owner, repo, branch ?? "main");

    const readFile = async (path: string) => repoProvider.fetchFileContent(owner, repo, path, branch ?? "main");

    const agents = await detectAgents(files, readFile);
    const systems = groupAgentsIntoLSystems(agents);

    const repoIntel = await generateRepoIntelligence(
      repositoryName,
      files.map((f) => ({ path: f.path, name: f.name })),
      agents,
      readFile
    );

    await logToLedger(orgId, userId, "repo_intelligence.generated", {
      repository: repositoryName,
      domains: repoIntel.domains.map((d) => d.name),
      services: repoIntel.services.length,
      agentsDetected: agents.length,
      trustZone: repoIntel.trustZone,
      confidence: repoIntel.confidence,
      summary: repoIntel.summary,
    });

    const knowledgeGraph = buildKnowledgeGraph(repoIntel);

    const memoryChunksIndexed = await indexRepoIntelligence(orgId, repositoryId, repoIntel);
    const codeChunksIndexed = await indexAgentCode(orgId, repositoryId, agents, readFile);

    const fileContents = new Map<string, string>();
    for (const agent of agents) {
      try {
        const content = await readFile(agent.filePath);
        fileContents.set(agent.filePath, content);
      } catch {}
    }
    const crossFileLineage = traceCrossFileLineage(
      files.map((f) => ({
        path: f.path,
        name: f.name,
        ext: f.name.includes(".") ? f.name.substring(f.name.lastIndexOf(".")).toLowerCase() : "",
        dir: f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : "root",
      })),
      fileContents
    );

    await logToLedger(orgId, userId, "coding_memory.indexed", {
      repository: repositoryName,
      memory_chunks: memoryChunksIndexed,
      code_chunks: codeChunksIndexed,
    });

    const enrichedAgents = await Promise.all(
      agents.map(async (agent) => {
        try {
          const content = await readFile(agent.filePath);
          const enrichment = await enrichAgent(agent, content);
          const classification = classifyAgent(agent, enrichment);
          const summary = enrichSummary(agent, enrichment);
          return { ...agent, enrichment: { ...enrichment, summary }, classification };
        } catch {
          const classification = classifyAgent(agent);
          return { ...agent, classification };
        }
      })
    );

    const result: DiscoveryResult = {
      repository: repositoryName,
      provider,
      branch: branch ?? "main",
      scannedAt: new Date().toISOString(),
      filesScanned: files.length,
      agentsDiscovered: enrichedAgents.map((a) => ({
        name: a.name,
        filePath: a.filePath,
        framework: a.framework,
        agentType: a.agentType,
        confidence: a.confidence,
        evidence: a.evidence,
        suggestedRiskLevel: a.suggestedRiskLevel,
        suggestedOversightLevel: a.suggestedOversightLevel,
        isAutonomous: a.isAutonomous,
        capabilities: a.capabilities,
        enrichment: a.enrichment,
      })),
      systemsDiscovered: systems,
    };

    for (const agent of enrichedAgents) {
      try {
        const enrichment = agent.enrichment;
        const externalRefsDiscovery: Record<string, unknown> = {
          provider,
          repository: result.repository,
          filePath: agent.filePath,
          framework: agent.framework,
          confidence: agent.confidence,
          evidence: agent.evidence.slice(0, 5),
          scannedAt: result.scannedAt,
        };

        if (enrichment) {
          externalRefsDiscovery.lineage = enrichment.lineage;
          externalRefsDiscovery.finops = enrichment.finops;
          externalRefsDiscovery.lgpd = enrichment.lgpd;
          externalRefsDiscovery.fapi = enrichment.fapi;
          externalRefsDiscovery.trust_zone = enrichment.trustZone;
          externalRefsDiscovery.code_map = enrichment.codeMap;
          externalRefsDiscovery.governance_priority = enrichment.governancePriority;
          externalRefsDiscovery.compliance_exposure = enrichment.complianceExposure;
          externalRefsDiscovery.ai_act_exposure = enrichment.aiActExposure;
          externalRefsDiscovery.annex_iii_category = enrichment.annexIiiCategory;
          externalRefsDiscovery.dora_exposure = enrichment.doraExposure;
          externalRefsDiscovery.findings = enrichment.lgpd.findings.map((f) => ({
            category: f.category,
            severity: f.severity,
            rule: f.rule,
            match: f.match,
            line: f.line,
            filePath: f.filePath,
            message: f.message,
          }));
          externalRefsDiscovery.regulatory = {
            financial_services: enrichment.fapi.financialServices,
            open_banking: enrichment.fapi.openBanking,
            fapi: enrichment.fapi.fapiCompliant,
            dora_exposure: enrichment.fapi.doraExposure,
          };
          externalRefsDiscovery.summary = enrichment.summary;
        }

        externalRefsDiscovery.repo_intelligence = {
          businessDomains: repoIntel.domains.map((d) => d.name),
          trustZone: repoIntel.trustZone,
          services: repoIntel.services.map((s) => s.name),
          frameworks: repoIntel.frameworks,
          businessCapabilities: repoIntel.businessCapabilities,
        };
        externalRefsDiscovery.cross_file_lineage = {
          totalFlows: crossFileLineage.totalFlows,
          sourceCount: crossFileLineage.sourceCount,
          sinkCount: crossFileLineage.sinkCount,
          riskLevel: crossFileLineage.riskLevel,
          summary: crossFileLineage.summary,
        };

        await db.write.from("agents").insert({
          agent_code: `DISC-${agent.name.slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`.replace(/[^A-Z0-9_-]/g, "_").toUpperCase().slice(0, 30),
          name: agent.name,
          description: `Discovered ${agent.framework} agent from ${result.repository}`,
          agent_type: agent.agentType,
          risk_level: enrichment?.complianceExposure === "critical" ? "critical"
            : enrichment?.complianceExposure === "high" ? "high"
            : agent.suggestedRiskLevel,
          oversight_level: agent.suggestedOversightLevel,
          ai_act_risk_class: agent.classification?.aiActRiskClass ?? "limited",
          owner_user_id: userId,
          deployment_env: enrichment?.trustZone.trustZone ?? "development",
          business_domain: agent.classification?.businessDomain ?? "General",
          status: "pending_registration",
          organisation_id: orgId,
          created_by: userId,
          external_refs: {
            discovery: externalRefsDiscovery,
          },
        }).select("agent_id").single();

        await logToLedger(orgId, userId, "discovery.agent.detected", {
          repository: repositoryName,
          agent_name: agent.name,
          framework: agent.framework,
          agent_type: agent.agentType,
          risk_level: agent.suggestedRiskLevel,
          classification: agent.classification,
        });
      } catch {}
    }

    await logToLedger(orgId, userId, "discovery.scan.completed", {
      repository: repositoryName,
      filesScanned: files.length,
      agentsDiscovered: enrichedAgents.length,
      memoryChunksIndexed: memoryChunksIndexed + codeChunksIndexed,
      knowledgeGraphNodes: knowledgeGraph.nodes.length,
      repoIntelligenceConfidence: repoIntel.confidence,
    });

    return NextResponse.json({
      result,
      classified: enrichedAgents,
      registered: enrichedAgents.length,
      repoIntelligence: {
        domains: repoIntel.domains,
        services: repoIntel.services,
        frameworks: repoIntel.frameworks,
        entrypoints: repoIntel.entrypoints,
        trustZone: repoIntel.trustZone,
        businessCapabilities: repoIntel.businessCapabilities,
        summary: repoIntel.summary,
        confidence: repoIntel.confidence,
      },
      knowledgeGraph,
      crossFileLineage,
      memoryIndexed: memoryChunksIndexed + codeChunksIndexed,
      message: `${enrichedAgents.length} agents discovered, ${repoIntel.domains.length} domains identified, ${crossFileLineage.totalFlows} data flows traced, ${memoryChunksIndexed + codeChunksIndexed} memory chunks indexed.`,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery scan failed" },
      { status: 500 }
    );
  }
}