import { db } from "@/lib/db";
import type { Agent, AgentFilters, ComplianceFlags, ControlState } from "@/types/agents";

export async function getAgents(
  orgId: string,
  filters?: AgentFilters
): Promise<{ agents: Agent[]; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db.write
    .from("agents")
    .select("*", { count: "exact", head: false })
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();

  if (filters?.risk_level) query = query.eq("risk_level", filters.risk_level);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.agent_type) query = query.eq("agent_type", filters.agent_type);

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return { agents: (data as Agent[]) ?? [], total: count ?? 0 };
}

export async function getAgentById(
  orgId: string,
  agentId: string
): Promise<Agent | null> {
  const { data } = await db.write
    .from("agents")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .throwOnError().maybeSingle();

  return (data as Agent) ?? null;
}

export async function getAgentWithOwner(
  orgId: string,
  agentId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await db.write.rpc("agent_compliance_gaps", {
    p_organisation_id: orgId,
  }).throwOnError();
  const gaps = (data as Array<Record<string, unknown>>) ?? [];
  const agent = await getAgentById(orgId, agentId);
  if (!agent) return null;

  const { data: owner } = await db.write
    .from("governance_users")
    .select("full_name, email")
    .eq("organisation_id", orgId)
    .eq("user_id", agent.owner_user_id)
    .throwOnError().maybeSingle();

  const agentGap = gaps.find((g) => g.agent_id === agentId);

  return {
    agent,
    owner_name: owner?.full_name ?? "Unknown",
    owner_email: owner?.email ?? "",
    compliance_gaps: agentGap ?? null,
  };
}

export async function createAgent(
  orgId: string,
  userId: string,
  input: Record<string, unknown>
): Promise<Agent> {
  const { data, error } = await db.write
    .from("agents")
    .insert({
      agent_code: input.agent_code,
      name: input.name,
      description: input.description,
      version: input.version,
      agent_type: input.agent_type,
      risk_level: input.risk_level,
      ai_act_risk_class: input.ai_act_risk_class,
      oversight_level: input.oversight_level,
      owner_user_id: input.owner_user_id,
      model_name: input.model_name,
      model_provider: input.model_provider,
      model_version: input.model_version,
      model_is_local: input.model_is_local,
      deployment_env: input.deployment_env,
      deployment_region: input.deployment_region,
      deployment_type: input.deployment_type,
      business_domain: input.business_domain,
      department: input.department,
      organisation_id: orgId,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create agent: ${error.message}`);
  return data as Agent;
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  input: Record<string, unknown>
): Promise<Agent> {
  const { data, error } = await db.write
    .from("agents")
    .update(input)
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update agent: ${error.message}`);
  return data as Agent;
}

export async function getAgentCompliance(
  orgId: string,
  agentId: string
): Promise<ComplianceFlags> {
  const { data } = await db.write
    .from("agents")
    .select(
      "cg_ag_001_registered, cg_ag_002_owner, cg_ag_003_model_reg, cg_ag_007_oversight, cg_ag_008_audit_trail, cg_ag_010_classified, cg_ag_012_autonomous_governed, external_refs"
    )
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .throwOnError().maybeSingle();

  if (!data) {
    return {
      cg_ag_001_registered: "not_assessed",
      cg_ag_002_owner: "not_assessed",
      cg_ag_003_model_reg: "not_assessed",
      cg_ag_004_compliant: "not_assessed",
      cg_ag_005_compliant: "not_assessed",
      cg_ag_006_compliant: "not_assessed",
      cg_ag_007_oversight: "not_assessed",
      cg_ag_008_audit_trail: "not_assessed",
      cg_ag_009_compliant: "not_assessed",
      cg_ag_010_classified: "not_assessed",
      cg_ag_011_compliant: "not_assessed",
      cg_ag_012_autonomous_governed: "not_assessed",
    };
  }

  const raw = data as Record<string, unknown>;
  const controlStates: Record<string, string> = ((raw.external_refs as Record<string, unknown>)?.controlStates ?? {}) as Record<string, string>;

  const controlKeys = [
    "cg_ag_001_registered",
    "cg_ag_002_owner",
    "cg_ag_003_model_reg",
    "cg_ag_004_compliant",
    "cg_ag_005_compliant",
    "cg_ag_006_compliant",
    "cg_ag_007_oversight",
    "cg_ag_008_audit_trail",
    "cg_ag_009_compliant",
    "cg_ag_010_classified",
    "cg_ag_011_compliant",
    "cg_ag_012_autonomous_governed",
  ] as const;

  const flags: Record<string, ControlState> = {};
  for (const key of controlKeys) {
    if (controlStates[key]) {
      flags[key] = controlStates[key] as ControlState;
    } else if (raw[key] === true) {
      flags[key] = "passed";
    } else {
      flags[key] = "not_assessed";
    }
  }

  return flags as unknown as ComplianceFlags;
}

export async function updateAgentCompliance(
  orgId: string,
  agentId: string,
  states: Partial<ComplianceFlags>
): Promise<void> {
  const { data: current } = await db.write
    .from("agents")
    .select("external_refs")
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .throwOnError().maybeSingle();

  const existingRefs = (current?.external_refs as Record<string, unknown>) ?? {};
  const existingControlStates: Record<string, string> = (existingRefs.controlStates as Record<string, string>) ?? {};

  const dbUpdates: Record<string, boolean> = {};
  for (const [key, state] of Object.entries(states)) {
    existingControlStates[key] = state;
    if (state === "passed" || state === "waived") {
      dbUpdates[key] = true;
    } else {
      dbUpdates[key] = false;
    }
  }

  const { error } = await db.write
    .from("agents")
    .update({
      ...dbUpdates,
      external_refs: { ...existingRefs, controlStates: existingControlStates },
    })
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId);

  if (error) throw new Error(`Failed to update compliance: ${error.message}`);
}

export async function getAgentRiskPropagation(
  orgId: string,
  agentId: string
): Promise<
  Array<{
    propagation_id: string;
    affected_agent_id: string;
    propagation_type: string;
    propagation_depth: number;
    impact_score: number;
    criticality: string;
  }>
> {
  const { data } = await db.write
    .from("agent_risk_propagation")
    .select(
      "propagation_id, affected_agent_id, propagation_type, propagation_depth, impact_score, criticality"
    )
    .eq("organisation_id", orgId)
    .eq("risk_source_agent_id", agentId)
    .eq("is_active", true).throwOnError();

  return (data as unknown as Array<{
    propagation_id: string;
    affected_agent_id: string;
    propagation_type: string;
    propagation_depth: number;
    impact_score: number;
    criticality: string;
  }>) ?? [];
}

export async function getAgentResourceLinks(
  orgId: string,
  agentId: string
): Promise<
  Array<{
    link_id: string;
    resource_type: string;
    resource_name: string;
    resource_provider: string | null;
    access_type: string;
    data_classification: string;
    processes_pii: boolean;
    is_active: boolean;
  }>
> {
  const { data } = await db.write
    .from("agent_resource_links")
    .select(
      "link_id, resource_type, resource_name, resource_provider, access_type, data_classification, processes_pii, is_active"
    )
    .eq("organisation_id", orgId)
    .eq("agent_id", agentId)
    .eq("is_active", true).throwOnError();

  return (data as unknown as Array<{
    link_id: string;
    resource_type: string;
    resource_name: string;
    resource_provider: string | null;
    access_type: string;
    data_classification: string;
    processes_pii: boolean;
    is_active: boolean;
  }>) ?? [];
}