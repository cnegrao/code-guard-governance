import * as agentRepo from "@/repositories/agents";
import { createAgentSchema, updateAgentSchema } from "@/lib/validation";
import type { Agent, AgentFilters, ComplianceFlags, ControlState } from "@/types/agents";
import type { CreateAgentInput, UpdateAgentInput } from "@/lib/validation";
import { db } from "@/lib/db";
import { CG_AG_CONTROLS } from "@council/scanner";
import { assertTransition } from "@/lib/lifecycle";
import {
  calculateComplianceMetric,
  type MetricResult,
} from "@/lib/metrics/compliance";

export async function listAgents(
  orgId: string,
  filters?: AgentFilters
): Promise<{ agents: Agent[]; total: number }> {
  return agentRepo.getAgents(orgId, filters);
}

export async function getAgent(
  orgId: string,
  agentId: string
): Promise<Record<string, unknown> | null> {
  return agentRepo.getAgentWithOwner(orgId, agentId);
}

export async function registerAgent(
  orgId: string,
  userId: string,
  input: CreateAgentInput
): Promise<Agent> {
  const validated = createAgentSchema.parse(input);

  const { data: owner } = await db.read
    .from("governance_users")
    .select("user_id")
    .eq("user_id", validated.owner_user_id)
    .eq("organisation_id", orgId)
    .eq("status", "active")
    .single();

  if (!owner) {
    throw new Error("Owner not found, not active, or not in your organisation");
  }

  return agentRepo.createAgent(orgId, userId, validated);
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  input: UpdateAgentInput
): Promise<Agent> {
  const validated = updateAgentSchema.parse(input);

  // ── Lifecycle enforcement (CG-AG-001): status changes must follow the state machine ──
  if (validated.status) {
    const { data: current } = await db.read
      .from("agents")
      .select("status")
      .eq("organisation_id", orgId)
      .eq("agent_id", agentId)
      .single();
    if (!current) throw new Error("Agent not found");
    assertTransition((current as { status: string }).status, validated.status);
  }

  if (validated.owner_user_id) {
    const { data: owner } = await db.read
      .from("governance_users")
      .select("user_id")
      .eq("user_id", validated.owner_user_id)
      .eq("organisation_id", orgId)
      .eq("status", "active")
      .single();

    if (!owner) {
      throw new Error("Owner not found, not active, or not in your organisation");
    }
  }

  return agentRepo.updateAgent(orgId, agentId, validated);
}

export async function getCompliance(
  orgId: string,
  agentId: string
): Promise<ComplianceFlags> {
  return agentRepo.getAgentCompliance(orgId, agentId);
}

export async function assessCompliance(
  orgId: string,
  agentId: string,
  states: Partial<ComplianceFlags>
): Promise<void> {
  const validStates: ControlState[] = ["not_assessed", "passed", "failed", "waived"];
  for (const [k, v] of Object.entries(states)) {
    if (!validStates.includes(v as ControlState)) {
      throw new Error(`Invalid control state '${v}' for ${k}`);
    }
  }
  return agentRepo.updateAgentCompliance(orgId, agentId, states);
}

export function computeComplianceMetric(flags: ComplianceFlags): MetricResult {
  return calculateComplianceMetric(Object.values(flags));
}

/** @deprecated Prefer computeComplianceMetric for status and coverage. */
export function computeScore(flags: ComplianceFlags): number | null {
  return computeComplianceMetric(flags).value;
}

export function getGapLabels(flags: ComplianceFlags): string[] {
  // Canonical source: CG_AG_CONTROLS from @council/scanner (single source of truth).
  // Flag keys follow pattern cg_ag_NNN_* → control id CG-AG-0NN.
  return Object.entries(flags)
    .filter(([, v]) => v === "failed")
    .map(([k]) => {
      const m = k.match(/^cg_ag_(\d{3})/);
      const control = m ? CG_AG_CONTROLS[`CG-AG-${m[1]}`] : undefined;
      return control ? `${control.id}: ${control.name} — ${control.description}` : k;
    });
}
