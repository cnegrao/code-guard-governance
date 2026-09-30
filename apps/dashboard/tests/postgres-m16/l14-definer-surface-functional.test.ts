import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asCanonicalObjectId, asIsoTimestamp, asRelationshipId, asRelationshipStateId, runtimeKnown, type CrossSignalComparisonResult,
} from '@council/canonical-contracts';
import {
  comparePrincipalIdentityDesignTimeVsRuntime, compareDependencyTargetIdentityDesignTimeVsRuntime, crossSignalComparisonIdentity,
  validatePersistedRuntimeObservation,
} from '@council/governance-review';
import { runtimeFromRow, runtimeToRow } from '../../lib/governance/runtime-row';
import { jsonLit, lit } from '../helpers/m16-governed-write-fixtures';
import {
  EXECUTORS, executionSnapshotKit, fullChainCluster, newAgent, newOrg, newUser, vectorLiteral,
} from '../helpers/m16-definer-surface-fixtures';
import { fixture, exact } from '../helpers/runtime-fixtures';
import { seedGovernedSupport, binding } from '../helpers/runtime-governed-fixtures';
import { org as runtimeOrg, foreign as runtimeForeign, literal, composite, config, admission } from '../helpers/runtime-database';

/**
 * M16-S1B.2R1 functional regression: every re-owned routine still performs its real product behaviour as
 * service_role under its least-privilege technical owner, application roles other than service_role are
 * denied, and no technical owner can reach a policy-store row.
 */
