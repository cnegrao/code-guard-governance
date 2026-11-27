import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import type { GovernedGraph } from '@council/graphos/governed';
import { asOrganisationId } from '@council/canonical-contracts';
import { canonicalLayout, CANONICAL_NODE_HEIGHT } from '../components/graph/canonical-layout';

const org = asOrganisationId('11111111-1111-1111-1111-111111111111');
const at = '2026-11-27T00:00:00Z';
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let calls: {table:string;columns:string;filters:[string,unknown][]}[];
let corrupt = false, failed = false;
const db = { from(table:string) {
  const call = {table,columns:'',filters:[] as [string,unknown][]}; calls.push(call);
  let start=0,end=199;
  const q = {
    select(columns:string){call.columns=columns;return q;},
    eq(key:string,value:unknown){call.filters.push([key,value]);return q;},
    in(key:string,value:unknown[]){call.filters.push([key,value]);return q;},
    order(){return q;},range(a:number,b:number){start=a;end=b;return q;},
    then(resolve:(result:unknown)=>unknown){
      const data=(tables[table]??[]).filter(row=>call.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value))
        .slice(start,end+1).map(row=>Object.fromEntries(call.columns.split(',').map(key=>[key,row[key]])));
      if(corrupt && data[0])data[0].organisation_id='foreign';
      return Promise.resolve({data,error:failed?{message:'failed'}:null}).then(resolve);
    },
  };return q;
}};
let names: typeof import('../lib/governance/source-name-query');
before(async()=>{
  mock.module('../lib/governance/persistence',{namedExports:{privilegedDb:db}});
  names=await import('../lib/governance/source-name-query');
});
beforeEach(()=>{tables={};calls=[];corrupt=false;failed=false;});
const add=(table:string,row:Row)=>(tables[table]??=[]).push({organisation_id:org,...row});
const candidate=(id:string,kind:string,identity:unknown,extra:Row={})=>add('discovery_candidates',{
  candidate_id:id,candidate_kind:kind,finding_id:`finding:${id}`,proposed_identity:identity,
  acquisition_run_id:'run:1',source_connection_id:'repo',source_external_type:'file',source_external_id:`${id}.py`,...extra,
});

test('relationship queue resolves exact candidate and source-object endpoints to logical Agent and model source names',async()=>{
  candidate('agent','AGENT',{agentCode:'TriagemManifestacaoAgent'});
  candidate('version','AGENT_VERSION',{agent:{referenceKind:'CANDIDATE',candidateId:'agent',candidateKind:'AGENT'}});
  candidate('model','MODEL',{modelReference:'gpt-4.1-mini'});
  candidate('old-model','MODEL',{modelReference:'old-model'},{source_external_id:'model.py',acquisition_run_id:'run:old'});
  candidate('foreign','MODEL',{modelReference:'FOREIGN'},{organisation_id:'foreign',source_external_id:'model.py'});
  candidate('relationship','RELATIONSHIP',null,{relationship_type_code:'USES_MODEL',
    source_endpoint:{referenceKind:'CANDIDATE',candidateId:'version',candidateKind:'AGENT_VERSION'},
    target_endpoint:{referenceKind:'SOURCE_OBJECT',candidateKind:'MODEL',sourceObject:{connectionId:'repo',externalType:'file',externalId:'model.py'}},
  });
  const labels=await names.readRelationshipSourceLabels(org,['finding:relationship']);
  assert.equal(labels['finding:relationship'],'TriagemManifestacaoAgent → gpt-4.1-mini · USES_MODEL');
  assert.ok(calls.every(c=>c.filters.some(([key,value])=>key==='organisation_id' && value===org)));
  assert.ok(calls.every(c=>!c.columns.includes('envelope')));
});

