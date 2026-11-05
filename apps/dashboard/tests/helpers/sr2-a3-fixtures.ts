import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { technicalCluster, scopedRead, lit, orgA, orgB, type Row } from './sr2-a2-fixtures';
import { ledgerRepo } from './ledger-v2-foundation-fixtures';
import type { Actor } from './semantic-retrieval-fixtures';
import { assertA3Horizon } from './sr2-dependency-manifest';

export { scopedRead, lit, orgA, orgB };
export const a3Migration='20261026124744_m175_c3_sr2_a3_operational_semantic_context_v1.sql';
export const operationalSpace=Object.freeze({projection_schema_version:'fixture-operational-v1',provider_id:'fixture-operational',
 model_id:'fixture-operational-model',model_version:'exact-operational-v1',dimension:3});
export const a3Source=()=>readFileSync(join(ledgerRepo,'supabase/migrations',a3Migration),'utf8');
export const frame=(parts:readonly unknown[])=>parts.map(value=>{const s=String(value);return `${Buffer.byteLength(s,'utf8')}:${s}`;}).join('');
export const hash=(parts:readonly unknown[])=>createHash('sha256').update(frame(parts),'utf8').digest('hex');
export const operationalCatalogQuery=`WITH extension_schema AS (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'),
 new_tables AS (SELECT c.oid FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname IN
 ('sr2_operational_agent_observations_v1','sr2_operational_agent_representations_v1','sr2_operational_agent_heads_v1'))
 SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,'comment',obj_description(c.oid,'pg_class')) ORDER BY c.relname) FROM pg_class c WHERE c.oid IN (SELECT oid FROM new_tables)),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'deferred',c.condeferrable) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM new_tables)),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',a.atthasdef,'collation',co.collname) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_collation co ON co.oid=a.attcollation WHERE c.oid IN (SELECT oid FROM new_tables) AND a.attnum>0 AND NOT a.attisdropped),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(c.oid),'access_method',am.amname) ORDER BY c.relname) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid IN (SELECT oid FROM new_tables)),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM new_tables) AND NOT t.tgisinternal),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM new_tables)),
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',replace(p.oid::regprocedure::text,CASE WHEN es.nspname='public' THEN ',vector,' ELSE ','||quote_ident(es.nspname)||'.vector,' END,',__vector__.vector,'),'arguments',replace(replace(pg_get_function_identity_arguments(p.oid),quote_ident(es.nspname)||'.vector','__vector__.vector'),'p_query vector','p_query __vector__.vector'),'owner',pg_get_userbyid(p.proowner),'result',pg_get_function_result(p.oid),'body_sha256',encode(sha256(convert_to(replace(replace(p.prosrc,chr(13),''),quote_ident(es.nspname)||'.','__vector__.'),'UTF8')),'hex'),'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'defaults',p.pronargdefaults,'language',l.lanname) ORDER BY p.proname) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang CROSS JOIN extension_schema es WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname IN ('sr2_operational_agent_head_guard_v1','operational_agent_semantic_context_search_v1'))
 )::text`;

