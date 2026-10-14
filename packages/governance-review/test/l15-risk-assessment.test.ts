import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { L15InherentRiskAssessmentProposalContent, L15RiskAssessmentSupport } from '@council/canonical-contracts';
import {
  checkRiskAssessmentProposal, decideRiskAssessmentProposalFingerprint, frameIdentity, riskAssessmentReasonCode,
  riskAssessmentSupportParts, submitRiskAssessmentProposalFingerprint,
} from '../src/index.ts';

/**
 * M17-S4 RISK_ASSESSMENT mirror tests. The golden fingerprints below are ALSO asserted against PostgreSQL
 * (gov_repo.l14_sha256_frame_v1 over the RPC frame + gov_repo.l15_governed_risk_support_parts_v1) in
 * apps/dashboard/tests/postgres-m16/m17-s4-risk-assessment.test.ts, and every PG17 RPC call uses these functions (GV008 on a
 * mismatch), so both sides are pinned to the same bytes. The mirror is preflight UX only: it derives no band, resolves no
 * dependency and grants nothing.
 */
export const ORG = '00000000-0000-4000-8000-000000000041';
export const ACTOR = '00000000-0000-4000-8000-000000000042';
export const RISK = '00000000-0000-4000-8000-0000000000d1';
export const MID = '00000000-0000-4000-8000-0000000000d2';
export const MVID = '00000000-0000-4000-8000-0000000000d3';
export const PROPOSAL = '00000000-0000-4000-8000-0000000000d4';
export const STATE = '00000000-0000-4000-8000-0000000000d5';
export const HASH = 'd'.repeat(64);
export const GOLDEN_SUPPORT: L15RiskAssessmentSupport = { status: 'PRESENT', entries: [
  { tag: 'RISK_HYPOTHESIS', targetId: '00000000-0000-4000-8000-0000000000e1' }, { tag: 'DISCOVERY_EVIDENCE', targetId: 'evidence:golden-s4' }] };
const NONE: L15RiskAssessmentSupport = { status: 'NONE', entries: [] };
export const GOLDEN_RATED: L15InherentRiskAssessmentProposalContent = {
  intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', governedRiskStateId: RISK, assessmentBasis: 'INHERENT', methodologyId: MID,
  methodologyVersionId: MVID, methodologyContentHash: HASH, assessmentOutcome: 'RATED', likelihoodLevelCode: 'L2', impactLevelCode: 'I3',
  requestedEffectiveFrom: '2026-10-14T12:00:00.000000Z', requestedValidUntil: '2026-12-14T12:00:00.000000Z', expectedCurrentStateId: null,
  targetStateId: null,
};
export const GOLDEN_IE: L15InherentRiskAssessmentProposalContent = { ...GOLDEN_RATED, assessmentOutcome: 'INSUFFICIENT_EVIDENCE',
  likelihoodLevelCode: null, impactLevelCode: null, requestedEffectiveFrom: null, expectedCurrentStateId: STATE };
export const GOLDEN_REVOKE: L15InherentRiskAssessmentProposalContent = { ...GOLDEN_RATED, intent: 'REVOKE', assessmentOutcome: null,
  likelihoodLevelCode: null, impactLevelCode: null, requestedEffectiveFrom: null, requestedValidUntil: null, expectedCurrentStateId: STATE,
  targetStateId: STATE };
export const GOLDEN_SUBMIT_RATED = 'd94053d9b5bea950a7f0e05c0f4df0a50f7807579683db7fc0ef43674efbd952';
export const GOLDEN_DECIDE_RATED = '2f80cd23a9393a413c69e9b953677b55f1dd88a211ae2bb1ddaa54bc0b4e75e3';
export const GOLDEN_SUBMIT_IE = 'f9a7f6089633de384e3a44ae04e55b53871d3753b440c91f56cc6fe739e4cda1';
export const GOLDEN_DECIDE_REVOKE = '727b594f54f8b9c44d101d2a817e362dc9c55d2ecd1f5b40d47bbe78f74cb31b';

