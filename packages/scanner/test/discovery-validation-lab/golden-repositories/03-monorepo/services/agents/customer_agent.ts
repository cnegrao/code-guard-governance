export const customerModel = "customer-model-v1";

export const customerAgent = {
  kind: "agent",
  model: customerModel,
  readsFrom: "warehouse.crm_contact",
  task: "Summarize a synthetic CRM contact record.",
};
