import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { L15ResidualRiskAssessmentProposalContent } from '@council/canonical-contracts';
const calls: Array<{ name:string; args:Record<string,unknown> }> = [];
let response: { data:unknown; error:null|{ message:string; code:string } } = { data:[],error:null };
mock.module('../lib/governance/persistence',{ namedExports:{ privilegedDb:{ rpc:async (name:string,args:Record<string,unknown>) => {
  calls.push({ name,args }); return response;
} } } });
let adapter: typeof import('../lib/governance/l15-residual-risk-assessment-persistence');
before(async () => { adapter = await import('../lib/governance/l15-residual-risk-assessment-persistence'); });
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const principal = { organisationId:id(1),actorUserId:id(2),issuedAtSeconds:1,expiresAtSeconds:1000,credentialEpoch:'2026-01-01T00:00:00.000001Z' };
const proposal: L15ResidualRiskAssessmentProposalContent = { intent:'VALIDATE',sourceClass:'LOCAL_HUMAN',governedRiskStateId:id(3),assessmentBasis:'RESIDUAL',
  methodologyId:id(4),methodologyVersionId:id(5),methodologyContentHash:'a'.repeat(64),methodologyValidatedStateId:id(6),inherentAssessmentStateId:id(7),
  treatmentStateIds:[id(8)],controlAssessmentStateIds:[id(9)],assessmentOutcome:'RATED',likelihoodLevelCode:'L1',impactLevelCode:'I1',
  requestedEffectiveFrom:null,requestedValidUntil:'2030-01-01T00:00:00.000000Z',expectedCurrentStateId:null,targetStateId:null };
const support = { status:'NONE',entries:[] } as const;
test('S6 submit transmits verified principal and every exact pin to v2',async () => {
  response = { data:[{ outcome:'SUBMITTED',proposal_id:id(10),assessment_basis:'RESIDUAL' }],error:null };
  const result = await adapter.submitResidualRiskAssessmentProposal(principal,{ commandId:'submit',proposal,priorProposalId:null,support });
  assert.equal(result.proposalId,id(10)); assert.equal(result.assessmentBasis,'RESIDUAL');
  const call = calls.at(-1)!; assert.equal(call.name,'l15_submit_risk_assessment_proposal_v2');
  assert.deepEqual(Object.fromEntries(Object.entries(call.args).filter(([k]) => k.startsWith('p_verified_'))), {
    p_verified_organisation_id:id(1),p_verified_actor_user_id:id(2),p_verified_session_iat:1,p_verified_session_exp:1000,p_verified_credential_epoch:principal.credentialEpoch });
  assert.equal(call.args.p_inherent_assessment_state_id,id(7)); assert.equal(call.args.p_methodology_validated_state_id,id(6));
  assert.deepEqual(call.args.p_treatment_state_ids,[id(8)]); assert.deepEqual(call.args.p_control_assessment_state_ids,[id(9)]);
});
test('S6 decide preserves shared RPC and durable DENY',async () => {
  response = { data:[{ outcome:'DENIED',deny_reason:'NO_EFFECTIVE_AUTHORITY' }],error:null };
  const r = await adapter.decideResidualRiskAssessmentProposal(principal,{ commandId:'decide',proposalId:id(10),proposal,outcome:'VALIDATE',expectedCurrentStateId:null,support });
  assert.equal(r.outcome,'DENIED'); assert.equal(r.denyReason,'NO_EFFECTIVE_AUTHORITY');
  assert.equal(calls.at(-1)!.name,'l15_decide_risk_assessment_proposal_v1');
});
test('S6 read preserves transitive cause and both coordinates',async () => {
  response = { data:[{ assessment_status:'UNKNOWN',resolution:'DEPENDENCY_INVALID',dependency_kind:'CONTROL_ASSESSMENT',dependency_id:id(9),
    cause_kind:'CONTROL_DEFINITION',cause_id:id(11),cause_resolution:'NOT_CURRENT',effective_at:'at',recorded_cutoff:'cutoff',current_state:null }],error:null };
  const r = await adapter.readResidualRiskAssessment(principal,{ governedRiskStateId:id(3),effectiveAt:null,recordedCutoff:null });
  assert.deepEqual(r,{ status:'UNKNOWN',resolution:'DEPENDENCY_INVALID',dependencyKind:'CONTROL_ASSESSMENT',dependencyId:id(9),
    causeKind:'CONTROL_DEFINITION',causeId:id(11),causeResolution:'NOT_CURRENT',effectiveAt:'at',recordedCutoff:'cutoff',current:null });
});
test('S6 adapter propagates SQLSTATE and fails when read has no row',async () => {
  response = { data:null,error:{ message:'invalid pin',code:'GV010' } };
  await assert.rejects(adapter.readResidualRiskAssessment(principal,{ governedRiskStateId:id(3),effectiveAt:null,recordedCutoff:null }),/invalid pin/);
  response = { data:[],error:null };
  await assert.rejects(adapter.readResidualRiskAssessment(principal,{ governedRiskStateId:id(3),effectiveAt:null,recordedCutoff:null }),/returned no row/);
});
