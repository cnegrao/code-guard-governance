import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { producerCorpus, s3Cluster, provisionS3 } from '../helpers/discovery-machine-s3-fixtures';
import { literal as q } from '../helpers/discovery-machine-s2-fixtures';
import { test } from 'node:test';
import * as scanner from '../../../../packages/scanner/src/discovery/index';
import type { Evidence, SourceAssertion } from '@council/canonical-contracts';

// Blocking producer gate from plan I with the explicit producer-family resolution.
// Database admission and negative authority tests are separate acceptance gates.
const sha = 'a'.repeat(40);
function errors(evidence: Evidence, assertion: SourceAssertion, run: scanner.DiscoveryRunResult['run']): string[] {
  const issues: string[] = [];
  const execution = /^execution-evidence:[0-9a-f]{64}$/.test(evidence.evidenceId);
  const general = /^evidence:[0-9a-f]{32}$/.test(evidence.evidenceId);
  if (!general && !execution) issues.push('evidence ID outside reviewed namespace');
  if (!(execution ? /^execution-assertion:[0-9a-f]{64}$/ : /^source-assertion:[0-9a-f]{32}$/).test(assertion.assertionId)) issues.push('assertion ID outside paired namespace');
  if (execution && (assertion.assertionId.slice(20) !== evidence.evidenceId.slice(19) ||
      assertion.method.code !== 'DIRECT_AGENT_EXECUTION_V1' || assertion.method.version !== '1.0' ||
      assertion.trustState !== 'DECLARED' || evidence.handling !== 'HASH_ONLY' || Object.hasOwn(evidence,'redactedExcerpt'))) issues.push('execution pair contract mismatch');
  for (const location of evidence.locations) {
    if (location.kind === 'REPOSITORY') {
      if ((general || location.commit !== undefined) && location.commit !== sha) issues.push('repository commit mismatch');
      if (location.path !== assertion.sourceObject.externalId || assertion.sourceObject.externalType !== 'file') issues.push('foreign source object');
    }
  }
  if (!evidence.hashes.length || evidence.hashes.some(h => h.algorithm !== 'sha256' || !/^[0-9a-f]{64}$/.test(h.value))) issues.push('invalid evidence hash');
  if (assertion.runId !== run.runId) issues.push('wrong run');
  if (assertion.sourceObject.connectionId !== run.connection.connectionId) issues.push('wrong connection');
  if (!/^commit:[0-9a-f]{40}$/.test(assertion.snapshot?.sourceVersion ?? '') || assertion.snapshot?.sourceVersion !== run.sourceVersion) issues.push('wrong source version');
  if (JSON.stringify(assertion.snapshot?.sourceObject) !== JSON.stringify(assertion.sourceObject)) issues.push('wrong snapshot source object');
  if (!['INFERRED','DECLARED'].includes(assertion.trustState)) issues.push('unsupported trust state');
  for (const key of ['validation','effectivePeriod','sourceAttribute']) if (Object.hasOwn(assertion,key)) issues.push(`forbidden ${key}`);
  if (assertion.evidenceIds.length !== 1 || assertion.evidenceIds[0] !== evidence.evidenceId) issues.push('evidence membership mismatch');
  return issues;
}

test('S3 blocking producer compatibility gate: existing scanner outputs versus approved observation rules', async t => {
  const {files,result,groups}=await producerCorpus();
  t.diagnostic(`Scanned ${files.size} fixture files; groups: ${JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])))}`);
  for (const [name,items] of Object.entries(groups)) await t.test(name,()=>{
    assert.ok(items.length>0,`${name} must actually exercise its producer`);
    const failures = items.flatMap(item=>{
      const violations=errors(item.evidence,item.assertion,result.run);
      return violations.length ? [{evidenceId:item.evidence.evidenceId,assertionId:item.assertion.assertionId,
        source:item.assertion.sourceObject.externalId,violations}] : [];
    });
    if (failures.length) t.diagnostic(`${name}: ${failures.length}/${items.length} rejected; first=${JSON.stringify(failures[0])}`);
    assert.deepEqual(failures,[],`${name}: approved S3 observation rules must accept existing producer output`);
  });
});

