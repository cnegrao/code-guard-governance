export const BILLING_PROMPT = "Explain synthetic balances without moving funds.";
export const billingModel = {
  provider: "synthetic-ai",
  modelReference: "billing-model-v1",
} as const;

export function readBalance(accountId: string): string {
  return `synthetic-balance:${accountId}`;
}

export const billingAgent = {
  kind: "agent",
  model: billingModel,
  instructions: BILLING_PROMPT,
  tools: [readBalance],
};
