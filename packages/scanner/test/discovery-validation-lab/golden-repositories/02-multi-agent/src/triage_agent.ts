import { billingAgent } from "./billing_agent";
import { retentionAgent } from "./retention_agent";

export const TRIAGE_PROMPT = "Route synthetic requests to the correct team.";
export const triageModel = {
  provider: "synthetic-ai",
  modelReference: "triage-model-v1",
} as const;

export function classifyRequest(message: string): "billing" | "retention" {
  return message.includes("invoice") ? "billing" : "retention";
}

export const triageAgent = {
  kind: "agent",
  model: triageModel,
  instructions: TRIAGE_PROMPT,
  tools: [classifyRequest],
  handoffs: [billingAgent, retentionAgent],
};