test('S3 PG17 real producer admissions, replay, hashes and closed families', {timeout:240_000},async t=>{
 const pg=await s3Cluster(m=>t.diagnostic(m)); t.after(()=>pg.stop());
 const machine=await provisionS3(pg); const opened=await machine.open(); assert.equal(opened.outcome,'APPLIED');
 const run=opened.provenance.run_id as string;
 const {files,result,groups}=await producerCorpus();
 assert.equal(files.size,32); assert.deepEqual(Object.values(groups).map(v=>v.length),[56,2,1,5]);
 assert.equal(result.run.connection.connectionId,machine.connection);
 const admit=(e:unknown,a:unknown,id=run)=>machine.call(`select gov_repo.discovery_machine_admit_observation_v1(${q(id)},${q(JSON.stringify([e]))}::jsonb,${q(JSON.stringify(a))}::jsonb)`);
 const all=Object.values(groups).flat();
 for(const [family,items] of Object.entries(groups)) await t.test('PG17 '+family,async()=>{
  for(const item of items){
   const assertion={...item.assertion,runId:run};
   assert.equal((await admit(item.evidence,assertion)).outcome,'APPLIED',JSON.stringify(item));
   assert.equal((await admit(item.evidence,assertion)).outcome,'REPLAYED');
  }
 });
 await t.test('stored hashes equal production canonicalStringify for all 64 producer envelopes',async()=>{
  process.env.SUPABASE_URL??='https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY??='test';
  const {canonicalStringify}=await import('../../lib/governance/persistence');
  const rows=JSON.parse(await pg.bootstrapSql(`select json_agg(x) from (select envelope,envelope_hash from gov_repo.discovery_evidence where organisation_id='${machine.org}' union all select envelope,envelope_hash from gov_repo.source_assertions where organisation_id='${machine.org}') x`));
  assert.equal(rows.length,128);
  for(const row of rows) assert.equal(row.envelope_hash,createHash('sha256').update(canonicalStringify(row.envelope)).digest('hex'));
 });
 await t.test('producer identity, pairing and source-version negatives',async()=>{
  const first=all[0]; const a={...first.assertion,runId:run}; const e=first.evidence;
  for(const id of ['evidence:'+'a'.repeat(64),'execution-evidence:'+'a'.repeat(32),'other:'+'a'.repeat(32),'evidence:'+'A'.repeat(32),'evidence:'+'g'.repeat(32)]){
   await assert.rejects(admit({...e,evidenceId:id},{...a,evidenceIds:[id]}),/22023/);
  }
  for(const id of ['source-assertion:'+'a'.repeat(64),'execution-assertion:'+'a'.repeat(32),'other:'+'a'.repeat(32),'source-assertion:'+'A'.repeat(32)])
   await assert.rejects(admit(e,{...a,assertionId:id}),/22023/);
  for(const bad of [{...a,runId:'acquisition-run:00000000-0000-4000-8000-000000000000'},
   {...a,sourceObject:{...a.sourceObject,connectionId:'source-connection:foreign'}},
   {...a,snapshot:{...a.snapshot,sourceVersion:'commit:'+'b'.repeat(40)}},
   {...a,evidenceIds:['evidence:'+'0'.repeat(32)]}]) assert.equal((await admit(e,bad)).outcome,'DENIED');
  await assert.rejects(admit(e,{...a,trustState:'VALIDATED'}),/22023/);
  const ex=groups.executionFacts[0]; const ea={...ex.assertion,runId:run};
  const {sourceVersion:_,...missing}=ea.snapshot!;
  await assert.rejects(admit(ex.evidence,{...ea,snapshot:missing}),/22023/);
  assert.equal((await admit(ex.evidence,{...ea,snapshot:{...ea.snapshot,sourceVersion:'commit:'+'b'.repeat(40)}})).outcome,'DENIED');
  assert.equal((await admit({...ex.evidence,locations:ex.evidence.locations.map(l=>({...l,commit:'b'.repeat(40)}))},ea)).outcome,'DENIED');
  await assert.rejects(admit(ex.evidence,{...a,evidenceIds:[ex.evidence.evidenceId]}),/22023/);
 });
 await t.test('same IDs with different content conflict atomically; volatile times replay',async()=>{
  const item=all[0], a={...item.assertion,runId:run};
  assert.equal((await admit({...item.evidence,hashes:[{algorithm:'sha256',value:'f'.repeat(64)}]},a)).outcome,'CONTENT_CONFLICT');
  assert.equal((await admit(item.evidence,{...a,confidence:0.123})).outcome,'CONTENT_CONFLICT');
  assert.equal((await admit({...item.evidence,capturedAt:'2026-10-02T13:00:00.000Z'},a)).outcome,'REPLAYED');
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.discovery_machine_admissions where run_id=${q(run)}`),'128');
 });
});
