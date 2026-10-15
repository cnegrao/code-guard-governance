import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17S5RiskTreatmentMigration } from '../helpers/disposable-m16-postgres';
import { m17s4Kit } from '../helpers/m17-s4-fixtures';
import { m17s5Kit, RT_TABLES } from '../helpers/m17-s5-fixtures';
import { l15SecurityViolationsSql } from '../helpers/m17-l15-security-profile';
import { L15_S1_DEFINER_INVENTORY, L15_S2_DEFINER_INVENTORY, L15_S2R1_DEFINER_INVENTORY,
  L15_S3_DEFINER_INVENTORY, L15_S4_DEFINER_INVENTORY, L15_S5_DEFINER_INVENTORY } from '../helpers/m17-l15-definer-inventory';
const INVENTORY = [...L15_S1_DEFINER_INVENTORY,...L15_S2_DEFINER_INVENTORY,...L15_S2R1_DEFINER_INVENTORY,
  ...L15_S3_DEFINER_INVENTORY,...L15_S4_DEFINER_INVENTORY,...L15_S5_DEFINER_INVENTORY];
const RPCS = INVENTORY.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s));

test('S5 security, immutable stores, preserved S4 history and Authority Policy root (PG17)', { timeout: 600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon: 'M17S4' });
  t.after(() => c.stop());
  const k4 = await m17s4Kit(c), x4 = await k4.setup(), r4 = await k4.risk(x4, 'legacy-risk'), m4 = await k4.methodology(x4, 'legacy-method');
  const p4 = k4.rated(r4.stateId, m4, 'L1', 'I1', await k4.instant('20 days'));
  const a4 = await k4.assess(x4, 'legacy-assess', p4, { decideSupport: { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x4.evidence }] } });
  // Freeze the pre-S5 column projection: adding nullable owner columns changes
  // composite-row serialization even though every historical value is unchanged.
  const supportColumns = (await c.owner("select string_agg(format('t.%I',attname),',' order by attnum) from pg_attribute where attrelid='gov_repo.l15_support_links'::regclass and attnum>0 and not attisdropped")).trim();
  const historyQuery = `select md5(coalesce(string_agg(x,'|' order by x),'')) from (
    select 's:'||t::text x from gov_repo.l15_risk_assessment_states t where organisation_id='${x4.org}'
    union all select 'p:'||t::text from gov_repo.l15_risk_assessment_proposals t where organisation_id='${x4.org}'
    union all select 'l:'||row(${supportColumns})::text from gov_repo.l15_support_links t
      where organisation_id='${x4.org}' and owner_kind='RISK_ASSESSMENT') h`;
  const history = await c.owner(historyQuery);
  const rootQuery = `select p::text from pg_proc p where p.oid='gov_repo.l15_authorization_allow_guard_v1()'::regprocedure`;
  const root = await c.owner(rootQuery);
  await c.migrate(m17S5RiskTreatmentMigration);
  await t.test('S4 persisted rows and Authority Policy root remain byte-identical', async () => {
    assert.equal(await c.owner(historyQuery), history);
    assert.equal((await c.owner(`select count(*) from gov_repo.l15_support_links where owner_kind='RISK_ASSESSMENT'
      and (owner_risk_treatment_artifact is not null or owner_risk_treatment_proposal_id is not null or owner_risk_treatment_state_id is not null)`)).trim(), '0');
    assert.equal(await c.owner(rootQuery), root);
    assert.equal((await k4.read(x4.member, r4.stateId)).state_id, a4.stateId);
    const revoked = await k4.revokeAssessment(x4, 'legacy-revoke', r4.stateId, m4, a4.stateId);
    assert.equal(revoked.decided.outcome, 'REVOKED', 'pre-existing writer still works on widened shared surfaces');
  });
  const k = await m17s5Kit(c), x = await k.setup(), risk = await k.risk(x, 'security-risk');
  const ctrl = await k.control(x, 'security-control'), p = k.proposal(x, risk.stateId, { controlDefinitionVersionIds: [ctrl.versionId] });
  const result = await k.treat(x, 'security-treatment', p, k.evidence(x));
  await t.test('full L15 ACL, definer body/config inventory and immutability profile', async () => {
    assert.deepEqual(await k.json(l15SecurityViolationsSql(INVENTORY, RPCS)), []);
    assert.equal(await k.one("select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15%risk_treatment%v1' and has_function_privilege('service_role',oid,'EXECUTE')"), '3');
    assert.equal(await k.one("select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and has_function_privilege('govia_l15_machine_intake_caller',oid,'EXECUTE')"), '2');
  });
  for (const role of ['anon','authenticated','service_role'] as const) await t.test(`${role} has no direct store or helper access`, async () => {
    for (const table of RT_TABLES) await assert.rejects(c.sql(`select * from gov_repo.${table}`, role), /permission denied/);
    await assert.rejects(c.sql(`select gov_repo.l15_risk_treatment_state_current_v1('${x.org}','${result.stateId}',now(),now())`, role), /permission denied/);
  });
  for (const table of RT_TABLES.filter(t => !t.endsWith('heads'))) await t.test(`${table}: owner cannot update/delete/truncate historical rows`, async () => {
    for (const query of [`update gov_repo.${table} set organisation_id=organisation_id`, `delete from gov_repo.${table}`, `truncate gov_repo.${table} cascade`]) {
      await assert.rejects(c.owner(`begin; ${query}; rollback;`), /HISTORY_IMMUTABLE/);
    }
  });
  await t.test('late pin and support insertion cannot enrich historical treatment', async () => {
    const pin = `select organisation_id,state_id,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id from gov_repo.l15_risk_treatment_state_control_pins where state_id='${result.stateId}'`;
    await assert.rejects(c.owner(`begin; insert into gov_repo.l15_risk_treatment_state_control_pins(organisation_id,state_id,control_definition_id,control_definition_version_id,content_hash,control_validated_state_id) ${pin}; rollback;`), /PIN_OWNER_NOT_IN_TRANSACTION/);
    await assert.rejects(c.owner(`begin; select gov_repo.l15_write_risk_treatment_support_links_v1('${x.org}','STATE',null,null,'${result.stateId}',array['DISCOVERY_EVIDENCE'],array['${x.evidence}']); rollback;`), /SUPPORT_OWNER_NOT_IN_TRANSACTION/);
  });
  await t.test('stale credential, wrong tenant and expired session reject submit, decide and read', async () => {
    const bad = { epoch: "(clock_timestamp()-interval '30 days')" };
    const fresh = { ...p, treatmentOrdinalKey: 'credential' }, s = await k.submit(x, 'credential-proposal', fresh);
    for (const session of [bad, { org: '00000000-0000-0000-0000-000000000000' }, { exp: '(floor(extract(epoch from clock_timestamp()))::bigint-20)' }]) {
      for (const query of [k.submitSql(x.member, { commandId: x.cmd('bad-submit'), proposal: fresh, session }),
        k.decideSql(x.treatment, { commandId: x.cmd('bad-decide'), proposalId: s.proposal_id, proposal: fresh, session }), k.readSql(x.member, p, null, null, session)]) {
        await assert.rejects(c.svc(query), /GV00[123]/);
      }
    }
  });
  await t.test('temporary type shadow cannot change definer execution context', async () => {
    const session = c.session('service_role');
    try {
      const shadow = await session.run("create domain pg_temp.text as pg_catalog.text; create domain pg_temp.uuid as pg_catalog.uuid; create domain pg_temp.jsonb as pg_catalog.jsonb;");
      assert.equal(shadow.err, '', shadow.err);
      const read = await session.run(k.readSql(x.member, p));
      assert.equal(read.err, '', read.err);
      assert.equal(JSON.parse(read.out.trim().split('\n').pop()!).treatment_status, 'PLANNED');
    } finally { await session.close(); }
  });
});
