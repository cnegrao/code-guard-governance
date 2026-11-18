import { projectAgent } from "@/lib/legacy-control-dto";
import type { Agent, AgentDetailAgent } from "@/types/agents";

/** This legacy read has no admitted authoritative oversight-evidence input. */
export function projectAgentDetail(record: Agent): AgentDetailAgent {
  return {
    ...projectAgent(record),
    oversight_level: "UNKNOWN",
    oversight: projectAgentOversight(record),
  };
}

/** Shared LX07 projection; historical labels and manual flags are not admitted evidence. */
export function projectAgentOversight(record: {
  oversight_level?: unknown; organisation_id: string; agent_id: string;
}): AgentDetailAgent["oversight"] {
  return {
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
  };
}

export const OVERSIGHT_LIMITATION = "Effective oversight: UNKNOWN / NOT_EVIDENCED / NON_AUTHORITATIVE. Historical L1–L4 labels and manual flags do not prove effective supervision, applicability or sufficiency.";
export const OVERSIGHT_PATTERN = /oversight|supervis|\bhuman[\s_-]*(?:in(?:\b|_)|review|approv|control|monitor|interven|involv)|(?:revis[aã]o|aprova[cç][aã]o|controle|interven[cç][aã]o)\s+human|\bl[1-4](?:_|\b)|cg[_-]ag[_-]007/i;

export function mentionsOversight(text: string): boolean {
  return OVERSIGHT_PATTERN.test(text);
}

/** Legacy free text is retrieval material, never an oversight-evidence input. */
export function containLegacyOversightText(text: string): string {
  return text.split("\n").map(line => mentionsOversight(line) ? OVERSIGHT_LIMITATION : line).join("\n");
}
