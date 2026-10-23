import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ledgerFoundationCluster, ledgerRepo, lit, orgA, orgB } from './ledger-v2-foundation-fixtures';
export { lit, orgA, orgB };
export const semanticMigration='20261022142630_m175_c3_sr1_principal_bound_semantic_retrieval_v1.sql';
export const semanticSource=()=>readFileSync(join(ledgerRepo,'supabase/migrations',semanticMigration),'utf8');
export const successorPostflight=()=>semanticSource().match(/DO \$postflight\$[\s\S]*?END \$postflight\$;/)![0];
export const space={projection_schema_version:'GOVIA_SEMANTIC_CONTENT_V1',provider_id:'fixture',model_id:'fixture-model',model_version:'fixture-v1',dimension:3};
export interface Actor { id:string; org:string; epoch:string }
export async function semanticCluster(diagnostic:(m:string)=>void) {
 const pg=await ledgerFoundationCluster(diagnostic);
 try {
  await pg.applyFoundation();
  for(const n of ['20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql','20261021201316_m175_v1_s1a1_2b_ledger_v2_tenant_read.sql'])
    await pg.owner(readFileSync(join(ledgerRepo,'supabase/migrations',n),'utf8'));
  // Keep this historical SR1 horizon exact when later additive slices are present.
  const canonical=readdirSync(join(ledgerRepo,'supabase/migrations')).filter(n=>/^\d{14}_.*\.sql$/.test(n)&&n<=semanticMigration).sort();
  assert.equal(canonical.length,103);assert.equal(canonical.at(-1),semanticMigration);
  const prior=await pg.owner(`SELECT jsonb_agg(to_jsonb(p) ORDER BY oid)::text FROM pg_proc p WHERE pronamespace='gov_repo'::regnamespace`);
  const privileges=await pg.owner(`SELECT jsonb_build_object('tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='gov_repo'::regnamespace),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m))::text`);
  await pg.owner(semanticSource());
  const after=await pg.owner(`SELECT jsonb_agg(to_jsonb(p) ORDER BY oid)::text FROM pg_proc p WHERE pronamespace='gov_repo'::regnamespace AND proname<>'semantic_context_search_v1'`);
  assert.deepEqual(JSON.parse(after),JSON.parse(prior),'all prior routine owner/body/config/ACL exact');
  assert.equal(await pg.owner(`SELECT jsonb_build_object('tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='gov_repo'::regnamespace),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m))::text`),privileges);
  diagnostic('Canonical replay PASS: all 102 historical canonical + 1 SR1; every prior routine and table/default/member privilege unchanged');
 } catch(e) {pg.stop();throw e;}
 const actor=async(org:string):Promise<Actor>=>{
   const id=randomUUID();
   await pg.owner(`INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
     SELECT '${id}','${id}@example.invalid','Semantic reader','${org}','active',ARRAY[role_id] FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER'`);
   await pg.bootstrapSql(`BEGIN; ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
     UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id='${id}';
     ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1; COMMIT;`);
   return {id,org,epoch:await pg.owner(`SELECT password_changed_at::text FROM gov_repo.governance_users WHERE user_id='${id}'`)};
 };
 return {...pg,actor};
}
export function rpc(a:Actor,overrides:Record<string,string>={}) {
 const now='floor(extract(epoch FROM clock_timestamp()))::bigint';
 return `gov_repo.semantic_context_search_v1(${Object.entries({p_verified_organisation_id:lit(a.org),p_verified_actor_user_id:lit(a.id),
 p_verified_session_iat:`${now}-10`,p_verified_session_exp:`${now}+3600`,p_verified_credential_epoch:lit(a.epoch),p_query:"'[1,0,0]'",
 p_provider:lit(space.provider_id),p_model:lit(space.model_id),p_version:lit(space.model_version),p_dimension:'3',p_schema:lit(space.projection_schema_version),
 p_limit:'5',p_threshold:'-1',...overrides}).map(([k,v])=>`${k}=>${v}`).join(',')})`;
}
export const bounded=(q:string)=>`BEGIN; SET LOCAL statement_timeout='5s'; ${q}; COMMIT;`;
export function representation(id:string,subject:string,opts:{org?:string;family?:string;kind?:string;vector?:string;generated?:string;created?:string;provider?:string;model?:string;version?:string;schema?:string;dimension?:number}={}) {
 const {org=orgA,family='CANONICAL_OBJECT',kind='AGENT',vector='[1,0,0]',generated='2026-10-01T00:00:00Z',created=generated,
 provider=space.provider_id,model=space.model_id,version=space.model_version,schema=space.projection_schema_version,dimension=3}=opts;
 return `INSERT INTO gov_repo.semantic_representations(organisation_id,representation_id,subject_kind,subject_canonical_object_id,subject_canonical_object_kind,
 subject_candidate_id,subject_candidate_kind,projection_schema_version,content_fingerprint_algorithm,content_fingerprint_schema_version,content_fingerprint_value,
 embedding_provider_id,embedding_model_id,embedding_model_version,embedding_dimension,embedding,generated_at,created_at)
 VALUES(${lit(org)},${lit(id)},${lit(family)},${family==='CANONICAL_OBJECT'?lit(subject):'NULL'},${family==='CANONICAL_OBJECT'?lit(kind):'NULL'},
 ${family==='NORMALIZED_CANDIDATE'?lit(subject):'NULL'},${family==='NORMALIZED_CANDIDATE'?lit(kind):'NULL'},${lit(schema)},'SHA-256','fp-v1',${lit(id)},
 ${lit(provider)},${lit(model)},${lit(version)},${dimension},${lit(vector)},${lit(generated)},${lit(created)});`;
}
export const support=(id:string,org=orgA,evidence='evidence')=>`INSERT INTO gov_repo.semantic_representation_evidence VALUES(${lit(org)},${lit(id)},${lit(evidence)});`;
export const fixture=`
 INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code) VALUES('${orgA}','SR_A','A','A','BR'),('${orgB}','SR_B','B','B','BR');
 INSERT INTO gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id)
 VALUES('object-a','${orgA}','AGENT','fixture-decision'),('object-b','${orgB}','AGENT','fixture-decision'),('object-a2','${orgA}','AGENT','fixture-decision');
 INSERT INTO gov_repo.discovery_candidates(organisation_id,candidate_id,candidate_kind,candidate_family,finding_id,source_connection_id,source_external_type,source_external_id,
 confidence,requires_reconciliation,relationship_type_code,source_endpoint,target_endpoint,acquisition_run_id,contract_version,envelope,envelope_hash)
 VALUES('${orgA}','object-a','RELATIONSHIP','RELATIONSHIP','fixture','fixture','fixture','private',0.99,true,'USES','{}','{}','fixture','v1','{"secret":"not public"}',repeat('a',64));
 INSERT INTO gov_repo.discovery_evidence(organisation_id,evidence_id,handling,captured_at,content_hash,contract_version,envelope,envelope_hash)
 VALUES('${orgA}','evidence','HASH_ONLY','2026-10-01','hash-a','v1','{"secret":"not public"}',repeat('a',64)),
 ('${orgB}','foreign-evidence','HASH_ONLY','2026-10-01','hash-b','v1','{"secret":"not public"}',repeat('a',64));
 INSERT INTO gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,method_code,method_version,trust_state,
 confidence,observed_at,recorded_at,contract_version,envelope,envelope_hash)
 VALUES('${orgA}','assertion','fixture','fixture','fixture','private','STATIC_SCAN','v1','INFERRED',0.99,'2026-10-01','2026-10-01','v1','{"secret":"not public"}',repeat('a',64)),
 ('${orgB}','foreign-assertion','fixture','fixture','fixture','private','STATIC_SCAN','v1','INFERRED',0.99,'2026-10-01','2026-10-01','v1','{"secret":"not public"}',repeat('a',64));
 ${representation('a','object-a')}${support('a')}
 ${representation('b','object-b',{org:orgB})}${support('b',orgB,'foreign-evidence')}
`;
/** Only bootstrap fixtures bypass referential integrity. No product path receives this capability. */
export const corruptBegin=`BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL session_replication_role=replica;
 DROP RULE semantic_representations_no_update ON gov_repo.semantic_representations;
 DROP RULE semantic_representations_no_delete ON gov_repo.semantic_representations;
 DROP RULE semantic_representation_assertions_no_update ON gov_repo.semantic_representation_assertions;
 DROP RULE semantic_representation_evidence_no_update ON gov_repo.semantic_representation_evidence;
 DROP RULE semantic_representation_evidence_no_delete ON gov_repo.semantic_representation_evidence;
`;
