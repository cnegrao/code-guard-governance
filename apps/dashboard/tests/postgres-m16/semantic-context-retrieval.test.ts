import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { semanticCluster,fixture,corruptBegin,rpc,bounded,representation,support,successorPostflight,semanticSource,lit,orgA,orgB } from '../helpers/semantic-retrieval-fixtures';
import { ledgerRepo } from '../helpers/ledger-v2-foundation-fixtures';
import { Pool } from 'pg';
import { createSemanticRetrievalAdapter,createQueryEmbeddingSource,QUERY_RECIPE,SemanticAuthorizationError } from '../../lib/governance/semantic-context-retrieval';
import { space } from '../helpers/semantic-retrieval-fixtures';
import { operationalCluster } from '../helpers/sr2-a3-fixtures';
import { applyM1, m1Sr1Postflight } from '../helpers/sr1-numeric-fixtures';

test('C3-SR1 real PG17/pgvector canonical replay and bounded principal read',{timeout:900000},async t=>{
 const atM1=process.env.GOVIA_SR1_TEST_M1==='1';
 const pg=await (atM1?operationalCluster:semanticCluster)(m=>t.diagnostic(m));t.after(()=>pg.stop());
 if(atM1)await applyM1(pg);
 const postflight=atM1?await m1Sr1Postflight(pg.owner,successorPostflight()):successorPostflight();
 t.diagnostic(`SR1 complete regression horizon: ${atM1?'M1 / 107 migrations':'historical SR1 / 103 migrations'}`);
 const {owner,svc,bootstrapSql}=pg;
 await bootstrapSql(`BEGIN; SET LOCAL session_replication_role=replica; ${fixture} COMMIT;`);
 const a=await pg.actor(orgA),b=await pg.actor(orgB);
 const read=async(overrides:Record<string,string>={},actor=a)=>JSON.parse(await svc(bounded(`SELECT ${rpc(actor,overrides)}`)));
 const corrupt=async(sql:string,overrides:Record<string,string>={})=>JSON.parse(await bootstrapSql(`${corruptBegin}${sql}
   SET LOCAL ROLE service_role; SELECT ${rpc(a,overrides)}; ROLLBACK;`));
 const unavailable=async(sql:string,reason='INVALID_REPRESENTATION_SUPPORT')=>{
   const x=await corrupt(sql);assert.equal(x.status,'SEMANTIC_CONTEXT_UNAVAILABLE');assert.equal(x.reason,reason);assert.deepEqual(x.hits,[]);
 };
 await t.test('admitted horizon preserves prior routines and rejects historical SR1 reapplication',async()=>{
   await assert.rejects(owner(semanticSource()),/SR1_UNAPPROVED_STARTING_CATALOG/);
   await owner(postflight);
   assert.equal(await owner("SELECT count(*) FROM pg_proc WHERE pronamespace='gov_repo'::regnamespace AND proname='coding_memory_search'"),'0');
   const expected=JSON.parse(readFileSync(join(ledgerRepo,'apps/dashboard/tests/fixtures/semantic-retrieval-catalog-v1.json'),'utf8'));
   assert.equal(expected.routines.length,424);assert.ok(expected.routines.find((r:any)=>r.identity.includes('agent_semantic_search')));
 });
 await t.test('principal A/B return their own subject only; score is rank-only reference with safe provenance',async()=>{
   const x=await read(),y=await read({},b);
   assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.deepEqual(x.hits.map((h:any)=>h.subject.id),['object-a']);
   assert.deepEqual(y.hits.map((h:any)=>h.subject.id),['object-b']);
   const h=x.hits[0];assert.equal(h.source_freshness,'UNKNOWN');assert.equal(h.assurance,false);assert.equal(h.canonical_decision,false);
   assert.equal(h.provenance.evidence[0].content_hash,'hash-a');assert.equal(h.retrieval_relevance.rank,1);
   assert.equal(h.content_projection.original_embedding_content,'NOT_STORED');
   assert.doesNotMatch(JSON.stringify(x),/secret|confidence|envelope|external_id|"vector"|relevance":\d/);
 });
 await t.test('typed server adapter -> real parameterized pg transport -> RPC -> closed immutable DTO',async()=>{
   const port=Number(await owner('SELECT inet_server_port()'));
   const pool=new Pool({host:'127.0.0.1',port,database:'postgres',user:'service_role',password:'',ssl:false,options:'',max:1,connectionTimeoutMillis:5000});
   try {
     const adapter=createSemanticRetrievalAdapter(pool);
     const output=await createQueryEmbeddingSource({space,query_recipe:QUERY_RECIPE,model_version_verified:true},
       {embedQuestion:async()=>({space,query_recipe:QUERY_RECIPE,vector:[1,0,0]})})('question');assert.ok('query' in output);
     const now=Math.floor(Date.now()/1000),principal={organisationId:a.org,userId:a.id,credentialEpoch:a.epoch,issuedAtSeconds:now-10,expiresAtSeconds:now+3600,informational:{}};
     const result=await adapter.retrieveSemanticContext(principal,output.query,{limit:5,threshold:0.1,policy_version:'EXACT_COSINE_V1'});
     assert.equal(result.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(result.hits[0].subject.id,'object-a');assert.ok(Object.isFrozen(result.hits[0]));
     await assert.rejects(adapter.retrieveSemanticContext({...principal,organisationId:orgB},output.query,{limit:5,threshold:0.1,policy_version:'EXACT_COSINE_V1'}),SemanticAuthorizationError);
     const reset=await pool.query('SHOW statement_timeout');assert.equal(reset.rows[0].statement_timeout,'0','transaction deadline does not pollute pooled connection');
   } finally {await pool.end();}
 });
 for(const [label,sql] of Object.entries<Record<string,string>>({
   foreign_organisation:{p_verified_organisation_id:lit(orgB)},missing_actor:{p_verified_actor_user_id:lit('00000000-0000-4000-8000-000000000000')},
   stale_epoch:{p_verified_credential_epoch:"'2000-01-01'"},microsecond_epoch:{p_verified_credential_epoch:`${lit(a.epoch)}::timestamptz+interval '1 microsecond'`},
   expired:{p_verified_session_exp:'1'},future_iat:{p_verified_session_iat:'9999999999'},invalid_timing:{p_verified_session_iat:'1',p_verified_session_exp:'0'}
 })) await t.test(`authorization fails explicitly: ${label}`,async()=>{await assert.rejects(read(sql),/GV00[1-4]/);});
 for(const [label,sql] of Object.entries({
   inactive_actor:`UPDATE gov_repo.governance_users SET status='suspended' WHERE user_id='${a.id}';`,
   inactive_org:`UPDATE gov_repo.organisations SET is_active=false WHERE organisation_id='${orgA}';`,
   moved_membership:`UPDATE gov_repo.governance_users SET organisation_id='${orgB}' WHERE user_id='${a.id}';`,
   unresolved_role:`UPDATE gov_repo.governance_users SET role_ids=ARRAY['00000000-0000-4000-8000-000000000000']::uuid[] WHERE user_id='${a.id}';`
 })) await t.test(`persisted eligibility fails: ${label}`,async()=>{
   await assert.rejects(bootstrapSql(`BEGIN; ${sql} SET LOCAL ROLE service_role; SELECT ${rpc(a)}; ROLLBACK;`),/GV00[1-4]/);
 });
 for(const [label,sql] of Object.entries({
   foreign_canonical:`UPDATE gov_repo.semantic_representations SET subject_canonical_object_id='object-b' WHERE representation_id='a';`,
   missing_subject:`UPDATE gov_repo.semantic_representations SET subject_canonical_object_id='missing' WHERE representation_id='a';`,
   wrong_actual_kind:`UPDATE gov_repo.semantic_representations SET subject_canonical_object_kind='TOOL' WHERE representation_id='a';`,
   foreign_candidate:representation('foreign-candidate','candidate-only-b',{family:'NORMALIZED_CANDIDATE'})+support('foreign-candidate'),
   foreign_assertion:`INSERT INTO gov_repo.semantic_representation_assertions VALUES('${orgA}','a','foreign-assertion');`,
   orphan_assertion:`INSERT INTO gov_repo.semantic_representation_assertions VALUES('${orgA}','a','missing');`,
   foreign_evidence:`UPDATE gov_repo.semantic_representation_evidence SET evidence_id='foreign-evidence' WHERE representation_id='a';`,
   orphan_evidence:`UPDATE gov_repo.semantic_representation_evidence SET evidence_id='missing' WHERE representation_id='a';`,
   missing_support:`DELETE FROM gov_repo.semantic_representation_evidence WHERE representation_id='a';`,
   future_generation:`UPDATE gov_repo.semantic_representations SET generated_at=clock_timestamp()+interval '1 day' WHERE representation_id='a';`,
   infinite_generation:`UPDATE gov_repo.semantic_representations SET generated_at='infinity' WHERE representation_id='a';`,
   zero_stored_vector:`UPDATE gov_repo.semantic_representations SET embedding='[0,0,0]' WHERE representation_id='a';`,
   oversized_fingerprint:`UPDATE gov_repo.semantic_representations SET content_fingerprint_value=repeat('é',257) WHERE representation_id='a';`
 })) await t.test(`corrupt fixture fails acquisition without UUID-only leakage: ${label}`,async()=>{await unavailable(sql);});
 await t.test('foreign candidate exists but only in B: same candidate id cannot cross tenant',async()=>{
   await unavailable(`INSERT INTO gov_repo.discovery_candidates SELECT '${orgB}', 'candidate-only-b',candidate_kind,candidate_family,finding_id,source_connection_id,
     source_external_type,source_external_id,confidence,requires_reconciliation,proposed_identity,relationship_type_code,source_endpoint,target_endpoint,
     acquisition_run_id,contract_version,envelope,envelope_hash,created_at FROM gov_repo.discovery_candidates LIMIT 1;
     ${representation('foreign-candidate','candidate-only-b',{family:'NORMALIZED_CANDIDATE',kind:'RELATIONSHIP'})}${support('foreign-candidate')}`);
 });
 await t.test('identical representation/evidence/assertion ids in both tenants still join only their organisation',async()=>{
   const x=await corrupt(representation('a','object-b',{org:orgB,vector:'[0,1,0]'})+
     `INSERT INTO gov_repo.discovery_evidence SELECT '${orgB}','evidence',handling,captured_at,'FOREIGN_HASH',contract_version,envelope,envelope_hash,created_at
       FROM gov_repo.discovery_evidence WHERE organisation_id='${orgA}' AND evidence_id='evidence';
      INSERT INTO gov_repo.source_assertions SELECT '${orgB}','assertion',run_id,source_connection_id,source_external_type,source_external_id,snapshot_id,snapshot_content_hash,
       snapshot_observed_at,snapshot_source_version,'FOREIGN_METHOD',method_version,trust_state,confidence,observed_at,synced_at,recorded_at,contract_version,envelope,envelope_hash,created_at
       FROM gov_repo.source_assertions WHERE organisation_id='${orgA}' AND assertion_id='assertion';
      INSERT INTO gov_repo.semantic_representation_assertions VALUES('${orgA}','a','assertion'),('${orgB}','a','assertion');
      INSERT INTO gov_repo.semantic_representation_evidence VALUES('${orgB}','a','evidence');`);
   assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(x.hits.length,1);
   assert.equal(x.hits[0].provenance.evidence[0].content_hash,'hash-a');assert.equal(x.hits[0].provenance.assertions[0].method_code,'STATIC_SCAN');
   assert.doesNotMatch(JSON.stringify(x),/FOREIGN/);
 });
 for(const [field,value] of Object.entries({p_provider:"'different-provider'",p_model:"'different-model'",p_version:"'different-version'",p_schema:"'Different-schema'",
   p_dimension:'2,p_query=>\'[1,0]\''})) await t.test(`exact space mismatch has no compatible population: ${field}`,async()=>{
     const opts=field==='p_dimension'?{p_dimension:'2',p_query:"'[1,0]'"}:{[field]:value};
     const x=await read(opts);assert.equal(x.reason,'NO_COMPATIBLE_REPRESENTATIONS');assert.equal(x.status,'SEMANTIC_CONTEXT_UNAVAILABLE');
   });
 await t.test('case-sensitive model identity; same dimension different model and wrong dimensions are never compared',async()=>{
   const x=await corrupt(representation('wrong-dimension','object-a2',{dimension:2,vector:'[1,0]'})+support('wrong-dimension')+
     representation('wrong-model','object-a2',{model:'Fixture-model',vector:'[0,0,0]'})+support('wrong-model'));
   assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.deepEqual(x.hits.map((h:any)=>h.representation_id),['a']);
 });
 for(const [label,opts] of Object.entries<Record<string,string>>({zero:{p_query:"'[0,0,0]'"},nan:{p_query:"'[NaN,0,0]'"},infinity:{p_query:"'[Infinity,0,0]'"},
   actual_dimension:{p_query:"'[1,0]'"},missing_provider:{p_provider:'NULL'},empty_provider:{p_provider:"' '"},latest:{p_version:"'latest'"},default:{p_model:"'default'"},
   zero_limit:{p_limit:'0'},large_limit:{p_limit:'21'},null_limit:{p_limit:'NULL'},nan_threshold:{p_threshold:"'NaN'"},infinite_threshold:{p_threshold:"'Infinity'"},threshold_range:{p_threshold:'1.1'}
 })) await t.test(`invalid query/options rejected: ${label}`,async()=>{await assert.rejects(read(opts),/22023|22P02|22000/);});
 await t.test('empty role array remains eligible for derived reads under unchanged canonical session helper',async()=>{
   const x=JSON.parse(await bootstrapSql(`BEGIN; SET LOCAL statement_timeout='5s'; UPDATE gov_repo.governance_users SET role_ids=ARRAY[]::uuid[] WHERE user_id='${a.id}';
     SET LOCAL ROLE service_role; SELECT ${rpc(a)}; ROLLBACK;`));
   assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');
 });
 await t.test('compatible nonempty space with no threshold matches differs from unavailable',async()=>{
   const x=await read({p_query:"'[-1,0,0]'",p_threshold:'0.5'});
   assert.equal(x.status,'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE');assert.equal(x.reason,null);assert.deepEqual(x.hits,[]);
 });
 await t.test('newest generated snapshot before cosine; old more-similar embedding cannot dominate',async()=>{
   const x=await corrupt(representation('newest','object-a',{vector:'[0,1,0]',generated:'2026-10-02'})+support('newest'));
   assert.deepEqual(x.hits.map((h:any)=>h.representation_id),['newest']);assert.equal(x.hits[0].source_freshness,'UNKNOWN');
 });
 await t.test('created timestamp breaks generation tie; bytewise id breaks exact timestamp tie',async()=>{
   const x=await corrupt(representation('z','object-a',{created:'2026-10-02'})+support('z')+
     representation('aa','object-a',{created:'2026-10-02'})+support('aa'));
   assert.deepEqual(x.hits.map((h:any)=>h.representation_id),['aa']);
 });
 await t.test('newest unsupported row does not fall back to older supported history',async()=>{
   await unavailable(representation('newest-unsupported','object-a',{generated:'2026-10-02'}));
 });
 await t.test('same subject in another space independent; candidate/canonical exact ids remain distinct',async()=>{
   const x=await corrupt(representation('other-space','object-a',{model:'other',generated:'2026-10-03'})+support('other-space')+
     representation('candidate','object-a',{family:'NORMALIZED_CANDIDATE',kind:'RELATIONSHIP'})+support('candidate'));
   assert.equal(x.hits.length,2);assert.deepEqual(x.hits.map((h:any)=>h.subject.family),['CANONICAL_OBJECT','NORMALIZED_CANDIDATE']);
   assert.equal(x.hits[1].subject.kind,'RELATIONSHIP');assert.equal(x.hits[1].governed_relationships,false);
 });
 await t.test('cosine nearest order, inclusive threshold, top-K and stable exact tie',async()=>{
   const sql=representation('second','object-a2',{vector:'[0.8,0.6,0]'})+support('second');
   const x=await corrupt(sql);assert.deepEqual(x.hits.map((h:any)=>h.representation_id),['a','second']);
   assert.equal((await corrupt(sql,{p_limit:'1'})).hits.length,1);
   assert.equal((await corrupt(sql,{p_threshold:'1'})).hits.length,1);
   const tied=await corrupt(representation('tie','object-a2')+support('tie'));
   assert.deepEqual(tied.hits.map((h:any)=>h.subject.id),['object-a','object-a2']);
 });
 await t.test('assertion-only support projects safe scalars; both support families preserve complete references',async()=>{
   const sql=`INSERT INTO gov_repo.semantic_representation_assertions VALUES('${orgA}','a','assertion');`;
   const both=await corrupt(sql);assert.equal(both.hits[0].provenance.assertions.length,1);assert.equal(both.hits[0].provenance.evidence.length,1);
   const only=await corrupt(sql+`DELETE FROM gov_repo.semantic_representation_evidence WHERE representation_id='a';`);
   assert.equal(only.hits[0].provenance.evidence.length,0);assert.equal(only.hits[0].provenance.assertions[0].trust_state,'INFERRED');
   assert.doesNotMatch(JSON.stringify(only),/confidence|private|secret|envelope/);
 });
 await t.test('100 complete provenance refs accepted; 101 fails with explicit bound',async()=>{
   const base=`DELETE FROM gov_repo.semantic_representation_evidence WHERE representation_id='a';
     INSERT INTO gov_repo.discovery_evidence SELECT '${orgA}','e-'||n,'HASH_ONLY','2026-10-01','hash','v1','{}',repeat('a',64),now() FROM generate_series(1,101) n;`;
   const links=(n:number)=>`INSERT INTO gov_repo.semantic_representation_evidence SELECT '${orgA}','a','e-'||n FROM generate_series(1,${n}) n;`;
   assert.equal((await corrupt(base+links(100))).hits[0].provenance.evidence.length,100);
   await unavailable(base+links(101),'PROVENANCE_BOUND');
 });
 await t.test('10001 compatible historical rows return SCAN_BOUND rather than partial top-K',async()=>{
   await unavailable(`INSERT INTO gov_repo.semantic_representations SELECT organisation_id,'history-'||n,subject_kind,subject_canonical_object_id,subject_canonical_object_kind,
     subject_candidate_id,subject_candidate_kind,projection_schema_version,content_fingerprint_algorithm,content_fingerprint_schema_version,content_fingerprint_value,
     embedding_provider_id,embedding_model_id,embedding_model_version,embedding_dimension,embedding,generated_at,created_at
     FROM gov_repo.semantic_representations CROSS JOIN generate_series(1,10000) n WHERE representation_id='a';`,'SCAN_BOUND');
 });
 await t.test('10000 compatible versions complete the bounded search without duplicate subject dominance',async()=>{
   const x=await corrupt(`INSERT INTO gov_repo.semantic_representations SELECT organisation_id,'history-'||n,subject_kind,subject_canonical_object_id,subject_canonical_object_kind,
     subject_candidate_id,subject_candidate_kind,projection_schema_version,content_fingerprint_algorithm,content_fingerprint_schema_version,content_fingerprint_value,
     embedding_provider_id,embedding_model_id,embedding_model_version,embedding_dimension,embedding,generated_at,created_at
     FROM gov_repo.semantic_representations CROSS JOIN generate_series(1,9999) n WHERE representation_id='a';`);
   assert.equal(x.status,'SEMANTIC_CONTEXT_AVAILABLE');assert.equal(x.hits.length,1);assert.equal(x.hits[0].representation_id,'a');
 });
 await t.test('response >256KiB fails acquisition, never silently drops support',async()=>{
   const sql=`INSERT INTO gov_repo.discovery_evidence SELECT '${orgA}',repeat('e',480)||n,'HASH_ONLY','2026-10-01',repeat('h',512),'v1','{}',repeat('a',64),now() FROM generate_series(1,100) n;
     INSERT INTO gov_repo.semantic_representation_evidence SELECT '${orgA}','a',repeat('e',480)||n FROM generate_series(1,100) n;
     DELETE FROM gov_repo.semantic_representation_evidence WHERE evidence_id='evidence';`;
   // Three valid distinct subjects, each with complete bounded support.
   await unavailable(sql+representation('r2','object-a2')+representation('r3','object-a',{family:'NORMALIZED_CANDIDATE',kind:'RELATIONSHIP'})+
     `INSERT INTO gov_repo.semantic_representation_evidence SELECT '${orgA}',r,repeat('e',480)||n FROM unnest(ARRAY['r2','r3']) r CROSS JOIN generate_series(1,100) n;`,'RESPONSE_BOUND');
 });
 await t.test('request deadline required before SELECT; no function-local timeout claim',async()=>{
   const x=JSON.parse(await svc(`SELECT ${rpc(a)}`));assert.equal(x.reason,'EXECUTION_BUDGET_REQUIRED');
   const y=JSON.parse(await svc(`BEGIN; SET LOCAL statement_timeout='6s'; SELECT ${rpc(a)}; COMMIT;`));assert.equal(y.reason,'EXECUTION_BUDGET_REQUIRED');
 });
 await t.test('actual statement cancellation interrupts waiting retrieval SQL',async()=>{
   const locker=pg.session('postgres');t.after(()=>locker.close());
   assert.equal((await locker.run('BEGIN; LOCK TABLE gov_repo.semantic_representations IN ACCESS EXCLUSIVE MODE;')).err,'');
   await assert.rejects(svc(`BEGIN; SET LOCAL statement_timeout='150ms'; SELECT ${rpc(a)}; COMMIT;`),/57014[\s\S]*canceling statement due to statement timeout/);
   await locker.run('ROLLBACK;');
 });
 await t.test('eligibility locks block moved membership until retrieval transaction ends',async()=>{
   const reader=pg.session('service_role'),writer=pg.session('postgres');t.after(()=>reader.close());t.after(()=>writer.close());
   const result=await reader.run(`BEGIN; SET LOCAL statement_timeout='5s'; SELECT ${rpc(a)};`);assert.equal(result.err,'');
   const probe=await writer.run(`BEGIN; SET LOCAL lock_timeout='100ms'; UPDATE gov_repo.governance_users SET organisation_id='${orgB}' WHERE user_id='${a.id}';`);
   assert.match(probe.err,/55P03|lock timeout/);await writer.run('ROLLBACK;');await reader.run('COMMIT;');
 });
 await t.test('ORG before USER before ROLES locking preserved through unchanged helper',async()=>{
   const holder=pg.session('postgres'),reader=pg.session('service_role'),probe=pg.session('postgres');
   t.after(()=>holder.close());t.after(()=>reader.close());t.after(()=>probe.close());
   await holder.run(`BEGIN; SELECT 1 FROM gov_repo.governance_roles WHERE role_id=ANY(SELECT unnest(role_ids) FROM gov_repo.governance_users WHERE user_id='${a.id}') FOR UPDATE;`);
   const pending=reader.run(`BEGIN; SET LOCAL statement_timeout='5s'; SELECT ${rpc(a)};`);
   let observed=false;
   for(let i=0;i<50;i++) {
     const blocked=await bootstrapSql("SELECT count(*) FROM pg_stat_activity WHERE usename='service_role' AND wait_event_type='Lock'");
     if(Number(blocked)>0){observed=true;break;}
   }
   assert.ok(observed,'actual role wait observed');
   for(const q of [`SELECT 1 FROM gov_repo.organisations WHERE organisation_id='${orgA}' FOR UPDATE NOWAIT`,
     `SELECT 1 FROM gov_repo.governance_users WHERE user_id='${a.id}' FOR UPDATE NOWAIT`]) {
     const x=await probe.run(`BEGIN; ${q}; ROLLBACK;`);assert.match(x.err,/55P03|could not obtain lock/);
   }
   await holder.run('ROLLBACK;');assert.equal((await pending).err,'');await reader.run('COMMIT;');
 });
 const sig="gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,vector,text,text,text,integer,text,integer,double precision)";
 for(const role of ['anon','authenticated'] as const) await t.test(`${role} cannot invoke new read`,async()=>{
   await assert.rejects(pg.sql(bounded(`SELECT ${rpc(a)}`),role),/42501[\s\S]*permission denied/);
 });
 for(const [label,sql] of Object.entries({
   body:`CREATE OR REPLACE FUNCTION ${sig.replace(/\([^]*$/,'(p_verified_organisation_id uuid,p_verified_actor_user_id uuid,p_verified_session_iat bigint,p_verified_session_exp bigint,p_verified_credential_epoch timestamptz,p_query vector,p_provider text,p_model text,p_version text,p_dimension integer,p_schema text,p_limit integer,p_threshold double precision)')} RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS 'SELECT NULL::jsonb';`,
   owner:`ALTER FUNCTION ${sig} OWNER TO service_role;`,config:`ALTER FUNCTION ${sig} SET search_path=public;`,
   public:`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC;`,anon:`GRANT EXECUTE ON FUNCTION ${sig} TO anon;`,authenticated:`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`,
   service_grant_option:`GRANT EXECUTE ON FUNCTION ${sig} TO service_role WITH GRANT OPTION;`,service_revocation:`REVOKE EXECUTE ON FUNCTION ${sig} FROM service_role;`,
   overload:`CREATE FUNCTION gov_repo.semantic_context_search_v1(text) RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT $1';`,
   arbitrary_definer:`CREATE FUNCTION gov_repo.unapproved_semantic() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
   legacy_overload:`CREATE FUNCTION gov_repo.agent_semantic_search(text) RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
   quarantined:`CREATE FUNCTION gov_repo.coding_memory_search(text) RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
   default_public:`ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON ROUTINES TO PUBLIC;`,
   default_service:`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA gov_repo GRANT EXECUTE ON ROUTINES TO service_role;`
 })) await t.test(`successor rejects tampering: ${label}`,async()=>{
   await assert.rejects(bootstrapSql(`BEGIN; ${sql} ${postflight} ROLLBACK;`),/SR1_.*DRIFT|SR1_EXACT_IDENTITY_REQUIRED/);
 });
 await t.test('postgres exception is explicit: new callable static body has no governed DML, no legacy dependency',async()=>{
   const body=await owner(`SELECT prosrc FROM pg_proc WHERE oid='${sig}'::regprocedure`);
   assert.doesNotMatch(body,/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|EXECUTE|CALL)\b/i);
   assert.doesNotMatch(body,/agent_semantic_search|coding_memory|ledger_append|l14_.*policy/);
   assert.equal(await owner(`SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='${sig}'::regprocedure`),'postgres');
   await owner(postflight);
 });
});
