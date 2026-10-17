import assert from 'node:assert/strict';
import { test } from 'node:test';
import { l14Cluster } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';
import { m17s5Kit } from '../helpers/m17-s5-fixtures';
import { residualRace } from '../helpers/m17-s6-concurrency';

test('S6 integrated shared regression: S4/S5 support and M16 applicability/assessment on post-S6 schema', { timeout:600_000 }, async t => {
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
  const support={status:'PRESENT',entries:[{tag:'DISCOVERY_EVIDENCE',targetId:x.evidence}]} as const;
  await t.test('S4 v1 assessment retains normalized support, replay, matrix authority and revocation',async()=>{
    const r=await k.risk(x,name(),'AGENT'),p=k.k4.rated(r.stateId,m,'L1','I1',until),label=name();
    const a=await k.k4.assess(x,label,p,{support,decideSupport:support});
    assert.equal(a.decided.rating_band,'CRITICAL');
    assert.equal((await k.k4.submit(x,label,p,{support})).replay,true);
    assert.equal((await k.k4.decide(x,label,a.submitted,p,{support})).replay,true);
    assert.equal((await k.k4.read(x.member,r.stateId)).assessment_status,'RATED');
    assert.equal(await k.one(`select count(*) from gov_repo.l15_support_links where organisation_id='${x.org}' and owner_kind='RISK_ASSESSMENT'`),'3');
    await k.k4.revokeAssessment(x,name(),r.stateId,m,a.stateId);
    assert.equal((await k.k4.read(x.member,r.stateId)).assessment_status,'UNKNOWN');
  });
  await t.test('S5 supported PLANNED to IMPLEMENTED successor, exact result lineage and revoke stay independent',async()=>{
    const r=await k.risk(x,name(),'AGENT'),p=kt.proposal(tx,r.stateId),label=name();
    const root=await kt.treat(tx,label,p,support);
    const next={...p,implementationStatus:'IMPLEMENTED' as const,expectedCurrentStateId:root.stateId},n=name();
    const implemented=await kt.treat(tx,n,next,support);
    assert.equal((await kt.read(x.member,p)).treatment_status,'IMPLEMENTED');
    assert.equal((await kt.decide(tx,n+'-decide',implemented.submitted,next,{support})).replay,true);
    assert.equal(implemented.decided.predecessor_state_id,root.stateId);
    const rev=kt.revocation(next,implemented.stateId),sub=await kt.submit(tx,name(),rev);
    assert.equal((await kt.decide(tx,name(),sub,rev,{outcome:'REVOKE',support})).outcome,'REVOKED');
    assert.equal((await kt.read(x.member,p)).treatment_status,'UNKNOWN');
  });
  await t.test('M16 applicability and assessment RPC lifecycles remain authoritative on post-S6 schema',async()=>{
    const ctl=await control('NOT_ASSESSED');assert.equal(await ca.outcome(x.org,ctl.app.stateId),'NOT_ASSESSED');
    const next=await ca.assess(base,name(),ctl.app.stateId,{outcome:'SATISFIED'});
    assert.equal(await ca.outcome(x.org,ctl.app.stateId),'SATISFIED');
    const q=ca.cak.validateProposal(ctl.app.target,ctl.app.pin,'DOES_NOT_APPLY'),sub=await ca.cak.submit(base,base.member,name(),q);
    const changed=await c.exec(ca.cak.decideSql(base.cs,{commandId:x.cmd(name()),proposalId:sub.proposal_id,proposal:q,expected:ctl.app.stateId}));
    assert.equal(changed.outcome,'VALIDATED');assert.ok(next.stateId);
    assert.equal(await ca.outcome(x.org,ctl.app.stateId),'UNKNOWN');
  });
});
