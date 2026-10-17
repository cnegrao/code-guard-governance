import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { L15RiskAcceptanceProposalContent } from '@council/canonical-contracts';
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let response: { data: unknown; error: null | { message: string; code: string } } = { data: [], error: null };
mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: { rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args }); return response;
} } } });
let submitRiskAcceptanceProposal: typeof import('../lib/governance/l15-risk-acceptance-persistence').submitRiskAcceptanceProposal;
let decideRiskAcceptanceProposal: typeof import('../lib/governance/l15-risk-acceptance-persistence').decideRiskAcceptanceProposal;
let readRiskAcceptance: typeof import('../lib/governance/l15-risk-acceptance-persistence').readRiskAcceptance;
before(async () => {
  ({ submitRiskAcceptanceProposal, decideRiskAcceptanceProposal, readRiskAcceptance } = await import('../lib/governance/l15-risk-acceptance-persistence'));
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const principal = { organisationId: id(1), actorUserId: id(2), issuedAtSeconds: 1, expiresAtSeconds: 1000, credentialEpoch: '2026-01-01T00:00:00.000001Z' };
const proposal: L15RiskAcceptanceProposalContent = { intent:'VALIDATE', sourceClass:'LOCAL_HUMAN', residualAssessmentStateId:id(3), requestedEffectiveFrom:null,
  requestedValidUntil:'2030-01-01T00:00:00.000000Z', expectedCurrentStateId:null, targetStateId:null };
const support = { status: 'NONE', entries: [] } as const;
test('S6 acceptance adapter transmits all five verified principal values and typed proposal operands', async () => {
  response = { data: [{ outcome: 'SUBMITTED', proposal_id: id(6), control_pins: [] }], error: null };
  const result = await submitRiskAcceptanceProposal(principal, { commandId: 'test-submit', proposal, priorProposalId: null, support });
  assert.equal(result.proposalId, id(6));
  const call = calls.at(-1)!;
  assert.equal(call.name, 'l15_submit_risk_acceptance_proposal_v1');
  assert.deepEqual(Object.fromEntries(Object.entries(call.args).filter(([k]) => k.startsWith('p_verified_'))), {
    p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.actorUserId,
    p_verified_session_iat: 1, p_verified_session_exp: 1000, p_verified_credential_epoch: principal.credentialEpoch });
  assert.equal(call.args.p_requested_valid_until, proposal.requestedValidUntil);
  assert.equal(call.args.p_residual_assessment_state_id, proposal.residualAssessmentStateId);
  assert.match(call.args.p_caller_fingerprint as string, /^[a-f0-9]{64}$/);
});
test('S6 acceptance adapter treats durable DENY as result and maps exact decision reason', async () => {
  response = { data: [{ outcome: 'DENIED', deny_reason: 'NO_EFFECTIVE_AUTHORITY', state_id: null }], error: null };
  const result = await decideRiskAcceptanceProposal(principal, { commandId: 'test-decide', proposalId: id(6), proposal, outcome: 'VALIDATE', expectedCurrentStateId: null, support });
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.denyReason, 'NO_EFFECTIVE_AUTHORITY');
  assert.equal(calls.at(-1)!.args.p_reason_code, 'RISK_ACCEPTANCE_VALIDATED');
});
test('S6 acceptance adapter UNKNOWN exposes exact failing dependency, with no current state', async () => {
  response = { data: [{ acceptance_status: 'UNKNOWN', resolution: 'DEPENDENCY_INVALID', dependency_kind: 'RESIDUAL_RISK_ASSESSMENT', dependency_id: id(7), effective_at: 'at', recorded_cutoff: 'cutoff', current_state: null }], error: null };
  const result = await readRiskAcceptance(principal, { ...proposal, effectiveAt: null, recordedCutoff: null });
  assert.deepEqual(result, { status: 'UNKNOWN', resolution: 'DEPENDENCY_INVALID', failingDependency: { kind: 'RESIDUAL_RISK_ASSESSMENT', stateId: id(7) }, effectiveAt: 'at', recordedCutoff: 'cutoff', current: null });
});
test('S6 acceptance adapter preserves state lineage and exact residual pin in current read', async () => {
    response = { data: [{ acceptance_status: 'ACCEPTED', resolution: 'CURRENT', current_state: { state_id: id(11), predecessor_state_id: id(12), residual_assessment_state_id: id(3) } }], error: null };
  const result = await readRiskAcceptance(principal, { ...proposal, effectiveAt: null, recordedCutoff: null });
  assert.equal(result.current?.predecessorStateId, id(12));
  assert.equal(result.current?.residualAssessmentStateId, id(3));
});
test('S6 acceptance adapter propagates database errors and fails on missing or unknown read result', async () => {
  response = { data: null, error: { message: 'dependency invalid', code: 'GV010' } };
  await assert.rejects(readRiskAcceptance(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /dependency invalid/);
  response = { data: [], error: null };
  await assert.rejects(readRiskAcceptance(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /returned no row/);
  response = { data: [{ acceptance_status: 'verified' }], error: null };
  await assert.rejects(readRiskAcceptance(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /invalid current state/);
});
