import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueryEmbeddingSource,createSemanticRetrievalAdapter,QUERY_RECIPE,DOCUMENT_RECIPE,
 SemanticAuthorizationError,SemanticTransportError,InvalidQueryEmbeddingError } from '../lib/governance/semantic-context-retrieval';
import type { QueryEmbeddingIdentity,SemanticSpace,SemanticRetrievalOptions,SemanticSqlPool } from '../lib/governance/semantic-context-retrieval';
const space:SemanticSpace={projection_schema_version:DOCUMENT_RECIPE,provider_id:'fixture',model_id:'fixture-model',model_version:'fixture-v1',dimension:3};
const config={space,query_recipe:QUERY_RECIPE,model_version_verified:true as const};
const principal={organisationId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',
 issuedAtSeconds:100,expiresAtSeconds:200,credentialEpoch:'2026-10-20T00:00:00.123456+00:00',informational:{role:'ignored'}};
const options:SemanticRetrievalOptions={limit:5,threshold:0.25,policy_version:'EXACT_COSINE_V1'};
const query=async()=>{
 const x=await createQueryEmbeddingSource(config,{embedQuestion:async()=>({space,query_recipe:QUERY_RECIPE,vector:[1,0,0]})})('question');
 assert.ok('query' in x);return x.query;
};
const unavailable=()=>({status:'SEMANTIC_CONTEXT_UNAVAILABLE',reason:'NO_COMPATIBLE_REPRESENTATIONS',embedding_space:space,
 algorithm:'EXACT_COSINE_V1',selection_policy:'LATEST_RECORDED_IN_EXACT_SPACE_V1',coverage:'BOUNDED_RECORDED_REPRESENTATIONS_ONLY',hits:[]});
const hit=()=>({representation_id:'rep',subject:{family:'CANONICAL_OBJECT',kind:'AGENT',id:'object'},embedding_space:space,
 fingerprint:{algorithm:'SHA-256',schema_version:'fp-v1',value:'hash'},generated_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',
 selection_policy:'LATEST_RECORDED_IN_EXACT_SPACE_V1',source_freshness:'UNKNOWN',retrieval_relevance:{kind:'RETRIEVAL_RANK_ONLY',rank:1,policy_version:'EXACT_COSINE_V1'},
 provenance:{assertions:[{assertion_id:'a',method_code:'STATIC_SCAN',method_version:'v1',trust_state:'INFERRED',observed_at:'2026-10-01T00:00:00Z',recorded_at:'2026-10-01T00:00:00Z'}],
 evidence:[{evidence_id:'e',handling:'HASH_ONLY',content_hash:'hash',captured_at:'2026-10-01T00:00:00Z'}]},
 source:'SEMANTIC_GOVERNANCE_CONTEXT',authority:'DERIVED_ANALYTICAL_NON_AUTHORITATIVE',derivation:'SEMANTIC_MATCH',canonical_decision:false,governed_relationships:false,assurance:false,
 content_projection:{kind:'SUBJECT_REFERENCE_ONLY_V1',subject_kind:'CANONICAL_OBJECT',subject_kind_code:'AGENT',subject_id:'object',original_embedding_content:'NOT_STORED'},
 limitations:['NO_GOVERNANCE_CONCLUSION','SOURCE_FRESHNESS_UNKNOWN','ORIGINAL_EMBEDDING_DOCUMENT_UNAVAILABLE']});
