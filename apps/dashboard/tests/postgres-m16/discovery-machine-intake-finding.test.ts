import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {s3Cluster,provisionS3,producerCorpus} from '../helpers/discovery-machine-s3-fixtures';
import {literal as q} from '../helpers/discovery-machine-s2-fixtures';
import * as scanner from '../../../../packages/scanner/src/discovery/index';
import {lineageObservationFinding} from '../../lib/governance/lineage-observation';
import {deriveReviewSubjectId} from '../../../../packages/governance-review/src/discovery-machine/identity';
import {recordExecutionSource} from '../../lib/governance/execution-context-intake';
import type {ExecutionSourceSnapshot} from '@council/canonical-contracts';

test('S3 findings/candidates/lineage preserve production identities and authority ceiling',{timeout:240_000},async t=>{
 const pg=await s3Cluster(m=>t.diagnostic(m)); t.after(()=>pg.stop()); const m=await provisionS3(pg);
 const run=(await m.open()).provenance.run_id;
 const corpus=await producerCorpus(); const {result,groups,versions}=corpus;
 for(const item of Object.values(groups).flat()) assert.equal((await m.call(`select gov_repo.discovery_machine_admit_observation_v1(${q(run)},${q(JSON.stringify([item.evidence]))},${q(JSON.stringify({...item.assertion,runId:run}))})`)).outcome,'APPLIED');
 const admit=(finding:unknown,candidate:unknown=null)=>m.call(`select gov_repo.discovery_machine_admit_finding_v1(${q(run)},${q(JSON.stringify(finding))},${candidate===null?'null':q(JSON.stringify(candidate))})`);
 const sorted=[...result.candidates].filter(c=>c.finding.candidateKind!=='RELATIONSHIP').sort((a,b)=>Number(a.finding.candidateKind==='DATA_ELEMENT')-Number(b.finding.candidateKind==='DATA_ELEMENT'));
 const normalized=sorted.map(c=>({original:c,normalized:scanner.normalizeObjectCandidate(c,{candidates:result.candidates})}));
 await t.test('real normalized candidates and agent versions persist and replay',async()=>{
  for(const {original:c,normalized:n} of normalized){
   const candidate=n.status==='NORMALIZED'?n.candidate:null;
   assert.equal((await admit(c.finding,candidate)).outcome,'APPLIED',JSON.stringify({finding:c.finding,candidate}));
   assert.equal((await admit(c.finding,candidate)).outcome,'REPLAYED');
  }
  for(const v of versions) assert.equal((await admit(v.finding,v.candidate)).outcome,'APPLIED',JSON.stringify(v.candidate));
 });
 await t.test('finding authority is validated and DB columns are constants',async()=>{
  const f=sorted[0].finding;
  for(const patch of [{reviewStatus:'ACCEPTED'},{reviewStatus:'REJECTED'},{requiresReview:false},{createsCanonicalObject:true},{actor:'HUMAN'}])
   await assert.rejects(admit({...f,...patch}),/22023/);
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.discovery_findings where organisation_id='${m.org}' and (review_status<>'UNREVIEWED' or not requires_review or creates_canonical_object)`),'0');
  assert.equal((await admit({...f,confidence:0.123})).outcome,'CONTENT_CONFLICT');
  assert.equal((await admit({...f,assertionIds:['source-assertion:'+'0'.repeat(32)]})).outcome,'DENIED');
 });
 await t.test('exact candidate read has identical missing, foreign and unadmitted outcomes; governed read exposes boolean only',async()=>{
  const n=normalized.find(n=>n.normalized.status==='NORMALIZED')!;
  const read=(id:string,r=run)=>m.call(`select gov_repo.discovery_machine_get_candidate_v1(${q(r)},${q(id)})`);
  assert.deepEqual((await read(n.original.finding.findingId)).candidate,n.normalized.status==='NORMALIZED'?n.normalized.candidate:null);
  const missing=await read('discovery-finding:'+'0'.repeat(32)); assert.deepEqual(missing,{outcome:'READ',candidate:null});
  const another=(await m.open()).provenance.run_id;
  assert.deepEqual(await read(n.original.finding.findingId,another),missing);
  const foreign=await provisionS3(pg); const foreignRun=(await foreign.open()).provenance.run_id;
  assert.deepEqual(await foreign.call(`select gov_repo.discovery_machine_get_candidate_v1(${q(foreignRun)},${q(n.original.finding.findingId)})`),missing);
  assert.equal((await read(n.original.finding.findingId,foreignRun)).outcome,'DENIED');
  for(const identity of ['missing','%','_','prefix%']) assert.deepEqual(await m.call(`select gov_repo.discovery_machine_is_governed_v1(${q(run)},'file',${q(n.original.finding.sourceObject.externalId)},'AGENT',${q(identity)})`),{outcome:'READ',isGoverned:false});
  // Trusted fixture populates an exact mapping while bypassing its unrelated canonical FKs only in this disposable test.
  await pg.bootstrapSql(`set session_replication_role=replica; insert into gov_repo.canonical_normalized_object_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,normalized_object_identity,candidate_id,created_by_decision_id,match_method,valid_from)
   values('s3-mapping','${m.org}','protected-canonical','AGENT',${q(m.connection)},'file','exact.ts','exact-agent','fixture-candidate','fixture-decision','MANUAL',clock_timestamp())`);
  assert.deepEqual(await m.call(`select gov_repo.discovery_machine_is_governed_v1(${q(run)},'file','exact.ts','AGENT','exact-agent')`),{outcome:'READ',isGoverned:true});
  for(const id of ['exact%','exact_','exact','exact-agent%']) assert.deepEqual(await m.call(`select gov_repo.discovery_machine_is_governed_v1(${q(run)},'file','exact.ts','AGENT',${q(id)})`),{outcome:'READ',isGoverned:false});
 });
 await t.test('DB derives DETECTED subject; replay preserves advanced human state without audit/outbox',async()=>{
  const f=sorted[0].finding;
  const command=`select gov_repo.discovery_machine_create_subject_v1(${q(run)},${q(f.findingId)})`;
  const before=await pg.bootstrapSql(`select count(*) from gov_repo.review_audit_events`);
  const first=await m.call(command); assert.equal(first.outcome,'APPLIED'); assert.equal(first.currentState,'DETECTED');
  assert.equal(first.reviewSubjectId,deriveReviewSubjectId(m.org as never,f.findingId));
  assert.deepEqual(JSON.parse(await pg.bootstrapSql(`select json_build_array(state,revision,last_transition_id) from gov_repo.review_subjects where review_subject_id=${q(first.reviewSubjectId)}`)),['DETECTED',0,null]);
  assert.equal((await m.call(command)).outcome,'REPLAYED');
  // Trusted fixture models an already-advanced human projection; machine replay must leave it byte-identical.
  await pg.bootstrapSql(`update gov_repo.review_subjects set state='CONFIRMED',revision=2 where review_subject_id=${q(first.reviewSubjectId)}`);
  const advanced=await pg.bootstrapSql(`select to_jsonb(s) from gov_repo.review_subjects s where review_subject_id=${q(first.reviewSubjectId)}`);
  const replay=await m.call(command); assert.equal(replay.outcome,'REPLAYED'); assert.equal(replay.currentState,'CONFIRMED');
  assert.equal(await pg.bootstrapSql(`select to_jsonb(s) from gov_repo.review_subjects s where review_subject_id=${q(first.reviewSubjectId)}`),advanced);
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.review_audit_events`),before);
 });
 await t.test('technical profiles remain proposals and execution snapshots derive sensitive context',async()=>{
  for(const v of versions){
   const empty={assertionIds:[],evidenceIds:[]};
   const proposal={proposalId:'agent-version-technical-profile-proposal:'+createHash('sha256').update(JSON.stringify(['agent-version-technical-profile-proposal',v.candidate.candidateId])).digest('hex'),
    agentVersionCandidateId:v.candidate.candidateId,behaviorFingerprintAlgorithm:'sha256',behaviorFingerprintSchemaVersion:v.behaviorFingerprintSchemaVersion??'1.0',
    behaviorFingerprintValue:v.technicalRevisionFingerprint,...(v.runtimeFrameworkReference?{runtimeFrameworkReference:v.runtimeFrameworkReference}:{}),
    support:{behaviorFingerprint:{assertionIds:v.finding.assertionIds,evidenceIds:v.finding.evidenceIds},buildReference:empty,
     runtimeFrameworkReference:v.runtimeFrameworkReferenceSupport??empty,entrypointReference:empty,configurationReference:empty},contractVersion:'1.0'};
   const profile=(p:unknown)=>m.call(`select gov_repo.discovery_machine_record_technical_profile_v1(${q(run)},${q(JSON.stringify(p))})`);
   assert.equal((await profile(proposal)).outcome,'APPLIED'); assert.equal((await profile(proposal)).outcome,'REPLAYED');
   assert.equal((await profile({...proposal,behaviorFingerprintValue:'f'.repeat(32)})).outcome,'CONTENT_CONFLICT');
   if(!v.executionFacts?.length)continue;
   const agent=result.candidates.find(c=>c.finding.candidateKind==='AGENT'&&c.finding.sourceObject.externalId===v.finding.sourceObject.externalId)!;
   let snapshot:ExecutionSourceSnapshot|undefined;
   await recordExecutionSource(m.org as never,v,agent,'source-system:github','github',
    {recordEvidence:async()=>{},recordSourceAssertion:async()=>{}} as never,{recordSnapshot:async(s:ExecutionSourceSnapshot)=>{snapshot=s;}} as never);
   assert.ok(snapshot);
   const {organisationId,sourceScope,sourceSystemId,providerCode,...input}=snapshot;
   const command=(s:unknown)=>m.call(`select gov_repo.discovery_machine_record_execution_snapshot_v1(${q(run)},${q(JSON.stringify(s))})`);
   assert.equal((await command(input)).outcome,'APPLIED'); assert.equal((await command(input)).outcome,'REPLAYED');
   assert.deepEqual((await Promise.all([command(input),command(input)])).map(r=>r.outcome),['REPLAYED','REPLAYED']);
   const storedDigest=await pg.bootstrapSql(`select content_digest from gov_repo.execution_source_snapshots where organisation_id='${m.org}' and snapshot_id=${q(input.snapshotId)}`);
   // A trusted legacy writer could have preclaimed this identity. Model conflicting persisted
   // content only in the disposable fixture; machine must neither overwrite it nor accept replay.
   await pg.bootstrapSql(`set session_replication_role=replica; update gov_repo.execution_source_snapshots set content_digest=repeat('0',64) where organisation_id='${m.org}' and snapshot_id=${q(input.snapshotId)}`);
   assert.equal((await command(input)).outcome,'CONTENT_CONFLICT');
   await pg.bootstrapSql(`set session_replication_role=replica; update gov_repo.execution_source_snapshots set content_digest=${q(storedDigest)} where organisation_id='${m.org}' and snapshot_id=${q(input.snapshotId)}`);
   assert.equal(await pg.bootstrapSql(`select source_scope from gov_repo.execution_source_snapshots where organisation_id='${m.org}' and snapshot_id=${q(input.snapshotId)}`),sourceScope);
   assert.equal(await pg.bootstrapSql(`select authorization_state from gov_repo.execution_source_snapshots where organisation_id='${m.org}' and snapshot_id=${q(input.snapshotId)}`),'UNKNOWN');
   for(const patch of [{organisationId},{sourceScope},{sourceSystemId},{providerCode},{expected_previous:null},{authorizationState:'AUTHORIZED'},{snapshotId:'execution-snapshot:'+'0'.repeat(64)}])
    await assert.rejects(command({...input,...patch}),/22023/);
   await assert.rejects(pg.login(`select gov_repo.record_execution_snapshot('${m.org}',${q(JSON.stringify(snapshot))},null)`,m.role),/42501/);
  }
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.agent_version_technical_profiles where organisation_id='${m.org}'`),'0');
 });
 const relationships=new scanner.RelationshipCorrelationStrategy().correlate(result.candidates,result.run.startedAt,
  {organisationId:m.org as never,connectionId:result.run.connection.connectionId,agentVersions:versions,technicalProfileSignals:result.technicalProfileSignals});
 await t.test('production relationships require durable admitted endpoints and closed lineage',async()=>{
  assert.ok(relationships.length); assert.ok(relationships.some(r=>r.candidate.relationshipTypeCode==='DERIVED_FROM'));
  for(const r of relationships){
   if(r.candidate.relationshipTypeCode!=='DERIVED_FROM') {assert.equal((await admit(r.finding,r.candidate)).outcome,'APPLIED'); continue;}
   assert.equal((await admit(r.finding,r.candidate)).outcome,'DENIED');
   const command=`select gov_repo.discovery_machine_admit_lineage_v1(${q(run)},${q(JSON.stringify(r.finding))},${q(JSON.stringify(r.candidate))})`;
   assert.equal((await m.call(command)).outcome,'APPLIED'); assert.equal((await m.call(command)).outcome,'REPLAYED');
   const expected=lineageObservationFinding(r.finding,r.candidate);
   assert.equal(await pg.bootstrapSql(`select observation_finding_id from gov_repo.lineage_candidate_observations where organisation_id='${m.org}' and candidate_id=${q(r.candidate.candidateId)}`),expected.findingId);
  }
 });
});
