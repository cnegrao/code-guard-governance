import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { s7dCluster, s7dSnapshot } from '../helpers/m17-s7d-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';
import { m17s5Kit } from '../helpers/m17-s5-fixtures';
import { scenarioContent, methodologyContent, SCENARIO, METHODOLOGY } from '../helpers/m17-s2-fixtures';
import { objectSubject } from '../helpers/m17-s3-fixtures';
import { m17s3Kit } from '../helpers/m17-s3-fixtures';
import { rule, lastLine, type Actor } from '../helpers/m16-l14-fixtures';
import type { L14GovernanceOutcome } from '@council/canonical-contracts';

const families = ['RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY','GOVERNED_RISK','RISK_ASSESSMENT','RISK_TREATMENT','RISK_ACCEPTANCE'] as const;
const permissions = ['L15_RISK_SCENARIO_VALIDATE','L15_RISK_METHODOLOGY_VALIDATE','L15_GOVERNED_RISK_VALIDATE',
  'L15_RISK_ASSESSMENT_VALIDATE','L15_RISK_TREATMENT_VALIDATE','L15_RISK_ACCEPTANCE_VALIDATE'] as const;
const actions = ['VALIDATE','REJECT','DEFER','REVOKE'] as const;
const success = { VALIDATE:'VALIDATED', REJECT:'REJECTED', DEFER:'DEFERRED', REVOKE:'REVOKED' };