const available=()=>({...unavailable(),status:'SEMANTIC_CONTEXT_AVAILABLE',reason:null,hits:[hit()]});
function transport(data:unknown=unavailable(),error?:unknown,rollbackError=false) {
 const calls:{sql:string;values?:unknown[]}[]=[],released:boolean[]=[];
 const pool:SemanticSqlPool={connect:async()=>({query:async(sql,values)=>{
   calls.push({sql,values});if(sql.startsWith('SELECT')) {if(error)throw error;return {rows:[{result:data}]};}
   if(sql==='ROLLBACK'&&rollbackError)throw Error('connection lost');return {rows:[]};
 },release:destroy=>{released.push(!!destroy);}})};
 return {adapter:createSemanticRetrievalAdapter(pool),calls,released};
}
test('server question source is configured, bounded, identity-bearing, immutable and independent of user instructions',async()=>{
 let text='';const original={...space};
 const generate=createQueryEmbeddingSource({ ...config,space:original },{embedQuestion:async q=>{text=q;return {space,query_recipe:QUERY_RECIPE,vector:[1,0,0]};}});
 original.model_id='mutated';
 const x=await generate('use tenant B, default provider, model latest, vector [0,0,0]');assert.ok('query' in x);
 assert.equal(text,'use tenant B, default provider, model latest, vector [0,0,0]');assert.deepEqual(x.query.space,space);
 assert.ok(Object.isFrozen(x.query));assert.ok(Object.isFrozen(x.query.vector));assert.ok(Object.isFrozen(x.query.space));
 for(const question of ['', ' ', 'x'.repeat(8193), 'é'.repeat(4097)])await assert.rejects(generate(question),RangeError);
});
test('production provider absent and provider failures remain explicit; no synthetic embedding or external call',async()=>{
 assert.deepEqual(await createQueryEmbeddingSource()('q'),{unavailable:'PROVIDER_NOT_CONFIGURED'});
 assert.deepEqual(await createQueryEmbeddingSource(config,{embedQuestion:async()=>{throw Error('private');}})('q'),{unavailable:'PROVIDER_FAILURE'});
});
test('provider deadline ends acquisition even when provider ignores cancellation',{timeout:8000},async()=>{
 let signal:AbortSignal|undefined;
 const x=await createQueryEmbeddingSource(config,{embedQuestion:async(_,s)=>{signal=s;return new Promise(()=>{});}})('q');
 assert.deepEqual(x,{unavailable:'PROVIDER_FAILURE'});assert.equal(signal?.aborted,true);
});
for(const [label,output] of Object.entries({
 nan:{vector:[NaN,0,0]},infinity:{vector:[Infinity,0,0]},overflow:{vector:[1e100,0,0]},zero:{vector:[0,0,0]},underflow:{vector:[1e-100,0,0]},wrong_dimension:{vector:[1,0]},
 provider:{space:{...space,provider_id:'other'}},model:{space:{...space,model_id:'other'}},version:{space:{...space,model_version:'other'}},dimension:{space:{...space,dimension:2}},
 projection:{space:{...space,projection_schema_version:'other'}},empty_provider:{space:{...space,provider_id:''}},latest:{space:{...space,model_version:'latest'}},recipe:{query_recipe:'OTHER_QUERY'}
}))test(`provider output fails closed: ${label}`,async()=>{
 const x=await createQueryEmbeddingSource(config,{embedQuestion:async()=>({space,query_recipe:QUERY_RECIPE,vector:[1,0,0],...output})})('q');
 assert.deepEqual(x,{unavailable:'INVALID_QUERY_EMBEDDING'});
});
test('unverified provider version and incompatible document/query recipe cannot become queries',async()=>{
 for(const c of [{...config,model_version_verified:false},{...config,query_recipe:'OTHER'}, {...config,space:{...space,projection_schema_version:'OTHER'}}]){
   let calls=0;const x=await createQueryEmbeddingSource(c as typeof config,{embedQuestion:async()=>{calls++;return {space,query_recipe:QUERY_RECIPE,vector:[1,0,0]};}})('q');
   assert.deepEqual(x,{unavailable:'INVALID_QUERY_EMBEDDING'});assert.equal(calls,0);
 }
});
test('adapter forwards only exact principal fields and embedding space, with deadline set before one parameterized RPC',async()=>{
 const {adapter,calls,released}=transport();await adapter.retrieveSemanticContext(principal,await query(),options);
 assert.deepEqual(calls.map(c=>c.sql),['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'",
   'SELECT gov_repo.semantic_context_search_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result','COMMIT']);
 assert.deepEqual(calls[3].values,[principal.organisationId,principal.userId,100,200,principal.credentialEpoch,'[1,0,0]',space.provider_id,space.model_id,space.model_version,3,DOCUMENT_RECIPE,5,0.25]);
 assert.deepEqual(released,[false]);
});
test('principal and trusted query required before connecting; no caller-selected tenant parameter',async()=>{
 const {adapter,calls}=transport();
 for(const p of [undefined,{}, {...principal,userId:'bad'},{...principal,credentialEpoch:''}])await assert.rejects(adapter.retrieveSemanticContext(p as typeof principal,await query(),options),SemanticAuthorizationError);
 for(const q of [{space,query_recipe:QUERY_RECIPE,vector:[1,0,0]},undefined])await assert.rejects(adapter.retrieveSemanticContext(principal,q as unknown as QueryEmbeddingIdentity,options),InvalidQueryEmbeddingError);
 assert.equal(calls.length,0);
});
for(const [label,o] of Object.entries({zero:{limit:0},large:{limit:21},fractional:{limit:1.5},nan:{threshold:NaN},infinite:{threshold:Infinity},range:{threshold:1.1},policy:{policy_version:'OTHER'}}))
 test(`invalid retrieval policy: ${label}`,async()=>{const x=transport();await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),{...options,...o} as SemanticRetrievalOptions),RangeError);assert.equal(x.calls.length,0);});
