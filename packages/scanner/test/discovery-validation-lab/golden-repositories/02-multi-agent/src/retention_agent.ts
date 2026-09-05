export const RETENTION_PROMPT = "Prepare a synthetic retention option.";
export const retentionModel = {
  provider: "synthetic-ai",
  modelReference: "retention-model-v1",
} as const;

export function selectRetentionOption(segment: string): string {
  return `synthetic-option:${segment}`;
}

export const retentionAgent = {
  kind: "agent",
  model: retentionModel,
  instructions: RETENTION_PROMPT,
  tools: [selectRetentionOption],
};
