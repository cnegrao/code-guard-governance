import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { m3Baseline,applyM3,disclosurePermit,disclosureKey,reseal,collectV4,v4FixtureUrl,m3Migrations,zero } from '../helpers/sr2-m3-fixtures';
import { operationalFixture,operationalRpc,operationalInsert,operationalSpace,scopedRead,lit,orgA,orgB,hash } from '../helpers/sr2-a3-fixtures';
import { technicalFixture,technicalRpc,type Row } from '../helpers/sr2-a2-fixtures';
import { fixture,rpc as sr1Rpc } from '../helpers/semantic-retrieval-fixtures';
import { parseOperationalContextResult } from '../../lib/governance/operational-context-contract';

const stable=(v:any)=>{const {observed_at,...rest}=v;return rest;};
const denied=(v:any,reason:string)=>{assert.equal(v.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.equal(v.reason,reason);assert.deepEqual(v.hits,[]);};
const sourceSql=(f:ReturnType<typeof operationalFixture>)=>f.sql.slice(0,f.sql.indexOf('INSERT INTO gov_repo.sr2_operational_agent_observations_v1'))+'COMMIT;';
const newRows=(f:ReturnType<typeof operationalFixture>,changes:Record<string,unknown>)=>{
 const o=reseal({...f.observation,...changes});
 const r:Row={...f.representation,observation_id:o.observation_id};
 r.representation_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1',o.organisation_id,o.source_record_id,o.observation_id,
  r.projection_schema_version,r.provider_id,r.model_id,r.model_version,r.dimension]);
 return {o,r,sql:operationalInsert('sr2_operational_agent_observations_v1',o)+operationalInsert('sr2_operational_agent_representations_v1',r)};
};
const forbidden=[
 ...Array.from({length:31},(_,i)=>i+1),...Array.from({length:33},(_,i)=>127+i),0xad,0x61c,0x180e,
 ...Array.from({length:5},(_,i)=>0x200b+i),...Array.from({length:7},(_,i)=>0x2028+i),
 ...Array.from({length:5},(_,i)=>0x2060+i),...Array.from({length:4},(_,i)=>0x2066+i),0xfeff,
];
const white=[9,10,11,12,13,32,0xa0,0x1680,...Array.from({length:11},(_,i)=>0x2000+i),0x202f,0x205f,0x3000];

