import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { l14Cluster, lastLine } from '../helpers/m16-l14-fixtures';
import { controlAssessmentKit } from '../helpers/m16-l14-control-assessment-fixtures';
import { m17s6Kit } from '../helpers/m17-s6-fixtures';
import { m17s5Kit } from '../helpers/m17-s5-fixtures';
import { residualRace } from '../helpers/m17-s6-concurrency';

test('S6 O38-O43 exact dependency sets, transitive causes, historical cutoff and no M16 mutation', { timeout:600_000 }, async t => {
  const c = await l14Cluster(m => t.diagnostic(m), { horizon:'M17S6' }); t.after(() => c.stop());
  const k = await m17s6Kit(c), ca = await controlAssessmentKit(c), kt = await m17s5Kit(c, ca.cak.cdk);
  const base = await ca.setup(), objects = base.objects.byKind as Record<string,string>;
  const rels = { READS_FROM:base.rels.reads, EXPOSES:base.rels.exposes };
  const attached = await k.k3.attach(base as never, [...ca.rules(base.objects,base.rels), ...k.k4.raRules(objects,rels),
    ...kt.pk.partyRules().filter(r => r.permission.startsWith('L14_PARTY_'))], objects, rels);
  const x = { ...attached, assessor:await c.mkUser(base.org,[k.k4.roles.ra]), raDater:await c.mkUser(base.org,[k.k4.roles.raDating]),
    methodologyAdmitter:await c.mkUser(base.org,[k.s2.roles.methodologyAdmit]), methodologyValidator:await c.mkUser(base.org,[k.s2.roles.methodologyValidate]),
    methodologyDater:await c.mkUser(base.org,[k.s2.roles.dating]), treatment:await c.mkUser(base.org,[k.k3.roles.treatment]) } as Awaited<ReturnType<typeof k.setup>>;
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
  await t.test('O39/O83 missing inherent cannot be replaced by evidence; foreign risk and unknown control are rejected', async () => {
    const f = await fresh(), other = await fresh();
    const tr = await kt.treat(tx,name(),kt.proposal(tx,other.r.stateId));
    await c.rejects(k.submit(x,name(),f.p,{ fingerprint:'b'.repeat(64), rawPins:`p_inherent_assessment_state_id => null::uuid,
      p_methodology_validated_state_id => '${m.stateId}'::uuid, p_treatment_state_ids => '{}'::uuid[], p_control_assessment_state_ids => '{}'::uuid[]`,
      support:{ status:'PRESENT', entries:[{ tag:'DISCOVERY_EVIDENCE',targetId:x.evidence }] } }), 'GV010');
    await c.rejects(k.submit(x,name(),{ ...f.p,treatmentStateIds:[tr.stateId] }), 'GV010');
    await c.rejects(k.submit(x,name(),{ ...f.p,controlAssessmentStateIds:[randomUUID()] }), 'GV010');
    await k.k4.revokeAssessment(x,name(),f.r.stateId,m,f.i.stateId);
    await c.rejects(k.submit(x,name(),f.p), 'GV010');
  });
  await t.test('normalized sets, permutation replay, PLANNED and NOT_ASSESSED keep their actual meanings; M16 unchanged', async () => {
    const f = await fresh(), ctl = await control('NOT_ASSESSED');
    const a = await kt.treat(tx,name(),kt.proposal(tx,f.r.stateId,{ treatmentOrdinalKey:'a' }));
    const b = await kt.treat(tx,name(),kt.proposal(tx,f.r.stateId,{ treatmentOrdinalKey:'b' }));
    const p = { ...f.p,treatmentStateIds:[a.stateId,b.stateId],controlAssessmentStateIds:[ctl.a.stateId] };
    const before = await ca.factDigest(x.org), appBefore = await ca.applicabilityDigest(x.org);
    const label = name(), res = await k.assess(x,label,p);
    assert.equal((await k.submit(x,`${label}-submit`,{ ...p,treatmentStateIds:[b.stateId,a.stateId] })).replay,true);
    assert.equal((await k.decide(x,`${label}-decide`,res.submitted,{ ...p,treatmentStateIds:[b.stateId,a.stateId] })).replay,true);
    const read = await k.read(x.member,f.r.stateId);
    assert.equal(read.resolution,'CURRENT'); assert.deepEqual(read.current_state.treatment_state_ids,[a.stateId,b.stateId].sort());
    assert.equal(await ca.factDigest(x.org),before); assert.equal(await ca.applicabilityDigest(x.org),appBefore);
    assert.equal(await ca.outcome(x.org,ctl.app.stateId),'NOT_ASSESSED');
    assert.equal((await kt.read(x.member,a.proposal)).treatment_status,'PLANNED');
    for (const field of ['coverage','mitigation','effectiveness','residual_risk_score']) assert.ok(!(field in read.current_state));
    const pins = await k.json(`select json_build_object('p',(select count(*) from gov_repo.l15_risk_assessment_proposal_treatment_pins where proposal_id='${res.submitted.proposal_id}'),
      's',(select count(*) from gov_repo.l15_risk_assessment_state_treatment_pins where state_id='${res.stateId}'))`);
    assert.deepEqual(pins,{ p:2,s:2 });
    await assert.rejects(c.owner(`insert into gov_repo.l15_risk_assessment_state_treatment_pins
      select organisation_id,'${res.stateId}',state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key
      from gov_repo.l15_risk_treatment_states where state_id='${a.stateId}'`),/PIN_OWNER_NOT_IN_TRANSACTION/);
    // Same counts, different exact sets: all rows pass their local FK/owner guards, but COMMIT must reject.
    const session = c.session('postgres');
    try {
      await session.run('begin;');
      const q = { ...f.p,expectedCurrentStateId:res.stateId,likelihoodLevelCode:'L2' };
      const submitted = await session.run(k.submitSql(x.member,{ commandId:x.cmd(name()),proposal:q }));
      assert.equal(submitted.err,'',submitted.err); const pid = JSON.parse(lastLine(submitted.out)).proposal_id;
      const decided = await session.run(k.decideSql(x.assessor,{ commandId:x.cmd(name()),proposalId:pid,proposal:q }));
      assert.equal(decided.err,'',decided.err); const sid = JSON.parse(lastLine(decided.out)).state_id;
      for (const [store,owner,pin] of [['proposal',pid,a.stateId],['state',sid,b.stateId]]) {
        const inserted = await session.run(`insert into gov_repo.l15_risk_assessment_${store}_treatment_pins
          select organisation_id,'${owner}',state_id,governed_risk_state_id,treatment_option,treatment_ordinal_key
          from gov_repo.l15_risk_treatment_states where state_id='${pin}';`);
        assert.equal(inserted.err,'',inserted.err);
      }
      assert.match((await session.run('commit;')).err,/RESIDUAL_PIN_SET_MISMATCH/);
    } finally { await session.run('rollback;'); await session.close(); }
  });
  await t.test('dependency expiry is DEPENDENCY_INVALID at the exact boundary, not own EXPIRED',async () => {
    const f=await fresh(), end=await k.instant('1 day');
    const i=await k.k4.assess(x,name(),{ ...f.i.proposal,expectedCurrentStateId:f.i.stateId,requestedValidUntil:end });
    await k.assess(x,name(),{ ...f.p,inherentAssessmentStateId:i.stateId });
    const read=await k.read(x.member,f.r.stateId,end);
    assert.equal(read.resolution,'DEPENDENCY_INVALID'); assert.equal(read.cause_resolution,'EXPIRED');
    assert.equal(read.dependency_id,i.stateId);
  });
  for (const change of ['inherent','treatment','assessment','applicability','definition','party'] as const) await t.test(`O40-O42 ${change}: exact failing pin/cause, immutable residual and historical CURRENT`, async () => {
    const f = await fresh(), ctl = await control();
    const tr = await kt.treat(tx,name(),kt.proposal(tx,f.r.stateId));
    const p = { ...f.p,treatmentStateIds:[tr.stateId],controlAssessmentStateIds:[ctl.a.stateId] };
    const res = await k.assess(x,name(),p), at = await k.instant('0 seconds'), before = await k.stateRow(x.org,res.stateId);
    const next = { ...p,likelihoodLevelCode:'L2',expectedCurrentStateId:res.stateId }, pending = await k.submit(x,name(),next);
    let mutation = '';
    if (change==='inherent') {
      const q = { ...f.i.proposal,likelihoodLevelCode:'L2',expectedCurrentStateId:f.i.stateId }, s = await k.k4.submit(x,name(),q);
      mutation = k.k4.decideSql(x.assessor,{ commandId:x.cmd(name()),proposalId:s.proposal_id,proposal:q });
    }
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
    const raced = await race(mutation,k.decideSql(x.assessor,{ commandId:x.cmd(name()),proposalId:pending.proposal_id,proposal:next }));
    assert.match(raced.second.err,/GV010/);
    const read = await k.read(x.member,f.r.stateId);
    const expected = change==='inherent' ? ['INHERENT_RISK_ASSESSMENT',f.i.stateId] :
      ['treatment','party'].includes(change) ? ['RISK_TREATMENT',tr.stateId] : ['CONTROL_ASSESSMENT',ctl.a.stateId];
    assert.equal(read.resolution,'DEPENDENCY_INVALID'); assert.equal(read.assessment_status,'UNKNOWN'); assert.equal(read.current_state,null);
    assert.deepEqual([read.dependency_kind,read.dependency_id],expected);
    if (change==='definition') assert.deepEqual([read.cause_kind,read.cause_id],['CONTROL_DEFINITION',ctl.app.pin.stateId]);
    if (change==='applicability') assert.deepEqual([read.cause_kind,read.cause_id,read.cause_resolution],['CONTROL_APPLICABILITY',ctl.app.stateId,'SUPERSEDED']);
    if (change==='party') assert.deepEqual([read.cause_kind,read.cause_id],['GOVERNANCE_PARTY',responsible.decided.registry_state_id]);
    assert.equal((await k.read(x.member,f.r.stateId,at,at)).resolution,'CURRENT');
    assert.equal(await k.stateRow(x.org,res.stateId),before);
    assert.equal((await k.read(x.member,f.r.stateId,until)).resolution,'EXPIRED');
  });
});
