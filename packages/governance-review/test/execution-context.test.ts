import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asOrganisationId, asSourceConnectionId, asExternalId, asIsoTimestamp, asCanonicalObjectId,
  createBehaviorFingerprint, sourceObjectIdentityKey, type ExecutionSourceSnapshot, type ExecutionFieldDecision } from '@council/canonical-contracts';
import { executionDigest, validateExecutionSnapshot, reconcileExecutionField, type ExecutionReviewContext, type ExecutionContextPersistencePort } from '../src/execution-context';

const org=asOrganisationId('11111111-1111-1111-1111-111111111111');
const time=asIsoTimestamp('2026-09-15T00:00:00.000Z');
function fixture(tenant=org) {
  const sourceObject={connectionId:asSourceConnectionId('repo'),externalType:'file',externalId:asExternalId('agent.ts')};
  const sourceScope=executionDigest([sourceObjectIdentityKey(sourceObject),'triageAgent']);
  const facts:ExecutionSourceSnapshot['facts']=[{fact:{field:'PRINCIPAL',principal:{kind:'SERVICE_ACCOUNT',providerCode:'fixture',authorityReference:'realm',principalReference:'account'}},assertionId:'a',evidenceId:'e'}];
  const candidate=`candidate:agent-version:${'a'.repeat(32)}`;
  const snapshot:ExecutionSourceSnapshot={organisationId:tenant,sourceScope,agentVersionCandidateId:candidate,sourceObject,
    sourceSystemId:'system',providerCode:'fixture',declarationKey:'triageAgent',sourceSnapshotId:'snapshot',
    snapshotId:`execution-snapshot:${executionDigest([tenant,sourceScope,candidate,'snapshot',facts])}`,
    behaviorFingerprint:createBehaviorFingerprint({algorithm:'sha256',schemaVersion:'1.0',value:'b'.repeat(32)}),recordedAt:time,authorizationState:'UNKNOWN',facts};
  const object={organisationId:tenant,kind:'AGENT_VERSION' as const,objectId:asCanonicalObjectId('version')};
  const ctx:{-readonly [K in keyof ExecutionReviewContext]:ExecutionReviewContext[K]}={snapshot,object,currentSourceSnapshotId:snapshot.snapshotId,
    policies:[{organisationId:tenant,objectKind:'AGENT_VERSION',policyId:'policy',version:'1',field:'PRINCIPAL',sourceSystemId:'system',providerCode:'fixture',disposition:'CONTRIBUTING'}],
    policyHeads:[{organisationId:tenant,policyId:'policy',version:'1'}]};
  const decision:ExecutionFieldDecision={organisationId:tenant,decisionId:'decision',canonicalObject:object,snapshotId:snapshot.snapshotId,field:'PRINCIPAL',policyId:'policy',policyVersion:'1',
    outcome:'ACCEPT_PROPOSED',actor:{authorityKind:'HUMAN',actorReference:'reviewer'},decidedAt:time};
  let writes=0;let previous:{decision:ExecutionFieldDecision;stateId:string}|undefined;
  const port:ExecutionContextPersistencePort={recordSnapshot:async()=>{},getReviewContext:async()=>ctx,getDecision:async()=>previous,
    recordDecision:async d=>{writes++;previous={decision:d,stateId:'state'};return {replay:false,stateId:'state'};}};
  return {snapshot,ctx,decision,port,writes:()=>writes};
}
test('explicit human field governance accepts declared principal without authorizing execution',async()=>{
  const f=fixture();validateExecutionSnapshot(f.snapshot);
  assert.equal((await reconcileExecutionField(f.decision,f.port,{authorize:()=>true})).stateId,'state');
  assert.equal(f.snapshot.authorizationState,'UNKNOWN');assert.equal(f.writes(),1);
});
test('same principal identifier in different organisations has separate snapshot identity',()=>{
  const a=fixture();const b=fixture(asOrganisationId('22222222-2222-2222-2222-222222222222'));
  validateExecutionSnapshot(a.snapshot);validateExecutionSnapshot(b.snapshot);
  assert.notEqual(a.snapshot.snapshotId,b.snapshot.snapshotId);
  assert.throws(()=>validateExecutionSnapshot({...a.snapshot,organisationId:b.snapshot.organisationId}),/IDENTITY_MISMATCH/);
});
test('completed replay preserves original decision without another state write',async()=>{
  const f=fixture();await reconcileExecutionField(f.decision,f.port,{authorize:()=>true});
  f.ctx.currentSourceSnapshotId='new-source' as never;
  assert.equal((await reconcileExecutionField(f.decision,f.port,{authorize:()=>true})).replay,true);assert.equal(f.writes(),1);
  await assert.rejects(reconcileExecutionField({...f.decision,outcome:'DEFER'},f.port,{authorize:()=>true}),/REPLAY_CONFLICT/);
});
for(const [name,mutate,error] of [
  ['cross tenant', (f:ReturnType<typeof fixture>)=>{f.ctx.object={...f.ctx.object!,organisationId:asOrganisationId('foreign')};}, /BINDING_MISMATCH/],
  ['wrong Agent subject',(f:ReturnType<typeof fixture>)=>{f.ctx.object={...f.ctx.object!,kind:'AGENT' as never};},/BINDING_MISMATCH/],
  ['missing mapping',(f:ReturnType<typeof fixture>)=>{f.ctx.object=undefined;},/BINDING_MISMATCH/],
  ['stale snapshot',(f:ReturnType<typeof fixture>)=>{f.ctx.currentSourceSnapshotId='new';},/STALE_SOURCE/],
  ['stale state',(f:ReturnType<typeof fixture>)=>{f.ctx.currentStateId='new';},/STALE_STATE/],
  ['missing policy',(f:ReturnType<typeof fixture>)=>{f.ctx.policyHeads=[];},/STALE_POLICY/],
  ['stale policy version',(f:ReturnType<typeof fixture>)=>{f.ctx.policies=[{...f.ctx.policies[0],version:'2'}];f.ctx.policyHeads=[{...f.ctx.policyHeads[0],version:'2'}];},/STALE_POLICY/],
  ['wrong policy provider',(f:ReturnType<typeof fixture>)=>{f.ctx.policies=[{...f.ctx.policies[0],providerCode:'foreign'}];},/STALE_POLICY/],
  ['wrong policy connection',(f:ReturnType<typeof fixture>)=>{f.ctx.policies=[{...f.ctx.policies[0],connectionId:'foreign' as never}];},/STALE_POLICY/],
  ['ambiguous policy',(f:ReturnType<typeof fixture>)=>{f.ctx.policies=[...f.ctx.policies,{...f.ctx.policies[0],policyId:'other'}];f.ctx.policyHeads=[...f.ctx.policyHeads,{organisationId:org,policyId:'other',version:'1'}];},/POLICY_AMBIGUOUS/],
  ['non-authoritative',(f:ReturnType<typeof fixture>)=>{f.ctx.policies=[{...f.ctx.policies[0],disposition:'NON_AUTHORITATIVE'}];},/NO_FIELD_AUTHORITY/],
] as const)test(`${name} fails closed before any state write`,async()=>{
  const f=fixture();mutate(f);await assert.rejects(reconcileExecutionField(f.decision,f.port,{authorize:()=>true}),error);assert.equal(f.writes(),0);
});
test('review actor authority is required; Graph/Vector/LLM cannot substitute',async()=>{
  for(const actor of ['GRAPH','VECTOR','LLM','DETERMINISTIC_RULE']){
    const f=fixture();await assert.rejects(reconcileExecutionField({...f.decision,actor:{authorityKind:actor,actorReference:'x'} as never},f.port,{authorize:()=>true}),/FORBIDDEN/);assert.equal(f.writes(),0);
  }
  const f=fixture();await assert.rejects(reconcileExecutionField(f.decision,f.port,{authorize:()=>false}),/FORBIDDEN/);
});
test('self-declared grant and runtime state cannot enter the direct snapshot contract',()=>{
  const f=fixture();for(const authorizationState of ['ALLOWED','DENIED','OBSERVED'])assert.throws(()=>validateExecutionSnapshot({...f.snapshot,authorizationState:authorizationState as never}),/INVALID/);
  assert.throws(()=>validateExecutionSnapshot({...f.snapshot,facts:[{...f.snapshot.facts[0],fact:{field:'GRANTED_SCOPE',principal:(f.snapshot.facts[0].fact as any).principal,scopeReference:'read',resourceReference:'catalog'} as never}]}),/SUPPORT_INVALID/);
});

