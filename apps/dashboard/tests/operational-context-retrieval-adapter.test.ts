import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationalRetrievalAdapter } from '../lib/governance/operational-context-retrieval';
import { OperationalAuthorizationError,OperationalInputError,OperationalTransportError } from '../lib/governance/operational-context-contract';
import { createOperationalQueryEmbeddingSource,OPERATIONAL_DOCUMENT_RECIPE,OPERATIONAL_QUERY_RECIPE,
 OPERATIONAL_QUERY_SEMANTICS } from '../lib/governance/operational-query-embedding';
import { createTechnicalQueryEmbeddingSource,TECHNICAL_DOCUMENT_RECIPE,TECHNICAL_QUERY_RECIPE } from '../lib/governance/technical-query-embedding';
import { operationalSpace,orgA } from './helpers/sr2-a3-fixtures';

const principal={organisationId:orgA,userId:'22222222-2222-4222-8222-222222222222',credentialEpoch:'2026-01-01T00:00:00Z',
 issuedAtSeconds:1,expiresAtSeconds:2,informational:{}};
const config={space:operationalSpace,document_recipe:OPERATIONAL_DOCUMENT_RECIPE,query_recipe:OPERATIONAL_QUERY_RECIPE,
 query_semantics:OPERATIONAL_QUERY_SEMANTICS,model_version_verified:true} as const;
const unavailable={contract_version:'GOVIA_SR2_OPERATIONAL_CONTEXT_READ_V1',observed_at:'2026-10-01T00:00:00.000000Z',
 embedding_space:operationalSpace,record_family:'LEGACY_AGENT_RECORD',algorithm:'EXACT_COSINE_V1',selection_policy:'EXPLICIT_ADMITTED_HEAD_IN_EXACT_SPACE_V1',
 authorization_semantics:'AUTHORIZATION_AS_OF_ACQUISITION_SNAPSHOT',coverage:'BOUNDED_CURRENT_OPERATIONAL_HEADS',authority:'DERIVED_ANALYTICAL_NON_AUTHORITATIVE',
 source_classification:'LEGACY_OPERATIONAL_RECORD_NON_CANONICAL',canonical_decision:false,governed_relationships:false,assurance:false,
 status:'SEMANTIC_CONTEXT_UNAVAILABLE',reason:'NO_COMPATIBLE_REPRESENTATIONS',hits:[]};
async function query(){const result=await createOperationalQueryEmbeddingSource(config,{async embedQuestion(){return {space:operationalSpace,
 query_recipe:OPERATIONAL_QUERY_RECIPE,vector:[1,0,0]};}})('question');assert.ok('query'in result);return result.query;}
function pool(handler:(sql:string,values?:unknown[])=>Promise<any>){let released:unknown;return {get released(){return released;},async connect(){return {
 async query(sql:string,values?:unknown[]){return handler(sql,values);},release(destroy?:boolean){released=destroy??false;}};}};}
test('adapter executes the exact 14-argument RPC in a bounded transaction',async()=>{
 const calls:{sql:string;values?:unknown[]}[]=[];const p=pool(async(sql,values)=>{calls.push({sql,values});return sql.startsWith('SELECT gov_repo.')?{rows:[{result:unavailable}]}:{rows:[]};});
 const result=await createOperationalRetrievalAdapter(p as any).retrieveOperationalContext(principal,await query(),{limit:20,threshold:-1,policy_version:'EXACT_COSINE_V1'});
 assert.equal(result.reason,'NO_COMPATIBLE_REPRESENTATIONS');const rpc=calls.find(x=>x.sql.startsWith('SELECT gov_repo.'))!;
 assert.match(rpc.sql,/operational_agent_semantic_context_search_v1\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14\)/);
 assert.equal(rpc.values?.length,14);assert.equal(calls.at(-1)?.sql,'COMMIT');assert.equal(p.released,false);
});
test('adapter rejects forged and cross-domain query brands before SQL',async()=>{
 let connected=false;const p={async connect(){connected=true;throw new Error('must not connect');}};
 await assert.rejects(createOperationalRetrievalAdapter(p as any).retrieveOperationalContext(principal,{space:operationalSpace,
  query_recipe:OPERATIONAL_QUERY_RECIPE,vector:[1,0,0]} as any,{limit:1,threshold:0,policy_version:'EXACT_COSINE_V1'}),OperationalInputError);
 const technical=await createTechnicalQueryEmbeddingSource({space:operationalSpace,document_recipe:TECHNICAL_DOCUMENT_RECIPE,
  query_recipe:TECHNICAL_QUERY_RECIPE,model_version_verified:true},{async embedQuestion(){return {space:operationalSpace,
  query_recipe:TECHNICAL_QUERY_RECIPE,vector:[1,0,0]};}})('question');assert.ok('query'in technical);
 await assert.rejects(createOperationalRetrievalAdapter(p as any).retrieveOperationalContext(principal,technical.query as any,
  {limit:1,threshold:0,policy_version:'EXACT_COSINE_V1'}),OperationalInputError);assert.equal(connected,false);
});
test('adapter maps authorization, input and internal errors without leaking database text',async()=>{
 for(const [fault,kind] of [[{code:'GV003'},OperationalAuthorizationError],[{code:'22023',message:'INVALID_OPERATIONAL_OPTIONS'},OperationalInputError],
  [{code:'XX000',message:'OPERATIONAL_NUMERIC_INVARIANT'},OperationalTransportError]] as const){
  const p=pool(async sql=>{if(sql.startsWith('SELECT gov_repo.'))throw fault;return {rows:[]};});
  await assert.rejects(createOperationalRetrievalAdapter(p as any).retrieveOperationalContext(principal,await query(),
   {limit:1,threshold:0,policy_version:'EXACT_COSINE_V1'}),kind);
 }
});
