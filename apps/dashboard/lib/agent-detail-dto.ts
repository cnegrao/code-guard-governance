import { projectAgent } from "@/lib/legacy-control-dto";
import type { Agent, AgentDetailAgent } from "@/types/agents";

/** This legacy read has no admitted authoritative oversight-evidence input. */
export function projectAgentDetail(record: Agent): AgentDetailAgent {
  return {
    ...projectAgent(record),
    oversight_level: "UNKNOWN",
    oversight: {
      effectiveLevel: "UNKNOWN",
      evidenceStatus: "NOT_EVIDENCED",
      authority: "NON_AUTHORITATIVE",
      recordedLevel: typeof record.oversight_level === "string" ? record.oversight_level : null,
      source: {
        table: "gov_repo.agents",
        field: "oversight_level",
        organisationId: record.organisation_id,
        agentId: record.agent_id,
      },
    },
  };
}
