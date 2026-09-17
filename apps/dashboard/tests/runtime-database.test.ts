import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePersistedRuntimeObservation } from '@council/governance-review';
import { runtimeFromRow, runtimeToRow } from '../lib/governance/runtime-row';
import { modelWithCost, precisionBoundary } from './helpers/runtime-fixtures';
import { seedGovernedSupport, binding, registerBinding, authorityState } from './helpers/runtime-governed-fixtures';
import { databaseEnabled, databaseMode, databaseTarget, verifyHostedTarget, hostedProject, protectedProjectRef, verifyDatabaseEnvironment, sql, literal, composite, org, foreign, admission, observationRow, registerSource, config, migrationSql } from './helpers/runtime-database';

test('runtime migration has exactly four typed tenant tables and restricted fixed-path RPCs (structural only)', () => {
  const text = migrationSql.replace(/--[^\n]*/g,'');
  assert.equal([...text.matchAll(/create table gov_repo\.runtime_/g)].length,4);
  assert.doesNotMatch(text,/create table[^;]*\bjsonb?\b/i);
  assert.doesNotMatch(text,/(?:insert into|update|delete from|alter table) gov_repo\.(?:canonical_|execution_|discovery_|source_assertions)/i);
  assert.equal([...text.matchAll(/security definer set search_path=pg_catalog/g)].length,5);
  assert.match(text,/unique\(organisation_id,connection_id,trace_id,span_id\)/);
  assert.match(text,/pg_advisory_xact_lock/); assert.match(text,/numeric\(27,9\)/);
  assert.match(text,/from public,anon,authenticated,service_role/);
  const body=text.slice(text.indexOf('create function gov_repo.admit_runtime_observation'));
  assert.ok(body.indexOf('RUNTIME_REPLAY_CONFLICT')<body.indexOf('RUNTIME_SOURCE_INACTIVE'));
});

test('database target guard rejects remote hosts, conninfo overrides and unsupported acceptance modes',()=>{
  for(const patch of [{M14_LOCAL_DB_HOST:'example.supabase.co'},{M14_LOCAL_DB_NAME:'host=remote'},
    {M14_DATABASE_MODE:'supabase'},{M14_DATABASE_MODE:'standalone-accepted'},{M14_LOCAL_DB_PORT:'99999'}]) {
    assert.throws(()=>databaseTarget(patch),/M14_LOCAL_TARGET_INVALID/);
  }
  assert.equal(databaseTarget({}).mode,'pg16-auxiliary');
  assert.equal(databaseTarget({M14_DATABASE_MODE:'supabase',M14_SUPABASE_PROJECT_ID:'code-guard-governance',M14_LOCAL_DB_PORT:'54322',
    M14_LOCAL_DB_NAME:'postgres',M14_LOCAL_DB_USER:'postgres'}).mode,'supabase');
});

test('hosted guard rejects dev, unknown, mismatched metadata and absent opt-in ref',()=>{
  verifyHostedTarget(hostedProject.ref,hostedProject,hostedProject.ref);
  for(const ref of [protectedProjectRef,'unknown',''])assert.throws(()=>verifyHostedTarget(ref,hostedProject,hostedProject.ref),/STOP_WRONG_SUPABASE_TARGET/);
  assert.throws(()=>verifyHostedTarget(hostedProject.ref,{...hostedProject,name:'gov-ia-dev'},hostedProject.ref),/STOP_WRONG_SUPABASE_TARGET/);
  assert.throws(()=>verifyHostedTarget(hostedProject.ref,hostedProject,undefined),/STOP_WRONG_SUPABASE_TARGET/);
});

