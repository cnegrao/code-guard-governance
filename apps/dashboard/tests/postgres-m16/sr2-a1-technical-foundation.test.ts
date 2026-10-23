import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {semanticCluster,fixture,rpc,bounded} from '../helpers/semantic-retrieval-fixtures';
import {ledgerRepo} from '../helpers/ledger-v2-foundation-fixtures';
import {a1Migration,repository,snapshot,sourceSet,admission,facet,projection,representation,chunk,symbol,subject,H,hash,frame,keys,inserts,insert,lit,orgA,orgB,facetTables,type Stored,type Row} from '../helpers/sr2-a1-fixtures';

const catalogQuery=`SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relkind='r' AND c.relname LIKE 'sr2_%'),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname) FROM pg_constraint c WHERE c.connamespace='gov_repo'::regnamespace AND c.conname LIKE 'sr2_%'),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(c.oid)) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='gov_repo'::regnamespace AND c.relkind='i' AND c.relname LIKE 'sr2_%'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'result',pg_get_function_result(p.oid),'body_sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),'config',p.proconfig,'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'language',l.lanname) ORDER BY p.proname) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%')
)::text`;
test('SR2-A1 real PG17 + pgvector: additive technical identities, assembly, containment',{timeout:900000},async t=>{
 const testCase=async(label:string,body:()=>Promise<void>)=>{let failure:unknown;await t.test(label,async()=>{try{await body();}catch(e){failure=e;throw e;}});if(failure)throw failure;};
 const pg=await semanticCluster(m=>t.diagnostic(m));t.after(()=>pg.stop());const {owner}=pg;
 const source=readFileSync(join(ledgerRepo,'supabase/migrations',a1Migration),'utf8');
 const priorQuery=`SELECT jsonb_build_object('routines',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='gov_repo'::regnamespace AND proname NOT LIKE 'sr2_%'),
 'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE relnamespace='gov_repo'::regnamespace AND relname NOT LIKE 'sr2_%'),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m))::text`;
 const prior=await owner(priorQuery);
 await owner(source);
 // Physical planner counters can change from reads; security/schema/old routine rows cannot.
 const after=await owner(priorQuery);assert.equal(after,prior,'all prior routine/table/default/member catalog rows unchanged');
 const canonical=readdirSync(join(ledgerRepo,'supabase/migrations')).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort();
 assert.equal(canonical.length,104);assert.equal(canonical.at(-1),a1Migration);t.diagnostic('Canonical replay from empty: 103 prior + A1 = 104; PG17.11 / pgvector 0.8.7');
 const catalog=JSON.parse(await owner(catalogQuery));
 const counts={tables:catalog.tables.length,indexes:catalog.indexes.length,checks:catalog.constraints.filter((c:any)=>c.type==='c').length,fks:catalog.constraints.filter((c:any)=>c.type==='f').length,uniques:catalog.constraints.filter((c:any)=>c.type==='u').length,functions:catalog.functions.length,triggers:catalog.triggers.length};
 assert.deepEqual(counts,{tables:24,indexes:37,checks:74,fks:42,uniques:13,functions:11,triggers:59});
 const pinPath=join(ledgerRepo,'apps/dashboard/tests/fixtures/sr2-a1-catalog-v1.json');
 assert.deepEqual(catalog,JSON.parse(readFileSync(pinPath,'utf8')),'exact body/config/ACL/constraint/index/trigger pins');
 await testCase('catalog: private invokers, ALWAYS triggers, singular reduction, no policies/application surfaces',async()=>{
  assert.ok(catalog.tables.every((x:any)=>x.owner==='postgres'&&x.rls));
  assert.ok(catalog.triggers.every((x:any)=>x.enabled==='A'));
  assert.equal(catalog.triggers.filter((x:any)=>x.name.startsWith('sr2_summary_facets_v1_')).length,1);
  assert.equal(await owner("SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%'"),'0');
  assert.ok(catalog.functions.every((x:any)=>x.owner==='postgres'&&!x.definer&&!x.strict&&!x.leakproof&&x.language==='plpgsql'&&JSON.stringify(x.config)===JSON.stringify(['search_path=pg_catalog, pg_temp'])));
  for(const f of catalog.functions){assert.equal(f.volatility,f.identity.includes('list_valid')?'i':'v');assert.equal(f.parallel,f.identity.includes('list_valid')?'s':'u');}
  assert.equal(await owner(`SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname LIKE 'sr2_%' AND c.relkind='r' AND a.grantee<>c.relowner`),'0');
  assert.equal(await owner(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%' AND a.grantee<>p.proowner`),'0');
  for(const role of ['anon','authenticated','service_role']){
   for(const table of catalog.tables)await assert.rejects(pg.sql(`SELECT * FROM gov_repo.${table.name}`,role as any),/42501/);
   await assert.rejects(pg.sql('SELECT gov_repo.sr2_list_valid_v1(ARRAY[]::text[],20)',role as any),/42501/);
   assert.equal(await owner(`SELECT count(*) FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%' AND has_function_privilege(${lit(role)},p.oid,'EXECUTE')`),'0');
  }
  await assert.rejects(owner(source),/SR2_A1_OBJECT_CONFLICT/);
 });
 await pg.bootstrapSql(`BEGIN; SET LOCAL session_replication_role=replica; ${fixture} COMMIT;`);
 const r=repository(),rB=repository(orgB),rOther=repository(orgA,'other-provider-repository');
 await owner(r.sql+rB.sql+rOther.sql);
 const s=snapshot(r.row,25),sB=snapshot(rB.row,4),sOther=snapshot(rOther.row,4),sRev=snapshot(r.row,4,'2'.repeat(40)),s256=snapshot(r.row,1,'3'.repeat(64),'GIT_SHA256_V1'),sEmpty=snapshot(r.row,0,'4'.repeat(40));
 for(const v of [s,sB,sOther,sRev,s256,sEmpty])await owner('BEGIN;'+inserts(v.rows)+'COMMIT;');
 const admissions=s.entries.map(e=>admission(e,s.capture));await owner(inserts(admissions.map(row=>({table:'source_admissions',row}))));
 const primary=sourceSet(s,s.subjects.slice(0,4));const grounding=sourceSet(s,[s.subjects[0]],'ITEM_GROUNDING_V1',s.subjects[0]);const packageSet=sourceSet(s,s.subjects.slice(0,2),'PACKAGE_MEMBERS_V1',s.subjects[0],'pkg');
 await owner('BEGIN;'+inserts([...primary.rows,...grounding.rows,...packageSet.rows])+'COMMIT;');
 const valid=async(rows:Stored[])=>owner('BEGIN;'+inserts(rows)+'SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;');
 const bad=async(rows:Stored[],reason:RegExp)=>assert.rejects(owner('BEGIN;'+inserts(rows)+'COMMIT;'),reason);
 const baseItems=facetTables.flatMap((_,i)=>i===4?[facet(s.k,s.rootSubject,packageSet.row,i)]:[facet(s.k,s.rootSubject,grounding.row,i,'a'),facet(s.k,s.rootSubject,grounding.row,i,'b')]);
 const full=projection(s,primary.row,admissions.slice(0,4),baseItems,{fragments:[{}]});
 await testCase('all seven plural families coexist with two items, one summary, exact synthetic vector spaces',async()=>{
  await valid([...full.rows,representation(full.row,s.capture),representation(full.row,s.capture,{model_version:'exact-fixture-v2'})]);
  await owner('BEGIN;'+inserts(full.rows)+'COMMIT;');
  for(const n of facetTables)assert.equal(await owner(`SELECT count(*) FROM gov_repo.sr2_${n}_v1 WHERE projection_id=${lit(full.row.projection_id)}`),n==='summary_facets'?'1':'2');
 });
 await testCase('framing is byte length, not delimiters; all facet/set/projection hashes ignore insertion order',async()=>{
  assert.equal(frame(['é','a:b']), '2:é3:a:b');assert.notEqual(hash(['a','b:c']),hash(['a:b','c']));
  const reversed=sourceSet(s,[...primary.children].reverse().map(m=>s.subjects.find(x=>x.subject_id===m.source_subject_id)!));assert.equal(reversed.row.source_set_id,primary.row.source_set_id);
  const other=projection(s,primary.row,[...admissions.slice(0,4)].reverse(),[...baseItems].reverse(),{fragments:[{}]});assert.equal(other.row.projection_id,full.row.projection_id);
  const alternate=projection(s,primary.row,admissions.slice(0,4),baseItems,{label:'reverse assembly',fragments:[{}]});
  await valid([...alternate.rows].reverse());
 });
 await testCase('source identity spans tenants, providers, paths and revisions without blob collapse',async()=>{
  assert.equal(s.entries[0].source_fingerprint,s.entries[1].source_fingerprint);assert.notEqual(s.entries[0].entry_id,s.entries[1].entry_id);
  for(const v of [sB,sOther,sRev]){assert.notEqual(v.snap.snapshot_id,s.snap.snapshot_id);assert.notEqual(v.entries[0].entry_id,s.entries[0].entry_id);assert.notEqual(v.subjects[0].subject_id,s.subjects[0].subject_id);}
  assert.equal(s.snap.full_revision,'1'.repeat(40));assert.notEqual(r.row.repository_id,rOther.row.repository_id);
  for(const revision of ['main','HEAD','abcd','0'.repeat(40),'A'.repeat(40)])await bad([{table:'snapshots',row:{...s.snap,snapshot_id:H('SNAPSHOT',orgA,r.row.repository_id,'GIT_SHA1_V1',revision,s.snap.manifest_fingerprint),full_revision:revision}}],/sr2_snapshots_v1_c1/);
 });
 await testCase('manifest count/hash/OID and closed source facts reject missing/extra/false records',async()=>{
  const fresh=snapshot(r.row,2,'5'.repeat(40));await bad(fresh.rows.filter(x=>x.table==='snapshots'),/SR2_MANIFEST_COUNT/);
  const altered=structuredClone(fresh.rows);altered.find(x=>x.table==='snapshots')!.row.manifest_fingerprint='f'.repeat(64);await bad(altered,/23514/);
  await bad([{table:'chunk_locators',row:{...s.locators[0],locator_id:'f'.repeat(64),byte_length:99}}],/23514|23503/);
  const unexpected=snapshot(r.row,1,'6'.repeat(40));unexpected.rows.find(x=>x.table==='manifest_entries')!.row.encoding_id='UTF16';await bad(unexpected.rows,/sr2_manifest_entries_v1_c2/);
 });
 await testCase('admission V1 withheld -> V2 admitted; independent source IDs, sealed events and semantic replay',async()=>{
  const e=s.entries[0],a1=admission(e,s.capture,'METADATA_ONLY','v1'),a2=admission(e,s.capture),a3=admission(e,s.capture),rejected=admission(e,s.capture,'REJECTED');
  await owner(inserts([a1,a2,a3,rejected].map(row=>({table:'source_admissions',row}))));
  assert.notEqual(a1.source_admission_id,a2.source_admission_id);assert.equal(a2.admission_basis_fingerprint,a3.admission_basis_fingerprint);assert.notEqual(a2.source_admission_id,a3.source_admission_id);
  const meta=projection(s,grounding.row,[a1],[],{metadata:true}),protectedP=projection(s,grounding.row,[a2]),replay=projection(s,grounding.row,[a3]);
  assert.notEqual(meta.row.projection_id,protectedP.row.projection_id);assert.equal(protectedP.row.projection_id,replay.row.projection_id);assert.notEqual(protectedP.row.admission_record_set_fingerprint,replay.row.admission_record_set_fingerprint);
  await valid(meta.rows);await valid(protectedP.rows);await owner('BEGIN;'+inserts(protectedP.rows)+'COMMIT;');
  await bad(replay.rows,/23505/);await bad(projection(s,grounding.row,[a1]).rows,/sr2_projection_sources_v1_c1/);await bad(projection(s,grounding.row,[rejected]).rows,/sr2_projection_sources_v1_c1/);
  const unevaluated=sourceSet(sOther,[sOther.subjects[0]],'ITEM_GROUNDING_V1',sOther.subjects[0]);await owner('BEGIN;'+inserts(unevaluated.rows)+'COMMIT;');
  assert.equal(await owner(`SELECT count(*) FROM gov_repo.sr2_source_admissions_v1 WHERE snapshot_id=${lit(sOther.snap.snapshot_id)}`),'0');
  await bad(projection(sOther,unevaluated.row,[]).rows,/SR2_PROJECTION_SOURCE_SET|SR2_PROJECTION_ADMISSION_SEAL/);
  await bad([{table:'source_admissions',row:admission(e,s.capture,'PROTECTED_ELIGIBLE','v2',a1.evaluation_id)}],/23505/);
  assert.equal(await owner(`SELECT count(*) FROM gov_repo.sr2_manifest_entries_v1 WHERE snapshot_id=${lit(s.snap.snapshot_id)}`),'25');
 });
 await testCase('true chunk/symbol union: three locator classes and real parser; discriminator/grounding negatives',async()=>{
  for(const kind of ['FILE_DESCRIPTOR','CODE_REGION','DOCUMENTATION_REGION']){
   const l=chunk(s.entries[3],kind),sub=subject(s.k,'REPOSITORY_CHUNK',l.source_fingerprint,l.entry_id,null,l.locator_id,null);
   if(kind!=='FILE_DESCRIPTOR')await valid([{table:'chunk_locators',row:l},{table:'subjects',row:sub}]);
  }
  const l=symbol(s.entries[3]),sub=subject(s.k,'CODE_SYMBOL',l.source_fingerprint,l.entry_id,null,null,l.locator_id);await valid([{table:'symbol_locators',row:l},{table:'subjects',row:sub}]);
  await bad([{table:'chunk_locators',row:chunk(s.entries[3],'INVALID')}],/sr2_chunk_locators_v1_c1/);
  await bad([{table:'subjects',row:subject(s.k,'CODE_SYMBOL',s.entries[0].source_fingerprint,s.entries[0].entry_id,null,s.locators[0].locator_id,null)}],/sr2_subjects_v1_c2/);
  await bad([{table:'symbol_locators',row:{...l,parser_version:'unknown'}}],/sr2_symbol_locators_v1_c1/);
 });
 for(let i=0;i<8;i++)await testCase(`facet ${facetTables[i]}: stable semantic key, duplicate payload cannot evade PK, bounded/grounded`,async()=>{
  const selected=baseItems.filter(it=>it.table===facetTables[i]);
  const p=projection(s,primary.row,admissions.slice(0,4),selected,{label:'one family '+i});await valid(p.rows);
  const clone=facet(s.k,s.rootSubject,i===4?packageSet.row:grounding.row,i,'a',i===4?{summary_text:'altered'}:{method_version:'v2'});
  assert.equal(clone.row.item_key,selected[0].row.item_key);
  const dup=projection(s,primary.row,admissions.slice(0,4),[...selected,clone]);await bad(dup.rows,/23505|sr2_facet_collections_v1_c1/);
  if(i!==4){
   const many=Array.from({length:20},(_,j)=>facet(s.k,s.rootSubject,grounding.row,i,String(j)));
   await valid(projection(s,primary.row,admissions.slice(0,4),many,{label:'twenty '+i}).rows);
   await bad(projection(s,primary.row,admissions.slice(0,4),[...many,facet(s.k,s.rootSubject,grounding.row,i,'21')]).rows,/sr2_facet_collections_v1_c1/);
   const reversed=projection(s,primary.row,admissions.slice(0,4),[...selected].reverse(),{label:'one family '+i});assert.equal(reversed.row.projection_id,p.row.projection_id);
   const itemOther=facet(sRev.k,sRev.rootSubject,{...grounding.row,anchor_subject_id:sRev.subjects[0].subject_id},i,'a');assert.notEqual(itemOther.row.item_key,selected[0].row.item_key);
  }
  const foreign=structuredClone(p.rows);const item=foreign.find(x=>x.table===facetTables[i])!;item.row.snapshot_id=sRev.k.snapshot_id;await bad(foreign,/23514|23503/);
 });
 await testCase('explicit source sets 0/1/20/21, independent summary scopes, scope equality and membership closure',async()=>{
  for(const n of [0,1,20,21]){
   const set=sourceSet(s,s.subjects.slice(0,n),'REPOSITORY_SELECTION_V1',s.rootSubject,'size '+n);
   if(n===1||n===20)await valid(set.rows);else await bad(set.rows,/sr2_source_sets_v1_c2/);
  }
  const a=sourceSet(s,s.subjects.slice(1,4),'SERVICE_MEMBERS_V1',s.subjects[1],'service');assert.notEqual(a.row.source_set_id,packageSet.row.source_set_id);await valid(a.rows);
  const serviceSummary=facet(s.k,s.rootSubject,a.row,4,'service');
  const serviceProjection=projection(s,a.row,admissions.slice(1,4),[serviceSummary]);
  assert.notEqual(serviceProjection.row.projection_id,full.row.projection_id);await valid([...a.rows,...serviceProjection.rows]);
  await bad(a.rows.slice(0,-1),/SR2_SOURCE_SET_COUNT/);
  const foreign=sourceSet(s,[sB.subjects[0]],'REPOSITORY_SELECTION_V1');await bad(foreign.rows,/23503/);
  const entire=sourceSet(sRev,sRev.subjects,'REPOSITORY_SELECTION_V1',sRev.rootSubject,'entire','ENTIRE_SNAPSHOT_MANIFEST');await valid(entire.rows);
  const missing=sourceSet(sRev,sRev.subjects.slice(0,3),'REPOSITORY_SELECTION_V1',sRev.rootSubject,'entire','ENTIRE_SNAPSHOT_MANIFEST');await bad(missing.rows,/SR2_SET_ENTIRE_MANIFEST/);
 });
 await testCase('59-trigger singleton proof: normal/reverse assembly, missing/wrong/late summary and protected child',async()=>{
  const summary=baseItems.filter(i=>i.table==='summary_facets');const p=projection(s,primary.row,admissions.slice(0,4),summary,{label:'singleton'});
  await valid(p.rows);await valid([...p.rows].reverse());
  await bad(p.rows.filter(x=>x.table!=='summary_facets'),/SR2_FACET_COUNT/);
  await bad(p.rows.filter(x=>x.table!=='protected_projections'),/SR2_PROTECTED_SINGLETON/);
  const wrong=structuredClone(p.rows);wrong.find(x=>x.table==='summary_facets')!.row.payload_fingerprint='f'.repeat(64);await bad(wrong,/sr2_summary_facets_v1_c3/);
  await bad([...p.rows,p.rows.find(x=>x.table==='summary_facets')!],/23505/);
  const plain=projection(s,primary.row,admissions.slice(0,4),[],{label:'no facets'});await owner('BEGIN;'+inserts(plain.rows)+'COMMIT;');
  const late=p.rows.filter(x=>['facet_collections','summary_facets'].includes(x.table)).map(x=>({table:x.table,row:{...x.row,projection_id:plain.row.projection_id}}));await bad(late,/SR2_PROJECTION_CONTENT_HASH/);
  await bad(late.filter(x=>x.table==='summary_facets'),/23503/);
  await assert.rejects(owner('BEGIN;'+inserts(p.rows.filter(x=>x.table!=='summary_facets'))+'SET CONSTRAINTS ALL IMMEDIATE;COMMIT;'),/SR2_FACET_COUNT/);
  assert.equal(await owner(`SELECT count(*) FROM gov_repo.sr2_projections_v1 WHERE projection_id=${lit(p.row.projection_id)}`),'0');
 });
 await testCase('late distinct children cannot alter sealed manifests, source sets, plural collections, fragments or admissions',async()=>{
  const newEntry={...s.entries[0],relative_path:'src/late.ts'};newEntry.entry_id=H('SOURCE_ENTRY',...keys(newEntry),newEntry.relative_path,newEntry.entry_kind,newEntry.provider_object_id,newEntry.source_fingerprint,newEntry.encoding_id,newEntry.line_count);
  await bad([{table:'manifest_entries',row:newEntry}],/SR2_MANIFEST_COUNT/);
  await bad([{table:'source_set_members',row:{...primary.children[0],source_subject_id:s.subjects[4].subject_id,entry_id:s.entries[4].entry_id,source_fingerprint:s.entries[4].source_fingerprint}}],/SR2_SOURCE_SET_COUNT/);
  const newItem=facet(s.k,s.rootSubject,grounding.row,2,'late');newItem.row.projection_id=full.row.projection_id;await bad([newItem],/SR2_FACET_COUNT/);
  const frag:Stored={table:'fragments',row:{...full.rows.find(x=>x.table==='fragments')!.row,ordinal:2}};await bad([frag],/SR2_PROJECTION_CONTENT_HASH/);
  await bad([{table:'projection_sources',row:{...full.rows.find(x=>x.table==='projection_sources')!.row,entry_id:admissions[4].entry_id,source_admission_id:admissions[4].source_admission_id,admission_basis_fingerprint:admissions[4].admission_basis_fingerprint}}],/SR2_PROJECTION_SOURCE_SET/);
  const empty=projection(s,primary.row,admissions.slice(0,4),[],{label:'empty dependency',empty:[2]});await owner('BEGIN;'+inserts(empty.rows)+'COMMIT;');
  newItem.row.projection_id=empty.row.projection_id;await bad([newItem],/SR2_FACET_COUNT/);
 });
 await testCase('tenant-inclusive substitutions fail for every relevant root/leaf/support/admission/projection edge',async()=>{
  const attempts:Stored[][]=[
   [{table:'snapshots',row:{...s.snap,organisation_id:orgB}}],
   [{table:'captures',row:{...s.capture,organisation_id:orgB}}],
   [{table:'source_admissions',row:{...admissions[0],organisation_id:orgB}}],
   [{table:'source_set_members',row:{...primary.children[0],source_subject_id:sB.subjects[0].subject_id}}],
   [{table:'subjects',row:{...s.subjects[0],organisation_id:orgB}}],
   [{table:'projections',row:{...full.row,organisation_id:orgB}}],
   [{table:'projection_sources',row:{...full.rows.find(x=>x.table==='projection_sources')!.row,organisation_id:orgB}}],
   [representation(full.row,sB.capture)],
   [representation({...full.row,organisation_id:orgB},sB.capture)]
  ];
  for(const rows of attempts)await bad(rows,/23514|23503/);
 });
 await testCase('projection/content and vector contract rejects malformed classes, dimensions, aliases, zero and nonfinite',async()=>{
  for(const overrides of [{dimension:0},{dimension:2},{dimension:16001},{embedding:'[0,0,0]'},{embedding:'[NaN,0,0]'},{embedding:'[Infinity,0,0]'},{model_version:'latest'},{model_version:' UNKNOWN '},{projection_fingerprint:'e'.repeat(64)},{generated_at:'2000-01-01'},{recorded_at:'infinity'},{recorded_at:'2999-01-01'}])await bad([representation(full.row,s.capture,overrides)],/23514|22003|22000|23503/);
  const validRep=representation(full.row,s.capture);await owner(insert(validRep));await bad([{table:'representations',row:{...validRep.row,embedding:'[0,1,0]'}}],/23505/);
  const missingChild=projection(s,primary.row,admissions.slice(0,4),[],{label:'missing child'});await bad(missingChild.rows.filter(x=>x.table!=='protected_projections'),/SR2_PROTECTED_SINGLETON/);
  const meta=projection(s,primary.row,admissions.slice(0,4),[],{metadata:true});await bad([...meta.rows,representation(meta.row,s.capture)],/sr2_representations_v1_c4/);
  assert.equal(await owner(`SELECT count(*) FROM information_schema.columns WHERE table_schema='gov_repo' AND table_name LIKE 'sr2_%' AND (data_type IN ('json','jsonb') OR column_name IN ('similarity','confidence','rank','current','selected'))`),'0');
 });
 await testCase('list, structural text, fragment, path and native-reference bounds fail closed at exact boundaries',async()=>{
  for(const expression of [`NULL::text[]`,`ARRAY[NULL]::text[]`,`ARRAY[' ']`,`ARRAY[ARRAY['x']]`,`'[0:0]={x}'::text[]`,`ARRAY[repeat('é',257)]`,`array_fill('x'::text,ARRAY[21])`])assert.equal(await owner(`SELECT gov_repo.sr2_list_valid_v1(${expression},20)`),'f');
  assert.equal(await owner(`SELECT gov_repo.sr2_list_valid_v1(ARRAY[repeat('é',256)],20)`),'t');
  const options={label:'x',description:'x',summary:'x',fragments:[{projected_text:'x'.repeat(1024)},{projected_text:'x'.repeat(1024)},{projected_text:'x'.repeat(1024)},{projected_text:'x'.repeat(1021)}]};
  await valid(projection(s,primary.row,admissions.slice(0,4),[],options).rows);
  await bad(projection(s,primary.row,admissions.slice(0,4),[],{...options,fragments:options.fragments.map((x,i)=>i===3?{projected_text:x.projected_text+'x'}:x)}).rows,/SR2_PROJECTION_BOUND/);
  await bad(projection(s,primary.row,admissions.slice(0,4),[],{label:'fifth fragment',fragments:Array.from({length:5},()=>({projected_text:'x'}))}).rows,/sr2_fragments_v1_c1/);
  const p=projection(s,primary.row,admissions.slice(0,4),[],{label:'gap',fragments:[{ordinal:2}]});await bad(p.rows,/SR2_FRAGMENT_GROUNDING_ORDER/);
  // 20 source subjects + snapshot subject + primary set + 20 admissions + one capture = 43 references.
  const selected=sourceSet(s,s.subjects.slice(0,20),'REPOSITORY_SELECTION_V1',s.rootSubject,'native support');
  const sets=Array.from({length:57},(_,i)=>sourceSet(s,[s.subjects[0]],'ITEM_GROUNDING_V1',s.subjects[0],'ground '+i));
  const items=sets.map((set,i)=>facet(s.k,s.rootSubject,set.row,[3,6,7][Math.floor(i/20)],String(i)));
  const accepted=projection(s,selected.row,admissions.slice(0,20),items.slice(0,56),{label:'99 native refs'});
  await valid([...selected.rows,...sets.slice(0,56).flatMap(x=>x.rows),...accepted.rows]);
  const rejected=projection(s,selected.row,admissions.slice(0,20),items,{label:'100 native refs'});
  await bad([...selected.rows,...sets.flatMap(x=>x.rows),...rejected.rows],/SR2_PROJECTION_BOUND/);
 });
 await testCase('recomputed valid identities cannot bypass tenant-inclusive FK edges',async()=>{
  const foreignRoot={...r.row,organisation_id:orgB};foreignRoot.repository_id=H('ROOT',orgB,foreignRoot.connection_id,foreignRoot.source_system_id,foreignRoot.provider_code,foreignRoot.provider_instance_id,foreignRoot.provider_repository_id);
  await bad([{table:'repositories',row:foreignRoot}],/SR2_REPOSITORY_ATTESTATION|23503/);
  const forged=snapshot({...r.row,organisation_id:orgB},1,'7'.repeat(40));await bad(forged.rows,/23503/);
  const sub=subject(s.k,'REPOSITORY_CHUNK',sB.entries[0].source_fingerprint,sB.entries[0].entry_id,null,sB.locators[0].locator_id,null);await bad([{table:'subjects',row:sub}],/23503/);
  const foreignAdmission=admission({...sB.entries[0],...s.k},s.capture);await bad([{table:'source_admissions',row:foreignAdmission}],/23503/);
  const p=projection(s,primary.row,admissions.slice(0,4),[],{target:sB.rootSubject,label:'foreign subject'});await bad(p.rows,/23503/);
 });
 await testCase('additive postflight rejects body, ACL, policy, RLS, overload and trigger drift',async()=>{
  const postflight=source.match(/DO \$a1_postflight\$[\s\S]*?END \$a1_postflight\$;/)![0]+source.match(/DO \$function_pins\$[\s\S]*?END \$function_pins\$;/)![0];
  for(const sql of [
   `GRANT SELECT ON gov_repo.sr2_repositories_v1 TO service_role;`,
   `GRANT EXECUTE ON FUNCTION gov_repo.sr2_list_valid_v1(text[],integer) TO PUBLIC;`,
   `ALTER TABLE gov_repo.sr2_repositories_v1 DISABLE ROW LEVEL SECURITY;`,
   `CREATE POLICY unexpected ON gov_repo.sr2_repositories_v1 USING (true);`,
   `ALTER TABLE gov_repo.sr2_summary_facets_v1 DISABLE TRIGGER sr2_summary_facets_v1_immutable;`,
   `CREATE FUNCTION gov_repo.sr2_list_valid_v1(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';`,
   `CREATE OR REPLACE FUNCTION gov_repo.sr2_list_valid_v1(p_values text[],p_max integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS 'BEGIN RETURN true; END';`
  ])await assert.rejects(owner('BEGIN;'+sql+postflight+'ROLLBACK;'),/SR2_A1_PRIVATE_CONTAINMENT|SR2_A1_CATALOG_BUDGET|SR2_A1_FUNCTION_PIN/);
 });
 await testCase('all 24 tables reject zero-row UPDATE, DELETE, TRUNCATE CASCADE and replica mutation',async()=>{
  for(const table of catalog.tables){
   for(const command of [`UPDATE gov_repo.${table.name} SET organisation_id=organisation_id WHERE false`,`DELETE FROM gov_repo.${table.name} WHERE false`,`TRUNCATE gov_repo.${table.name} CASCADE`])await assert.rejects(owner('BEGIN;'+command+';ROLLBACK;'),/55000.*SR2_IMMUTABLE/s);
   await assert.rejects(pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM gov_repo.${table.name} WHERE false;ROLLBACK;`),/SR2_IMMUTABLE/);
  }
 });
 await testCase('closed facet compatibility, explicit source grounding and noneligible captures',async()=>{
  for(const kind of ['CODE_REGION','DOCUMENTATION_REGION','CODE_SYMBOL']){
   const locator=kind==='CODE_SYMBOL'?symbol(s.entries[3]):chunk(s.entries[3],kind);
   const sub=subject(s.k,kind==='CODE_SYMBOL'?'CODE_SYMBOL':'REPOSITORY_CHUNK',locator.source_fingerprint,locator.entry_id,null,kind==='CODE_SYMBOL'?null:locator.locator_id,kind==='CODE_SYMBOL'?locator.locator_id:null);
   const source=sourceSet(s,[sub],'ITEM_GROUNDING_V1',sub,'typed region');
   const roots:Stored[]=[{table:kind==='CODE_SYMBOL'?'symbol_locators':'chunk_locators',row:locator},{table:'subjects',row:sub},...source.rows];
   const type=kind==='DOCUMENTATION_REGION'?5:7;
   const good=facet(s.k,sub,source.row,type,'observed',kind==='DOCUMENTATION_REGION'?{method_code:'STRUCTURAL_SUMMARY'}:{});
   await valid([...roots,...projection(s,source.row,[admissions[3]],[good],{target:sub}).rows]);
   const dependency=facet(s.k,sub,source.row,2,'dependency');
   const rows=[...roots,...projection(s,source.row,[admissions[3]],[dependency],{target:sub}).rows];
   if(kind==='CODE_REGION')await valid(rows);else await bad(rows,/SR2_FACET_COMPATIBILITY/);
  }
  const outside=sourceSet(s,[s.subjects[4]],'ITEM_GROUNDING_V1',s.subjects[4],'outside');
  await bad([...outside.rows,...projection(s,primary.row,admissions.slice(0,4),[facet(s.k,s.rootSubject,outside.row,0)]).rows],/SR2_ITEM_GROUNDING_SUBSET/);
  const metadata=projection(s,primary.row,admissions.slice(0,4),[],{metadata:true,label:'metadata only'});
  const protectedChild={...full.rows.find(x=>x.table==='protected_projections')!.row,projection_id:metadata.row.projection_id};
  await bad([...metadata.rows,{table:'protected_projections',row:protectedChild}],/23503|SR2_PROTECTED_SINGLETON/);
  for(const [i,attributes] of [{entry_kind:'SYMLINK'},{encoding_id:'NON_UTF8_BYTES_V1',line_count:0},{byte_length:524289}].entries()){
   const captured=snapshot(r.row,1,(i+8).toString(16).repeat(40),'GIT_SHA1_V1',attributes);
   const withheld=admission(captured.entries[0],captured.capture,'METADATA_ONLY');await valid([...captured.rows,{table:'source_admissions',row:withheld}]);
   await bad([...captured.rows,{table:'source_admissions',row:admission(captured.entries[0],captured.capture)}],/sr2_source_admissions_v1_c2/);
  }
 });
 await testCase('path/key byte ceilings, exact provider identity, and finite ordered event provenance',async()=>{
  const sameConnection=repository(orgA,'second-provider-id',r.row.connection_id);
  assert.notEqual(r.row.repository_id,sameConnection.row.repository_id);await valid([{table:'repositories',row:sameConnection.row}]);
  const maximum=snapshot(r.row,1,'b'.repeat(40),'GIT_SHA1_V1',{relative_path:'a/'+'f'.repeat(1022)});await valid(maximum.rows);
  for(const path of ['a/'+'f'.repeat(1023),'/a','a/../b','a\\b','a//b','a?q','a#b','a:b','a/\n'])await bad(snapshot(r.row,1,'b'.repeat(40),'GIT_SHA1_V1',{relative_path:path}).rows,/sr2_manifest_entries_v1_c1/);
  await valid([representation(full.row,s.capture,{provider_id:'p'.repeat(512),model_id:'m'.repeat(512),model_version:'v'.repeat(512)})]);
  await bad([representation(full.row,s.capture,{provider_id:'p'.repeat(513)})],/sr2_representations_v1_c4/);
  await bad([{table:'repositories',row:{...r.row,recorded_at:'2999-01-01'}}],/SR2_REPOSITORY_ATTESTATION/);
  await bad([{table:'captures',row:{...s.capture,capture_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',recorded_at:'2999-01-01'}}],/SR2_CAPTURE_ATTESTATION/);
  const a=admission(s.entries[0],s.capture);await bad([{table:'source_admissions',row:{...a,evaluated_at:'infinity'}}],/sr2_source_admissions_v1_c5/);
  await bad([{table:'source_admissions',row:{...a,recorded_at:'2999-01-01'}}],/SR2_FUTURE_RECORD/);
  const p=projection(s,primary.row,admissions.slice(0,4),[],{label:'wrong admission time'});p.row.admitted_at='2000-01-01';await bad(p.rows,/SR2_PROJECTION_ADMISSION_SEAL/);
 });
 await testCase('fixed golden identity recipes cover every durable identity and every plural facet',async()=>{
  const r=repository(orgA,'fixed-provider-repo','fixed-connection'),s=snapshot(r.row,2);
  const set=sourceSet(s),ground=sourceSet(s,[s.subjects[0]],'ITEM_GROUNDING_V1',s.subjects[0]),summary=sourceSet(s,s.subjects,'PACKAGE_MEMBERS_V1',s.subjects[0],'package');
  const admissions=s.entries.map((e,i)=>admission(e,s.capture,'PROTECTED_ELIGIBLE','v2',`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}`));
  const items=facetTables.flatMap((_,i)=>i===4?[facet(s.k,s.rootSubject,summary.row,i)]:[facet(s.k,s.rootSubject,ground.row,i,'a'),facet(s.k,s.rootSubject,ground.row,i,'b')]);
  const p=projection(s,set.row,admissions,items);
  const golden={root:r.row.repository_id,snapshot:s.snap.snapshot_id,manifest:s.snap.manifest_fingerprint,entries:s.entries.map(e=>e.entry_id),locators:s.locators.map(e=>e.locator_id),subjects:[s.rootSubject,...s.subjects].map(e=>e.subject_id),admissions:admissions.map(e=>({id:e.source_admission_id,basis:e.admission_basis_fingerprint})),sets:[set,ground,summary].map(e=>({id:e.row.source_set_id,membership:e.row.membership_fingerprint})),facets:items.map(e=>({kind:e.row.facet_kind,key:e.row.item_key,payload:e.row.payload_fingerprint})),collections:p.collections.map(e=>e.row.collection_fingerprint),projection:p.row.projection_id,content:p.row.projection_fingerprint,representation:representation(p.row,s.capture).row.representation_id};
  assert.deepEqual(golden,JSON.parse(readFileSync(join(ledgerRepo,'apps/dashboard/tests/fixtures/sr2-a1-identities-v1.json'),'utf8')));
  await owner('BEGIN;'+r.sql+inserts([...s.rows,...admissions.map(row=>({table:'source_admissions',row})),...set.rows,...ground.rows,...summary.rows,...p.rows,representation(p.row,s.capture)])+'SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;');
 });
 await testCase('READ COMMITTED only for aggregate assembly; early validation and concurrent singleton split roll back',async()=>{
  const p=projection(s,primary.row,admissions.slice(0,4),baseItems.filter(x=>x.table==='summary_facets'),{label:'concurrency'});
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])await assert.rejects(owner(`BEGIN ISOLATION LEVEL ${isolation};`+inserts(p.rows)+'COMMIT;'),/25001/);
  const first=pg.session('postgres'),second=pg.session('postgres');
  try{
   assert.equal((await first.run('BEGIN;'+inserts(p.rows.filter(x=>x.table!=='summary_facets')))).err,'');
   const pid=Number((await second.run('SELECT pg_backend_pid();')).out);
   assert.equal((await second.run('BEGIN;')).err,'');
   const pending=second.run(inserts(p.rows.filter(x=>x.table==='facet_collections')));
   let blocked=false;for(let i=0;i<80;i++){if(await owner(`SELECT cardinality(pg_blocking_pids(${pid}))>0`)==='t'){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
   assert.ok(blocked,'real advisory-lock blocking observed');
   assert.match((await first.run('COMMIT;')).err,/SR2_FACET_COUNT/);
   assert.equal((await pending).err,'');assert.match((await second.run('COMMIT;')).err,/SR2_PROJECTION_PARENT|23503/);
   assert.equal(await owner(`SELECT count(*) FROM gov_repo.sr2_projections_v1 WHERE projection_id=${lit(p.row.projection_id)}`),'0');
  }finally{await first.close();await second.close();}
 });
 await testCase('old SR1 application read still returns the same immutable reference-only DTO after A1',async()=>{
  const actor=await pg.actor(orgA);const result=JSON.parse(await pg.svc(bounded('SELECT '+rpc(actor))));
  assert.equal(result.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.deepEqual(result.hits.map((h:any)=>h.subject.id),['object-a']);assert.doesNotMatch(JSON.stringify(result),/secret|confidence|"vector"/);
 });
 t.diagnostic('A1 catalog '+JSON.stringify(counts)+'; application-callable=0; RLS policies=0');
});