test('M3 A3 binding/disclosure exact local acceptance',{timeout:900000},async t=>{
 const pg=await m3Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());
 await pg.bootstrapSql('BEGIN;SET LOCAL session_replication_role=replica;'+fixture+'COMMIT;');
 const actor=await pg.actor(orgA),other=await pg.actor(orgB);
 const read=async(overrides:Record<string,string>={})=>JSON.parse(await pg.svc(scopedRead(operationalRpc(actor,overrides))));
 const reset=()=>pg.owner("UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=false,head_revision=head_revision+1 WHERE organisation_id="+lit(orgA)+" AND enabled");
 const f=operationalFixture(actor);await pg.owner(f.sql);const healthy=stable(await read());
 const technical=technicalFixture();await pg.owner(technical.sql);
 const technicalRead=()=>pg.svc(scopedRead(technicalRpc(actor,technical)));
 const sr1Read=()=>pg.svc(scopedRead(sr1Rpc(actor)));
 const oldA2=stable(JSON.parse(await technicalRead())),oldSr1=stable(JSON.parse(await sr1Read()));
 assert.equal(oldA2.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(oldSr1.status,'SEMANTIC_CONTEXT_AVAILABLE');
 const historical=operationalFixture(actor),forgedHistorical=newRows(historical,{agent_name_label:'Historical forgery'});
 await pg.owner(sourceSql(historical));
 await pg.owner('BEGIN;'+forgedHistorical.sql+operationalInsert('sr2_operational_agent_heads_v1',
  {...historical.head,observation_id:forgedHistorical.o.observation_id,enabled:false})+'COMMIT;');
 await applyM3(pg);
 const check=async(name:string,body:()=>Promise<void>)=>{
  let failure:unknown;await t.test(name,async()=>{try{await body();}catch(e){failure=e;throw e;}});if(failure)throw failure;
 };
 await check('missing disclosure denies; explicit enable preserves the entire healthy A3 DTO and parser',async()=>{
  denied(await read(),'CONTENT_WITHHELD');
  await pg.owner(disclosurePermit(orgA));await pg.owner(disclosurePermit(orgB));
  const v=await read();assert.deepEqual(stable(v),healthy);
  assert.equal(parseOperationalContextResult(v,orgA,operationalSpace,20).hits.length,1);
 });
 await check('stale disclosure admission revision fails closed on read even with corrupt enabled head',async()=>{
  const v=JSON.parse(await pg.bootstrapSql('BEGIN;ALTER TABLE gov_repo.sr2_operational_disclosure_heads_v1 DISABLE TRIGGER USER;'+
   'UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET head_revision=2 WHERE '+disclosureKey(orgA)+
   ";SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT "+operationalRpc(actor)+';ROLLBACK;'));
  denied(v,'CONTENT_WITHHELD');
 });
 await check('forged internally valid projection fields reject despite correct raw-source fingerprint',async()=>{
  await reset();const g=operationalFixture(actor);await pg.owner(sourceSql(g));
  for(const changes of [
   {agent_code_label:'Forged'}, {agent_name_label:'Forged'}, {agent_type:'classifier'}, {business_domain_label:null},
   {business_domain_label:'Forged'}, {description_text:'Forged'}, {description_text:String(g.agent.description).slice(1)},
   {related_system_code_label:'Forged'}, {related_system_name_label:'Forged'}, {related_system_record_id:randomUUID()},
   {related_system_state:'ABSENT',related_system_record_id:null,related_system_code_label:null,related_system_name_label:null},
  ]){
   const rows=newRows(g,changes);
   await assert.rejects(pg.owner('BEGIN;'+rows.sql+'COMMIT;'),/23514.*SR2_OPERATIONAL_SOURCE_BINDING/);
   assert.equal(await pg.owner('SELECT count(*) FROM gov_repo.sr2_operational_agent_observations_v1 WHERE observation_id='+lit(String(rows.o.observation_id))),'0');
  }
  const stale=newRows(g,{source_descriptor_fingerprint:'f'.repeat(64)});
  await assert.rejects(pg.owner('BEGIN;'+stale.sql+'COMMIT;'),/SR2_OPERATIONAL_SOURCE_CHANGED/);
 });
 await check('historical forged projection cannot be re-enabled or disclosed even if its hashes match',async()=>{
  await reset();
  const key="organisation_id="+lit(orgA)+" AND source_record_id="+lit(String(historical.agent.agent_id));
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=2 WHERE '+key),/SOURCE_BINDING/);
  const v=JSON.parse(await pg.bootstrapSql('BEGIN;ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 DISABLE TRIGGER USER;'+
   'UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=2 WHERE '+key+
   ";SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT "+operationalRpc(actor)+';ROLLBACK;'));
  denied(v,'INVALID_SOURCE_SUPPORT');
 });
 await check('live source change makes stale projection unavailable; head advance/re-enable require current source',async()=>{
  await reset();const g=operationalFixture(actor);await pg.owner(g.sql);
  await pg.owner('UPDATE gov_repo.agents SET name='+"'Changed'"+' WHERE agent_id='+lit(String(g.agent.agent_id)));
  denied(await read(),'SOURCE_CHANGED');
  await pg.owner('UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=false,head_revision=2 WHERE source_record_id='+lit(String(g.agent.agent_id)));
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=3 WHERE source_record_id='+lit(String(g.agent.agent_id))),/SOURCE_BINDING/);
 });
 await check('same-tenant source and related system are mandatory, including foreign joins and ABSENT',async()=>{
  for(const g of [operationalFixture(actor,{system_org:orgB})]){
   await assert.rejects(pg.owner(g.sql),/SOURCE_UNAVAILABLE/);
  }
  const own=operationalFixture(actor);await pg.owner(sourceSql(own));
  const foreignProjection=reseal({...own.observation,organisation_id:orgB,
   subject_id:hash(['GOVIA_SR2_OPERATIONAL_SUBJECT_V1',orgB,'LEGACY_AGENT_RECORD',own.agent.agent_id])});
  await assert.rejects(pg.owner('BEGIN;'+operationalInsert('sr2_operational_agent_observations_v1',foreignProjection)+'COMMIT;'),/SOURCE_UNAVAILABLE/);
  const foreign=operationalFixture(other);await pg.owner(foreign.sql);
  const g=operationalFixture(actor,{related:false});await pg.owner(g.sql);
  const v=await read();assert.equal(v.hits.length,1);assert.equal(v.hits[0].projection.related_system_state,'ABSENT');
  assert.equal(v.hits[0].projection.related_system_record_id,null);
 });
 await check('verbatim Unicode bytes, decomposition and surrounding whitespace survive without normalization',async()=>{
  await reset();
  const name='  Café e\u0301 日本語 العربية 😀\u2065\u206a\u180f\u061d\u00a0 ',description=' \u2000Résumé e\u0301 中文 😀\u3000 ';
  const g=operationalFixture(actor,{name,description,business_domain:'\u00a0Ops\u200a',system_name:'Système e\u0301 😀'});
  await pg.owner(g.sql);const v=await read(),p=v.hits[0].projection;
  assert.equal(v.status,'SEMANTIC_CONTEXT_AVAILABLE');
  for(const [key,want] of Object.entries({agent_name_label:name,description_text:description,business_domain_label:g.agent.business_domain,
   related_system_name_label:g.system!.name}))assert.deepEqual(Buffer.from(p[key],'utf8'),Buffer.from(String(want),'utf8'));
  parseOperationalContextResult(v,orgA,operationalSpace,20);
  const absent=operationalFixture(actor,{related:false,business_domain:null});await pg.owner(absent.sql);
  assert.equal((await read()).hits.find((h:any)=>h.source_record_id===absent.agent.agent_id).projection.business_domain_label,null);
 });
 await check('WITHHELD is always allowed with NULL; PROJECTED requires exact present SAFE <=1024 bytes',async()=>{
  await reset();const g=operationalFixture(actor,{description:'unsafe\u202e'+ 'x'.repeat(2048),description_disposition:'WITHHELD',description_text:null});
  await pg.owner(g.sql);const v=await read();assert.equal(v.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(v.hits[0].projection.description_text,null);
  const bad=newRows(g,{description_disposition:'WITHHELD',description_text:'manufactured'});
  await assert.rejects(pg.owner('BEGIN;'+bad.sql+'COMMIT;'),/SOURCE_BINDING/);
  for(const description of ['é'.repeat(512),'x'.repeat(1024)]){
   await reset();const exact=operationalFixture(actor,{description});await pg.owner(exact.sql);
   assert.equal((await read()).hits[0].projection.description_text,description);
  }
  for(const description of ['é'.repeat(512)+'x','x'.repeat(1025)]){
   await assert.rejects(pg.owner(operationalFixture(actor,{description}).sql),/SOURCE_BINDING/);
  }
 });
 await check('complete approved SAFE corpus is rejected at real writer admission; whitespace-only is invalid',async()=>{
  for(const cp of forbidden){
   const g=operationalFixture(actor,{name:'a'+String.fromCodePoint(cp)+'b'});
   // Build controls inside PostgreSQL: raw U+001A terminates psql stdin on Windows.
   const sql=g.sql.replaceAll(lit(String(g.agent.name)),"('a'||chr("+cp+")||'b')");
   await assert.rejects(pg.owner(sql),/SOURCE_BINDING/,'U+'+cp.toString(16));
  }
  for(const cp of white){
   const g=operationalFixture(actor,{name:String.fromCodePoint(cp)});
   await assert.rejects(pg.owner(g.sql.replaceAll(lit(String(g.agent.name)),'chr('+cp+')')),/SOURCE_BINDING/,'white U+'+cp.toString(16));
  }
  for(const cp of [0x200a,0x180f,0x2065,0x206a,0x206f,0x202f,0x3000,0x301,0x1f600]){
   assert.equal(await pg.owner("SELECT gov_repo.sr2_operational_safe_v1('x'||chr("+cp+")||'y',512)"),'t','must not broaden: '+cp);
  }
  assert.equal(await pg.owner("SELECT gov_repo.sr2_operational_safe_v1(repeat('é',256),512)"),'t');
  assert.equal(await pg.owner("SELECT gov_repo.sr2_operational_safe_v1(repeat('é',256)||'x',512)"),'f');
  assert.equal(await pg.owner("SELECT gov_repo.sr2_operational_safe_v1(NULL,512)"),'f');
  await assert.rejects(pg.owner("SELECT convert_from(decode('c080','hex'),'UTF8')"),/22021/);
  await assert.rejects(pg.owner("SELECT chr(0)"),/54000|22021/);
 });
 await check('SAFE applies to every projected text and admission metadata, without trimming or optional-field substitution',async()=>{
  for(const patch of [
   {agent_code:'x\u200by'},{business_domain:'x\u2028y'},{description:'x\u2060y'},
   {system_code:'x\u061cy'},{system_name:'x\u180ey'},
  ])await assert.rejects(pg.owner(operationalFixture(actor,patch).sql),/SOURCE_BINDING/);
  const g=operationalFixture(actor);await pg.owner(sourceSql(g));
  for(const changes of [{acquisition_method_code:'x\u200by'},{acquisition_method_version:'x\u2066y'},{projection_schema_version:'x\ufeffy'}]){
   await assert.rejects(pg.owner('BEGIN;'+newRows(g,changes).sql+'COMMIT;'),/SOURCE_BINDING/);
  }
 });
 await check('durable denial commits independently, survives failed repair, and old admissions cannot resurrect disclosure',async()=>{
  await reset();const g=operationalFixture(actor);await pg.owner(g.sql);
  const where=disclosureKey(orgA);
  // Record an unused admission before denial; even a changed wall clock must not
  // make that old basis a valid lift of a later head revision.
  const prepared=randomUUID();
  await pg.owner(operationalInsert('sr2_operational_disclosure_admissions_v1',{organisation_id:orgA,
   purpose_code:'OPERATIONAL_AGENT_CONTEXT_V1',scope_kind:'ORGANISATION',source_record_id:zero,disclosure_admission_id:prepared,
   handling_recipe_id:'GOVIA_SR2_OPERATIONAL_HANDLING_V1',handling_recipe_version:'1',document_recipe:'GOVIA_OPERATIONAL_CONTEXT_V1',
   policy_basis_reference:'Prepared before denial',admitted_after_revision:999,recorded_at:'2000-01-01'}));
  assert.equal(await pg.owner('SELECT admitted_after_revision FROM gov_repo.sr2_operational_disclosure_admissions_v1 WHERE disclosure_admission_id='+lit(prepared)),'1');
  await pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=false,head_revision=2 WHERE '+where+' AND head_revision=1');
  denied(await read(),'CONTENT_WITHHELD');
  const parsed=parseOperationalContextResult(await read(),orgA,operationalSpace,20);assert.equal(parsed.reason,'CONTENT_WITHHELD');
  await assert.rejects(pg.owner("BEGIN;UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=false,head_revision=head_revision+1 WHERE organisation_id="+lit(orgA)+" AND enabled;SELECT 1/0;COMMIT;"),/22012/);
  assert.equal(await pg.owner("SELECT enabled FROM gov_repo.sr2_operational_agent_heads_v1 WHERE source_record_id="+lit(String(g.agent.agent_id))),'t');
  denied(await read(),'CONTENT_WITHHELD');
  await assert.rejects(pg.owner(operationalFixture(actor).sql),/DISCLOSURE_DENIED/);
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=true,head_revision=3 WHERE '+where),/FRESH_ADMISSION_REQUIRED/);
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=true,disclosure_admission_id='+lit(prepared)+',head_revision=3 WHERE '+where),/FRESH_ADMISSION_REQUIRED/);
  await reset();denied(await read(),'CONTENT_WITHHELD');
  await assert.rejects(pg.owner("UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=3 WHERE source_record_id="+lit(String(g.agent.agent_id))),/DISCLOSURE_DENIED/);
  await pg.owner(disclosurePermit(orgA,zero,'ORGANISATION',3));
  await pg.owner("UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=3 WHERE source_record_id="+lit(String(g.agent.agent_id)));
  assert.equal((await read()).status,'SEMANTIC_CONTEXT_AVAILABLE');
 });
 await check('source-specific denial persists before any semantic head and a narrow permit cannot override broad denial',async()=>{
  await reset();const g=operationalFixture(actor),key=disclosureKey(orgA,String(g.agent.agent_id),'SOURCE');
  await pg.owner(operationalInsert('sr2_operational_disclosure_heads_v1',{organisation_id:orgA,purpose_code:'OPERATIONAL_AGENT_CONTEXT_V1',
   scope_kind:'SOURCE',source_record_id:g.agent.agent_id,disclosure_admission_id:null,enabled:false,head_revision:1,changed_at:'2000-01-01'}));
  await assert.rejects(pg.owner(g.sql),/DISCLOSURE_DENIED/);
  await pg.owner(disclosurePermit(orgA,String(g.agent.agent_id),'SOURCE',2));await pg.owner(g.sql);
  await pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=false,head_revision=3 WHERE '+key);
  denied(await read(),'CONTENT_WITHHELD');
  await pg.owner(disclosurePermit(orgA,String(g.agent.agent_id),'SOURCE',4));
  assert.equal((await read()).status,'SEMANTIC_CONTEXT_AVAILABLE');
  await pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=false,head_revision=4 WHERE '+disclosureKey(orgA));
  denied(await read(),'CONTENT_WITHHELD');
  await pg.owner(disclosurePermit(orgA,zero,'ORGANISATION',5));
 });
 await check('control heads enforce exact transitions, immutable scope, sticky denial and private ACL/RLS',async()=>{
  const key=disclosureKey(orgA);
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET head_revision=6 WHERE '+key),/NO_OP/);
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=false,head_revision=7 WHERE '+key),/REVISION_TRANSITION/);
  await assert.rejects(pg.owner('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET scope_kind='+"'SOURCE',head_revision=6 WHERE "+key),/IMMUTABLE_KEY/);
  for(const table of ['sr2_operational_disclosure_heads_v1','sr2_operational_disclosure_admissions_v1']){
   await assert.rejects(pg.owner('DELETE FROM gov_repo.'+table),/SR2_IMMUTABLE/);
   await assert.rejects(pg.owner('TRUNCATE gov_repo.'+table+' CASCADE'),/SR2_IMMUTABLE/);
   for(const role of ['service_role','anon','authenticated'])await assert.rejects(pg.bootstrapSql('SET ROLE '+role+';SELECT * FROM gov_repo.'+table),/42501/);
  }
  assert.equal(await pg.owner("SELECT count(*) FROM pg_policy WHERE polrelid IN ('gov_repo.sr2_operational_disclosure_heads_v1'::regclass,'gov_repo.sr2_operational_disclosure_admissions_v1'::regclass)"),'0');
  const funcs=['sr2_operational_safe_v1','sr2_operational_scope_lock_v1','sr2_operational_disclosure_guard_v1','sr2_operational_binding_v1','sr2_operational_observation_admit_v1'];
  for(const name of funcs)assert.equal(await pg.owner("SELECT has_function_privilege('service_role',oid,'EXECUTE') OR has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname="+lit(name)),'f');
  await assert.rejects(pg.owner('BEGIN ISOLATION LEVEL REPEATABLE READ;'+operationalFixture(actor).sql.replace('BEGIN;','').replace('COMMIT;','')+'ROLLBACK;'),/READ_COMMITTED_REQUIRED/);
 });
 await check('SR1 and A2 current-horizon smoke retain exact healthy results and application capabilities',async()=>{
  assert.deepEqual(stable(JSON.parse(await technicalRead())),oldA2);
  assert.deepEqual(stable(JSON.parse(await sr1Read())),oldSr1);
 });
 await check('H1 current 109-migration horizon freezes exact new routines, controls, ACLs, triggers and identities',async()=>{
  const actual=await collectV4(pg.owner);assert.deepEqual(actual.document.missing,[]);
  const migrations=m3Migrations();assert.equal(migrations.length,109);
  assert.equal(actual.document.routines.length,28);assert.equal(actual.document.relations.length,45);
  if(process.env.SR2_M3_WRITE_MANIFEST==='1')writeFileSync(v4FixtureUrl,JSON.stringify({...actual,migrations},null,2)+'\n');
  const expected=JSON.parse(readFileSync(v4FixtureUrl,'utf8'));
  assert.deepEqual(actual,{document:expected.document,sha256:expected.sha256});assert.deepEqual(migrations,expected.migrations);
  t.diagnostic('H1_V4_CURRENT_HORIZON '+actual.sha256);
 });
});
