import 'server-only';
import type { L15RiskProjectionReadRequest, L15RiskProjectionReadResult } from '@council/canonical-contracts';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { privilegedDb } from './persistence';
import { GovernedWriteError } from './governed-write-errors';

/** Read-only S7A transport. Tenant and actor are taken only from the verified principal. */
export async function readRiskProjections(principal: GovernanceWritePrincipal,input:L15RiskProjectionReadRequest):Promise<L15RiskProjectionReadResult>{
  const {data,error}=await privilegedDb.rpc('l15_read_risk_projections_v1',{
    p_verified_organisation_id:principal.organisationId,p_verified_actor_user_id:principal.actorUserId,
    p_verified_session_iat:principal.issuedAtSeconds,p_verified_session_exp:principal.expiresAtSeconds,
    p_verified_credential_epoch:principal.credentialEpoch,p_subject_type:input.subjectType,
    p_subject_canonical_kind:input.subjectCanonicalKind,p_subject_canonical_object_id:input.subjectCanonicalObjectId,
    p_subject_relationship_id:input.subjectRelationshipId,p_subject_relationship_state_id:input.subjectRelationshipStateId,
    p_scenario_definition_id:input.scenarioDefinitionId,p_effective_at:input.effectiveAt,p_recorded_cutoff:input.recordedCutoff});
  if(error) throw new GovernedWriteError(`l15_read_risk_projections_v1 failed: ${error.message}`,error.code);
  const row=(Array.isArray(data)?data[0]:data) as Record<string,unknown>|undefined;
  if(!row) throw new GovernedWriteError('l15_read_risk_projections_v1 returned no row');
  return Object.freeze({governedRiskStateId:row.governed_risk_state_id,lifecycle:row.lifecycle,
    conflictOutcome:row.conflict_outcome,liveProposalCount:row.live_proposal_count,distinctContentCount:row.distinct_content_count,
    accountablePartyStatus:row.accountable_party_status,accountableParties:Object.freeze(row.accountable_parties as object[]),
    controlCoverage:Object.freeze(row.control_coverage as object[]),effectiveAt:row.effective_at,recordedCutoff:row.recorded_cutoff}) as unknown as L15RiskProjectionReadResult;
}
