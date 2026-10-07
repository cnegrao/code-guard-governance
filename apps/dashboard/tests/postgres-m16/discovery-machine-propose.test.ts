import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { s3Cluster, provisionS3, producerCorpus } from '../helpers/discovery-machine-s3-fixtures';
import { literal as q, RAW } from '../helpers/discovery-machine-s2-fixtures';
import { deriveReviewSubjectId, deriveProposeCommandId, deriveProposeEventId } from '@council/governance-review';

export const migration = '20261006134858_discovery_machine_propose_worker_v1.sql';
test('machine PROPOSE: current authority, fixed actor, durable support, replay and denial', { timeout: 300_000 }, async t => {
 const pg = await s3Cluster(m => t.diagnostic(m)); t.after(() => pg.stop());
 const human = await pg.inventory();
 await pg.owner(readFileSync(new URL(`../../../../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
 assert.deepEqual((await pg.inventory()).filter(p => p.app), human.filter(p => p.app));
 const m = await provisionS3(pg);
 await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',1,'ENABLED',true,true,'test','S4')`);
 const run = (await m.open()).provenance.run_id;
 const corpus = await producerCorpus();
 const item = corpus.result.candidates.find(c => c.finding.candidateKind === 'MODEL')!;
 assert.ok(item);
 const admit = async (r: string) => {
  assert.match((await m.call(`select gov_repo.discovery_machine_admit_observation_v1(${q(r)},${q(JSON.stringify([item.evidence]))},${q(JSON.stringify({...item.assertion,runId:r}))})`)).outcome,/APPLIED|REPLAYED/);
  assert.match((await m.call(`select gov_repo.discovery_machine_admit_finding_v1(${q(r)},${q(JSON.stringify(item.finding))},null)`)).outcome,/APPLIED|REPLAYED/);
  return m.call(`select gov_repo.discovery_machine_create_subject_v1(${q(r)},${q(item.finding.findingId)})`);
 };
 const propose = (r=run) => m.call(`select gov_repo.propose_discovery_finding_v1(${q(r)},${q(item.finding.findingId)})`);
 await t.test('missing support is denied, then machine applies exactly one deterministic proposal', async () => {
  assert.equal((await propose()).outcome,'DENIED');
  assert.equal((await admit(run)).currentState,'DETECTED');
  const applied = await propose(); assert.equal(applied.outcome,'APPLIED');
  const subject=deriveReviewSubjectId(m.org as never,item.finding.findingId);
  assert.equal(applied.reviewSubjectId,subject);
  assert.equal(applied.eventId,deriveProposeEventId(subject,deriveProposeCommandId(subject)));
  const row=JSON.parse(await pg.owner(`select row_to_json(e) from gov_repo.review_audit_events e where event_id=${q(applied.eventId)}`));
  assert.equal(row.actor_kind,'DETERMINISTIC_RULE'); assert.equal(row.actor_reference,null);
  assert.equal(row.actor_rule_code,'PASS_THROUGH_V1'); assert.equal(row.actor_rule_version,'1.0');
  assert.equal(row.previous_state,'DETECTED'); assert.equal(row.new_state,'PROPOSED');
  assert.equal((await propose()).outcome,'REPLAYED');
  assert.equal(await pg.owner(`select count(*) from gov_repo.review_audit_events where review_subject_id=${q(subject)}`),'1');
  assert.equal(await pg.bootstrapSql(`select count(*) from gov_repo.machine_invocation_audit where event_id=${q(applied.eventId)}`),'2');
 });
 await t.test('no alternate state/action, raw, HUMAN, materialization, administration or direct table privilege', async () => {
  for (const action of ['VALIDATED','APPROVE','REJECT','CONFIRMED','CERTIFIED'])
   await assert.rejects(m.call(`select gov_repo.propose_discovery_finding_v1(${q(run)},${q(item.finding.findingId)},${q(action)})`),/42883/);
  const names=[...RAW,'apply_review_transition_governed_v1','machine_change_binding_v1'];
  for (const name of names) assert.equal(await pg.owner(`select bool_or(has_function_privilege(${q(m.role)},p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gov_repo' and p.proname=${q(name)}`),'f',name);
  for(const table of ['canonical_objects','canonical_relationships','machine_execution_bindings','machine_invocation_audit','review_subjects'])
   assert.equal(await pg.owner(`select has_table_privilege(${q(m.role)},'gov_repo.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`),'f',table);
  await assert.rejects(pg.login(`set role govia_discovery_propose_owner`,m.role),/42501/);
 });
 await t.test('foreign tenant, unknown run and intake-only binding fail closed', async () => {
  const other=await provisionS3(pg);
  assert.equal((await other.call(`select gov_repo.propose_discovery_finding_v1(${q(run)},${q(item.finding.findingId)})`)).outcome,'DENIED');
  assert.equal((await propose('acquisition-run:00000000-0000-0000-0000-000000000000')).outcome,'DENIED');
  await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',2,'ENABLED',true,false,'test','S4')`);
  assert.equal((await propose()).outcome,'DENIED');
 });
 await t.test('replacement binding cannot inherit revoked support; admission restores eligible semantic replay', async () => {
  await pg.owner(`select gov_repo.machine_change_binding_v1('${m.binding}',3,'REVOKED',false,false,'test','S4')`);
  assert.equal((await propose()).outcome,'DENIED');
  const binding=await pg.owner(`select gov_repo.machine_provision_binding_v1('${m.principal}','${m.org}','github','Acme/Producer-Fixtures','acme/producer-fixtures',${q(m.connection)},'123','main','github','1.0',true,true,'test','S4')`);
  const r=(await m.call(`select gov_repo.discovery_machine_open_run_v1('${binding}','Acme/Producer-Fixtures','main','github','1.0','123','commit:${'a'.repeat(40)}','2026-10-02T12:00:00Z')`)).provenance.run_id;
  assert.equal((await propose(r)).outcome,'DENIED'); await admit(r);
  assert.equal((await propose(r)).outcome,'REPLAYED');
 });
});
