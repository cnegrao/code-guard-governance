import 'server-only';
import { asCanonicalObjectId, asIsoTimestamp, asSourceConnectionId, asExternalId, createBehaviorFingerprint,
  createExecutionFact, type DirectExecutionFact, type ExecutionSourceSnapshot, type ExecutionFieldDecision,
  type OrganisationId } from '@council/canonical-contracts';
import { validateExecutionSnapshot, type ExecutionReviewContext } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { currentFieldState } from './agent-passport';

// Explicit typed semantic columns only; never select unrestricted source envelopes.
const columns = {
  execution_source_snapshots: 'snapshot_id,source_scope,candidate_id,connection_id,source_system_id,provider_code,external_type,external_id,declaration_key,source_snapshot_id,fingerprint_value,fingerprint_schema,authorization_state,recorded_at',
  execution_source_heads: 'source_scope,snapshot_id',
  execution_source_facts: 'snapshot_id,ordinal,field_key,capability_reference,tool_candidate_id,principal_kind,principal_provider,principal_authority,principal_reference,endpoint,protocol_kind,protocol_value,scope_reference,resource_reference,assertion_id,evidence_id',
  execution_field_policies: 'policy_id,version,field_key,source_system_id,provider_code,connection_id,disposition',
  execution_field_policy_heads: 'policy_id,version',
  execution_field_decisions: 'decision_id,canonical_object_id,snapshot_id,field_key,expected_current_state_id,policy_id,policy_version,outcome,actor_reference,decided_at',
  execution_field_states: 'state_id,canonical_object_id,field_key,snapshot_id,decision_id,previous_state_id,recorded_at',
  canonical_normalized_object_mappings: 'mapping_id,canonical_object_id,canonical_object_kind,normalized_object_identity,source_connection_id,source_external_type,source_external_id',
  canonical_objects: 'canonical_object_id,kind',
} as const;
export type ExecutionRow = Record<string, any>;
export async function executionRows(org: OrganisationId, table: keyof typeof columns, filter: Record<string,string> = {}): Promise<ExecutionRow[]> {
  const result: ExecutionRow[] = [];
  for (let offset=0; offset<10000; offset+=200) {
    let q = privilegedDb.from(table).select(`organisation_id,${columns[table]}`).eq('organisation_id',org);
    for (const [key,value] of Object.entries(filter)) q=q.eq(key,value);
    for (const key of columns[table].split(',').slice(0,2)) q=q.order(key);
    const {data,error} = await q.range(offset,offset+199);
    if (error) throw new Error('EXECUTION_READ_FAILED');
    const rows = (data ?? []) as ExecutionRow[];
    if (rows.some(r=>r.organisation_id!==org)) throw new Error('EXECUTION_TENANT_MISMATCH');
    result.push(...rows); if(rows.length<200) return result;
  }
  throw new Error('EXECUTION_READ_LIMIT');
}
export function executionFactFromRow(r: ExecutionRow): DirectExecutionFact {
  const fact = r.field_key==='CAPABILITY' ? {field:r.field_key,capabilityReference:r.capability_reference} :
    r.field_key==='PRINCIPAL' ? {field:r.field_key,principal:{kind:r.principal_kind,providerCode:r.principal_provider,authorityReference:r.principal_authority,principalReference:r.principal_reference}} :
    r.field_key==='REQUESTED_SCOPE' ? {field:r.field_key,scopeReference:r.scope_reference,resourceReference:r.resource_reference} :
    r.field_key==='DECLARED_CONNECTIVITY' ? {field:r.field_key,endpoint:r.endpoint,protocol:r.protocol_kind==='API'?{kind:'API',family:r.protocol_value}:{kind:r.protocol_kind,transport:r.protocol_value}} : undefined;
  if(!fact) throw new Error('EXECUTION_FACT_INVALID');
  return createExecutionFact(fact as DirectExecutionFact) as DirectExecutionFact;
}
export async function readExecutionSnapshot(org: OrganisationId,id:string): Promise<ExecutionSourceSnapshot> {
  const snapshots=await executionRows(org,'execution_source_snapshots',{snapshot_id:id});
  if(snapshots.length!==1)throw new Error('EXECUTION_SNAPSHOT_NOT_FOUND');
  const s=snapshots[0]; const values=await executionRows(org,'execution_source_facts',{snapshot_id:id});
  values.sort((a,b)=>a.ordinal-b.ordinal);
  if(values.some((r,i)=>r.ordinal!==i))throw new Error('EXECUTION_FACT_ORDER_INVALID');
  const result: ExecutionSourceSnapshot={organisationId:org,snapshotId:id,sourceScope:s.source_scope,agentVersionCandidateId:s.candidate_id,
    sourceObject:{connectionId:asSourceConnectionId(s.connection_id),externalType:s.external_type,externalId:asExternalId(s.external_id)},
    sourceSystemId:s.source_system_id,providerCode:s.provider_code,declarationKey:s.declaration_key,sourceSnapshotId:s.source_snapshot_id,
    behaviorFingerprint:createBehaviorFingerprint({algorithm:'sha256',schemaVersion:s.fingerprint_schema,value:s.fingerprint_value}),
    recordedAt:asIsoTimestamp(new Date(s.recorded_at).toISOString()),authorizationState:s.authorization_state,
    facts:values.map(r=>({fact:executionFactFromRow(r),assertionId:r.assertion_id,evidenceId:r.evidence_id,...(r.tool_candidate_id?{toolCandidateId:r.tool_candidate_id}:{})}))};
  validateExecutionSnapshot(result);return result;
}
export async function readExecutionReview(org:OrganisationId,id:string,field:ExecutionFieldDecision['field']):Promise<ExecutionReviewContext> {
  const snapshot=await readExecutionSnapshot(org,id);
  const maps=await executionRows(org,'canonical_normalized_object_mappings',{canonical_object_kind:'AGENT_VERSION',normalized_object_identity:snapshot.agentVersionCandidateId,
    source_connection_id:snapshot.sourceObject.connectionId,source_external_type:snapshot.sourceObject.externalType,source_external_id:snapshot.sourceObject.externalId});
  if(maps.length>1)throw new Error('EXECUTION_MAPPING_AMBIGUOUS');
  const objects=maps.length ? await executionRows(org,'canonical_objects',{canonical_object_id:maps[0].canonical_object_id,kind:'AGENT_VERSION'}) : [];
  if(objects.length>1)throw new Error('EXECUTION_MAPPING_AMBIGUOUS');
  const states=objects.length ? await executionRows(org,'execution_field_states',{canonical_object_id:objects[0].canonical_object_id,field_key:field}) : [];
  const current=currentFieldState(states as Array<ExecutionRow & {state_id:string;previous_state_id:string|null}>);
  const heads=await executionRows(org,'execution_source_heads',{source_scope:snapshot.sourceScope});
  if(heads.length>1)throw new Error('EXECUTION_SOURCE_AMBIGUOUS');
  const policies=await executionRows(org,'execution_field_policies');
  const policyHeads=await executionRows(org,'execution_field_policy_heads');
  return {snapshot,...(objects.length?{object:{organisationId:org,kind:'AGENT_VERSION' as const,objectId:asCanonicalObjectId(objects[0].canonical_object_id)}}:{}),
    currentSourceSnapshotId:heads[0]?.snapshot_id,currentStateId:current?.state_id,
    policies:policies.map(p=>({organisationId:org,objectKind:'AGENT_VERSION',policyId:p.policy_id,version:p.version,field:p.field_key,sourceSystemId:p.source_system_id,
      providerCode:p.provider_code,...(p.connection_id?{connectionId:p.connection_id}:{}),disposition:p.disposition})),
    policyHeads:policyHeads.map(p=>({organisationId:org,policyId:p.policy_id,version:p.version}))};
}
export async function readExecutionDecision(org:OrganisationId,id:string) {
  const rows=await executionRows(org,'execution_field_decisions',{decision_id:id}); if(!rows.length)return undefined;
  if(rows.length!==1)throw new Error('EXECUTION_DECISION_AMBIGUOUS'); const r=rows[0];
  const states=await executionRows(org,'execution_field_states',{decision_id:id});
  if(states.length>1)throw new Error('EXECUTION_DECISION_AMBIGUOUS');
  const decision:ExecutionFieldDecision={organisationId:org,decisionId:id,canonicalObject:{organisationId:org,kind:'AGENT_VERSION',objectId:asCanonicalObjectId(r.canonical_object_id)},
    snapshotId:r.snapshot_id,field:r.field_key,...(r.expected_current_state_id?{expectedCurrentStateId:r.expected_current_state_id}:{}),
    ...(r.policy_id?{policyId:r.policy_id,policyVersion:r.policy_version}:{}),outcome:r.outcome,actor:{authorityKind:'HUMAN',actorReference:r.actor_reference},decidedAt:asIsoTimestamp(new Date(r.decided_at).toISOString())};
  return {decision,...(states[0]?{stateId:states[0].state_id}:{})};
}