test(databaseMode === 'supabase-hosted' ? 'authoritative hosted Supabase ov-ia-g2-test/PostgreSQL 17 runtime acceptance'
  : databaseMode === 'supabase' ? 'authoritative Supabase local/PostgreSQL 17 runtime acceptance'
  : 'PostgreSQL 16 AUXILIARY / NON-AUTHORITATIVE runtime validation', { skip: !databaseEnabled, timeout: 1800000 }, async t => {
  await verifyDatabaseEnvironment();
  assert.equal(await sql(`select count(*) from gov_repo.organisations where organisation_id in ('${org}','${foreign}') or org_code in ('m142-20260917-a','m142-20260917-b');`),'0','Fixture scope already exists; retain immutable evidence and stop, never delete/reuse it');
  assert.equal(await sql("select (select count(*) from gov_repo.canonical_objects where canonical_object_id like 'm142-%')+(select count(*) from gov_repo.acquisition_runs where run_id like 'run-m142-%')+(select count(*) from gov_repo.runtime_source_heads where connection_id like 'm142-20260917-%');"),'0','Fixture identifiers must be unused');
  await sql(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code) values
   ('${org}','m142-20260917-a','M14 test A','M14 test A','BR'),('${foreign}','m142-20260917-b','M14 test B','M14 test B','BR');`);
  await seedGovernedSupport();
  const authorityBefore=await authorityState();
  await registerSource(); await registerSource('m142-20260917-runtime-b'); await registerSource('m142-20260917-runtime-foreign',foreign);
  let durable: any;
  await t.test('all tables/RLS, service RPC and absence of direct grants',async()=>{
    assert.equal(await sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gov_repo' and c.relname in ('runtime_source_heads','runtime_source_configurations','runtime_deployment_bindings','runtime_observations') and c.relrowsecurity;"),'4');
    assert.equal(await sql("select count(*) from information_schema.columns where table_schema='gov_repo' and table_name like 'runtime_%' and data_type in ('json','jsonb');"),'0');
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal(await sql(`select has_table_privilege('${role}','gov_repo.runtime_observations','INSERT,UPDATE,DELETE,TRUNCATE');`),'f');
      await assert.rejects(sql(`set role ${role}; insert into gov_repo.runtime_source_heads(organisation_id) values('${org}');`),/permission denied/);
      await assert.rejects(sql(`set role ${role}; insert into gov_repo.runtime_observations(organisation_id) values('${org}');`),/permission denied/);
      await assert.rejects(sql(`set role ${role}; select gov_repo.register_runtime_source('${org}','forged','system','provider','producer','actor');`),/permission denied/);
    }
    assert.equal(await sql("select has_function_privilege('service_role','gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations)','EXECUTE');"),'t');
    for(const role of ['anon','authenticated'])await assert.rejects(sql(`set role ${role}; ${admission(observationRow())}`),/permission denied/);
    assert.equal(await sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral aclexplode(p.proacl) a where n.nspname='gov_repo' and (p.proname like '%runtime_%') and a.grantee=0 and a.privilege_type='EXECUTE';"),'0');
  });
  await t.test('valid unresolved admission, independent tokens and durable DB time',async()=>{
    durable=JSON.parse(await sql('set role service_role; '+admission(observationRow())));
    assert.equal(durable.replay,false); assert.ok(durable.observation.recorded_at);
    const readback=validatePersistedRuntimeObservation(runtimeFromRow(durable.observation));
    assert.equal(readback.binding.state,'UNRESOLVED'); assert.equal(readback.recordedAt.state,'KNOWN');
    assert.equal(readback.startedAtUnixNano,'1789516800000000001');
    await assert.rejects(sql(admission({...observationRow('bbbbbbbbbbbbbbbc'),recorded_at:'2020-01-01T00:00:00Z'})),/RUNTIME_OBSERVATION_INVALID/);
  });
  await t.test('sequential replay preserves ID/time and ignores only delivery fields',async()=>{
    const replay=observationRow(); replay.received_at='2027-01-01T00:00:00.000Z';
    for(const key of Object.keys(replay)) if((key==='observation_id'||key.endsWith('_observation'))&&replay[key]!==null)replay[key]='99999999-9999-4999-8999-999999999999';
    const result=JSON.parse(await sql(admission(replay))); assert.equal(result.replay,true); assert.deepEqual(result.observation,durable.observation);
    await assert.rejects(sql(admission({...observationRow(),source_status:'OK'})),/RUNTIME_REPLAY_CONFLICT/);
    await assert.rejects(sql(admission({...observationRow(),configuration_version:'2'})),/RUNTIME_REPLAY_CONFLICT/);
    const unordered={...observationRow('abababababababab'),limitations:['PARTIAL_COLLECTION','CLOCK_UNCERTAINTY']};
    const first=JSON.parse(await sql(admission(unordered)));
    const reordered=JSON.parse(await sql(admission({...unordered,limitations:[...unordered.limitations].reverse()})));
    assert.equal(reordered.replay,true);assert.deepEqual(reordered.observation,first.observation);
  });
  await t.test('N=8 simultaneous identical transactions have exactly one durable effect',async()=>{
    const row=observationRow('cccccccccccccccc');
    const results=await Promise.all(Array.from({length:8},()=>sql(admission(row,org,'m142-20260917-runtime-a',true))));
    const parsed=results.map(r=>JSON.parse(r.trim()));assert.equal(parsed.filter(r=>!r.replay).length,1);
    assert.ok(new Set(parsed.map(r=>r.backend)).size>1,'independent database backends');
    t.diagnostic(`Concurrent identical: 1 insert, 7 replays, ${new Set(parsed.map(r=>r.backend)).size} independent backends`);
    for(const result of parsed)assert.deepEqual(result.observation,parsed[0].observation);
    assert.equal(await sql("select count(*) from gov_repo.runtime_observations where connection_id='m142-20260917-runtime-a' and span_id='cccccccccccccccc';"),'1');
  });
  await t.test('simultaneous conflicting transactions have one winner and one rejection',async()=>{
    const row=observationRow('dddddddddddddddd');
    const results=await Promise.allSettled([row,{...row,source_status:'OK'}].map(r=>sql(admission(r,org,'m142-20260917-runtime-a',true))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const failure=results.find(r=>r.status==='rejected');assert.ok(failure&&failure.status==='rejected');assert.match(failure.reason.message,/RUNTIME_REPLAY_CONFLICT/);
    t.diagnostic('Concurrent conflict: 1 winner, 1 RUNTIME_REPLAY_CONFLICT');
    assert.equal(await sql("select count(*) from gov_repo.runtime_observations where connection_id='m142-20260917-runtime-a' and span_id='dddddddddddddddd';"),'1');
  });
  await t.test('tenant/source spoof and foreign evidence fail; other source/tenant remains independent',async()=>{
    await assert.rejects(sql(admission(observationRow(),foreign)),/RUNTIME_OBSERVATION_INVALID/);
    await assert.rejects(sql(admission(observationRow(),org,'m142-20260917-runtime-foreign')),/RUNTIME_OBSERVATION_INVALID/);
    await assert.rejects(sql(admission({...observationRow('eeeeeeeeeeeeeeee'),provenance_org:foreign})),/RUNTIME_OBSERVATION_INVALID/);
    await assert.rejects(sql(admission({...observationRow('eeeeeeeeeeeeeeee'),provenance_connection:'m142-20260917-runtime-foreign'})),/RUNTIME_OBSERVATION_INVALID/);
    for(const [tenant,connection]of [[org,'m142-20260917-runtime-b'],[foreign,'m142-20260917-runtime-foreign']]) {
      const row=observationRow();row.organisation_id=tenant;row.connection_id=connection;row.provenance_org=tenant;row.provenance_connection=connection;
      if(tenant===org){row.observation_id='44444444-4444-4444-8444-444444444444';row.provenance_observation=row.observation_id;}
      assert.equal(JSON.parse(await sql(admission(row,tenant,connection))).replay,false);
    }
  });
  await t.test('immutable observations/configuration and controlled source identity',async()=>{
    for(const statement of ["update gov_repo.runtime_observations set source_status='OK'","delete from gov_repo.runtime_observations","update gov_repo.runtime_source_configurations set max_observations=1","delete from gov_repo.runtime_source_configurations"])await assert.rejects(sql(`begin; ${statement} where organisation_id='${org}'; rollback;`),/RUNTIME_HISTORY_IMMUTABLE/);
    await assert.rejects(sql(`begin; update gov_repo.runtime_source_heads set producer_identity='changed' where organisation_id='${org}'; rollback;`),/RUNTIME_SOURCE_IDENTITY_IMMUTABLE/);
    for(const role of ['anon','authenticated','service_role'])for(const verb of ['update gov_repo.runtime_observations set source_status=\'OK\'','delete from gov_repo.runtime_observations'])await assert.rejects(sql(`begin; set local role ${role}; ${verb} where organisation_id='${org}'; rollback;`),/permission denied/);
  });
  await t.test('all five kinds and full precision supplied/derived costs',async()=>{
    for(const [i,kind]of (['EXECUTION','TOOL_CALL','MCP_CALL','API_CALL'] as const).entries()) {
      const result=JSON.parse(await sql(admission(observationRow('aaaaaaaaaaaaaaa'+i,kind))));
      assert.equal(validatePersistedRuntimeObservation(runtimeFromRow(result.observation)).kind,kind);
    }
    const row=runtimeToRow(modelWithCost());row.span_id='ffffffffffffffff';row.source_event_key=row.trace_id+':'+row.span_id;
    row.supplied_amount='999999999999999999.999999999';row.tokens_total_value=Number.MAX_SAFE_INTEGER;row.tokens_total_state='KNOWN';row.tokens_total_reason=null;
    const result=JSON.parse(await sql(admission(row)));const read=validatePersistedRuntimeObservation(runtimeFromRow(result.observation));
    assert.equal(result.observation.supplied_amount,'999999999999999999.999999999');assert.equal(read.kind,'MODEL_CALL');
    await assert.rejects(sql(admission({...observationRow('aaaaaaaaaaaaaaaf'),kind:'EXECUTION'})),/RUNTIME_OBSERVATION_INVALID/);
    const yearZero=observationRow('0000000000000001');yearZero.received_at='0001-01-01T00:00:00.000+00 BC';
    const zeroResult=JSON.parse(await sql(admission(yearZero)));
    assert.equal(validatePersistedRuntimeObservation(runtimeFromRow(zeroResult.observation)).receivedAt,'0000-01-01T00:00:00.000Z');
    for(const patch of [{started_nano:'9223372036854775808'},{tokens_input_state:'KNOWN',tokens_input_reason:null,tokens_input_value:'9007199254740992'},
      {received_at:'infinity'},{parent_state:'SPAN_REFERENCE',parent_span_id:'bbbbbbbbbbbbbbbf'},{target_reference:'not-approved'},
      {source_system_id:'foreign',connection_system:'foreign'},{provider_code:'foreign'},{configuration_version:'foreign'},
      {observation_id:'00000000-0000-0000-0000-000000000000',provenance_observation:'00000000-0000-0000-0000-000000000000'}])
      await assert.rejects(sql(admission({...observationRow('bbbbbbbbbbbbbbbf'),...patch})));
  });
  await t.test('deactivation and quota reject new events, preserve historical replay',async()=>{
    await sql(`select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-a','1',false,'test-admin');`);
    assert.equal(JSON.parse(await sql(admission(observationRow()))).replay,true);
    await assert.rejects(sql(admission(observationRow('1111111111111111'))),/RUNTIME_SOURCE_INACTIVE/);
    const next={...config('m142-20260917-runtime-a',org,'2'),max_observations:1};
    await sql(`select gov_repo.configure_runtime_source('${org}','m142-20260917-runtime-a',${composite(next,'runtime_source_configurations')});select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-a','2',true,'test-admin');`);
    assert.equal(JSON.parse(await sql(admission(observationRow()))).replay,true);
    await assert.rejects(sql(admission({...observationRow('1111111111111111'),configuration_version:'2'})),/RUNTIME_QUOTA_EXHAUSTED/);
    await sql(`select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-a','1',true,'test-admin');`);
  });
  await t.test('concurrent distinct events respect one remaining quota slot; supported facts/window are enforced',async()=>{
    await registerSource('m142-20260917-runtime-quota');
    const restricted={...config('m142-20260917-runtime-quota',org,'2'),max_observations:1};
    await sql(`select gov_repo.configure_runtime_source('${org}','m142-20260917-runtime-quota',${composite(restricted,'runtime_source_configurations')});select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-quota','2',true,'test-admin');`);
    const make=(span: string)=>({...observationRow(span),configuration_version:'2',connection_id:'m142-20260917-runtime-quota',provenance_connection:'m142-20260917-runtime-quota'});
    const results=await Promise.allSettled(['1212121212121212','1313131313131313','1414141414141414'].map(span=>sql(admission(make(span),org,'m142-20260917-runtime-quota',true))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(const result of results)if(result.status==='rejected')assert.match(result.reason.message,/RUNTIME_QUOTA_EXHAUSTED/);
    const winner=results.find(r=>r.status==='fulfilled');assert.ok(winner&&winner.status==='fulfilled');
    const accepted=JSON.parse(winner.value);
    assert.equal(JSON.parse(await sql(admission(make(accepted.observation.span_id),org,'m142-20260917-runtime-quota'))).replay,true);
    assert.equal(await sql("select count(*) from gov_repo.runtime_observations where connection_id='m142-20260917-runtime-quota';"),'1');
    t.diagnostic('Concurrent quota: 1 accepted, 2 rejected; identical replay retains 1 row');
    const noFacts={...config('m142-20260917-runtime-quota',org,'3'),supported_facts:[]};
    await sql(`select gov_repo.configure_runtime_source('${org}','m142-20260917-runtime-quota',${composite(noFacts,'runtime_source_configurations')});select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-quota','3',true,'test-admin');`);
    await assert.rejects(sql(admission({...make('1515151515151515'),configuration_version:'3'},org,'m142-20260917-runtime-quota')),/RUNTIME_FACT_UNSUPPORTED/);
    const expired={...config('m142-20260917-runtime-quota',org,'4'),admission_from:'2020-01-01T00:00:00.000Z',admission_until:'2020-01-02T00:00:00.000Z'};
    await sql(`select gov_repo.configure_runtime_source('${org}','m142-20260917-runtime-quota',${composite(expired,'runtime_source_configurations')});select gov_repo.activate_runtime_source('${org}','m142-20260917-runtime-quota','4',true,'test-admin');`);
    await assert.rejects(sql(admission({...make('1515151515151515'),configuration_version:'4'},org,'m142-20260917-runtime-quota')),/RUNTIME_ADMISSION_WINDOW_CLOSED/);
  });
  assert.equal(await authorityState(),authorityBefore);
  await t.test('verified deployment and exact target support are tenant-local and immutable',async()=>{
    const before=await authorityState();
    await registerBinding(binding());
    for(const patch of [
      {agent_version_id:'m142-foreign-version'}, {agent_version_id:'m142-agent',agent_version_kind:'AGENT'},
      {mapping_id:'mapping-m142-foreign-version'}, {mapping_id:'mapping-m142-model'}, {source_snapshot_id:'snapshot-m142-foreign-version'},
      {producer_identity:'foreign'}, {connection_id:'m142-20260917-runtime-foreign'}, {organisation_id:foreign},
      {candidate_id:'candidate:agent-version:'+'b'.repeat(32)},
    ])await assert.rejects(registerBinding({...binding(),binding_id:'forged',...patch}),/RUNTIME_BINDING_REJECTED/);
    for(const statement of ["update gov_repo.runtime_deployment_bindings set artifact_digest=repeat('d',64)","delete from gov_repo.runtime_deployment_bindings"])
      await assert.rejects(sql(`begin; ${statement} where organisation_id='${org}'; rollback;`),/RUNTIME_HISTORY_IMMUTABLE/);
    const row=observationRow('7777777777777777');Object.assign(row,{binding_state:'EXACT',unresolved_reason:null,
      deployment_state:'KNOWN',deployment_reason:null,deployment_value:'deployment',artifact_state:'KNOWN',artifact_reason:null,artifact_value:'c'.repeat(64),
      agent_version_id:'m142-version',agent_version_org:org,agent_version_kind:'AGENT_VERSION',binding_id:'binding',binding_org:org,binding_connection:'m142-20260917-runtime-a',
      binding_method:'VERIFIED_RELEASE_ASSOCIATION_V1',binding_version:'1.0.0',
      canonical_target_state:'KNOWN',canonical_target_reason:null,target_object_id:'m142-model',target_org:org,target_object_kind:'MODEL',
      target_proof_method:'EXACT_SOURCE_COORDINATES_V1',target_proof_version:'1.0.0',target_mapping_id:'mapping-m142-model',target_proof_provider:'provider',
      target_source_connection:'catalog-m142-model',target_external_type:'source',target_external_id:'requested-model'});
    const result=JSON.parse(await sql(admission(row)));assert.equal(result.replay,false);
    const read=validatePersistedRuntimeObservation(runtimeFromRow(result.observation));assert.equal(read.binding.state,'EXACT');
    assert.deepEqual(JSON.parse(await sql(admission(row))).observation,result.observation);
    let index=0;
    for(const patch of [{binding_id:'forged'},{agent_version_id:'m142-foreign-version'},{binding_org:foreign},{artifact_value:'d'.repeat(64)},
      {target_object_id:'m142-agent',target_object_kind:'AGENT'},{target_org:foreign},{target_mapping_id:'mapping-m142-foreign-model'},
      {target_object_id:'m142-foreign-model'},{target_source_connection:'catalog-m142-foreign-model'},{target_external_id:'foreign'}]) {
      const fresh=observationRow('888888888888888'+(index++).toString(16));
      await assert.rejects(sql(admission({...row,span_id:fresh.span_id,source_event_key:fresh.source_event_key,...patch})),/RUNTIME_(?:BINDING_INVALID|TARGET_INVALID|OBSERVATION_INVALID|ADMISSION_REJECTED)/);
    }
    assert.equal(await authorityState(),before);
  });
});

