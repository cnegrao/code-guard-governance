import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { s3Cluster } from '../helpers/discovery-machine-s3-fixtures';
import { literal as q } from '../helpers/discovery-machine-s2-fixtures';

test('S3 control-owner bridge and exact historical run revision with a real LOGIN', {timeout:180_000}, async t=>{
 const pg=await s3Cluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
 const org=randomUUID();
 await pg.owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
 values('${org}','S3','S3','S3','BR',true)`);
 const principal=await pg.owner(`select gov_repo.machine_provision_principal_v1('s3_test','test','fixture','S3')`);
 await pg.owner(`create role s3_worker login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 grant govia_discovery_machine_caller to s3_worker with inherit true, set true`);
 t.diagnostic(await pg.bootstrapSql(`select json_agg(json_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and has_function_privilege('s3_worker',p.oid,'EXECUTE')`));
 const generation=await pg.owner(`select gov_repo.machine_register_generation_v1('${principal}','s3_worker',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','fixture','S3')`);
 await pg.owner(`select gov_repo.machine_set_generation_state_v1('${generation}','CURRENT','fixture','S3')`);
 const connection='source-connection:'+createHash('sha256').update('github:Acme/Repo').digest('hex').slice(0,32);
 const binding=await pg.owner(`select gov_repo.machine_provision_binding_v1('${principal}','${org}','github','Acme/Repo','acme/repo',${q(connection)},'123','main','github','1.0',true,false,'fixture','S3')`);
 const open=(id=binding,ref='main',pin:string|null='123')=>pg.login(`select gov_repo.discovery_machine_open_run_v1('${id}','Acme/Repo',${q(ref)},'github','1.0',${pin===null?'null':q(pin)},'commit:${'a'.repeat(40)}',clock_timestamp())`,'s3_worker').then(JSON.parse);
 const counts={artifactsScanned:1,findingsDetected:0,objectCandidates:0,relationshipCandidates:0,reviewSubjectsCreated:0,proposalsCreated:0,alreadyGoverned:0,itemFailures:1};
 const complete=(id:string,status='FAILED',failure:string|null='PROVIDER_IDENTITY_MISMATCH',completed=new Date(Date.now()+1000).toISOString())=>pg.login(
  `select gov_repo.discovery_machine_complete_run_v1(${q(id)},${q(status)},${q(JSON.stringify(counts))}::jsonb,${q(completed)},${failure===null?'null':q(failure)})`,'s3_worker').then(JSON.parse);
 await t.test('nested definers authenticate session_user and persist DB-derived provenance',async()=>{
  const r=await open(); assert.equal(r.outcome,'APPLIED');
  assert.equal(r.provenance.principal_id,principal); assert.equal(r.provenance.admission_generation_id,generation);
  assert.equal(r.provenance.organisation_id,org); assert.equal(r.provenance.source_connection_id,connection);
  assert.equal(r.provenance.binding_revision,1); assert.equal(r.provenance.provider_identity_state,'PINNED_MATCH');
 });
 await t.test('authoritative failure is permanent and legacy projection never grants authority',async()=>{
  const r=await open(); const id=r.provenance.run_id; const at=new Date(Date.now()+1000).toISOString();
  assert.equal((await complete(id,'FAILED','PROVIDER_IDENTITY_MISMATCH',at)).outcome,'APPLIED');
  assert.equal((await complete(id,'FAILED','PROVIDER_IDENTITY_MISMATCH',at)).outcome,'REPLAYED');
  assert.equal((await complete(id,'SUCCEEDED',null,at)).outcome,'CONTENT_CONFLICT');
  await pg.login(`update gov_repo.acquisition_runs set status='SUCCEEDED' where run_id=${q(id)}`,'service_role');
  assert.equal((await complete(id,'SUCCEEDED',null,at)).outcome,'CONTENT_CONFLICT');
  assert.equal(await pg.bootstrapSql(`select conclusion_status from gov_repo.discovery_run_bindings where run_id=${q(id)}`),'FAILED');
  await assert.rejects(complete(id,'SUCCEEDED','ACQUISITION_FAILED',at),/22023/);
  for(const mutation of [`update gov_repo.discovery_run_bindings set provider='evil' where run_id=${q(id)}`,
   `update gov_repo.discovery_run_bindings set conclusion_status='SUCCEEDED' where run_id=${q(id)}`,
   `delete from gov_repo.discovery_run_bindings where run_id=${q(id)}`,`truncate gov_repo.discovery_run_bindings cascade`])
   await assert.rejects(pg.bootstrapSql(mutation),/S3_IMMUTABLE/);
 });
 await t.test('unknown binding, exact ref mismatches and missing/mismatched pin fail closed',async()=>{
  const denied=await open(randomUUID()); assert.equal(denied.outcome,'DENIED');
  for(const ref of ['Main','refs/heads/main']) assert.deepEqual(await open(binding,ref),denied);
  for(const pin of [null,'456']) assert.deepEqual(await open(binding,'main',pin),denied);
 });
 await t.test('S2 control tables and internal bridge remain inaccessible',async()=>{
  for(const role of ['s3_worker','govia_discovery_machine_caller','govia_discovery_intake_owner','service_role']) {
   for(const table of ['machine_principals','machine_credential_generations','machine_execution_bindings','machine_binding_revisions'])
    assert.equal(await pg.bootstrapSql(`select has_table_privilege(${q(role)},'gov_repo.${table}','SELECT')`),'f',role+'/'+table);
  }
  for(const sql of [`select gov_repo.discovery_machine_authorize_v1('${binding}',null)`,`select gov_repo.machine_lock_eligibility_v1('${binding}',1)`])
   await assert.rejects(pg.login(sql,'s3_worker'),/42501/);
 });
 await t.test('revision N run never upgrades to N+1',async()=>{
  const old=await open();
  await pg.owner(`select gov_repo.machine_change_binding_v1('${binding}',1,'ENABLED',true,false,'revision','S3')`);
  assert.equal((await complete(old.provenance.run_id)).outcome,'DENIED');
  const newer=await open(); assert.equal(newer.outcome,'APPLIED'); assert.equal(newer.provenance.binding_revision,2);
 });
});
