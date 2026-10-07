import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CrossSignalComparisonResult } from '@council/canonical-contracts';
import {
  EXECUTORS, executionSnapshotKit, fullChainCluster, newAgent, newOrg, newUser, vectorLiteral,
} from '../helpers/m16-definer-surface-fixtures';
import { jsonLit, lit } from '../helpers/m16-governed-write-fixtures';
import { m15RuntimeKit } from '../helpers/m16-runtime-kit';

/**
 * M16-S1B.2R1 functional regression: every re-owned routine still performs its real product behaviour as
 * service_role under its least-privilege technical owner, application roles other than service_role are
 * denied, and no technical owner can reach a policy-store row. Executed on the R1 catalog and again with the
 * S1B.2R2 runtime execution closure applied (identical expectations: R2 changes only search_path configuration).
 */
for (const r2 of [false, true]) test(`M16 S1B.2R1 re-owned routine regression (disposable PG17, full primary chain + R1${r2 ? ' + R2' : ''})`, { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message), { r2 });
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
    // Owner-only fixture rows; the runtime owner only ever READS canonical_relationships.
    const m15 = await m15RuntimeKit(owner);
    const { runtimeOrg, runtimeForeign } = m15;
    const relationshipsBefore = await owner(`select md5(jsonb_agg(to_jsonb(r) order by relationship_id)::text) from gov_repo.canonical_relationships r`);
    const admitted = JSON.parse(await svc(m15.admissionSql));
    assert.equal(admitted.replay, false);
    assert.equal(JSON.parse(await svc(m15.admissionSql)).replay, true);
    const read = await svc(m15.readSql(runtimeOrg, admitted.observation.observation_id));
    assert.deepEqual(JSON.parse(read), admitted.observation);
    assert.equal(await svc(`select count(*) from (${m15.readSql(runtimeForeign, admitted.observation.observation_id)}) x`), '0');
    const { principal: principalResult, dependency: dependencyResult } = m15.results(admitted.observation);
    const record = async (result: CrossSignalComparisonResult) => JSON.parse(await svc(m15.recordSql(result)));
    assert.equal((await record(principalResult)).replay, false);
    assert.equal((await record(dependencyResult)).replay, false);
    assert.equal((await record(dependencyResult)).replay, true);
    assert.equal(await owner(`select (select count(*) from gov_repo.cross_signal_comparison_results)||':'||(select count(*) from gov_repo.cross_signal_comparison_left_relationship_states)`), '2:2');
    assert.equal(await owner(`select md5(jsonb_agg(to_jsonb(r) order by relationship_id)::text) from gov_repo.canonical_relationships r`), relationshipsBefore,
      'canonical_relationships is only read (F2)');
    await denied(m15.readSql(runtimeOrg, admitted.observation.observation_id));
    await denied(`select * from gov_repo.record_cross_signal_comparison_result('${runtimeOrg}','x','{}'::jsonb)`);
    await denied(m15.admissionSql);
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
