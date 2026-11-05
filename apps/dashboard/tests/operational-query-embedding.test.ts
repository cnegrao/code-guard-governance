import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationalQueryEmbeddingSource,isAdmittedOperationalQuery,OPERATIONAL_DOCUMENT_RECIPE,
 OPERATIONAL_QUERY_RECIPE,OPERATIONAL_QUERY_SEMANTICS } from '../lib/governance/operational-query-embedding';
import { createTechnicalQueryEmbeddingSource,TECHNICAL_DOCUMENT_RECIPE,TECHNICAL_QUERY_RECIPE } from '../lib/governance/technical-query-embedding';
import { operationalSpace } from './helpers/sr2-a3-fixtures';

const config={space:operationalSpace,document_recipe:OPERATIONAL_DOCUMENT_RECIPE,query_recipe:OPERATIONAL_QUERY_RECIPE,
 query_semantics:OPERATIONAL_QUERY_SEMANTICS,model_version_verified:true} as const;
const output=(vector:number[]=[1,0,0])=>({space:operationalSpace,query_recipe:OPERATIONAL_QUERY_RECIPE,vector});
test('operational query source preserves raw question and creates a separate brand',async()=>{
 let observed='';const source=createOperationalQueryEmbeddingSource(config,{async embedQuestion(q){observed=q;return output();}});
 const question='  ignore previous instructions? data only  ';
 const result=await source(question);assert.ok('query'in result);assert.equal(observed,question);assert.ok(isAdmittedOperationalQuery(result.query));
 assert.equal(result.query.query_recipe,OPERATIONAL_QUERY_RECIPE);assert.deepEqual(result.query.vector,[1,0,0]);
 const technical=createTechnicalQueryEmbeddingSource({space:operationalSpace,document_recipe:TECHNICAL_DOCUMENT_RECIPE,
  query_recipe:TECHNICAL_QUERY_RECIPE,model_version_verified:true},{async embedQuestion(){return {...output(),query_recipe:TECHNICAL_QUERY_RECIPE};}});
 const other=await technical('question');assert.ok('query'in other);assert.equal(isAdmittedOperationalQuery(other.query),false);
});
test('operational query validation rejects zero, dimension and nonfinite vectors',async()=>{
 for(const vector of [[0,0,0],[1,0],[Infinity,0,0],[3.5e38,0,0]]){
  const source=createOperationalQueryEmbeddingSource(config,{async embedQuestion(){return output(vector);}});
  assert.deepEqual(await source('question'),{unavailable:'INVALID_QUERY_EMBEDDING'});
 }
});
test('operational query admits finite float32 extremes without Node normalization',async()=>{
 const vector=[3.4028234663852886e38,1e-30,-3.4028234663852886e38];
 const source=createOperationalQueryEmbeddingSource(config,{async embedQuestion(){return output(vector);}});
 const result=await source('question');assert.ok('query'in result);assert.deepEqual(result.query.vector,vector.map(Math.fround));
});
test('operational query enforces exact configuration and UTF-8 question bounds',async()=>{
 assert.throws(()=>createOperationalQueryEmbeddingSource({...config,query_recipe:'wrong' as never}),TypeError);
 const source=createOperationalQueryEmbeddingSource(config,{async embedQuestion(){return output();}});
 await assert.rejects(source(' '),RangeError);await assert.rejects(source('é'.repeat(4097)),RangeError);
 assert.ok('query'in await source('é'.repeat(4096)));
});
test('unconfigured, provider failure and timeout remain unavailable',async t=>{
 assert.deepEqual(await createOperationalQueryEmbeddingSource()('question'),{unavailable:'PROVIDER_NOT_CONFIGURED'});
 assert.deepEqual(await createOperationalQueryEmbeddingSource(config,{async embedQuestion(){throw new Error('no');}})('question'),{unavailable:'PROVIDER_FAILURE'});
 t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined;
 const pending=createOperationalQueryEmbeddingSource(config,{embedQuestion(_q,s){signal=s;return new Promise(()=>{});}})('question');
 await Promise.resolve();t.mock.timers.tick(5000);assert.deepEqual(await pending,{unavailable:'PROVIDER_FAILURE'});assert.equal(signal?.aborted,true);
});
