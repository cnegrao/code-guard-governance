export interface Agent {
  agent_id: string;
  agent_code: string;
  name: string;
  description: string;
  version: string;
  ai_system_id: string | null;
  agent_type: string;
  risk_level: string;
  ai_act_risk_class: string;
  oversight_level: string;
  owner_user_id: string;
  technical_owner_id: string | null;
  business_domain: string | null;
  department: string | null;
  model_name: string | null;
  model_version: string | null;
  model_provider: string | null;
  model_is_local: boolean;
  model_endpoint: string | null;
  deployment_env: string;
  deployment_region: string | null;
  deployment_type: string;
  status: string;
  approved_for_production: boolean;
  cg_ag_001_registered: boolean;
  cg_ag_002_owner: boolean;
  cg_ag_003_model_reg: boolean;
  cg_ag_004_compliant?: boolean;
  cg_ag_005_compliant?: boolean;
  cg_ag_006_compliant?: boolean;
  cg_ag_007_oversight: boolean;
  cg_ag_008_audit_trail: boolean;
  cg_ag_009_compliant?: boolean;
  cg_ag_010_classified: boolean;
  cg_ag_011_compliant?: boolean;
  cg_ag_012_autonomous_governed: boolean;
  organisation_id: string;
  created_at: string;
  updated_at: string;
}

export interface AgentDetail extends Agent {
  owner_name: string;
  owner_email: string;
  compliance_metric: MetricResult;
  compliance_score: number | null;
  compliance_gaps: string[];
}

export type ControlState = "not_assessed" | "passed" | "failed" | "waived";

export interface ComplianceFlags {
  cg_ag_001_registered: ControlState;
  cg_ag_002_owner: ControlState;
  cg_ag_003_model_reg: ControlState;
  cg_ag_004_compliant?: ControlState;
  cg_ag_005_compliant?: ControlState;
  cg_ag_006_compliant?: ControlState;
  cg_ag_007_oversight: ControlState;
  cg_ag_008_audit_trail: ControlState;
  cg_ag_009_compliant?: ControlState;
  cg_ag_010_classified: ControlState;
  cg_ag_011_compliant?: ControlState;
  cg_ag_012_autonomous_governed: ControlState;
}

export interface AgentFilters {
  risk_level?: string;
  status?: string;
  agent_type?: string;
  page?: number;
  limit?: number;
}
import type { MetricResult } from "@/lib/metrics/compliance";