test('S7D O56 all six decision families: deny every self outcome, explicit matched allow, non-self, replay and real concurrency',
  {timeout:1_200_000}, async t => {
    const c=await s7dCluster(message=>t.diagnostic(message)); t.after(()=>c.stop());
    const a=await acceptanceKit(c), k=a.k.k4, g=k.k3, s=k.s2, rt=await m17s5Kit(c);
    const denyRole=randomUUID(), allowRole=randomUUID(), unrelatedRole=randomUUID();
    for(const id of [denyRole,allowRole,unrelatedRole]) await c.owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','S7D_${id}','S7D','organisation',false)`);
    const x=await k.setup({extra:()=>[
      ...rt.pk.partyRules().filter(r=>r.permission.startsWith('L14_PARTY_')),
      ...permissions.flatMap(p=>actions.flatMap(outcome=>[
        rule(denyRole,p,outcome),rule(allowRole,p,outcome,{allowSelfValidation:true})])),
      // A self grant on another scope must never authorize the exact AGENT_VERSION.
      rule(unrelatedRole,'L15_GOVERNED_RISK_VALIDATE','REJECT',{allowSelfValidation:true,scopeTag:'CANONICAL_KIND',scopeCanonicalKind:'MODEL'}),
    ]});
    const denied=await c.mkUser(x.org,[denyRole,unrelatedRole]), allowed=await c.mkUser(x.org,[allowRole]);
    const nonself=await c.mkUser(x.org,[denyRole]);
    const party={...x,registrar:await c.mkUser(x.org,[rt.pk.registrarRole]),steward:await c.mkUser(x.org,[rt.pk.stewardRole]),flex:await c.mkUser(x.org,[rt.pk.flexRole])};
    const responsible=await rt.pk.validated(party as never,'s7d-responsible');
    const tx={...x,responsible};
    let n=0;
    const nm=(prefix:string)=>`s7d-${prefix}-${++n}`;
    // Each test owns a fresh logical key. All proposal/state creation uses real
    // service_role RPCs; no L15 row is seeded by the owner.
    async function prepare(family:typeof families[number], revoke=false) {
      const name=nm(family);
      let p:any, submitSql:(actor:Actor,o:any)=>string, decideSql:(actor:Actor,o:any)=>string;
      let rev:(p:any,id:string)=>any;
      if(family===SCENARIO || family===METHODOLOGY) {
        const admitted=family===SCENARIO
          ? await s.admitScenario(x as never,name,scenarioContent({},`SCN-${n}`))
          : await s.admitMethodology(x as never,name,methodologyContent());
        p=s.proposalOf(family,admitted);submitSql=s.submitSql;decideSql=s.decideSql;
        rev=(v,id)=>({...v,intent:'REVOKE',targetStateId:id});
      } else if(family==='GOVERNED_RISK') {
        const scen=await g.scenario(x,name,'OPERATIONAL',['AGENT_VERSION']);
        p=g.proposalOf(objectSubject('AGENT_VERSION',x.objects.AGENT_VERSION!),scen);
        submitSql=g.submitSql;decideSql=g.decideSql;
        rev=(v,id)=>({...v,intent:'REVOKE',expectedCurrentStateId:id,targetStateId:id,closureReason:'RISK_NO_LONGER_APPLICABLE'});
      } else if(family==='RISK_ASSESSMENT') {
        const risk=await k.risk(x,name),m=await k.methodology(x,name),until=await k.instant('20 days');
        p=k.insufficient(risk.stateId,m,until);submitSql=k.submitSql;decideSql=k.decideSql;
        rev=(_v,id)=>k.revocation(risk.stateId,m,id);
      } else if(family==='RISK_TREATMENT') {
        const risk=await k.risk(x,name);
        p=rt.proposal(tx as never,risk.stateId);submitSql=rt.submitSql;decideSql=rt.decideSql;rev=rt.revocation;
      } else {
        const residual=await a.residual(x as never,name);
        p=a.proposal(residual.stateId,await k.instant('10 days'));
        submitSql=a.submitSql;decideSql=a.decideSql;rev=a.revocation;
      }
      let expected:string|null=null;
      if(revoke) {
        const sp=await c.exec(submitSql(x.member,{commandId:nm('base-submit'),proposal:p}));
        const d=await c.exec(decideSql(nonself,{commandId:nm('base-validate'),proposalId:sp.proposal_id,proposal:p}));
        assert.equal(d.outcome,'VALIDATED');expected=d.state_id;p=rev(p,d.state_id);
      }
      return {p,submitSql,decideSql,expected};
    }
    for(const family of families) for(const outcome of actions) await t.test(`${family} / ${outcome}`,async()=>{
      const q=await prepare(family,outcome==='REVOKE');
      const submitted=await c.exec(q.submitSql(denied,{commandId:nm('submit-self-deny'),proposal:q.p}));
      const commandId=nm('self-deny'), sql=q.decideSql(denied,{commandId,proposalId:submitted.proposal_id,proposal:q.p,outcome,expected:q.expected});
      const statesBefore=await c.owner(`select count(*) from gov_repo.l14_governance_decisions where organisation_id='${x.org}'`);
      const l15Before=(await s7dSnapshot(c)).filter((row:{name:string})=>row.name.startsWith('l15_'));
      const result=await c.exec(sql);
      assert.equal(result.outcome,'DENIED'); assert.equal(result.deny_reason,'SELF_VALIDATION_NOT_PERMITTED');
      assert.equal(await c.owner(`select count(*) from gov_repo.l14_governance_decisions where organisation_id='${x.org}'`),statesBefore);
      assert.deepEqual((await s7dSnapshot(c)).filter((row:{name:string})=>row.name.startsWith('l15_')),l15Before,
        'denied self decision writes no L15 state, head, support, proposal or analytical row');
      const beforeReplay=await s7dSnapshot(c);
      assert.deepEqual(await c.exec(sql),{...result,replay:true});assert.deepEqual(await s7dSnapshot(c),beforeReplay,'DENY replay is zero-write');
      const auth=JSON.parse(await c.owner(`select json_build_object('self',is_self_validation,'action',requested_action,'result',result)
        from gov_repo.l14_authorization_decisions where organisation_id='${x.org}' and command_id='${commandId}'`));
      assert.deepEqual(auth,{self:true,action:outcome,result:'DENY'});
      const other=await c.exec(q.decideSql(nonself,{commandId:nm('nonself'),proposalId:submitted.proposal_id,proposal:q.p,outcome,expected:q.expected}));
      assert.equal(other.outcome,success[outcome]);
      const qa=await prepare(family,outcome==='REVOKE');
      const sa=await c.exec(qa.submitSql(allowed,{commandId:nm('submit-self-allow'),proposal:qa.p}));
      const allowSql=qa.decideSql(allowed,{commandId:nm('self-allow'),proposalId:sa.proposal_id,proposal:qa.p,outcome,expected:qa.expected});
      const ok=await c.exec(allowSql);assert.equal(ok.outcome,success[outcome]);
      assert.equal((await c.owner(`select is_self_validation and result='ALLOW' from gov_repo.l14_authorization_decisions
        where authorization_decision_id='${ok.authorization_decision_id}'`)).trim(),'t');
      const after=await s7dSnapshot(c);assert.deepEqual(await c.exec(allowSql),{...ok,replay:true});assert.deepEqual(await s7dSnapshot(c),after,'ALLOW replay is zero-write');
    });

    // Real contention for each changed routine. A denied self attempt commits
    // first; a distinct backend must wait, then make the permitted non-self decision.
    for(const family of families) await t.test(`${family} / concurrent denied self vs non-self REJECT`,async()=>{
      const q=await prepare(family),p=await c.exec(q.submitSql(denied,{commandId:nm('race-submit'),proposal:q.p}));
      const first=c.session('service_role'),second=c.session('service_role'),monitor=c.session('m16_bootstrap');
      try {
        const pid1=(await first.run('select pg_backend_pid();')).out.trim(),pid2=(await second.run('select pg_backend_pid();')).out.trim();
        const one=await first.run(`begin; ${q.decideSql(denied,{commandId:nm('race-self'),proposalId:p.proposal_id,proposal:q.p,outcome:'REJECT'})}`);
        assert.equal(one.err,'');assert.equal(JSON.parse(lastLine(one.out)).outcome,'DENIED');
        const pending=second.run(q.decideSql(nonself,{commandId:nm('race-other'),proposalId:p.proposal_id,proposal:q.p,outcome:'REJECT'}));
        let observed=false;
        for(let i=0;i<500;i++) {
          const r=await monitor.run(`select wait_event_type='Lock' and pg_blocking_pids(${pid2}) @> array[${pid1}] from pg_stat_activity where pid=${pid2};`);
          if(r.out.trim()==='t'){observed=true;break;}await sleep(20);
        }
        assert.ok(observed,'independent backend observed blocked on actual lock');
        assert.equal((await first.run('commit;')).err,'');
        const two=await pending;assert.equal(two.err,'');assert.equal(JSON.parse(lastLine(two.out)).outcome,'REJECTED');
      } finally {await Promise.all([first.close(),second.close(),monitor.close()]);}
    });
    await t.test('ADMIT retains its distinct proposal-free non-self envelope',async()=>{
      assert.equal((await c.owner(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}'
        and requested_action='ADMIT' and subject_kind in ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')
        and (proposal_id is not null or is_self_validation is not null)`)).trim(),'0');
      assert.ok(Number(await c.owner(`select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${x.org}'
        and requested_action='ADMIT' and subject_kind in ('RISK_SCENARIO_DEFINITION','RISK_METHODOLOGY')`))>0);
    });
  });

test('S7D central deferred guard rejects forged self ALLOW without the exact matching permission/action/source/scope grant',
  {timeout:600_000},async t=>{
    const c=await s7dCluster(m=>t.diagnostic(m));t.after(()=>c.stop());
    const g=await m17s3Kit(c),donor=randomUUID();
    await c.owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${donor}','S7D_DONOR','S7D donor','organisation',false)`);
    const x=await g.setup({extra:()=>[
      rule(donor,'L15_GOVERNED_RISK_VALIDATE','REJECT',{allowSelfValidation:true,scopeTag:'CANONICAL_KIND',scopeCanonicalKind:'MODEL'}),
      rule(donor,'L15_GOVERNED_RISK_VALIDATE','REJECT',{allowSelfValidation:true,sourceDisposition:'CONTRIBUTING'}),
      rule(donor,'L15_RISK_SCENARIO_VALIDATE','REJECT',{allowSelfValidation:true}),
    ]});
    const scen=await g.scenario(x,'central-scenario','OPERATIONAL',['AGENT_VERSION']);
    const proposal=g.proposalOf(objectSubject('AGENT_VERSION',x.objects.AGENT_VERSION!),scen);
    const p=await g.submit(x,'central',proposal,{},x.self);
    const denied=await g.decide(x,'central',p,proposal,{outcome:'REJECT'},x.self);
    assert.equal(denied.deny_reason,'SELF_VALIDATION_NOT_PERMITTED');
    const before=await s7dSnapshot(c);
    // Seed only adversarial shared-envelope rows in transactions that MUST fail
    // at natural COMMIT. No trigger is disabled and no production body is stubbed.
    for(const [label,where] of [
      ['self false',"permission='L15_GOVERNED_RISK_VALIDATE' and requested_action='REJECT' and scope_tag='ALL_ALLOWED_TARGETS' and source_disposition='AUTHORITATIVE' and not allow_self_validation"],
      ['other action',"permission='L15_GOVERNED_RISK_VALIDATE' and requested_action='VALIDATE' and allow_self_validation"],
      ['other permission',"permission='L15_RISK_SCENARIO_VALIDATE' and requested_action='REJECT' and allow_self_validation"],
      ['other source disposition',"permission='L15_GOVERNED_RISK_VALIDATE' and requested_action='REJECT' and source_disposition='CONTRIBUTING'"],
      ['other exact scope',"permission='L15_GOVERNED_RISK_VALIDATE' and requested_action='REJECT' and scope_tag='CANONICAL_KIND' and scope_canonical_kind='MODEL' and allow_self_validation"],
    ]) await t.test(label,async()=>{
      const auth=randomUUID(),decision=randomUUID(),command=`central-forge-${randomUUID()}`;
      const sql=`begin;
        insert into gov_repo.l14_authorization_decisions select (jsonb_populate_record(null::gov_repo.l14_authorization_decisions,
          to_jsonb(d)||jsonb_build_object('authorization_decision_id','${auth}','command_id','${command}','result','ALLOW','deny_reason',null))).*
          from gov_repo.l14_authorization_decisions d where d.authorization_decision_id='${denied.authorization_decision_id}';
        insert into gov_repo.l14_authorization_decision_rules(organisation_id,authorization_decision_id,snapshot_ordinal,permission_origin,
          permission,requested_action,source_class,source_disposition,scope_tag,scope_canonical_kind,scope_canonical_object_id,
          scope_relationship_type,scope_relationship_id,scope_relationship_state_id,allow_self_validation,allow_future_dating,allow_backdating,
          basis_authority_policy_id,basis_version_id,basis_rule_ordinal)
        select r.organisation_id,'${auth}',1,'AUTHORITY_POLICY_RULE',r.permission,r.requested_action,r.source_class,r.source_disposition,
          r.scope_tag,r.scope_canonical_kind,r.scope_canonical_object_id,r.scope_relationship_type,r.scope_relationship_id,r.scope_relationship_state_id,
          r.allow_self_validation,r.allow_future_dating,r.allow_backdating,r.authority_policy_id,r.version_id,r.rule_ordinal
        from gov_repo.l14_authority_policy_rules r where r.organisation_id='${x.org}' and r.version_id=(select basis_version_id
          from gov_repo.l14_authorization_decisions where authorization_decision_id='${denied.authorization_decision_id}') and ${where}
        order by r.rule_ordinal limit 1;
        insert into gov_repo.l14_governance_decisions(organisation_id,governance_decision_id,proposal_id,subject_kind,outcome,reason_code,
          authorization_decision_id,actor_user_id,support_status,decided_at) values('${x.org}','${decision}','${p.proposal_id}',
          'GOVERNED_RISK','REJECT','GOVERNED_RISK_REJECTED','${auth}','${x.self.id}','NONE',now());
        insert into gov_repo.l14_command_results select (jsonb_populate_record(null::gov_repo.l14_command_results,
          to_jsonb(r)||jsonb_build_object('command_id','${command}','authorization_decision_id','${auth}','governance_decision_id','${decision}',
            'outcome','REJECTED'))).* from gov_repo.l14_command_results r where r.organisation_id='${x.org}' and r.command_id='${denied.command_id}';
        commit;`;
      const failure=label==='other action'||label==='other permission'
        ? /L15_PERMISSION_SUBJECT_MISMATCH/ : /L15_ALLOW_WITHOUT_L15_AUTHORITY/;
      await assert.rejects(c.owner(sql),failure);
      assert.deepEqual(await s7dSnapshot(c),before,'forged self ALLOW rolls back completely');
    });
  });
