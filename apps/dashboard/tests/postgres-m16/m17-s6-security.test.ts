import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync,writeFileSync } from 'node:fs';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { m17S6ResidualRiskAcceptanceMigration } from '../helpers/disposable-m16-postgres';
import { m17s6Kit } from '../helpers/m17-s6-fixtures';
import { l15SecurityViolationsSql, type DefinerInventoryEntry } from '../helpers/m17-l15-security-profile';
import { L15_S1_DEFINER_INVENTORY,L15_S2_DEFINER_INVENTORY,L15_S2R1_DEFINER_INVENTORY,
  L15_S3_DEFINER_INVENTORY,L15_S4_DEFINER_INVENTORY,L15_S5_DEFINER_INVENTORY,L15_S6_PHASE_A_DEFINER_DELTA,L15_S6_PHASE_B_DEFINER_DELTA } from '../helpers/m17-l15-definer-inventory';
const previous = [...L15_S1_DEFINER_INVENTORY,...L15_S2_DEFINER_INVENTORY,...L15_S2R1_DEFINER_INVENTORY,
  ...L15_S3_DEFINER_INVENTORY,...L15_S4_DEFINER_INVENTORY,...L15_S5_DEFINER_INVENTORY];
const newNames = ['l15_submit_risk_assessment_proposal_v2','l15_read_risk_assessment_v2','l15_residual_commit_guard_v1',
  'l15_submit_risk_acceptance_proposal_v1','l15_decide_risk_acceptance_proposal_v1','l15_read_risk_acceptance_v1','l15_risk_acceptance_commit_guard_v1'];
const pins = ['proposal_treatment','state_treatment','proposal_control_assessment','state_control_assessment'].map(s => `l15_risk_assessment_${s}_pins`);
test('S6 actual catalog security, preserved INHERENT v1 rows and M16 authority surface', { timeout:600_000 },async t => {
  const c = await l14Cluster(m => t.diagnostic(m),{ horizon:'M17S5' }); t.after(() => c.stop());
  const k = await m17s6Kit(c), x = await k.setup(), risk = await k.risk(x,'risk'), m = await k.methodology(x,'method');
  const until = await k.instant('20 days'), p = k.k4.rated(risk.stateId,m,'L1','I1',until), a = await k.k4.assess(x,'inherent',p);
  const cols = (await c.owner("select string_agg(format('t.%I',attname),',' order by attnum) from pg_attribute where attrelid='gov_repo.l15_risk_assessment_states'::regclass and attnum>0 and not attisdropped")).trim();
  const history = `select row(${cols})::text from gov_repo.l15_risk_assessment_states t where state_id='${a.stateId}'`;
  const old = await c.owner(history), oldRead = await k.k4.read(x.member,risk.stateId);
  const m16 = "select md5(string_agg(p::text,'|' order by oid)) from pg_proc p where pronamespace='gov_repo'::regnamespace and proname like 'l14_%'";
  const before = await c.owner(m16);
  await c.migrate(m17S6ResidualRiskAcceptanceMigration);
  await t.test('S4 historical columns, v1 read, v1 replay and all L14 routine bodies/ACLs are preserved',async () => {
    assert.equal(await c.owner(history),old); assert.equal(await c.owner(m16),before);
    const read = await k.k4.read(x.member,risk.stateId);
    assert.equal(read.state_id,oldRead.state_id); assert.equal(read.rating_band,oldRead.rating_band);
    assert.equal((await k.k4.submit(x,'inherent',p)).replay,true);
    assert.equal((await k.k4.decide(x,'inherent',a.submitted,p)).replay,true);
  });
  const inventory = await k.json(`select jsonb_agg(to_jsonb(q) order by sig) from (select oid::regprocedure::text sig,pg_get_userbyid(proowner) owner,
    encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,coalesce(array_to_string(proconfig,';'),'-') cfg
    from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and prosecdef) q`) as DefinerInventoryEntry[];
  const delta = inventory.filter(e => newNames.some(n => e.sig.startsWith(`gov_repo.${n}(`)) || e.sig.startsWith('gov_repo.l15_decide_risk_assessment_proposal_v1('));
  const approved = [...previous.map(e => e.sig).filter(s => /l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(s)),
    ...delta.filter(e => /l15_(submit_|read_|decide_)/.test(e.sig)).map(e => e.sig)];
  await t.test('actual definer delta and inherited/default ACL closure',async () => {
    assert.deepEqual(delta,[...L15_S6_PHASE_A_DEFINER_DELTA,...L15_S6_PHASE_B_DEFINER_DELTA].sort((a,b)=>a.sig.localeCompare(b.sig)));
    assert.deepEqual(inventory.filter(e => !delta.includes(e)).sort((a,b) => a.sig.localeCompare(b.sig)),
      previous.filter(e => !e.sig.startsWith('gov_repo.l15_decide_risk_assessment_proposal_v1(')).sort((a,b) => a.sig.localeCompare(b.sig)));
    assert.deepEqual(await k.json(l15SecurityViolationsSql([...previous.filter(e => !e.sig.startsWith('gov_repo.l15_decide_risk_assessment_proposal_v1(')),...delta],approved)),[]);
    const counts = await k.json(`select json_build_object('l15_definers',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and prosecdef),
      'l15_service_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and has_function_privilege('service_role',oid,'EXECUTE')),
      'all_service_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and has_function_privilege('service_role',oid,'EXECUTE')),
      'all_definers',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and prosecdef),
      'service_definers',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and prosecdef and has_function_privilege('service_role',oid,'EXECUTE')),
      'machine_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and has_function_privilege('govia_l15_machine_intake_caller',oid,'EXECUTE')),
      'l15_tables',(select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15_%' and relkind='r'))`);
    const dir = new URL('../../../../out/m17-s6/',import.meta.url); mkdirSync(dir,{ recursive:true });
    writeFileSync(new URL('catalog.json',dir),JSON.stringify({ counts,delta,inventory },null,2)+'\n');
    t.diagnostic(`Actual post-S6 catalog: ${JSON.stringify(counts)}`);
  });
  const residual = await k.assess(x,'residual',k.proposal(risk.stateId,m,a.stateId,until));
  for (const role of ['anon','authenticated','service_role'] as const) await t.test(`${role}: no direct L15/M16 pin stores or helpers`,async () => {
    for (const table of [...pins,'l15_risk_assessment_states','l14_control_assessment_states','l14_control_applicability_states'])
      await assert.rejects(c.sql(`select * from gov_repo.${table}`,role),/permission denied/);
    await assert.rejects(c.sql(`select gov_repo.l15_residual_dependency_failure_v1('${x.org}','${residual.stateId}',now(),now())`,role),/permission denied/);
  });
  await t.test('session epoch/expiry/tenant failures reject residual submit, decide and read',async () => {
    for (const session of [{ epoch:"(clock_timestamp()-interval '30 days')" },{ org:'00000000-0000-0000-0000-000000000000' },{ exp:'1' }])
      for (const sql of [k.submitSql(x.member,{ commandId:x.cmd('bad'),proposal:residual.proposal,session }),
        k.decideSql(x.assessor,{ commandId:x.cmd('bad'),proposalId:residual.submitted.proposal_id,proposal:residual.proposal,session }),
        k.readSql(x.member,risk.stateId,null,null,session)]) await assert.rejects(c.svc(sql),/GV00[123]/);
  });
});