test('version mapping metadata preserves multiple source commits, refuses parent ambiguity and ignores future mappings',async()=>{
  for(const [id,commit] of [['v1','7b5aaf9'],['v2','77f0128']]){
    candidate(id,'AGENT_VERSION',{}, {acquisition_run_id:`run:${id}`});
    add('acquisition_runs',{run_id:`run:${id}`,source_version:commit});
    add('canonical_normalized_object_mappings',{mapping_id:id,canonical_object_id:'version',canonical_object_kind:'AGENT_VERSION',candidate_id:id,valid_from:at,parent_canonical_object_id:'agent'});
  }
  assert.deepEqual(await names.readCanonicalVersionCommits(org,['version'],at),{version:['77f0128','7b5aaf9']});
  assert.deepEqual(await names.readCanonicalVersionParents(org,['version'],at),{version:'agent'});
  tables.canonical_normalized_object_mappings[1].parent_canonical_object_id='other';
  assert.deepEqual(await names.readCanonicalVersionParents(org,['version'],at),{version:null});
  tables.canonical_normalized_object_mappings.forEach(m=>m.valid_from='2099-01-01T00:00:00Z');
  assert.deepEqual(await names.readCanonicalVersionCommits(org,['version'],at),{version:[]});
});

test('source context fails closed on read errors and cross-tenant rows; empty requests perform no query',async()=>{
  assert.deepEqual(await names.readRelationshipSourceLabels(org,[]),{});assert.equal(calls.length,0);
  candidate('agent','AGENT',{agentCode:'A'});corrupt=true;
  await assert.rejects(()=>names.readFindingSourceNames(org,['finding:agent']),/TENANT_MISMATCH/);
  corrupt=false;failed=true;
  await assert.rejects(()=>names.readFindingSourceNames(org,['finding:agent']),/READ_FAILED/);
});

function graphFixture(){
  const nodes=[['a','AGENT'],['b','AGENT'],['va','AGENT_VERSION'],['vb','AGENT_VERSION'],['model','MODEL'],['tool','TOOL'],['prompt','PROMPT'],['orphan','TOOL']]
    .map(([nodeId,canonicalObjectKind])=>({nodeId,canonicalObjectId:nodeId,canonicalObjectKind}));
  const edges=[['va','model'],['vb','model'],['va','tool'],['va','prompt'],['tool','prompt']]
    .map(([source,target],i)=>({canonicalRelationshipId:`r:${i}`,source:{nodeId:source},target:{nodeId:target}}));
  return {nodes,edges} as unknown as GovernedGraph;
}
test('layered layout groups exact agent versions and unique dependencies; shared nodes remain single and cards never overlap',()=>{
  const graph=graphFixture();const layout=canonicalLayout(graph,{va:'a',vb:'b'});
  assert.equal(layout.positions.size,graph.nodes.length);
  assert.equal(layout.associations.length,2); assert.equal(graph.edges.length,5);
  assert.equal(layout.positions.get('a')!.parentId,layout.positions.get('va')!.parentId);
  assert.equal(layout.positions.get('tool')!.parentId,layout.positions.get('va')!.parentId);
  assert.notEqual(layout.positions.get('a')!.parentId,layout.positions.get('b')!.parentId);
  assert.equal(layout.positions.get('model')!.parentId,'agent-group:shared');
  assert.equal(layout.positions.get('orphan')!.parentId,'agent-group:other');
  assert.ok(layout.positions.get('a')!.x<layout.positions.get('va')!.x);
  assert.ok(layout.positions.get('va')!.x<layout.positions.get('tool')!.x);
  const positions=[...layout.positions.values()];
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
    const a=positions[i],b=positions[j];
    if(a.parentId===b.parentId && a.x===b.x)assert.ok(Math.abs(a.y-b.y)>=CANONICAL_NODE_HEIGHT);
  }
  assert.equal(layout.groups[0].y, layout.groups[1].y, 'groups use the available width');
  assert.ok(layout.groups[1].x > layout.groups[0].x + layout.groups[0].width);
  for(let i=0;i<layout.groups.length;i++)for(let j=i+1;j<layout.groups.length;j++){
    const a=layout.groups[i],b=layout.groups[j];
    assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y);
  }
  assert.deepEqual(canonicalLayout(graph,{va:'a',vb:'b'}),layout);
});
