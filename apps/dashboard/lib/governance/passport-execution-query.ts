import 'server-only';
import { DIRECT_EXECUTION_FIELDS, type OrganisationId } from '@council/canonical-contracts';
import { executionRows, readExecutionReview, readExecutionDecision } from './execution-context-read';
import { currentFieldState, type ExecutionPassportFact, type PassportProvenance } from './agent-passport';

export async function readPassportExecution(org:OrganisationId,versionId:string,
  support:(assertions:readonly string[],evidence:readonly string[])=>Promise<Pick<PassportProvenance,'sources'|'evidence'>>,
  readAt:number):Promise<ExecutionPassportFact[]> {
  const result:ExecutionPassportFact[]=[];
  for(const field of DIRECT_EXECUTION_FIELDS) {
    const history=await executionRows(org,'execution_field_states',{canonical_object_id:versionId,field_key:field});
    const visible=history.filter(s=>{
      const at=Date.parse(s.recorded_at);if(!Number.isFinite(at))throw new Error('EXECUTION_TIME_INVALID');return at<=readAt;
    });
    const state=currentFieldState(visible as Array<{state_id:string;previous_state_id:string|null}&Record<string,any>>);
    if(!state)continue;
    const ctx=await readExecutionReview(org,state.snapshot_id,field);
    const decision=await readExecutionDecision(org,state.decision_id);
    if(ctx.object?.objectId!==versionId || !decision || decision.stateId!==state.state_id || decision.decision.outcome!=='ACCEPT_PROPOSED' ||
      decision.decision.canonicalObject.objectId!==versionId ||
      decision.decision.expectedCurrentStateId!==(state.previous_state_id??undefined) ||
      Date.parse(decision.decision.decidedAt)!==Date.parse(state.recorded_at) ||
      decision.decision.snapshotId!==state.snapshot_id || decision.decision.field!==field || !decision.decision.policyId ||
      !ctx.policies.some(p=>p.policyId===decision.decision.policyId&&p.version===decision.decision.policyVersion&&p.field===field&&
        p.sourceSystemId===ctx.snapshot.sourceSystemId&&p.providerCode===ctx.snapshot.providerCode&&
        (!p.connectionId||p.connectionId===ctx.snapshot.sourceObject.connectionId)&&
        ['AUTHORITATIVE','CONTRIBUTING'].includes(p.disposition)))throw new Error('EXECUTION_GOVERNED_STATE_INVALID');
    for(const [index,item] of ctx.snapshot.facts.entries()) {
      if(item.fact.field!==field)continue;
      const provenance=await support([item.assertionId],[item.evidenceId]);
      if(provenance.sources.length!==1||provenance.evidence.length!==1||provenance.sources[0].trust!=='DECLARED'||
        provenance.sources[0].method!=='DIRECT_AGENT_EXECUTION_V1'||
        provenance.sources[0].sourceSystemId!==ctx.snapshot.sourceSystemId||
        provenance.sources[0].connectionId!==ctx.snapshot.sourceObject.connectionId||provenance.sources[0].externalType!==ctx.snapshot.sourceObject.externalType||
        provenance.sources[0].externalId!==ctx.snapshot.sourceObject.externalId||provenance.evidence[0].handling!=='HASH_ONLY')throw new Error('EXECUTION_SUPPORT_MISSING');
      result.push({type:'execution',id:`${state.state_id}:${index}`,versionId,fact:item.fact,sourceSnapshotId:ctx.snapshot.sourceSnapshotId,authorizationState:'UNKNOWN',
        provenance:{...provenance,storage:'execution_field_states',authority:'GOVERNED_FIELD_STATE',decisionId:state.decision_id,
          decidedAt:decision.decision.decidedAt,recordedAt:state.recorded_at,snapshotId:ctx.snapshot.sourceSnapshotId,
          policy:{policyId:decision.decision.policyId,acceptedVersion:decision.decision.policyVersion!,
            activeVersion:ctx.policyHeads.find(h=>h.policyId===decision.decision.policyId)?.version}}});
    }
  }
  return result;
}
