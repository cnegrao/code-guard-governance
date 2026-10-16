import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { L15RiskTreatmentProposalContent } from '@council/canonical-contracts';
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let response: { data: unknown; error: null | { message: string; code: string } } = { data: [], error: null };
mock.module('../lib/governance/persistence', { namedExports: { privilegedDb: { rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args }); return response;
} } } });
let submitRiskTreatmentProposal: typeof import('../lib/governance/l15-risk-treatment-persistence').submitRiskTreatmentProposal;
let decideRiskTreatmentProposal: typeof import('../lib/governance/l15-risk-treatment-persistence').decideRiskTreatmentProposal;
let readRiskTreatment: typeof import('../lib/governance/l15-risk-treatment-persistence').readRiskTreatment;
before(async () => {
  ({ submitRiskTreatmentProposal, decideRiskTreatmentProposal, readRiskTreatment } = await import('../lib/governance/l15-risk-treatment-persistence'));
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const principal = { organisationId: id(1), actorUserId: id(2), issuedAtSeconds: 1, expiresAtSeconds: 1000, credentialEpoch: '2026-01-01T00:00:00.000001Z' };
const proposal: L15RiskTreatmentProposalContent = { intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', governedRiskStateId: id(3), treatmentOption: 'MITIGATE',
  treatmentOrdinalKey: 'main', responsibleGovernancePartyId: id(4), partyValidatedStateId: id(5), implementationStatus: 'PLANNED',
  targetImplementationDate: '2030-01-01', treatmentRevocationReason: null, controlDefinitionVersionIds: [], requestedEffectiveFrom: null,
  requestedEffectiveTo: null, expectedCurrentStateId: null, targetStateId: null };
const support = { status: 'NONE', entries: [] } as const;
test('S5 adapter transmits all five verified principal values and typed proposal operands', async () => {
  response = { data: [{ outcome: 'SUBMITTED', proposal_id: id(6), control_pins: [] }], error: null };
  const result = await submitRiskTreatmentProposal(principal, { commandId: 'test-submit', proposal, priorProposalId: null, support });
  assert.equal(result.proposalId, id(6));
  const call = calls.at(-1)!;
  assert.equal(call.name, 'l15_submit_risk_treatment_proposal_v1');
  assert.deepEqual(Object.fromEntries(Object.entries(call.args).filter(([k]) => k.startsWith('p_verified_'))), {
    p_verified_organisation_id: principal.organisationId, p_verified_actor_user_id: principal.actorUserId,
    p_verified_session_iat: 1, p_verified_session_exp: 1000, p_verified_credential_epoch: principal.credentialEpoch });
  assert.equal(call.args.p_target_implementation_date, '2030-01-01');
  assert.equal(call.args.p_requested_effective_to, null);
  assert.match(call.args.p_caller_fingerprint as string, /^[a-f0-9]{64}$/);
});
test('S5 adapter treats durable DENY as result and maps exact decision reason', async () => {
  response = { data: [{ outcome: 'DENIED', deny_reason: 'NO_EFFECTIVE_AUTHORITY', state_id: null }], error: null };
  const result = await decideRiskTreatmentProposal(principal, { commandId: 'test-decide', proposalId: id(6), proposal, outcome: 'VALIDATE', expectedCurrentStateId: null, support });
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.denyReason, 'NO_EFFECTIVE_AUTHORITY');
  assert.equal(calls.at(-1)!.args.p_reason_code, 'RISK_TREATMENT_VALIDATED');
});
test('S5 adapter UNKNOWN exposes exact failing dependency, with no current state', async () => {
  response = { data: [{ treatment_status: 'UNKNOWN', resolution: 'CONTROL_DEFINITION_DEPENDENCY_INVALID', dependency_kind: 'CONTROL_DEFINITION', dependency_id: id(7), effective_at: 'at', recorded_cutoff: 'cutoff', current_state: null }], error: null };
  const result = await readRiskTreatment(principal, { ...proposal, effectiveAt: null, recordedCutoff: null });
  assert.deepEqual(result, { status: 'UNKNOWN', resolution: 'CONTROL_DEFINITION_DEPENDENCY_INVALID', failingDependency: { kind: 'CONTROL_DEFINITION', stateId: id(7) }, effectiveAt: 'at', recordedCutoff: 'cutoff', current: null });
});
test('S5 adapter preserves state lineage and normalized control pins in current read', async () => {
  const pins = [{ controlDefinitionId: id(8), controlDefinitionVersionId: id(9), contentHash: 'a'.repeat(64), validatedStateId: id(10) }];
  response = { data: [{ treatment_status: 'IMPLEMENTED', resolution: 'CURRENT', current_state: { state_id: id(11), predecessor_state_id: id(12), control_pins: pins } }], error: null };
  const result = await readRiskTreatment(principal, { ...proposal, effectiveAt: null, recordedCutoff: null });
  assert.equal(result.current?.predecessorStateId, id(12));
  assert.deepEqual(result.current?.controlPins, pins);
});
test('S5 adapter propagates database errors and fails on missing or unknown read result', async () => {
  response = { data: null, error: { message: 'dependency invalid', code: 'GV010' } };
  await assert.rejects(readRiskTreatment(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /dependency invalid/);
  response = { data: [], error: null };
  await assert.rejects(readRiskTreatment(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /returned no row/);
  response = { data: [{ treatment_status: 'verified' }], error: null };
  await assert.rejects(readRiskTreatment(principal, { ...proposal, effectiveAt: null, recordedCutoff: null }), /invalid current state/);
});
