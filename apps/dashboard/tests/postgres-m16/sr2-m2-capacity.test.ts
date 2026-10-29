import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { m2Baseline, applyM2, m2Source, collectV3, v3FixtureUrl, m2Migrations } from '../helpers/sr2-m2-fixtures';
import { technicalFixture, technicalRpc, scopedRead, lit, orgA, orgB, inserts, insert, projection, plainProjection, representation,
 sourceSet, admission, facet, chunk, subject, H, keys, type Row } from '../helpers/sr2-a2-fixtures';
import { fixture, rpc as sr1Rpc } from '../helpers/semantic-retrieval-fixtures';
import { operationalFixture, operationalRpc, operationalSpace } from '../helpers/sr2-a3-fixtures';
import { parseOperationalContextResult } from '../../lib/governance/operational-context-contract';
import { createTechnicalScopeSource } from '../../lib/governance/technical-context-scope';
import { createTechnicalRetrievalAdapter } from '../../lib/governance/technical-context-retrieval';
import { createTechnicalQueryEmbeddingSource } from '../../lib/governance/technical-query-embedding';
import { assertFrameCatalog, frameCatalogSql, frameArguments } from '../helpers/sr2-frame-audit';
import { readManifestFixture } from '../helpers/sr2-dependency-manifest';

