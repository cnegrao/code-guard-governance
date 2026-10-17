import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';
import { m17s5Kit } from '../helpers/m17-s5-fixtures';
import { residualRace } from '../helpers/m17-s6-concurrency';

test('S6 acceptance O49-O52: real M16/treatment dependencies, serialization and non-interference', { timeout:600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon:'M17S6' }); t.after(() => c.stop());
  const ac = await acceptanceKit(c), k=ac.k, ca = await controlAssessmentKit(c), kt = await m17s5Kit(c, ca.cak.cdk);
  const base = await ca.setup(), objects = base.objects.byKind as Record<string,string>;
  const rels = { READS_FROM:base.rels.reads, EXPOSES:base.rels.exposes };
  const attached = await k.k3.attach(base as never, [...ca.rules(base.objects,base.rels), ...ac.acceptanceRules(), ...k.k4.raRules(objects,rels),
    ...kt.pk.partyRules().filter(r => r.permission.startsWith('L14_PARTY_'))], objects, rels);
  const x = { ...attached, acceptor:await c.mkUser(base.org,[ac.roles.accept]), assessor:await c.mkUser(base.org,[k.k4.roles.ra]), raDater:await c.mkUser(base.org,[k.k4.roles.raDating]),
    methodologyAdmitter:await c.mkUser(base.org,[k.s2.roles.methodologyAdmit]), methodologyValidator:await c.mkUser(base.org,[k.s2.roles.methodologyValidate]),
    methodologyDater:await c.mkUser(base.org,[k.s2.roles.dating]), treatment:await c.mkUser(base.org,[k.k3.roles.treatment]) } as Awaited<ReturnType<typeof ac.setup>>;
  const party = { ...base, registrar:await c.mkUser(x.org,[kt.pk.registrarRole]), steward:await c.mkUser(x.org,[kt.pk.stewardRole]) };
  const responsible = await kt.pk.validated(party as never,'responsible');
  const tx = { ...x, party, responsible } as never;
  const m = await k.methodology(x,'method'), until = await k.instant('20 days');
  let n = 0; const name = () => `dep-${++n}`;
  const race = residualRace(c);
  async function fresh() {
    const r = await k.risk(x,name(),'AGENT');
    const i = await k.k4.assess(x,name(),k.k4.rated(r.stateId,m,'L1','I1',until));
    return { r,i,p:k.proposal(r.stateId,m,i.stateId,until) };
  }
  const control = async (outcome:'NOT_ASSESSED'|'SATISFIED'='SATISFIED') => {
    const app = await ca.applicability(base,name(),ca.cak.objectTarget('AGENT',objects.AGENT!));
    const a = await ca.assess(base,name(),app.stateId,{ outcome }); return { app,a };
  };
  await t.test('O51 nonempty treatment and M16 rows/current reads unchanged by acceptance and revoke',async()=>{
    const f=await fresh(),ctl=await control('NOT_ASSESSED'),tr=await kt.treat(tx,name(),kt.proposal(tx,f.r.stateId));
    const res=await k.assess(x,name(),{...f.p,treatmentStateIds:[tr.stateId],controlAssessmentStateIds:[ctl.a.stateId]});
    const snapshot=async()=>({facts:await ca.factDigest(x.org),applicability:await ca.applicabilityDigest(x.org),
      outcome:await ca.outcome(x.org,ctl.app.stateId),treatment:await kt.history(x.org),risk:await k.k3.one(`select t::text from gov_repo.l15_governed_risk_states t where state_id='${f.r.stateId}'`),
      residual:await k.stateRow(x.org,res.stateId)});
    const before=await snapshot(),p=ac.proposal(res.stateId,until),a=await ac.accept(x,name(),p);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await ac.read(x.member,res.stateId)).acceptance_status,'ACCEPTED');
    assert.equal(await ca.outcome(x.org,ctl.app.stateId),'NOT_ASSESSED');
    const rev=ac.revocation(p,a.stateId),s=await ac.submit(x,name(),rev);await ac.decide(x,name(),s,rev,{outcome:'REVOKE'});
    assert.deepEqual(await snapshot(),before);
  });
  for (const change of ['treatment','assessment','applicability','definition','party'] as const) await t.test(`O49/O50 ${change} invalidation blocks acceptance validation without mutating prior acceptance`, async () => {
    const f = await fresh(), ctl = await control();
    const tr = await kt.treat(tx,name(),kt.proposal(tx,f.r.stateId));
    const p = { ...f.p,treatmentStateIds:[tr.stateId],controlAssessmentStateIds:[ctl.a.stateId] };
    const res = await k.assess(x,name(),p), at = await k.instant('0 seconds'), before = await k.stateRow(x.org,res.stateId);
    const accepted=await ac.accept(x,name(),ac.proposal(res.stateId,until)),acceptBefore=await ac.history(x.org);
    const beforeCutoff=await k.instant('0 seconds');
    const next=ac.proposal(res.stateId,until,{expectedCurrentStateId:accepted.stateId}),pending=await ac.submit(x,name(),next);
    let mutation = '';

    if (change==='treatment') {
      const q = { ...tr.proposal,expectedCurrentStateId:tr.stateId }, s = await kt.submit(tx,name(),q);
      mutation = kt.decideSql(x.treatment,{ commandId:x.cmd(name()),proposalId:s.proposal_id,proposal:q });
    }
    if (change==='assessment') {
      const q = ca.validateProposal(ctl.app.stateId), s = await ca.submit(base,base.member,name(),q);
      mutation = ca.decideSql(base.as,{ commandId:x.cmd(name()),proposalId:s.proposal_id,proposal:q,expected:ctl.a.stateId });
    }
    if (change==='applicability') {
      const q = ca.cak.validateProposal(ctl.app.target,ctl.app.pin,'DOES_NOT_APPLY'), s = await ca.cak.submit(base,base.member,name(),q);
      mutation = ca.cak.decideSql(base.cs,{ commandId:x.cmd(name()),proposalId:s.proposal_id,proposal:q,expected:ctl.app.stateId });
    }
    if (change==='definition') {
      const q = ca.cak.cdk.revokeProposal(ctl.app.pin.subject,ctl.app.pin.stateId), s = await ca.cak.cdk.submit(base as never,base.member,name(),q);
      mutation = ca.cak.cdk.decideSqlFor(base.steward,x.cmd(name()),s.proposal_id,q,'REVOKE',ctl.app.pin.stateId);
    }
    if (change==='party') {
      const q = kt.pk.revokeProposal(responsible.partyId,responsible.decided.registry_state_id,'PERSON'), s = await kt.pk.submit(party as never,base.member,name(),q);
      mutation = kt.pk.decideSql(party.steward,{ commandId:x.cmd(name()),proposalId:s.proposal_id,proposal:q,outcome:'REVOKE',expected:responsible.decided.registry_state_id });
    }
    const raced = await race(mutation,ac.decideSql(x.acceptor,{ commandId:x.cmd(name()),proposalId:pending.proposal_id,proposal:next }));
    assert.match(raced.second.err,/GV010/);
    assert.equal((await ac.read(x.member,res.stateId)).resolution,'DEPENDENCY_INVALID');
    assert.equal(await ac.history(x.org),acceptBefore);
    assert.equal((await ac.read(x.member,res.stateId,beforeCutoff,beforeCutoff)).resolution,'CURRENT');
    const rev=ac.revocation(next,accepted.stateId),s=await ac.submit(x,name(),rev);
    assert.equal((await ac.decide(x,name(),s,rev,{outcome:'REVOKE'})).outcome,'REVOKED');
  });
});
