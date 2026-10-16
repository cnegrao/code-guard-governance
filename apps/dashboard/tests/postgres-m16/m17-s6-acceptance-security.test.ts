import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {l14Cluster,lastLine} from '../helpers/m16-l14-fixtures';
import {acceptanceKit} from '../helpers/m17-s6-acceptance-fixtures';
import {residualRace} from '../helpers/m17-s6-concurrency';
import {l15SecurityViolationsSql,type DefinerInventoryEntry} from '../helpers/m17-l15-security-profile';

test('S6 acceptance security: measured catalog, isolation, session/authority waits and append-only support',{timeout:600_000},async t=>{
  const c=await l14Cluster(m=>t.diagnostic(m),{horizon:'M17S6'});t.after(()=>c.stop());
  const a=await acceptanceKit(c),x=await a.setup(),r=await a.residual(x,'security'),p=a.proposal(r.stateId,await a.k.instant('10 days'));
  const inventory=await a.k.json(`select jsonb_agg(to_jsonb(q) order by sig) from (select oid::regprocedure::text sig,pg_get_userbyid(proowner) owner,
    encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,coalesce(array_to_string(proconfig,';'),'-') cfg
    from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and prosecdef) q`) as DefinerInventoryEntry[];
  const counts=await a.k.json(`select json_build_object(
    'l15_definers',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and prosecdef),
    'l15_service_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and proname like 'l15_%' and has_function_privilege('service_role',oid,'EXECUTE')),
    'all_service_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and has_function_privilege('service_role',oid,'EXECUTE')),
    'machine_rpcs',(select count(*) from pg_proc where pronamespace='gov_repo'::regnamespace and has_function_privilege('govia_l15_machine_intake_caller',oid,'EXECUTE')),
    'l15_tables',(select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15_%' and relkind='r'),
    'l15_direct_privileges',(select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l15_%' and relkind='r' and has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')),
    'm16_direct_privileges',(select count(*) from pg_class where relnamespace='gov_repo'::regnamespace and relname like 'l14_%' and relkind='r' and has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))) `);
  const dir=new URL('../../../../out/m17-s6/',import.meta.url);mkdirSync(dir,{recursive:true});
  writeFileSync(new URL('acceptance-catalog.json',dir),JSON.stringify({counts,inventory},null,2)+'\n');
  t.diagnostic(`Actual final S6 catalog: ${JSON.stringify(counts)}`);
  await t.test('catalog: only intended application RPCs, no table/sequence/helper grants; machine surface unchanged',async()=>{
    const approved=inventory.filter(e=>/l15_(admit_human|read_|admit_scenario|admit_methodology|submit_|decide_)/.test(e.sig)).map(e=>e.sig);
    assert.deepEqual(await a.k.json(l15SecurityViolationsSql(inventory,approved)),[]);
    assert.equal(counts.machine_rpcs,2);assert.equal(counts.l15_direct_privileges,0);assert.equal(counts.m16_direct_privileges,0);
    const newRpcs=inventory.filter(e=>/l15_(submit|decide|read)_risk_acceptance/.test(e.sig));assert.equal(newRpcs.length,3);
  });
  const s=await a.submit(x,'pending',p);
  await t.test('all entrypoints reject invalid tenant, epoch and expired session; no direct table or helper access',async()=>{
    for(const session of [{org:'00000000-0000-0000-0000-000000000000'},{exp:'1'},{epoch:"(clock_timestamp()-interval '30 days')"}])
      for(const sql of [a.submitSql(x.member,{commandId:x.cmd('bad'),proposal:p,session}),a.decideSql(x.acceptor,{commandId:x.cmd('bad'),proposal:p,proposalId:s.proposal_id,session}),a.readSql(x.member,r.stateId,null,null,session)])
        await assert.rejects(c.svc(sql),/GV00[123]/);
    for(const role of ['anon','authenticated','service_role'] as const) {
      for(const table of ['proposals','states','heads']) await assert.rejects(c.sql(`select * from gov_repo.l15_risk_acceptance_${table}`,role),/permission denied/);
      await assert.rejects(c.sql(`select gov_repo.l15_risk_acceptance_resolution_v1('${x.org}','${r.stateId}',now(),now())`,role),/permission denied/);
    }
  });
  await t.test('role change while eligibility waits is observed before authority evaluation',async()=>{
    const actor=await c.mkUser(x.org,[a.roles.accept]);
    const out=await residualRace(c)(`update gov_repo.governance_users set role_ids='{}'::uuid[] where user_id='${actor.id}';`,
      a.decideSql(actor,{commandId:x.cmd('roles-wait'),proposalId:s.proposal_id,proposal:p}),'postgres');
    assert.equal(out.second.err,'');assert.equal(JSON.parse(lastLine(out.second.out)).outcome,'DENIED');
  });
  await t.test('credential rotation while eligibility waits aborts without durable result',async()=>{
    const actor=await c.mkUser(x.org,[a.roles.accept]);
    const out=await residualRace(c)(`update gov_repo.governance_users set external_id='rotated-local-fixture' where user_id='${actor.id}';`,
      a.decideSql(actor,{commandId:x.cmd('epoch-wait'),proposalId:s.proposal_id,proposal:p}),'postgres');
    assert.match(out.second.err,/GV00[123]/);
    assert.equal(await a.k.one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('epoch-wait')}'`),'0');
  });
  const accepted=await a.decide(x,'accept',s,p);
  await t.test('immutable rows and support owner transaction boundary reject late attachment',async()=>{
    for(const table of ['proposals','states']) {
      await assert.rejects(c.owner(`update gov_repo.l15_risk_acceptance_${table} set organisation_id=organisation_id where organisation_id='${x.org}'`),/IMMUTABLE/);
      await assert.rejects(c.owner(`truncate gov_repo.l15_risk_acceptance_${table} cascade`),/IMMUTABLE/);
    }
    await assert.rejects(c.owner(`select gov_repo.l15_write_risk_acceptance_support_links_v1('${x.org}','STATE',null,null,'${accepted.state_id}',array['DISCOVERY_EVIDENCE'],array['${x.evidence}'])`),/SUPPORT_OWNER_NOT_IN_TRANSACTION/);
    await assert.rejects(c.owner(`update gov_repo.l15_risk_acceptance_heads set latest_state_id=null where organisation_id='${x.org}'`),/IMMUTABLE/);
  });
  await t.test('5s lock timeout is atomic',async()=>{
    const q=await a.residual(x,'timeout'),tp=a.proposal(q.stateId,p.requestedValidUntil!),ts=await a.submit(x,'timeout-submit',tp);
    const holder=c.session('postgres'),blocked=c.session('service_role');
    try {
      assert.equal((await holder.run(`begin;select gov_repo.l15_lock_risk_acceptance_key_guard_v1('${x.org}','${q.stateId}');`)).err,'');
      const out=await blocked.run(a.decideSql(x.acceptor,{commandId:x.cmd('timeout-decide'),proposalId:ts.proposal_id,proposal:tp}));
      assert.match(out.err,/55P03/);
      assert.equal(await a.k.one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd('timeout-decide')}'`),'0');
    } finally {await holder.run('rollback;');await Promise.all([holder.close(),blocked.close()]);}
  });
  await t.test('equal support counts cannot substitute unequal exact decision/state sets at COMMIT',async()=>{
    const q=await a.residual(x,'sets'),tp=a.proposal(q.stateId,p.requestedValidUntil!);
    const e1=await c.evidence(x.org,'accept-support-1'),e2=await c.evidence(x.org,'accept-support-2');
    const support={status:'PRESENT',entries:[{tag:'DISCOVERY_EVIDENCE',targetId:x.evidence}]} as const;
    const session=c.session('postgres');
    try {
      await session.run('begin;');
      const sr=await session.run(a.submitSql(x.member,{commandId:x.cmd('sets-submit'),proposal:tp,support}));assert.equal(sr.err,'');
      const sub=JSON.parse(lastLine(sr.out));
      const dr=await session.run(a.decideSql(x.acceptor,{commandId:x.cmd('sets-decide'),proposalId:sub.proposal_id,proposal:tp,support}));assert.equal(dr.err,'');
      const dec=JSON.parse(lastLine(dr.out));
      assert.equal((await session.run(`select gov_repo.l15_write_risk_acceptance_support_links_v1('${x.org}','STATE',null,null,'${dec.state_id}',array['DISCOVERY_EVIDENCE'],array['${e1}']);`)).err,'');
      assert.equal((await session.run(`select gov_repo.l15_write_risk_acceptance_support_links_v1('${x.org}','DECISION',null,'${dec.governance_decision_id}',null,array['DISCOVERY_EVIDENCE'],array['${e2}']);`)).err,'');
      assert.match((await session.run('commit;')).err,/ACCEPTANCE_SUPPORT_MISMATCH/);
    } finally {await session.run('rollback;');await session.close();}
  });
  await t.test('locked Authority Policy successor changes authorization seen by a waiting acceptance',async()=>{
    const q=await a.residual(x,'policy-wait'),tp=a.proposal(q.stateId,p.requestedValidUntil!),sub=await a.submit(x,'policy-pending',tp),sk=a.k.s2.sk;
    const admitted=await sk.admitNext(x,x.ops,'remove-acceptance',sk.opsRules(1).filter(r=>r.permission.startsWith('L14_AUTHORITY_POLICY_'))),ap=sk.validateProposal(admitted);
    const aps=await sk.submit(x,x.member,'remove-acceptance-submit',ap),head=await sk.head(x.org);
    const mutation=sk.decideSqlFor(x,x.ops,x.cmd('remove-acceptance-decide'),aps.proposal_id,ap,'VALIDATE',head.latest_state_id);
    const out=await residualRace(c)(mutation,a.decideSql(x.acceptor,{commandId:x.cmd('policy-wait-decide'),proposalId:sub.proposal_id,proposal:tp}));
    assert.equal(out.second.err,'');assert.equal(JSON.parse(lastLine(out.second.out)).outcome,'DENIED');
  });
});
