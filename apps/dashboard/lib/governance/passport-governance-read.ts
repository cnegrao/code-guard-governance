import 'server-only';
import {
  L14_CONFLICT_READ_OUTCOMES, L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_POLICY_APPLICABILITY_OUTCOMES, L14_CONTROL_ASSESSMENT_OUTCOMES,
  L14_RESPONSIBILITY_ROLES, L14_SOURCE_CLASSES, L14_SUPPORT_STATUSES,
  type L14ConflictReadResult, type L14FactKey, type L14FactKeyTarget, type L14GovernedFactLineage, type L14PassportGovernedFact, type L14PassportGovernedValue,
} from '@council/canonical-contracts';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from './persistence';

/**
 * M16 read-projection closure (O32 / O41): server-only reads of the two read-only, tenant-scoped SECURITY DEFINER projections.
 * - The ONLY identity/session authority is the verified GovernanceWritePrincipal, passed verbatim; PostgreSQL revalidates base
 *   session eligibility and derives the tenant from it. No organisation / actor is ever taken from a caller's input.
 * - service_role holds no privilege on any L14 table; these RPCs are its only read path to M16 governed facts.
 * - Every row is re-checked against the closed vocabularies and the exact requested targets; anything else fails closed.
 * - No write RPC, no legacy owner / business_domain / cg_* surface, no ranking, no score.
 */
const PASSPORT_RPC = 'l14_read_passport_governance_v1';
const CONFLICT_RPC = 'l14_read_fact_conflict_v1';
type Row = Record<string, unknown>;

const principalArgs = (principal: GovernanceWritePrincipal) => ({
  p_verified_organisation_id: principal.organisationId,
  p_verified_actor_user_id: principal.actorUserId,
  p_verified_session_iat: principal.issuedAtSeconds,
  p_verified_session_exp: principal.expiresAtSeconds,
  p_verified_credential_epoch: principal.credentialEpoch,
});

function fail(): never { throw new Error('PASSPORT_GOVERNANCE_ROW_INVALID'); }
const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : fail());
const nullableText = (value: unknown) => (value === null || value === undefined ? null : text(value));
const ids = (value: unknown) => (Array.isArray(value) && value.every(v => typeof v === 'string') ? Object.freeze([...value] as string[]) : fail());
function closed<T extends string>(value: unknown, vocabulary: readonly T[]): T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value) ? value as T : fail();
}

async function rpc(name: string, args: Record<string, unknown>): Promise<Row[]> {
  const { data, error } = await privilegedDb.rpc(name, args);
  if (error) throw new Error(`PASSPORT_GOVERNANCE_READ_FAILED: ${name}`);
  return Array.isArray(data) ? data as Row[] : fail();
}

function lineage(row: Row): L14GovernedFactLineage {
  if (row.trust_state !== 'VALIDATED' || row.decision_outcome !== 'VALIDATE' || row.authorization_result !== 'ALLOW') fail();
  return Object.freeze({
    factStateId: text(row.fact_state_id), predecessorStateId: nullableText(row.predecessor_state_id),
    effectiveFrom: text(row.effective_from), effectiveTo: nullableText(row.effective_to), recordedAt: text(row.recorded_at),
    trustState: 'VALIDATED', sourceClass: closed(row.source_class, L14_SOURCE_CLASSES),
    supportStatus: closed(row.support_status, L14_SUPPORT_STATUSES), proposalId: text(row.proposal_id),
    proposalSubmittedAt: text(row.proposal_submitted_at), governanceDecisionId: text(row.governance_decision_id),
    decisionOutcome: 'VALIDATE', decisionReasonCode: text(row.decision_reason_code), decidedAt: text(row.decided_at),
    authorizationDecisionId: text(row.authorization_decision_id), authorizationResult: 'ALLOW',
    authorizationEvaluatedAt: text(row.authorization_evaluated_at),
    authorityPolicy: Object.freeze({ authorityPolicyId: text(row.authority_policy_id), versionId: text(row.authority_policy_version_id),
      contentHash: text(row.authority_policy_content_hash) }),
    factSupportEvidenceIds: ids(row.fact_support_evidence_ids), decisionSupportEvidenceIds: ids(row.decision_support_evidence_ids),
    proposalSupportEvidenceIds: ids(row.proposal_support_evidence_ids),
    readEffectiveAt: text(row.read_effective_at), readRecordedCutoff: text(row.read_recorded_cutoff),
  });
}

