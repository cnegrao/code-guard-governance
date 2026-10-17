import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { L15GovernedRiskSubject } from '@council/canonical-contracts';
import { l14Cluster, type Actor } from '../helpers/m16-l14-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';
import { m17s5Kit, val } from '../helpers/m17-s5-fixtures';
import { lit, named } from '../helpers/m16-governed-write-fixtures';

test('S7A O68: all seven lifecycle states are deterministic and projection execution writes nothing',{timeout:600_000},async t=>{
  const c=await l14Cluster(m=>t.diagnostic(m),{horizon:'M17S7A'});t.after(()=>c.stop());
  const a=await acceptanceKit(c),x=await a.setup();
  const project=async(actor:Actor,subject:L15GovernedRiskSubject,scenario:string)=>c.exec(`select to_json(r) from gov_repo.l15_read_risk_projections_v1(${named({
    ...c.principal(actor),p_subject_type:lit(subject.subjectType),
    p_subject_canonical_kind:val(subject.subjectType==='CANONICAL_OBJECT'?subject.canonicalKind:null),
    p_subject_canonical_object_id:val(subject.subjectType==='CANONICAL_OBJECT'?subject.canonicalObjectId:null),
    p_subject_relationship_id:val(subject.subjectType==='RELATIONSHIP_STATE'?subject.relationshipId:null),
    p_subject_relationship_state_id:val(subject.subjectType==='RELATIONSHIP_STATE'?subject.relationshipStateId:null),
    p_scenario_definition_id:val(scenario,'uuid'),p_effective_at:'null::timestamptz',p_recorded_cutoff:'null::timestamptz'})}) r;`);
  const digest=()=>c.owner(`select md5(coalesce(string_agg(x,'|' order by x),'')) from (
    select 'g:'||t::text x from gov_repo.l15_governed_risk_states t union all
    select 'a:'||t::text from gov_repo.l15_risk_assessment_states t union all
    select 't:'||t::text from gov_repo.l15_risk_treatment_states t union all
    select 'x:'||t::text from gov_repo.l15_risk_acceptance_states t union all
    select 'f:'||t::text from gov_repo.l14_fact_states t) q`);

  const identified=await a.k.risk(x,'identified','AGENT_VERSION');
  assert.equal((await project(x.member,identified.subject,identified.scen.id)).lifecycle,'IDENTIFIED');

  const assessedRisk=await a.k.risk(x,'assessed','AGENT_VERSION'),m=await a.k.methodology(x,'assessed-method'),until=await a.k.instant('20 days');
  await a.k.k4.assess(x,'assessed-inherent',a.k.k4.insufficient(assessedRisk.stateId,m,until));
  assert.equal((await project(x.member,assessedRisk.subject,assessedRisk.scen.id)).lifecycle,'ASSESSED');

  const residual=await a.residual(x,'residual');
  assert.equal((await project(x.member,residual.risk.subject,residual.risk.scen.id)).lifecycle,'RESIDUAL_ASSESSED');
  await a.accept(x,'accepted',a.proposal(residual.stateId,residual.until));
  assert.equal((await project(x.member,residual.risk.subject,residual.risk.scen.id)).lifecycle,'RESIDUAL_ACCEPTED');

  const s5=await m17s5Kit(c),tx=await s5.setup(),treatedRisk=await s5.risk(tx,'treated');
  const plannedProposal=s5.proposal(tx,treatedRisk.stateId),planned=await s5.treat(tx,'planned',plannedProposal);
  assert.equal((await project(tx.member,treatedRisk.subject,treatedRisk.scen.id)).lifecycle,'TREATMENT_APPROVED');
  const implementedProposal={...plannedProposal,implementationStatus:'IMPLEMENTED' as const,expectedCurrentStateId:planned.stateId};
  await s5.treat(tx,'implemented',implementedProposal);
  assert.equal((await project(tx.member,treatedRisk.subject,treatedRisk.scen.id)).lifecycle,'TREATMENT_IMPLEMENTED');

  const closed=await a.k.risk(x,'closed','AGENT_VERSION');
  await a.k.k4.k3.revokeRisk(x,'closed-revoke',closed.subject,closed.scen,closed.stateId);
  assert.equal((await project(x.member,closed.subject,closed.scen.id)).lifecycle,'CLOSED');

  const before=await digest();
  for(const item of [identified,assessedRisk,residual.risk,closed]) await project(x.member,item.subject,item.scen.id);
  assert.equal(await digest(),before,'projection execution persists no row and mutates no authority state');
});
