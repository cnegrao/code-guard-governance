import assert from 'node:assert/strict';
import { test } from 'node:test';
import { s7dCluster, s7dSnapshot } from '../helpers/m17-s7d-fixtures';
import { m17s1Kit, objectSubject as hObject, relSubject as hRel, machineHypothesisSql } from '../helpers/m17-s1-fixtures';
import { m17s3Kit, objectSubject, relSubject } from '../helpers/m17-s3-fixtures';
import { acceptanceKit } from '../helpers/m17-s6-acceptance-fixtures';
import { m17s5Kit } from '../helpers/m17-s5-fixtures';
import { runL15LlmBoundaryStub } from '../../../../packages/graphos/src/governed/l15-risk-analysis';

test('S7D O71 hostile LLM output remains inert against the real final PG17 database and closed evidence union',
  {timeout:600_000},async t=>{
    const c=await s7dCluster(m=>t.diagnostic(m));t.after(()=>c.stop());
    const h=await m17s1Kit(c),g=await m17s3Kit(c),x=await g.setup();
    const subject=hObject('AGENT_VERSION',x.objects.AGENT_VERSION!);
    const signal=await c.exec(h.humanSignalSql(x.member,'llm-signal',subject,['DISCOVERY_EVIDENCE'],[x.evidence]));
    // A legitimate LLM_ASSISTED hypothesis cites an existing evidence-backed signal.
    const hypothesis=await h.run(h.machine,machineHypothesisSql({org:x.org,key:'llm-hypothesis',generator:'LLM_ASSISTED',subject,
      methodId:'S7D_STUB',methodVersion:'1',modelProvider:'deterministic',modelId:'hostile-stub',promptVersion:'1',signals:[signal.signal_id]}));
    assert.ok(hypothesis.hypothesis_id);
    const scenario=await g.scenario(x,'llm-boundary','OPERATIONAL',['AGENT_VERSION']);
    const p=g.proposalOf(objectSubject('AGENT_VERSION',x.objects.AGENT_VERSION!),scenario);
    const submitted=await g.submit(x,'llm-live-proposal',p);
    const before=await s7dSnapshot(c);
    for(const text of ['validated','accepted','closed'] as const) await t.test(text,async()=>{
      const output=runL15LlmBoundaryStub(text);
      assert.equal(output.output,text);assert.equal(output.governanceAction,'NONE');
      assert.equal(output.evidenceStorage,'PROHIBITED');assert.equal(output.decisionActor,'PROHIBITED');
      assert.deepEqual(await s7dSnapshot(c),before,'the real adapter causes zero DB mutations');
      // Raw DB operands deliberately bypass the TS mirror. Neither invented tags
      // nor raw LLM text masquerading as an existing evidence ID are admissible.
      await assert.rejects(c.exec(h.humanSignalSql(x.member,`llm-tag-${text}`,subject,['LLM_OUTPUT'],[text])),/SUPPORT_TAG_UNKNOWN/);
      await assert.rejects(c.exec(h.humanSignalSql(x.member,`llm-evidence-${text}`,subject,['DISCOVERY_EVIDENCE'],[text])),/SUPPORT_TARGET_UNRESOLVED/);
      const raw=g.decideSql(x.validator,{commandId:`llm-decision-${text}`,proposalId:submitted.proposal_id,proposal:p})
        .replace("p_outcome => 'VALIDATE'",`p_outcome => '${output.output}'`);
      await assert.rejects(c.exec(raw),/GV010/);
      await assert.rejects(h.machine(g.decideSql(x.validator,{commandId:`llm-machine-${text}`,proposalId:submitted.proposal_id,proposal:p})),/permission denied/);
      assert.deepEqual(await s7dSnapshot(c),before,'failed injection writes no proposal, authorization, decision, state, head, evidence or support');
    });
  });

