import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId } from '@council/canonical-contracts';
import { runtimeFromRow, runtimeToRow } from '../lib/governance/runtime-row';
import { validatePersistedRuntimeObservation } from '@council/governance-review';
import { fixture, modelWithCost, precisionBoundary } from './helpers/runtime-fixtures';

let calls: { name: string; args: any }[] = [];
let error: string | undefined;
let responsePatch: Record<string, unknown> = {};
let persist: typeof import('../lib/governance/runtime-persistence').persistRuntimeObservation;
before(async()=>{
  mock.module('../lib/governance/persistence',{namedExports:{privilegedDb:{async rpc(name: string,args: any) {
    calls.push({name,args});
    return error ? {data:null,error:{message:error}} : {data:[{replay:false,observation:{...args.p_observation,recorded_at:'2026-09-17T00:00:00.000Z',...responsePatch}}],error:null};
  }}}});
  persist=(await import('../lib/governance/runtime-persistence')).persistRuntimeObservation;
});
beforeEach(()=>{calls=[];error=undefined;responsePatch={};});
const context=()=>({organisationId:fixture().organisationId,connectionId:fixture().sourceConnection.connectionId});

test('server adapter uses one restricted RPC and validates its durable readback',async()=>{
  const result=await persist(context(),fixture());
  assert.equal(result.replay,false);assert.equal(result.observation.recordedAt.state,'KNOWN');
  assert.equal(calls.length,1);assert.equal(calls[0].name,'admit_runtime_observation');
  assert.equal(calls[0].args.p_organisation_id,context().organisationId);assert.ok(!('recorded_at' in calls[0].args.p_observation));
});
test('tenant mismatch and caller recordedAt never reach persistence',async()=>{
  await assert.rejects(persist({...context(),organisationId:asOrganisationId('foreign')},fixture()),/RUNTIME_SOURCE_MISMATCH/);
  await assert.rejects(persist(context(),{...fixture(),recordedAt:{state:'KNOWN',value:'2026-09-17T00:00:00.000Z'}} as never),/RUNTIME_TIME_INVALID/);
  assert.equal(calls.length,0);
});
test('safe errors remain stable and private database errors are not echoed',async()=>{
  error='RUNTIME_REPLAY_CONFLICT';await assert.rejects(persist(context(),fixture()),{message:error});
  error='PRIVATE_VALUE';await assert.rejects(persist(context(),fixture()),{message:'RUNTIME_ADMISSION_REJECTED'});
});
test('invalid or foreign readback is rejected',async()=>{
  for(const patch of [{recorded_at:null},{provenance_org:'22222222-2222-4222-8222-222222222222'},{span_id:'c'.repeat(16)}]){
    responsePatch=patch;await assert.rejects(persist(context(),fixture()),{message:'RUNTIME_READBACK_INVALID'});
  }
});
test('closed row codec covers all five kinds, UNKNOWN states and complete cost support',()=>{
  for(const input of [fixture('EXECUTION'),fixture('MODEL_CALL'),fixture('TOOL_CALL'),fixture('MCP_CALL'),fixture('API_CALL'),modelWithCost(),precisionBoundary()]){
    const result=validatePersistedRuntimeObservation(runtimeFromRow({...runtimeToRow(input),recorded_at:'2026-09-17T00:00:00.000Z'}));
    assert.deepEqual({...result,recordedAt:input.recordedAt},input);
  }
});
