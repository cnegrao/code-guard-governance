import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster,lastLine } from '../helpers/m16-l14-fixtures';
import { m17s6Kit } from '../helpers/m17-s6-fixtures';
import { residualRace } from '../helpers/m17-s6-concurrency';
import { METHODOLOGY } from '../helpers/m17-s2-fixtures';

test('S6 residual temporal selection, CAS/replay and dependency concurrency on PG17', { timeout:600_000 },async t => {
  const c = await l14Cluster(m => t.diagnostic(m),{ horizon:'M17S6' }); t.after(() => c.stop());
  const k = await m17s6Kit(c), x = await k.setup(), race = residualRace(c);
  let n=0; const name=()=>`tc-${++n}`;
  const json = (s:string) => JSON.parse(lastLine(s));
  async function fresh() {
    const r = await k.risk(x,name()), m = await k.methodology(x,name()), until = await k.instant('20 days');
    const i = await k.k4.assess(x,name(),k.k4.insufficient(r.stateId,m,until));
    return { r,m,i,until,p:k.proposal(r.stateId,m,i.stateId,until) };
  }
  const decision = (s:Record<string,any>,p:Parameters<typeof k.submit>[2],outcome:'VALIDATE'|'REVOKE'='VALIDATE',command=name()) =>
    k.decideSql(x.assessor,{ commandId:x.cmd(command),proposalId:s.proposal_id,proposal:p,outcome });
  const revocation = (p:Parameters<typeof k.submit>[2],id:string) => ({ ...p,intent:'REVOKE' as const,assessmentOutcome:null,
    likelihoodLevelCode:null,impactLevelCode:null,requestedValidUntil:null,expectedCurrentStateId:id,targetStateId:id });
  await t.test('first states race: one durable state, GV009 loser; identical replay and GV007 conflict',async () => {
    const f=await fresh(), label=name(), a=await k.submit(x,label,f.p), b=await k.submit(x,name(),f.p);
    const command=decision(a,f.p), out=await race(command,decision(b,f.p));
    assert.equal(json(out.first.out).outcome,'VALIDATED'); assert.match(out.second.err,/GV009/);
    assert.equal((await c.exec(command)).replay,true);
    await c.rejects(k.submit(x,label,{ ...f.p,likelihoodLevelCode:'L2' }),'GV007');
    await c.rejects(k.submit(x,name(),f.p,{ fingerprint:'b'.repeat(64) }),'GV008');
    assert.equal(await k.one(`select count(*) from gov_repo.l15_risk_assessment_states where governed_risk_state_id='${f.r.stateId}' and assessment_basis='RESIDUAL'`),'1');
  });
  await t.test('identical concurrent decide replays original result',async () => {
    const f=await fresh(), s=await k.submit(x,name(),f.p), sql=decision(s,f.p), out=await race(sql,sql);
    assert.equal(out.second.err,''); assert.deepEqual(json(out.second.out),{ ...json(out.first.out),replay:true });
  });
  await t.test('competing successor and revoke cannot fork; invalidated dependency still permits cleanup',async () => {
    const f=await fresh(), root=await k.assess(x,name(),f.p);
    const next={ ...f.p,expectedCurrentStateId:root.stateId,likelihoodLevelCode:'L2' }, rev=revocation(f.p,root.stateId);
    const a=await k.submit(x,name(),next), b=await k.submit(x,name(),rev);
    const out=await race(decision(a,next),decision(b,rev,'REVOKE'));
    assert.equal(json(out.first.out).outcome,'VALIDATED'); assert.match(out.second.err,/GV009/);
    await k.k4.revokeAssessment(x,name(),f.r.stateId,f.m,f.i.stateId);
    const cleanup=revocation(next,json(out.first.out).state_id), s=await k.submit(x,name(),cleanup);
    assert.equal((await k.decide(x,name(),s,cleanup,{ outcome:'REVOKE' })).outcome,'REVOKED');
    assert.equal((await k.read(x.member,f.r.stateId)).resolution,'ABSENT');
  });
  await t.test('pin-only correction is a new residual; old inherent is never automatically replaced',async () => {
    const f=await fresh(), root=await k.assess(x,name(),f.p);
    const i2=await k.k4.assess(x,name(),{ ...f.i.proposal,assessmentOutcome:'RATED',likelihoodLevelCode:'L1',impactLevelCode:'I1',expectedCurrentStateId:f.i.stateId });
    assert.equal((await k.read(x.member,f.r.stateId)).resolution,'DEPENDENCY_INVALID');
    const res=await k.assess(x,name(),{ ...f.p,expectedCurrentStateId:root.stateId,inherentAssessmentStateId:i2.stateId });
    assert.equal((await k.read(x.member,f.r.stateId)).current_state.state_id,res.stateId);
    assert.equal(res.decided.rating_band,root.decided.rating_band);
  });
  await t.test('future successor and its expiry never resurrect predecessor; recorded cutoff stays exact',async () => {
    const f=await fresh(), root=await k.assess(x,name(),f.p), before=await k.instant('0 seconds');
    const future=await k.instant('1 day'), expiry=await k.instant('2 days');
    const next={ ...f.p,expectedCurrentStateId:root.stateId,likelihoodLevelCode:'L2',requestedEffectiveFrom:future,requestedValidUntil:expiry };
    const res=await k.assess(x,name(),next);
    assert.equal((await k.read(x.member,f.r.stateId)).current_state.state_id,root.stateId);
    assert.equal((await k.read(x.member,f.r.stateId,future)).current_state.state_id,res.stateId);
    assert.equal((await k.read(x.member,f.r.stateId,future,before)).current_state.state_id,root.stateId);
    assert.equal((await k.read(x.member,f.r.stateId,expiry)).resolution,'EXPIRED');
    assert.equal((await k.read(x.member,f.r.stateId,expiry,before)).current_state.state_id,root.stateId);
  });
  await t.test('backdated successor uses explicit authority and cannot precede predecessor',async () => {
    const f=await fresh(), root=await k.assess(x,name(),f.p), at=await k.instant('0 seconds');
    const p={ ...f.p,expectedCurrentStateId:root.stateId,requestedEffectiveFrom:at,likelihoodLevelCode:'L2' }, s=await k.submit(x,name(),p);
    assert.equal((await k.decide(x,name(),s,p)).outcome,'DENIED');
    const next=await k.decide(x,name(),s,p,{},x.raDater);
    assert.equal(next.outcome,'VALIDATED');
    assert.equal((await k.read(x.member,f.r.stateId,at,at)).current_state.state_id,root.stateId);
    const rootFrom=await k.one(`select gov_repo.l14_canonical_instant_v1('${root.decided.effective_from}'::timestamptz)`);
    const bad={ ...p,expectedCurrentStateId:next.state_id,requestedEffectiveFrom:rootFrom,likelihoodLevelCode:'L3' };
    const bs=await k.submit(x,name(),bad);
    await c.rejects(k.decide(x,name(),bs,bad,{},x.raDater),'GV011');
  });
  for (const kind of ['risk','methodology'] as const) for (const first of ['dependency','residual'] as const)
    await t.test(`${kind} mutation vs residual decision, ${first} commits first`,async () => {
      const f=await fresh(), s=await k.submit(x,name(),f.p); let mutation:string;
      if (kind==='risk') {
        const p=k.k3.proposalOf(f.r.subject,f.r.scen,{ intent:'REVOKE',targetStateId:f.r.stateId,expectedCurrentStateId:f.r.stateId,closureReason:'RECORDED_IN_ERROR' });
        const q=await k.k3.submit(x,name(),p);
        mutation=k.k3.decideSql(x.validator,{ commandId:x.cmd(name()),proposalId:q.proposal_id,proposal:p,outcome:'REVOKE' });
      } else {
        const p=k.s2.proposalOf(METHODOLOGY,f.m.admitted,{ intent:'REVOKE',targetStateId:f.m.stateId });
        const q=await c.exec(k.s2.submitSql(x.member,{ commandId:x.cmd(name()),proposal:p }));
        mutation=k.s2.decideSql(x.methodologyValidator,{ commandId:x.cmd(name()),proposalId:q.proposal_id,proposal:p,outcome:'REVOKE',expected:f.m.stateId });
      }
      const out=first==='dependency' ? await race(mutation,decision(s,f.p)) : await race(decision(s,f.p),mutation);
      if (first==='dependency') { assert.match(out.second.err,/GV010/); assert.equal((await k.read(x.member,f.r.stateId)).resolution,'ABSENT'); }
      else {
        assert.equal(out.second.err,''); assert.equal((await k.read(x.member,f.r.stateId)).resolution,'DEPENDENCY_INVALID');
        const saved=json(out.first.out);
        assert.equal((await k.read(x.member,f.r.stateId,saved.recorded_at,saved.recorded_at)).resolution,'CURRENT');
      }
    });
  await t.test('bounded lock timeout fails atomically without a command result',async () => {
    const f=await fresh(), s=await k.submit(x,name(),f.p), holder=c.session('postgres'), blocked=c.session('service_role');
    const command=name();
    try {
      await holder.run(`begin; select gov_repo.l15_lock_risk_assessment_key_guard_v1('${x.org}','${f.r.stateId}','RESIDUAL');`);
      const result=await blocked.run(decision(s,f.p,'VALIDATE',command));
      assert.match(result.err,/55P03/);
      assert.equal(await k.one(`select count(*) from gov_repo.l14_command_results where organisation_id='${x.org}' and command_id='${x.cmd(command)}'`),'0');
    } finally { await holder.run('rollback;'); await Promise.all([holder.close(),blocked.close()]); }
  });
});
