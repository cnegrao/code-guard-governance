export type ControlState = "not_assessed" | "passed" | "failed" | "waived";

export interface AISystem {
  system_id: string;
  system_code: string;
  name: string;
  description: string;
  intended_purpose: string;
  risk_class: string;
  status: string;
  owner_user_id: string;
  business_domain: string | null;
  lifecycle: string | null;
  annex_iii_sector: string | null;
  is_cross_border: boolean | null;
  organisation_role: string | null;
  eu_rep_name: string | null;
  ai_officer_id: string | null;
  gpai_tier: string | null;
  annex_iii_exception_claimed: boolean | null;
  cg_sys_001_registered: ControlState;
  cg_sys_002_owner: ControlState;
  cg_sys_003_risk_classified: ControlState;
  cg_sys_004_tech_doc: ControlState;
  cg_sys_005_risk_mgmt: ControlState;
  cg_sys_006_human_oversight: ControlState;
  cg_sys_007_conformity: ControlState;
  cg_sys_008_post_market: ControlState;
  changes_log: string | null;
  known_limitations: string | null;
  risk_mgmt_system_desc: string | null;
  fria_conducted: boolean | null;
  ce_marking_status: string | null;
  conformity_procedure: string | null;
  eu_ai_db_system_uuid: string | null;
  doc_ref: string | null;
  pms_plan_documented: boolean | null;
  adversarial_testing_completed: boolean | null;
  override_mechanism_desc: string | null;
  halt_mechanism_desc: string | null;
  accuracy_metrics: string | null;
  fairness_metrics: string | null;
  qms_documented: boolean | null;
  external_refs: Record<string, unknown> | null;
  eu_ai_db_registered: boolean;
  eu_ai_db_ref: string | null;
  conformity_assessment_id: string | null;
  organisation_id: string;
  created_at: string;
  updated_at: string;
}

export interface SystemDetail extends AISystem {
  owner_name: string;
  owner_email: string;
  agent_count: number;
  compliance_metric: MetricResult;
  compliance_score: number | null;
}

export interface SystemFilters {
  risk_class?: string;
  status?: string;
  lifecycle?: string;
  page?: number;
  limit?: number;
}
import type { MetricResult } from "@/lib/metrics/compliance";
