import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { disposableM16Postgres, credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration, governedWriteWrapperMigration } from '../helpers/disposable-m16-postgres';
import { canonicalObjectKit, reviewedObjectKit, legacyReconciliationSql, lit, jsonLit } from '../helpers/m16-governed-write-fixtures';

const correction = readFileSync(new URL('../../../../ops/agent-version-profile-v1/20261109191942_agent_version_technical_profile_governed_mapping_v1.sql', import.meta.url), 'utf8');
const deployment = readFileSync(new URL('../../../../ops/agent-version-profile-v1/deployment.sql', import.meta.url), 'utf8');
const last = (s: string) => s.trim().split(/\r?\n/).at(-1)!;
test('technical profile: real PG17 mapping, authority, replay and fingerprint gates', { timeout: 180_000 }, async t => {
  const pg = await disposableM16Postgres(m => t.diagnostic(m), { governanceWriteChain: true });
  t.after(() => pg.stop());
  const owner = (q: string) => pg.sql(q, 'postgres');
  await pg.bootstrapSql(`create schema if not exists extensions authorization postgres;
    do $move$ begin if (select extnamespace from pg_extension where extname='pgcrypto')<>'extensions'::regnamespace then alter extension pgcrypto set schema extensions; end if; end $move$;
    grant usage on schema extensions to postgres,service_role,anon,authenticated;`);
  for (const migration of [credentialMigration, eligibilityMigration, epochBindingMigration, objectMaterializationCompatMigration, governedWriteWrapperMigration]) await pg.migrate(migration);
  const org = randomUUID(), actor = randomUUID();
  // Transport is tested with its real organisation guard and atomic history.
  await pg.bootstrapSql('create schema supabase_migrations authorization postgres;');
  await owner(`create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active)
    values('082ef694-e016-4893-908c-1eef373f53af','GOVIA_DEMO','Guard fixture','Guard fixture','PT',true);`);
  await owner(deployment);
  assert.equal(last(await owner(`select statements[1]=${lit(correction)} from supabase_migrations.schema_migrations where version='20261109191942'`)),'t');
  await assert.rejects(owner(deployment),/PROFILE_MIGRATION_ALREADY_REGISTERED/);
  await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code,is_active) values('${org}','PROFILE','Profile','Profile','PT',true);
    insert into gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
    values('${actor}','profile@example.invalid','Profile test','${org}','active',array[(select role_id from gov_repo.governance_roles where role_code='GOVERNANCE_ADMIN' and is_system_role)]);`);
  await pg.bootstrapSql(`begin; alter table gov_repo.governance_users disable trigger trg_governance_users_credential_epoch_v1;
    update gov_repo.governance_users set password_changed_at=clock_timestamp()-interval '12 hours' where user_id='${actor}';
    alter table gov_repo.governance_users enable always trigger trg_governance_users_credential_epoch_v1; commit;`);
  const epoch = last(await owner(`select password_changed_at::text from gov_repo.governance_users where user_id='${actor}'`));
  async function fixture(label: string, historical = false, authorized = true, ambiguous = false) {
    const parent = canonicalObjectKit(org, 'parent-'+label, 'AGENT', { proposedIdentity: { agentReference: label }, identity: 'parent-'+label });
    await owner(parent.sql);
    const k = reviewedObjectKit(org, label, 'CERTIFIED', 'AGENT_VERSION');
    const identity = { agent: { candidateKind: 'AGENT', referenceKind: 'SOURCE_OBJECT', sourceObject: { connectionId: parent.connection, externalType: 'source', externalId: parent.externalId } } };
    // Replace only this fixture's old MODEL-specific envelope; no production routine is stubbed.
    const oldIdentity = { modelReference: 'model-'+label };
    await owner(k.sql.replaceAll(jsonLit(oldIdentity), jsonLit(identity)).replaceAll(JSON.stringify(oldIdentity), JSON.stringify(identity)));
    await owner(`insert into gov_repo.source_assertions(organisation_id,assertion_id,run_id,source_connection_id,source_external_type,source_external_id,method_code,trust_state,observed_at,recorded_at,contract_version,envelope,envelope_hash)
      values('${org}',${lit('assertion-'+label)},${lit('run-'+label)},${lit(k.connection)},'source',${lit(k.externalId)},'framework-import-declaration','INFERRED',now(),now(),'1.0','{}',repeat('a',64));
      insert into gov_repo.discovery_evidence(organisation_id,evidence_id,handling,captured_at,content_hash,contract_version,envelope,envelope_hash)
      values('${org}',${lit('evidence-'+label)},'NON_SENSITIVE',now(),repeat('a',64),'1.0','{}',repeat('a',64));
      insert into gov_repo.agent_version_technical_profile_proposals(organisation_id,proposal_id,agent_version_candidate_id,behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,behavior_fingerprint_value,runtime_framework_reference,contract_version,created_at)
      values('${org}',${lit('proposal-'+label)},${lit(k.candidate)},'sha256','1.0','fingerprint','LangGraph','1.0','2020-01-01');
      insert into gov_repo.agent_version_technical_profile_proposal_field_assertions values('${org}',${lit('proposal-'+label)},'runtimeFrameworkReference',${lit('assertion-'+label)});
      insert into gov_repo.agent_version_technical_profile_proposal_field_evidence values('${org}',${lit('proposal-'+label)},'runtimeFrameworkReference',${lit('evidence-'+label)});`);
    if (authorized) await owner(`insert into gov_repo.review_audit_events(event_id,review_subject_id,organisation_id,finding_id,previous_state,new_state,actor_kind,actor_reference,occurred_at,command_id)
      values(${lit('cert-'+label)},${lit(k.subject)},'${org}',${lit(k.finding)},'CONFIRMED','CERTIFIED','HUMAN','${actor}','2020-01-02',${lit('cert-command-'+label)});
      update gov_repo.review_subjects set last_transition_id=${lit('cert-'+label)} where organisation_id='${org}' and review_subject_id=${lit(k.subject)};`);
    await owner(legacyReconciliationSql(label, org, k, actor));
    await owner(`insert into gov_repo.reconciliation_decision_assertions values(${lit('decision-'+label)},'${org}',${lit('assertion-'+label)});
      insert into gov_repo.reconciliation_decision_evidence values(${lit('decision-'+label)},'${org}',${lit('evidence-'+label)});
      insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values(${lit(k.canonicalObjectId)},'${org}','AGENT_VERSION',${lit('decision-'+label)});
      insert into gov_repo.materialization_operations(materialization_operation_id,organisation_id,reconciliation_decision_id,invocation_id,decision_family,outcome,status,idempotency_fingerprint,resulting_canonical_object_id,applied_at)
      values(gen_random_uuid()::text,'${org}',${lit('decision-'+label)},${lit('invocation-'+label)},'OBJECT','CREATE_NEW','APPLIED',repeat('a',64),${lit(k.canonicalObjectId)},now());`);
    if (historical) await owner(`insert into gov_repo.canonical_object_source_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,match_method,created_by_decision_id,valid_from)
      values(gen_random_uuid()::text,'${org}',${lit(k.canonicalObjectId)},'AGENT_VERSION',${lit(k.connection)},'source',${lit(k.externalId)},'MANUAL',${lit('decision-'+label)},now());`);
    else for (let i = 0; i < (ambiguous ? 2 : 1); i++) await owner(`insert into gov_repo.canonical_normalized_object_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,normalized_object_identity,candidate_id,parent_canonical_object_id,created_by_decision_id,match_method,valid_from)
      values(gen_random_uuid()::text,'${org}',${lit(k.canonicalObjectId)},'AGENT_VERSION',${lit(k.connection)},'source',${lit(k.externalId)},${lit(k.candidate+(i ? ':other' : ''))},${lit(k.candidate)},${lit(parent.objectId)},${lit('decision-'+label)},'MANUAL',now());`);
    return { ...k, proposal: 'proposal-'+label };
  }
  const invoke = (k: Awaited<ReturnType<typeof fixture>>, proposal=k.proposal, tenant=org, version=k.canonicalObjectId) => owner(`select row_to_json(r) from gov_repo.materialize_agent_version_technical_profile('${tenant}',${lit(version)},${lit(proposal)},clock_timestamp()) r;`);
  await t.test('normalized exact mapping and INFERRED evidence; replay is a no-op', async () => {
    const k=await fixture('normalized'); assert.equal(JSON.parse(last(await invoke(k))).replay,false);
    const snapshot=()=>owner(`select md5(jsonb_build_array(
      (select jsonb_agg(to_jsonb(p) order by to_jsonb(p)::text) from gov_repo.agent_version_technical_profiles p where organisation_id='${org}'),
      (select jsonb_agg(to_jsonb(p) order by to_jsonb(p)::text) from gov_repo.agent_version_technical_profile_materializations p where organisation_id='${org}'),
      (select jsonb_agg(to_jsonb(p) order by to_jsonb(p)::text) from gov_repo.outbox_events p where organisation_id='${org}'),
      (select jsonb_agg(to_jsonb(p) order by to_jsonb(p)::text) from gov_repo.discovery_evidence p where organisation_id='${org}'),
      (select jsonb_agg(to_jsonb(p) order by to_jsonb(p)::text) from gov_repo.source_assertions p where organisation_id='${org}')
    )::text)`);
    const before=await snapshot();assert.equal(JSON.parse(last(await invoke(k))).replay,true);assert.equal(await snapshot(),before);
    assert.equal(last(await owner(`select revision from gov_repo.agent_version_technical_profiles where organisation_id='${org}' and canonical_object_id=${lit(k.canonicalObjectId)}`)),'0');
    assert.equal(last(await owner(`select trust_state from gov_repo.source_assertions where organisation_id='${org}' and assertion_id='assertion-normalized'`)),'INFERRED');
    assert.equal(last(await owner(`select count(*) from gov_repo.agent_version_technical_profile_field_evidence where organisation_id='${org}' and canonical_object_id=${lit(k.canonicalObjectId)}`)),'1');
    await owner(`insert into gov_repo.agent_version_technical_profile_proposals select organisation_id,'conflict-proposal',agent_version_candidate_id,behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,'different-fingerprint',build_reference,runtime_framework_reference,entrypoint_reference,configuration_reference,contract_version,created_at from gov_repo.agent_version_technical_profile_proposals where proposal_id=${lit(k.proposal)} and organisation_id='${org}'`);
    await assert.rejects(invoke(k,'conflict-proposal'),/AGENT_VERSION_TECHNICAL_REVISION_MISMATCH/);
    await assert.rejects(invoke(k,k.proposal,randomUUID()),/CANONICAL_OBJECT_NOT_FOUND/);
    await assert.rejects(invoke(k,k.proposal,org,'canonical-object:parent-normalized'),/CANONICAL_TARGET_KIND_MISMATCH/);
  });
  await t.test('historical exact mapping retains compatibility', async () => {const k=await fixture('historical',true);assert.equal(JSON.parse(last(await invoke(k))).status,'APPLIED');});
  await t.test('missing human certification and ambiguous mappings fail closed', async () => {
    await assert.rejects(invoke(await fixture('no-authority',false,false)),/PROFILE_AUTHORIZATION_REQUIRED/);
    await assert.rejects(invoke(await fixture('ambiguous',false,true,true)),/PROFILE_MAPPING_AMBIGUOUS/);
  });
  await t.test('wrong candidate/version coordinates cannot cross-bind', async () => {
    const a=await fixture('candidate-a'),b=await fixture('candidate-b');
    await assert.rejects(invoke(a,b.proposal),/PROFILE_AUTHORIZATION_REQUIRED/);
    await assert.rejects(invoke(a,a.proposal,org,b.canonicalObjectId),/PROFILE_AUTHORIZATION_REQUIRED/);
  });
  await t.test('later or uncovered proposals cannot borrow an earlier certification', async () => {
    const k=await fixture('later-proposal');
    await owner(`insert into gov_repo.agent_version_technical_profile_proposals select organisation_id,'later-proposal',agent_version_candidate_id,behavior_fingerprint_algorithm,behavior_fingerprint_schema_version,behavior_fingerprint_value,build_reference,runtime_framework_reference,entrypoint_reference,configuration_reference,contract_version,clock_timestamp() from gov_repo.agent_version_technical_profile_proposals where proposal_id=${lit(k.proposal)} and organisation_id='${org}'`);
    await assert.rejects(invoke(k,'later-proposal'),/PROFILE_AUTHORIZATION_REQUIRED/);
    const extra=await fixture('other-evidence');
    await owner(`insert into gov_repo.agent_version_technical_profile_proposal_field_evidence values('${org}',${lit(k.proposal)},'runtimeFrameworkReference','evidence-other-evidence')`);
    await assert.rejects(invoke(k),/PROFILE_AUTHORIZATION_REQUIRED/);
    assert.equal(last(await owner(`select count(*) from gov_repo.agent_version_technical_profile_materializations where organisation_id='${org}' and canonical_object_id in (${lit(k.canonicalObjectId)},${lit(extra.canonicalObjectId)})`)),'0');
  });
  await t.test('an invalid normalized mapping cannot fall back to a valid historical mapping', async () => {
    const k=await fixture('no-fallback',true);
    await owner(`insert into gov_repo.canonical_normalized_object_mappings(mapping_id,organisation_id,canonical_object_id,canonical_object_kind,source_connection_id,source_external_type,source_external_id,normalized_object_identity,candidate_id,parent_canonical_object_id,created_by_decision_id,match_method,valid_from)
      values(gen_random_uuid()::text,'${org}',${lit(k.canonicalObjectId)},'AGENT_VERSION',${lit(k.connection)},'source',${lit(k.externalId)},${lit(k.candidate+':wrong')},${lit(k.candidate)},'canonical-object:parent-no-fallback','decision-no-fallback','MANUAL',now());`);
    await assert.rejects(invoke(k),/PROPOSAL_NOT_MAPPED_TO_TARGET/);
  });
  await t.test('service must use verified-principal wrapper; raw/anonymous execution denied', async () => {
    const k=await fixture('wrapper');
    await assert.rejects(pg.sql(`select * from gov_repo.materialize_agent_version_technical_profile('${org}',${lit(k.canonicalObjectId)},${lit(k.proposal)},now());`,'service_role'),/permission denied/);
    const call=`select * from gov_repo.materialize_agent_version_technical_profile_governed_v1('${org}','${actor}',floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+600,${lit(epoch)}::timestamptz,${lit(k.canonicalObjectId)},${lit(k.proposal)},clock_timestamp());`;
    await assert.rejects(pg.sql(call,'anon'),/permission denied/);
    await pg.sql(call,'service_role');
    assert.equal(last(await owner(`select bool_or(has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class c where c.relnamespace='gov_repo'::regnamespace and c.relname in ('agent_version_technical_profiles','agent_version_technical_profile_field_assertions','agent_version_technical_profile_field_evidence','agent_version_technical_profile_materializations')`)),'f');
  });
});
