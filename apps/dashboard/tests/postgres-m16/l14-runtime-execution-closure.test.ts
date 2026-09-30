import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CrossSignalComparisonResult } from '@council/canonical-contracts';
import { runtimeExecutionClosureMigration } from '../helpers/disposable-m16-postgres';
import {
  APPROVED_SURFACE, executionSnapshotKit, fullChainCluster, newOrg, r1Postflight, r1PostflightAfterR2, r2Postflight, s1b2Postflight,
} from '../helpers/m16-definer-surface-fixtures';
import { jsonLit, lit } from '../helpers/m16-governed-write-fixtures';
import { m15RuntimeKit } from '../helpers/m16-runtime-kit';

/**
 * Types a caller can shadow with a same-named pg_temp domain. Their CHECK calls a caller-written probe that raises only
 * when it runs under a different current_user than the session user, i.e. inside a SECURITY DEFINER routine; in the
 * caller's own statements (current_user = session_user) it is inert, so every legitimate call still type-checks.
 */
const SHADOWED = ['text', 'uuid', 'int4', 'int8', 'numeric', 'bool', 'jsonb', 'timestamptz', 'varchar', 'bytea'] as const;
const SHADOW = `create function pg_temp.r2_probe(v pg_catalog.anyelement) returns pg_catalog.bool language plpgsql as $probe$
  begin
    if current_user operator(pg_catalog.<>) session_user then
      raise exception 'R2_SHADOW_EXECUTED as % via %', current_user, pg_catalog.pg_typeof(v);
    end if;
    return true;
  end $probe$;
${SHADOWED.map(type => `create domain pg_temp.${type} as pg_catalog.${type} check (pg_temp.r2_probe(value));`).join('\n')}
`;
const LEAK = /R2_SHADOW_EXECUTED as govia_runtime_executor/;

/**
 * M16-S1B.2R2 runtime execution closure (disposable PG17, full primary chain). BEFORE: on the R1 catalog a caller's
 * pg_temp type shadow executes inside all four runtime routines as govia_runtime_executor (the reviewer's exact case
 * persists a forged cross-tenant M15 row), and pinning only the routine to `pg_catalog, pg_temp` still leaks through
 * the helper's own search_path. AFTER R2: the same scenarios behave exactly per the routine contracts.
 */