test('snapshot envelopes reject unknown credential fields before persistence',()=>{
  const f=fixture();
  assert.throws(()=>validateExecutionSnapshot({...f.snapshot,token:'fixture-rejected'} as never),/SNAPSHOT_INVALID/);
  assert.throws(()=>validateExecutionSnapshot({...f.snapshot,facts:[{...f.snapshot.facts[0],password:'fixture-rejected'} as never]}),/SNAPSHOT_INVALID/);
});
test('decision caller mutation during async authorization cannot redirect a governed write',async()=>{
  const f=fixture();
  const result=await reconcileExecutionField(f.decision,f.port,{authorize:async()=>{
    (f.decision as any).snapshotId='forged';return true;
  }});
  assert.equal(result.stateId,'state');
  assert.equal((await f.port.getDecision(org,'decision'))!.decision.snapshotId,f.snapshot.snapshotId);
});
for(const outcome of ['KEEP_CURRENT','DEFER','REJECT_PROPOSED'] as const)test(`${outcome} preserves explicit nonacceptance`,async()=>{
  const f=fixture();let recorded:ExecutionFieldDecision|undefined;
  f.port.recordDecision=async d=>{recorded=d;return {replay:false};};
  const result=await reconcileExecutionField({...f.decision,outcome},f.port,{authorize:()=>true});
  assert.equal(result.stateId,undefined);assert.equal(recorded?.outcome,outcome);
});
