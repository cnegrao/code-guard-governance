import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mock, test } from 'node:test';
import { Client } from 'pg';
import { s3Cluster, provisionS3, producerCorpus, sha } from '../helpers/discovery-machine-s3-fixtures';
import { literal as q } from '../helpers/discovery-machine-s2-fixtures';
import { createMachineExecutor, type MachineExecutorConfiguration } from '../../../discovery-worker/src/executor';
import { runGovernanceDiscoveryScan } from '../../../discovery-worker/src/discovery-intake';
import { asOrganisationId } from '@council/canonical-contracts';

test('isolated production pg executor: TLS/SCRAM, real GitHub adapter, machine proposal, HUMAN and retirement', {timeout:300_000}, async t => {
 const pg=await s3Cluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
 await pg.owner(readFileSync(new URL('../../../../supabase/migrations/20261006134858_discovery_machine_propose_worker_v1.sql',import.meta.url),'utf8'));
 const m=await provisionS3(pg);
 await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',1,'REVOKED',false,false,'test','worker')`);
 const binding=await pg.owner(`select gov_repo.machine_provision_binding_v1('${m.principal}','${m.org}','github',
  'Acme/Producer-Fixtures','acme/producer-fixtures',${q(m.connection)},'123','main','github-source-adapter','1.0.0',true,true,'test','worker')`);
 const directory=await pg.bootstrapSql('show data_directory');
 const port=Number(await pg.bootstrapSql('show port'));
 const certificate=join(directory,'worker-test.crt'), key=join(directory,'worker-test.key');
 const opensslConfig=join(directory,'worker-openssl.cnf');
 writeFileSync(opensslConfig,'[req]\ndistinguished_name=dn\n[dn]\n');
 const openssl=process.env.M16_OPENSSL ?? (process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
 const generated=spawnSync(openssl,['req','-config',opensslConfig,'-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',certificate],{encoding:'utf8',windowsHide:true});
 assert.equal(generated.status,0,generated.stderr);
 const password=randomUUID();
 await pg.bootstrapSql(`set password_encryption='scram-sha-256'; alter role ${m.role} password ${q(password)};
 alter system set ssl_cert_file=${q(certificate.replaceAll('\\','/'))}`);
 await pg.bootstrapSql(`alter system set ssl_key_file=${q(key.replaceAll('\\','/'))}`);
 await pg.bootstrapSql('alter system set ssl=on');
 const hba=join(directory,'pg_hba.conf');
 writeFileSync(hba,`hostssl all ${m.role} 127.0.0.1/32 scram-sha-256\nhostnossl all ${m.role} 127.0.0.1/32 reject\n`+readFileSync(hba,'utf8'));
 await pg.bootstrapSql('select pg_reload_conf()');
 const config:MachineExecutorConfiguration={host:'127.0.0.1',port,database:'postgres',user:m.role,password,
  ca:readFileSync(certificate,'utf8'),bindingId:binding,authorizedRef:'main',auditPath:join(directory,'attempts.jsonl'),maxConnections:1};
 const corpus=await producerCorpus();
 mock.method(globalThis,'fetch',async (input:string|URL|Request) => {
  const url=new URL(String(input)); assert.equal(url.origin,'https://api.github.com');
  const path=decodeURIComponent(url.pathname);
  if(path==='/repos/Acme/Producer-Fixtures') return Response.json({id:123,full_name:'Acme/Producer-Fixtures'});
  if(path.endsWith('/commits/main'))return Response.json({sha});
  if(path.includes('/git/trees/')) return Response.json({truncated:false,tree:[...corpus.files].map(([path,text])=>({path,type:'blob',size:Buffer.byteLength(text)}))});
  const locator=path.split('/contents/')[1]; const text=corpus.files.get(locator); assert.ok(text!==undefined,path);
  assert.equal(url.searchParams.get('ref'),sha);
  return Response.json({type:'file',path:locator,encoding:'base64',content:Buffer.from(text).toString('base64')});
 });
 t.after(()=>mock.restoreAll());
 const input={executionContext:{organisationId:asOrganisationId('ffffffff-ffff-ffff-ffff-ffffffffffff')},
  sourceConfiguration:{kind:'GITHUB_REPOSITORY' as const,owner:'Acme',repo:'Producer-Fixtures',ref:'main',token:'fixture-source-token'}};
 const executor=createMachineExecutor(config); t.after(()=>executor.close());
 let scan:Awaited<ReturnType<typeof runGovernanceDiscoveryScan>>;
 await t.test('actual pg LOGIN authenticated with SCRAM/TLS; worker DB-derived tenant and full producer corpus',async()=>{
  scan=await runGovernanceDiscoveryScan(input,executor.ports);
  assert.equal(scan.status,'SUCCEEDED',JSON.stringify(scan.failures)); assert.ok(scan.proposalsCreated>0);
  assert.equal(await pg.owner(`select count(*) from gov_repo.review_subjects where organisation_id='${m.org}' and state<>'PROPOSED'`),'0');
  assert.equal(await pg.owner(`select count(*) from gov_repo.canonical_objects where organisation_id='${m.org}'`),'0');
  const login=JSON.parse(await pg.bootstrapSql(`select row_to_json(a) from (select a.usename,s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where a.usename=${q(m.role)} limit 1) a`));
  assert.equal(login.usename,m.role); assert.equal(login.ssl,true);
  const audit=JSON.parse(await pg.bootstrapSql(`select row_to_json(a) from gov_repo.machine_invocation_audit a where outcome='APPLIED' and event_id is not null limit 1`));
  assert.equal(audit.role_name,m.role); assert.equal(audit.generation_id,m.generation); assert.equal(audit.organisation_id,m.org);
  const event=JSON.parse(await pg.owner(`select row_to_json(e) from gov_repo.review_audit_events e where event_id=${q(audit.event_id)}`));
  assert.equal(event.actor_kind,'DETERMINISTIC_RULE'); assert.equal(event.actor_reference,null);
  assert.equal(event.actor_rule_code,'PASS_THROUGH_V1'); assert.equal(event.actor_rule_version,'1.0');
  assert.equal(await pg.owner(`select proposals_created from gov_repo.acquisition_runs where run_id=${q(scan.scanRunId)}`),String(scan.proposalsCreated));
  assert.ok(Number(await pg.bootstrapSql(`select count(*) from gov_repo.machine_invocation_audit where outcome='READ'`))>0);
 });
 await t.test('integrated scans reject absent, revoked and foreign bindings; authenticated LOGIN cannot raise authority',async()=>{
  const foreign=await provisionS3(pg);
  const before=await pg.owner('select count(*) from gov_repo.acquisition_runs');
  for(const bindingId of [randomUUID(),m.binding,foreign.binding]){
   const denied=createMachineExecutor({...config,bindingId});
   try {await assert.rejects(runGovernanceDiscoveryScan(input,denied.ports),/MACHINE_DENIED/);}
   finally {await denied.close();}
  }
  assert.equal(await pg.owner('select count(*) from gov_repo.acquisition_runs'),before);
  const direct=new Client({host:config.host,port,database:config.database,user:m.role,password,
   ssl:{ca:config.ca,rejectUnauthorized:true}});
  await direct.connect();
  try {
   await assert.rejects(direct.query('select gov_repo.propose_discovery_finding_v1($1,$2,$3)',[scan.scanRunId,'missing','CONFIRMED']),{code:'42883'});
   await assert.rejects(direct.query(`select gov_repo.apply_review_transition(null::uuid,null::text,null::text,null::text,null::text,
    null::text,null::text,null::text,null::text,null::timestamptz,null::text[],null::text,null::text,null::text)`),{code:'42501'});
   await assert.rejects(direct.query("update gov_repo.review_subjects set state='CONFIRMED'"),{code:'42501'});
   await assert.rejects(direct.query('insert into gov_repo.canonical_objects default values'),{code:'42501'});
   await assert.rejects(direct.query('delete from gov_repo.machine_invocation_audit'),{code:'42501'});
  } finally {await direct.end();}
 });
 await t.test('invalid credential/certificate fail; neither plaintext nor service/HUMAN fallback',async()=>{
  for(const patch of [{password:'wrong'},{ca:'invalid CA'}]){
   const bad=createMachineExecutor({...config,...patch});
   try { await assert.rejects(runGovernanceDiscoveryScan(input,bad.ports),/MACHINE_DATABASE_FAILED/); } finally {await bad.close();}
  }
  const plaintext=new Client({host:config.host,port,database:'postgres',user:m.role,password,ssl:false});
  await assert.rejects(plaintext.connect(),/reject|pg_hba/); await plaintext.end();
  assert.throws(()=>createMachineExecutor({...config,user:'service_role'}),/CONFIGURATION_REJECTED/);
 });
 await t.test('HUMAN confirms through unchanged wrapper; fresh machine rescan only replays',async()=>{
  const row=JSON.parse(await pg.owner(`select row_to_json(s) from gov_repo.review_subjects s where organisation_id='${m.org}' order by review_subject_id limit 1`));
  const user=randomUUID();
  await pg.owner(`insert into gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
   values('${user}','${user}@example.invalid','Worker fixture','${m.org}','active',array[(select role_id from gov_repo.governance_roles where role_code='GOVERNANCE_ADMIN' and is_system_role)])`);
  await pg.bootstrapSql(`alter table gov_repo.governance_users disable trigger trg_governance_users_credential_epoch_v1;
   update gov_repo.governance_users set password_changed_at=clock_timestamp()-interval '12 hours' where user_id='${user}';
   alter table gov_repo.governance_users enable always trigger trg_governance_users_credential_epoch_v1`);
  const epoch=await pg.owner(`select password_changed_at::text from gov_repo.governance_users where user_id='${user}'`);
  const evidence=await pg.owner(`select quote_literal(array_agg(evidence_id)::text) from gov_repo.review_subject_evidence where review_subject_id=${q(row.review_subject_id)}`);
  await pg.svc(`select * from gov_repo.apply_review_transition_governed_v1('${m.org}','${user}',floor(extract(epoch from clock_timestamp()))::bigint-10,
   floor(extract(epoch from clock_timestamp()))::bigint+3600,${q(epoch)}::timestamptz,${q(row.review_subject_id)},${q(row.finding_id)},
   'PROPOSED','CONFIRMED',clock_timestamp(),${evidence}::text[],null,'human-worker-test','human-worker-test-event')`);
  const retry=createMachineExecutor(config);
  try { const result=await runGovernanceDiscoveryScan(input,retry.ports); assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.failures)); assert.equal(result.proposalsCreated,0); }
  finally {await retry.close();}
  assert.equal(await pg.owner(`select state from gov_repo.review_subjects where review_subject_id=${q(row.review_subject_id)}`),'CONFIRMED');
 });
 await t.test('F1: HUMAN rejection before machine PROPOSE is an audited item conflict; next item and rescan complete',async()=>{
  const savedFiles=new Map(corpus.files);
  corpus.files.clear();
  corpus.files.set('f1/first.ts','MODEL_REFERENCE = "f1-first-model"\n');
  corpus.files.set('f1/second.ts','MODEL_REFERENCE = "f1-second-model"\n');
  const human=JSON.parse(await pg.owner(`select row_to_json(u) from gov_repo.governance_users u where organisation_id='${m.org}' and status='active' limit 1`));
  let conflictedSubject='', conflictedFinding='', humanHistory='';
  const observed:string[]=[];
  try {
   for(const pass of [0,1]) {
    const current=createMachineExecutor(config);
    const machine=current.ports.machine!;
    const ports={...current.ports,machine:{...machine,
     async createDetectedSubject(command:Parameters<typeof machine.createDetectedSubject>[0]) {
      const result=await machine.createDetectedSubject(command);
      if(pass===0 && !conflictedSubject) {
       assert.equal(result.outcome,'APPLIED');
       assert.ok('reviewSubjectId' in result); conflictedSubject=result.reviewSubjectId; conflictedFinding=command.findingId;
       const evidence=await pg.owner(`select quote_literal(array_agg(evidence_id)::text) from gov_repo.review_subject_evidence where review_subject_id=${q(conflictedSubject)}`);
       await pg.svc(`select * from gov_repo.apply_review_transition_governed_v1('${m.org}','${human.user_id}',floor(extract(epoch from clock_timestamp()))::bigint-10,
        floor(extract(epoch from clock_timestamp()))::bigint+3600,${q(human.password_changed_at)}::timestamptz,${q(conflictedSubject)},${q(conflictedFinding)},
        'DETECTED','REJECTED',clock_timestamp(),${evidence}::text[],'F1_HUMAN_REJECTION','f1-human-command','f1-human-event')`);
       humanHistory=await pg.owner(`select jsonb_agg(to_jsonb(e) order by event_id) from gov_repo.review_audit_events e where review_subject_id=${q(conflictedSubject)}`);
      }
      return result;
     },
     async proposeDiscoveryFinding(command:Parameters<typeof machine.proposeDiscoveryFinding>[0]) {
      const result=await machine.proposeDiscoveryFinding(command); observed.push(result.outcome); return result;
     },
    }};
    try {
     const result=await runGovernanceDiscoveryScan(input,ports);
     assert.equal(result.status,'SUCCEEDED'); assert.deepEqual(result.failures,[]);
     assert.equal(result.proposalsCreated,pass===0?1:0);
     assert.deepEqual(observed.slice(pass*2),pass===0?['STATE_CONFLICT','APPLIED']:['STATE_CONFLICT','REPLAYED']);
     const completion=JSON.parse(await pg.bootstrapSql(`select row_to_json(r) from gov_repo.discovery_run_bindings r where run_id=${q(result.scanRunId)}`));
     assert.equal(completion.conclusion_status,'SUCCEEDED'); assert.equal(completion.conclusion_counts.proposalsCreated,result.proposalsCreated);
     assert.equal(await pg.owner(`select state from gov_repo.review_subjects where review_subject_id=${q(conflictedSubject)}`),'REJECTED');
     assert.equal(await pg.owner(`select jsonb_agg(to_jsonb(e) order by event_id) from gov_repo.review_audit_events e where review_subject_id=${q(conflictedSubject)}`),humanHistory);
     assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.machine_invocation_audit where attempt_run_id=${q(result.scanRunId)} and finding_id=${q(conflictedFinding)} and outcome='STATE_CONFLICT' and event_id is null`),'1');
     assert.equal(await pg.owner(`select count(*) from gov_repo.review_audit_events where finding_id=${q(conflictedFinding)} and actor_kind='DETERMINISTIC_RULE'`),'0');
     assert.equal(await pg.owner(`select count(*) from gov_repo.canonical_objects where organisation_id='${m.org}'`),'0');
    } finally {await current.close();}
   }
   const journal=readFileSync(config.auditPath,'utf8').trim().split('\n').map(line=>JSON.parse(line));
   assert.equal(journal.filter(entry=>entry.command==='propose' && entry.phase==='STATE_CONFLICT').length,2);
  } finally {corpus.files.clear(); for(const [path,text] of savedFiles)corpus.files.set(path,text);}
 });
 await t.test('F1: retirement during scan remains fatal and prevents processing the next item',async()=>{
  const current=createMachineExecutor(config), machine=current.ports.machine!;
  let admitted=0, completed=false;
  const ports={...current.ports,
   intake:{...current.ports.intake,async completeAcquisitionRun(...args:Parameters<typeof current.ports.intake.completeAcquisitionRun>){completed=true; return current.ports.intake.completeAcquisitionRun(...args);}},
   machine:{...machine,async createDetectedSubject(command:Parameters<typeof machine.createDetectedSubject>[0]){
    const result=await machine.createDetectedSubject(command); admitted++;
    await pg.owner(`select gov_repo.machine_set_generation_state_v1('${m.generation}','RETIRED','test','F1 fatal authority')`);
    return result;
   }},
  };
  try {await assert.rejects(runGovernanceDiscoveryScan(input,ports),/MACHINE_DENIED/);}
  finally {await current.close();}
  assert.equal(admitted,1); assert.equal(completed,false);
 });
 await t.test('already-open generation loses authority after retirement; operational journal survives',async()=>{
  const row=JSON.parse(await pg.owner(`select row_to_json(s) from gov_repo.review_subjects s where organisation_id='${m.org}' limit 1`));
  await assert.rejects(executor.ports.machine!.proposeDiscoveryFinding({acquisitionRunId:scan.scanRunId as never,findingId:row.finding_id}),/MACHINE_DENIED/);
  const journal=readFileSync(config.auditPath,'utf8'); assert.match(journal,/ATTEMPT/); assert.match(journal,/FAILED_OR_COMMIT_UNKNOWN/);
  assert.ok(!journal.includes(password)); assert.ok(!journal.includes('fixture-source-token'));
 });
});
