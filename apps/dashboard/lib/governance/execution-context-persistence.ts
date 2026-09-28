import 'server-only';
import { validateExecutionSnapshot, type ExecutionContextPersistencePort } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { executionRows, readExecutionReview, readExecutionDecision } from './execution-context-read';
import type { GovernanceWritePrincipal } from '../auth/governance-write-principal';
import { GovernedWriteError } from './governed-write-errors';

export const executionContextPersistence:ExecutionContextPersistencePort={
  async recordSnapshot(snapshot) {
    validateExecutionSnapshot(snapshot);
    // Snapshot copy before await prevents caller mutation of trusted intake context.
    const copy=structuredClone(snapshot);
    const heads=await executionRows(copy.organisationId,'execution_source_heads',{source_scope:copy.sourceScope});
    const {error}=await privilegedDb.rpc('record_execution_snapshot',{p_organisation_id:copy.organisationId,p_snapshot:copy,p_expected_previous:heads[0]?.snapshot_id??null});
    if(error)throw new Error('EXECUTION_SNAPSHOT_REJECTED');
  },
  getReviewContext:readExecutionReview,
  getDecision:readExecutionDecision,
  async recordDecision(decision) {
    const {data,error}=await privilegedDb.rpc('record_execution_field_decision',{p_organisation_id:decision.organisationId,p_decision:decision});
    if(error)throw new Error('EXECUTION_DECISION_REJECTED');
    if(!data||data.length!==1)throw new Error('EXECUTION_DECISION_RESULT_MISSING');
    return {replay:data[0].replay,...(data[0].state_id?{stateId:data[0].state_id}:{})};
  },
};

/** M16-S0.3.3C — governed execution-field decision. recordSnapshot/getReviewContext/
 * getDecision are reused unchanged (snapshot intake has no HUMAN write-authority
 * question; both reads need no verified principal); only recordDecision is
 * overridden to call record_execution_field_decision_governed_v1. The prior blanket
 * "EXECUTION_DECISION_REJECTED" now carries the real SQLSTATE via GovernedWriteError
 * for route-level security classification, while its message text (and therefore
 * every existing route-level business-error check against it) is unchanged. */
export function createGovernedExecutionContextPersistence(
  writePrincipal: GovernanceWritePrincipal,
): ExecutionContextPersistencePort {
  return {
    ...executionContextPersistence,
    async recordDecision(decision) {
      const {data,error}=await privilegedDb.rpc('record_execution_field_decision_governed_v1',{
        p_verified_organisation_id:writePrincipal.organisationId,
        p_verified_actor_user_id:writePrincipal.actorUserId,
        p_verified_session_iat:writePrincipal.issuedAtSeconds,
        p_verified_session_exp:writePrincipal.expiresAtSeconds,
        p_verified_credential_epoch:writePrincipal.credentialEpoch,
        p_decision:decision,
      });
      if(error)throw new GovernedWriteError('EXECUTION_DECISION_REJECTED', error.code);
      if(!data||data.length!==1)throw new Error('EXECUTION_DECISION_RESULT_MISSING');
      return {replay:data[0].replay,...(data[0].state_id?{stateId:data[0].state_id}:{})};
    },
  };
}
