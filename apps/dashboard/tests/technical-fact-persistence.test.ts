import assert from 'node:assert/strict';
import {before,beforeEach,mock,test} from 'node:test';
import {asOrganisationId} from '@council/canonical-contracts';
type Row=Record<string,any>;
const org=asOrganisationId('11111111-1111-1111-1111-111111111111'),foreign=asOrganisationId('22222222-2222-2222-2222-222222222222');
let tables:Record<string,Row[]>={},calls:{table:string;filters:[string,unknown][]}[]=[],rpcResult:Row={data:[],error:null},rpcCalls:Row[]=[];
const db={from(table:string){const filters:[string,unknown][]=[];let range=[0,499];calls.push({table,filters});
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},order:()=>q,range:(start:number,end:number)=>{range=[start,end];return q;},
    then(resolve:(x:unknown)=>unknown){return Promise.resolve({data:(tables[table]??[]).filter(r=>filters.every(([k,v])=>r[k]===v)).slice(range[0],range[1]+1),error:null}).then(resolve);}};return q;},
  async rpc(name:string,args:Row){rpcCalls.push({name,args});return rpcResult;}};
let persistence:typeof import('@/lib/governance/technical-fact-persistence');
before(async()=>{mock.module('@/lib/governance/persistence',{namedExports:{privilegedDb:db}});persistence=await import('@/lib/governance/technical-fact-persistence');});
beforeEach(()=>{
  calls=[];rpcCalls=[];rpcResult={data:[],error:null};
  const row=(x:Row)=>({organisation_id:org,...x});
  tables={technical_source_connections:[row({connection_id:'connection:catalog',source_system_id:'system:catalog',provider_code:'microsoft-purview',family:'CATALOG',display_name:'Purview'})],
    technical_fact_proposals:[row({proposal_id:'p1',candidate_id:'c1',object_kind:'DATA_ELEMENT',field_key:'dataType.nativeType',native_type:'varchar(100)',connection_id:'connection:catalog',source_system_id:'system:catalog',external_type:'azure_sql_column',external_id:'guid:column',normalized_object_identity:'exact:column',trust_state:'IMPORTED',attribute_code:'attributes.data_type',attribute_path:'attributes.data_type'})],
    technical_fact_observations:[row({observation_id:'o1',proposal_id:'p1',candidate_id:'c1',observed_at:'2026-09-11T00:00:00.000Z',snapshot_id:'snapshot:1'}),row({observation_id:'o2',proposal_id:'p1',candidate_id:'c2',observed_at:'2026-09-12T00:00:00.000Z',snapshot_id:'snapshot:2'})],
    technical_fact_observation_assertions:[row({observation_id:'o1',assertion_id:'a1'}),row({observation_id:'o2',assertion_id:'a2'})],
    technical_fact_observation_evidence:[row({observation_id:'o1',evidence_id:'e1'}),row({observation_id:'o2',evidence_id:'e2'})],
    technical_fact_source_heads:[row({connection_id:'connection:catalog',external_type:'azure_sql_column',external_id:'guid:column',object_kind:'DATA_ELEMENT',field_key:'dataType.nativeType',observation_id:'o2'})],
    technical_source_snapshot_heads:[row({connection_id:'connection:catalog',external_type:'azure_sql_column',external_id:'guid:column',snapshot_id:'snapshot:2'})],
    technical_field_policies:[],canonical_normalized_object_mappings:[],canonical_objects:[],technical_field_states:[],technical_field_decisions:[],technical_field_decision_observations:[]};
});
test('tenant-bound rehydration exposes immutable origin, both observations and current snapshot without authority',async()=>{
  const ctx=await persistence.technicalFactPersistence.getReviewContext(org,'p1');assert.equal(ctx.proposal.fact.value,'varchar(100)');assert.equal(ctx.proposal.trustState,'IMPORTED');
  assert.equal(ctx.proposal.candidateId,'c1');assert.deepEqual(ctx.proposal.support.evidenceIds,['e1']);assert.equal(ctx.observations.length,2);
  assert.equal(ctx.currentSourceSnapshotId,'snapshot:2');assert.equal(ctx.currentSourceObservationId,'o2');assert.equal(ctx.canonicalObjects.length,0);assert.equal(ctx.policies.length,0);
  assert.ok(calls.every(c=>c.filters.some(([k,v])=>k==='organisation_id'&&v===org)));
});
test('foreign tenant cannot recover a connection or proposal',async()=>{
  await assert.rejects(persistence.configuredTechnicalConnection(foreign,'connection:catalog'),/NOT_FOUND/);
  await assert.rejects(persistence.technicalFactPersistence.getReviewContext(foreign,'p1'),/NOT_FOUND/);
});
test('missing durable evidence fails closed on review reads',async()=>{tables.technical_fact_observation_evidence=[];await assert.rejects(persistence.technicalFactPersistence.getReviewContext(org,'p1'),/SUPPORT_MISSING/);});
test('unknown persisted field is rejected, never hydrated as an arbitrary fact',async()=>{tables.technical_fact_proposals[0].field_key='arbitrary.key';await assert.rejects(persistence.technicalFactPersistence.getReviewContext(org,'p1'),/INVALID_TECHNICAL_FACT/);});
test('exact mapping resolves existing same-tenant canonical object; ambiguous mapping fails',async()=>{
  const m={organisation_id:org,mapping_id:'m1',source_connection_id:'connection:catalog',source_external_type:'azure_sql_column',source_external_id:'guid:column',canonical_object_kind:'DATA_ELEMENT',normalized_object_identity:'exact:column',canonical_object_id:'canonical:column'};
  tables.canonical_normalized_object_mappings=[m];tables.canonical_objects=[{organisation_id:org,canonical_object_id:'canonical:column',kind:'DATA_ELEMENT'}];
  assert.equal((await persistence.technicalFactPersistence.getReviewContext(org,'p1')).canonicalObjects[0].objectId,'canonical:column');
  tables.canonical_normalized_object_mappings.push({...m,mapping_id:'m2'});await assert.rejects(persistence.technicalFactPersistence.getReviewContext(org,'p1'),/AMBIGUOUS/);
});
test('observation support pagination preserves more than the first database page',async()=>{
  tables.technical_fact_observation_evidence=Array.from({length:501},(_,i)=>({organisation_id:org,observation_id:'o1',evidence_id:`e${i}`}));
  tables.technical_fact_observation_evidence.push({organisation_id:org,observation_id:'o2',evidence_id:'other'});
  const ctx=await persistence.technicalFactPersistence.getReviewContext(org,'p1');assert.equal(ctx.observations[0].support.evidenceIds.length,501);
});
test('decision RPC preserves exact reviewed input and translates SQL source-stale rejection',async()=>{
  const d={organisationId:org,decisionId:'d',expectedSourceSnapshotId:'snapshot:1',expectedSourceObservationId:'o1'} as never;
  rpcResult={data:null,error:{message:'FIELD_STALE_SOURCE'}};await assert.rejects(persistence.technicalFactPersistence.recordDecision(d),/FIELD_STALE_SOURCE/);
  assert.equal(rpcCalls[0].name,'record_technical_field_decision');assert.deepEqual(rpcCalls[0].args,{p_organisation_id:org,p_decision:d});
});
test('acquisition wrapper delegates to additive replay gate, preserving run and tenant',async()=>{
  rpcResult={data:[{replay:true,run_id:'r',status:'SUCCEEDED'}],error:null};const r={runId:'r'} as never;
  const result=await persistence.startExchangeAcquisitionRun(org,r);assert.equal(result.replay,true);assert.equal(rpcCalls[0].name,'start_exchange_acquisition_run');assert.equal(rpcCalls[0].args.p_organisation_id,org);
});
