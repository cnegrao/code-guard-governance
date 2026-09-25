import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId, asSourceConnectionId, asExternalId, asIsoTimestamp, createBehaviorFingerprint, sourceObjectIdentityKey, type ExecutionSourceSnapshot } from '@council/canonical-contracts';
import { executionDigest } from '@council/governance-review';

const org=asOrganisationId('11111111-1111-1111-1111-111111111111');
let calls:{name:string;args:any}[]=[];
let filters:[string,unknown][]=[];
let fail=false;
let persistence:typeof import('@/lib/governance/execution-context-persistence').executionContextPersistence;
let submit:typeof import('@/lib/governance/execution-context-review').submitExecutionDecision;
const db={from(){
  const query={select(){return query;},eq(k:string,v:unknown){filters.push([k,v]);return query;},order(){return query;},
    range(){return Promise.resolve({data:[],error:null});}};return query;
},async rpc(name:string,args:any){calls.push({name,args});return fail?{data:null,error:{message:'PRIVATE_FAILURE_PAYLOAD'}}:{data:null,error:null};}};
before(async()=>{
  mock.module('@/lib/governance/persistence',{namedExports:{privilegedDb:db}});
  persistence=(await import('@/lib/governance/execution-context-persistence')).executionContextPersistence;
  submit=(await import('@/lib/governance/execution-context-review')).submitExecutionDecision;
});
beforeEach(()=>{calls=[];filters=[];fail=false;});
function snapshot():ExecutionSourceSnapshot{
  const sourceObject={connectionId:asSourceConnectionId('repo'),externalType:'file',externalId:asExternalId('agent.ts')};
  const sourceScope=executionDigest([sourceObjectIdentityKey(sourceObject),'triageAgent']);
  const candidate=`candidate:agent-version:${'a'.repeat(32)}`;
  const facts:ExecutionSourceSnapshot['facts']=[{fact:{field:'REQUESTED_SCOPE',scopeReference:'read',resourceReference:'catalog'},assertionId:'assertion',evidenceId:'evidence'}];
  return {organisationId:org,sourceScope,sourceObject,agentVersionCandidateId:candidate,sourceSystemId:'repository',providerCode:'fixture',declarationKey:'triageAgent',sourceSnapshotId:'source',
    snapshotId:`execution-snapshot:${executionDigest([org,sourceScope,candidate,'source',facts])}`,facts,authorizationState:'UNKNOWN',recordedAt:asIsoTimestamp('2026-09-15T00:00:00.000Z'),
    behaviorFingerprint:createBehaviorFingerprint({algorithm:'sha256',schemaVersion:'1.1',value:'b'.repeat(32)})};
}
test('M13 persistence scopes lookup and RPC to the same trusted organisation',async()=>{
  const s=snapshot();await persistence.recordSnapshot(s);
  assert.ok(filters.some(([k,v])=>k==='organisation_id'&&v===org));
  assert.deepEqual(calls,[{name:'record_execution_snapshot',args:{p_organisation_id:org,p_snapshot:s,p_expected_previous:null}}]);
});
test('M13 persistence captures immutable input before asynchronous head lookup',async()=>{
  const s=snapshot();const pending=persistence.recordSnapshot(s);
  (s as any).organisationId='forged';await pending;
  assert.equal(calls[0].args.p_organisation_id,org);assert.equal(calls[0].args.p_snapshot.organisationId,org);
});
test('M13 RPC error exposes only a value-free failure and no private payload',async()=>{
  fail=true;await assert.rejects(persistence.recordSnapshot(snapshot()),{message:'EXECUTION_SNAPSHOT_REJECTED'});
});
test('M13 snapshot credential extensions cannot reach any RPC',async()=>{
  await assert.rejects(persistence.recordSnapshot({...snapshot(),token:'rejected-fixture'} as never),/SNAPSHOT_INVALID/);
  assert.deepEqual(calls,[]);assert.deepEqual(filters,[]);
});
const request={decisionId:'decision',canonicalObjectId:'version',snapshotId:'snapshot',field:'PRINCIPAL',outcome:'ACCEPT_PROPOSED'};
const context={organisationId:org,actorReference:'human',currentRole:'org_admin'};
for(const field of ['organisationId','actor','authorizationState','grantedScopes','token'])test(`M13 command rejects caller-supplied ${field}`,async()=>{
  await assert.rejects(submit({...request,[field]:'forged'},context),/DECISION_INVALID/);
  assert.deepEqual(calls,[]);assert.deepEqual(filters,[]);
});
test('M13 command denies non-reviewer and missing human before reading governance state',async()=>{
  for(const ctx of [{...context,currentRole:'user'},{...context,actorReference:''}])await assert.rejects(submit(request,ctx),/FORBIDDEN/);
  assert.deepEqual(calls,[]);assert.deepEqual(filters,[]);
});
