import { lit, named } from './m16-governed-write-fixtures';
import { lastLine, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';

/**
 * M16 read-projection closure (O32 / O41) fixtures on the M16RP-horizon L14 cluster. Both projections are called ONLY through
 * the real SECURITY DEFINER RPCs as service_role with a verified principal (never an owner shortcut); the owner session is used
 * only for evidence reads (row counts / digests) that prove nothing was written.
 */
export const PASSPORT_RPC = 'gov_repo.l14_read_passport_governance_v1';
export const CONFLICT_RPC = 'gov_repo.l14_read_fact_conflict_v1';
/** Every L14 table of the post-S1C.5 catalog (the projections add none). */
export const L14_ALL_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_heads', 'l14_authority_policy_rules', 'l14_authority_policy_states',
  'l14_authority_policy_version_proposals', 'l14_authority_policy_versions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_authorization_decisions', 'l14_business_context_assignment_heads',
  'l14_business_context_assignment_proposals', 'l14_business_context_assignment_states', 'l14_command_results',
  'l14_control_applicability_heads', 'l14_control_applicability_proposals', 'l14_control_applicability_states',
  'l14_control_assessment_heads', 'l14_control_assessment_proposals', 'l14_control_assessment_states', 'l14_control_definition_heads',
  'l14_control_definition_proposals', 'l14_control_definition_states', 'l14_control_definition_versions', 'l14_control_definitions',
  'l14_domain_admissions', 'l14_domain_heads', 'l14_domain_proposals', 'l14_domain_states', 'l14_fact_states',
  'l14_governance_decisions', 'l14_governance_parties', 'l14_governance_party_heads', 'l14_governance_party_proposals',
  'l14_governance_party_states', 'l14_policy_admissions', 'l14_policy_applicability_heads', 'l14_policy_applicability_proposals',
  'l14_policy_applicability_states', 'l14_policy_version_admissions', 'l14_policy_version_heads', 'l14_policy_version_proposals',
  'l14_policy_version_states', 'l14_proposals', 'l14_registry_states', 'l14_responsibility_assignment_heads',
  'l14_responsibility_assignment_proposals', 'l14_responsibility_assignment_states', 'l14_support_links',
] as const;

export type PassportRow = Record<string, any> & {
  fact_family: 'RESPONSIBILITY_ASSIGNMENT' | 'BUSINESS_CONTEXT_ASSIGNMENT' | 'POLICY_APPLICABILITY' | 'CONTROL_APPLICABILITY' | 'CONTROL_ASSESSMENT';
  target_kind: 'AGENT' | 'AGENT_VERSION'; target_canonical_object_id: string; fact_state_id: string;
};
export type ConflictRow = Record<string, any> & {
  conflict_outcome: 'RESOLVED' | 'CONFLICT' | 'INSUFFICIENT_EVIDENCE'; row_kind: 'OUTCOME' | 'GOVERNED_FACT' | 'LIVE_PROPOSAL';
};
/** One exact logical fact key (ADR §3). Target operands follow the closed union; every other operand stays NULL. */
export interface ConflictKey {
  subjectKind: 'RESPONSIBILITY_ASSIGNMENT' | 'BUSINESS_CONTEXT_ASSIGNMENT' | 'POLICY_APPLICABILITY' | 'CONTROL_APPLICABILITY' | 'CONTROL_ASSESSMENT';
  targetType?: string | null; targetCanonicalKind?: string | null; targetCanonicalObjectId?: string | null;
  targetRelationshipId?: string | null; targetRelationshipStateId?: string | null; responsibilityRole?: string | null;
  governancePartyId?: string | null; semanticKind?: string | null; policyId?: string | null; controlDefinitionId?: string | null;
  controlApplicabilityStateId?: string | null;
}
const textOrNull = (value: string | null | undefined) => (value == null ? 'null::text' : lit(value));
const uuidOrNull = (value: string | null | undefined) => (value == null ? 'null::uuid' : `${lit(value)}::uuid`);
/** SQL expression for a coordinate: an explicit SQL expression, or NULL (= one DB instant chosen by the projection). */
const coordinate = (value: string | null | undefined) => (value == null ? 'null::timestamptz' : `(${value})::timestamptz`);