test('M16 S1B.2R1 re-owned routine regression (disposable PG17, full primary chain + R1)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { owner, svc, sql, bootstrapSql } = pg;
  const denied = async (query: string) => {
    for (const role of ['anon', 'authenticated'] as const) await assert.rejects(sql(query, role), /permission denied for function/, role);
  };

  await t.test('ledger_append / ledger_verify: service_role chain, tamper detection, anon/authenticated/PUBLIC denied', async () => {
    const append = (n: number) => svc(`select gov_repo.ledger_append('R1_EVENT_${n}','d','SUBJECT',gen_random_uuid(),gen_random_uuid(),'10.0.0.1'::inet,gen_random_uuid(),'{"n":${n}}'::jsonb)`);
    assert.equal(await append(1), '1');
    assert.equal(await append(2), '2');
    assert.equal(await append(3), '3');
    assert.equal(await owner(`select bool_and(previous_hash = prev) from (select previous_hash, lag(entry_hash) over (order by entry_sequence) prev from gov_repo.governance_ledger) x where prev is not null`), 't');
    assert.equal(await owner(`select previous_hash = encode(extensions.digest('CODEGUARD-GENESIS-2026','sha256'),'hex') from gov_repo.governance_ledger where entry_sequence = 1`), 't');
    assert.equal(await svc(`select concat_ws('|', is_valid, entries_checked, coalesce(first_break_at::text,'-')) from gov_repo.ledger_verify(1, null)`), 't|3|-');
    await denied(`select gov_repo.ledger_append('X','d','S',gen_random_uuid(),gen_random_uuid(),null,gen_random_uuid(),'{}')`);
    await denied(`select * from gov_repo.ledger_verify(1, null)`);
    assert.equal(await owner(`select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname in ('ledger_append','ledger_verify') and a.grantee = 0`), '0');
    // Tamper: a row whose entry_hash is not the recomputed chain hash (owner-only fixture insert).
    await owner(`insert into gov_repo.governance_ledger(event_type,event_description,subject_type,subject_id,actor_user_id,organisation_id,previous_hash,entry_hash,payload)
      select 'TAMPER','t','S',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),entry_hash,repeat('f',64),'{}' from gov_repo.governance_ledger where entry_sequence = 3`);
    const broken = await svc(`select concat_ws('|', is_valid, entries_checked, first_break_at, break_reason) from gov_repo.ledger_verify(1, null)`);
    assert.match(broken, /^f\|4\|4\|entry_hash tampered at sequence 4\. Recomputed: [0-9a-f]{64}, stored: f{64}$/);
    assert.equal(await svc(`select concat_ws('|', is_valid, entries_checked) from gov_repo.ledger_verify(1, 3)`), 't|3');
  });

  await t.test('no technical owner can reach a policy-store row; each can reach only its own objects', async () => {
    for (const role of EXECUTORS) {
      for (const store of ['governance_policies', 'policy_versions']) {
        await assert.rejects(bootstrapSql(`set role ${role}; select 1 from gov_repo.${store} limit 1;`), /permission denied for table/, `${role} ${store}`);
      }
      await assert.rejects(bootstrapSql(`set role ${role}; select 1 from gov_repo.organisations limit 1;`), /permission denied for table/, role);
    }
    assert.equal(await bootstrapSql(`set role govia_ledger_executor; select count(*) > 0 from gov_repo.governance_ledger;`), 't');
    await assert.rejects(bootstrapSql(`set role govia_ledger_executor; update gov_repo.governance_ledger set entry_sequence = entry_sequence where entry_sequence = 1;`),
      /new row violates row-level security policy|permission denied/);
  });

  const orgA = await newOrg(owner, 'r1-fn-a');
  const orgB = await newOrg(owner, 'r1-fn-b');

  await t.test('record_execution_snapshot: service_role persists snapshot/fact/head, exact replay, stale head rejected, others denied', async () => {
    const kit = executionSnapshotKit(orgA, 'r1-snap');
    await owner(kit.sql);
    const call = (snapshot: unknown, previous: string | null) =>
      svc(`select gov_repo.record_execution_snapshot('${orgA}',${jsonLit(snapshot)},${previous === null ? 'null' : lit(previous)})`);
    await call(kit.snapshot, null);
    assert.equal(await owner(`select concat_ws('|', s.candidate_id, s.authorization_state, f.field_key, f.principal_kind, h.snapshot_id)
      from gov_repo.execution_source_snapshots s join gov_repo.execution_source_facts f using (organisation_id, snapshot_id)
      join gov_repo.execution_source_heads h on h.organisation_id = s.organisation_id and h.source_scope = s.source_scope where s.organisation_id = '${orgA}'`),
      `${kit.snapshot.agentVersionCandidateId}|UNKNOWN|PRINCIPAL|SERVICE_ACCOUNT|snapshot-r1-snap`);
    await call(kit.snapshot, 'anything');
    assert.equal(await owner(`select count(*) from gov_repo.execution_source_snapshots where organisation_id = '${orgA}'`), '1');
    await assert.rejects(call({ ...kit.snapshot, snapshotId: 'snapshot-r1-snap-2' }, null), /EXECUTION_STALE_SOURCE/);
    await call({ ...kit.snapshot, snapshotId: 'snapshot-r1-snap-2' }, 'snapshot-r1-snap');
    assert.equal(await owner(`select snapshot_id from gov_repo.execution_source_heads where organisation_id = '${orgA}'`), 'snapshot-r1-snap-2');
    await denied(`select gov_repo.record_execution_snapshot('${orgA}','{}'::jsonb,null)`);
  });

  await t.test('M15 runtime: admit_runtime_observation, read_runtime_observation_exact, record_cross_signal_comparison_result', async () => {
    await owner(`insert into gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code)
      values('${runtimeOrg}','m15-a','M15 A','M15 A','BR'),('${runtimeForeign}','m15-b','M15 B','M15 B','BR');`);
    await seedGovernedSupport(owner);
    await owner(`insert into gov_repo.execution_field_decisions
        (organisation_id,decision_id,canonical_object_id,snapshot_id,field_key,outcome,actor_reference,decided_at,content_digest)
        values('${runtimeOrg}','m15-principal-decision','m142-version','m13-snapshot','PRINCIPAL','ACCEPT_PROPOSED','fixture-admin',now(),'fixture');
      insert into gov_repo.execution_field_states(organisation_id,state_id,canonical_object_id,field_key,snapshot_id,decision_id,recorded_at)
        values('${runtimeOrg}','m15-principal-state','m142-version','PRINCIPAL','m13-snapshot','m15-principal-decision',now());
      insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
        subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash)
        values('m15-model-decision','${runtimeOrg}','OBJECT','CREATE_NEW','MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),'candidate:m15-model-2','m15-model-2','MODEL','1.0','{}',repeat('a',64));
      insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values('m15-model-2','${runtimeOrg}','MODEL','m15-model-decision');`);
    const observation = fixture('MODEL_CALL');
    const subject = { organisationId: observation.organisationId, objectId: asCanonicalObjectId('m142-version'), kind: 'AGENT_VERSION' as const };
    const principal = { kind: 'WORKLOAD_IDENTITY' as const, providerCode: 'provider', authorityReference: 'realm', principalReference: 'workload' };
    const states = ['m142-model', 'm15-model-2'].map((target, i) => ({
      relationshipId: asRelationshipId(`m15-rel-${i}`), relationshipStateId: asRelationshipStateId(`m15-state-${i}`), decisionId: `m15-rel-decision-${i}`,
      source: subject, relationshipType: 'USES_MODEL' as const,
      target: { organisationId: subject.organisationId, objectId: asCanonicalObjectId(target), kind: 'MODEL' as const },
      validFrom: asIsoTimestamp('2026-09-01T00:00:00.000Z'),
    }));
    // Owner-only fixture rows; the runtime owner only ever READS canonical_relationships.
    for (const state of states) {
      await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
          relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
          values('${state.decisionId}','${runtimeOrg}','RELATIONSHIP','CREATE_NEW','USES_MODEL','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),'candidate:${state.relationshipId}','USES_MODEL','1.0','{}',repeat('a',64));
        insert into gov_repo.canonical_relationships(organisation_id,relationship_id,relationship_state_id,relationship_type,source_canonical_object_id,source_kind,
          target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
          values('${runtimeOrg}','${state.relationshipId}','${state.relationshipStateId}','USES_MODEL','m142-version','AGENT_VERSION','${state.target.objectId}','MODEL','${state.validFrom}',now(),'${state.decisionId}');`);
    }
    const relationshipsBefore = await owner(`select md5(jsonb_agg(to_jsonb(r) order by relationship_id)::text) from gov_repo.canonical_relationships r`);
    const connection = observation.sourceConnection.connectionId;
    await owner(`select gov_repo.register_runtime_source('${runtimeOrg}','${connection}','system','provider','producer','fixture-admin');
      select gov_repo.configure_runtime_source('${runtimeOrg}','${connection}',${composite(config(), 'runtime_source_configurations')});
      select gov_repo.activate_runtime_source('${runtimeOrg}','${connection}','1',true,'fixture-admin');
      select gov_repo.register_runtime_binding('${runtimeOrg}','${connection}',${composite(binding(), 'runtime_deployment_bindings')});`);
    const runtimeInput = { ...observation, binding: exact(), context: { ...observation.context,
      principal: runtimeKnown({ value: principal, support: { evidence: observation.provenance.evidence,
        method: { code: 'DIRECT_RUNTIME_MEASUREMENT' as const, version: '1.0.0' as const } } }) } };
    const admitted = JSON.parse(await svc(admission(runtimeToRow(runtimeInput))));
    assert.equal(admitted.replay, false);
    assert.equal(JSON.parse(await svc(admission(runtimeToRow(runtimeInput)))).replay, true);
    const runtime = validatePersistedRuntimeObservation(runtimeFromRow(admitted.observation));
    const read = await svc(`select observation from gov_repo.read_runtime_observation_exact('${runtimeOrg}',${literal(connection)},'${admitted.observation.observation_id}')`);
    assert.deepEqual(JSON.parse(read), admitted.observation);
    assert.equal(await svc(`select count(*) from gov_repo.read_runtime_observation_exact('${runtimeForeign}',${literal(connection)},'${admitted.observation.observation_id}')`), '0');
    const evaluatedAt = asIsoTimestamp('2026-09-23T12:00:00.000Z');
    const principalResult = comparePrincipalIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime, evaluatedAt,
      designTime: { canonicalObject: subject, field: 'PRINCIPAL', executionFieldStateId: 'm15-principal-state', decisionId: 'm15-principal-decision',
        snapshotId: 'm13-snapshot', principal } });
    const dependencyResult = compareDependencyTargetIdentityDesignTimeVsRuntime({ organisationId: subject.organisationId, subject, runtime, evaluatedAt, governedStates: states });
    const record = async (result: CrossSignalComparisonResult) => JSON.parse(await svc(`select row_to_json(reply) from gov_repo.record_cross_signal_comparison_result('${runtimeOrg}',
      ${literal(crossSignalComparisonIdentity(result))},${literal(JSON.stringify(result))}::jsonb) reply;`));
    assert.equal((await record(principalResult)).replay, false);
    assert.equal((await record(dependencyResult)).replay, false);
    assert.equal((await record(dependencyResult)).replay, true);
    assert.equal(await owner(`select (select count(*) from gov_repo.cross_signal_comparison_results)||':'||(select count(*) from gov_repo.cross_signal_comparison_left_relationship_states)`), '2:2');
    assert.equal(await owner(`select md5(jsonb_agg(to_jsonb(r) order by relationship_id)::text) from gov_repo.canonical_relationships r`), relationshipsBefore,
      'canonical_relationships is only read (F2)');
    await denied(`select * from gov_repo.read_runtime_observation_exact('${runtimeOrg}',${literal(connection)},'${admitted.observation.observation_id}')`);
    await denied(`select * from gov_repo.record_cross_signal_comparison_result('${runtimeOrg}','x','{}'::jsonb)`);
    await denied(admission(runtimeToRow(runtimeInput)));
  });

  const userA = await newUser(owner, orgA, 'Owner A');
  const userB = await newUser(owner, orgB, 'Owner B');
  const a1 = await newAgent(owner, orgA, userA, 'R1-A1', 'critical');
  const a2 = await newAgent(owner, orgA, userA, 'R1-A2', 'medium');
  const b1 = await newAgent(owner, orgB, userB, 'R1-B1', 'high');
  await owner(`insert into gov_repo.agent_edges(source_agent_id,target_agent_id,relationship_type,organisation_id,weight)
      values('${a1}','${a2}','CALLS_AGENT','${orgA}',0.8);
    insert into gov_repo.agent_embeddings(agent_id,embedding,content_text,content_hash,model_name,organisation_id,is_current)
      values('${a1}',${vectorLiteral},'agent a1',repeat('c',64),'text-embedding-3-small','${orgA}',true),
            ('${b1}',${vectorLiteral},'agent b1',repeat('d',64),'text-embedding-3-small','${orgB}',true);`);

  await t.test('legacy reads as service_role are tenant-scoped by the bound organisation; anon/authenticated denied', async () => {
    assert.equal(await svc(`select string_agg(agent_code, ',' order by agent_code) from gov_repo.agent_compliance_gaps('${orgA}')`), 'R1-A1,R1-A2');
    assert.equal(await svc(`select string_agg(agent_code, ',' order by agent_code) from gov_repo.agent_compliance_gaps('${orgB}')`), 'R1-B1');
    assert.equal(await svc(`select string_agg(agent_code || ':' || depth, ',') from gov_repo.agent_graph_traverse('${a1}', 5, null, true)`), 'R1-A2:1');
    assert.equal(await svc(`select string_agg(agent_code, ',') from gov_repo.agent_semantic_search(${vectorLiteral}::vector, '${orgA}', null, 10, 0.5)`), 'R1-A1');
    await denied(`select * from gov_repo.agent_compliance_gaps('${orgA}')`);
    await denied(`select * from gov_repo.agent_graph_traverse('${a1}', 5, null, true)`);
    await denied(`select * from gov_repo.agent_semantic_search(${vectorLiteral}::vector, '${orgA}', null, 10, 0.5)`);
  });

  await t.test('recompute_risk_propagation (graph owner -> exactly agent_graph_traverse): writes propagation rows', async () => {
    assert.equal(await svc(`select gov_repo.recompute_risk_propagation('${orgA}', null)`), '1');
    assert.equal(await owner(`select string_agg(concat_ws('|', risk_source_agent_id = '${a1}', affected_agent_id = '${a2}', propagation_type, impact_score, criticality, is_active), ',')
      from gov_repo.agent_risk_propagation where organisation_id = '${orgA}'`), 't|t|direct|0.8000|critical|t');
    assert.equal(await svc(`select gov_repo.recompute_risk_propagation('${orgA}', null)`), '1');
    assert.equal(await owner(`select count(*) from gov_repo.agent_risk_propagation`), '1');
    await denied(`select gov_repo.recompute_risk_propagation('${orgA}', null)`);
  });
});
