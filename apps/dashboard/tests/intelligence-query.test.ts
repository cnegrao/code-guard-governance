import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { asOrganisationId } from '@council/canonical-contracts';

type Row = Record<string, unknown>;
const org = asOrganisationId('11111111-1111-1111-1111-111111111111');
const foreign = '22222222-2222-2222-2222-222222222222';
const at = '2026-09-14T12:00:00.000Z';
let tables: Record<string, Row[]>;
let calls: { table: string; filters: [string, unknown][]; selection: string; order: string[] }[];
let errorTable: string | undefined, corruptTable: string | undefined, authenticated = true, pageCap = 200;
const db = { from(table: string) {
  const call = { table, filters: [] as [string, unknown][], selection:'', order: [] as string[] };
  calls.push(call);
  let start = 0, end = 199;
  const q = {
    select(columns: string, options: {count: string}) { assert.equal(options.count,'exact'); call.selection = columns; return q; },
    eq(key: string, value: unknown) { call.filters.push([key,value]); return q; },
    order(key: string) { call.order.push(key); return q; },
    range(a: number,b: number) { start=a;end=b;return q; },
    then(resolve: (result: unknown)=>unknown) {
      const population = (tables[table]??[]).filter(row=>call.filters.every(([key,value])=>row[key]===value));
      const rows = population
        .sort((a,b)=>{ for(const key of call.order) { if(a[key]!==b[key]) return String(a[key])<String(b[key])?-1:1; } return 0; })
        .slice(start,Math.min(end+1,start+pageCap)).map(row=>Object.fromEntries(call.selection.split(',').map(key=>[key,row[key]])));
      if(corruptTable===table && rows[0]) rows[0].organisation_id=foreign;
      return Promise.resolve({data:rows,count:population.length,error:errorTable===table?{message:'secret error body'}:null}).then(resolve);
    },
  };
  return q;
}, rpc() {throw Error('WRITE FORBIDDEN');}, insert(){throw Error('WRITE FORBIDDEN');} };
let get: typeof import('@/lib/governance/intelligence-query').getGovernedIntelligence;
before(async()=>{
  mock.module('@/lib/governance/persistence',{namedExports:{privilegedDb:db}});
  mock.module('@/lib/governance/passport-session',{namedExports:{passportOrganisation:async()=>{
    if(!authenticated) throw Error('UNAUTHENTICATED'); return org;
  }}});
  get=(await import('@/lib/governance/intelligence-query')).getGovernedIntelligence;
});
function add(table: string, fields: Row) { (tables[table]??=[]).push({organisation_id:org,...fields}); }
function object(id:string) { add('canonical_objects',{canonical_object_id:id,kind:'DATA_ELEMENT',created_by_decision_id:`decision:${id}`,created_at:at,revision:0}); }
function representation(id:string,subject=id,fields:Row={}) {
  add('semantic_representations',{representation_id:id,subject_kind:'CANONICAL_OBJECT',subject_canonical_object_id:subject,
    subject_canonical_object_kind:'DATA_ELEMENT',projection_schema_version:'p1',content_fingerprint_algorithm:'sha256',
    content_fingerprint_schema_version:'v1',content_fingerprint_value:'digest',embedding_provider_id:'test-only',embedding_model_id:'fixture',
    embedding_model_version:'v1',embedding_dimension:2,embedding:'[1,0]',generated_at:at,raw_prompt:'SECRET',...fields});
  add('semantic_representation_assertions',{representation_id:id,assertion_id:`assertion:${id}`});
  add('semantic_representation_evidence',{representation_id:id,evidence_id:`evidence:${id}`,body:'SECRET'});
}
const request = () => ({seedCanonicalObjectId:'a',asOf:at,maxDepth:3,vectorQuery:{anchorRepresentationId:'anchor',minimumCosine:0}});
beforeEach(()=>{
  tables={};calls=[];errorTable=undefined;corruptTable=undefined;authenticated=true;pageCap=200;
  object('a');object('b');object('c');
  add('canonical_relationships',{relationship_id:'b-a',relationship_state_id:'state:b-a',relationship_type:'DERIVED_FROM',
    source_canonical_object_id:'b',source_kind:'DATA_ELEMENT',target_canonical_object_id:'a',target_kind:'DATA_ELEMENT',
    valid_from:at,valid_to:null,recorded_at:at,revision:0,created_by_decision_id:'decision:b-a'});
  representation('anchor','a');representation('neighbor','b');representation('vector-only','c');
});
test('authenticated query reads real table shapes and produces typed hybrid context',async()=>{
  const result=await get(request()); assert.equal(result.seed.canonicalObjectId,'a');
  assert.deepEqual(result.results.map(r=>r.contribution),['GRAPH_AND_VECTOR','VECTOR_ONLY']);
  assert.equal(result.blastRadius[0].path[0].edge.canonicalRelationshipId,'b-a');
  assert.equal(result.vector?.neighbors[0].representation.support.evidenceIds[0],'evidence:neighbor');
  assert.deepEqual(result.vector?.neighbors[0].representation.contentFingerprint,{algorithm:'sha256',schemaVersion:'v1',value:'digest'});
  assert.equal(result.vector?.neighbors[0].representation.generatedAt,at);
});
test('all reads scoped, scalar allowlisted, stable order and no authority writes',async()=>{
  await get(request());
  for(const call of calls) {
    assert.ok(call.filters.some(([key,value])=>key==='organisation_id'&&value===org));
    assert.ok(!call.selection.includes('*')); assert.ok(!/raw_prompt|body|envelope|secret/.test(call.selection));
    assert.ok(call.order.length>=2);
  }
  assert.ok(calls.every(c=>['canonical_objects','canonical_relationships','semantic_representations',
    'semantic_representation_assertions','semantic_representation_evidence'].includes(c.table)));
});
test('pool filters authority, family and all 5 semantic-space components in database before comparison',async()=>{
  representation('other-provider','b',{embedding_provider_id:'other'});
  representation('other-model','b',{embedding_model_id:'other'});
  representation('other-version','b',{embedding_model_version:'other'});
  representation('other-schema','b',{projection_schema_version:'other'});
  representation('other-dimension','b',{embedding_dimension:3,embedding:'[1,0,0]'});
  representation('candidate','b',{subject_kind:'NORMALIZED_CANDIDATE'});
  representation('other-kind','b',{subject_canonical_object_kind:'AGENT'});
  const result=await get(request()); assert.equal(result.vector?.neighbors.length,2);
  const pool=calls.find(c=>c.table==='semantic_representations'&&c.filters.some(([k])=>k==='embedding_provider_id'))!;
  assert.deepEqual(pool.filters.map(([k])=>k).sort(),['organisation_id','subject_kind','subject_canonical_object_kind',
    'projection_schema_version','embedding_provider_id','embedding_model_id','embedding_model_version','embedding_dimension'].sort());
});
test('request organisation spoof cannot alter session organisation',async()=>{
  const result=await get({...request(),organisationId:foreign} as any); assert.equal(result.organisationId,org);
  assert.ok(calls.every(c=>c.filters.find(([k])=>k==='organisation_id')?.[1]===org));
});
test('authentication failure prevents any database read',async()=>{
  authenticated=false;await assert.rejects(get(request()),/UNAUTHENTICATED/);assert.equal(calls.length,0);
});
test('cross-tenant rows fail closed on every read surface',async()=>{
  for(const table of Object.keys(tables)) { corruptTable=table;await assert.rejects(get(request()),/TENANT/); }
});
test('cross-tenant anchor invisible and candidate anchor rejected',async()=>{
  tables.semantic_representations[0].organisation_id=foreign;
  await assert.rejects(get(request()),/ANCHOR/);
  tables.semantic_representations[0].organisation_id=org;tables.semantic_representations[0].subject_kind='NORMALIZED_CANDIDATE';
  await assert.rejects(get(request()),/ANCHOR/);
});
test('no embedding guessing when requested ID is absent, or bound to other seed',async()=>{
  await assert.rejects(get({...request(),vectorQuery:{anchorRepresentationId:'missing',minimumCosine:0}}),/ANCHOR/);
  await assert.rejects(get({...request(),seedCanonicalObjectId:'b'}),/ANCHOR_SEED/);
});
test('retains multiple immutable neighbor representations, never chooses latest',async()=>{
  representation('neighbor-older','b',{generated_at:'2020-01-01T00:00:00Z'});
  const result=await get(request()); assert.equal(result.results.filter(r=>r.node.canonicalObjectId==='b').length,2);
});
test('database error is fail closed and does not expose raw error body',async()=>{
  for(const table of Object.keys(tables)) { errorTable=table;await assert.rejects(get(request()),/^Error: M12_READ_FAILED$/); }
});
test('malformed serialized vector and missing support fail closed',async()=>{
  tables.semantic_representations[1].embedding='["secret",0]'; await assert.rejects(get(request()),/VECTOR/);
  tables.semantic_representations[1].embedding='[1,0]';tables.semantic_representation_assertions=[];tables.semantic_representation_evidence=[];
  await assert.rejects(get(request()));
});
test('graph-only request does not read embeddings and missing seed fails',async()=>{
  const result=await get({...request(),vectorQuery:null});assert.equal(result.vector,null);
  assert.ok(calls.every(c=>!c.table.startsWith('semantic')));
  await assert.rejects(get({...request(),seedCanonicalObjectId:'missing',vectorQuery:null}),/SEED/);
});
test('explicit paging traverses beyond 200 rows without dropping exact neighbors',async()=>{
  for(let i=0;i<203;i++){const id=`extra-${String(i).padStart(3,'0')}`;object(id);representation(id);}
  const result=await get(request());assert.equal(result.vector?.neighbors.length,205);
  assert.ok(calls.filter(c=>c.table==='canonical_objects').length>=2);
});
test('large read fails instead of quietly truncating exact population',async()=>{
  for(let i=0;i<10001;i++) object(`large-${i}`);
  await assert.rejects(get({...request(),vectorQuery:null}),/LIMIT_EXCEEDED/);
});
test('server row cap below page size cannot silently truncate exact population',async()=>{
  pageCap=1; await assert.rejects(get(request()),/INCOMPLETE_READ/);
});
test('future and closed canonical intervals excluded through persistence adapter',async()=>{
  tables.canonical_relationships[0].valid_from='2026-09-15T00:00:00Z';
  assert.equal((await get(request())).neighborhood.length,0);
  tables.canonical_relationships[0].valid_from='2026-09-13T00:00:00Z';tables.canonical_relationships[0].valid_to=at;
  assert.equal((await get(request())).neighborhood.length,0);
});
test('serialized analytical context omits vectors, Prompt plaintext and unrestricted evidence',async()=>{
  const result=JSON.stringify(await get(request()));assert.ok(!result.includes('SECRET'));assert.ok(!result.includes('"vector":['));
  assert.ok(!result.includes('"embedding":'));assert.ok(!result.includes('VALIDATED'));
});
