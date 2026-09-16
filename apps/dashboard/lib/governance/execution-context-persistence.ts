import 'server-only';
import { validateExecutionSnapshot, type ExecutionContextPersistencePort } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { executionRows, readExecutionReview, readExecutionDecision } from './execution-context-read';

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
