import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {s3Cluster,provisionS3,producerCorpus} from '../helpers/discovery-machine-s3-fixtures';
import {literal as q} from '../helpers/discovery-machine-s2-fixtures';
import {boundaryCluster,horizon} from '../helpers/discovery-machine-s4-fixtures';

test(`${horizon} current authority, atomic final recheck and concurrent replay`,{timeout:240_000},async t=>{
 const pg=await boundaryCluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
 const item=(await producerCorpus()).groups.evidenceAssembly[0];
 const observation=(run:string)=>`select gov_repo.discovery_machine_admit_observation_v1(${q(run)},${q(JSON.stringify([item.evidence]))},${q(JSON.stringify({...item.assertion,runId:run}))})`;
 const reads=(run:string)=>[
  `select gov_repo.discovery_machine_get_candidate_v1(${q(run)},${q(item.finding.findingId)})`,
  `select gov_repo.discovery_machine_is_governed_v1(${q(run)},'file','missing','AGENT','missing')`];
 const rotate=async(m:Awaited<ReturnType<typeof provisionS3>>,until="clock_timestamp()+interval '1 hour'")=>{
  const role='s3_'+randomUUID().replaceAll('-','');
  await pg.owner(`create role ${role} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant govia_discovery_machine_caller to ${role} with inherit true,set true`);
  const id=await pg.owner(`select gov_repo.machine_register_generation_v1('${m.principal}',${q(role)},clock_timestamp()-interval '1 minute',${until},'rotate','S3')`);
  await pg.owner(`select gov_repo.machine_set_generation_state_v1('${id}','CURRENT','rotate','S3')`);
  return {role,id,call:(s:string)=>pg.login(s,role).then(JSON.parse)};
 };
 await t.test('disablement, revision, revocation and equivalent replacement never bypass replay or reads',async()=>{
  const m=await provisionS3(pg); const run=(await m.open()).provenance.run_id;
  const commands=[observation(run),...reads(run)];
  assert.equal((await m.call(commands[0])).outcome,'APPLIED');
  const denied=async()=>{for(const cmd of commands)assert.equal((await m.call(cmd)).outcome,'DENIED');};
  await pg.owner(`select gov_repo.machine_set_principal_state_v1('${m.principal}','DISABLED','disable','S3')`); await denied();
  await pg.owner(`select gov_repo.machine_set_principal_state_v1('${m.principal}','ENABLED','enable','S3')`);
  assert.equal((await m.call(commands[0])).outcome,'REPLAYED');
  await pg.owner(`update gov_repo.organisations set is_active=false where organisation_id='${m.org}'`); await denied();
  await pg.owner(`update gov_repo.organisations set is_active=true where organisation_id='${m.org}'`);
  await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',1,'DISABLED',true,false,'disable','S3')`); await denied();
  await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',2,'ENABLED',true,false,'enable','S3')`); await denied();
  assert.equal((await m.open()).provenance.binding_revision,3);
  await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',3,'REVOKED',true,false,'revoke','S3')`); await denied();
  const replacement=await pg.owner(`select gov_repo.machine_provision_binding_v1('${m.principal}','${m.org}','github','Acme/Producer-Fixtures','acme/producer-fixtures',${q(m.connection)},'123','main','github','1.0',true,false,'replacement','S3')`);
  assert.notEqual(replacement,m.binding); await denied();
 });
 await t.test('rotation invalidates an already-connected LOGIN; the current generation can replay the same historical run',async()=>{
  const m=await provisionS3(pg), run=(await m.open()).provenance.run_id;
  const session=pg.loginSession(m.role); t.after(()=>session.close());
  assert.equal(JSON.parse((await session.run(observation(run)+';')).out).outcome,'APPLIED');
  const next=await rotate(m);
  for(const cmd of [observation(run),...reads(run)])assert.equal(JSON.parse((await session.run(cmd+';')).out).outcome,'DENIED');
  assert.equal((await next.call(observation(run))).outcome,'REPLAYED');
  assert.equal(await pg.bootstrapSql(`select admission_generation_id from gov_repo.discovery_run_bindings where run_id=${q(run)}`),m.generation);
 });
 await t.test('concurrent identical admissions serialize into one APPLIED plus REPLAYED without duplicate writes',async()=>{
  const m=await provisionS3(pg), run=(await m.open()).provenance.run_id;
  const results=await Promise.all([m.call(observation(run)),m.call(observation(run))]);
  assert.deepEqual(results.map(r=>r.outcome).sort(),['APPLIED','REPLAYED']);
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.discovery_machine_admissions where run_id=${q(run)}`),'2');
 });
 await t.test('expiry while waiting for a record lock rolls back all tentative evidence, assertion and admission writes',async()=>{
  const m=await provisionS3(pg), run=(await m.open()).provenance.run_id;
  const holder=pg.loginSession('m16_bootstrap'); t.after(()=>holder.close());
  assert.equal((await holder.run(`begin; select pg_advisory_xact_lock(hashtextextended(${q(m.org+':discovery-machine:EVIDENCE:'+item.evidence.evidenceId)},0));`)).err,'');
  const short=await rotate(m,"clock_timestamp()+interval '3 seconds'");
  const pending=short.call(observation(run));
  let waiting=false;
  for(let i=0;i<40;i++){
   waiting=await pg.bootstrapSql(`select exists(select 1 from pg_stat_activity where usename=${q(short.role)} and wait_event_type='Lock')`)==='t';
   if(waiting)break; await new Promise(r=>setTimeout(r,25));
  }
  assert.ok(waiting,'real backend must reach the held record lock');
  await pg.bootstrapSql(`select pg_sleep(greatest(0,extract(epoch from valid_until-clock_timestamp()))+0.1) from gov_repo.machine_credential_generations where generation_id='${short.id}'`);
  assert.equal((await holder.run('commit;')).err,'');
  assert.equal((await pending).outcome,'DENIED');
  for(const table of ['discovery_evidence','source_assertions','discovery_machine_admissions'])assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.${table} where organisation_id='${m.org}'`),'0');
  for(const cmd of reads(run))assert.equal((await short.call(cmd)).outcome,'DENIED');
 });
});
