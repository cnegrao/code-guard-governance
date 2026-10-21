import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import type { VerifiedGovernancePrincipal } from '../lib/auth/session-token';

const org='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const principal:VerifiedGovernancePrincipal={userId:id,organisationId:org,issuedAtSeconds:100,expiresAtSeconds:200,
  credentialEpoch:'2026-10-20T00:00:00.123456+00:00',informational:{role:'ignored',email:'ignored@example.invalid'}};
let data:unknown,error:unknown,throws:Error|false=false;
const calls:{name:string;args:Record<string,unknown>}[]=[];
let adapter:typeof import('../lib/governance/ledger-read');
before(async()=>{
  mock.module('../lib/db',{namedExports:{db:{write:{rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});if(throws)throw throws;return {data,error};
  }}}}});
  adapter=await import('../lib/governance/ledger-read');
});
beforeEach(()=>{calls.length=0;data=null;error=null;throws=false;});
function integrity(status='VALID',history='LEGACY_GLOBAL_ONLY'){
  return {organisation_id:org,status,history,reason:status==='BROKEN'?'HEAD_MISMATCH':null,chain_id:id,activation_id:id,algorithm_version:2,serialization_version:1,
    activated_at:'2026-10-20T00:00:00.123456+00:00',scope:'COMPLETE_CURRENT_TENANT_V2',
    checked_entries:status==='UNKNOWN'?null:status==='EMPTY'?'0':'3',verified_through:status==='VALID'?'3':null,failure_tenant_sequence:null,
    max_entries:10000,integrity_meaning:'RETAINED_RECORD_INTEGRITY_ONLY',legacy_payload_authority:'LEGACY_NON_AUTHORITATIVE'};
}
const event=(kind='V2')=>({kind,event_id:id,organisation_id:org,tenant_sequence:kind==='V2'?'3':null,event_type:'TEST',description:'Retained',
  subject_type:'SYSTEM',subject_id:id,actor_user_id:null,actor_ip:null,actor_session_id:null,event_timestamp:'2026-10-20T00:00:00Z',
  recorded_at:'2026-10-20T00:00:00Z',payload:{oversight_verified:true,semantic_truth:false},history:kind==='V2'?'V2':'LEGACY_GLOBAL_ONLY',
  payload_authority:kind==='V2'?'RETAINED_RECORD_ONLY':'LEGACY_NON_AUTHORITATIVE',legacy_payload_authority:'LEGACY_NON_AUTHORITATIVE'});