const sha = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const SUPPORT_PARTS = ['SUPPORT', 'PRESENT', '2', 'DISCOVERY_EVIDENCE', 'evidence:golden-s4', 'RISK_HYPOTHESIS', '00000000-0000-4000-8000-0000000000e1'];
const PINS = [RISK, 'INHERENT', MID, MVID, HASH];

describe('M17-S4 RISK_ASSESSMENT mirror', () => {
  it('golden fingerprints equal the explicit literal frames (pinned against PostgreSQL in the PG17 suite)', () => {
    assert.deepEqual(riskAssessmentSupportParts(GOLDEN_SUPPORT), SUPPORT_PARTS);
    const submitRated = sha(['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', ORG, ACTOR, 'RISK_ASSESSMENT', 'VALIDATE', 'LOCAL_HUMAN', ...PINS,
      'ASSESSMENT_OUTCOME', 'RATED', 'LIKELIHOOD_LEVEL', 'L2', 'IMPACT_LEVEL', 'I3', 'EXPLICIT', '2026-10-14T12:00:00.000000Z',
      'VALID_UNTIL', '2026-12-14T12:00:00.000000Z', 'EXPECTED_NONE', 'NO_TARGET_STATE', 'NO_PRIOR_PROPOSAL', ...SUPPORT_PARTS]);
    assert.equal(submitRated, GOLDEN_SUBMIT_RATED);
    assert.equal(submitRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: GOLDEN_RATED, priorProposalId: null,
      support: GOLDEN_SUPPORT }), GOLDEN_SUBMIT_RATED);
    const decideRated = sha(['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', ORG, ACTOR, 'VALIDATE', 'RISK_ASSESSMENT_VALIDATED', PROPOSAL,
      'RISK_ASSESSMENT', 'VALIDATE', 'LOCAL_HUMAN', ...PINS, 'ASSESSMENT_OUTCOME', 'RATED', 'LIKELIHOOD_LEVEL', 'L2', 'IMPACT_LEVEL', 'I3',
      'EXPLICIT', '2026-10-14T12:00:00.000000Z', 'VALID_UNTIL', '2026-12-14T12:00:00.000000Z', 'NO_TARGET_STATE', 'EXPECTED_NONE', ...SUPPORT_PARTS]);
    assert.equal(decideRated, GOLDEN_DECIDE_RATED);
    assert.equal(decideRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome: 'VALIDATE', proposalId: PROPOSAL,
      proposal: GOLDEN_RATED, expectedCurrentStateId: null, support: GOLDEN_SUPPORT }), GOLDEN_DECIDE_RATED);
    const submitIe = sha(['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', ORG, ACTOR, 'RISK_ASSESSMENT', 'VALIDATE', 'LOCAL_HUMAN', ...PINS,
      'ASSESSMENT_OUTCOME', 'INSUFFICIENT_EVIDENCE', 'NO_LIKELIHOOD_LEVEL', 'NO_IMPACT_LEVEL', 'IMMEDIATE', 'VALID_UNTIL',
      '2026-12-14T12:00:00.000000Z', 'EXPECTED_CURRENT', STATE, 'NO_TARGET_STATE', 'PRIOR_PROPOSAL', PROPOSAL, 'SUPPORT', 'NONE', '0']);
    assert.equal(submitIe, GOLDEN_SUBMIT_IE);
    assert.equal(submitRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: GOLDEN_IE, priorProposalId: PROPOSAL,
      support: NONE }), GOLDEN_SUBMIT_IE);
    const decideRevoke = sha(['L15_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', ORG, ACTOR, 'REVOKE', 'RISK_ASSESSMENT_REVOKED', PROPOSAL,
      'RISK_ASSESSMENT', 'REVOKE', 'LOCAL_HUMAN', ...PINS, 'NO_ASSESSMENT_OUTCOME', 'NO_LIKELIHOOD_LEVEL', 'NO_IMPACT_LEVEL', 'IMMEDIATE',
      'NO_VALID_UNTIL', 'TARGET_STATE', STATE, 'EXPECTED_CURRENT', STATE, 'SUPPORT', 'NONE', '0']);
    assert.equal(decideRevoke, GOLDEN_DECIDE_REVOKE);
    assert.equal(decideRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome: 'REVOKE', proposalId: PROPOSAL,
      proposal: GOLDEN_REVOKE, expectedCurrentStateId: STATE, support: NONE }), GOLDEN_DECIDE_REVOKE);
  });

  it('every semantically relevant field changes the fingerprint (pins, basis, outcome, levels, intent, validity, expectation, support)', () => {
    const base = submitRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: GOLDEN_RATED, priorProposalId: null,
      support: GOLDEN_SUPPORT });
    const variants: Array<Partial<L15InherentRiskAssessmentProposalContent>> = [
      { governedRiskStateId: STATE }, { methodologyId: STATE }, { methodologyVersionId: STATE }, { methodologyContentHash: 'e'.repeat(64) },
      { likelihoodLevelCode: 'L1' }, { impactLevelCode: 'I1' }, { requestedEffectiveFrom: null },
      { requestedValidUntil: '2026-12-14T12:00:00.000001Z' }, { expectedCurrentStateId: STATE },
      { assessmentOutcome: 'INSUFFICIENT_EVIDENCE', likelihoodLevelCode: null, impactLevelCode: null },
    ];
    const seen = new Set([base]);
    for (const v of variants) {
      const fp = submitRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: { ...GOLDEN_RATED, ...v },
        priorProposalId: null, support: GOLDEN_SUPPORT });
      assert.ok(!seen.has(fp), JSON.stringify(v));
      seen.add(fp);
    }
    assert.ok(!seen.has(submitRiskAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: GOLDEN_RATED,
      priorProposalId: null, support: NONE })));
  });

  it('shape mirror: closed details in the RPC order; no default level; INSUFFICIENT_EVIDENCE carries none; RESIDUAL not executable', () => {
    const bad = (over: Record<string, unknown>, reason: string) =>
      assert.throws(() => checkRiskAssessmentProposal({ ...GOLDEN_RATED, ...over } as never), new RegExp(`L14_CONTRACT_INVALID: ${reason}$`), reason);
    bad({ intent: 'ACCEPT' }, 'PROPOSAL_VOCABULARY_UNKNOWN');
    bad({ sourceClass: 'SYSTEM_SEED' }, 'SYSTEM_SEED_NOT_ADMISSIBLE');
    bad({ sourceClass: 'SOURCE_CONNECTION' }, 'SOURCE_CONNECTION_NOT_ADMISSIBLE');
    bad({ sourceClass: 'SYSTEM_DETECTOR' }, 'PROPOSAL_VOCABULARY_UNKNOWN');
    bad({ assessmentBasis: 'RESIDUAL' }, 'ASSESSMENT_BASIS_NOT_EXECUTABLE');
    bad({ assessmentBasis: 'CONTROL' }, 'ASSESSMENT_BASIS_UNKNOWN');
    bad({ governedRiskStateId: null }, 'GOVERNED_RISK_STATE_REQUIRED');
    bad({ methodologyVersionId: 'latest' }, 'METHODOLOGY_IDS_REQUIRED');
    bad({ methodologyContentHash: 'D'.repeat(64) }, 'CONTENT_HASH_MALFORMED');
    bad({ assessmentOutcome: 'UNKNOWN' }, 'ASSESSMENT_OUTCOME_UNKNOWN');
    bad({ assessmentOutcome: 'LOW' }, 'ASSESSMENT_OUTCOME_UNKNOWN');
    bad({ assessmentOutcome: null }, 'ASSESSMENT_OUTCOME_REQUIRED');
    bad({ requestedValidUntil: null }, 'VALID_UNTIL_REQUIRED');
    bad({ likelihoodLevelCode: null }, 'LIKELIHOOD_LEVEL_REQUIRED');
    bad({ impactLevelCode: null }, 'IMPACT_LEVEL_REQUIRED');
    bad({ assessmentOutcome: 'INSUFFICIENT_EVIDENCE', impactLevelCode: null }, 'LIKELIHOOD_LEVEL_NOT_PERMITTED');
    bad({ assessmentOutcome: 'INSUFFICIENT_EVIDENCE', likelihoodLevelCode: null }, 'IMPACT_LEVEL_NOT_PERMITTED');
    bad({ requestedValidUntil: '2026-10-14T12:00:00.000000Z' }, 'EFFECTIVE_INTERVAL_INVALID');
    bad({ requestedValidUntil: '2026-10-14T11:00:00.000000Z' }, 'EFFECTIVE_INTERVAL_INVALID');
    bad({ requestedValidUntil: '2026-12-14T12:00:00Z' }, 'EFFECTIVE_INSTANT_NOT_CANONICAL');
    bad({ targetStateId: STATE }, 'TARGET_STATE_NOT_PERMITTED');
    // A caller-supplied band / score is never governed content (the band is derived by PostgreSQL from the pinned cell).
    for (const key of ['ratingBand', 'rating_band', 'band', 'score', 'riskScore', 'weight', 'percentage', 'product']) {
      bad({ [key]: 'LOW' }, 'RATING_BAND_NOT_ACCEPTED');
    }
    const rv = (over: Record<string, unknown>, reason: string) =>
      assert.throws(() => checkRiskAssessmentProposal({ ...GOLDEN_REVOKE, ...over } as never), new RegExp(`L14_CONTRACT_INVALID: ${reason}$`), reason);
    rv({ targetStateId: null, expectedCurrentStateId: null }, 'TARGET_STATE_REQUIRED');
    rv({ assessmentOutcome: 'RATED' }, 'ASSESSMENT_CONTENT_NOT_PERMITTED');
    rv({ requestedValidUntil: '2026-12-14T12:00:00.000000Z' }, 'ASSESSMENT_CONTENT_NOT_PERMITTED');
    rv({ expectedCurrentStateId: RISK }, 'EXPECTATION_MALFORMED');
    checkRiskAssessmentProposal(GOLDEN_RATED);
    checkRiskAssessmentProposal(GOLDEN_IE);
    checkRiskAssessmentProposal(GOLDEN_REVOKE);
  });

  it('support: the rank-3 RISK_ASSESSMENT admissibility (hypothesis, signal, rank-0); no governed L15 artifact; order-independent', () => {
    for (const tag of ['GOVERNED_RISK', 'RISK_ASSESSMENT', 'RISK_TREATMENT', 'RISK_ACCEPTANCE', 'RISK_METHODOLOGY', 'L15_STATE']) {
      assert.throws(() => riskAssessmentSupportParts({ status: 'PRESENT', entries: [{ tag: tag as never, targetId: STATE }] }), /SUPPORT_TAG_UNKNOWN/);
    }
    assert.throws(() => riskAssessmentSupportParts({ status: 'PRESENT', entries: [] } as never), /SUPPORT_MALFORMED/);
    assert.throws(() => riskAssessmentSupportParts({ status: 'PRESENT', entries: [{ tag: 'RISK_SIGNAL', targetId: STATE },
      { tag: 'RISK_SIGNAL', targetId: STATE }] }), /SUPPORT_DUPLICATE/);
    assert.deepEqual(riskAssessmentSupportParts({ status: 'PRESENT', entries: [...GOLDEN_SUPPORT.entries].reverse() as never }), SUPPORT_PARTS);
  });

  it('reason codes: the unchanged subject x outcome rule only (no per-band / per-outcome code)', () => {
    assert.deepEqual(['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'].map(o => riskAssessmentReasonCode(o as never)),
      ['RISK_ASSESSMENT_VALIDATED', 'RISK_ASSESSMENT_REJECTED', 'RISK_ASSESSMENT_DEFERRED', 'RISK_ASSESSMENT_REVOKED']);
    assert.throws(() => riskAssessmentReasonCode('ACCEPT' as never), /DECISION_VOCABULARY_INVALID/);
  });
});