export function readProjectionKit(c: L14Cluster) {
  const passportSql = (actor: Actor, agentId: string, versionId: string | null = null, at: string | null = null,
    cutoff: string | null = null, session?: SessionOverride) =>
    `select coalesce(json_agg(to_json(r)), '[]') from ${PASSPORT_RPC}(${named({
      ...c.principal(actor, session), p_agent_canonical_object_id: textOrNull(agentId),
      p_agent_version_canonical_object_id: textOrNull(versionId), p_effective_at: coordinate(at), p_recorded_cutoff: coordinate(cutoff) })}) r`;
  /** The Passport projection rows for the exact AGENT (+ optional exact AGENT_VERSION), as service_role. */
  async function passport(actor: Actor, agentId: string, options: { versionId?: string | null; at?: string | null; cutoff?: string | null;
    session?: SessionOverride } = {}): Promise<PassportRow[]> {
    return JSON.parse(lastLine(await c.svc(passportSql(actor, agentId, options.versionId ?? null, options.at ?? null,
      options.cutoff ?? null, options.session))));
  }
  const conflictSql = (actor: Actor, key: ConflictKey, at: string | null = null, cutoff: string | null = null, session?: SessionOverride) =>
    `select coalesce(json_agg(to_json(r)), '[]') from ${CONFLICT_RPC}(${named({
      ...c.principal(actor, session), p_subject_kind: textOrNull(key.subjectKind), p_target_type: textOrNull(key.targetType),
      p_target_canonical_kind: textOrNull(key.targetCanonicalKind), p_target_canonical_object_id: textOrNull(key.targetCanonicalObjectId),
      p_target_relationship_id: textOrNull(key.targetRelationshipId), p_target_relationship_state_id: textOrNull(key.targetRelationshipStateId),
      p_responsibility_role: textOrNull(key.responsibilityRole), p_governance_party_id: uuidOrNull(key.governancePartyId),
      p_semantic_kind: textOrNull(key.semanticKind), p_policy_id: uuidOrNull(key.policyId),
      p_control_definition_id: uuidOrNull(key.controlDefinitionId), p_control_applicability_state_id: uuidOrNull(key.controlApplicabilityStateId),
      p_effective_at: coordinate(at), p_recorded_cutoff: coordinate(cutoff) })}) r`;
  /** The conflict projection of one exact key, as service_role: the closed outcome, the counts and every detail row. */
  async function conflict(actor: Actor, key: ConflictKey, options: { at?: string | null; cutoff?: string | null; session?: SessionOverride } = {}) {
    const rows = JSON.parse(lastLine(await c.svc(conflictSql(actor, key, options.at ?? null, options.cutoff ?? null, options.session)))) as ConflictRow[];
    const head = rows[0];
    if (!head || head.row_kind !== 'OUTCOME' || rows.filter(r => r.row_kind === 'OUTCOME').length !== 1
      || rows.some(r => r.conflict_outcome !== head.conflict_outcome)) throw new Error(`malformed conflict projection: ${JSON.stringify(rows)}`);
    return { outcome: head.conflict_outcome, live: head.live_proposal_count as number, distinct: head.distinct_content_count as number,
      fact: rows.find(r => r.row_kind === 'GOVERNED_FACT') ?? null, proposals: rows.filter(r => r.row_kind === 'LIVE_PROPOSAL'), rows };
  }
  /** Row count of every L14 table (all tenants) + md5 of every L14 row: a read projection must change neither. */
  const authoritySnapshot = async () => lastLine(await c.owner(`select md5(string_agg(x, '|' order by x)) || ':' || count(*) from (
    ${L14_ALL_TABLES.map(t => `select '${t}:'||to_jsonb(t)::text as x from gov_repo.${t} t`).join(' union all ')}) s`));
  const objectKey = (subjectKind: ConflictKey['subjectKind'], kind: string, id: string, extra: Partial<ConflictKey> = {}): ConflictKey =>
    ({ subjectKind, targetType: 'CANONICAL_OBJECT', targetCanonicalKind: kind, targetCanonicalObjectId: id, ...extra });
  return { passportSql, passport, conflictSql, conflict, authoritySnapshot, objectKey };
}
export type ReadProjectionKit = ReturnType<typeof readProjectionKit>;