test('closed status and history axes preserved exactly, with the exact verified epoch and only principal fields',async()=>{
  for(const status of ['VALID','BROKEN','EMPTY','UNKNOWN'])for(const history of ['LEGACY_GLOBAL_ONLY','NO_LEGACY_ENTRIES','UNKNOWN']){
    data=integrity(status,history);assert.deepEqual(await adapter.verifyTenantLedger(principal),data);
  }
  assert.equal(calls.length,12);for(const c of calls){assert.equal(c.name,'ledger_tenant_verify_v2');assert.deepEqual(c.args,{
    p_verified_organisation_id:org,p_verified_actor_user_id:id,p_verified_session_iat:100,p_verified_session_exp:200,
    p_verified_credential_epoch:principal.credentialEpoch,p_organisation_id:org});}
});
test('missing/malformed rows are UNKNOWN; positive/empty/unknown contradictions never acquire assurance',async()=>{
  for(const bad of [null,[],{},false,{...integrity(),status:'GREEN'},{...integrity(),organisation_id:id},
    {...integrity(),checked_entries:'0'},{...integrity('EMPTY'),checked_entries:'1'},
    {...integrity('UNKNOWN'),checked_entries:'3'},{...integrity('BROKEN'),verified_through:'3'},
    {...integrity(),activation_id:null},{...integrity(),algorithm_version:99},{...integrity(),serialization_version:null},
    {...integrity(),activated_at:'bad'},{...integrity(),checked_entries:'10001',verified_through:'10001'},
    {...integrity(),legacy_payload_authority:'VERIFIED_TRUTH'}]){
    data=bad;const x=await adapter.verifyTenantLedger(principal);assert.equal(x.status,'UNKNOWN');assert.equal(x.history,'UNKNOWN');
    assert.equal(x.checked_entries,null);assert.equal(x.verified_through,null);
  }
});
test('principal denials stay separate from integrity; transport and database details sanitized; no fallback',async()=>{
  for(const code of ['GV001','GV002','GV003','GV004']){
    error={code,message:'private tenant exists'};
    for(const fn of [()=>adapter.verifyTenantLedger(principal),()=>adapter.listTenantLedgerEvents(principal),()=>adapter.getTenantLedgerEvent(principal,'V2',id)]){
      await assert.rejects(fn,e=>e instanceof adapter.LedgerReadAuthorizationError&&e.message==='Ledger access denied');
    }
  }
  for(const code of ['XX000','42501','57014']){
    error={code,message:'private database details'};await assert.rejects(()=>adapter.verifyTenantLedger(principal),adapter.LedgerReadUnavailableError);
  }
  error=null;
  for(const failure of [Error('private transport'),new RangeError('private transport range')]){
    throws=failure;await assert.rejects(()=>adapter.listTenantLedgerEvents(principal),e=>
      e instanceof adapter.LedgerReadUnavailableError && e.message==='Ledger reading unavailable');
  }
  assert.ok(calls.every(c=>['ledger_tenant_verify_v2','ledger_tenant_events_v2','ledger_tenant_event_v2'].includes(c.name)));
});
test('bounded list and exact detail preserve evidence authority; unexpected global fields are not forwarded',async()=>{
  const e=event();data={organisation_id:org,events:[{...e,entry_sequence:999,entry_hash:'private'}],next_cursor:`V2:${id}`,total:999};
  assert.deepEqual(await adapter.listTenantLedgerEvents(principal,{limit:1,eventType:'TEST'}),{organisation_id:org,events:[e],next_cursor:`V2:${id}`});
  assert.deepEqual(calls[0].args,{p_verified_organisation_id:org,p_verified_actor_user_id:id,p_verified_session_iat:100,p_verified_session_exp:200,
    p_verified_credential_epoch:principal.credentialEpoch,p_organisation_id:org,p_limit:1,p_cursor:null,p_event_type:'TEST'});
  for(const kind of ['V2','LEGACY'] as const){data=event(kind);assert.deepEqual(await adapter.getTenantLedgerEvent(principal,kind,id),data);}
  data=null;assert.equal(await adapter.getTenantLedgerEvent(principal,'V2',id),null);
  data={...event(),organisation_id:id};await assert.rejects(()=>adapter.getTenantLedgerEvent(principal,'V2',id),adapter.LedgerReadUnavailableError);
  data={...event(),event_id:org};await assert.rejects(()=>adapter.getTenantLedgerEvent(principal,'V2',id),adapter.LedgerReadUnavailableError);
});
test('malformed list/detail reject, bounded options fail before RPC, database invalid cursor stays request error',async()=>{
  for(const options of [{limit:0},{limit:101},{limit:1.5},{limit:NaN},{cursor:'V2:123'},{eventType:'x'.repeat(121)}]){
    await assert.rejects(()=>adapter.listTenantLedgerEvents(principal,options),RangeError);
  }
  await assert.rejects(()=>adapter.getTenantLedgerEvent(principal,'V2','123'),RangeError);assert.equal(calls.length,0);
  for(const bad of [null,{}, {organisation_id:org,events:[{...event(),payload_authority:'TRUE'}],next_cursor:null},
    {organisation_id:org,events:[event(),event()],next_cursor:null},{organisation_id:org,events:[],next_cursor:'GLOBAL:123'}]){
    data=bad;await assert.rejects(()=>adapter.listTenantLedgerEvents(principal,{limit:1}),adapter.LedgerReadUnavailableError);
  }
  error={code:'22023',message:'private cursor'};await assert.rejects(()=>adapter.listTenantLedgerEvents(principal,{cursor:`V2:${id}`}),RangeError);
});