const signature='gov_repo.technical_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,public.vector,text,text,text,integer,text,text,integer,double precision)';
const stable=(x:any)=>{const {observed_at,...rest}=x;return rest;};
const where=(f:ReturnType<typeof technicalFixture>)=>`organisation_id=${lit(orgA)} AND repository_id=${lit(f.root.row.repository_id)}`;
const unavailable=(v:any,reason:string)=>{assert.equal(v.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.equal(v.reason,reason);assert.deepEqual(v.hits,[]);};

test('M2 A2 successor: healthy differential, D1/D1b, numeric barrier and capability preservation',{timeout:900000},async t=>{
 const pg=await m2Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());
 await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;${fixture}COMMIT;`);const actor=await pg.actor(orgA);
 const f=technicalFixture({count:3,facets:true});await pg.owner(f.sql);
 const children=f.s.subjects.map((sub,i)=>{
  const set=sourceSet(f.s,[sub],'ITEM_GROUNDING_V1',sub,'differential '+i),p=projection(f.s,set.row,[f.admissions[i]],[],{target:sub,label:'child '+i,fragments:[{source_subject_id:sub.subject_id}]});
  const r=representation(p.row,f.s.capture,{embedding:['[1,0,0]','[1,1,0]','[-1,0,0]'][i]});return {p,r,sub,rows:[...set.rows,...p.rows,r]};
 });await pg.owner('BEGIN;'+inserts(children.flatMap(x=>x.rows))+'COMMIT;');
 const read=async(overrides:Record<string,string>={})=>JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,f,overrides))));
 const options=Array.from({length:3},(_,i)=>[1,2,20].flatMap(limit=>[-1,0,0.5,1].map(threshold=>({p_limit:String(limit),p_threshold:String(threshold),p_query:lit(['[1,0,0]','[0,1,0]','[-1,0,0]'][i])})))).flat();
 const before:any[]=[];for(const o of options)before.push(stable(await read(o)));
 const wide=technicalFixture({count:20});await pg.owner(wide.sql);
 const wideRead=async()=>JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,wide,{p_limit:'1'}))));
 const wideBefore=stable(await wideRead());assert.equal(wideBefore.status,'SEMANTIC_CONTEXT_AVAILABLE');
 const dataSql=`SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('wire',encode(public.vector_send(embedding),'hex')) ORDER BY representation_id) FROM gov_repo.sr2_representations_v1 r`;
 const bytes=await pg.owner(dataSql);const {before:catalogBefore}=await applyM2(pg);assert.equal(await pg.owner(dataSql),bytes);
 const definition=await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`);
 await t.test('36 healthy full DTO differentials are byte-equivalent except observed_at; inclusive thresholds/ties',async()=>{
  for(let i=0;i<options.length;i++)assert.equal(JSON.stringify(stable(await read(options[i]))),JSON.stringify(before[i]));
  const tied=await read({p_threshold:'1'});assert.deepEqual(tied.hits.map((h:any)=>h.subject.id),[children[0].sub.subject_id,f.s.rootSubject.subject_id]);
  assert.deepEqual(stable(await wideRead()),wideBefore,'20-source healthy DTO/provenance is unchanged');
 });
 const corrupt=async(sql:string,o:Record<string,string>={})=>JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;
  ALTER TABLE gov_repo.sr2_protected_projections_v1 DISABLE TRIGGER USER;${sql}SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,o)};ROLLBACK;`));
 await t.test('same missing protected child outside top-1 succeeds; inside top-1 fails whole read without N+1',async()=>{
  const fault=`DELETE FROM gov_repo.sr2_protected_projections_v1 WHERE ${where(f)} AND subject_id=${lit(children[2].sub.subject_id)};`;
  const outside=await corrupt(fault,{p_limit:'1'});assert.equal(outside.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(outside.hits[0].representation_id,children[0].r.row.representation_id);
  unavailable(await corrupt(fault,{p_limit:'1',p_query:"'[-1,0,0]'"}),'INVALID_SOURCE_SUPPORT');
  unavailable(await corrupt(fault,{p_limit:'20'}),'INVALID_SOURCE_SUPPORT');
 });
 await t.test('missing manifest source remains a selected-hit fault rather than eligibility substitution',async()=>{
  const sql=`ALTER TABLE gov_repo.sr2_manifest_entries_v1 DISABLE TRIGGER USER;DELETE FROM gov_repo.sr2_manifest_entries_v1 WHERE ${where(f)} AND entry_id=${lit(f.s.entries[2].entry_id)};`;
  const outside=await corrupt(sql,{p_limit:'1'});assert.equal(outside.status,'SEMANTIC_CONTEXT_AVAILABLE');
  unavailable(await corrupt(sql,{p_limit:'1',p_query:"'[-1,0,0]'"}),'SOURCE_UNAVAILABLE');
 });
 await t.test('F-2 base population validity remains domain-wide even outside the selected top-N',async()=>{
  const sql=`ALTER TABLE gov_repo.sr2_representations_v1 DISABLE TRIGGER USER;
   UPDATE gov_repo.sr2_representations_v1 SET recorded_at='9999-01-01' WHERE ${where(f)} AND subject_id=${lit(children[2].sub.subject_id)};`;
  unavailable(await corrupt(sql,{p_limit:'1'}),'INVALID_SOURCE_SUPPORT');
 });
 await t.test('revoked high rank excluded before score/rank while another eligible subject fills top-1',async()=>{
  const sql=`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=2 WHERE ${where(f)} AND entry_id=${lit(f.s.entries[0].entry_id)};`;
  const result=JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${sql}RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,{p_limit:'1'})};ROLLBACK;`));
  assert.equal(result.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(result.hits[0].representation_id,children[1].r.row.representation_id);
 });
 await t.test('METADATA_ONLY and REJECTED current heads exclude before rank and never reuse immutable older admission',async()=>{
  for(const outcome of ['METADATA_ONLY','REJECTED']){
   const a=admission(f.s.entries[0],f.s.capture,outcome);
   const sql=insert({table:'source_admissions',row:a})+`UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(a.source_admission_id)},head_revision=2 WHERE ${where(f)} AND entry_id=${lit(a.entry_id)};`;
   const result=JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${sql}RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,{p_limit:'1'})};ROLLBACK;`));
   assert.equal(result.hits[0].representation_id,children[1].r.row.representation_id);
  }
 });
 await t.test('newest ineligible representation cannot fall back to older eligible version',async()=>{
  const set=sourceSet(f.s,[children[0].sub],'ITEM_GROUNDING_V1',children[0].sub,'newest blocked');
  const p=plainProjection(f.s,set.row,[f.admissions[0]],{subject_id:children[0].sub.subject_id,source_fingerprint:children[0].sub.source_fingerprint,safe_label:'newest blocked',handling_recipe_version:'v3'});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
  const result=JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${inserts([...set.rows,...p.rows,r])}RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,{p_limit:'1'})};ROLLBACK;`));
  assert.equal(result.hits[0].representation_id,f.rep.row.representation_id);assert.ok(!result.hits.some((h:any)=>h.subject.id===children[0].sub.subject_id));
 });
 await t.test('every scored candidate invariant precedes threshold and limit including losing candidate',async()=>{
  for(const score of ["'NaN'::float8","'Infinity'::float8","'-Infinity'::float8",'NULL::float8','1.00001::float8','-1.00001::float8']){
   const mutated=definition.replace(/scored AS MATERIALIZED \(SELECT r\.\*,[^\n]+ AS relevance FROM scoreable r\)/,
    ()=>`scored AS MATERIALIZED (SELECT r.*,CASE WHEN r.subject_id=${lit(children[2].sub.subject_id)} THEN ${score} ELSE 1::float8 END AS relevance FROM scoreable r)`);
   assert.notEqual(mutated,definition);
   await assert.rejects(pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${mutated};\nRESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,{p_limit:'1',p_threshold:'1'})};ROLLBACK;`),/XX000.*TECHNICAL_NUMERIC_INVARIANT/);
  }
 });
 await t.test('current authorization, tenant scope, recipe and execution budget stay fail-closed',async()=>{
  const invalid:Record<string,string>[]=[{p_verified_organisation_id:lit(orgB)},{p_verified_credential_epoch:"'2000-01-01'"},{p_verified_session_exp:'1'}];
  for(const o of invalid)await assert.rejects(read(o),/GV00[1-5]/);
  await assert.rejects(read({p_query_recipe:"'GOVERNANCE_SUBJECT_QUERY_V1'"}),/22023/);
  unavailable(JSON.parse(await pg.svc('SELECT '+technicalRpc(actor,f))),'EXECUTION_BUDGET_REQUIRED');
  await assert.rejects(read({p_repository_id:lit('f'.repeat(64))}),/GV003/);
 });
 await t.test('unchanged real Node adapter executes current successor and strict DTO parser',async()=>{
  const {Pool}=await import('pg');const pool=new Pool({host:'127.0.0.1',port:Number(await pg.owner('SHOW port')),database:'postgres',user:'service_role',max:1});
  try{const epoch=await pg.owner(`SELECT to_char(password_changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM gov_repo.governance_users WHERE user_id=${lit(actor.id)}`);
   const now=Math.floor(Date.now()/1000),principal={organisationId:orgA,userId:actor.id,credentialEpoch:epoch,issuedAtSeconds:now-10,expiresAtSeconds:now+3600,informational:{}};
   const binding=createTechnicalScopeSource({bindings:[{selection_key:'m2',organisation_id:orgA,repository_id:f.root.row.repository_id,snapshot_id:f.s.snap.snapshot_id}]})(principal,'m2');assert.ok('scope'in binding);
   const space={projection_schema_version:'fixture-technical-v1',provider_id:'fixture',model_id:'fixture-model',model_version:'exact-fixture-v1',dimension:3};
   const source=createTechnicalQueryEmbeddingSource({space,document_recipe:'GOVIA_TECHNICAL_CONTEXT_V1',query_recipe:'TECHNICAL_CONTEXT_QUERY_V1',model_version_verified:true},
    {async embedQuestion(){return {space,query_recipe:'TECHNICAL_CONTEXT_QUERY_V1',vector:[1,0,0]};}});
   const query=await source('synthetic question');assert.ok('query'in query);
   const result=await createTechnicalRetrievalAdapter(pool).retrieveTechnicalContext(principal,binding.scope,query.query, {limit:20,threshold:-1,policy_version:'EXACT_COSINE_V1'});
   assert.equal(result.hits.length,4);
  }finally{await pool.end();}
 });
 await t.test('A3 real RPC smoke and SR1 M1 body remain unchanged at M2 horizon',async()=>{
  const sr1=JSON.parse(await pg.svc(scopedRead(sr1Rpc(actor))));assert.equal(sr1.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.ok(sr1.hits.length>0);
  const op=operationalFixture(actor);await pg.owner(op.sql);
  const value=JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));assert.equal(parseOperationalContextResult(value,orgA,operationalSpace,20).hits.length,1);
  assert.equal((await pg.owner(`SELECT prosrc FROM pg_proc WHERE oid='gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,public.vector,text,text,text,integer,text,integer,float8)'::regprocedure`)).replaceAll('\r',''),catalogBefore.find((p:any)=>p.proname==='semantic_context_search_v1').prosrc.trim().replaceAll('\r',''));
 });
 await t.test('successor frame audit preserves every recipe and all other catalog expressions',async()=>{
  const catalog=JSON.parse(await pg.owner(frameCatalogSql));
  const target=catalog.routines.find((r:any)=>r.name==='technical_semantic_context_search_v1');
  const prior=catalogBefore.find((p:any)=>p.proname===target.name);
  const priorCalls=frameArguments(prior.prosrc),afterCalls=frameArguments(target.body);
  assert.ok(afterCalls.every(c=>priorCalls.includes(c)),'only existing exact recipe call expressions reused');
  assert.ok(priorCalls.every(c=>afterCalls.includes(c)),'no historical recipe removed');
  // Existing auditor is frozen at V1: substitute only the separately audited body.
  target.body=prior.prosrc;assertFrameCatalog(catalog);
 });
 await t.test('H1 V3 current-horizon manifest freezes only the A2 body transition',async()=>{
  const actual=await collectV3(pg.owner);const migrations=m2Migrations();assert.equal(migrations.length,108);
  if(process.env.GOVIA_SR2_WRITE_MANIFEST_V3_FIXTURE==='1')writeFileSync(v3FixtureUrl,JSON.stringify({...actual,migrations},null,2)+'\n');
  const expected=JSON.parse(readFileSync(v3FixtureUrl,'utf8'));assert.deepEqual(actual.document,expected.document);assert.equal(actual.sha256,expected.sha256);assert.deepEqual(migrations,expected.migrations);
  t.diagnostic('H1_V3: '+actual.sha256);
 });
});
