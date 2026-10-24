import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { technicalCluster, technicalFixture, technicalRpc, scopedRead, orgA, orgB, lit, admission, insert, inserts,
  disclosureProfile, projection, plainProjection, representation, repository, snapshot, sourceSet, facet, chunk, symbol, subject, H, keys, a2Source, a2CatalogQuery, type Row } from '../helpers/sr2-a2-fixtures';
import { fixture } from '../helpers/semantic-retrieval-fixtures';
import { createTechnicalScopeSource } from '../../lib/governance/technical-context-scope';
import { parseTechnicalContextResult } from '../../lib/governance/technical-context-contract';
import { technicalSpace } from '../helpers/sr2-a2-fixtures';
import { createTechnicalRetrievalAdapter } from '../../lib/governance/technical-context-retrieval';
import { createTechnicalQueryEmbeddingSource,TECHNICAL_DOCUMENT_RECIPE,TECHNICAL_QUERY_RECIPE } from '../../lib/governance/technical-query-embedding';

test('SR2-A2 real PG17 technical retrieval',{timeout:900000},async t=>{
 const focus=process.env.SR2_A2_FOCUS?new RegExp(process.env.SR2_A2_FOCUS):null;
 const check=async(name:string,body:()=>Promise<void>)=>{
  if(focus&&!focus.test(name)){await t.test(name,{skip:'explicit focused selection'},()=>{});return;}
  let failure:unknown;await t.test(name,async()=>{try{await body();}catch(e){failure=e;throw e;}});if(failure)throw failure;
 };
 const pg=await technicalCluster(m=>t.diagnostic(m));t.after(()=>pg.stop());
 await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;${fixture}COMMIT;`);
 const actor=await pg.actor(orgA), f=technicalFixture({facets:true,count:2}); await pg.owner(f.sql);
 const read=async(overrides:Record<string,string>={})=>JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,f,overrides))));
 const parseValue=(value:unknown,target=f,querySpace:Omit<typeof technicalSpace,'dimension'>&{dimension:number}=technicalSpace)=>{
  const principal={organisationId:orgA,userId:actor.id,credentialEpoch:actor.epoch,issuedAtSeconds:1,expiresAtSeconds:2,informational:{}};
  const b=createTechnicalScopeSource({bindings:[{selection_key:'typed',organisation_id:orgA,repository_id:target.root.row.repository_id,snapshot_id:target.s.snap.snapshot_id}]})(principal,'typed');assert.ok('scope'in b);
  return parseTechnicalContextResult(value,orgA,b.scope,querySpace,20);
 };
 await check('exact typed rich graph is accepted by the real strict Node parser',async()=>{
  const value=await read();assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');
  const principal={organisationId:orgA,userId:actor.id,credentialEpoch:actor.epoch,issuedAtSeconds:1,expiresAtSeconds:2,informational:{}};
  const resolved=createTechnicalScopeSource({bindings:[{selection_key:'fixture',organisation_id:orgA,repository_id:f.root.row.repository_id,snapshot_id:f.s.snap.snapshot_id}]})(principal,'fixture');
  assert.ok('scope' in resolved);
  const parsed=parseTechnicalContextResult(value,orgA,resolved.scope,technicalSpace,20);
  assert.equal(parsed.hits.length,1);assert.ok(Object.isFrozen(parsed.hits));
 });
 await check('real Node adapter and injected query source execute the dedicated principal-bound PG transaction',async()=>{
  const {Pool}=await import('pg');const pool=new Pool({host:'127.0.0.1',port:Number(await pg.owner('SHOW port')),database:'postgres',user:'service_role',max:1});
  try{
   const epoch=await pg.owner(`SELECT to_char(password_changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM gov_repo.governance_users WHERE user_id=${lit(actor.id)}`);
   const now=Math.floor(Date.now()/1000),principal={organisationId:orgA,userId:actor.id,credentialEpoch:epoch,issuedAtSeconds:now-10,expiresAtSeconds:now+3600,informational:{role:'ignored'}};
   const binding=createTechnicalScopeSource({bindings:[{selection_key:'fixture',organisation_id:orgA,repository_id:f.root.row.repository_id,snapshot_id:f.s.snap.snapshot_id}]})(principal,'fixture');assert.ok('scope'in binding);
   const source=createTechnicalQueryEmbeddingSource({space:technicalSpace,document_recipe:TECHNICAL_DOCUMENT_RECIPE,query_recipe:TECHNICAL_QUERY_RECIPE,model_version_verified:true},
    {async embedQuestion(){return {space:technicalSpace,query_recipe:TECHNICAL_QUERY_RECIPE,vector:[1,0,0]};}});
   const query=await source('synthetic question');assert.ok('query'in query);
   const value=await createTechnicalRetrievalAdapter(pool).retrieveTechnicalContext(principal,binding.scope,query.query,{limit:20,threshold:-1,policy_version:'EXACT_COSINE_V1'});
   assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(value.hits[0].representation_id,f.rep.row.representation_id);
   assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'0');
  }finally{await pool.end();}
 });
 const call=()=>technicalRpc(actor,f);
 const transaction=async(sql:string,overrides:Record<string,string>={})=>JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;SET LOCAL statement_timeout='5s';${sql}RESET ROLE;SET LOCAL ROLE service_role;SELECT ${technicalRpc(actor,f,overrides)};ROLLBACK;`));
 const headWhere=`organisation_id=${lit(orgA)} AND repository_id=${lit(f.root.row.repository_id)}`;
 const sourceWhere=headWhere+` AND snapshot_id=${lit(f.s.snap.snapshot_id)} AND entry_id=${lit(f.admissions[0].entry_id)}`;
 const denied=(x:any,reason:string)=>{assert.equal(x.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.equal(x.reason,reason);assert.deepEqual(x.hits,[]);};
 const allTables=JSON.parse(readFileSync(new URL('../fixtures/sr2-a1-catalog-v1.json',import.meta.url),'utf8')).tables.map((x:any)=>x.name)
  .concat(['sr2_disclosure_profiles_v1','sr2_disclosure_profile_heads_v1','sr2_source_admission_heads_v1']);
 const corrupt=async(sql:string)=>JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;
  ${allTables.map((name:string)=>`ALTER TABLE gov_repo.${name} DISABLE TRIGGER USER;`).join('')}${sql}
  SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;SELECT ${call()};ROLLBACK;`));
 const vectorSchema=await pg.owner("SELECT quote_ident(n.nspname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'");
 const unit=(d:number)=>Array.from({length:d},(_,i)=>i===0?1:0);
 const numericCases:{name:string;stored:number[];query:number[]}[]=[
  {name:'extreme stored large',stored:[3e38,0,0],query:[1,0,0]},
  {name:'extreme opposite both',stored:[3e38,0,0],query:[-3e38,0,0]},
  {name:'extreme stored tiny orthogonal',stored:[1e-30,0,0],query:[0,1,0]},
  {name:'extreme stored tiny same direction',stored:[1e-30,0,0],query:[1,0,0]},
  {name:'extreme query large',stored:[1,0,0],query:[3e38,0,0]},
  {name:'extreme query tiny',stored:[1,0,0],query:[1e-30,0,0]},
  {name:'float32 maximum both',stored:[3.4028234663852886e38,3.4028234663852886e38,0],query:[3.4028234663852886e38,0,0]},
  {name:'smallest float32 subnormal both',stored:[Math.fround(1e-45),0,0],query:[Math.fround(1e-45),0,0]},
  {name:'subnormal orthogonal',stored:[Math.fround(1e-45),0,0],query:[0,Math.fround(1e-45),0]},
  {name:'mixed huge tiny',stored:[3e38,1e-30,-3e38],query:[3e38,-3e38,1e-30]},
  {name:'dimension one tiny opposite',stored:[Math.fround(1e-45)],query:[-3e38]},
  {name:'dimension one maximum identical',stored:[3.4028234663852886e38],query:[3.4028234663852886e38]},
  {name:'identical unit',stored:[1,0,0],query:[1,0,0]},
  {name:'opposite unit',stored:[1,0,0],query:[-1,0,0]},
  {name:'orthogonal unit',stored:[1,0,0],query:[0,1,0]},
  {name:'ordinary embedding-like',stored:[0.012,-0.074,0.35],query:[-0.043,-0.067,0.27]},
  {name:'dimension 384 mixed extremes',stored:Array.from({length:384},(_,i)=>i%2?1e-30:3e38),query:Array.from({length:384},(_,i)=>i%3?-3e38:1e-30)},
  {name:'dimension 16000 tiny and ordinary',stored:Array(16000).fill(1e-30),query:Array(16000).fill(0.01)},
 ];
 for(const c of numericCases)await check('numeric amendment '+c.name,async()=>{
  const n=technicalFixture({dimension:c.stored.length,embedding:c.stored});await pg.owner(n.sql);
  const expression=`1-(${vectorSchema}.l2_normalize(${lit(JSON.stringify(c.stored))}::${vectorSchema}.vector) OPERATOR(${vectorSchema}.<=>) ${vectorSchema}.l2_normalize(${lit(JSON.stringify(c.query))}::${vectorSchema}.vector))`;
  const actual=Number(await pg.owner('SELECT '+expression));
  const a=c.stored.map(Math.fround),b=c.query.map(Math.fround),na=Math.hypot(...a),nb=Math.hypot(...b);
  const expected=Math.max(-1,Math.min(1,a.reduce((sum,x,i)=>sum+(x/na)*(b[i]/nb),0)));
  assert.ok(Number.isFinite(actual)&&actual>=-1&&actual<=1);assert.ok(Math.abs(actual-expected)<2e-6,`${c.name}: ${actual} vs ${expected}`);
  const readAt=async(threshold:number)=>JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,n,{p_query:lit(JSON.stringify(c.query)),p_threshold:String(threshold)}))));
  const accepted=await readAt(Math.max(-1,expected-0.00001));assert.equal(accepted.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(accepted.hits.length,1);
  parseValue(accepted,n,{...technicalSpace,dimension:c.stored.length});
  if(expected<0.9999)assert.equal((await readAt(Math.min(1,expected+0.00001))).status,'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE');
  t.diagnostic(JSON.stringify({numeric_case:c.name,dimension:c.stored.length,expected,normalized_cosine:actual}));
 });
 await check('numeric amendment deterministic adversarial fuzz agrees with stable float64 reference',async()=>{
  let seed=1752322;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const cases=Array.from({length:64},(_,i)=>{
   const dimension=[1,3,384,1536][i%4];
   const make=()=>Array.from({length:dimension},()=>Math.fround((random()<0.5?-1:1)*(0.5+random()/2)*2**Math.floor(random()*270-143)));
   return {a:make(),b:make()};
  });
  const values=cases.map((c,i)=>`(${i},${lit(JSON.stringify(c.a))}::${vectorSchema}.vector,${lit(JSON.stringify(c.b))}::${vectorSchema}.vector)`).join(',');
  const scores=JSON.parse(await pg.owner(`SELECT jsonb_agg(jsonb_build_object('id',id,'score',1-(${vectorSchema}.l2_normalize(a) OPERATOR(${vectorSchema}.<=>) ${vectorSchema}.l2_normalize(b))) ORDER BY id) FROM (VALUES ${values}) f(id,a,b)`));
  for(const {id,score} of scores){const {a,b}=cases[id],na=Math.hypot(...a),nb=Math.hypot(...b);
   const expected=Math.max(-1,Math.min(1,a.reduce((sum,x,i)=>sum+(x/na)*(b[i]/nb),0)));
   assert.ok(Number.isFinite(score)&&score>=-1&&score<=1);assert.ok(Math.abs(score-expected)<3e-6);
  }
  t.diagnostic('Numeric seeded fuzz PASS: seed 1752322, 64 pairs, dimensions 1/3/384/1536, float32 exponent -143..126.');
 });
 await check('numeric amendment rejects NaN infinity null or out-of-range scores before hit and no-match paths',async()=>{
  const signature=`gov_repo.technical_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,${vectorSchema}.vector,text,text,text,integer,text,text,integer,double precision)`;
  const definition=await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`);
  for(const score of ["'NaN'::float8","'Infinity'::float8","'-Infinity'::float8",'NULL::float8','1.00001::float8','-1.00001::float8']){
   const mutated=definition.replace(/scored AS MATERIALIZED \(SELECT r\.\*,[^\n]+ AS relevance FROM scoreable r\)/,`scored AS MATERIALIZED (SELECT r.*,${score} AS relevance FROM scoreable r)`);
   assert.notEqual(mutated,definition);
   for(const threshold of ['-1','1'])await assert.rejects(pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${mutated}
    RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,f,{p_limit:'1',p_threshold:threshold})};ROLLBACK;`),/XX000.*TECHNICAL_NUMERIC_INVARIANT/);
  }
  assert.equal(await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`),definition);
 });
 const checkConstraints: {table:string;name:string}[]=JSON.parse(await pg.owner(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname))
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname=ANY(ARRAY[${allTables.map(lit).join(',')}]) AND k.contype='c'`));
 for(const table of allTables.filter((name:string)=>name!=='sr2_symbol_locators_v1'))await check('FK-bypassed foreign tenant cannot cross hydration edge '+table,async()=>{
  const drops=checkConstraints.filter(c=>c.table===table).map(c=>`ALTER TABLE gov_repo.${table} DROP CONSTRAINT ${c.name};`).join('');
  const sql=drops+`UPDATE gov_repo.${table} SET organisation_id=${lit(orgB)} WHERE ${headWhere};`;
  if(table==='sr2_repositories_v1')await assert.rejects(corrupt(sql),/GV003.*TECHNICAL_ACCESS_DENIED/);
  else {const value=await corrupt(sql);assert.equal(value.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.deepEqual(value.hits,[]);}
 });
 for(const [name,overrides] of Object.entries<Record<string,string>>({wrong_org:{p_verified_organisation_id:lit(orgB)},missing_actor:{p_verified_actor_user_id:lit('00000000-0000-4000-8000-000000000000')},
  stale_epoch:{p_verified_credential_epoch:"'2000-01-01'"},microsecond_epoch:{p_verified_credential_epoch:`${lit(actor.epoch)}::timestamptz+interval '1 microsecond'`},
  expired:{p_verified_session_exp:'1'},future_issued:{p_verified_session_iat:'9999999999'},max_age:{p_verified_session_iat:'1'}}))
  await check('principal revalidation '+name,async()=>{await assert.rejects(read(overrides),/GV00[1-5]/);});
 for(const [name,sql] of Object.entries({inactive_user:`UPDATE gov_repo.governance_users SET status='suspended' WHERE user_id=${lit(actor.id)};`,
  inactive_org:`UPDATE gov_repo.organisations SET is_active=false WHERE organisation_id=${lit(orgA)};`,
  moved_actor:`UPDATE gov_repo.governance_users SET organisation_id=${lit(orgB)} WHERE user_id=${lit(actor.id)};`,
  invalid_role:`UPDATE gov_repo.governance_users SET role_ids=ARRAY['00000000-0000-4000-8000-000000000000']::uuid[] WHERE user_id=${lit(actor.id)};`}))
  await check('persisted principal '+name,async()=>{await assert.rejects(pg.bootstrapSql(`BEGIN;${sql}SET LOCAL ROLE service_role;SELECT ${call()};ROLLBACK;`),/GV00[1-5]/);});
 await check('current valid role change and empty roles retain unchanged derived-read semantics',async()=>{
  const x=JSON.parse(await pg.bootstrapSql(`BEGIN;UPDATE gov_repo.governance_users SET role_ids=ARRAY[]::uuid[] WHERE user_id=${lit(actor.id)};
   SET LOCAL statement_timeout='5s';SET LOCAL ROLE service_role;SELECT ${call()};ROLLBACK;`));assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');
 });
 for(const [name,overrides] of Object.entries<Record<string,string>>({provider:{p_provider:"'other'"},model:{p_model:"'other'"},version:{p_version:"'other'"},schema:{p_schema:"'other'"},dimension:{p_dimension:'2',p_query:"'[1,0]'"}}))
  await check('exact five-field semantic space '+name,async()=>denied(await read(overrides),'NO_COMPATIBLE_REPRESENTATIONS'));
 for(const [name,overrides] of Object.entries<Record<string,string>>({SR1_recipe:{p_query_recipe:"'GOVERNANCE_SUBJECT_QUERY_V1'"},zero:{p_query:"'[0,0,0]'"},float32_underflow:{p_query:"'[1e-90,0,0]'"},float32_overflow:{p_query:"'[1e90,0,0]'"},null_query:{p_query:'NULL'},dimension_zero:{p_dimension:'0'},dimension_over_max:{p_dimension:'16001'},NaN:{p_query:"'[NaN,0,0]'"},infinity:{p_query:"'[Infinity,0,0]'"},wrong_dimension:{p_query:"'[1,0]'"},
  alias:{p_version:"' DEFAULT '"},missing_provider:{p_provider:'NULL'},zero_limit:{p_limit:'0'},large_limit:{p_limit:'21'},bad_threshold:{p_threshold:'1.1'},nan_threshold:{p_threshold:"'NaN'"},infinite_threshold:{p_threshold:"'Infinity'"},scope_alias:{p_snapshot_id:"'main'"}}))
  await check('invalid technical query/options '+name,async()=>{await assert.rejects(read(overrides),/22023|22000|22003|22P02/);});
 await check('missing scope, absent revision and empty compatible population remain distinct',async()=>{
  denied(await read({p_repository_id:'NULL'}),'SCOPE_REQUIRED');denied(await read({p_snapshot_id:lit('f'.repeat(64))}),'REVISION_UNAVAILABLE');
  denied(await read({p_model:"'empty-space'"}),'NO_COMPATIBLE_REPRESENTATIONS');
 });
 await check('absent and foreign repository use identical authorization denial; foreign snapshot is revision unavailable',async()=>{
  const foreign=technicalFixture({org:orgB});await pg.owner(foreign.sql);
  for(const id of [foreign.root.row.repository_id,'f'.repeat(64)])await assert.rejects(read({p_repository_id:lit(id)}),/GV003.*TECHNICAL_ACCESS_DENIED/);
  denied(await read({p_snapshot_id:lit(foreign.s.snap.snapshot_id)}),'REVISION_UNAVAILABLE');
 });
 await check('execution budget must precede lookup; unsupported isolation fails authorization',async()=>{
  denied(JSON.parse(await pg.svc('SELECT '+call())),'EXECUTION_BUDGET_REQUIRED');
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])await assert.rejects(pg.svc(`BEGIN ISOLATION LEVEL ${isolation};SET LOCAL statement_timeout='5s';SELECT ${call()};ROLLBACK;`),/GV00[1-5]/);
 });
 await check('no-match after complete valid scan differs from no compatible representations',async()=>{
  const x=await read({p_query:"'[-1,0,0]'",p_threshold:'0.5'});assert.equal(x.status,'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE');assert.equal(x.reason,null);
 });
 for(const [name,sql] of Object.entries({disabled_profile:`UPDATE gov_repo.sr2_disclosure_profile_heads_v1 SET enabled=false,head_revision=2 WHERE ${headWhere};`,
  disabled_source:`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=2 WHERE ${sourceWhere};`}))
  await check('current disclosure '+name,async()=>denied(await transaction(sql),'CONTENT_WITHHELD'));
 for(const name of ['sr2_disclosure_profile_heads_v1','sr2_source_admission_heads_v1'])await check('missing head denies '+name,async()=>{
  denied(await corrupt(`DELETE FROM gov_repo.${name} WHERE ${headWhere};`),'CONTENT_WITHHELD');
 });
 for(const outcome of ['METADATA_ONLY','REJECTED'])await check('revoked current source '+outcome+' keeps immutable history but withholds complete multi-source projection',async()=>{
  const a=admission(f.s.entries[0],f.s.capture,outcome);
  const sql=insert({table:'source_admissions',row:a})+`UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(a.source_admission_id)},head_revision=2 WHERE ${sourceWhere};`;
  denied(await transaction(sql),'CONTENT_WITHHELD');
  assert.equal(await pg.owner(`SELECT count(*) FROM gov_repo.sr2_representations_v1 WHERE representation_id=${lit(f.rep.row.representation_id)}`),'1');
 });
 await check('independent equal-basis reevaluation authorizes historical projection without rewriting event seal',async()=>{
  const a=admission(f.s.entries[0],f.s.capture),sql=insert({table:'source_admissions',row:a})+
   `UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(a.source_admission_id)},head_revision=2 WHERE ${sourceWhere};`;
  const x=await transaction(sql);assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');
  const b=x.hits[0].support.admissions.find((b:any)=>b.entry_id===a.entry_id);
  assert.equal(b.current.source_admission_id,a.source_admission_id);assert.equal(b.historical.source_admission_id,f.admissions[0].source_admission_id);
  assert.equal(x.hits[0].projection.admission_record_set_fingerprint,f.p.row.admission_record_set_fingerprint);
 });
 await check('inserting a later rejected evaluation does not select current disclosure by timestamp or UUID',async()=>{
  const a=admission(f.s.entries[0],f.s.capture,'REJECTED');assert.equal((await transaction(insert({table:'source_admissions',row:a}))).status,'SEMANTIC_CONTEXT_AVAILABLE');
 });
 await check('changed recipe/policy basis and active profile replacement block old content',async()=>{
  const a=admission(f.s.entries[0],f.s.capture,'PROTECTED_ELIGIBLE','v3');
  denied(await transaction(insert({table:'source_admissions',row:a})+`UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(a.source_admission_id)},head_revision=2 WHERE ${sourceWhere};`),'CONTENT_WITHHELD');
  for(const change of [{policy_profile_version:'v3'},{handling_recipe_version:'v3'},{required_projection_schema_version:'schema-v3'}]){
   const profile=disclosureProfile(f.root.row,f.p.row,{disclosure_profile_version:'v2',...change});
   denied(await transaction(insert({table:'disclosure_profiles',row:profile})+`UPDATE gov_repo.sr2_disclosure_profile_heads_v1 SET disclosure_profile_version='v2',head_revision=2 WHERE ${headWhere};`),'CONTENT_WITHHELD');
  }
 });
 await check('new profile version not selected until explicit head moves',async()=>{
  const d=disclosureProfile(f.root.row,f.p.row,{disclosure_profile_version:'v999',policy_profile_version:'v3'});
  const x=await transaction(insert({table:'disclosure_profiles',row:d}));assert.equal(x.hits[0].disclosure.profile_version,'v1');
 });
 for(const [name,sql,reason] of [
  ['missing source','DELETE FROM gov_repo.sr2_manifest_entries_v1 WHERE '+sourceWhere+';','SOURCE_UNAVAILABLE'],
  ['missing mandatory child',`DELETE FROM gov_repo.sr2_protected_projections_v1 WHERE ${headWhere};`,'INVALID_SOURCE_SUPPORT'],
  ['missing projection source',`DELETE FROM gov_repo.sr2_projection_sources_v1 WHERE ${sourceWhere};`,'INVALID_SOURCE_SUPPORT'],
  ['broken current target',`UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=repeat('f',64) WHERE ${sourceWhere};`,'INVALID_SOURCE_SUPPORT'],
  ['missing source set member',`DELETE FROM gov_repo.sr2_source_set_members_v1 WHERE ${sourceWhere};`,'INVALID_SOURCE_SUPPORT'],
  ['missing capture',`DELETE FROM gov_repo.sr2_captures_v1 WHERE ${headWhere};`,'CAPTURE_INCOMPLETE'],
  ['missing facet item',`DELETE FROM gov_repo.sr2_module_facets_v1 WHERE ${headWhere};`,'INVALID_SOURCE_SUPPORT'],
 ] as const)await check('missing-child safety '+name,async()=>denied(await corrupt(sql),reason));
 await check('newest representation before cosine, generated/recorded/bytewise ties, no older more-similar vector',async()=>{
  const p=projection(f.s,f.primary.row,f.admissions,[],{label:'newest',fragments:[{}]});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-02',indexed_at:'2026-10-02',recorded_at:'2026-10-02',embedding:'[0,1,0]'});
  const x=await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';");
  assert.equal(x.hits[0].representation_id,r.row.representation_id);
  const tie=projection(f.s,f.primary.row,f.admissions,[],{label:'tie'}),tieR=representation(tie.row,f.s.capture,{generated_at:'2026-10-02',indexed_at:'2026-10-02',recorded_at:'2026-10-02'});
  const value=await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r,...tie.rows,tieR])+"SET LOCAL statement_timeout='5s';");
  assert.equal(value.hits[0].representation_id,[r.row.representation_id,tieR.row.representation_id].sort()[0]);
 });
 await check('newest incompatible handling never falls back to valid older representation',async()=>{
  const p=plainProjection(f.s,f.primary.row,f.admissions,{safe_label:'newest blocked',handling_recipe_version:'v3'});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
  denied(await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';"),'CONTENT_WITHHELD');
 });
 await check('valid A1 description beyond A2 scalar bound is unavailable rather than truncated',async()=>{
  const p=projection(f.s,f.primary.row,f.admissions,[],{label:'bounded description',description:'é'.repeat(257)});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
  denied(await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';"),'CONTENT_BOUND');
 });
 await check('protected DTO human-text bytes accept 4096 and reject 4097 without changing legal A1 storage',async()=>{
  const fixed=Buffer.byteLength(f.root.row.display_label)+3+3*1024+2*f.s.entries.reduce((n,e)=>n+Buffer.byteLength(e.relative_path),0);
  for(const size of [4096,4097]){
   const p=projection(f.s,f.primary.row,f.admissions,[],{label:'x',description:'x',summary:'x',fragments:[...Array.from({length:3},()=>({projected_text:'x'.repeat(1024)})),{projected_text:'x'.repeat(size-fixed)}]});
   const r=representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
   const x=await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';");
   if(size===4096){assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(x.hits[0].projection.protected.fragments.length,4);}else denied(x,'CONTENT_BOUND');
  }
 });
 await check('21 complete grounding sets remain unavailable rather than losing the extra required set',async()=>{
  const sets=Array.from({length:20},(_,i)=>sourceSet(f.s,[f.s.subjects[0]],'ITEM_GROUNDING_V1',f.s.subjects[0],'set limit '+i));
  const p=projection(f.s,f.primary.row,f.admissions,sets.map((s,i)=>facet(f.s.k,f.s.rootSubject,s.row,3,String(i))),{label:'21 complete sets'});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
  denied(await transaction('SET LOCAL statement_timeout=0;'+inserts([...sets.flatMap(s=>s.rows),...p.rows,r])+"SET LOCAL statement_timeout='5s';"),'PROVENANCE_BOUND');
 });
 await check('all disclosure head transitions enforce revision/CAS/key/no-op/delete/truncate',async()=>{
  for(const table of ['sr2_disclosure_profile_heads_v1','sr2_source_admission_heads_v1']){
   for(const sql of [`UPDATE gov_repo.${table} SET head_revision=2 WHERE ${headWhere};`,
    `UPDATE gov_repo.${table} SET enabled=false,head_revision=3 WHERE ${headWhere};`,
    `UPDATE gov_repo.${table} SET repository_id=repeat('f',64),enabled=false,head_revision=2 WHERE ${headWhere};`,
    `DELETE FROM gov_repo.${table} WHERE false;`,`TRUNCATE gov_repo.${table};`])await assert.rejects(pg.owner('BEGIN;'+sql+'ROLLBACK;'),/SR2_DISCLOSURE|SR2_IMMUTABLE/);
   assert.equal(await pg.owner(`BEGIN;UPDATE gov_repo.${table} SET enabled=false,head_revision=2 WHERE ${headWhere} AND head_revision=1;
    SELECT count(*) FROM gov_repo.${table} WHERE ${headWhere} AND head_revision=1;ROLLBACK;`),'0');
  }
  for(const sql of [`UPDATE gov_repo.sr2_disclosure_profiles_v1 SET recorded_at=recorded_at WHERE false;`,
   `DELETE FROM gov_repo.sr2_disclosure_profiles_v1 WHERE false;`,`TRUNCATE gov_repo.sr2_disclosure_profiles_v1 CASCADE;`])
   await assert.rejects(pg.owner('BEGIN;'+sql+'ROLLBACK;'),/SR2_IMMUTABLE/);
 });
 await check('disclosure profile scalar/hash/FK bounds and head initial revision are enforced',async()=>{
  const exact=disclosureProfile(f.root.row,f.p.row,{disclosure_profile_version:'x'.repeat(512)});
  await pg.owner('BEGIN;'+insert({table:'disclosure_profiles',row:exact})+'ROLLBACK;');
  for(const row of [disclosureProfile(f.root.row,f.p.row,{disclosure_profile_version:'x'.repeat(513)}),
   {...exact,profile_fingerprint:'0'.repeat(64)},disclosureProfile({...f.root.row,repository_id:'f'.repeat(64)},f.p.row)])
   await assert.rejects(pg.owner('BEGIN;'+insert({table:'disclosure_profiles',row})+'ROLLBACK;'),/23514|23503/);
  for(const table of ['disclosure_profile_heads','source_admission_heads'])for(const revision of [0,2]){
   const n=technicalFixture();for(const stored of n.rows)if(stored.table===table)stored.row.head_revision=revision;
   await assert.rejects(pg.owner('BEGIN;'+n.root.sql+inserts(n.rows)+'ROLLBACK;'),/23514|SR2_DISCLOSURE/);
  }
  for(const table of ['sr2_disclosure_profiles_v1','sr2_disclosure_profile_heads_v1','sr2_source_admission_heads_v1'])
   await assert.rejects(pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM gov_repo.${table} WHERE false;ROLLBACK;`),/SR2_IMMUTABLE/);
 });
 await check('uncommitted revocation uses prior committed state without head locks; rollback remains invisible',async()=>{
  const writer=pg.session('postgres');try{
   assert.equal((await writer.run(`BEGIN;SELECT 1 FROM gov_repo.sr2_repositories_v1 WHERE ${headWhere} FOR NO KEY UPDATE;
    UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=2 WHERE ${sourceWhere};`)).err,'');
   assert.equal((await read()).status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal((await writer.run('ROLLBACK;')).err,'');
   assert.equal((await read()).status,'SEMANTIC_CONTEXT_AVAILABLE');
  }finally{await writer.close();}
 });
 await check('revocation committed before acquisition blocks historical snapshot; subsequent re-enable has explicit revision',async()=>{
  await pg.owner(`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=2 WHERE ${sourceWhere};`);
  denied(await read(),'CONTENT_WITHHELD');
  await pg.owner(`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=true,head_revision=3 WHERE ${sourceWhere};`);
  assert.equal((await read()).status,'SEMANTIC_CONTEXT_AVAILABLE');
 });
 await check('real application roles cannot bypass RPC via any technical table or private helper',async()=>{
  for(const role of ['anon','authenticated','service_role'] as const){
   for(const table of allTables)await assert.rejects(pg.sql(`SELECT * FROM gov_repo.${table} LIMIT 0`,role),/42501/);
   await assert.rejects(pg.sql('SELECT gov_repo.sr2_disclosure_head_guard_v1()',role),/42501/);
   if(role!=='service_role')await assert.rejects(pg.sql('SELECT '+call(),role),/42501/);
   assert.equal(await pg.owner(`SELECT count(*) FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.proname LIKE 'sr2_%' AND has_function_privilege(${lit(role)},p.oid,'EXECUTE')`),'0');
  }
  assert.equal(await pg.owner(`SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='gov_repo'::regnamespace AND c.relname=ANY(ARRAY[${allTables.map(lit).join(',')}])`),'0');
 });
 await check('exact frozen successor catalog: three tables, nine CHECKs, three FKs, four indexes, two routines and six ALWAYS triggers',async()=>{
  const pin=JSON.parse(readFileSync(new URL('../fixtures/sr2-a2-catalog-v1.json',import.meta.url),'utf8'));
  const actual=JSON.parse(await pg.owner(a2CatalogQuery));assert.deepEqual(actual,pin.catalog);
  assert.equal(createHash('sha256').update(JSON.stringify(pin.dependencies)).digest('hex'),pin.dependency_manifest_sha256);
  assert.ok(pin.dependencies.extension.includes('l2_normalize(vector)'));
  assert.equal(actual.tables.length,3);assert.equal(actual.constraints.filter((x:any)=>x.type==='c').length,9);
  assert.equal(actual.constraints.filter((x:any)=>x.type==='f').length,3);assert.equal(actual.indexes.length,4);
  assert.equal(actual.functions.length,2);assert.equal(actual.triggers.length,6);assert.ok(actual.triggers.every((x:any)=>x.enabled==='A'));
 });
 await check('successor rejects body/config/ACL/overload/default/table/policy/RLS/trigger/operator dependency drift',async()=>{
  const post=a2Source().match(/DO \$a2_postflight\$[\s\S]*?END \$a2_postflight\$;/)![0];
  for(const sql of [
   'GRANT SELECT ON gov_repo.sr2_disclosure_profiles_v1 TO service_role;',
   'GRANT EXECUTE ON FUNCTION gov_repo.sr2_disclosure_head_guard_v1() TO PUBLIC;',
   'ALTER FUNCTION gov_repo.sr2_disclosure_head_guard_v1() SECURITY DEFINER;',
   "ALTER FUNCTION gov_repo.sr2_disclosure_head_guard_v1() SET search_path='public';",
   'ALTER TABLE gov_repo.sr2_disclosure_profiles_v1 DISABLE ROW LEVEL SECURITY;',
   'ALTER TABLE gov_repo.sr2_disclosure_profiles_v1 DISABLE TRIGGER sr2_disclosure_profiles_v1_immutable;',
   'CREATE POLICY unexpected ON gov_repo.sr2_disclosure_profiles_v1 USING(true);',
   "CREATE FUNCTION gov_repo.technical_semantic_context_search_v1(text) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';",
   "CREATE FUNCTION gov_repo.extra_a2_reader() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';",
   "CREATE OR REPLACE FUNCTION gov_repo.sr2_disclosure_head_guard_v1() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW;END';",
   'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
   'ALTER FUNCTION public.vector_norm(public.vector) RENAME TO unapproved_vector_norm;',
   'ALTER FUNCTION public.l2_normalize(public.vector) RENAME TO unapproved_l2_normalize;',
  ])await assert.rejects(pg.bootstrapSql('BEGIN;'+sql+'SET LOCAL ROLE postgres;'+post+'ROLLBACK;'),/SR2_A2_/);
 });
 for(const kind of ['FILE_DESCRIPTOR','CODE_REGION','DOCUMENTATION_REGION','CODE_SYMBOL'])await check('exact same-snapshot locator hydration '+kind,async()=>{
  const e=f.s.entries[1],l=kind==='CODE_SYMBOL'?symbol(e):chunk(e,kind);
  const sub=subject(f.s.k,kind==='CODE_SYMBOL'?'CODE_SYMBOL':'REPOSITORY_CHUNK',e.source_fingerprint,e.entry_id,null,kind==='CODE_SYMBOL'?null:l.locator_id,kind==='CODE_SYMBOL'?l.locator_id:null);
  const set=sourceSet(f.s,[sub],'ITEM_GROUNDING_V1',sub,'leaf '+kind),p=projection(f.s,set.row,[f.admissions[1]],[],{target:sub});
  const rows=[...(kind==='FILE_DESCRIPTOR'?[]:[{table:kind==='CODE_SYMBOL'?'symbol_locators':'chunk_locators',row:l},{table:'subjects',row:sub}]),...set.rows,...p.rows,representation(p.row,f.s.capture)];
  const x=await transaction('SET LOCAL statement_timeout=0;'+inserts(rows)+"SET LOCAL statement_timeout='5s';");
  const hit=x.hits.find((h:any)=>h.subject.id===sub.subject_id);assert.equal(hit.subject.locator.kind,kind);
  assert.equal(hit.subject.locator.relative_path,e.relative_path);assert.equal(hit.snapshot.snapshot_id,f.s.snap.snapshot_id);
  if(kind==='CODE_SYMBOL'){
   const table='sr2_symbol_locators_v1',drops=checkConstraints.filter(c=>c.table===table).map(c=>`ALTER TABLE gov_repo.${table} DROP CONSTRAINT ${c.name};`).join('');
   const forged=await corrupt(inserts(rows)+drops+`UPDATE gov_repo.${table} SET organisation_id=${lit(orgB)} WHERE ${headWhere};`);
   assert.equal(forged.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.deepEqual(forged.hits,[]);
  }
  assert.equal(parseValue(x).hits.length,2);
 });
 await check('selection recorded_at tie breaker is deterministic before ranking',async()=>{
  const p=plainProjection(f.s,f.primary.row,f.admissions,{safe_label:'recorded tie'});
  const r=representation(p.row,f.s.capture,{recorded_at:'2026-10-02'});
  const x=await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';");assert.equal(x.hits[0].representation_id,r.row.representation_id);
 });
 await check('legal maximum UTF-8 semantic-space B-tree keys insert without redesign',async()=>{
  const wide=(tag:string)=>Array.from({length:8},(_,i)=>H('WIDE_KEY',tag,i)).join('');
  const p=plainProjection(f.s,f.primary.row,f.admissions,{projection_schema_version:wide('schema'),safe_label:'wide space'});
  const r=representation(p.row,f.s.capture,{provider_id:wide('provider'),model_id:wide('model'),model_version:wide('version')});
  assert.equal(Buffer.byteLength(r.row.provider_id),512);
  await pg.owner('BEGIN;'+inserts([...p.rows,r])+'SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;');
  const profile=disclosureProfile(f.root.row,p.row,{disclosure_profile_version:'wide-space'});
  const value=await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r,{table:'disclosure_profiles',row:profile}])+
   `UPDATE gov_repo.sr2_disclosure_profile_heads_v1 SET disclosure_profile_version='wide-space',head_revision=head_revision+1 WHERE ${headWhere};SET LOCAL statement_timeout='5s';`,
   {p_schema:lit(p.row.projection_schema_version),p_provider:lit(r.row.provider_id),p_model:lit(r.row.model_id),p_version:lit(r.row.model_version)});
  assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(parseValue(value,f,value.embedding_space).hits.length,1);
 });
 await check('selective mixed-space EXPLAIN ANALYZE uses the single admitted B-tree equality/order path',async()=>{
  const distractors=Array.from({length:600},(_,i)=>representation(f.p.row,f.s.capture,{model_version:'unqueried-space-'+i}));
  const session=pg.session('postgres');try{
   assert.equal((await session.run('BEGIN;'+inserts(distractors)+'ANALYZE gov_repo.sr2_representations_v1;')).err,'');
   const query=`SELECT r.* FROM gov_repo.sr2_representations_v1 r WHERE ${headWhere} AND snapshot_id=${lit(f.s.snap.snapshot_id)}
    AND projection_schema_version=${lit(technicalSpace.projection_schema_version)} COLLATE "C" AND provider_id='fixture' COLLATE "C"
    AND model_id='fixture-model' COLLATE "C" AND model_version='exact-fixture-v1' COLLATE "C" AND dimension=3
    ORDER BY subject_id COLLATE "C",generated_at DESC,recorded_at DESC,representation_id COLLATE "C" LIMIT 10001`;
   const plan=await session.run('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query+';');assert.equal(plan.err,'');
   const parsed=JSON.parse(plan.out);const nodes=(p:any):any[]=>[p,...(p.Plans??[]).flatMap(nodes)];
   const scan=nodes(parsed[0].Plan).find(p=>p['Index Name']==='sr2_representations_v1_exact_space_read_idx');assert.ok(scan);
   for(const field of ['organisation_id','repository_id','snapshot_id','projection_schema_version','provider_id','model_id','model_version','dimension'])assert.ok(scan['Index Cond'].includes(field));
   assert.ok(!nodes(parsed[0].Plan).some(p=>p['Node Type']==='Sort'));
   t.diagnostic('Exact-space B-tree selective EXPLAIN ANALYZE: '+parsed[0]['Execution Time']+' ms');
  }finally{await session.run('ROLLBACK;');await session.close();}
 });
 await check('complete provenance exact 100/101 reference boundary without truncation',async()=>{
  const many=technicalFixture({count:20});await pg.owner(many.sql);
  for(const count of [14,15]){
   const sets=Array.from({length:count},(_,i)=>sourceSet(many.s,[many.s.subjects[0]],'ITEM_GROUNDING_V1',many.s.subjects[0],'ground '+i));
   const items=sets.map((s,i)=>facet(many.s.k,many.s.rootSubject,s.row,3,String(i)));
   const p=projection(many.s,many.primary.row,many.admissions,items,{label:'complete references '+count});
   const r=representation(p.row,many.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'});
   const reevaluations=many.s.entries.map(e=>admission(e,many.s.capture));
   const sql=inserts([...sets.flatMap(s=>s.rows),...p.rows,r,...reevaluations.map(row=>({table:'source_admissions',row}))])+
    reevaluations.map(a=>`UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(a.source_admission_id)},head_revision=2 WHERE organisation_id=${lit(orgA)} AND repository_id=${lit(many.root.row.repository_id)} AND entry_id=${lit(a.entry_id)};`).join('');
   const value=JSON.parse(await pg.bootstrapSql(`BEGIN;SET LOCAL ROLE postgres;${sql}RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';SELECT ${technicalRpc(actor,many)};ROLLBACK;`));
   if(count===14){assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(parseValue(value,many).hits.length,1);}else denied(value,'PROVENANCE_BOUND');
  }
 });
 await check('same statement snapshot survives a later committed revocation, next read denies, with no production barrier',async()=>{
  const signature='gov_repo.technical_semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,text,text,public.vector,text,text,text,integer,text,text,integer,double precision)';
  const definition=await pg.owner(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure)`);
  const marker='WITH acquired_clock AS MATERIALIZED (SELECT clock_timestamp() AS at),';assert.ok(definition.includes(marker));
  const instrumented=definition.replace(marker,'WITH acquired_clock AS MATERIALIZED (SELECT clock_timestamp() AS at FROM (SELECT pg_advisory_xact_lock(1752322)) test_snapshot_barrier),');
  const holder=pg.session('postgres'),reader=pg.session('service_role');let pending:Promise<{out:string;err:string}>|undefined;
  try{
   await pg.owner(instrumented);assert.equal((await holder.run('SELECT pg_advisory_lock(1752322);')).err,'');
   const pid=Number((await reader.run('BEGIN;SELECT pg_backend_pid();')).out);
   pending=reader.run(`SET LOCAL statement_timeout='5s';SELECT ${call()};`);
   let blocked=false;for(let i=0;i<80;i++){if(await pg.owner(`SELECT cardinality(pg_blocking_pids(${pid}))>0`)==='t'){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
   assert.ok(blocked,'data statement snapshot barrier observed in real backend');
   await pg.owner(`BEGIN;SELECT 1 FROM gov_repo.organisations WHERE organisation_id=${lit(orgA)} FOR KEY SHARE;
    SELECT 1 FROM gov_repo.governance_users WHERE user_id=${lit(actor.id)} FOR KEY SHARE;
    SELECT 1 FROM gov_repo.governance_roles WHERE role_id=ANY(SELECT unnest(role_ids) FROM gov_repo.governance_users WHERE user_id=${lit(actor.id)}) ORDER BY role_id FOR KEY SHARE;
    SELECT 1 FROM gov_repo.sr2_repositories_v1 WHERE ${headWhere} FOR NO KEY UPDATE;
    UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=head_revision+1 WHERE ${sourceWhere};COMMIT;`);
   assert.equal((await holder.run('SELECT pg_advisory_unlock(1752322);')).err,'');
   const answer=await pending;assert.equal(answer.err,'');assert.equal(JSON.parse(answer.out).status,'SEMANTIC_CONTEXT_AVAILABLE');
   await reader.run('COMMIT;');denied(await read(),'CONTENT_WITHHELD');
  }finally{
   await holder.run('SELECT pg_advisory_unlock_all();');await holder.close();await reader.close();
   await pg.owner(definition);
   await pg.owner(`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=true,head_revision=head_revision+1 WHERE ${sourceWhere} AND NOT enabled;`);
  }
  const pin=JSON.parse(readFileSync(new URL('../fixtures/sr2-a2-catalog-v1.json',import.meta.url),'utf8'));assert.deepEqual(JSON.parse(await pg.owner(a2CatalogQuery)),pin.catalog);
 });
 await check('10000 compatible versions are exact and complete; 10001 sentinel is unavailable without partial output',async()=>{
  const session=pg.session('m16_bootstrap');
  const catalog=JSON.parse(readFileSync(new URL('../fixtures/sr2-a1-catalog-v1.json',import.meta.url),'utf8'));
  const tables=['sr2_projections_v1','sr2_protected_projections_v1','sr2_projection_sources_v1'];
  const enable=catalog.triggers.filter((x:any)=>tables.some(name=>x.definition.includes(' ON gov_repo.'+name+' '))).map((x:any)=>{
   const table=tables.find(name=>x.definition.includes(' ON gov_repo.'+name+' '));return `ALTER TABLE gov_repo.${table} ENABLE ALWAYS TRIGGER ${x.name};`;
  }).join('');
  const disable=tables.map(name=>`ALTER TABLE gov_repo.${name} DISABLE TRIGGER USER;`).join('');
  const version=(i:number)=>{const p=plainProjection(f.s,f.primary.row,f.admissions,{safe_label:'scan version '+i});return [...p.rows,representation(p.row,f.s.capture,{generated_at:'2026-10-03',indexed_at:'2026-10-03',recorded_at:'2026-10-03'})];};
  try{
   assert.equal((await session.run('BEGIN;SET LOCAL ROLE postgres;'+disable)).err,'');
   for(let start=0;start<9999;start+=500){const rows=Array.from({length:Math.min(500,9999-start)},(_,j)=>version(start+j)).flat();
    assert.equal((await session.run(inserts(rows))).err,'');}
   assert.equal((await session.run('SET CONSTRAINTS ALL IMMEDIATE;'+enable+"RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';")).err,'');
   const atBound=await session.run('SELECT '+call()+';');assert.equal(atBound.err,'');assert.equal(JSON.parse(atBound.out).status,'SEMANTIC_CONTEXT_AVAILABLE');
   assert.equal((await session.run('RESET ROLE;SET LOCAL ROLE postgres;SET LOCAL statement_timeout=0;'+disable+inserts(version(9999))+enable+
    "RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';")).err,'');
   const over=await session.run('SELECT '+call()+';');assert.equal(over.err,'');denied(JSON.parse(over.out),'SCAN_BOUND');
  }finally{await session.run('ROLLBACK;');await session.close();}
 });
 await check('numeric amendment performance actual 384-dimensional RPC at 10000 versions and 128 scored subjects',async()=>{
  const n=technicalFixture({dimension:384,embedding:Array.from({length:384},(_,i)=>Math.sin(i+1)*0.1)});await pg.owner(n.sql);
  const session=pg.session('m16_bootstrap');
  const tables=['sr2_projections_v1','sr2_protected_projections_v1','sr2_projection_sources_v1'];
  const catalog=JSON.parse(readFileSync(new URL('../fixtures/sr2-a1-catalog-v1.json',import.meta.url),'utf8'));
  const disable=tables.map(name=>`ALTER TABLE gov_repo.${name} DISABLE TRIGGER USER;`).join('');
  const enable=catalog.triggers.filter((x:any)=>tables.some(name=>x.definition.includes(' ON gov_repo.'+name+' '))).map((x:any)=>
   `ALTER TABLE gov_repo.${tables.find(name=>x.definition.includes(' ON gov_repo.'+name+' '))} ENABLE ALWAYS TRIGGER ${x.name};`).join('');
  const embedding=n.rep.row.embedding;
  try{
   assert.equal((await session.run('BEGIN;SET LOCAL ROLE postgres;'+disable)).err,'');
   const subjects=Array.from({length:127},(_,i)=>{
    const start=i%90,end=start+1+Math.floor(i/90),l=chunk(n.s.entries[0],'CODE_REGION');
    Object.assign(l,{byte_start:start,byte_end:end,line_start:1,line_end:1});
    l.locator_id=H('CHUNK_LOCATOR',...keys(l),l.entry_id,l.source_fingerprint,l.locator_class,'1',start,'1',end,'1',1,'1',1,l.decoding_id,l.chunker_id,l.chunker_version);
    const sub=subject(n.s.k,'REPOSITORY_CHUNK',l.source_fingerprint,l.entry_id,null,l.locator_id,null),set=sourceSet(n.s,[sub],'ITEM_GROUNDING_V1',sub,'benchmark '+i);
    const p=projection(n.s,set.row,n.admissions,[],{target:sub,label:'scored subject '+i});
    return [{table:'chunk_locators',row:l},{table:'subjects',row:sub},...set.rows,...p.rows,representation(p.row,n.s.capture,{dimension:384,embedding})];
   }).flat();assert.equal((await session.run(inserts(subjects))).err,'');
   for(let start=0;start<9872;start+=400){
    const rows=Array.from({length:Math.min(400,9872-start)},(_,j)=>{
     const p=plainProjection(n.s,n.primary.row,n.admissions,{safe_label:'benchmark version '+(start+j)});
     return [...p.rows,representation(p.row,n.s.capture,{dimension:384,embedding})];
    }).flat();assert.equal((await session.run(inserts(rows))).err,'');
   }
   assert.equal((await session.run('SET CONSTRAINTS ALL IMMEDIATE;'+enable+
    `SELECT count(*)||','||count(DISTINCT subject_id) FROM gov_repo.sr2_representations_v1 WHERE organisation_id=${lit(orgA)} AND repository_id=${lit(n.root.row.repository_id)};`)).out,'10000,128');
   assert.equal((await session.run("RESET ROLE;SET LOCAL ROLE service_role;SET LOCAL statement_timeout='5s';")).err,'');
   const durations:number[]=[];
   for(let i=0;i<3;i++){
    const at=performance.now(),result=await session.run('SELECT '+technicalRpc(actor,n,{p_query:lit(JSON.stringify(unit(384)))})+';');durations.push(performance.now()-at);
    assert.equal(result.err,'');const value=JSON.parse(result.out);assert.equal(value.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(value.hits.length,20);
    parseValue(value,n,{...technicalSpace,dimension:384});assert.ok(durations[i]<5000);
   }
   t.diagnostic(JSON.stringify({benchmark:'actual principal-bound A2 RPC',dimensions:384,compatible_versions:10000,scored_subjects:128,returned_hits:20,runs_ms:durations,maximum_ms:Math.max(...durations),budget_ms:5000}));
  }finally{await session.run('ROLLBACK;');await session.close();}
 });
 await check('complete response exceeding 256 KiB returns bounded unavailable with no partial hits',async()=>{
  const large=technicalFixture({count:20});await pg.owner(large.sql);
  const rows=large.s.subjects.flatMap((sub,i)=>{
   const set=sourceSet(large.s,large.s.subjects,'MODULE_MEMBERS_V1',sub,'response dictionary '+i);
   const p=projection(large.s,set.row,large.admissions,[],{target:sub,label:'complete hit '+i});
   return [...set.rows,...p.rows,representation(p.row,large.s.capture)];
  });
  await pg.owner('BEGIN;'+inserts(rows)+'COMMIT;');
  const x=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,large))));denied(x,'RESPONSE_BOUND');
  assert.ok(Buffer.byteLength(JSON.stringify(x))<262144);
 });
 await check('full SHA256 revision and maximum sanitized path hydrate without currentness inference or truncation',async()=>{
  const exact=technicalFixture({scheme:'GIT_SHA256_V1',entryOverrides:{relative_path:'a/'+'f'.repeat(1022)}});await pg.owner(exact.sql);
  const value=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,exact))));const parsed=parseValue(value,exact);
  assert.equal(parsed.scope!.revision_scheme,'GIT_SHA256_V1');assert.equal(parsed.scope!.full_revision.length,64);
  assert.equal(Buffer.byteLength(parsed.hits[0].support.entries[0].relative_path),1024);
  assert.equal(parsed.hits[0].currentness.state,'HISTORICAL_AT_REQUESTED_REVISION');
  const bad=technicalFixture({entryOverrides:{relative_path:'a/'+'f'.repeat(1023)}});await assert.rejects(pg.owner(bad.sql),/23514/);
 });
 await check('empty immutable snapshot needs no disclosure head to report no compatible storage',async()=>{
  const root=repository(),empty=snapshot(root.row,0);await pg.owner('BEGIN;'+root.sql+inserts(empty.rows)+'COMMIT;');
  const value=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,{...f,root,s:empty}))));denied(value,'NO_COMPATIBLE_REPRESENTATIONS');assert.equal(value.scope.manifest_entry_count,'0');
 });
 await check('empty admitted collection is distinct from absent collection',async()=>{
  const p=projection(f.s,f.primary.row,f.admissions,[],{label:'empty dependency dictionary',empty:[2]});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-04',indexed_at:'2026-10-04',recorded_at:'2026-10-04'});
  const value=parseValue(await transaction('SET LOCAL statement_timeout=0;'+inserts([...p.rows,r])+"SET LOCAL statement_timeout='5s';"));
  assert.deepEqual(value.hits[0].projection.protected.facets.dependencies!.items,[]);assert.equal(value.hits[0].projection.protected.facets.modules,null);
 });
 for(const scope of ['PACKAGE_MEMBERS_V1','MODULE_MEMBERS_V1','SERVICE_MEMBERS_V1'])await check('summary independently grounded in '+scope,async()=>{
  const set=sourceSet(f.s,[f.s.subjects[0]],scope,f.s.subjects[0],'summary '+scope);
  const p=projection(f.s,f.primary.row,f.admissions,[facet(f.s.k,f.s.rootSubject,set.row,4)],{label:'summary '+scope});
  const r=representation(p.row,f.s.capture,{generated_at:'2026-10-04',indexed_at:'2026-10-04',recorded_at:'2026-10-04'});
  const value=parseValue(await transaction('SET LOCAL statement_timeout=0;'+inserts([...set.rows,...p.rows,r])+"SET LOCAL statement_timeout='5s';"));
  assert.equal(value.hits[0].projection.protected.facets.summary!.items[0].grounding_set_id,set.row.source_set_id);
  assert.equal(value.hits[0].support.source_sets.length,2);
 });
 await check('bad newest subject invalidates the complete domain even below threshold beside a valid subject',async()=>{
  const sub=f.s.subjects[0],set=sourceSet(f.s,[sub],'ITEM_GROUNDING_V1',sub,'no hidden exclusion');
  const p=plainProjection(f.s,set.row,[f.admissions[0]],{subject_id:sub.subject_id,source_fingerprint:sub.source_fingerprint,handling_recipe_version:'v3',safe_label:'blocked leaf'});
  const r=representation(p.row,f.s.capture,{embedding:'[-1,0,0]'});
  denied(await transaction('SET LOCAL statement_timeout=0;'+inserts([...set.rows,...p.rows,r])+"SET LOCAL statement_timeout='5s';",{p_threshold:'0.5'}),'CONTENT_WITHHELD');
 });
 await check('exact cosine, inclusive thresholds and 20-hit ceiling preserve complete per-hit support',async()=>{
  const one=technicalFixture();await pg.owner(one.sql);
  const regions=Array.from({length:20},(_,i)=>{
   const l=chunk(one.s.entries[0],'CODE_REGION');Object.assign(l,{byte_start:i,byte_end:i+1,line_start:1,line_end:1});
   l.locator_id=H('CHUNK_LOCATOR',...keys(l),l.entry_id,l.source_fingerprint,l.locator_class,'1',i,'1',i+1,'1',1,'1',1,l.decoding_id,l.chunker_id,l.chunker_version);
   const sub=subject(one.s.k,'REPOSITORY_CHUNK',l.source_fingerprint,l.entry_id,null,l.locator_id,null),set=sourceSet(one.s,[sub],'ITEM_GROUNDING_V1',sub,'rank '+i);
   const p=projection(one.s,set.row,one.admissions,[],{target:sub,label:'rank '+i}),r=representation(p.row,one.s.capture,{embedding:i===0?'[1,0,0]':i===1?'[1,1,0]':'[0,1,0]'});
   return {sub,rows:[{table:'chunk_locators',row:l},{table:'subjects',row:sub},...set.rows,...p.rows,r]};
  });await pg.owner('BEGIN;'+inserts(regions.flatMap(r=>r.rows))+'COMMIT;');
  const value=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,one))));const parsed=parseValue(value,one);assert.equal(parsed.hits.length,20);
  assert.deepEqual(parsed.hits.slice(0,3).map(h=>h.subject.id),[regions[0].sub.subject_id,one.s.rootSubject.subject_id,regions[1].sub.subject_id]);
  const inclusive=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,one,{p_threshold:'1'}))));assert.equal(inclusive.hits.length,2);
  const limit=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,one,{p_limit:'1'}))));assert.equal(limit.hits.length,1);
  assert.doesNotMatch(JSON.stringify(value),/"(?:embedding|vector|cosine|similarity|confidence|probability|risk_score|governance_score)"/);
 });
 await check('normalized ranking identical then partial then orthogonal then opposite with bytewise ties',async()=>{
  const n=technicalFixture({count:4});await pg.owner(n.sql);
  const vectors=['[1,0,0]','[1,1,0]','[0,1,0]','[-1,0,0]'];
  const children=n.s.subjects.map((sub,i)=>{
   const set=sourceSet(n.s,[sub],'ITEM_GROUNDING_V1',sub,'ordered '+i),p=projection(n.s,set.row,[n.admissions[i]],[],{target:sub});
   return [...set.rows,...p.rows,representation(p.row,n.s.capture,{embedding:vectors[i]})];
  }).flat();await pg.owner('BEGIN;'+inserts(children)+'COMMIT;');
  const value=JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,n))));parseValue(value,n);
  assert.deepEqual(value.hits.map((h:any)=>h.subject.id),[n.s.subjects[0].subject_id,n.s.rootSubject.subject_id,...n.s.subjects.slice(1).map(s=>s.subject_id)]);
  assert.deepEqual(value.hits.map((h:any)=>h.retrieval_relevance.rank),[1,2,3,4,5]);
 });
 await check('atomic profile and source head movement produces complete old or complete new disclosure',async()=>{
  const n=technicalFixture();await pg.owner(n.sql);const writer=pg.session('postgres');
  const where=`organisation_id=${lit(orgA)} AND repository_id=${lit(n.root.row.repository_id)}`;
  const current=admission(n.s.entries[0],n.s.capture),profile=disclosureProfile(n.root.row,n.p.row,{disclosure_profile_version:'atomic-v2'});
  const get=async()=>JSON.parse(await pg.svc(scopedRead(technicalRpc(actor,n))));
  try{
   assert.equal((await writer.run('BEGIN;'+insert({table:'source_admissions',row:current})+insert({table:'disclosure_profiles',row:profile})+
    `UPDATE gov_repo.sr2_disclosure_profile_heads_v1 SET disclosure_profile_version='atomic-v2',head_revision=2 WHERE ${where};
     UPDATE gov_repo.sr2_source_admission_heads_v1 SET source_admission_id=${lit(current.source_admission_id)},head_revision=2 WHERE ${where};`)).err,'');
   const before=await get();assert.equal(before.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(before.hits[0].disclosure.profile_version,'v1');
   assert.equal(before.hits[0].support.admissions[0].current.source_admission_id,n.admissions[0].source_admission_id);
   assert.equal((await writer.run('COMMIT;')).err,'');
   const after=await get();assert.equal(after.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(after.hits[0].disclosure.profile_version,'atomic-v2');
   assert.equal(after.hits[0].support.admissions[0].current.source_admission_id,current.source_admission_id);parseValue(after,n);
  }finally{await writer.run('ROLLBACK;');await writer.close();}
 });
 await check('future writer fixture serializes root and ordered source heads; stale CAS cannot overwrite',async()=>{
  const n=technicalFixture({count:2});await pg.owner(n.sql);
  const first=pg.session('postgres'),second=pg.session('postgres'),where=`organisation_id=${lit(orgA)} AND repository_id=${lit(n.root.row.repository_id)}`;
  try{
   assert.equal((await first.run(`BEGIN;SELECT 1 FROM gov_repo.sr2_repositories_v1 WHERE ${where} FOR NO KEY UPDATE;
    SELECT entry_id FROM gov_repo.sr2_source_admission_heads_v1 WHERE ${where} ORDER BY entry_id COLLATE "C" FOR UPDATE;`)).err,'');
   const pid=Number((await second.run('SELECT pg_backend_pid();')).out);
   const waiting=second.run(`BEGIN;SELECT 1 FROM gov_repo.sr2_repositories_v1 WHERE ${where} FOR NO KEY UPDATE;`);
   let blocked=false;for(let i=0;i<80;i++){if(await pg.owner(`SELECT cardinality(pg_blocking_pids(${pid}))>0`)==='t'){blocked=true;break;}await new Promise(r=>setTimeout(r,25));}
   assert.ok(blocked,'real root lock serialization observed');
   assert.equal((await first.run(`UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=false,head_revision=2 WHERE ${where};COMMIT;`)).err,'');
   assert.equal((await waiting).err,'');
   const stale=await second.run(`WITH changed AS (UPDATE gov_repo.sr2_source_admission_heads_v1 SET enabled=true,head_revision=2 WHERE ${where} AND head_revision=1 RETURNING 1) SELECT count(*) FROM changed;ROLLBACK;`);
   assert.equal(stale.err,'');assert.equal(stale.out,'0');
  }finally{await first.run('ROLLBACK;');await second.run('ROLLBACK;');await first.close();await second.close();}
 });
});
