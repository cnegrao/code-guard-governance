import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTechnicalRetrievalAdapter} from '../lib/governance/technical-context-retrieval';
import {TechnicalAuthorizationError,TechnicalInputError,TechnicalTransportError} from '../lib/governance/technical-context-contract';
import {createTechnicalQueryEmbeddingSource,TECHNICAL_QUERY_RECIPE,TECHNICAL_DOCUMENT_RECIPE} from '../lib/governance/technical-query-embedding';
import {createTechnicalScopeSource} from '../lib/governance/technical-context-scope';
import {technicalFixture,technicalDto,technicalSpace,orgA} from './helpers/sr2-a2-fixtures';
const fixture=technicalFixture(),principal={organisationId:orgA,userId:orgA,credentialEpoch:'2026-10-01 00:00:00.123456+00:00',issuedAtSeconds:1,expiresAtSeconds:2,informational:{role:'ignored'}};
const resolved=createTechnicalScopeSource({bindings:[{selection_key:'x',organisation_id:orgA,repository_id:fixture.root.row.repository_id,snapshot_id:fixture.s.snap.snapshot_id}]})(principal,'x');
if(!('scope'in resolved))throw Error();const scope=resolved.scope;
const options={limit:20,threshold:-1,policy_version:'EXACT_COSINE_V1' as const};
const query=async()=>{const result=await createTechnicalQueryEmbeddingSource({space:technicalSpace,document_recipe:TECHNICAL_DOCUMENT_RECIPE,query_recipe:TECHNICAL_QUERY_RECIPE,model_version_verified:true},
 {async embedQuestion(){return {space:technicalSpace,query_recipe:TECHNICAL_QUERY_RECIPE,vector:[1,0,0]};}})('question');if(!('query'in result))throw Error();return result.query;};
