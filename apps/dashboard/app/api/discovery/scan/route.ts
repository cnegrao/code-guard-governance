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
import { LEGACY_RISK_LABEL } from "@/lib/legacy-risk";

/** D-12: heuristic risk labels never enter a new discovery ledger payload. */
function withoutHeuristicRisk(classification: unknown): Record<string, unknown> | undefined {
  if (!classification || typeof classification !== "object") return undefined;
  const { riskLevel: _riskLevel, aiActRiskClass: _aiActRiskClass, ...rest } = classification as Record<string, unknown>;
  void _riskLevel; void _aiActRiskClass;
  return rest;
}

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
      p_payload: { ...payload, authority: "OPERATIONAL_LEGACY", governedIngestion: "NOT_ACTIVE" },
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

    await logToLedger(orgId, userId, "inventory.discovery.scan.started", {
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

    // M17-S0 / D-12 (ADR-GOVIA-RISK-INTELLIGENCE-v1 §23.1): the legacy risk-bearing gov_repo.agents insert is STOPPED.
    // gov_repo.agents.risk_level / ai_act_risk_class are NOT NULL with defaults, so omitting them would still fabricate a
    // legacy risk value; no scanner/discovery row is created at all and no placeholder is written. Existing rows, values
    // and ledger history are untouched. Scanner -> M17 integration happens only through RISK_SIGNAL adapters (S1).
    for (const agent of enrichedAgents) {
      await logToLedger(orgId, userId, "inventory.discovery.agent.detected", {
        repository: repositoryName,
        agent_name: agent.name,
        framework: agent.framework,
        agent_type: agent.agentType,
        classification: withoutHeuristicRisk(agent.classification),
      });
    }

    await logToLedger(orgId, userId, "inventory.discovery.scan.completed", {
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
      authority: "OPERATIONAL_LEGACY",
      governedIngestion: "NOT_ACTIVE",
      discovered: enrichedAgents.length,
      inventoryStored: 0,
      inventoryErrors: 0,
      legacyInventoryWrite: "STOPPED_M17_S0_D12",
      heuristicRiskAuthority: LEGACY_RISK_LABEL,
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
      message: `${enrichedAgents.length} agents discovered; no legacy inventory rows written (legacy risk-bearing inventory writes are stopped); ${repoIntel.domains.length} domains identified, ${crossFileLineage.totalFlows} data flows traced, ${memoryChunksIndexed + codeChunksIndexed} memory chunks indexed.`,
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery scan failed" },
      { status: 500 }
    );
  }
}