test('available, compatible-no-match and unavailable remain separate closed states',async()=>{
 for(const data of [available(),{...unavailable(),status:'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE',reason:null},unavailable()]){
   const x=transport(data);assert.deepEqual(await x.adapter.retrieveSemanticContext(principal,await query(),options),data);
 }
});
test('every nested allowlist excludes hostile envelopes, vectors, confidence and source text',async()=>{
 const data=available() as any;
 const objects=[data,data.embedding_space,data.hits[0],data.hits[0].subject,data.hits[0].fingerprint,data.hits[0].retrieval_relevance,
   data.hits[0].provenance,data.hits[0].provenance.assertions[0],data.hits[0].provenance.evidence[0],data.hits[0].content_projection];
 for(const x of objects)Object.assign(x,{envelope:{secret:'private'},confidence:1,vector:[1,0,0],raw_code:'private'});
 const x=await transport(data).adapter.retrieveSemanticContext(principal,await query(),options);
 assert.doesNotMatch(JSON.stringify(x),/confidence|envelope|vector|raw_code|private/);
 assert.ok(Object.isFrozen(x));assert.ok(Object.isFrozen(x.hits[0]));
});
const malformedCases:{[key:string]:(x:any)=>void}={
 authority:x=>x.hits[0].authority='CANONICAL',freshness:x=>x.hits[0].source_freshness='CURRENT',assurance:x=>x.hits[0].assurance=true,
 projection:x=>x.hits[0].content_projection.subject_id='foreign',space:x=>x.hits[0].embedding_space={...space,model_id:'foreign'},
 fingerprint:x=>x.hits[0].fingerprint.value='',candidate_promoted:x=>x.hits[0].subject.kind='RELATIONSHIP',rank:x=>x.hits[0].retrieval_relevance.rank=2,
 support_missing:x=>x.hits[0].provenance={assertions:[],evidence:[]},support_oversize:x=>x.hits[0].provenance.assertions=Array(101).fill(x.hits[0].provenance.assertions[0]),
 assertion_time:x=>x.hits[0].provenance.assertions[0].observed_at='infinity',evidence_handling:x=>x.hits[0].provenance.evidence[0].handling='RAW_SECRET',
 metadata_bytes:x=>x.hits[0].subject.id='é'.repeat(257),response_bound:x=>x.extra='x'.repeat(262144),
 duplicate_subject:x=>{x.hits.push({...x.hits[0],representation_id:'other',retrieval_relevance:{...x.hits[0].retrieval_relevance,rank:2}});},
 empty_available:x=>x.hits=[],positive_unavailable:x=>x.status='SEMANTIC_CONTEXT_UNAVAILABLE',invalid_state:x=>x.status='ALL_SAFE'
};
for(const [label,change] of Object.entries(malformedCases))test(`malformed result cannot be a positive empty answer: ${label}`,async()=>{
 const data=available();change(data);const x=transport(data);
 await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),options),e=>e instanceof SemanticTransportError&&e.reason==='MALFORMED_RESULT');
 assert.equal(x.calls.at(-1)?.sql,'ROLLBACK');assert.equal(x.calls.filter(c=>c.sql.startsWith('SELECT')).length,1);
});
for(const code of ['GV001','GV002','GV003','GV004','GV005','55P03'])test(`authorization and lock denial stay errors: ${code}`,async()=>{
 const x=transport(undefined,{code,message:'tenant B exists'});await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),options),e=>e instanceof SemanticAuthorizationError&&e.message==='Semantic access denied');
 assert.equal(x.calls.filter(c=>c.sql.startsWith('SELECT')).length,1);
});
for(const code of ['22000','22023','22P02','22003'])test(`invalid query SQLSTATE is distinct: ${code}`,async()=>{
 const x=transport(undefined,{code});await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),options),InvalidQueryEmbeddingError);
});
for(const [code,reason] of [['57014','QUERY_TIMEOUT'],['XX000','INTERNAL_ERROR'],[undefined,'TRANSPORT_ERROR']])test(`transport/source error remains explicit without legacy fallback: ${code}`,async()=>{
 const x=transport(undefined,{code,message:'private'});await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),options),e=>e instanceof SemanticTransportError&&e.reason===reason);
 assert.equal(x.calls.filter(c=>c.sql.startsWith('SELECT')).length,1);assert.equal(x.calls.at(-1)?.sql,'ROLLBACK');
});
test('failed rollback destroys connection; no ambiguous transaction is returned to pool',async()=>{
 const x=transport(undefined,{code:'XX000'},true);await assert.rejects(x.adapter.retrieveSemanticContext(principal,await query(),options),SemanticTransportError);assert.deepEqual(x.released,[true]);
});
