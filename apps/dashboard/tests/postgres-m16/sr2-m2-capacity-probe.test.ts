import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { m2Baseline, applyM2 } from '../helpers/sr2-m2-fixtures';
import { technicalFixture, technicalRpc, inserts, sourceSet, projection, plainProjection, representation, chunk, subject, H, keys, facet, lit, orgA } from '../helpers/sr2-a2-fixtures';
import { fixture } from '../helpers/semantic-retrieval-fixtures';

const signature='gov_repo.technical_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,public.vector,text,text,text,integer,text,text,integer,double precision)';
const stable=(value:any)=>{const {observed_at,...rest}=value;return rest;};
test('M2 bounded before/after real RPC capacity gate: distinct scored subjects, 384/1536 and rich graphs',{timeout:900000},async t=>{
 const pg=await m2Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());
 await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;${fixture}COMMIT;`);const actor=await pg.actor(orgA);
 const old=await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`);await applyM2(pg);
 const successor=await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`);
 // Only the BEFORE diagnostic permits a 30s request. Production guard stays 5s.
 // Cancellation is reported as a lower bound, never as a completed timing.
 const diagnosticOld=old.replace("interval '5 seconds'","interval '30 seconds'");assert.notEqual(diagnosticOld,old);
 const records:any[]=[];
 const scenarios=process.env.M2_F1_CAPACITY==='1'?
  [{dimension:384,rich:false,sources:20,counts:[10000]},{dimension:384,rich:false,sources:1,counts:[10000]},
   {dimension:1536,rich:false,sources:1,counts:[1000]},{dimension:384,rich:true,sources:1,counts:[1000]}]:
  [{dimension:384,rich:false,sources:20,counts:[10000]},{dimension:384,rich:false,sources:1,counts:[1000,2000,5000,10000]},
   {dimension:1536,rich:false,sources:1,counts:[1000]},{dimension:384,rich:true,sources:1,counts:[1000]}];
 for(const scenario of scenarios.filter(s=>process.env.M2_CAPACITY_RICH_ONLY!=='1'||s.rich)){
  const f=technicalFixture({dimension:scenario.dimension,facets:scenario.rich,count:scenario.sources});await pg.owner(f.sql);
  const session=pg.session('m16_bootstrap');
  const tables=['sr2_projections_v1','sr2_protected_projections_v1','sr2_projection_sources_v1','sr2_source_sets_v1','sr2_source_set_members_v1','sr2_facet_collections_v1',
   'sr2_module_facets_v1','sr2_service_facets_v1','sr2_dependency_facets_v1','sr2_configuration_facets_v1','sr2_summary_facets_v1','sr2_domain_facets_v1','sr2_agent_facets_v1','sr2_entrypoint_facets_v1'];
  const triggers: {table:string;name:string}[]=JSON.parse(await pg.owner(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',tgname)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname=ANY(ARRAY[${tables.map(lit).join(',')}]) AND NOT t.tgisinternal`));
  const disable=tables.map(name=>`ALTER TABLE gov_repo.${name} DISABLE TRIGGER USER;`).join('');
  const enable=triggers.map(x=>`ALTER TABLE gov_repo.${x.table} ENABLE ALWAYS TRIGGER ${x.name};`).join('');
  const run=async(sql:string)=>{const r=await session.run(sql);assert.equal(r.err,'');return r.out;};
  try{
   await run('BEGIN;SET LOCAL ROLE postgres;'+disable);let populated=1;
   for(const count of scenario.counts){
    for(let start=populated;start<count;start+=200){
     const rows=Array.from({length:Math.min(200,count-start)},(_,j)=>{
      const i=start+j,l=chunk(f.s.entries[0],'CODE_REGION');l.chunker_version='capacity-'+i;
      l.locator_id=H('CHUNK_LOCATOR',...keys(l),l.entry_id,l.source_fingerprint,l.locator_class,'1',l.byte_start,'1',l.byte_end,'1',l.line_start,'1',l.line_end,l.decoding_id,l.chunker_id,l.chunker_version);
      const sub=subject(f.s.k,'REPOSITORY_CHUNK',l.source_fingerprint,l.entry_id,null,l.locator_id,null),
       set=sourceSet(f.s,[sub,...f.s.subjects.slice(1)],scenario.sources===1?'ITEM_GROUNDING_V1':'MODULE_MEMBERS_V1',sub,'capacity '+i);
      const summarySet=scenario.rich?sourceSet(f.s,[sub],'MODULE_MEMBERS_V1',sub,'summary capacity '+i):null;
      const items=scenario.rich?Array.from({length:8},(_,k)=>facet(f.s.k,sub,k===4?summarySet!.row:set.row,k,String(i))):[];
      const p=scenario.rich?projection(f.s,set.row,f.admissions,items,{target:sub,label:'capacity '+i,fragments:[{source_subject_id:sub.subject_id}]}):
       plainProjection(f.s,set.row,f.admissions,{subject_id:sub.subject_id,source_fingerprint:sub.source_fingerprint,safe_label:'capacity '+i});
      const r=representation(p.row,f.s.capture,{dimension:scenario.dimension,embedding:f.rep.row.embedding});
      return [{table:'chunk_locators',row:l},{table:'subjects',row:sub},...set.rows,...(summarySet?.rows??[]),...p.rows,r];
     }).flat();await run(inserts(rows));
    }populated=count;
    await run('SET CONSTRAINTS ALL IMMEDIATE;'+enable);
    assert.equal(await run(`SELECT count(*)||','||count(DISTINCT subject_id) FROM gov_repo.sr2_representations_v1 WHERE organisation_id=${lit(orgA)} AND repository_id=${lit(f.root.row.repository_id)};`),`${count},${count}`);
    assert.equal(await run(`SELECT count(*) FROM gov_repo.sr2_projection_sources_v1 WHERE organisation_id=${lit(orgA)} AND repository_id=${lit(f.root.row.repository_id)};`),String(count*scenario.sources));
    const call=technicalRpc(actor,f,{p_limit:'5'});await run(diagnosticOld+"\nRESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='30s';");
    const beforeAt=performance.now(),before=await session.run('SAVEPOINT before_probe;SELECT '+call+';');const beforeMs=performance.now()-beforeAt;
    let beforeValue:any=null;
    if(before.err){assert.match(before.err,/57014.*statement timeout/);await run('ROLLBACK TO SAVEPOINT before_probe;');}
    else {beforeValue=JSON.parse(before.out);assert.equal(beforeValue.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(beforeValue.hits.length,5);}
    await run("RESET ROLE;SET LOCAL ROLE postgres;SET LOCAL statement_timeout=0;"+successor+"\nRESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';");
    const afterMs:number[]=[];let value:any;
    for(let iteration=0;iteration<2;iteration++){const at=performance.now();value=JSON.parse(await run('SELECT '+call+';'));afterMs.push(performance.now()-at);
     if(scenario.sources===20){assert.equal(value.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.equal(value.reason,'RESPONSE_BOUND');assert.deepEqual(value.hits,[]);}
     else {assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(value.hits.length,5);}
     if(beforeValue)assert.deepEqual(stable(value),stable(beforeValue));}
    // Existing 5s request ceiling is the only absolute bound; no new SLA.
    assert.ok(Math.max(...afterMs)<beforeMs,'score-first eliminates the measured hydrate-before-rank cost');
    let entryValidation:undefined|{rows:number;loops:number};
    if(scenario.sources===20){
     let sql=successor.slice(successor.indexOf('WITH acquired_clock'),successor.indexOf(' scoreable AS MATERIALIZED')).replace(/,\s*$/,'')+' SELECT count(*) FROM eligible;';
     const bindings:Record<string,string>={v_org:lit(orgA)+'::uuid',p_repository_id:lit(f.root.row.repository_id),p_snapshot_id:lit(f.s.snap.snapshot_id),
      p_schema:"'fixture-technical-v1'",p_provider:"'fixture'",p_model:"'fixture-model'",p_version:"'exact-fixture-v1'",p_dimension:String(scenario.dimension)};
     sql=sql.replace(/\b(v_org|p_repository_id|p_snapshot_id|p_schema|p_provider|p_model|p_version|p_dimension)\b/g,key=>bindings[key]);
     await run("RESET ROLE;SET LOCAL ROLE postgres;SET LOCAL statement_timeout='5s';");
     const plan=JSON.parse(await run('EXPLAIN (ANALYZE,FORMAT JSON) '+sql));const nodes:any[]=[];
     const walk=(n:any)=>{nodes.push(n);for(const child of n.Plans??[])walk(child);};walk(plan[0].Plan);
     const memo=nodes.find(n=>n['Subplan Name']==='CTE current_entry_eligibility');assert.ok(memo);
     entryValidation={rows:memo['Actual Rows'],loops:memo['Actual Loops']};assert.deepEqual(entryValidation,{rows:20,loops:1});
     assert.match(JSON.stringify(plan),/hashed SubPlan/,'candidate-source edges use hashed membership');
    }
    const record={candidates:count,sources_per_candidate:scenario.sources,dimensions:scenario.dimension,rich_graph:scenario.rich,selected_limit:5,returned_hits:value.hits.length,response_status:value.status,response_reason:value.reason,before_ms:beforeMs,before_completed:!before.err,
     before_request_ceiling_ms:30000,after_ms:afterMs,after_request_ceiling_ms:5000,entry_validation:entryValidation,healthy_differential:beforeValue?'exact JSONB DTO except observed_at':'before canceled; covered by dedicated differential suite'};
    records.push(record);t.diagnostic(JSON.stringify(record));
    writeFileSync(new URL(process.env.M2_F1_CAPACITY==='1'?'../../../../.artifacts/agent/m2-f1-capacity-results.json':process.env.M2_CAPACITY_RICH_ONLY==='1'?'../../../../.artifacts/agent/m2-capacity-rich-results.json':'../../../../.artifacts/agent/m2-capacity-results.json',import.meta.url),JSON.stringify(records,null,2)+'\n');
    await run('RESET ROLE;SET LOCAL ROLE postgres;SET LOCAL statement_timeout=0;'+disable);
   }
  }finally{await session.run('ROLLBACK;');await session.close();}
 }
});
