import {createHash,randomUUID} from 'node:crypto';
import {lit,orgA} from './semantic-retrieval-fixtures';
export {lit,orgA,orgB} from './semantic-retrieval-fixtures';
export const a1Migration='20261023212126_m175_c3_sr2_a1_typed_technical_foundation_v1.sql';
export type Row=Record<string,any>;
export type Stored={table:string;row:Row};
export const frame=(parts:any[])=>parts.map(x=>{if(x===null||x===undefined)throw Error('NULL identity');const s=String(x);return `${Buffer.byteLength(s,'utf8')}:${s}`;}).join('');
export const hash=(parts:any[])=>createHash('sha256').update(frame(parts),'utf8').digest('hex');
export const H=(tag:string,...parts:any[])=>hash(['GOVIA_SR2_'+tag+'_V1',...parts]);
export const optional=(x:any)=>x==null?['0','']:['1',String(x)];
export const list=(xs:string[])=>[xs.length,...xs];
export const keys=(x:Row)=>[x.organisation_id,x.repository_id,x.snapshot_id];
export const sqlValue=(x:any):string=>x===null?'NULL':Array.isArray(x)?`ARRAY[${x.map(lit).join(',')}]::text[]`:typeof x==='boolean'?(x?'true':'false'):typeof x==='number'?String(x):lit(x);
export const insert=({table,row}:Stored)=>`INSERT INTO gov_repo.sr2_${table}_v1 (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(sqlValue).join(',')});`;
export const inserts=(rows:Stored[])=>rows.map(insert).join('\n');
const at='2026-10-01T00:00:00Z';
export function repository(org=orgA,provider='repo-id',connection='sr2-'+randomUUID()){
 const row:Row={organisation_id:org,repository_id:'',connection_id:connection,source_system_id:'fixture-source',provider_code:'GIT',provider_instance_id:'fixture-host',provider_repository_id:provider,display_label:'Same display',verification_method:'PROVIDER_REPOSITORY_ID_VERIFIED_V1',verifier_version:'fixture-v1',verified_at:at,recorded_at:at};
 row.repository_id=H('ROOT',org,connection,row.source_system_id,row.provider_code,row.provider_instance_id,provider);
 return {row,sql:`INSERT INTO gov_repo.technical_source_connections VALUES(${lit(connection)},${lit(org)},'fixture-source','GIT','REPOSITORY','Same display');`+insert({table:'repositories',row})};
}
export function snapshot(root:Row,n=4,revision='1'.repeat(40),scheme='GIT_SHA1_V1',entryOverrides:Row={}){
 const k:Row={organisation_id:root.organisation_id,repository_id:root.repository_id,snapshot_id:''};
 const entries:Row[]=Array.from({length:n},(_,i)=>{
  const raw=createHash('sha256').update('same synthetic fixture bytes').digest('hex');
  const row:Row={...k,entry_id:'',relative_path:`src/f${String(i).padStart(2,'0')}.ts`,entry_kind:'REGULAR_FILE',payload_kind:'BLOB_BYTES_V1',provider_object_id:'a'.repeat(scheme==='GIT_SHA1_V1'?40:64),raw_sha256:raw,source_fingerprint:'',byte_length:100,encoding_id:'UTF8_STRICT_V1',line_count:10,...entryOverrides};
  row.source_fingerprint=H('SOURCE_BLOB',row.payload_kind,row.raw_sha256,row.byte_length);return row;
 });
 const fields=['relative_path','entry_kind','payload_kind','provider_object_id','source_fingerprint','byte_length','encoding_id','line_count'];
 const manifest=H('SOURCE_MANIFEST',scheme,revision,n,...entries.flatMap(e=>fields.map(f=>e[f])));
 k.snapshot_id=H('SNAPSHOT',k.organisation_id,k.repository_id,scheme,revision,manifest);
 const snap:Row={...k,revision_scheme:scheme,full_revision:revision,manifest_schema_version:'GOVIA_SOURCE_MANIFEST_V1',manifest_fingerprint:manifest,manifest_entry_count:n};
 for(const e of entries){Object.assign(e,k);e.entry_id=H('SOURCE_ENTRY',...keys(k),e.relative_path,e.entry_kind,e.provider_object_id,e.source_fingerprint,e.encoding_id,e.line_count);}
 const capture:Row={...k,capture_id:randomUUID(),method_code:'CAPTURE_AT_IMMUTABLE_REVISION_V1',method_version:'fixture-v1',observed_provider_instance_id:root.provider_instance_id,observed_provider_repository_id:root.provider_repository_id,resolved_revision_scheme:scheme,resolved_full_revision:revision,observed_manifest_fingerprint:manifest,observed_at:at,captured_at:at,recorded_at:at};
 const rootSubject=subject(k,'REPOSITORY_SNAPSHOT',manifest,null,manifest,null,null);
 const locators=entries.map(e=>chunk(e));const subjects=locators.map(l=>subject(k,'REPOSITORY_CHUNK',l.source_fingerprint,l.entry_id,null,l.locator_id,null));
 const rows:Stored[]=[{table:'snapshots',row:snap},...entries.map(row=>({table:'manifest_entries',row})),{table:'captures',row:capture},...locators.map(row=>({table:'chunk_locators',row})),{table:'subjects',row:rootSubject},...subjects.map(row=>({table:'subjects',row}))];
 return {k,snap,entries,capture,rootSubject,locators,subjects,rows};
}
export function subject(k:Row,family:string,fp:string,entry:any,manifest:any,chunkId:any,symbolId:any){
 const row:Row={...k,subject_id:H('SUBJECT',...keys(k),family,fp,...[entry,manifest,chunkId,symbolId].flatMap(optional)),subject_family:family,source_fingerprint:fp,entry_id:entry,snapshot_manifest_fingerprint:manifest,chunk_locator_id:chunkId,symbol_locator_id:symbolId};return row;
}
export function chunk(e:Row,kind='FILE_DESCRIPTOR'){
 const facts=Object.fromEntries(['organisation_id','repository_id','snapshot_id','entry_id','source_fingerprint','entry_kind','byte_length','encoding_id','line_count'].map(k=>[k,e[k]]));
 const region=kind!=='FILE_DESCRIPTOR';
 const row:Row={...facts,locator_id:'',locator_class:kind,byte_start:region?0:null,byte_end:region?20:null,line_start:region?1:null,line_end:region?2:null,decoding_id:region?'UTF8_STRICT_V1':'SOURCE_DESCRIPTOR_V1',chunker_id:region?'fixture-chunker':'FILE_DESCRIPTOR_V1',chunker_version:region?'fixture-v1':'1'};
 row.locator_id=H('CHUNK_LOCATOR',...keys(row),row.entry_id,row.source_fingerprint,kind,...['byte_start','byte_end','line_start','line_end'].flatMap(k=>optional(row[k])),row.decoding_id,row.chunker_id,row.chunker_version);return row;
}
export function symbol(e:Row){
 const row:Row={...Object.fromEntries(['organisation_id','repository_id','snapshot_id','entry_id','source_fingerprint','entry_kind','byte_length','encoding_id','line_count'].map(k=>[k,e[k]])),locator_id:'',language_id:'typescript',parser_id:'fixture-parser',parser_version:'fixture-v1',qualified_symbol_key:'module::start',byte_start:0,byte_end:20,line_start:1,line_end:2,decoding_id:'UTF8_STRICT_V1'};
 row.locator_id=H('SYMBOL_LOCATOR',...keys(row),row.entry_id,row.source_fingerprint,...['language_id','parser_id','parser_version','qualified_symbol_key','byte_start','byte_end','line_start','line_end','decoding_id'].map(k=>row[k]));return row;
}
export function admission(e:Row,c:Row,outcome='PROTECTED_ELIGIBLE',version='v2',evaluation=randomUUID()){
 const facts=['organisation_id','repository_id','snapshot_id','entry_id','source_fingerprint','entry_kind','byte_length','encoding_id','line_count'];
 const row:Row={...Object.fromEntries(facts.map(k=>[k,e[k]])),source_admission_id:'',evaluation_id:evaluation,capture_id:c.capture_id,capture_observed_at:c.observed_at,admission_recipe_id:'fixture-admission',admission_recipe_version:version,policy_profile_id:'fixture-policy',policy_profile_version:version,outcome,content_class:outcome==='REJECTED'?null:outcome==='METADATA_ONLY'?'METADATA_ONLY_V1':'PROTECTED_CONTEXT_V1',reason_code:outcome==='PROTECTED_ELIGIBLE'?'NONE':'POLICY_WITHHELD',protected_eligible:outcome==='PROTECTED_ELIGIBLE',admission_basis_fingerprint:'',evaluated_at:at,recorded_at:at};
 row.admission_basis_fingerprint=H('ADMISSION_BASIS',...keys(row),row.entry_id,...['admission_recipe_id','admission_recipe_version','policy_profile_id','policy_profile_version','outcome'].map(k=>row[k]),...optional(row.content_class),row.reason_code,row.protected_eligible?'1':'0');
 row.source_admission_id=H('SOURCE_ADMISSION',...keys(row),row.entry_id,evaluation,row.admission_basis_fingerprint);return row;
}
export function sourceSet(s:ReturnType<typeof snapshot>,members=s.subjects,kind='REPOSITORY_SELECTION_V1',anchor=s.rootSubject,scope='selection',coverage='DECLARED_SET_ONLY'){
 const selector:Record<string,string>={ITEM_GROUNDING_V1:'ITEM',PACKAGE_MEMBERS_V1:'PACKAGE',MODULE_MEMBERS_V1:'MODULE',SERVICE_MEMBERS_V1:'SERVICE',REPOSITORY_SELECTION_V1:'REPOSITORY'};
 const ordered=[...members].sort((a,b)=>a.subject_id.localeCompare(b.subject_id,'en'));
 const fp=H('SOURCE_SET_MEMBERS',members.length,...ordered.flatMap(m=>[m.subject_id,m.entry_id,m.source_fingerprint]));
 const row:Row={...s.k,source_set_id:'',manifest_fingerprint:s.snap.manifest_fingerprint,scope_kind:kind,anchor_subject_id:anchor.subject_id,scope_key:scope,selector_id:`GOVIA_${selector[kind]}_SOURCE_MANIFEST_V1`,selector_version:'fixture-v1',member_count:members.length,membership_fingerprint:fp,coverage,completeness:'COMPLETE_DECLARED_SET_V1',limitations:[]};
 row.source_set_id=H('SOURCE_SET',...keys(row),...['manifest_fingerprint','scope_kind','anchor_subject_id','scope_key','selector_id','selector_version','member_count','membership_fingerprint','coverage','completeness'].map(k=>row[k]),...list(row.limitations));
 const children=members.map(m=>({...s.k,source_set_id:row.source_set_id,source_subject_id:m.subject_id,entry_id:m.entry_id,source_fingerprint:m.source_fingerprint}));
 return {row,children,rows:[{table:'source_sets',row},...children.map(row=>({table:'source_set_members',row}))] as Stored[]};
}
export const facetKinds=['MODULE_DESCRIPTOR','SERVICE_DESCRIPTOR','DEPENDENCY_DESCRIPTOR','CONFIGURATION_DESCRIPTOR','TECHNICAL_SUMMARY','DOMAIN_OBSERVATION','AGENT_DESCRIPTOR','ENTRYPOINT_DESCRIPTOR'];
export const facetTables=['module_facets','service_facets','dependency_facets','configuration_facets','summary_facets','domain_facets','agent_facets','entrypoint_facets'];
const fieldOrder=[['module_key','module_kind','directory_label','module_name'],['service_key','service_name','service_kind','capabilities'],['ecosystem','dependency_name','resolution_key','dependency_role','observed_specification','resolved_version'],['configuration_key','value_type','safe_value_code'],['summary_text','coverage'],['domain_key','label','structural_description'],['descriptor_key','observed_role','behaviors'],['entrypoint_key','entrypoint_kind','safe_signature','invocation_shape']];
const natural=[['module_kind','module_key'],['service_kind','service_key'],['ecosystem','dependency_name','dependency_role','resolution_key'],['configuration_key'],['grounding_set_id'],['domain_key'],['descriptor_key'],['entrypoint_kind','entrypoint_key']];
export function facet(k:Row,target:Row,set:Row,type:number,id='a',overrides:Row={}){
 const payloads=[{module_key:id,module_kind:'PACKAGE',directory_label:'.',module_name:'Module '+id},{service_key:id,service_name:'Service '+id,service_kind:'API',capabilities:[]},{ecosystem:'NPM',dependency_name:id,resolution_key:'manifest:'+id,dependency_role:'RUNTIME',observed_specification:'^1.0.0',resolved_version:null},{configuration_key:id,value_type:'BOOLEAN',safe_value_code:'OPTIONAL'},{summary_text:'Summary '+id,coverage:'COMPLETE_DECLARED_SOURCE_SET_V1'},{domain_key:id,label:'Domain '+id,structural_description:'Observed structure'},{descriptor_key:id,observed_role:'Assistant',behaviors:[]},{entrypoint_key:id,entrypoint_kind:'FUNCTION',safe_signature:id+'()',invocation_shape:[]}];
 const row:Row={...k,subject_id:target.subject_id,projection_id:'',item_key:'',facet_kind:facetKinds[type],grounding_set_id:set.source_set_id,scope_kind:set.scope_kind,anchor_subject_id:set.anchor_subject_id,method_code:type===4?'STRUCTURAL_SUMMARY':type===2?'MANIFEST_OBSERVED':'PARSED',method_version:'fixture-v1',limitations:[],payload_fingerprint:'',...payloads[type],...overrides};
 row.item_key=H('FACET_ITEM',...keys(row),row.subject_id,row.facet_kind,row.anchor_subject_id,...natural[type].map(k=>row[k]));
 row.payload_fingerprint=H('FACET_PAYLOAD',row.facet_kind,row.item_key,row.grounding_set_id,row.scope_kind,row.anchor_subject_id,row.method_code,row.method_version,...list(row.limitations),...fieldOrder[type].flatMap(k=>Array.isArray(row[k])?list(row[k]):['observed_specification','resolved_version','safe_signature'].includes(k)?optional(row[k]):[row[k]]));return {table:facetTables[type],row};
}
export function projection(s:ReturnType<typeof snapshot>,set:Row,admissions:Row[],items:Stored[]=[],options:{target?:Row;label?:string;description?:string;empty?:number[];fragments?:Row[];metadata?:boolean;summary?:string}={}){
 const target=options.target??s.rootSubject;const c=options.metadata?'METADATA_ONLY_V1':'PROTECTED_CONTEXT_V1';
 const ordered=[...admissions].sort((a,b)=>a.entry_id<b.entry_id?-1:1);
 const row:Row={...s.k,subject_id:target.subject_id,projection_id:'',source_fingerprint:target.source_fingerprint,primary_source_set_id:set.source_set_id,projection_schema_version:'fixture-technical-v1',document_recipe:'GOVIA_TECHNICAL_CONTEXT_V1',record_contract:'GOVIA_SR2_TYPED_PROJECTION_RECORD_V1',extraction_recipe_id:'fixture-extractor',extraction_recipe_version:'v1',handling_recipe_id:'fixture-handler',handling_recipe_version:'v2',content_class:c,safe_label:options.label??'Technical structure',safe_description:options.description??'Synthetic local fixture',admission_basis_set_fingerprint:H('ADMISSION_BASES',ordered.length,...ordered.flatMap(a=>[a.entry_id,a.admission_basis_fingerprint])),admission_record_set_fingerprint:H('ADMISSION_RECORDS',ordered.length,...ordered.flatMap(a=>[a.entry_id,a.source_admission_id,a.admission_basis_fingerprint,a.outcome])),projection_fingerprint:'',admitted_at:at,recorded_at:at,authority:'DERIVED_ANALYTICAL_NON_AUTHORITATIVE',derivation:'SEMANTIC_MATCH',canonical_decision:false,governed_relationships:false,assurance:false};
 const protectedRow:Row={...s.k,subject_id:target.subject_id,projection_id:'',content_class:c,structural_summary:options.summary??'Reconstructed structure',literal_handling:'REMOVED_OR_TYPED_V1',projection_mark:'CONTENT_PROJECTED',untrusted_source:true};
 const collections:Stored[]=[];const content:any[]=['record_contract','projection_schema_version','document_recipe','extraction_recipe_id','extraction_recipe_version','handling_recipe_id','handling_recipe_version','content_class','primary_source_set_id','admission_basis_set_fingerprint','safe_label','safe_description'].map(k=>row[k]);
 content.push(...(options.metadata?['0']:['1',protectedRow.structural_summary,protectedRow.literal_handling,protectedRow.projection_mark,'1']));
 for(let i=0;i<8;i++){
  const selected=items.filter(it=>it.row.facet_kind===facetKinds[i]).sort((a,b)=>a.row.item_key<b.row.item_key?-1:1);
  if(!selected.length&&!options.empty?.includes(i)){content.push('0');continue;}
  const fp=H('FACET_COLLECTION',facetKinds[i],selected.length,...selected.flatMap(x=>[x.row.item_key,x.row.payload_fingerprint]));
  collections.push({table:'facet_collections',row:{...s.k,subject_id:target.subject_id,projection_id:'',facet_kind:facetKinds[i],expected_item_count:selected.length,collection_fingerprint:fp}});content.push('1',selected.length,fp);
 }
 const fragments=(options.fragments??[]).map((f,i)=>({table:'fragments',row:{...s.k,subject_id:target.subject_id,projection_id:'',ordinal:i+1,fragment_kind:'STRUCTURAL_STATEMENT',source_subject_id:s.subjects[0].subject_id,projected_text:'Reconstructed call',projection_mark:'CONTENT_PROJECTED',untrusted_source:true,...f}}));
 for(const {row:f} of fragments)content.push(f.ordinal,f.fragment_kind,f.source_subject_id,f.projected_text,f.projection_mark,'1');
 row.projection_fingerprint=H('PROJECTION_CONTENT',...content);row.projection_id=H('PROJECTION',...keys(row),row.subject_id,row.projection_schema_version,row.projection_fingerprint);
 const sources=ordered.map(a=>({table:'projection_sources',row:{...s.k,subject_id:target.subject_id,projection_id:'',entry_id:a.entry_id,content_class:c,source_admission_id:a.source_admission_id,admission_basis_fingerprint:a.admission_basis_fingerprint,outcome:a.outcome}}));
 const rows:Stored[]=[{table:'projections',row},...(!options.metadata?[{table:'protected_projections',row:protectedRow}]:[]),...sources,...collections,...items.map(it=>({table:it.table,row:{...it.row}})),...fragments];
 for(const r of rows)r.row.projection_id=row.projection_id;return {row,rows,collections,items};
}
export function representation(p:Row,capture:Row,overrides:Row={}){
 const row:Row={...Object.fromEntries(['organisation_id','repository_id','snapshot_id','subject_id','projection_id','projection_schema_version','projection_fingerprint','content_class'].map(k=>[k,p[k]])),representation_id:'',projection_admitted_at:p.admitted_at,provider_id:'fixture',model_id:'fixture-model',model_version:'exact-fixture-v1',dimension:3,embedding:'[1,0,0]',capture_id:capture.capture_id,capture_observed_at:capture.observed_at,generated_at:at,indexed_at:at,recorded_at:at,...overrides};
 row.representation_id=H('REPRESENTATION',...keys(row),row.subject_id,row.projection_id,row.projection_schema_version,row.projection_fingerprint,row.provider_id,row.model_id,row.model_version,row.dimension);return {table:'representations',row};
}