export async function operationalCluster(diagnostic:(message:string)=>void){
 const pg=await technicalCluster(diagnostic);
 try{
  const routines=()=>pg.owner(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`);
  const before=JSON.parse(await routines());assert.equal(before.length,438);
  await pg.owner(a3Source());
  const after=JSON.parse(await routines());assert.equal(after.length,440);
  assert.deepEqual(after.filter((p:any)=>before.some((b:any)=>b.oid===p.oid)),before);
  const canonical=readdirSync(join(ledgerRepo,'supabase/migrations')).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort();
  // A3 owns exactly 106 historical files; later additive successors belong to their own replay.
  assertA3Horizon(canonical);
  diagnostic('Empty canonical 106-file replay PASS; real non-extension catalog 438 -> 440');return pg;
 }catch(error){pg.stop();throw error;}
}
const at='2026-10-01T00:00:00Z';
const sqlValue=(x:unknown)=>x===null?'NULL':typeof x==='boolean'||typeof x==='number'?String(x):lit(String(x));
export const operationalInsert=(table:string,row:Row)=>`INSERT INTO gov_repo.${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')});`;
export function operationalFixture(actor:Actor,overrides:Row={}){
 const has=(key:string)=>Object.prototype.hasOwnProperty.call(overrides,key);
 const org=overrides.organisation_id??actor.org, source_record_id=overrides.source_record_id??randomUUID();
 const related=overrides.related!==false, systemId=related?(overrides.system_id??randomUUID()):null;
 const agent={organisation_id:org,agent_id:source_record_id,agent_code:overrides.agent_code??`AG-${String(source_record_id).slice(0,8)}`,name:overrides.name??'Operational Agent',
  description:overrides.description??'Answers bounded operational questions.',agent_type:overrides.agent_type??'assistive',business_domain:has('business_domain')?overrides.business_domain:'Operations',
  ai_system_id:systemId,status:overrides.status??'active'};
 const system=related?{organisation_id:overrides.system_org??org,system_id:systemId,system_code:overrides.system_code??`SYS-${String(systemId).slice(0,8)}`,
  name:overrides.system_name??'Operational System',description:'fixture',intended_purpose:'fixture',status:overrides.system_status??'development',
  lifecycle:overrides.lifecycle??'development'}:null;
 const subject_id=hash(['GOVIA_SR2_OPERATIONAL_SUBJECT_V1',org,'LEGACY_AGENT_RECORD',source_record_id]);
 const relatedState=related?'PRESENT_SAME_TENANT':'ABSENT',descriptorRelatedState=related?'RELATED_SYSTEM_PRESENT_SAME_TENANT':'RELATED_SYSTEM_ABSENT';
 const source_descriptor_fingerprint=hash(['GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',org,'LEGACY_AGENT_RECORD',source_record_id,
  agent.agent_code,agent.name,agent.description,agent.agent_type,agent.business_domain===null?'BUSINESS_DOMAIN_ABSENT':'BUSINESS_DOMAIN_PRESENT',agent.business_domain??'',
  descriptorRelatedState,systemId??'',related?system!.organisation_id:'',related?system!.system_code:'',related?system!.name:'']);
 const observation:Row={organisation_id:org,source_record_id,subject_id,observation_id:'',source_descriptor_recipe:'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',
  source_descriptor_fingerprint,acquisition_method_code:'FIXTURE_ACQUISITION',acquisition_method_version:'1',projection_recipe_id:'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1',
  projection_recipe_version:'1',projection_schema_version:operationalSpace.projection_schema_version,handling_recipe_id:'GOVIA_SR2_OPERATIONAL_HANDLING_V1',
  handling_recipe_version:'1',document_recipe:'GOVIA_OPERATIONAL_CONTEXT_V1',agent_code_label:agent.agent_code,agent_name_label:agent.name,agent_type:agent.agent_type,
  business_domain_label:agent.business_domain,description_disposition:overrides.description_disposition??'PROJECTED',description_text:has('description_text')?overrides.description_text:agent.description,
  related_system_state:relatedState,related_system_record_id:systemId,related_system_code_label:related?system!.system_code:null,
  related_system_name_label:related?system!.name:null,projection_id:'',observed_at:at,recorded_at:at};
 observation.projection_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',org,source_record_id,subject_id,observation.projection_schema_version,
  observation.handling_recipe_id,observation.handling_recipe_version,observation.document_recipe,observation.agent_code_label,observation.agent_name_label,
  observation.agent_type,observation.business_domain_label===null?'BUSINESS_DOMAIN_ABSENT':'BUSINESS_DOMAIN_PRESENT',observation.business_domain_label??'',
  observation.description_disposition,observation.description_text??'',observation.related_system_state,observation.related_system_record_id??'',
  observation.related_system_code_label??'',observation.related_system_name_label??'']);
 observation.observation_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1',org,source_record_id,subject_id,observation.source_descriptor_recipe,
  source_descriptor_fingerprint,observation.acquisition_method_code,observation.acquisition_method_version,observation.projection_recipe_id,
  observation.projection_recipe_version,observation.projection_schema_version,observation.projection_id,observation.handling_recipe_id,
  observation.handling_recipe_version,observation.document_recipe]);
 const representation:Row={organisation_id:org,source_record_id,observation_id:observation.observation_id,representation_id:'',
  ...operationalSpace,document_recipe:'GOVIA_OPERATIONAL_CONTEXT_V1',embedding:overrides.embedding??'[1,0,0]',generated_at:at,recorded_at:at};
 representation.representation_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1',org,source_record_id,observation.observation_id,
  representation.projection_schema_version,representation.provider_id,representation.model_id,representation.model_version,representation.dimension]);
 const head={organisation_id:org,source_record_id,purpose_code:'OPERATIONAL_AGENT_CONTEXT_V1',observation_id:observation.observation_id,enabled:true,head_revision:1};
 const sql='BEGIN;'+(system?operationalInsert('ai_systems',{...system,owner_user_id:actor.id,created_by:actor.id}):'')+
  operationalInsert('agents',{...agent,owner_user_id:actor.id,created_by:actor.id})+operationalInsert('sr2_operational_agent_observations_v1',observation)+
  operationalInsert('sr2_operational_agent_representations_v1',representation)+operationalInsert('sr2_operational_agent_heads_v1',head)+'COMMIT;';
 return {org,agent,system,observation,representation,head,sql};
}
export function operationalRpc(actor:Actor,overrides:Record<string,string>={}){
 const now='floor(extract(epoch FROM clock_timestamp()))::bigint';
 const args={p_verified_organisation_id:lit(actor.org),p_verified_actor_user_id:lit(actor.id),p_verified_session_iat:now+'-10',p_verified_session_exp:now+'+3600',
  p_verified_credential_epoch:lit(actor.epoch),p_query:lit('[1,0,0]'),p_provider:lit(operationalSpace.provider_id),p_model:lit(operationalSpace.model_id),
  p_version:lit(operationalSpace.model_version),p_dimension:String(operationalSpace.dimension),p_schema:lit(operationalSpace.projection_schema_version),
  p_query_recipe:"'OPERATIONAL_CONTEXT_QUERY_V1'",p_limit:'20',p_threshold:'-1',...overrides};
 return `gov_repo.operational_agent_semantic_context_search_v1(${Object.entries(args).map(([k,v])=>`${k}=>${v}`).join(',')})`;
}
export function bulkOperationalSql(actor:Actor,count:number,dimension:number,label:string,history=1,descriptionBytes=0,descriptionEvery=0){
 const vector='['+Array.from({length:dimension},(_,i)=>i===0?'1':'0').join(',')+']',stamp='2026-10-01T00:00:00Z';
 const subject=`encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_SUBJECT_V1',a.organisation_id::text,'LEGACY_AGENT_RECORD',a.agent_id::text]),'UTF8')),'hex')`;
 const descriptor=`encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',a.organisation_id::text,'LEGACY_AGENT_RECORD',a.agent_id::text,a.agent_code::text,a.name::text,a.description,a.agent_type::text,'BUSINESS_DOMAIN_PRESENT',a.business_domain::text,'RELATED_SYSTEM_ABSENT','','','','']),'UTF8')),'hex')`;
 const projection=`encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',organisation_id::text,source_record_id::text,subject_id,${lit(operationalSpace.projection_schema_version)},'GOVIA_SR2_OPERATIONAL_HANDLING_V1','1','GOVIA_OPERATIONAL_CONTEXT_V1',agent_code,name,agent_type::text,'BUSINESS_DOMAIN_PRESENT',business_domain,'WITHHELD','','ABSENT','','','']),'UTF8')),'hex')`;
 const observation=`encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1',organisation_id::text,source_record_id::text,subject_id,'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',source_descriptor_fingerprint,'BULK_FIXTURE',version::text,'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',${lit(operationalSpace.projection_schema_version)},projection_id,'GOVIA_SR2_OPERATIONAL_HANDLING_V1','1','GOVIA_OPERATIONAL_CONTEXT_V1']),'UTF8')),'hex')`;
 const representation=`encode(sha256(convert_to(gov_repo.frame_identity(ARRAY['GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1',organisation_id::text,source_record_id::text,observation_id,${lit(operationalSpace.projection_schema_version)},${lit(operationalSpace.provider_id)},${lit(operationalSpace.model_id)},${lit(operationalSpace.model_version)},${dimension}::text]),'UTF8')),'hex')`;
 return `BEGIN;
 INSERT INTO gov_repo.agents(agent_id,agent_code,name,description,agent_type,owner_user_id,created_by,business_domain,status,organisation_id)
 SELECT md5(${lit(label)}||':'||g)::uuid,left('B'||${lit(label)}||g,20),'Bulk Agent '||g,
  CASE WHEN ${descriptionBytes>0&&descriptionEvery>0?`g%${descriptionEvery}=0`:'false'} THEN repeat('x',${descriptionBytes}) ELSE 'bounded bulk source' END,'assistive',${lit(actor.id)},${lit(actor.id)},'Operations','active',${lit(actor.org)}
 FROM generate_series(1,${count}) g;
 CREATE TEMP TABLE a3_bulk_rows ON COMMIT DROP AS
 WITH source AS (SELECT a.organisation_id,a.agent_id source_record_id,a.agent_code::text agent_code,a.name::text name,a.agent_type,a.business_domain::text,
   ${subject} subject_id,${descriptor} source_descriptor_fingerprint,v version FROM gov_repo.agents a CROSS JOIN generate_series(1,${history}) v
   WHERE a.organisation_id=${lit(actor.org)} AND a.agent_code LIKE ${lit('B'+label+'%')}),
 projected AS (SELECT *,${projection} projection_id FROM source), observed AS (SELECT *,${observation} observation_id FROM projected)
 SELECT *,${representation} representation_id FROM observed;
 INSERT INTO gov_repo.sr2_operational_agent_observations_v1
 (organisation_id,source_record_id,subject_id,observation_id,source_descriptor_recipe,source_descriptor_fingerprint,acquisition_method_code,acquisition_method_version,
 projection_recipe_id,projection_recipe_version,projection_schema_version,handling_recipe_id,handling_recipe_version,document_recipe,agent_code_label,agent_name_label,
 agent_type,business_domain_label,description_disposition,description_text,related_system_state,related_system_record_id,related_system_code_label,related_system_name_label,
 projection_id,observed_at,recorded_at)
 SELECT organisation_id,source_record_id,subject_id,observation_id,'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1',source_descriptor_fingerprint,'BULK_FIXTURE',version::text,
 'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',${lit(operationalSpace.projection_schema_version)},'GOVIA_SR2_OPERATIONAL_HANDLING_V1','1','GOVIA_OPERATIONAL_CONTEXT_V1',
 agent_code,name,agent_type,business_domain,'WITHHELD',NULL,'ABSENT',NULL,NULL,NULL,projection_id,${lit(stamp)},${lit(stamp)} FROM a3_bulk_rows;
 INSERT INTO gov_repo.sr2_operational_agent_representations_v1
 (organisation_id,source_record_id,observation_id,representation_id,projection_schema_version,provider_id,model_id,model_version,dimension,document_recipe,embedding,generated_at,recorded_at)
 SELECT organisation_id,source_record_id,observation_id,representation_id,${lit(operationalSpace.projection_schema_version)},${lit(operationalSpace.provider_id)},${lit(operationalSpace.model_id)},
 ${lit(operationalSpace.model_version)},${dimension},${lit('GOVIA_OPERATIONAL_CONTEXT_V1')},${lit(vector)},${lit(stamp)},${lit(stamp)} FROM a3_bulk_rows;
 INSERT INTO gov_repo.sr2_operational_agent_heads_v1(organisation_id,source_record_id,purpose_code,observation_id,enabled,head_revision)
 SELECT organisation_id,source_record_id,'OPERATIONAL_AGENT_CONTEXT_V1',observation_id,true,1 FROM a3_bulk_rows WHERE version=${history};
 ANALYZE gov_repo.agents;ANALYZE gov_repo.sr2_operational_agent_observations_v1;
 ANALYZE gov_repo.sr2_operational_agent_representations_v1;ANALYZE gov_repo.sr2_operational_agent_heads_v1;COMMIT;`;
}
