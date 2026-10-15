import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { L15RiskTreatmentProposalContent as Proposal } from '@council/canonical-contracts';
import { checkRiskTreatmentProposal, submitRiskTreatmentProposalFingerprint, decideRiskTreatmentProposalFingerprint, riskTreatmentReasonCode } from '../src/l15-risk-treatment.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const proposal: Proposal = { intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', governedRiskStateId: id(1), treatmentOption: 'MITIGATE',
  treatmentOrdinalKey: 'main', responsibleGovernancePartyId: id(2), partyValidatedStateId: id(3), implementationStatus: 'PLANNED',
  targetImplementationDate: null, treatmentRevocationReason: null, controlDefinitionVersionIds: [], requestedEffectiveFrom: null,
  requestedEffectiveTo: null, expectedCurrentStateId: null, targetStateId: null };
const input = { organisationId: id(10), actorUserId: id(11), proposal, priorProposalId: null, support: { status: 'NONE', entries: [] } as const };
for (const option of ['ACCEPT','WAIVED','AVOIDANCE']) test(`S5 preflight rejects ${option}`, () => {
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, treatmentOption: option as never }), /TREATMENT_OPTION_UNKNOWN/);
});
for (const status of ['verified','failed','VALIDATED']) test(`S5 preflight rejects implementation status ${status}`, () => {
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, implementationStatus: status as never }), /IMPLEMENTATION_STATUS_UNKNOWN/);
});
test('S5 controls are a set for semantic fingerprint; duplicates rejected', () => {
  const a = { ...proposal, controlDefinitionVersionIds: [id(21),id(22)] };
  assert.equal(submitRiskTreatmentProposalFingerprint({ ...input, proposal: a }), submitRiskTreatmentProposalFingerprint({ ...input, proposal: { ...a, controlDefinitionVersionIds: [...a.controlDefinitionVersionIds].reverse() } }));
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, controlDefinitionVersionIds: [id(21),id(21)] }), /CONTROL_PINS_MALFORMED/);
});
test('S5 fingerprint binds exact key, party, planning metadata, pins, status, temporal intent and expectation', () => {
  const base = submitRiskTreatmentProposalFingerprint(input);
  for (const over of [{ governedRiskStateId: id(40) },{ treatmentOption: 'AVOID' as const },{ treatmentOrdinalKey: 'other' },
    { responsibleGovernancePartyId: id(41) },{ partyValidatedStateId: id(42) },{ targetImplementationDate: '2027-01-01' },
    { controlDefinitionVersionIds: [id(43)] },{ implementationStatus: 'IMPLEMENTED' as const },{ requestedEffectiveFrom: '2027-01-01T00:00:00.000000Z' },
    { requestedEffectiveTo: '2028-01-01T00:00:00.000000Z' },{ expectedCurrentStateId: id(44) }]) {
    assert.notEqual(submitRiskTreatmentProposalFingerprint({ ...input, proposal: { ...proposal, ...over } }), base);
  }
});
test('S5 non-MITIGATE controls and non-human source rejected', () => {
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, treatmentOption: 'TRANSFER', controlDefinitionVersionIds: [id(21)] }), /CONTROL_PINS_NOT_PERMITTED/);
  for (const sourceClass of ['SYSTEM_SEED','SOURCE_CONNECTION']) assert.throws(() => checkRiskTreatmentProposal({ ...proposal, sourceClass: sourceClass as never }), /NOT_ADMISSIBLE/);
});
test('S5 revocation content and closed reasons', () => {
  const rev: Proposal = { ...proposal, intent: 'REVOKE', implementationStatus: null, treatmentRevocationReason: 'TREATMENT_FAILED', expectedCurrentStateId: id(30), targetStateId: id(30) };
  assert.doesNotThrow(() => checkRiskTreatmentProposal(rev));
  assert.throws(() => checkRiskTreatmentProposal({ ...rev, targetStateId: null }), /REVOCATION_CONTENT_INVALID/);
  assert.throws(() => checkRiskTreatmentProposal({ ...rev, treatmentRevocationReason: 'OTHER' as never }), /TREATMENT_REVOCATION_REASON_UNKNOWN/);
});
test('S5 decision fingerprint binds decision support, action and explicit expectation', () => {
  const i = { ...input, outcome: 'VALIDATE' as const, proposalId: id(30), expectedCurrentStateId: null };
  const base = decideRiskTreatmentProposalFingerprint(i);
  assert.notEqual(decideRiskTreatmentProposalFingerprint({ ...i, outcome: 'DEFER' }), base);
  assert.notEqual(decideRiskTreatmentProposalFingerprint({ ...i, expectedCurrentStateId: id(31) }), base);
  assert.notEqual(decideRiskTreatmentProposalFingerprint({ ...i, support: { status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: 'evidence:1' }] } }), base);
  assert.equal(riskTreatmentReasonCode('REVOKE'), 'RISK_TREATMENT_REVOKED');
});
test('S5 instant and key shape are canonical', () => {
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, treatmentOrdinalKey: ' ' }), /ORDINAL_KEY_INVALID/);
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, requestedEffectiveFrom: '2027-01-01' }), /INSTANT_NOT_CANONICAL/);
  assert.throws(() => checkRiskTreatmentProposal({ ...proposal, targetImplementationDate: '2027-02-30' }), /TARGET_DATE_INVALID/);
});
