import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerRepo } from './ledger-v2-foundation-fixtures';
import { m2Baseline, applyM2, collectV3, v3FixtureUrl } from './sr2-m2-fixtures';
import { lit, hash, operationalInsert } from './sr2-a3-fixtures';
import { routineSnapshot } from './sr1-numeric-fixtures';
import type { Row } from './sr2-a2-fixtures';

export const m3Migration='20261029195734_m175_pre_a4_m3_a3_binding_disclosure_v1.sql';
export const m3Source=()=>readFileSync(join(ledgerRepo,'supabase/migrations',m3Migration),'utf8');
export const zero='00000000-0000-0000-0000-000000000000';
export function disclosureKey(org:string,source=zero,kind=source===zero?'ORGANISATION':'SOURCE'){
 return "organisation_id="+lit(org)+" AND purpose_code='OPERATIONAL_AGENT_CONTEXT_V1' AND scope_kind="+lit(kind)+" AND source_record_id="+lit(source);
}
/** Explicit owner/test admission. Production gains no application writer or default permit. */
export function disclosurePermit(org:string,source=zero,kind=source===zero?'ORGANISATION':'SOURCE',revision=1){
 const id=randomUUID(),base={organisation_id:org,purpose_code:'OPERATIONAL_AGENT_CONTEXT_V1',scope_kind:kind,source_record_id:source};
 const admission=operationalInsert('sr2_operational_disclosure_admissions_v1',{...base,disclosure_admission_id:id,
  handling_recipe_id:'GOVIA_SR2_OPERATIONAL_HANDLING_V1',handling_recipe_version:'1',document_recipe:'GOVIA_OPERATIONAL_CONTEXT_V1',
  policy_basis_reference:'Explicit local fixture disclosure admission',recorded_at:'2000-01-01'});
 const head=revision===1?operationalInsert('sr2_operational_disclosure_heads_v1',{...base,disclosure_admission_id:id,enabled:true,
  head_revision:1,changed_at:'2000-01-01'}):
  "UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET disclosure_admission_id="+lit(id)+",enabled=true,head_revision="+revision+" WHERE "+disclosureKey(org,source,kind)+" AND head_revision="+(revision-1)+";";
 return 'BEGIN;'+admission+head+'COMMIT;';
}
export const m3Migrations=()=>readdirSync(join(ledgerRepo,'supabase/migrations'))
 .filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)&&n<=m3Migration).sort()
 .map(name=>({name,sha256_lf:createHash('sha256').update(readFileSync(join(ledgerRepo,'supabase/migrations',name),'utf8').replaceAll('\r','')).digest('hex')}));
export const v4FixtureUrl=new URL('../fixtures/sr2-dependency-manifest-v4.json',import.meta.url);
export const collectV4=async(owner:(sql:string)=>Promise<string>)=>JSON.parse(await owner('BEGIN READ ONLY;'+
 readFileSync(new URL('./sr2-dependency-manifest-v4.sql',import.meta.url),'utf8')+'COMMIT;'));
export async function m3Baseline(diagnostic:(s:string)=>void){
 const pg=await m2Baseline(diagnostic);
 try{
  await applyM2(pg);
  const expected=JSON.parse(readFileSync(v3FixtureUrl,'utf8'));
  assert.deepEqual(await collectV3(pg.owner),{document:expected.document,sha256:expected.sha256});
  return pg;
 }catch(e){pg.stop();throw e;}
}
export async function applyM3(pg:Awaited<ReturnType<typeof m3Baseline>>){
 const before=JSON.parse(await pg.owner(routineSnapshot));
 await pg.owner(m3Source());
 const after=JSON.parse(await pg.owner(routineSnapshot));
 const changed=['operational_agent_semantic_context_search_v1','sr2_operational_agent_head_guard_v1'];
 assert.equal(after.length,before.length+5);
 for(const old of before){
  const next=after.find((r:any)=>r.oid===old.oid);assert.ok(next);
  if(changed.includes(old.proname)){assert.notEqual(next.prosrc,old.prosrc);assert.deepEqual({...next,prosrc:old.prosrc},old);}
  else assert.deepEqual(next,old,'all other routine bytes/capabilities preserved: '+old.proname);
 }
}
/** Make a forged projection internally identity-valid; rejection must be source binding. */
export function reseal(o:Row){
 o.projection_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',o.organisation_id,o.source_record_id,o.subject_id,
  o.projection_schema_version,o.handling_recipe_id,o.handling_recipe_version,o.document_recipe,o.agent_code_label,o.agent_name_label,o.agent_type,
  o.business_domain_label===null?'BUSINESS_DOMAIN_ABSENT':'BUSINESS_DOMAIN_PRESENT',o.business_domain_label??'',o.description_disposition,
  o.description_text??'',o.related_system_state,o.related_system_record_id??'',o.related_system_code_label??'',o.related_system_name_label??'']);
 o.observation_id=hash(['GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1',o.organisation_id,o.source_record_id,o.subject_id,
  o.source_descriptor_recipe,o.source_descriptor_fingerprint,o.acquisition_method_code,o.acquisition_method_version,o.projection_recipe_id,
  o.projection_recipe_version,o.projection_schema_version,o.projection_id,o.handling_recipe_id,o.handling_recipe_version,o.document_recipe]);
 return o;
}