function transport(fault?:unknown,malformed?:unknown){
 const calls:{sql:string;values?:unknown[]}[]=[],released:boolean[]=[];let connects=0;
 const client={async query(sql:string,values?:unknown[]){calls.push({sql,values});if(sql.includes('technical_semantic_context_search')){
   if(fault)throw fault;return {rows:[{result:malformed??technicalDto(fixture)}]};}return {rows:[]};},release(destroy=false){released.push(destroy);}};
 return {calls,released,client,pool:{async connect(){connects++;return client;}},get connects(){return connects;}};
}
test('adapter exact READ COMMITTED transaction, 16 argument order, exact epoch and deadlines before RPC',async()=>{
 const x=transport(),q=await query();const result=await createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext(principal,scope,q,options);
 assert.equal(result.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.ok(Object.isFrozen(result));assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
 assert.match(x.calls[1].sql,/SET LOCAL statement_timeout='[1-9][0-9]*ms'/);assert.equal(x.calls[2].sql,"SET LOCAL lock_timeout='5s'");
 const rpc=x.calls.find(c=>c.values)!;assert.deepEqual(rpc.values,[orgA,orgA,1,2,principal.credentialEpoch,scope.repository_id,scope.snapshot_id,'[1,0,0]',
  technicalSpace.provider_id,technicalSpace.model_id,technicalSpace.model_version,3,technicalSpace.projection_schema_version,TECHNICAL_QUERY_RECIPE,20,-1]);
 assert.equal(x.calls.at(-1)!.sql,'COMMIT');assert.deepEqual(x.released,[false]);
});
for(const [label,change,kind] of [
 ['principal',(a:any)=>a[0]={...principal,organisationId:'invalid'},TechnicalAuthorizationError],
 ['epoch calendar',(a:any)=>a[0]={...principal,credentialEpoch:'2026-02-30T00:00:00Z'},TechnicalAuthorizationError],
 ['foreign scope',(a:any)=>a[0]={...principal,organisationId:'99999999-9999-4999-8999-999999999999'},TechnicalAuthorizationError],
 ['forged scope',(a:any)=>a[1]={...scope},TechnicalInputError],['forged query',(a:any)=>a[2]={...a[2]},TechnicalInputError],
 ['limit',(a:any)=>a[3]={...options,limit:21},TechnicalInputError],['threshold',(a:any)=>a[3]={...options,threshold:NaN},TechnicalInputError],
 ['extra option',(a:any)=>a[3]={...options,tenant:orgA},TechnicalInputError],
] as const)test('adapter rejects before connecting '+label,async()=>{
 const x=transport(),a:any[]=[principal,scope,await query(),options];change(a);
 await assert.rejects((createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext as any)(...a),kind);assert.equal(x.connects,0);
});
for(const code of ['GV001','GV002','GV003','GV004','GV005','55P03'])test('SQL authorization maps generically '+code,async()=>{
 const x=transport({code,message:'private repository secret'});
 await assert.rejects(createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext(principal,scope,await query(),options),TechnicalAuthorizationError);
 assert.equal(x.calls.at(-1)!.sql,'ROLLBACK');assert.equal(x.released.length,1);
});
for(const [code,message,reason] of [['22023','INVALID_TECHNICAL_OPTIONS','INVALID_OPTIONS'],['22023','INVALID_TECHNICAL_SCOPE','INVALID_SCOPE'],
 ['22023','INVALID_TECHNICAL_QUERY','INVALID_QUERY_EMBEDDING'],['22P02','private','INVALID_QUERY_EMBEDDING'],['22000','private','INVALID_QUERY_EMBEDDING'],['22003','private','INVALID_QUERY_EMBEDDING']])
 test('SQL input mapping '+code+' '+message,async()=>{
  const x=transport({code,message});await assert.rejects(createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext(principal,scope,await query(),options),
   (e:any)=>e instanceof TechnicalInputError&&e.reason===reason&&!e.message.includes('private'));
 });
for(const [fault,reason] of [[{code:'57014'},'QUERY_TIMEOUT'],[{code:'08006'},'TRANSPORT_ERROR'],[new Error('private host'),'TRANSPORT_ERROR'],[{code:'XX000',message:'TECHNICAL_NUMERIC_INVARIANT'},'INTERNAL_ERROR'],[{code:'22023',message:'unrecognized private fault'},'INTERNAL_ERROR']] as const)
 test('SQL transport mapping '+reason,async()=>{const x=transport(fault);await assert.rejects(createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext(principal,scope,await query(),options),
  (e:any)=>e instanceof TechnicalTransportError&&e.reason===reason&&!e.message.includes('private')&&!e.message.includes('TECHNICAL_NUMERIC_INVARIANT'));});
test('malformed SQL result never commits',async()=>{
 const x=transport(undefined,{unexpected:true});await assert.rejects(createTechnicalRetrievalAdapter(x.pool).retrieveTechnicalContext(principal,scope,await query(),options),
  (e:any)=>e.reason==='MALFORMED_RESULT');assert.equal(x.calls.at(-1)!.sql,'ROLLBACK');assert.ok(!x.calls.some(c=>c.sql==='COMMIT'));
});
test('late pool connection after acquisition deadline is destroyed without SQL',async t=>{
 const q=await query();t.mock.timers.enable({apis:['setTimeout']});const x=transport();let resolve!:(c:typeof x.client)=>void;
 const pending=createTechnicalRetrievalAdapter({connect(){return new Promise(r=>{resolve=r;});}}).retrieveTechnicalContext(principal,scope,q,options);
 const rejected=assert.rejects(pending,(e:any)=>e.reason==='QUERY_TIMEOUT');t.mock.timers.tick(5000);await rejected;
 resolve(x.client);await new Promise(r=>setImmediate(r));assert.deepEqual(x.released,[true]);assert.equal(x.calls.length,0);
});
test('in-flight RPC deadline destroys connection and prevents COMMIT',async t=>{
 const q=await query(),x=transport();t.mock.timers.enable({apis:['setTimeout']});let resolve!:(value:{rows:any[]})=>void;
 const client={...x.client,async query(sql:string,values?:unknown[]){if(sql.includes('technical_semantic_context_search'))return new Promise<{rows:any[]}>(r=>{resolve=r;});return x.client.query(sql,values);}};
 const pending=createTechnicalRetrievalAdapter({async connect(){return client;}}).retrieveTechnicalContext(principal,scope,q,options);
 while(!resolve)await new Promise(r=>setImmediate(r));const rejected=assert.rejects(pending,(e:any)=>e.reason==='QUERY_TIMEOUT');
 t.mock.timers.tick(5000);await rejected;resolve({rows:[{result:technicalDto(fixture)}]});await new Promise(r=>setImmediate(r));
 assert.deepEqual(x.released,[true]);assert.ok(!x.calls.some(c=>c.sql==='COMMIT'));
});
test('failed rollback destroys connection without returning private error',async()=>{
 const x=transport({code:'XX000'});const client={...x.client,async query(sql:string,values?:unknown[]){if(sql==='ROLLBACK')throw new Error('private rollback');return x.client.query(sql,values);}};
 await assert.rejects(createTechnicalRetrievalAdapter({async connect(){return client;}}).retrieveTechnicalContext(principal,scope,await query(),options),(e:any)=>e.reason==='INTERNAL_ERROR');
 assert.deepEqual(x.released,[true]);
});
for(const rows of [[],[{result:technicalDto(fixture)},{result:technicalDto(fixture)}],[{result:technicalDto(fixture),extra:'private'}]])
 test('SQL row cardinality and exact result column are closed '+rows.length,async()=>{
  const x=transport();const client={...x.client,async query(sql:string,values?:unknown[]){if(sql.includes('technical_semantic_context_search'))return {rows};return x.client.query(sql,values);}};
  await assert.rejects(createTechnicalRetrievalAdapter({async connect(){return client;}}).retrieveTechnicalContext(principal,scope,await query(),options),(e:any)=>e.reason==='MALFORMED_RESULT');
 });