test('existing hosted fixture preserves all four UNKNOWN reasons', {
  skip: !databaseEnabled || databaseMode !== 'supabase-hosted', timeout: 120000,
}, async()=>{
  await verifyDatabaseEnvironment();
  assert.equal(await sql(`select count(*) from gov_repo.runtime_observations where organisation_id='${org}' and span_id in ('1616161616161610','1616161616161611','1616161616161612','1616161616161613');`),'0','Supplemental fixture IDs must be unused; do not repeat completed writes');
  const before=await authorityState();
  for(const [index,reason] of ['NOT_SUPPLIED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','NOT_APPLICABLE'].entries()) {
    const row={...observationRow('161616161616161'+index),outcome_reason:reason};
    const result=JSON.parse(await sql(admission(row)));
    const observation=validatePersistedRuntimeObservation(runtimeFromRow(result.observation));
    assert.deepEqual(observation.outcome,{state:'UNKNOWN',reason});
  }
  assert.equal(await authorityState(),before);
});

test('F01 regression: ended/source-observed unix-nano and duration survive the real JSON boundary at BIGINT scale', {
  skip: !databaseEnabled || databaseMode !== 'supabase-hosted', timeout: 120000,
}, async()=>{
  await verifyDatabaseEnvironment();
  assert.equal(await sql(`select count(*) from gov_repo.runtime_observations where connection_id='m142-20260917-runtime-a' and span_id='9898989898989898';`),'0','Supplemental fixture ID must be unused; do not repeat completed writes');
  const before=await authorityState();
  const row=runtimeToRow(precisionBoundary());row.span_id='9898989898989898';row.source_event_key=row.trace_id+':'+row.span_id;
  const precisionObservationId='98989898-9898-4898-8898-989898989898';
  for(const key of Object.keys(row))if((key==='observation_id'||key.endsWith('_observation'))&&row[key]!==null)row[key]=precisionObservationId;
  const result=JSON.parse(await sql(admission(row)));
  assert.equal(typeof result.observation.ended_nano_value,'string');
  assert.equal(typeof result.observation.source_observed_nano_value,'string');
  assert.equal(result.observation.started_nano,'1000000000000000000');
  assert.equal(result.observation.ended_nano_value,'9223372036854775807','must exceed Number.MAX_SAFE_INTEGER and survive byte-for-byte');
  assert.equal(result.observation.source_observed_nano_value,'9223372036854775807','independent BIGINT field at the signed int64 upper bound');
  assert.equal(result.observation.duration_value,'8223372036854775807');
  assert.ok(BigInt(result.observation.ended_nano_value)>BigInt(Number.MAX_SAFE_INTEGER));
  const read=validatePersistedRuntimeObservation(runtimeFromRow(result.observation));
  if(read.kind!=='EXECUTION')throw new Error('TEST_FIXTURE_INVALID');
  assert.deepEqual(read.endedAtUnixNano,{state:'KNOWN',value:'9223372036854775807'});
  assert.deepEqual(read.sourceObservedAtUnixNano,{state:'KNOWN',value:'9223372036854775807'});
  assert.equal(read.duration.state,'KNOWN');
  if(read.duration.state==='KNOWN'){assert.equal(read.duration.value.value,'8223372036854775807');assert.equal(read.duration.value.basis,'START_END_DIFFERENCE');}
  const replay=JSON.parse(await sql(admission(row)));
  assert.equal(replay.replay,true);assert.deepEqual(replay.observation,result.observation);
  assert.equal(await authorityState(),before);
});

