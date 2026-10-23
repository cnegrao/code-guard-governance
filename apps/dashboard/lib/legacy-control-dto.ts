import type { Agent, ComplianceFlags, ControlState } from "@/types/agents";
import type { AISystem } from "@/types/systems";

export const LEGACY_CONTROL_AUTHORITY = "LEGACY_NON_AUTHORITATIVE" as const;
export const LEGACY_CONTROL_LIMITATION = "Legacy/manual records - not a compliance or assurance determination." as const;

export interface LegacyControlEnvelope {
  legacy_control_authority: typeof LEGACY_CONTROL_AUTHORITY;
  legacy_control_limitation: typeof LEGACY_CONTROL_LIMITATION;
  legacy_control_states: Record<string, ControlState>;
  legacy_control_gaps: string[];
}

// Explicit public allowlist: new database fields cannot silently become API fields.
const AGENT_PUBLIC_FIELDS = [
  "agent_id",
  "agent_code",
  "name",
  "description",
  "version",
  "ai_system_id",
  "agent_type",
  "risk_level",
  "ai_act_risk_class",
  "oversight_level",
  "owner_user_id",
  "technical_owner_id",
  "business_domain",
  "department",
  "model_name",
  "model_version",
  "model_provider",
  "model_is_local",
  "model_endpoint",
  "deployment_env",
  "deployment_region",
  "deployment_type",
  "status",
  "approved_for_production",
  "organisation_id",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof Agent)[];

export function projectAgent(record: Agent): Agent {
  return Object.fromEntries(AGENT_PUBLIC_FIELDS.map(key => [key, record[key]])) as unknown as Agent;
}

// Explicit public allowlist: new database fields cannot silently become API fields.
const SYSTEM_PUBLIC_FIELDS = [
  "system_id",
  "system_code",
  "name",
  "description",
  "intended_purpose",
  "risk_class",
  "status",
  "owner_user_id",
  "business_domain",
  "lifecycle",
  "annex_iii_sector",
  "is_cross_border",
  "organisation_role",
  "eu_rep_name",
  "ai_officer_id",
  "gpai_tier",
  "annex_iii_exception_claimed",
  "changes_log",
  "known_limitations",
  "risk_mgmt_system_desc",
  "fria_conducted",
  "ce_marking_status",
  "conformity_procedure",
  "eu_ai_db_system_uuid",
  "doc_ref",
  "pms_plan_documented",
  "adversarial_testing_completed",
  "override_mechanism_desc",
  "halt_mechanism_desc",
  "accuracy_metrics",
  "fairness_metrics",
  "qms_documented",
  "eu_ai_db_registered",
  "eu_ai_db_ref",
  "conformity_assessment_id",
  "organisation_id",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof AISystem)[];

export function projectSystem(record: AISystem): AISystem {
  return Object.fromEntries(SYSTEM_PUBLIC_FIELDS.map(key => [key, record[key]])) as unknown as AISystem;
}

export function legacyControlEnvelope(
  states: Partial<ComplianceFlags> | Record<string, ControlState>,
  gaps: string[],
): LegacyControlEnvelope {
  return {
    legacy_control_authority: LEGACY_CONTROL_AUTHORITY,
    legacy_control_limitation: LEGACY_CONTROL_LIMITATION,
    legacy_control_states: { ...states },
    legacy_control_gaps: [...gaps],
  };
}
