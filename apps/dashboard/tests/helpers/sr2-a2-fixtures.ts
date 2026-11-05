import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { semanticCluster, type Actor } from './semantic-retrieval-fixtures';
import { ledgerRepo } from './ledger-v2-foundation-fixtures';
import { a1Migration, repository, snapshot, sourceSet, admission, projection, representation, H, inserts, insert, lit, orgA,
  facet, facetKinds, facetTables, keys, type Row, type Stored } from './sr2-a1-fixtures';
export * from './sr2-a1-fixtures';
export const a2Migration='20261024001741_m175_c3_sr2_a2_principal_bound_technical_read_v1.sql';
export const technicalSpace=Object.freeze({projection_schema_version:'fixture-technical-v1',provider_id:'fixture',model_id:'fixture-model',model_version:'exact-fixture-v1',dimension:3});
export const a2Source=()=>readFileSync(join(ledgerRepo,'supabase/migrations',a2Migration),'utf8');
export const a2CatalogQuery=`WITH extension_schema AS (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'),
 new_tables AS (SELECT c.oid FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname IN ('sr2_disclosure_profiles_v1','sr2_disclosure_profile_heads_v1','sr2_source_admission_heads_v1'))
 SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,'comment',obj_description(c.oid,'pg_class')) ORDER BY c.relname) FROM pg_class c WHERE c.oid IN (SELECT oid FROM new_tables)),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid),'deferred',c.condeferrable) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM new_tables)),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',a.atthasdef,'collation',co.collname) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_collation co ON co.oid=a.attcollation WHERE c.oid IN (SELECT oid FROM new_tables) AND a.attnum>0 AND NOT a.attisdropped),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(c.oid),'access_method',am.amname) ORDER BY c.relname) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid IN (SELECT oid FROM new_tables) OR c.oid=to_regclass('gov_repo.sr2_representations_v1_exact_space_read_idx')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM new_tables) AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',replace(p.oid::regprocedure::text,CASE WHEN es.nspname='public' THEN ',vector,' ELSE ','||quote_ident(es.nspname)||'.vector,' END,',__vector__.vector,'),'arguments',replace(replace(pg_get_function_identity_arguments(p.oid),quote_ident(es.nspname)||'.vector','__vector__.vector'),'p_query vector','p_query __vector__.vector'),'owner',pg_get_userbyid(p.proowner),'result',pg_get_function_result(p.oid),'body_sha256',encode(sha256(convert_to(replace(replace(p.prosrc,chr(13),''),quote_ident(es.nspname)||'.','__vector__.'),'UTF8')),'hex'),'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'defaults',p.pronargdefaults,'language',l.lanname) ORDER BY p.proname) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang CROSS JOIN extension_schema es WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname IN ('sr2_disclosure_head_guard_v1','technical_semantic_context_search_v1'))
 )::text`;
