import assert from 'node:assert/strict';
import {test} from 'node:test';
import {l14Cluster,lastLine} from '../helpers/m16-l14-fixtures';
import {acceptanceKit} from '../helpers/m17-s6-acceptance-fixtures';
import {residualRace} from '../helpers/m17-s6-concurrency';
import {METHODOLOGY} from '../helpers/m17-s2-fixtures';

test('S6 acceptance temporal selection and real concurrent writers',{timeout:600_000},async t=>{
  const c=await l14Cluster(m=>t.diagnostic(m),{horizon:'M17S6'});t.after(()=>c.stop());
  const a=await acceptanceKit(c),x=await a.setup(),race=residualRace(c),json=(s:string)=>JSON.parse(lastLine(s));
  let n=0;const name=()=>`ac-${++n}`;
  const until=await a.k.instant('10 days');
  const decision=(s:Record<string,any>,p:Parameters<typeof a.submit>[2],outcome:'VALIDATE'|'REVOKE'='VALIDATE',command=name())=>a.decideSql(x.acceptor,{commandId:x.cmd(command),proposalId:s.proposal_id,proposal:p,outcome});
  await t.test('concurrent first/first has one durable state; same command replay and changed-payload replay serialize',async()=>{
    const r=await a.residual(x,name()),p=a.proposal(r.stateId,until),s=await a.submit(x,name(),p),s2=await a.submit(x,name(),p);
    const out=await race(decision(s,p),decision(s2,p));assert.match(out.second.err,/GV009/);
    assert.equal(await a.k.one(`select count(*) from gov_repo.l15_risk_acceptance_states where residual_assessment_state_id='${r.stateId}'`),'1');
    const q=await a.residual(x,name()),p2=a.proposal(q.stateId,until),s3=await a.submit(x,name(),p2),cmd=decision(s3,p2);
    const rep=await race(cmd,cmd);assert.deepEqual(json(rep.second.out),{...json(rep.first.out),replay:true});
    const changed=await a.residual(x,name()),cp=a.proposal(changed.stateId,until),cs=await a.submit(x,name(),cp),command=name();
    const conflict=await race(decision(cs,cp,'VALIDATE',command),a.decideSql(x.acceptor,{commandId:x.cmd(command),proposalId:cs.proposal_id,proposal:cp,outcome:'REJECT'}));
    assert.match(conflict.second.err,/GV007/);
  });
  for(const mode of ['successor','revoke'] as const) await t.test(`successor vs ${mode}: CAS cannot fork`,async()=>{
    const r=await a.residual(x,name()),p=a.proposal(r.stateId,until),root=await a.accept(x,name(),p);
    const next={...p,expectedCurrentStateId:root.stateId},other=mode==='revoke'?a.revocation(p,root.stateId):{...next,requestedValidUntil:await a.k.instant('9 days')};
    const s=await a.submit(x,name(),next),s2=await a.submit(x,name(),other),out=await race(decision(s,next),decision(s2,other,mode==='revoke'?'REVOKE':'VALIDATE'));
    assert.match(out.second.err,/GV009/);assert.equal(json(out.first.out).predecessor_state_id,root.stateId);
  });
  await t.test('future/expired successor never falls back; earlier cutoff retains predecessor',async()=>{
    const r=await a.residual(x,name()),p=a.proposal(r.stateId,until),root=await a.accept(x,name(),p),cutoff=await a.k.instant('0 seconds');
    const from=await a.k.instant('1 day'),end=await a.k.instant('2 days');
    const next={...p,expectedCurrentStateId:root.stateId,requestedEffectiveFrom:from,requestedValidUntil:end};
    const successor=await a.accept(x,name(),next,undefined,x.acceptFlex);
    assert.equal((await a.read(x.member,r.stateId)).current_state.state_id,root.stateId);
    assert.equal((await a.read(x.member,r.stateId,from)).current_state.state_id,successor.stateId);
    assert.equal((await a.read(x.member,r.stateId,end)).resolution,'EXPIRED');
    assert.equal((await a.read(x.member,r.stateId,end,cutoff)).current_state.state_id,root.stateId);
  });
  await t.test('backdated decisions preserve recorded cutoff and enforce GV011 continuity',async()=>{
    const r=await a.residual(x,name()),p=a.proposal(r.stateId,until),root=await a.accept(x,name(),p),at=await a.k.instant('0 seconds');
    const next={...p,expectedCurrentStateId:root.stateId,requestedEffectiveFrom:at},s=await a.submit(x,name(),next);
    assert.equal((await a.decide(x,name(),s,next)).outcome,'DENIED');
    const succ=await a.decide(x,name(),s,next,{},x.acceptFlex);
    assert.equal((await a.read(x.member,r.stateId,at,at)).current_state.state_id,root.stateId);
    const firstFrom=await a.k.one(`select gov_repo.l14_canonical_instant_v1('${root.decided.effective_from}'::timestamptz)`);
    const bad={...p,expectedCurrentStateId:succ.state_id,requestedEffectiveFrom:firstFrom},bs=await a.submit(x,name(),bad);
    await c.rejects(a.decide(x,name(),bs,bad,{},x.acceptFlex),'GV011');
  });
  for(const kind of ['residual-successor','residual-revoke','inherent','risk','methodology'] as const)
    for(const first of ['dependency','acceptance'] as const) await t.test(`${kind} vs acceptance, ${first} commits first`,async()=>{
      const r=await a.residual(x,name()),p=a.proposal(r.stateId,until),s=await a.submit(x,name(),p);let mutation:string;
      if(kind.startsWith('residual')) {
        const rp=kind==='residual-successor'?{...r.proposal,expectedCurrentStateId:r.stateId,likelihoodLevelCode:'L2'}:
          {...r.proposal,intent:'REVOKE' as const,assessmentOutcome:null,likelihoodLevelCode:null,impactLevelCode:null,requestedValidUntil:null,expectedCurrentStateId:r.stateId,targetStateId:r.stateId};
        const rs=await a.k.submit(x,name(),rp);mutation=a.k.decideSql(x.assessor,{commandId:x.cmd(name()),proposalId:rs.proposal_id,proposal:rp,outcome:kind==='residual-revoke'?'REVOKE':'VALIDATE'});
      } else if(kind==='inherent') {
        const rp=a.k.k4.revocation(r.risk.stateId,r.m,r.inherent.stateId),rs=await a.k.k4.submit(x,name(),rp);
        mutation=a.k.k4.decideSql(x.assessor,{commandId:x.cmd(name()),proposalId:rs.proposal_id,proposal:rp,outcome:'REVOKE'});
      } else if(kind==='risk') {
        const rp=a.k.k3.proposalOf(r.risk.subject,r.risk.scen,{intent:'REVOKE',targetStateId:r.risk.stateId,expectedCurrentStateId:r.risk.stateId,closureReason:'RECORDED_IN_ERROR'}),rs=await a.k.k3.submit(x,name(),rp);
        mutation=a.k.k3.decideSql(x.validator,{commandId:x.cmd(name()),proposalId:rs.proposal_id,proposal:rp,outcome:'REVOKE'});
      } else {
        const rp=a.k.s2.proposalOf(METHODOLOGY,r.m.admitted,{intent:'REVOKE',targetStateId:r.m.stateId}),rs=await c.exec(a.k.s2.submitSql(x.member,{commandId:x.cmd(name()),proposal:rp}));
        mutation=a.k.s2.decideSql(x.methodologyValidator,{commandId:x.cmd(name()),proposalId:rs.proposal_id,proposal:rp,outcome:'REVOKE',expected:r.m.stateId});
      }
      const out=first==='dependency'?await race(mutation,decision(s,p)):await race(decision(s,p),mutation);
      if(first==='dependency') {assert.match(out.second.err,/GV010/);assert.equal((await a.read(x.member,r.stateId)).resolution,'ABSENT');}
      else {
        assert.equal(out.second.err,'');assert.equal((await a.read(x.member,r.stateId)).resolution,'DEPENDENCY_INVALID');
        const saved=json(out.first.out);assert.equal((await a.read(x.member,r.stateId,saved.recorded_at,saved.recorded_at)).resolution,'CURRENT');
        assert.equal((await a.read(x.member,r.stateId)).dependency_id,r.stateId);
      }
      await c.rejects(a.submit(x,name(),p),'GV010');
    });
});
