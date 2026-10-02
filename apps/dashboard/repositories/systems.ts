import { db } from "@/lib/db";
import type { AISystem, SystemFilters, ControlState } from "@/types/systems";

export async function getSystems(
  orgId: string,
  filters?: SystemFilters
): Promise<{ systems: AISystem[]; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db.write
    .from("ai_systems")
    .select("*", { count: "exact", head: false })
    .eq("organisation_id", orgId)
    .neq("status", "decommissioned").throwOnError();

  if (filters?.risk_class) query = query.eq("risk_class", filters.risk_class);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.lifecycle) query = query.eq("lifecycle", filters.lifecycle);

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return { systems: (data as AISystem[]) ?? [], total: count ?? 0 };
}

export async function getSystemById(
  orgId: string,
  systemId: string
): Promise<AISystem | null> {
  const { data } = await db.write
    .from("ai_systems")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("system_id", systemId)
    .throwOnError().maybeSingle();

  return (data as AISystem) ?? null;
}

export async function getSystemWithOwner(
  orgId: string,
  systemId: string
): Promise<Record<string, unknown> | null> {
  const system = await getSystemById(orgId, systemId);
  if (!system) return null;

  const { data: owner } = await db.write
    .from("governance_users")
    .select("full_name, email")
    .eq("organisation_id", orgId)
    .eq("user_id", system.owner_user_id)
    .throwOnError().maybeSingle();

  const { count } = await db.write
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .eq("ai_system_id", systemId).throwOnError();

  return {
    system,
    owner_name: owner?.full_name ?? "Unknown",
    owner_email: owner?.email ?? "",
    agent_count: count ?? 0,
  };
}

export async function createSystem(
  orgId: string,
  userId: string,
  input: Record<string, unknown>
): Promise<AISystem> {
  const { data, error } = await db.write
    .from("ai_systems")
    .insert({
      system_code: input.system_code,
      name: input.name,
      description: input.description,
      intended_purpose: input.intended_purpose,
      risk_class: input.risk_class,
      lifecycle: input.lifecycle,
      owner_user_id: input.owner_user_id,
      business_domain: input.business_domain,
      annex_iii_sector: input.annex_iii_sector,
      organisation_role: input.organisation_role,
      technical_owner_id: input.technical_owner_id,
      deployment_env: input.deployment_env,
      deployment_region: input.deployment_region,
      organisation_id: orgId,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create system: ${error.message}`);
  return data as AISystem;
}

export async function updateSystem(
  orgId: string,
  systemId: string,
  input: Record<string, unknown>
): Promise<AISystem> {
  const { data, error } = await db.write
    .from("ai_systems")
    .update(input)
    .eq("organisation_id", orgId)
    .eq("system_id", systemId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update system: ${error.message}`);
  return data as AISystem;
}

export async function getSystemCompliance(
  orgId: string,
  systemId: string
): Promise<Record<string, ControlState>> {
  const { data } = await db.write
    .from("ai_systems")
    .select(
      "cg_sys_001_registered, cg_sys_002_owner, cg_sys_003_risk_classified, cg_sys_004_tech_doc, cg_sys_005_risk_mgmt, cg_sys_006_human_oversight, cg_sys_007_conformity, cg_sys_008_post_market, external_refs"
    )
    .eq("organisation_id", orgId)
    .eq("system_id", systemId)
    .throwOnError().maybeSingle();

  if (!data) {
    return {
      cg_sys_001_registered: "not_assessed",
      cg_sys_002_owner: "not_assessed",
      cg_sys_003_risk_classified: "not_assessed",
      cg_sys_004_tech_doc: "not_assessed",
      cg_sys_005_risk_mgmt: "not_assessed",
      cg_sys_006_human_oversight: "not_assessed",
      cg_sys_007_conformity: "not_assessed",
      cg_sys_008_post_market: "not_assessed",
    };
  }

  const raw = data as Record<string, unknown>;
  const controlStates: Record<string, string> = ((raw.external_refs as Record<string, unknown>)?.controlStates ?? {}) as Record<string, string>;

  const controlKeys = [
    "cg_sys_001_registered",
    "cg_sys_002_owner",
    "cg_sys_003_risk_classified",
    "cg_sys_004_tech_doc",
    "cg_sys_005_risk_mgmt",
    "cg_sys_006_human_oversight",
    "cg_sys_007_conformity",
    "cg_sys_008_post_market",
  ];

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

  return flags;
}

export async function updateSystemCompliance(
  orgId: string,
  systemId: string,
  states: Record<string, ControlState>
): Promise<void> {
  const { data: current } = await db.write
    .from("ai_systems")
    .select("external_refs")
    .eq("organisation_id", orgId)
    .eq("system_id", systemId)
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
    .from("ai_systems")
    .update({
      ...dbUpdates,
      external_refs: { ...existingRefs, controlStates: existingControlStates },
    })
    .eq("organisation_id", orgId)
    .eq("system_id", systemId);

  if (error) throw new Error(`Failed to update compliance: ${error.message}`);
}