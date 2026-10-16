import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {L15RiskAcceptanceProposalContent as Proposal} from '@council/canonical-contracts';
import {checkRiskAcceptanceProposal,submitRiskAcceptanceProposalFingerprint as submit,decideRiskAcceptanceProposalFingerprint as decide,riskAcceptanceReasonCode} from '../src/l15-risk-acceptance.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const p:Proposal={intent:'VALIDATE',sourceClass:'LOCAL_HUMAN',residualAssessmentStateId:id(1),requestedEffectiveFrom:null,requestedValidUntil:'2030-01-01T00:00:00.000000Z',expectedCurrentStateId:null,targetStateId:null};
const base={organisationId:id(2),actorUserId:id(3),proposal:p,priorProposalId:null,support:{status:'NONE',entries:[]} as const};
test('acceptance fingerprint binds exact target, period, expectation, prior, support and actor',()=>{
  const original=submit(base);assert.match(original,/^[a-f0-9]{64}$/);
  for(const proposal of [{...p,residualAssessmentStateId:id(4)},{...p,requestedValidUntil:'2029-01-01T00:00:00.000000Z'},
    {...p,requestedEffectiveFrom:'2028-01-01T00:00:00.000000Z'},{...p,expectedCurrentStateId:id(5)}]) assert.notEqual(submit({...base,proposal}),original);
  assert.notEqual(submit({...base,priorProposalId:id(6)}),original);assert.notEqual(submit({...base,actorUserId:id(7)}),original);
  const entries=[{tag:'DISCOVERY_EVIDENCE' as const,targetId:'e-a'},{tag:'DISCOVERY_EVIDENCE' as const,targetId:'e-b'}];
  assert.equal(submit({...base,support:{status:'PRESENT',entries}}),submit({...base,support:{status:'PRESENT',entries:[...entries].reverse()}}));
  assert.notEqual(submit({...base,support:{status:'PRESENT',entries}}),original);
});
test('acceptance excludes malformed periods, non-human sources and missing exact residual',()=>{
  for(const patch of [{requestedValidUntil:null},{residualAssessmentStateId:null},{sourceClass:'SOURCE_CONNECTION'},
    {requestedEffectiveFrom:p.requestedValidUntil},{requestedValidUntil:'2030-01-01'},
    {intent:'REVOKE',requestedValidUntil:null,targetStateId:id(9),expectedCurrentStateId:id(8)}])
    assert.throws(()=>checkRiskAcceptanceProposal({...p,...patch} as Proposal));
});
test('decision reasons and fingerprints preserve action and revoke target',()=>{
  assert.deepEqual(['VALIDATE','REJECT','DEFER','REVOKE'].map(o=>riskAcceptanceReasonCode(o as never)),
    ['RISK_ACCEPTANCE_VALIDATED','RISK_ACCEPTANCE_REJECTED','RISK_ACCEPTANCE_DEFERRED','RISK_ACCEPTANCE_REVOKED']);
  const d={...base,proposalId:id(8),expectedCurrentStateId:null,outcome:'VALIDATE' as const};
  assert.notEqual(decide(d),decide({...d,outcome:'REJECT'}));
  const rev={...p,intent:'REVOKE' as const,requestedValidUntil:null,expectedCurrentStateId:id(9),targetStateId:id(9)};
  assert.notEqual(decide({...d,proposal:rev,outcome:'REVOKE',expectedCurrentStateId:id(9)}),decide(d));
});
