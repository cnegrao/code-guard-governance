import 'server-only';
import type { CanonicalObjectKind, GovernedRelationshipType, OrganisationId, TechnicalField, TrustState } from '@council/canonical-contracts';
import type { ProfileField } from './agent-passport';
import { privilegedDb } from './persistence';

interface TenantRow { organisation_id: string }
export interface ObjectRow extends TenantRow {
  canonical_object_id: string; kind: CanonicalObjectKind; created_by_decision_id: string; created_at: string; revision: number;
}
export interface MappingRow extends TenantRow {
  mapping_id: string; canonical_object_id: string; canonical_object_kind: CanonicalObjectKind;
  parent_canonical_object_id: string | null; candidate_id: string; normalized_object_identity: string;
  source_connection_id: string; source_external_type: string; source_external_id: string;
  created_by_decision_id: string; valid_from: string;
}
interface LegacyMappingRow extends TenantRow {
  mapping_id: string; canonical_object_id: string; canonical_object_kind: CanonicalObjectKind;
  source_connection_id: string; source_external_type: string; source_external_id: string;
  created_by_decision_id: string; valid_from: string; valid_to: string | null;
}
export interface RelationshipRow extends TenantRow {
  relationship_id: string; relationship_state_id: string; relationship_type: GovernedRelationshipType;
  source_canonical_object_id: string; source_kind: CanonicalObjectKind;
  target_canonical_object_id: string; target_kind: CanonicalObjectKind;
  valid_from: string; valid_to: string | null; recorded_at: string; revision: number; created_by_decision_id: string;
}
export interface ProfileRow extends TenantRow {
  canonical_object_id: string; source_proposal_id: string; behavior_fingerprint_algorithm: string;
  behavior_fingerprint_schema_version: string; behavior_fingerprint_value: string;
  build_reference: string | null; runtime_framework_reference: string | null;
  entrypoint_reference: string | null; configuration_reference: string | null;
  revision: number; updated_at: string;
}
interface DecisionRow extends TenantRow { decision_id: string; decided_at: string; outcome: string }
interface AssertionRow extends TenantRow {
  assertion_id: string; source_connection_id: string; source_external_type: string; source_external_id: string;
  method_code: string; trust_state: TrustState; observed_at: string; recorded_at: string; run_id: string;
}
export interface StateRow extends TenantRow {
  state_id: string; canonical_object_id: string; object_kind: 'DATA_ASSET' | 'DATA_ELEMENT'; field_key: TechnicalField;
  proposal_id: string; decision_id: string; previous_state_id: string | null; recorded_at: string;
}
export interface ProposalRow extends TenantRow {
  proposal_id: string; object_kind: 'DATA_ASSET' | 'DATA_ELEMENT'; field_key: TechnicalField;
  structural_kind: string | null; technical_name: string | null; technical_description: string | null;
  qualified_technical_locator: string | null; native_type: string | null;
  connection_id: string; source_system_id: string; external_type: string; external_id: string;
  normalized_object_identity: string; trust_state: 'DECLARED' | 'IMPORTED';
}
interface FieldDecisionRow extends TenantRow {
  decision_id: string; canonical_object_id: string; object_kind: string; field_key: TechnicalField; proposal_id: string;
  outcome: string; policy_id: string | null; policy_version: string | null; decided_at: string;
  expected_source_observation_id: string; expected_source_snapshot_id: string;
}
interface Tables {
  canonical_objects: ObjectRow;
  canonical_normalized_object_mappings: MappingRow;
  canonical_object_source_mappings: LegacyMappingRow;
  canonical_relationships: RelationshipRow;
  agent_version_technical_profiles: ProfileRow;
  agent_version_technical_profile_field_assertions: TenantRow & { canonical_object_id: string; field_name: ProfileField; assertion_id: string };
  agent_version_technical_profile_field_evidence: TenantRow & { canonical_object_id: string; field_name: ProfileField; evidence_id: string };
  reconciliation_decisions: DecisionRow;
  reconciliation_decision_assertions: TenantRow & { decision_id: string; assertion_id: string };
  reconciliation_decision_evidence: TenantRow & { decision_id: string; evidence_id: string };
  reconciliation_invocations: TenantRow & { reconciliation_decision_id: string; review_subject_id: string | null };
  review_subjects: TenantRow & { review_subject_id: string };
  source_assertions: AssertionRow;
  discovery_evidence: TenantRow & { evidence_id: string; handling: string; captured_at: string };
  acquisition_runs: TenantRow & { run_id: string; source_system_id: string };
  technical_field_states: StateRow;
  technical_fact_proposals: ProposalRow;
  technical_field_decisions: FieldDecisionRow;
  technical_field_policy_heads: TenantRow & { policy_id: string; version: string };
  technical_fact_observations: TenantRow & { observation_id: string; proposal_id: string; snapshot_id: string; observed_at: string };
  technical_fact_observation_assertions: TenantRow & { observation_id: string; assertion_id: string };
  technical_fact_observation_evidence: TenantRow & { observation_id: string; evidence_id: string };
}
// Explicit scalar projections: never read candidate/vendor/evidence/Prompt envelopes.
const columns: { [K in keyof Tables]: readonly (keyof Tables[K] & string)[] } = {
  canonical_objects: ['canonical_object_id','kind','created_by_decision_id','created_at','revision'],
  canonical_normalized_object_mappings: ['mapping_id','canonical_object_id','canonical_object_kind','parent_canonical_object_id','candidate_id','normalized_object_identity','source_connection_id','source_external_type','source_external_id','created_by_decision_id','valid_from'],
  canonical_object_source_mappings: ['mapping_id','canonical_object_id','canonical_object_kind','source_connection_id','source_external_type','source_external_id','created_by_decision_id','valid_from','valid_to'],
  canonical_relationships: ['relationship_id','relationship_state_id','relationship_type','source_canonical_object_id','source_kind','target_canonical_object_id','target_kind','valid_from','valid_to','recorded_at','revision','created_by_decision_id'],
  agent_version_technical_profiles: ['canonical_object_id','source_proposal_id','behavior_fingerprint_algorithm','behavior_fingerprint_schema_version','behavior_fingerprint_value','build_reference','runtime_framework_reference','entrypoint_reference','configuration_reference','revision','updated_at'],
  agent_version_technical_profile_field_assertions: ['canonical_object_id','field_name','assertion_id'],
  agent_version_technical_profile_field_evidence: ['canonical_object_id','field_name','evidence_id'],
  reconciliation_decisions: ['decision_id','decided_at','outcome'],
  reconciliation_decision_assertions: ['decision_id','assertion_id'],
  reconciliation_decision_evidence: ['decision_id','evidence_id'],
  reconciliation_invocations: ['reconciliation_decision_id','review_subject_id'],
  review_subjects: ['review_subject_id'],
  source_assertions: ['assertion_id','source_connection_id','source_external_type','source_external_id','method_code','trust_state','observed_at','recorded_at','run_id'],
  discovery_evidence: ['evidence_id','handling','captured_at'],
  acquisition_runs: ['run_id','source_system_id'],
  technical_field_states: ['state_id','canonical_object_id','object_kind','field_key','proposal_id','decision_id','previous_state_id','recorded_at'],
  technical_fact_proposals: ['proposal_id','object_kind','field_key','structural_kind','technical_name','technical_description','qualified_technical_locator','native_type','connection_id','source_system_id','external_type','external_id','normalized_object_identity','trust_state'],
  technical_field_decisions: ['decision_id','canonical_object_id','object_kind','field_key','proposal_id','outcome','policy_id','policy_version','decided_at','expected_source_observation_id','expected_source_snapshot_id'],
  technical_field_policy_heads: ['policy_id','version'],
  technical_fact_observations: ['observation_id','proposal_id','snapshot_id','observed_at'],
  technical_fact_observation_assertions: ['observation_id','assertion_id'],
  technical_fact_observation_evidence: ['observation_id','evidence_id'],
};

export function passportReader(org: OrganisationId) {
  return async function read<K extends keyof Tables>(table: K, filter: Partial<Record<keyof Tables[K], string>>): Promise<Tables[K][]> {
    const result: Tables[K][] = [];
    for (let offset = 0; ; offset += 200) {
      let query = privilegedDb.from(table).select(['organisation_id', ...columns[table]].join(',')).eq('organisation_id', org);
      for (const [key, value] of Object.entries(filter)) query = query.eq(key, value);
      // Stable paging, including composite junction keys. No temporal selection via ordering.
      for (const key of columns[table].slice(0, 3)) query = query.order(key);
      const { data, error } = await query.range(offset, offset + 199);
      if (error) throw new Error(`PASSPORT_READ_FAILED: ${table}`);
      const page = (data ?? []) as unknown as Tables[K][];
      if (page.some(row => row.organisation_id !== org)) throw new Error('PASSPORT_TENANT_MISMATCH');
      result.push(...page);
      if (page.length < 200) return result;
    }
  };
}
export type PassportReader = ReturnType<typeof passportReader>;
