export const profileModel = "profile-model-v1";

export const profileAgent = {
  kind: "agent",
  model: profileModel,
  readsFrom: "warehouse.core_customer",
  task: "Prepare a synthetic customer profile.",
};
