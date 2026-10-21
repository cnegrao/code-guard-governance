import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditPostgresClient } from '../helpers/audit-postgres-client';
import { ledgerFoundationCluster,orgA,orgB,seedLedger,v2Tables } from '../helpers/ledger-v2-foundation-fixtures';

test('M17.5 S1A1-1 integration: real Audit repository and legacy application writes remain unchanged after V2 schema', {timeout:900_000},async t=>{
  const pg=await ledgerFoundationCluster(message=>t.diagnostic(message));
  t.after(()=>pg.stop());
  await seedLedger(pg);
  // Bind the existing two clients to actual disposable PG roles. No HTTP or hosted access.
  Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_ANON_KEY:'v2-anon',SUPABASE_SERVICE_ROLE_KEY:'v2-service'});
  const {db}=await import('../../lib/db');
  const calls:string[]=[];
  const transport:Parameters<typeof auditPostgresClient>[0]=async(q,role)=>{calls.push(q);return pg.sql(q,role);};
  Object.assign(db,{read:auditPostgresClient(transport,'anon'),write:auditPostgresClient(transport,'service_role')});
  const {getIntegrity,getEvents,getEventById}=await import('../../repositories/audit');
  const beforeA=await getIntegrity(orgA),beforeB=await getIntegrity(orgB);
  const eventsA=await getEvents(orgA),eventsB=await getEvents(orgB);
  const first=3; // Current legacy Audit detail API still addresses the global sequence.
  const detail=await getEventById(orgA,first);
  assert.ok(detail);
  await pg.applyFoundation();
  const afterA=await getIntegrity(orgA),afterB=await getIntegrity(orgB);
  const stable=(x:typeof beforeA)=>{const {last_verified_at,...data}=x;assert.ok(last_verified_at);return data;};
  assert.deepEqual(stable(afterA),stable(beforeA));assert.deepEqual(stable(afterB),stable(beforeB));
  assert.deepEqual(await getEvents(orgA),eventsA);assert.deepEqual(await getEvents(orgB),eventsB);
  assert.deepEqual(await getEventById(orgA,first),detail);
  assert.equal(await getEventById(orgB,first),null);
  await pg.svc(`SELECT gov_repo.ledger_append('LEGACY_WRITER_AFTER_V2','unmodified append','SYSTEM',gen_random_uuid(),gen_random_uuid(),NULL,'${orgB}','{}')`);
  assert.equal((await getIntegrity(orgB)).total_entries,beforeB.total_entries+1);
  assert.equal((await getIntegrity(orgA)).hash_chain_valid,true);
  assert.ok(calls.some(q=>q.includes('gov_repo.ledger_verify(')),'same legacy verifier consumed');
  assert.ok(calls.every(q=>!q.includes('_v2')),'no application query consumes V2');
  for(const table of v2Tables)assert.equal(await pg.owner(`SELECT count(*) FROM gov_repo.${table}`),'0',table);
  t.diagnostic('Audit integrity/list/detail before and after additive schema identical; post-migration service append still legacy; no V2 side effect');
});