test('M16 S1B.2R2 runtime routine execution closure (disposable PG17, full primary chain + R1 -> R2)', { timeout: 900_000 }, async t => {
  const pg = await fullChainCluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const { owner, svc, bootstrapSql, inventory } = pg;
  const shadowed = (query: string) => svc(SHADOW + query);

  // Reviewer case support: two tenants, one AGENT_VERSION canonical object each.
  const orgA = await newOrg(owner, 'r2-a');
  const orgB = await newOrg(owner, 'r2-b');
  await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,reason_code,decided_at,
      subject_candidate_id,canonical_object_id,canonical_object_kind,contract_version,envelope,envelope_hash) values
      ('dec-av-A','${orgA}','OBJECT','CREATE_NEW','AGENT_VERSION','HUMAN','fx','MANUAL_APPROVAL',now(),'candidate:av-A','av-A','AGENT_VERSION','1.0','{}',repeat('a',64)),
      ('dec-av-B','${orgB}','OBJECT','CREATE_NEW','AGENT_VERSION','HUMAN','fx','MANUAL_APPROVAL',now(),'candidate:av-B','av-B','AGENT_VERSION','1.0','{}',repeat('a',64));
    insert into gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id) values ('av-A','${orgA}','AGENT_VERSION','dec-av-A'),('av-B','${orgB}','AGENT_VERSION','dec-av-B');`);
  const baseline = (reason: string, org = orgA, objectId = 'av-A') => ({
    organisationId: org, subject: { organisationId: org, objectId, kind: 'AGENT_VERSION' }, pairingMode: 'DESIGN_TIME_VS_RUNTIME',
    dimension: 'PRINCIPAL_IDENTITY', method: { code: 'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1', version: '1.0.0' },
    leftTemporalBasis: { basis: 'NOT_AVAILABLE' }, rightTemporalBasis: { basis: 'RUNTIME_EVENT_TIME' }, outcome: 'INSUFFICIENT_EVIDENCE', reason,
    evaluatedAt: '2026-09-30T12:00:00.000Z' });
  const recordBaseline = (result: object, org = orgA) =>
    `select replay::pg_catalog.text from gov_repo.record_cross_signal_comparison_result('${org}'::pg_catalog.uuid, null, ${jsonLit(result)}::pg_catalog.jsonb);`;
  // The reviewer's exact probe: a one-shot shadowed-text CHECK that INSERTs a forged org-B row as the routine owner.
  const forge = (marker: string) => `create function pg_temp.evil(v pg_catalog.text) returns pg_catalog.bool language plpgsql set search_path = pg_catalog, pg_temp as $e$
    begin
      if pg_catalog.current_setting('r2.done', true) = '1' then return true; end if;
      perform pg_catalog.set_config('r2.done', '1', false);
      insert into gov_repo.cross_signal_comparison_results(organisation_id,comparison_id,subject_object_id,dimension,pairing_mode,method_code,method_version,
          left_temporal_basis,right_temporal_basis,outcome,reason,evaluated_at)
        values('${orgB}','cross-signal-comparison:${marker}','av-B','PRINCIPAL_IDENTITY','DESIGN_TIME_VS_RUNTIME','CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1','9.9.9',
          'NOT_AVAILABLE','RUNTIME_EVENT_TIME','INSUFFICIENT_EVIDENCE','CLOCK_UNCERTAIN',pg_catalog.now());
      return true;
    end $e$;
    create domain pg_temp.text as pg_catalog.text check (pg_temp.evil(value));`;
  const forged = (marker: string) => owner(`select count(*) from gov_repo.cross_signal_comparison_results where comparison_id = 'cross-signal-comparison:${marker}'`);

  // M13 snapshot + M15 runtime support (owner-only fixture rows).
  const kit = executionSnapshotKit(orgA, 'r2-snap');
  await owner(kit.sql);
  const snapshot = (value: unknown, previous: string | null) =>
    `select gov_repo.record_execution_snapshot('${orgA}',${jsonLit(value)},${previous === null ? 'null' : lit(previous)});`;
  const m15 = await m15RuntimeKit(owner);
  const admitted = JSON.parse(await svc(m15.admissionSql));
  assert.equal(admitted.replay, false);
  const observationId: string = admitted.observation.observation_id;
  const { principal: principalResult, dependency: dependencyResult } = m15.results(admitted.observation);
  const relationships = () => owner(`select md5(jsonb_agg(to_jsonb(r) order by relationship_id)::text) from gov_repo.canonical_relationships r`);
  const relationshipsBefore = await relationships();
  // Cross-tenant submissions: an org-B result under org A, and an org-A result naming org B's subject.
  const foreignResult = recordBaseline(baseline('CLOCK_UNCERTAIN', orgB, 'av-B'));
  const foreignSubject = recordBaseline({ ...baseline('CLOCK_UNCERTAIN'), subject: { organisationId: orgB, objectId: 'av-B', kind: 'AGENT_VERSION' } });
  const errorOf = (call: Promise<unknown>) => call.then(() => 'NO ERROR', e => (String(e).match(/ERROR: +(\S+: \S+)/) ?? ['', String(e)])[1]);
  const tenantBefore = [await errorOf(svc(foreignResult)), await errorOf(svc(foreignSubject))];
  assert.deepEqual(tenantBefore, ['P0001: CROSS_SIGNAL_RESULT_TENANT_MISMATCH', 'P0001: CROSS_SIGNAL_RESULT_SUBJECT_INVALID']);
  const rows = () => owner(`select concat_ws(':', (select count(*) from gov_repo.execution_source_snapshots), (select count(*) from gov_repo.execution_source_facts),
    (select count(*) from gov_repo.runtime_observations), (select count(*) from gov_repo.cross_signal_comparison_results),
    (select count(*) from gov_repo.cross_signal_comparison_left_relationship_states))`);

  await t.test('BEFORE (R1 catalog): a caller pg_temp type shadow executes inside all four runtime routines as govia_runtime_executor', async () => {
    const before = await rows();
    await assert.rejects(shadowed(snapshot(kit.snapshot, null)), LEAK, 'record_execution_snapshot');
    await assert.rejects(shadowed(m15.admissionSql), LEAK, 'admit_runtime_observation');
    await assert.rejects(shadowed(m15.readSql(m15.runtimeOrg, observationId)), LEAK, 'read_runtime_observation_exact');
    await assert.rejects(shadowed(m15.recordSql(principalResult as CrossSignalComparisonResult)), LEAK, 'record_cross_signal_comparison_result');
    assert.equal(await rows(), before, 'the probe aborted every call');
  });

  await t.test('BEFORE: reviewer exact case — a legitimate org-A call carrying the shadow persists a forged org-B row', async () => {
    await assert.rejects(svc(`insert into gov_repo.cross_signal_comparison_results(organisation_id,comparison_id,subject_object_id,dimension,pairing_mode,method_code,
        method_version,left_temporal_basis,right_temporal_basis,outcome,reason,evaluated_at) values('${orgB}','x','av-B','PRINCIPAL_IDENTITY','DESIGN_TIME_VS_RUNTIME',
        'CROSS_SIGNAL_PRINCIPAL_DESIGN_RUNTIME_V1','1','NOT_AVAILABLE','RUNTIME_EVENT_TIME','INSUFFICIENT_EVIDENCE','CLOCK_UNCERTAIN',now())`),
      /permission denied for table cross_signal_comparison_results/, 'service_role cannot write the store directly');
    assert.equal(await svc(forge('FORGED-BEFORE') + recordBaseline(baseline('DESIGN_TIME_BASELINE_MISSING'))), 'false');
    assert.equal(await forged('FORGED-BEFORE'), '1');
    assert.equal(await owner(`select organisation_id || '/v' || method_version from gov_repo.cross_signal_comparison_results where comparison_id = 'cross-signal-comparison:FORGED-BEFORE'`),
      `${orgB}/v9.9.9`);
  });

  await t.test('BEFORE: pinning only the routine to pg_catalog, pg_temp still leaks through the helper search_path (frame_identity)', async () => {
    const sig = 'gov_repo.record_cross_signal_comparison_result(uuid,text,jsonb)';
    await bootstrapSql(`alter function ${sig} set search_path = pg_catalog, pg_temp`);
    try {
      const error = await shadowed(recordBaseline(baseline('CLOCK_UNCERTAIN'))).then(() => '', e => String(e));
      assert.match(error, LEAK);
      assert.match(error, /SQL function "frame_identity"/);
    } finally {
      await bootstrapSql(`alter function ${sig} set search_path = pg_catalog`);
    }
  });

  await t.test('R2 applies on the R1 catalog; R2, R1 (successor config) and S1B.2 postflights re-execute; surface is exactly 22', async () => {
    await pg.migrate(runtimeExecutionClosureMigration);
    await owner(r2Postflight());
    await owner(r2Postflight());
    await owner(r1PostflightAfterR2());
    await owner(s1b2Postflight());
    // The historical R1 postflight differs ONLY by the audited runtime config it froze.
    await assert.rejects(owner(r1Postflight()), /M16_S1B2R1_POSTFLIGHT: gov_repo\.record_execution_snapshot\(uuid,jsonb,text\) config changed: \{"search_path=pg_catalog, pg_temp"\}/);
    const app = (await inventory()).filter(row => row.app);
    assert.deepEqual(app.map(row => [row.name, row.owner]).sort(), [...APPROVED_SURFACE].map(entry => [...entry]).sort());
    assert.equal(app.length, 22);
    assert.equal(app.filter(row => row.owner === 'govia_runtime_executor').length, 4);
    assert.ok(app.filter(row => row.owner === 'govia_runtime_executor').every(row => row.config === 'search_path=pg_catalog, pg_temp'));
  });

  await t.test('R2 postflight negative controls (rolled back)', async () => {
    const inTxn = (setup: string) => bootstrapSql(`begin;\n${setup}\n${r2Postflight()}\nrollback;`);
    await inTxn('');
    await assert.rejects(inTxn(`alter function gov_repo.frame_identity(text[]) set search_path = pg_catalog;`),
      /M16_S1B2R2_POSTFLIGHT: gov_repo\.frame_identity\(text\[\]\) config is not its pinned path with pg_temp last/);
    await assert.rejects(inTxn(`alter function gov_repo.admit_runtime_observation(uuid,text,gov_repo.runtime_observations) reset search_path;`),
      /M16_S1B2R2_POSTFLIGHT: gov_repo\.admit_runtime_observation\(uuid,text,gov_repo\.runtime_observations\) config is not/);
    await assert.rejects(inTxn(`create function gov_repo.r2_unpinned_trigger() returns trigger language plpgsql set search_path = pg_catalog as 'begin return new; end';
        create trigger r2_unpinned before insert on gov_repo.runtime_observations for each row execute function gov_repo.r2_unpinned_trigger();`),
      /M16_S1B2R2_POSTFLIGHT: runtime-reachable routine gov_repo\.r2_unpinned_trigger\(\) does not pin pg_temp last/);
    await assert.rejects(inTxn(`create function gov_repo.r2_unpinned_check(text) returns boolean language sql immutable set search_path = pg_catalog as 'select true';
        alter table gov_repo.execution_source_facts add constraint r2_unpinned check (gov_repo.r2_unpinned_check(field_key)) not valid;`),
      /M16_S1B2R2_POSTFLIGHT: runtime-reachable routine gov_repo\.r2_unpinned_check\(text\) does not pin pg_temp last/);
    await assert.rejects(inTxn(`grant execute on function gov_repo.read_runtime_observation_exact(uuid,gov_repo.runtime_reference,uuid) to authenticated;`),
      /M16_S1B2R2_POSTFLIGHT: runtime routine EXECUTE is not exactly service_role/);
    await assert.rejects(inTxn(`grant govia_runtime_executor to service_role;`), /M16_S1B2R2_POSTFLIGHT: govia_runtime_executor membership/);
  });

  await t.test('AFTER: the shadow never executes; record_execution_snapshot persists, replays and rejects a stale head per contract', async () => {
    assert.equal(await owner(`select count(*) from gov_repo.execution_source_snapshots where organisation_id = '${orgA}'`), '0');
    await shadowed(snapshot(kit.snapshot, null));
    assert.equal(await owner(`select concat_ws('|', s.candidate_id, s.authorization_state, f.field_key, f.principal_kind, h.snapshot_id)
      from gov_repo.execution_source_snapshots s join gov_repo.execution_source_facts f using (organisation_id, snapshot_id)
      join gov_repo.execution_source_heads h on h.organisation_id = s.organisation_id and h.source_scope = s.source_scope where s.organisation_id = '${orgA}'`),
      `${kit.snapshot.agentVersionCandidateId}|UNKNOWN|PRINCIPAL|SERVICE_ACCOUNT|snapshot-r2-snap`);
    await shadowed(snapshot(kit.snapshot, 'anything'));
    assert.equal(await owner(`select count(*) from gov_repo.execution_source_snapshots where organisation_id = '${orgA}'`), '1', 'exact replay');
    const next = { ...kit.snapshot, snapshotId: 'snapshot-r2-snap-2' };
    const stale = await shadowed(snapshot(next, null)).then(() => '', e => String(e));
    assert.match(stale, /EXECUTION_STALE_SOURCE/);
    assert.doesNotMatch(stale, /R2_SHADOW_EXECUTED/);
    await shadowed(snapshot(next, 'snapshot-r2-snap'));
    assert.equal(await owner(`select snapshot_id from gov_repo.execution_source_heads where organisation_id = '${orgA}'`), 'snapshot-r2-snap-2');
  });

  await t.test('AFTER: admit_runtime_observation replays and read_runtime_observation_exact stays tenant-exact under the shadow', async () => {
    const replay = JSON.parse(await shadowed(m15.admissionSql));
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.observation, admitted.observation);
    assert.deepEqual(JSON.parse(await shadowed(m15.readSql(m15.runtimeOrg, observationId))), admitted.observation);
    assert.equal(await shadowed(`select count(*) from (${m15.readSql(m15.runtimeForeign, observationId)}) x;`), '0');
    assert.equal(await owner(`select count(*) from gov_repo.runtime_observations`), '1');
  });

  await t.test('AFTER: record_cross_signal_comparison_result records, replays and keeps cross-tenant validation under the shadow', async () => {
    const record = async (result: CrossSignalComparisonResult) => JSON.parse(await shadowed(m15.recordSql(result)));
    const first = await record(principalResult);
    assert.equal(first.replay, false);
    assert.equal((await record(dependencyResult)).replay, false);
    const again = await record(dependencyResult);
    assert.equal(again.replay, true);
    assert.equal(await owner(`select count(*) from gov_repo.cross_signal_comparison_results where organisation_id = '${m15.runtimeOrg}'`), '2');
    assert.equal(await owner(`select count(*) from gov_repo.cross_signal_comparison_left_relationship_states where organisation_id = '${m15.runtimeOrg}'`), '2');
    // Cross-tenant validation: exactly the errors the R1 catalog returned (captured before the shadow tests).
    assert.deepEqual([await errorOf(shadowed(foreignResult)), await errorOf(shadowed(foreignSubject))], tenantBefore);
  });

  await t.test('AFTER: reviewer exact case — the same call behaves per contract and forges nothing', async () => {
    // The identical org-A result was recorded by the BEFORE call: exact replay; a changed reason is a replay conflict.
    assert.equal(await svc(forge('FORGED-AFTER') + recordBaseline(baseline('DESIGN_TIME_BASELINE_MISSING'))), 'true');
    assert.equal(await errorOf(svc(forge('FORGED-AFTER-CONFLICT') + recordBaseline(baseline('CLOCK_UNCERTAIN')))), 'P0001: CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT');
    assert.equal(await forged('FORGED-AFTER'), '0');
    assert.equal(await forged('FORGED-AFTER-CONFLICT'), '0');
    assert.equal(await owner(`select count(*) from gov_repo.cross_signal_comparison_results where organisation_id = '${orgB}'`), '1', 'only the pre-R2 forged row');
  });

  await t.test('AFTER: canonical_relationships unchanged (read-only runtime path, F2 not triggered); postflights still clean', async () => {
    assert.equal(await relationships(), relationshipsBefore);
    await owner(r2Postflight());
    await owner(r1PostflightAfterR2());
  });
});