function value(row: Row): L14PassportGovernedValue {
  const family = closed(row.fact_family, L14_EXECUTABLE_FACT_SUBJECT_KINDS);
  switch (family) {
    case 'RESPONSIBILITY_ASSIGNMENT': return Object.freeze({ family, responsibilityRole: closed(row.responsibility_role, L14_RESPONSIBILITY_ROLES),
      governancePartyId: text(row.governance_party_id), partyValidatedStateId: text(row.party_validated_state_id) });
    case 'BUSINESS_CONTEXT_ASSIGNMENT': return Object.freeze({ family, semanticKind: closed(row.semantic_kind, ['BUSINESS_DOMAIN'] as const),
      domainId: text(row.domain_id), domainValidatedStateId: text(row.domain_validated_state_id) });
    case 'POLICY_APPLICABILITY': return Object.freeze({ family, policyId: text(row.policy_id), policyVersionId: text(row.policy_version_id),
      contentHash: text(row.policy_content_hash), policyVersionValidatedStateId: text(row.policy_version_validated_state_id),
      applicability: closed(row.applicability, L14_POLICY_APPLICABILITY_OUTCOMES) });
    case 'CONTROL_APPLICABILITY': return Object.freeze({ family, controlDefinitionId: text(row.control_definition_id),
      controlDefinitionVersionId: text(row.control_definition_version_id), contentHash: text(row.control_content_hash),
      controlDefinitionValidatedStateId: text(row.control_definition_validated_state_id),
      applicability: closed(row.applicability, L14_POLICY_APPLICABILITY_OUTCOMES) });
    case 'CONTROL_ASSESSMENT': return Object.freeze({ family, controlDefinitionId: text(row.control_definition_id),
      controlDefinitionVersionId: text(row.control_definition_version_id), contentHash: text(row.control_content_hash),
      controlApplicabilityStateId: text(row.control_applicability_state_id),
      assessmentOutcome: closed(row.assessment_outcome, L14_CONTROL_ASSESSMENT_OUTCOMES) });
  }
}

/**
 * O32: current valid governed facts of the exact AGENT (families 3, 4, 12) and, when selected, of the exact AGENT_VERSION
 * (family 12 only), at ONE DB instant. Absence = UNKNOWN. A row for any other target, or an AGENT_VERSION responsibility /
 * business-context row, fails closed (never inherited, never re-targeted).
 */
export async function readPassportGovernedFacts(principal: GovernanceWritePrincipal, agentId: string, selectedVersionId: string | null):
  Promise<readonly L14PassportGovernedFact[]> {
  const rows = await rpc(PASSPORT_RPC, { ...principalArgs(principal), p_agent_canonical_object_id: agentId,
    p_agent_version_canonical_object_id: selectedVersionId, p_effective_at: null, p_recorded_cutoff: null });
  const facts = rows.map(row => {
    const targetKind = closed(row.target_kind, ['AGENT', 'AGENT_VERSION'] as const);
    const targetCanonicalObjectId = text(row.target_canonical_object_id);
    if (targetCanonicalObjectId !== (targetKind === 'AGENT' ? agentId : selectedVersionId)) fail();
    const v = value(row);
    if (targetKind === 'AGENT_VERSION' && (v.family === 'RESPONSIBILITY_ASSIGNMENT' || v.family === 'BUSINESS_CONTEXT_ASSIGNMENT')) fail();
    return Object.freeze({ targetKind, targetCanonicalObjectId, value: v, lineage: lineage(row) });
  });
  if (new Set(facts.map(f => f.lineage.factStateId)).size !== facts.length) fail();
  return Object.freeze(facts);
}