test('F02 regression: identical connection_id label across two tenants stays isolated, not merged', {
  skip: !databaseEnabled || databaseMode !== 'supabase-hosted', timeout: 120000,
}, async()=>{
  await verifyDatabaseEnvironment();
  const shared='m142-20260917-shared-connection';
  assert.equal(await sql(`select count(*) from gov_repo.runtime_source_heads where connection_id='${shared}';`),'0','Supplemental connection label must be unused; do not repeat completed writes');
  const before=await authorityState();
  await registerSource(shared,org); await registerSource(shared,foreign);
  assert.equal(await sql(`select count(*) from gov_repo.runtime_source_heads where connection_id='${shared}';`),'2','both tenants may register the identical connection label');
  assert.equal(await sql(`select count(distinct organisation_id) from gov_repo.runtime_source_heads where connection_id='${shared}';`),'2');
  assert.equal(await sql(`select count(*) from gov_repo.runtime_source_configurations where connection_id='${shared}' and organisation_id='${org}';`),'1');
  assert.equal(await sql(`select count(*) from gov_repo.runtime_source_configurations where connection_id='${shared}' and organisation_id='${foreign}';`),'1');
  const sharedSpan='5656565656565656';
  const orgRow=observationRow(sharedSpan);orgRow.connection_id=shared;orgRow.provenance_connection=shared;
  const orgResult=JSON.parse(await sql(admission(orgRow,org,shared)));assert.equal(orgResult.replay,false);
  const foreignRow=observationRow(sharedSpan);foreignRow.connection_id=shared;foreignRow.provenance_connection=shared;
  foreignRow.organisation_id=foreign;foreignRow.provenance_org=foreign;
  foreignRow.observation_id='66666666-6666-4666-8666-666666666666';foreignRow.provenance_observation=foreignRow.observation_id;
  const foreignResult=JSON.parse(await sql(admission(foreignRow,foreign,shared)));
  assert.equal(foreignResult.replay,false,'identical trace/span under a different tenant on the same connection label is an independent event, not a replay or a merge');
  assert.equal(await sql(`select count(*) from gov_repo.runtime_observations where connection_id='${shared}' and span_id='${sharedSpan}';`),'2');
  assert.equal(await sql(`select count(distinct organisation_id) from gov_repo.runtime_observations where connection_id='${shared}' and span_id='${sharedSpan}';`),'2');
  const orgReplay=JSON.parse(await sql(admission(orgRow,org,shared)));
  assert.equal(orgReplay.replay,true);assert.deepEqual(orgReplay.observation,orgResult.observation);
  await assert.rejects(sql(admission(orgRow,foreign,shared)),/RUNTIME_OBSERVATION_INVALID/,'a tenant cannot admit under a foreign organisation id merely because the connection label is shared');
  assert.equal(await authorityState(),before);
});
