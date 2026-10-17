import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';

test('S6 acceptance: exact residual, authority, support, replay, no waiver and non-interference', {timeout:600_000},async t=>{
  const c=await l14Cluster(m=>t.diagnostic(m),{horizon:'M17S6'});t.after(()=>c.stop());
  const a=await acceptanceKit(c),x=await a.setup(),r=await a.residual(x,'main');
  const until=await a.k.instant('10 days'),p=a.proposal(r.stateId,until);
  const support={status:'PRESENT',entries:[{tag:'DISCOVERY_EVIDENCE',targetId:x.evidence}]} as const;
  const digest=async()=>a.k.one(`select md5(string_agg(rowtext,'|' order by rowtext)) from (
    select t::text rowtext from gov_repo.l15_governed_risk_states t where organisation_id='${x.org}'
    union all select t::text from gov_repo.l15_risk_assessment_states t where organisation_id='${x.org}'
    union all select t::text from gov_repo.l15_risk_treatment_states t where organisation_id='${x.org}'
    union all select t::text from gov_repo.l14_control_assessment_states t where organisation_id='${x.org}'
    union all select t::text from gov_repo.l14_control_applicability_states t where organisation_id='${x.org}') q`);
  const before=await digest(),beforeRead=await a.k.read(x.member,r.risk.stateId);
  const s=await a.submit(x,'submit',p,{support});
  await t.test('submission grants no authority; DENY durable; scoped authority resolves risk subject',async()=>{
    assert.equal((await a.read(x.member,r.stateId)).resolution,'ABSENT');
    const deny=await a.decide(x,'denied',s,p,{},x.member);
    assert.equal(deny.outcome,'DENIED');assert.equal(deny.state_id,null);
    assert.equal((await a.decide(x,'denied',s,p,{},x.member)).replay,true);
  });
  const accepted=await a.decide(x,'decide',s,p,{support},x.acceptKind);
  await t.test('O49/O51/O52: exact validated residual retained, independent bounded acceptance, no authoritative side effects',async()=>{
    assert.equal(accepted.outcome,'VALIDATED');assert.equal(accepted.residual_assessment_state_id,r.stateId);
    const read=await a.read(x.member,r.stateId);
    assert.equal(read.acceptance_status,'ACCEPTED');assert.equal(read.resolution,'CURRENT');
    assert.equal(read.current_state.governed_risk_state_id,r.risk.stateId);
    assert.equal(await digest(),before);
    const after=await a.k.read(x.member,r.risk.stateId);
    assert.deepEqual(after.current_state,beforeRead.current_state);
    assert.doesNotMatch(JSON.stringify(read),/WAIVED|waiver|exception|coverage|closed/i);
  });
  await t.test('canonical support on proposal, decision and state; replay before live validation; GV007/GV008/GV009',async()=>{
    assert.equal(await a.k.one(`select count(*) from gov_repo.l15_support_links where organisation_id='${x.org}' and owner_kind='RISK_ACCEPTANCE'`),'3');
    assert.equal((await a.submit(x,'submit',p,{support})).replay,true);
    assert.equal((await a.decide(x,'decide',s,p,{support},x.acceptKind)).replay,true);
    await c.rejects(a.submit(x,'submit',{...p,requestedValidUntil:await a.k.instant('9 days')},{support}),'GV007');
    await c.rejects(a.submit(x,'bad-fingerprint',p,{fingerprint:'b'.repeat(64)}),'GV008');
    await c.rejects(a.submit(x,'stale',p),'GV009');
    await c.rejects(a.decide(x,'decide',s,p,{},x.acceptKind),'GV007');
  });
  await t.test('O49/O83: inherent/foreign/missing exact pin rejected even with valid support; source limited to human',async()=>{
    for (const id of [r.inherent.stateId,randomUUID()]) await c.rejects(a.submit(x,'wrong-pin',a.proposal(id,until),{support}),'GV010');
    const y=await a.setup();await c.rejects(a.submit(y,'foreign-pin',p),'GV010');
    await c.rejects(a.submit(x,'no-pin',p,{support,raw:{p_residual_assessment_state_id:'null::uuid'}}),'GV010');
    await c.rejects(a.submit(x,'source',p,{raw:{p_source_class:"'SOURCE_CONNECTION'"}}),'GV010');
    await c.rejects(a.submit(x,'no-until',p,{raw:{p_requested_valid_until:'null::timestamptz'}}),'GV010');
  });
  await t.test('O50: interval strictly bounded by residual validity',async()=>{
    const other=await a.residual(x,'bounded');
    await c.rejects(a.submit(x,'overlong',a.proposal(other.stateId,await a.k.instant('21 days'))),'GV010');
    const edge=a.proposal(other.stateId,other.until);
    assert.equal((await a.accept(x,'edge',edge)).decided.outcome,'VALIDATED');
    assert.equal((await a.read(x.member,other.stateId,other.until)).resolution,'EXPIRED');
  });
  const at=await a.k.instant('0 seconds'),history=await a.history(x.org);
  await a.k.k4.revokeAssessment(x,'inherent-revoke',r.risk.stateId,r.m,r.inherent.stateId);
  await t.test('transitive invalidation preserves history and prior cutoff; replay retains original success',async()=>{
    const read=await a.read(x.member,r.stateId);
    assert.equal(read.resolution,'DEPENDENCY_INVALID');assert.equal(read.current_state,null);assert.equal(read.dependency_id,r.stateId);
    assert.equal(await a.history(x.org),history);
    assert.equal((await a.read(x.member,r.stateId,at,at)).resolution,'CURRENT');
    assert.equal((await a.read(x.member,r.stateId,until)).resolution,'EXPIRED');
    assert.equal((await a.submit(x,'submit',p,{support})).replay,true);
    assert.equal((await a.decide(x,'decide',s,p,{support},x.acceptKind)).replay,true);
    await c.rejects(a.submit(x,'invalid-residual',{...p,expectedCurrentStateId:accepted.state_id}),'GV010');
  });
  await t.test('cleanup REVOKE survives dependency invalidation, with exact predecessor and replay',async()=>{
    const revoke=a.revocation(p,accepted.state_id),sub=await a.submit(x,'revoke-submit',revoke);
    const d=await a.decide(x,'revoke-decide',sub,revoke,{outcome:'REVOKE'});
    assert.equal(d.outcome,'REVOKED');assert.equal(d.predecessor_state_id,accepted.state_id);
    assert.equal((await a.read(x.member,r.stateId)).resolution,'ABSENT');
    assert.equal((await a.decide(x,'revoke-decide',sub,revoke,{outcome:'REVOKE'})).replay,true);
    assert.equal((await a.read(x.member,r.stateId,at,at)).resolution,'CURRENT');
  });
  await t.test('self validation and future dating require explicit policy, REJECT/DEFER persist without state',async()=>{
    const q=await a.residual(x,'authority'),p2=a.proposal(q.stateId,until),sub=await a.submit(x,'self-submit',p2,{},x.acceptor);
    assert.equal((await a.decide(x,'self-deny',sub,p2)).outcome,'DENIED');
    const future={...p2,requestedEffectiveFrom:await a.k.instant('1 day')},fs=await a.submit(x,'future',future);
    assert.equal((await a.decide(x,'future-deny',fs,future)).outcome,'DENIED');
    assert.equal((await a.decide(x,'defer',sub,p2,{outcome:'DEFER'})).outcome,'DEFERRED');
    assert.equal((await a.decide(x,'reject',sub,p2,{outcome:'REJECT'})).outcome,'REJECTED');
    await c.rejects(a.decide(x,'terminal',sub,p2),'GV010');
    const model=await a.residual(x,'scope-model','MODEL'),mp=a.proposal(model.stateId,until),ms=await a.submit(x,'model',mp);
    assert.equal((await a.decide(x,'kind-deny',ms,mp,{},x.acceptKind)).outcome,'DENIED');
  });
});
