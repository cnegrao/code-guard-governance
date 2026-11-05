import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { m3Baseline,applyM3,disclosurePermit,disclosureKey,reseal } from '../helpers/sr2-m3-fixtures';
import { operationalFixture,operationalInsert,operationalRpc,scopedRead,lit,orgA } from '../helpers/sr2-a3-fixtures';
import { fixture } from '../helpers/semantic-retrieval-fixtures';

test('M3 READ COMMITTED source stability and denial serialization',{timeout:900000},async t=>{
 const pg=await m3Baseline(m=>t.diagnostic(m));t.after(()=>pg.stop());await applyM3(pg);
 await pg.bootstrapSql('BEGIN;SET LOCAL session_replication_role=replica;'+fixture+'COMMIT;');
 const actor=await pg.actor(orgA);await pg.owner(disclosurePermit(orgA));
 const f=operationalFixture(actor);await pg.owner(f.sql);
 const holder=pg.session('postgres'),writer=pg.session('postgres'),monitor=pg.session('m16_bootstrap');
 t.after(async()=>{await holder.close();await writer.close();await monitor.close();});
 const holderPid=(await holder.run('SELECT pg_backend_pid();')).out;
 const writerPid=(await writer.run('SELECT pg_backend_pid();')).out;
 const waitBlocked=async()=>{
  for(let i=0;i<150;i++){
   const s=await monitor.run('SELECT wait_event_type='+"'Lock'"+' AND pg_blocking_pids('+writerPid+') @> ARRAY['+holderPid+'] FROM pg_stat_activity WHERE pid='+writerPid+';');
   assert.equal(s.err,'');
   if(s.out==='t')return;
   await delay(20);
  }
  assert.fail('expected observed database lock contention');
 };
 const check=async(name:string,body:()=>Promise<void>)=>{
  let failure:unknown;await t.test(name,async()=>{try{await body();}catch(e){failure=e;throw e;}});if(failure)throw failure;
 };
 await check('live agent SHARE lock survives admission until commit',async()=>{
  const observed=reseal({...f.observation,acquisition_method_version:'concurrent-source-lock'});
  const locked=await holder.run('BEGIN ISOLATION LEVEL READ COMMITTED;'+operationalInsert('sr2_operational_agent_observations_v1',observed));
  assert.equal(locked.err,'');
  const pending=writer.run("BEGIN ISOLATION LEVEL READ COMMITTED;UPDATE gov_repo.agents SET description='Changed concurrently' WHERE agent_id="+lit(String(f.agent.agent_id))+';COMMIT;');
  try{await waitBlocked();}finally{await holder.run('COMMIT;');await pending;}
  assert.equal((await pending).err,'');
  const v=JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));
  assert.equal(v.reason,'SOURCE_CHANGED');assert.deepEqual(v.hits,[]);
  await pg.owner('UPDATE gov_repo.agents SET description='+lit(String(f.agent.description))+' WHERE agent_id='+lit(String(f.agent.agent_id)));
 });
 await check('scope barrier precedes O row locks and a committed denial defeats a waiting re-enable',async()=>{
  const key='organisation_id='+lit(orgA)+' AND source_record_id='+lit(String(f.agent.agent_id));
  await pg.owner('UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=false,head_revision=2 WHERE '+key);
  assert.equal((await holder.run('BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_advisory_xact_lock(175003,1);')).err,'');
  const pending=writer.run('BEGIN ISOLATION LEVEL READ COMMITTED;UPDATE gov_repo.sr2_operational_agent_heads_v1 SET enabled=true,head_revision=3 WHERE '+key+';COMMIT;');
  try{
   await waitBlocked();
   // The waiting statement has not taken its O row lock before the parent barrier.
   const probe=await monitor.run('BEGIN;SELECT source_record_id FROM gov_repo.sr2_operational_agent_heads_v1 WHERE '+key+' FOR UPDATE NOWAIT;ROLLBACK;');
   assert.equal(probe.err,'');
   assert.equal((await holder.run('UPDATE gov_repo.sr2_operational_disclosure_heads_v1 SET enabled=false,head_revision=2 WHERE '+disclosureKey(orgA)+';COMMIT;')).err,'');
  }finally{await holder.run('ROLLBACK;');await pending;}
  assert.match((await pending).err,/SR2_OPERATIONAL_DISCLOSURE_DENIED/);
  const v=JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));
  assert.equal(v.reason,'CONTENT_WITHHELD');assert.deepEqual(v.hits,[]);
  assert.equal(await pg.owner('SELECT enabled FROM gov_repo.sr2_operational_agent_heads_v1 WHERE '+key),'f');
 });
});
