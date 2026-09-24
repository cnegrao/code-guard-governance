import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asCanonicalObjectId, asIsoTimestamp, asRelationshipId, asRelationshipStateId,
  runtimeKnown, type CrossSignalComparisonResult } from '@council/canonical-contracts';
import { comparePrincipalIdentityDesignTimeVsRuntime, compareDependencyTargetIdentityDesignTimeVsRuntime,
  crossSignalComparisonIdentity, validatePersistedRuntimeObservation } from '@council/governance-review';
import { runtimeFromRow, runtimeToRow } from '../../lib/governance/runtime-row';
import { disposablePostgres } from '../helpers/disposable-postgres';
import { fixture, exact } from '../helpers/runtime-fixtures';
import { seedGovernedSupport, binding } from '../helpers/runtime-governed-fixtures';
import { org, foreign, literal, composite, config, admission } from '../helpers/runtime-database';

test('M15 real PostgreSQL persistence regression', { timeout: 180000 }, async t => {
  const db = await disposablePostgres(message => t.diagnostic(message));
  t.after(() => db.stop());
  const { sql } = db;
  // Admin-only fixture setup, using real canonical tables with all constraints enabled.
  await sql(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
    values('${org}','m15-a','M15 A','M15 A','BR'),('${foreign}','m15-b','M15 B','M15 B','BR');`);
  await seedGovernedSupport(sql);
  await sql(`insert into gov_repo.execution_field_decisions
    (organisation_id,decision_id,canonical_object_id,snapshot_id,field_key,outcome,actor_reference,decided_at,content_digest)
    values('${org}','m15-principal-decision','m142-version','m13-snapshot','PRINCIPAL','ACCEPT_PROPOSED','fixture-admin',now(),'fixture');
    insert into gov_repo.execution_field_states
    (organisation_id,state_id,canonical_object_id,field_key,snapshot_id,decision_id,recorded_at)
    values('${org}','m15-principal-state','m142-version','PRINCIPAL','m13-snapshot','m15-principal-decision',now());
    insert into gov_repo.reconciliation_decisions
    (decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
     subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash)
    values('m15-model-decision','${org}','OBJECT','CREATE_NEW','MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),
     'candidate:m15-model-2','m15-model-2','MODEL','1.0','{}',repeat('a',64));
    insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id)
    values('m15-model-2','${org}','MODEL','m15-model-decision');`);
  const observation = fixture('MODEL_CALL');
  assert.equal(observation.kind, 'MODEL_CALL');
  const subject = { organisationId: observation.organisationId, objectId: asCanonicalObjectId('m142-version'), kind: 'AGENT_VERSION' as const };
  const principal = { kind: 'WORKLOAD_IDENTITY' as const, providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload' };
  const states = ['m142-model', 'm15-model-2'].map((target, i) => ({
    relationshipId: asRelationshipId(`m15-rel-${i}`), relationshipStateId: asRelationshipStateId(`m15-state-${i}`),
    decisionId: `m15-rel-decision-${i}`, source: subject, relationshipType: 'USES_MODEL' as const,
    target: { organisationId: subject.organisationId, objectId: asCanonicalObjectId(target), kind: 'MODEL' as const },
    validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'),
  }));
  for (const state of states) {
    await sql(`insert into gov_repo.reconciliation_decisions
      (decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
       relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
      values('${state.decisionId}','${org}','RELATIONSHIP','CREATE_NEW','USES_MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),
       'candidate:${state.relationshipId}','USES_MODEL','1.0','{}',repeat('a',64));
      insert into gov_repo.canonical_relationships
      (organisation_id,relationship_id,relationship_state_id,relationship_type,source_canonical_object_id,source_kind,
       target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
      values('${org}','${state.relationshipId}','${state.relationshipStateId}','USES_MODEL','m142-version','AGENT_VERSION',
       '${state.target.objectId}','MODEL','${state.validFrom}',now(),'${state.decisionId}');`);
  }
  const connection = observation.sourceConnection.connectionId;
  await sql(`select gov_repo.register_runtime_source('${org}','${connection}','system','provider','producer','fixture-admin');
    select gov_repo.configure_runtime_source('${org}','${connection}',${composite(config(), 'runtime_source_configurations')});
    select gov_repo.activate_runtime_source('${org}','${connection}','1',true,'fixture-admin');
    select gov_repo.register_runtime_binding('${org}','${connection}',${composite(binding(), 'runtime_deployment_bindings')});`);
  const runtimeInput = { ...observation, binding: exact(), context: { ...observation.context,
    principal: runtimeKnown({ value: principal, support: { evidence: observation.provenance.evidence,
      method: { code: 'DIRECT_RUNTIME_MEASUREMENT' as const, version: '1.0.0' as const } } }) } };
  const admitted = JSON.parse(await sql('set role service_role; ' + admission(runtimeToRow(runtimeInput))));
  assert.equal(admitted.replay, false);
  const runtime = validatePersistedRuntimeObservation(runtimeFromRow(admitted.observation));
  const evaluatedAt = asIsoTimestamp('2026-09-23T12:00:00.000Z');
  const principalResult = comparePrincipalIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime, evaluatedAt,
    designTime: { canonicalObject: subject, field: 'PRINCIPAL', executionFieldStateId: 'm15-principal-state',
      decisionId: 'm15-principal-decision', snapshotId: 'm13-snapshot', principal } });
  const dependencyResult = compareDependencyTargetIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime,
    evaluatedAt, governedStates: states });
  assert.equal(principalResult.outcome, 'CONSISTENT');
  assert.equal(dependencyResult.left?.kind, 'RELATIONSHIP_STATE_SET');
  assert.ok(dependencyResult.left?.kind === 'RELATIONSHIP_STATE_SET' && dependencyResult.left.states.length === 2);
  const call = async (result: CrossSignalComparisonResult) => JSON.parse(await sql(`set role service_role;
    select row_to_json(reply) from gov_repo.record_cross_signal_comparison_result('${org}',
      ${literal(crossSignalComparisonIdentity(result))},${literal(JSON.stringify(result))}::jsonb) reply;`));
  const counts = () => sql(`select (select count(*) from gov_repo.cross_signal_comparison_results)||':'||
    (select count(*) from gov_repo.cross_signal_comparison_left_relationship_states);`);
  const evidence = () => sql(`select jsonb_build_array(
    (select jsonb_agg(to_jsonb(x) order by state_id) from gov_repo.execution_field_states x),
    (select jsonb_agg(to_jsonb(x) order by relationship_id) from gov_repo.canonical_relationships x),
    (select jsonb_agg(to_jsonb(x) order by observation_id) from gov_repo.runtime_observations x));`);
  const before = await evidence();
  let principalWrite: Record<string, unknown>;
  let dependencyWrite: Record<string, unknown>;
  await t.test('PRINCIPAL first write: SQL RPC returns replay=false', async () => {
    principalWrite = await call(principalResult);
    assert.equal(principalWrite.replay, false);
    assert.equal(principalWrite.comparison_id, crossSignalComparisonIdentity(principalResult));
    assert.equal(await counts(), '1:0');
  });
  await t.test('PRINCIPAL replay: parent lookup executes and preserves original time', async () => {
    const replay = await call({ ...principalResult, evaluatedAt: asIsoTimestamp('2026-09-24T00:00:00.000Z') });
    assert.deepEqual(replay, { ...principalWrite, replay: true });
    assert.equal(await counts(), '1:0');
  });
  await t.test('DEPENDENCY first write: verification CTE executes, persists two children', async () => {
    dependencyWrite = await call(dependencyResult);
    assert.equal(dependencyWrite.replay, false);
    assert.equal(dependencyWrite.comparison_id, crossSignalComparisonIdentity(dependencyResult));
    assert.equal(await counts(), '2:2');
    const children = JSON.parse(await sql(`select jsonb_agg(jsonb_build_object('relationshipId',relationship_id,
      'relationshipStateId',relationship_state_id,'decisionId',decision_id) order by relationship_id)
      from gov_repo.cross_signal_comparison_left_relationship_states;`));
    assert.deepEqual(children, states.map(({ relationshipId, relationshipStateId, decisionId }) => ({ relationshipId, relationshipStateId, decisionId })));
  });
  await t.test('DEPENDENCY reordered replay: same identity, child replay query executes', async () => {
    assert.ok(dependencyResult.left?.kind === 'RELATIONSHIP_STATE_SET');
    const reversed = { ...dependencyResult, left: { ...dependencyResult.left, states: [...dependencyResult.left.states].reverse() } };
    assert.notDeepEqual(reversed.left.states, dependencyResult.left.states);
    assert.equal(crossSignalComparisonIdentity(reversed), crossSignalComparisonIdentity(dependencyResult));
    assert.deepEqual(await call(reversed), { ...dependencyWrite, replay: true });
    assert.equal(await counts(), '2:2');
  });
  await t.test('Replay conflicts: same identity with changed outcome or reason fails without writes', async () => {
    for (const changed of [
      { ...principalResult, outcome: 'CONFLICT_CANDIDATE' as const },
      { ...dependencyResult, reason: dependencyResult.reason === 'RUNTIME_TARGET_NOT_PROVEN' ? 'CLOCK_UNCERTAIN' as const : 'RUNTIME_TARGET_NOT_PROVEN' as const },
    ]) {
      const original = changed.dimension === 'PRINCIPAL_IDENTITY' ? principalResult : dependencyResult;
      assert.equal(crossSignalComparisonIdentity(changed), crossSignalComparisonIdentity(original));
      await assert.rejects(call(changed), /P0001: CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT/);
    }
    assert.equal(await counts(), '2:2');
    assert.equal(await evidence(), before);
  });
  // Isolated negative controls use actual M15 row types/tables; never production migrations.
  await sql(`create function public.m15_bad_output() returns table(comparison_id text)
    language plpgsql as $$ begin
      return query select csr.comparison_id from gov_repo.cross_signal_comparison_results csr
        where comparison_id = 'irrelevant';
    end $$;
    create function public.m15_bad_alias() returns uuid language plpgsql as $$
    declare r gov_repo.cross_signal_comparison_results%rowtype; v uuid;
    begin select r.organisation_id into v from gov_repo.canonical_relationships r limit 1; return v; end $$;`);
  await t.test('Negative control: unqualified output comparison_id produces PostgreSQL 42702', async () => {
    await assert.rejects(sql('select * from public.m15_bad_output();'), error => {
      assert.match(String(error), /42702: column reference "comparison_id" is ambiguous/);
      t.diagnostic('PostgreSQL SQLSTATE 42702 observed: comparison_id output variable / column collision');
      return true;
    });
  });
  await t.test('Negative control: row variable / alias r.organisation_id produces PostgreSQL 42702', async () => {
    await assert.rejects(sql('select public.m15_bad_alias();'), error => {
      assert.match(String(error), /42702: column reference "r.organisation_id" is ambiguous/);
      t.diagnostic('PostgreSQL SQLSTATE 42702 observed: r.organisation_id alias / row variable collision');
      return true;
    });
  });
});
