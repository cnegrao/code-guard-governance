import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { L15ResidualRiskAssessmentProposalContent as Proposal } from '@council/canonical-contracts';
import { checkResidualRiskAssessmentProposal, submitResidualRiskAssessmentProposalFingerprint as submit,
  decideResidualRiskAssessmentProposalFingerprint as decide } from '../src/index.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const p: Proposal = { intent:'VALIDATE', sourceClass:'LOCAL_HUMAN', assessmentBasis:'RESIDUAL', governedRiskStateId:id(1),
  methodologyId:id(2), methodologyVersionId:id(3), methodologyContentHash:'a'.repeat(64), methodologyValidatedStateId:id(4),
  inherentAssessmentStateId:id(5), treatmentStateIds:[id(6),id(7)], controlAssessmentStateIds:[id(8),id(9)],
  assessmentOutcome:'RATED', likelihoodLevelCode:'L1', impactLevelCode:'I1', requestedEffectiveFrom:null,
  requestedValidUntil:'2030-01-01T00:00:00.000000Z', expectedCurrentStateId:null, targetStateId:null };
const args = { organisationId:id(10), actorUserId:id(11), priorProposalId:null, support:{ status:'NONE', entries:[] } as const };
const fp = (proposal: Proposal) => submit({ ...args, proposal });
const dfp = (proposal: Proposal) => decide({ ...args, proposal, proposalId:id(12), outcome:'VALIDATE', expectedCurrentStateId:null });
test('S6 pin order is immaterial for submit and decide identity', () => {
  const shuffled = { ...p, treatmentStateIds:[...p.treatmentStateIds].reverse(), controlAssessmentStateIds:[...p.controlAssessmentStateIds].reverse() };
  assert.equal(fp(p), fp(shuffled)); assert.equal(dfp(p), dfp(shuffled));
  for (const delta of [{ inherentAssessmentStateId:id(20) }, { methodologyValidatedStateId:id(20) },
    { treatmentStateIds:[id(20),id(7)] }, { controlAssessmentStateIds:[id(20),id(9)] }]) {
    assert.notEqual(fp(p), fp({ ...p, ...delta })); assert.notEqual(dfp(p), dfp({ ...p, ...delta }));
  }
});
test('S6 empty sets and insufficient evidence are legal; required pins and duplicate sets are rejected', () => {
  assert.doesNotThrow(() => checkResidualRiskAssessmentProposal({ ...p, treatmentStateIds:[], controlAssessmentStateIds:[],
    assessmentOutcome:'INSUFFICIENT_EVIDENCE', likelihoodLevelCode:null, impactLevelCode:null }));
  for (const delta of [{ inherentAssessmentStateId:null }, { methodologyValidatedStateId:null },
    { treatmentStateIds:[id(6),id(6)] }, { controlAssessmentStateIds:null }, { controlAssessmentStateIds:[null] }])
    assert.throws(() => checkResidualRiskAssessmentProposal({ ...p, ...delta } as Proposal));
});
test('S6 cannot replace the exact inherent pin with support or bypass S4 rating shape', () => {
  assert.throws(() => submit({ ...args, proposal:{ ...p, inherentAssessmentStateId:null } as unknown as Proposal,
    support:{ status:'PRESENT', entries:[{ tag:'DISCOVERY_EVIDENCE', targetId:'evidence:1' }] } }));
  for (const delta of [{ requestedValidUntil:null }, { likelihoodLevelCode:null }, { sourceClass:'SOURCE_CONNECTION' }, { assessmentBasis:'INHERENT' }])
    assert.throws(() => checkResidualRiskAssessmentProposal({ ...p, ...delta } as Proposal));
});