test('S7D C-M17-01 exact scalar governance-use disposition, overlaps, DEFER, DENY, revocation and provenance-only citations',
  {timeout:600_000},async t=>{
    const c=await s7dCluster(m=>t.diagnostic(m));t.after(()=>c.stop());
    const h=await m17s1Kit(c),a=await acceptanceKit(c),k=a.k.k4,g=k.k3,rt=await m17s5Kit(c);
    const base=await k.setup({extra:()=>[...a.acceptanceRules(),...rt.pk.partyRules().filter(r=>r.permission.startsWith('L14_PARTY_'))]});
    const x={...base,acceptor:await c.mkUser(base.org,[a.roles.accept])};
    const subject=hObject('AGENT_VERSION',x.objects.AGENT_VERSION!),riskSubject=objectSubject('AGENT_VERSION',x.objects.AGENT_VERSION!);
    async function hypoth(key:string,s=subject) {
      const signal=await c.exec(h.humanSignalSql(x.member,`${key}-signal`,s,['DISCOVERY_EVIDENCE'],[x.evidence]));
      return c.exec(h.humanHypothesisSql(x.member,`${key}-hypothesis`,s,[signal.signal_id]));
    }
    const first=await hypoth('overlap'),fresh=await hypoth('fresh'),supportOnly=await hypoth('support-only');
    const support=(id:string)=>({status:'PRESENT' as const,entries:[{tag:'RISK_HYPOTHESIS' as const,targetId:id}]});
    const read=(s=subject,actor=x.member)=>h.json(h.dispositionsSql(actor,s),q=>c.sql(q,'service_role')) as Promise<any[]>;
    async function expect(id:string,value:string,s=subject) {
      const before=await s7dSnapshot(c),rows=await read(s);
      assert.equal(rows.find(row=>row.hypothesis_id===id)?.disposition,value);
      assert.ok(rows.every(row=>row.authority==='NON_AUTHORITATIVE'));
      assert.deepEqual(await s7dSnapshot(c),before,'disposition reads are zero-write across all L15/shared-envelope stores');
    }
    const hypothesisDigest=()=>c.owner(`select md5(string_agg(t::text,'|' order by hypothesis_id)) from gov_repo.l15_risk_hypotheses t where organisation_id='${x.org}'`);
    const originalHypotheses=await hypothesisDigest();
    const scen=await g.scenario(x,'disposition','OPERATIONAL',['AGENT_VERSION','AGENT','REL:READS_FROM']);
    const p=g.proposalOf(riskSubject,scen);
    await expect(first.hypothesis_id,'UNREVIEWED');
    const rejected=await g.submit(x,'reject',p,{support:support(first.hypothesis_id)});
    await g.decide(x,'reject',rejected,p,{outcome:'REJECT'});
    await expect(first.hypothesis_id,'CITED_BY_REJECTED_PROPOSAL');
    const live=await g.submit(x,'live',p,{support:support(first.hypothesis_id)});
    await expect(first.hypothesis_id,'CITED_BY_LIVE_PROPOSAL');
    // A denied REJECT attempt is not a terminal governance REJECT.
    const denied=await g.decide(x,'denied-reject',live,p,{outcome:'REJECT'},x.member);
    assert.equal(denied.outcome,'DENIED');await expect(first.hypothesis_id,'CITED_BY_LIVE_PROPOSAL');
    await g.decide(x,'defer',live,p,{outcome:'DEFER'});
    await expect(first.hypothesis_id,'CITED_BY_LIVE_PROPOSAL');
    const validated=await g.decide(x,'validate',live,p);
    assert.equal(validated.outcome,'VALIDATED');await expect(first.hypothesis_id,'CITED_BY_GOVERNED_RISK');
    const revokeProposal=g.proposalOf(riskSubject,scen,{intent:'REVOKE',targetStateId:validated.state_id,
      expectedCurrentStateId:validated.state_id,closureReason:'RISK_NO_LONGER_APPLICABLE'});
    const revokeSubmitted=await g.submit(x,'revoke',revokeProposal,{support:support(fresh.hypothesis_id)});
    await expect(fresh.hypothesis_id,'UNREVIEWED');
    await g.decide(x,'revoke',revokeSubmitted,revokeProposal,{outcome:'REVOKE'});
    await expect(first.hypothesis_id,'CITED_BY_GOVERNED_RISK');
    await expect(fresh.hypothesis_id,'UNREVIEWED');

    // Non-GOVERNED_RISK citations are provenance only, even after decisions/states.
    const risk=await k.risk(x,'provenance-risk'),m=await k.methodology(x,'provenance-method'),until=await k.instant('20 days');
    const inherent=await k.assess(x,'provenance-inherent',k.insufficient(risk.stateId,m,until),{support:support(supportOnly.hypothesis_id)});
    const party={...x,registrar:await c.mkUser(x.org,[rt.pk.registrarRole]),steward:await c.mkUser(x.org,[rt.pk.stewardRole]),flex:await c.mkUser(x.org,[rt.pk.flexRole])};
    const responsible=await rt.pk.validated(party as never,'provenance-party');
    const tx={...x,responsible},tp=rt.proposal(tx as never,risk.stateId);
    const ts=await rt.submit(tx as never,'provenance-treatment-submit',tp,{support:support(supportOnly.hypothesis_id)});
    assert.equal((await rt.decide(tx as never,'provenance-treatment-decide',ts,tp)).outcome,'VALIDATED');
    const residualProposal=a.k.proposal(risk.stateId,m,inherent.stateId,until);
    const residualSubmitted=await a.k.submit(x,'provenance-residual-submit',residualProposal,{support:support(supportOnly.hypothesis_id)});
    const residualDecision=await a.k.decide(x,'provenance-residual-decide',residualSubmitted,residualProposal);
    assert.equal(residualDecision.outcome,'VALIDATED');
    const residual={stateId:residualDecision.state_id as string};
    const ap=a.proposal(residual.stateId,await k.instant('10 days'));
    const asp=await a.submit(x as never,'provenance-acceptance-submit',ap,{support:support(supportOnly.hypothesis_id)});
    assert.equal((await a.decide(x as never,'provenance-acceptance-decide',asp,ap)).outcome,'VALIDATED');
    await expect(supportOnly.hypothesis_id,'UNREVIEWED');
    assert.equal(await hypothesisDigest(),originalHypotheses,'no disposition column/store or hypothesis mutation');

    // Another subject's legal citation must not poison an exact-subject read.
    const agentSubject=hObject('AGENT',x.objects.AGENT!),agent=await hypoth('agent',agentSubject);
    const agentP=g.proposalOf(objectSubject('AGENT',x.objects.AGENT!),scen);
    await g.submit(x,'agent-live',agentP,{support:support(agent.hypothesis_id)});
    await expect(agent.hypothesis_id,'CITED_BY_LIVE_PROPOSAL',agentSubject);
    await expect(fresh.hypothesis_id,'UNREVIEWED');
    assert.ok((await read()).every(row=>row.hypothesis_id!==agent.hypothesis_id),'no AGENT -> AGENT_VERSION inheritance');
    // Direct use is tracked by exact hypothesis ID. It must not be lost merely
    // because the citing risk targets another subject (support is not inheritance).
    await g.submit(x,'direct-cross-subject-use',agentP,{support:support(fresh.hypothesis_id)});
    await expect(fresh.hypothesis_id,'CITED_BY_LIVE_PROPOSAL');
    const rel=x.rels.READS_FROM!,relS=hRel(rel.relationshipId,rel.relationshipStateId),rh=await hypoth('relationship',relS);
    const rp=g.proposalOf(relSubject(rel),scen),rs=await g.submit(x,'relationship',rp,{support:support(rh.hypothesis_id)});
    await g.decide(x,'relationship-defer',rs,rp,{outcome:'DEFER'});
    await expect(rh.hypothesis_id,'CITED_BY_LIVE_PROPOSAL',relS);
    const sibling=x.rels.DERIVED_FROM!;
    assert.deepEqual(await read(hRel(sibling.relationshipId,sibling.relationshipStateId)),[]);
    const foreign=await g.setup();
    await assert.rejects(read(subject,foreign.member),/GV010|GV003/);
    await expect(first.hypothesis_id,'CITED_BY_GOVERNED_RISK');
  });