export async function technicalCluster(diagnostic:(message:string)=>void){
 const pg=await semanticCluster(diagnostic);
 try{
  await pg.owner(readFileSync(join(ledgerRepo,'supabase/migrations',a1Migration),'utf8'));
  const routines=()=>pg.owner(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`);
  const before=JSON.parse(await routines()); assert.equal(before.length,436);
  await pg.owner(a2Source()+'\nCOMMIT;');
  const after=JSON.parse(await routines());assert.equal(after.length,438);
  assert.deepEqual(after.filter((p:any)=>before.some((b:any)=>b.oid===p.oid)),before);
  // A2 owns the history through its migration only; additive successors must not rewrite this historical fixture.
  const canonical=readdirSync(join(ledgerRepo,'supabase/migrations')).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)&&n<=a2Migration).sort();
  assert.equal(canonical.length,105);assert.equal(canonical.at(-1),a2Migration);
  diagnostic('Empty canonical 105-file replay PASS; real non-extension catalog 436 -> 438');
  return pg;
 }catch(error){pg.stop();throw error;}
}
export function disclosureProfile(root:Row,p:Row,overrides:Row={}){
 const row:Row={organisation_id:root.organisation_id,repository_id:root.repository_id,purpose_code:'TECHNICAL_CONTEXT_HYDRATION_V1',
  disclosure_profile_id:'fixture-disclosure',disclosure_profile_version:'v1',admission_recipe_id:'fixture-admission',admission_recipe_version:'v2',
  policy_profile_id:'fixture-policy',policy_profile_version:'v2',handling_recipe_id:p.handling_recipe_id,handling_recipe_version:p.handling_recipe_version,
  required_projection_schema_version:p.projection_schema_version,document_recipe:'GOVIA_TECHNICAL_CONTEXT_V1',profile_fingerprint:'',recorded_at:'2026-10-01T00:00:00Z',...overrides};
 row.profile_fingerprint=H('DISCLOSURE_PROFILE',...['organisation_id','repository_id','purpose_code','disclosure_profile_id','disclosure_profile_version','admission_recipe_id','admission_recipe_version','policy_profile_id','policy_profile_version','handling_recipe_id','handling_recipe_version','required_projection_schema_version','document_recipe'].map(k=>row[k]));
 return row;
}
export function technicalFixture(options:{org?:string;count?:number;facets?:boolean;label?:string;scheme?:'GIT_SHA1_V1'|'GIT_SHA256_V1';entryOverrides?:Row;dimension?:number;embedding?:number[]}={}){
 const scheme=options.scheme??'GIT_SHA1_V1';
 const root=repository(options.org??orgA),s=snapshot(root.row,options.count??1,scheme==='GIT_SHA1_V1'?'1'.repeat(40):'3'.repeat(64),scheme,options.entryOverrides??{}),admissions=s.entries.map(e=>admission(e,s.capture));
 const primary=sourceSet(s),ground=sourceSet(s,[s.subjects[0]],'ITEM_GROUNDING_V1',s.subjects[0]);
 const items=options.facets?facetTables.flatMap((_,i)=>i===4?[facet(s.k,s.rootSubject,primary.row,i)]:[facet(s.k,s.rootSubject,ground.row,i,'a'),facet(s.k,s.rootSubject,ground.row,i,'b')]):[];
 const p=projection(s,primary.row,admissions,items,{label:options.label,fragments:[{}]});
 const dimension=options.dimension??3;
 const rep=representation(p.row,s.capture,{dimension,embedding:JSON.stringify(options.embedding??Array.from({length:dimension},(_,i)=>i===0?1:0))}),profile=disclosureProfile(root.row,p.row);
 const profileHead:Row={organisation_id:root.row.organisation_id,repository_id:root.row.repository_id,purpose_code:profile.purpose_code,
  disclosure_profile_id:profile.disclosure_profile_id,disclosure_profile_version:profile.disclosure_profile_version,enabled:true,head_revision:1};
 const heads=admissions.map(a=>({...s.k,entry_id:a.entry_id,purpose_code:profile.purpose_code,source_admission_id:a.source_admission_id,enabled:true,head_revision:1}));
 const sets=options.facets?[primary,ground]:[primary];
 const rows:Stored[]=[...s.rows,...admissions.map(row=>({table:'source_admissions',row})),...sets.flatMap(z=>z.rows),...p.rows,rep,
  {table:'disclosure_profiles',row:profile},{table:'disclosure_profile_heads',row:profileHead},...heads.map(row=>({table:'source_admission_heads',row}))];
 return {root,s,admissions,primary,ground,sets,items,p,rep,profile,profileHead,heads,rows,sql:'BEGIN;'+root.sql+inserts(rows)+'COMMIT;'};
}
export function technicalRpc(a:Actor,f:ReturnType<typeof technicalFixture>,overrides:Record<string,string>={}){
 const now='floor(extract(epoch FROM clock_timestamp()))::bigint';
 const args={p_verified_organisation_id:lit(a.org),p_verified_actor_user_id:lit(a.id),p_verified_session_iat:now+'-10',p_verified_session_exp:now+'+3600',
  p_verified_credential_epoch:lit(a.epoch),p_repository_id:lit(f.root.row.repository_id),p_snapshot_id:lit(f.s.snap.snapshot_id),p_query:lit(JSON.stringify(Array.from({length:Number(f.rep.row.dimension)},(_,i)=>i===0?1:0))),
  p_provider:lit(technicalSpace.provider_id),p_model:lit(technicalSpace.model_id),p_version:lit(technicalSpace.model_version),p_dimension:String(f.rep.row.dimension),
  p_schema:lit(technicalSpace.projection_schema_version),p_query_recipe:"'TECHNICAL_CONTEXT_QUERY_V1'",p_limit:'20',p_threshold:'-1',...overrides};
 return `gov_repo.technical_semantic_context_search_v1(${Object.entries(args).map(([k,v])=>`${k}=>${v}`).join(',')})`;
}
export const scopedRead=(call:string)=>`BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL statement_timeout='5s'; SELECT ${call}; COMMIT;`;
/** Fixture-only resealing of a facet/fragment-free native A1 projection. */
export function plainProjection(s:ReturnType<typeof snapshot>,set:Row,admissions:Row[],overrides:Row={}){
 const p=projection(s,set,admissions);Object.assign(p.row,overrides);const b=p.rows.find(x=>x.table==='protected_projections')!.row;
 p.row.projection_fingerprint=H('PROJECTION_CONTENT',...['record_contract','projection_schema_version','document_recipe','extraction_recipe_id','extraction_recipe_version','handling_recipe_id','handling_recipe_version','content_class','primary_source_set_id','admission_basis_set_fingerprint','safe_label','safe_description'].map(k=>p.row[k]),
  '1',b.structural_summary,b.literal_handling,b.projection_mark,'1',...Array(8).fill('0'));
 p.row.projection_id=H('PROJECTION',...keys(p.row),p.row.subject_id,p.row.projection_schema_version,p.row.projection_fingerprint);
 for(const stored of p.rows){stored.row.projection_id=p.row.projection_id;stored.row.subject_id=p.row.subject_id;}
 return p;
}
const stamp=(s:string)=>new Date(s).toISOString().replace(/\.\d{3}Z$/,'.000000Z');
const rec=(r:Row,p:string)=>({id:r[p+'_id'],version:r[p+'_version']});
export function technicalDto(f:ReturnType<typeof technicalFixture>){
 const {s,p,profile:d,rep}=f;
 const scope={...Object.fromEntries(['repository_id','snapshot_id','revision_scheme','full_revision','manifest_fingerprint'].map(k=>[k,s.snap[k]])),manifest_entry_count:String(s.snap.manifest_entry_count)};
 const subject=(row:Row)=>({family:row.subject_family,id:row.subject_id,source_fingerprint:row.source_fingerprint,locator:row.subject_family==='REPOSITORY_SNAPSHOT'?
  {kind:'SNAPSHOT_MANIFEST',manifest_fingerprint:s.snap.manifest_fingerprint}:(()=>{const l=s.locators.find(l=>l.locator_id===row.chunk_locator_id)!;const e=s.entries.find(e=>e.entry_id===row.entry_id)!;
   return {kind:'FILE_DESCRIPTOR',locator_id:l.locator_id,entry_id:e.entry_id,relative_path:e.relative_path,source_fingerprint:e.source_fingerprint,decoding_id:'SOURCE_DESCRIPTOR_V1',chunker:rec(l,'chunker')};})()});
 const adm=(a:Row)=>({...Object.fromEntries(['source_admission_id','evaluation_id','admission_basis_fingerprint','capture_id','outcome','content_class','reason_code','protected_eligible'].map(k=>[k,a[k]])),capture_observed_at:stamp(a.capture_observed_at),admission_recipe:rec(a,'admission_recipe'),policy_profile:rec(a,'policy_profile'),evaluated_at:stamp(a.evaluated_at),recorded_at:stamp(a.recorded_at)});
 const facets=Object.fromEntries(['modules','services','dependencies','configurations','summary','domains','agents','entrypoints'].map((name,i)=>{
  const c=p.collections.find(c=>c.row.facet_kind===facetKinds[i]);if(!c)return [name,null];
  const items=p.items.filter(it=>it.row.facet_kind===facetKinds[i]).map(it=>{
   const a=it.row;const payload=Object.fromEntries(Object.entries(a).filter(([k])=>!['organisation_id','repository_id','snapshot_id','subject_id','projection_id','facet_kind','method_code','method_version','limitations'].includes(k)));
   return {...payload,kind:a.facet_kind,method:{code:a.method_code,version:a.method_version,limitations:[...a.limitations]}};
  }).sort((a:any,b:any)=>a.item_key<b.item_key?-1:1);return [name,{collection_fingerprint:c.row.collection_fingerprint,items}];
 }));
 const projection={...Object.fromEntries(['projection_id','projection_fingerprint','source_fingerprint','projection_schema_version','document_recipe','record_contract','content_class','safe_label','safe_description','primary_source_set_id','admission_basis_set_fingerprint','admission_record_set_fingerprint'].map(k=>[k,p.row[k]])),extraction_recipe:rec(p.row,'extraction_recipe'),handling_recipe:rec(p.row,'handling_recipe'),admitted_at:stamp(p.row.admitted_at),recorded_at:stamp(p.row.recorded_at),
  protected:{structural_summary:p.rows.find(x=>x.table==='protected_projections')!.row.structural_summary,literal_handling:'REMOVED_OR_TYPED_V1',projection_mark:'CONTENT_PROJECTED',untrusted_source:true,fragments:p.rows.filter(x=>x.table==='fragments').map(({row:a})=>({ordinal:a.ordinal,kind:a.fragment_kind,source_subject_id:a.source_subject_id,projected_text:a.projected_text,projection_mark:a.projection_mark,untrusted_source:a.untrusted_source})),facets}};
 const hit={source:'REPOSITORY_TECHNICAL_CONTEXT',authority:'DERIVED_ANALYTICAL_NON_AUTHORITATIVE',derivation:'SEMANTIC_MATCH',canonical_decision:false,governed_relationships:false,assurance:false,representation_id:rep.row.representation_id,
  repository:{repository_id:f.root.row.repository_id,safe_label:f.root.row.display_label},snapshot:scope,subject:subject(s.rootSubject),projection,embedding_space:{...technicalSpace},
  representation_provenance:{capture_id:s.capture.capture_id,capture_observed_at:stamp(s.capture.observed_at),generated_at:stamp(rep.row.generated_at),indexed_at:stamp(rep.row.indexed_at),recorded_at:stamp(rep.row.recorded_at)},
  disclosure:{purpose:d.purpose_code,profile_id:d.disclosure_profile_id,profile_version:d.disclosure_profile_version,profile_fingerprint:d.profile_fingerprint,profile_recorded_at:stamp(d.recorded_at),profile_head_revision:'1',admission_recipe:rec(d,'admission_recipe'),policy_profile:rec(d,'policy_profile'),handling_recipe:rec(d,'handling_recipe'),required_projection_schema_version:d.required_projection_schema_version,document_recipe:d.document_recipe},
  support:{source_subjects:s.subjects.map(subject).sort((a,b)=>a.id<b.id?-1:1),entries:s.entries.map(e=>Object.fromEntries(['entry_id','relative_path','entry_kind','payload_kind','provider_object_id','raw_sha256','source_fingerprint','byte_length','encoding_id','line_count'].map(k=>[k,e[k]]))).sort((a,b)=>a.entry_id<b.entry_id?-1:1),
   source_sets:f.sets.map(z=>({...Object.fromEntries(['source_set_id','manifest_fingerprint','scope_kind','anchor_subject_id','scope_key','member_count','membership_fingerprint','coverage','completeness','limitations'].map(k=>[k,z.row[k]])),selector:rec(z.row,'selector'),member_subject_ids:z.children.map(m=>m.source_subject_id).sort()})).sort((a:any,b:any)=>a.source_set_id<b.source_set_id?-1:1),
   admissions:f.admissions.map(a=>({entry_id:a.entry_id,historical:adm(a),current:adm(a),current_head_revision:'1'})).sort((a,b)=>a.entry_id<b.entry_id?-1:1),
   captures:[{capture_id:s.capture.capture_id,method:{code:s.capture.method_code,version:s.capture.method_version},observed_at:stamp(s.capture.observed_at),captured_at:stamp(s.capture.captured_at),recorded_at:stamp(s.capture.recorded_at)}]},
  currentness:{state:'HISTORICAL_AT_REQUESTED_REVISION',checked_at:stamp(s.capture.observed_at),comparison_target:null},retrieval_relevance:{kind:'RETRIEVAL_RANK_ONLY',rank:1,policy_version:'EXACT_COSINE_V1'},
  limitations:['NO_GOVERNANCE_CONCLUSION','BOUNDED_RECORDED_COVERAGE_ONLY','NO_LIVE_SOURCE_FETCH','NO_LIVE_REVISION_COMPARISON','CURRENT_DISCLOSURE_IS_NOT_EGRESS_AUTHORIZATION','UNTRUSTED_SOURCE_DATA']};
 return {contract_version:'GOVIA_SR2_TECHNICAL_CONTEXT_READ_V1',observed_at:new Date().toISOString().replace(/\.\d{3}Z$/,'.000000Z'),embedding_space:{...technicalSpace},scope,algorithm:'EXACT_COSINE_V1',selection_policy:'EXACT_SNAPSHOT_LATEST_PROJECTION_IN_SPACE_V1',authorization_semantics:'AUTHORIZATION_AS_OF_HYDRATION_SNAPSHOT',coverage:'BOUNDED_RECORDED_REPRESENTATIONS_AT_EXACT_SNAPSHOT',status:'SEMANTIC_CONTEXT_AVAILABLE',reason:null,hits:[hit]};
}
