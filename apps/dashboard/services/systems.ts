import * as systemRepo from "@/repositories/systems";
import { createSystemSchema, updateSystemSchema } from "@/lib/validation";
import type { AISystem, SystemFilters, ControlState } from "@/types/systems";
import type { CreateSystemInput } from "@/lib/validation";
import type { UpdateSystemInput } from "@/lib/validation";
import { db } from "@/lib/db";
import {
  calculateComplianceMetric,
  type MetricResult,
} from "@/lib/metrics/compliance";

export async function listSystems(
  orgId: string,
  filters?: SystemFilters
): Promise<{ systems: AISystem[]; total: number }> {
  return systemRepo.getSystems(orgId, filters);
}

export async function getSystem(
  orgId: string,
  systemId: string
): Promise<Record<string, unknown> | null> {
  return systemRepo.getSystemWithOwner(orgId, systemId);
}

export async function registerSystem(
  orgId: string,
  userId: string,
  input: CreateSystemInput
): Promise<AISystem> {
  const validated = createSystemSchema.parse(input);

  const { data: owner } = await db.read
    .from("governance_users")
    .select("user_id")
    .eq("user_id", validated.owner_user_id ?? "")
    .eq("organisation_id", orgId)
    .eq("status", "active")
    .single();

  if (!owner) {
    throw new Error("Owner not found, not active, or not in your organisation");
  }

  return systemRepo.createSystem(orgId, userId, validated);
}

export async function updateSystem(
  orgId: string,
  systemId: string,
  input: UpdateSystemInput
): Promise<AISystem> {
  const validated = updateSystemSchema.parse(input);

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

  return systemRepo.updateSystem(orgId, systemId, validated);
}

export async function getCompliance(
  orgId: string,
  systemId: string
): Promise<Record<string, ControlState>> {
  return systemRepo.getSystemCompliance(orgId, systemId);
}

export async function assessCompliance(
  orgId: string,
  systemId: string,
  states: Record<string, ControlState>
): Promise<void> {
  const validStates: ControlState[] = ["not_assessed", "passed", "failed", "waived"];
  for (const [k, v] of Object.entries(states)) {
    if (!validStates.includes(v as ControlState)) {
      throw new Error(`Invalid control state '${v}' for ${k}`);
    }
  }
  return systemRepo.updateSystemCompliance(orgId, systemId, states);
}

export function computeComplianceMetric(
  flags: Record<string, ControlState>
): MetricResult {
  return calculateComplianceMetric(Object.values(flags));
}

/** @deprecated Prefer computeComplianceMetric for status and coverage. */
export function computeScore(
  flags: Record<string, ControlState>
): number | null {
  return computeComplianceMetric(flags).value;
}

export function getGapLabels(flags: Record<string, ControlState>): string[] {
  const labels: Record<string, string> = {
    cg_sys_001_registered: "CG-SYS-001 — System not registered",
    cg_sys_002_owner: "CG-SYS-002 — Owner not assigned",
    cg_sys_003_risk_classified: "CG-SYS-003 — Risk not classified",
    cg_sys_004_tech_doc: "CG-SYS-004 — Technical documentation missing",
    cg_sys_005_risk_mgmt: "CG-SYS-005 — Risk management system missing",
    cg_sys_006_human_oversight: "CG-SYS-006 — Human oversight not configured",
    cg_sys_007_conformity: "CG-SYS-007 — Conformity not assessed",
    cg_sys_008_post_market: "CG-SYS-008 — Post-market surveillance missing",
  };

  return Object.entries(flags)
    .filter(([, v]) => v === "failed")
    .map(([k]) => labels[k] ?? k);
}
