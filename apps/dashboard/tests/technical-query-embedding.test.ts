import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTechnicalQueryEmbeddingSource, isAdmittedTechnicalQuery, TECHNICAL_QUERY_RECIPE, TECHNICAL_DOCUMENT_RECIPE } from '../lib/governance/technical-query-embedding';
const space={projection_schema_version:'technical-schema-1',provider_id:'synthetic',model_id:'synthetic-model',model_version:'exact-1',dimension:3};
const config={space,document_recipe:TECHNICAL_DOCUMENT_RECIPE,query_recipe:TECHNICAL_QUERY_RECIPE,model_version_verified:true as const};
const output=()=>({space:{...space},query_recipe:TECHNICAL_QUERY_RECIPE,vector:[1,0,0]});
test('technical source admits a separate, frozen technical recipe without forcing schema equal document recipe',async()=>{
 let sent:unknown;const source=createTechnicalQueryEmbeddingSource(config,{async embedQuestion(q,signal){sent=[q,signal];return output();}});
 const result=await source('Describe the module');assert.ok('query' in result);
 assert.ok(isAdmittedTechnicalQuery(result.query));assert.ok(Object.isFrozen(result.query.vector));
 assert.equal(isAdmittedTechnicalQuery({...result.query}),false);assert.equal(result.query.query_recipe,TECHNICAL_QUERY_RECIPE);
 assert.equal((sent as any[]).length,2);assert.equal((sent as any[])[0],'Describe the module');
});
test('technical source is dormant with no configured provider',async()=>{
 assert.deepEqual(await createTechnicalQueryEmbeddingSource()('question'),{unavailable:'PROVIDER_NOT_CONFIGURED'});
 assert.deepEqual(await createTechnicalQueryEmbeddingSource(config)('question'),{unavailable:'PROVIDER_NOT_CONFIGURED'});
});
for(const question of ['', '  ', 'é'.repeat(4097), '\ud800'])test('technical question bounds '+JSON.stringify(question.slice(0,8)),async()=>{
 await assert.rejects(createTechnicalQueryEmbeddingSource()(question),RangeError);
});
for(const [label,change] of Object.entries({
 'SR1 recipe':(x:any):any=>x.query_recipe='GOVERNANCE_SUBJECT_QUERY_V1',
 'extra envelope':(x:any):any=>x.confidence=1,
 'extra space field':(x:any):any=>x.space.tenant='forged',
 'wrong provider':(x:any):any=>x.space.provider_id='other',
 'wrong model':(x:any):any=>x.space.model_id='other',
 'wrong revision':(x:any):any=>x.space.model_version='other',
 'wrong schema':(x:any):any=>x.space.projection_schema_version='other',
 'wrong dimension':(x:any):any=>x.space.dimension=2,
 'wrong vector dimension':(x:any):any=>x.vector=[1,0],
 'zero':(x:any):any=>x.vector=[0,0,0],
 'float32 underflow':(x:any):any=>x.vector=[1e-90,0,0],
 'float32 overflow':(x:any):any=>x.vector=[1e90,0,0],
 'NaN':(x:any):any=>x.vector=[NaN,0,0],
 'infinity':(x:any):any=>x.vector=[Infinity,0,0],
 'numeric string':(x:any):any=>x.vector=['1',0,0],
 'null':(x:any):any=>x.vector=null,
 'space alias':(x:any):any=>x.space.model_version=' DEFAULT ',
}))test('technical query rejects '+label,async()=>{
 const x=output();change(x);const source=createTechnicalQueryEmbeddingSource(config,{async embedQuestion(){return x;}});
 assert.deepEqual(await source('question'),{unavailable:'INVALID_QUERY_EMBEDDING'});
});
for(const change of [(x:any):any=>x.model_version_verified=false,(x:any):any=>x.query_recipe='GOVERNANCE_SUBJECT_QUERY_V1',
 (x:any):any=>x.document_recipe='GOVIA_SEMANTIC_CONTENT_V1',(x:any):any=>x.space.model_version='latest',
 (x:any):any=>x.space.dimension=16001,(x:any):any=>x.extra=true])test('technical configuration fails closed '+change.toString(),()=>{
 const x=structuredClone(config);change(x);assert.throws(()=>createTechnicalQueryEmbeddingSource(x),TypeError);
});
test('technical provider rejection stays outside the database union',async()=>{
 const source=createTechnicalQueryEmbeddingSource(config,{async embedQuestion(){throw new Error('private failure');}});
 assert.deepEqual(await source('question'),{unavailable:'PROVIDER_FAILURE'});
});
test('technical provider deadline aborts and never mints a late query',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined,resolve:((x:ReturnType<typeof output>)=>void)|undefined;
 const source=createTechnicalQueryEmbeddingSource(config,{embedQuestion(_q,s){signal=s;return new Promise(r=>{resolve=r;});}});
 const pending=source('question');await Promise.resolve();t.mock.timers.tick(5000);
 assert.deepEqual(await pending,{unavailable:'PROVIDER_FAILURE'});assert.equal(signal?.aborted,true);resolve?.(output());
});
test('technical source captures exact configured identity despite later caller mutation',async()=>{
 const x=structuredClone(config);const source=createTechnicalQueryEmbeddingSource(x,{async embedQuestion(){return output();}});
 x.space.model_id='mutated';assert.ok('query' in await source('question'));
});

for(const vector of [[3e38,0,0],[3.4028234663852886e38,-3.4028234663852886e38,1e-45],
 [1e-30,0,0],[Math.fround(1e-45),0,0],[3e38,1e-30,-3e38],[-3e38,0,0]])
 test('numeric amendment admits finite float32 extremes without normalizing '+JSON.stringify(vector),async()=>{
  const source=createTechnicalQueryEmbeddingSource(config,{async embedQuestion(){return {...output(),vector};}});
  const x=await source('question');assert.ok('query'in x);assert.deepEqual(x.query.vector,vector.map(Math.fround));
 });
test('maximum question bytes and 16000 finite vector dimensions are admitted without truncation',async()=>{
 const large={...space,dimension:16000};let observed='';
 const source=createTechnicalQueryEmbeddingSource({...config,space:large},{async embedQuestion(q){observed=q;return {space:large,query_recipe:TECHNICAL_QUERY_RECIPE,vector:Array(16000).fill(1)};}});
 const x=await source('é'.repeat(4096));assert.ok('query'in x);assert.equal(x.query.vector.length,16000);assert.equal(Buffer.byteLength(observed),8192);
});