function keyTarget(key: L14FactKey): L14FactKeyTarget | null {
  switch (key.subjectKind) {
    case 'POLICY_APPLICABILITY': case 'CONTROL_APPLICABILITY': return key.target;
    case 'CONTROL_ASSESSMENT': return null;
    default: return { targetType: 'CANONICAL_OBJECT', targetCanonicalKind: key.targetCanonicalKind, targetCanonicalObjectId: key.targetCanonicalObjectId };
  }
}

/** O41: the closed conflict read of ONE exact logical fact key. No HTTP route or UI consumes this adapter in this slice. */
export async function readFactConflict(principal: GovernanceWritePrincipal, key: L14FactKey): Promise<L14ConflictReadResult> {
  const target = keyTarget(key);
  const rows = await rpc(CONFLICT_RPC, { ...principalArgs(principal), p_subject_kind: key.subjectKind,
    p_target_type: target?.targetType ?? null,
    p_target_canonical_kind: target?.targetType === 'CANONICAL_OBJECT' ? target.targetCanonicalKind : null,
    p_target_canonical_object_id: target?.targetType === 'CANONICAL_OBJECT' ? target.targetCanonicalObjectId : null,
    p_target_relationship_id: target?.targetType === 'RELATIONSHIP_STATE' ? target.relationshipId : null,
    p_target_relationship_state_id: target?.targetType === 'RELATIONSHIP_STATE' ? target.relationshipStateId : null,
    p_responsibility_role: key.subjectKind === 'RESPONSIBILITY_ASSIGNMENT' ? key.responsibilityRole : null,
    p_governance_party_id: key.subjectKind === 'RESPONSIBILITY_ASSIGNMENT' ? key.governancePartyId : null,
    p_semantic_kind: key.subjectKind === 'BUSINESS_CONTEXT_ASSIGNMENT' ? key.semanticKind : null,
    p_policy_id: key.subjectKind === 'POLICY_APPLICABILITY' ? key.definitionId : null,
    p_control_definition_id: key.subjectKind === 'CONTROL_APPLICABILITY' ? key.definitionId : null,
    p_control_applicability_state_id: key.subjectKind === 'CONTROL_ASSESSMENT' ? key.controlApplicabilityStateId : null,
    p_effective_at: null, p_recorded_cutoff: null });
  const [head, ...detail] = rows;
  if (!head || head.row_kind !== 'OUTCOME' || head.subject_kind !== key.subjectKind) fail();
  const outcome = closed(head.conflict_outcome, L14_CONFLICT_READ_OUTCOMES);
  if (rows.some(r => r.conflict_outcome !== outcome || r.subject_kind !== key.subjectKind)) fail();
  const facts = detail.filter(r => r.row_kind === 'GOVERNED_FACT');
  const proposals = detail.filter(r => r.row_kind === 'LIVE_PROPOSAL');
  if (facts.length + proposals.length !== detail.length || facts.length !== (outcome === 'RESOLVED' ? 1 : 0)
    || (outcome === 'RESOLVED' && proposals.length) || (outcome === 'CONFLICT' && proposals.length < 2)) fail();
  return Object.freeze({
    subjectKind: key.subjectKind, outcome, liveProposalCount: Number(head.live_proposal_count),
    distinctContentCount: Number(head.distinct_content_count),
    governedFact: facts[0] ? Object.freeze({ factStateId: text(facts[0].fact_state_id), governanceDecisionId: text(facts[0].governance_decision_id),
      effectiveFrom: text(facts[0].fact_effective_from), effectiveTo: nullableText(facts[0].fact_effective_to),
      recordedAt: text(facts[0].fact_recorded_at) }) : null,
    liveProposals: Object.freeze(proposals.map(r => Object.freeze({ proposalId: text(r.proposal_id), submittedAt: text(r.proposal_submitted_at),
      sourceClass: closed(r.proposal_source_class, L14_SOURCE_CLASSES), supportStatus: closed(r.proposal_support_status, L14_SUPPORT_STATUSES),
      supportEvidenceIds: ids(r.proposal_support_evidence_ids), deferred: r.proposal_deferred === true,
      assertedContentDigest: text(r.asserted_content_digest) }))),
    readEffectiveAt: text(head.read_effective_at), readRecordedCutoff: text(head.read_recorded_cutoff),
  });
}
