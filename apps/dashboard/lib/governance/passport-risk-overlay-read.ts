import 'server-only';
import { PASSPORT_FAMILIES, type PassportFamilyId, type PassportRiskOverlay, type PassportRiskOverlayItem } from './agent-passport';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from './persistence';

type Row = Record<string, unknown>;
const RPC = 'l15_read_passport_risk_overlay_v1';
const bands = ['LOW','MODERATE','HIGH','CRITICAL','UNKNOWN'] as const;
const support = ['SUPPORT_CURRENT','SUPPORT_DEGRADED','SUPPORT_NONE'] as const;
const text = (value: unknown): string => typeof value === 'string' && value.length ? value : fail();
function fail(): never { throw new Error('PASSPORT_RISK_OVERLAY_ROW_INVALID'); }
function closed<T extends string>(value: unknown, values: readonly T[]): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fail();
}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();

export async function readPassportRiskOverlay(principal: GovernanceWritePrincipal, subjectKind: 'AGENT'|'AGENT_VERSION',
  subjectCanonicalObjectId: string): Promise<PassportRiskOverlay> {
  const { data, error } = await privilegedDb.rpc(RPC, {
    p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.actorUserId,
    p_verified_session_iat: principal.issuedAtSeconds, p_verified_session_exp: principal.expiresAtSeconds,
    p_verified_credential_epoch: principal.credentialEpoch, p_subject_canonical_kind: subjectKind,
    p_subject_canonical_object_id: subjectCanonicalObjectId, p_effective_at: null, p_recorded_cutoff: null,
  });
  if (error) throw new Error('PASSPORT_RISK_OVERLAY_READ_FAILED');
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row || !['PRESENT','UNKNOWN'].includes(String(row.overlay_status))) fail();
  const items = array(row.items).map(raw => {
    const item = raw as Row, lineage = item.lineage as Row;
    if (!lineage || item.subjectKind !== subjectKind || item.subjectCanonicalObjectId !== subjectCanonicalObjectId) fail();
    return Object.freeze({
      governedRiskStateId: text(item.governedRiskStateId), scenarioDefinitionId: text(item.scenarioDefinitionId),
      riskDomain: text(item.riskDomain), subjectKind, subjectCanonicalObjectId,
      familyId: closed(item.familyId, PASSPORT_FAMILIES.map(f => f[0]) as readonly PassportFamilyId[]), lifecycle: text(item.lifecycle),
      inherentBand: closed(item.inherentBand, bands), residualBand: closed(item.residualBand, bands),
      acceptanceStatus: closed(item.acceptanceStatus, ['ACCEPTED','UNKNOWN'] as const), acceptanceValidity: text(item.acceptanceValidity),
      supportCurrency: closed(item.supportCurrency, support),
      accountableParties: Object.freeze(array(item.accountableParties) as PassportRiskOverlayItem['accountableParties']),
      controlAssessmentStateIds: Object.freeze(array(item.controlAssessmentStateIds).map(text)),
      lineage: Object.freeze({ proposalId: text(lineage.proposalId), governanceDecisionId: text(lineage.governanceDecisionId),
        authorizationDecisionId: text(lineage.authorizationDecisionId), authorityPolicyId: text(lineage.authorityPolicyId),
        authorityPolicyVersionId: text(lineage.authorityPolicyVersionId), recordedAt: text(lineage.recordedAt) }),
    } satisfies PassportRiskOverlayItem);
  });
  if ((row.overlay_status === 'UNKNOWN') !== (items.length === 0)) fail();
  return Object.freeze({ status: row.overlay_status as 'PRESENT'|'UNKNOWN', authority: 'GOVERNED_READ', items: Object.freeze(items),
    nonAuthoritativeAnalysis: Object.freeze({ label: 'NON-AUTHORITATIVE ANALYSIS', hypotheses: Object.freeze([]) }) });
}
