import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { L15GovernedRiskProposalContent, L15GovernedRiskSupport } from '@council/canonical-contracts';
import {
  checkGovernedRiskProposal, checkGovernedRiskSubject, decideGovernedRiskProposalFingerprint, frameIdentity, governedRiskReasonCode,
  governedRiskSupportParts, submitGovernedRiskProposalFingerprint,
} from '../src/index.ts';

/**
 * M17-S3 GOVERNED_RISK mirror tests. The golden fingerprints below are ALSO asserted against PostgreSQL
 * (gov_repo.l14_sha256_frame_v1 over the RPC frame + gov_repo.l15_governed_risk_support_parts_v1 / l15_risk_subject_key_v1) in
 * apps/dashboard/tests/postgres-m16/m17-s3-governed-risk.test.ts, and every PG17 RPC call uses these functions (GV008 on a
 * mismatch), so both sides are pinned to the same bytes.
 */
export const ORG = '00000000-0000-4000-8000-000000000031';
export const ACTOR = '00000000-0000-4000-8000-000000000032';
export const SCENARIO_ID = '00000000-0000-4000-8000-0000000000b1';
export const SCENARIO_VERSION_ID = '00000000-0000-4000-8000-0000000000b2';
export const PROPOSAL_ID = '00000000-0000-4000-8000-0000000000b3';
export const STATE_ID = '00000000-0000-4000-8000-0000000000b4';
export const HASH = 'c'.repeat(64);
export const GOLDEN_SUPPORT: L15GovernedRiskSupport = { status: 'PRESENT', entries: [
  { tag: 'RISK_SIGNAL', targetId: '00000000-0000-4000-8000-0000000000c1' }, { tag: 'DISCOVERY_EVIDENCE', targetId: 'evidence:golden' }] };
export const GOLDEN_PROPOSAL: L15GovernedRiskProposalContent = {
  intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN',
  subject: { subjectType: 'RELATIONSHIP_STATE', relationshipId: 'canonical-relationship:golden', relationshipStateId: 'canonical-relationship:golden:initial' },
  scenarioDefinitionId: SCENARIO_ID, scenarioDefinitionVersionId: SCENARIO_VERSION_ID, scenarioContentHash: HASH,
  requestedEffectiveFrom: '2026-10-13T12:00:00.000000Z', requestedEffectiveTo: '2027-10-13T12:00:00.000000Z',
  expectedCurrentStateId: null, targetStateId: null, closureReason: null,
};
export const GOLDEN_REVOKE: L15GovernedRiskProposalContent = {
  ...GOLDEN_PROPOSAL, intent: 'REVOKE', subject: { subjectType: 'CANONICAL_OBJECT', canonicalKind: 'AGENT_VERSION', canonicalObjectId: 'agent-version:golden' },
  requestedEffectiveFrom: null, requestedEffectiveTo: null, expectedCurrentStateId: STATE_ID, targetStateId: STATE_ID, closureReason: 'SUBJECT_RETIRED',
};
export const GOLDEN_SUBMIT = 'a99281cd6c4b80ad685e083b2a15c7bac38fa7a92896c1dc829f395799690bc0';
export const GOLDEN_DECIDE = '7e1d1ca79b37f6e1dfc69b7275e8cc77bc16cab0f6014bb547e3d84617aff98d';
export const GOLDEN_REVOKE_SUBMIT = '59876df4637fd0b4e16efaeb9601491bd449b738a6d70a5c5f506b06ff8cfd76';
export const GOLDEN_REVOKE_DECIDE = '294ccddfb6a6f2380c41d7b6cf8e595997bb1186053ff98b39d96b53672aa391';

const rejects = (fn: () => unknown, reason: string) => assert.throws(fn, (e: Error & { reason?: string }) => e.reason === reason, reason);
const submit = (proposal: L15GovernedRiskProposalContent = GOLDEN_PROPOSAL, support: L15GovernedRiskSupport = GOLDEN_SUPPORT,
  prior: string | null = null) =>
  submitGovernedRiskProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: prior, support });
const decide = (proposal: L15GovernedRiskProposalContent = GOLDEN_PROPOSAL, outcome: 'VALIDATE' | 'REJECT' | 'DEFER' | 'REVOKE' = 'VALIDATE',
  closureReason: string | null = null, expected: string | null = null, support: L15GovernedRiskSupport = GOLDEN_SUPPORT) =>
  decideGovernedRiskProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL_ID, proposal,
    closureReason, expectedCurrentStateId: expected, support });

const NONE: L15GovernedRiskSupport = { status: 'NONE', entries: [] };

describe('M17-S3 GOVERNED_RISK fingerprints (mirror of the DB frames)', () => {
  it('golden vectors (pinned against PostgreSQL by the PG17 suite)', () => {
    assert.equal(submit(), GOLDEN_SUBMIT);
    assert.equal(decide(), GOLDEN_DECIDE);
    assert.equal(submit(GOLDEN_REVOKE, NONE), GOLDEN_REVOKE_SUBMIT);
    assert.equal(decide(GOLDEN_REVOKE, 'REVOKE', 'SUBJECT_RETIRED', STATE_ID, NONE), GOLDEN_REVOKE_DECIDE);
  });
  it('the submit frame is the exact L15_COMMAND_FINGERPRINT_V1 length-prefixed frame', () => {
    const frame = ['L15_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', ORG, ACTOR, 'GOVERNED_RISK', 'VALIDATE', 'LOCAL_HUMAN',
      'RELATIONSHIP_STATE', 'canonical-relationship:golden', 'canonical-relationship:golden:initial', SCENARIO_ID, SCENARIO_VERSION_ID, HASH,
      'EXPLICIT', '2026-10-13T12:00:00.000000Z', 'EFFECTIVE_TO', '2027-10-13T12:00:00.000000Z', 'EXPECTED_NONE', 'NO_TARGET_STATE',
      'NO_CLOSURE_REASON', 'NO_PRIOR_PROPOSAL', ...governedRiskSupportParts(GOLDEN_SUPPORT)];
    assert.equal(createHash('sha256').update(frameIdentity(frame), 'utf8').digest('hex'), GOLDEN_SUBMIT);
  });
  it('support order never changes a fingerprint; any content change does', () => {
    assert.equal(submit(GOLDEN_PROPOSAL, { status: 'PRESENT', entries: [...GOLDEN_SUPPORT.entries].reverse() }), GOLDEN_SUBMIT);
    assert.deepEqual(governedRiskSupportParts(GOLDEN_SUPPORT), ['SUPPORT', 'PRESENT', '2', 'DISCOVERY_EVIDENCE', 'evidence:golden',
      'RISK_SIGNAL', '00000000-0000-4000-8000-0000000000c1']);
    assert.deepEqual(governedRiskSupportParts(NONE), ['SUPPORT', 'NONE', '0']);
    for (const changed of [
      submit({ ...GOLDEN_PROPOSAL, scenarioContentHash: 'd'.repeat(64) }), submit({ ...GOLDEN_PROPOSAL, requestedEffectiveTo: null }),
      submit({ ...GOLDEN_PROPOSAL, subject: { ...GOLDEN_PROPOSAL.subject, relationshipStateId: 'canonical-relationship:golden:v2' } as never }),
      submit(GOLDEN_PROPOSAL, NONE), submit(GOLDEN_PROPOSAL, GOLDEN_SUPPORT, PROPOSAL_ID),
      decide(GOLDEN_PROPOSAL, 'REJECT'), decide(GOLDEN_PROPOSAL, 'VALIDATE', null, STATE_ID),
    ]) assert.notEqual(changed, GOLDEN_SUBMIT);
    assert.notEqual(decide(GOLDEN_REVOKE, 'REVOKE', 'RECORDED_IN_ERROR', STATE_ID, NONE), GOLDEN_REVOKE_DECIDE);
  });
  it('closed reason codes: the unchanged subject x outcome rule', () => {
    assert.deepEqual((['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const).map(governedRiskReasonCode),
      ['GOVERNED_RISK_VALIDATED', 'GOVERNED_RISK_REJECTED', 'GOVERNED_RISK_DEFERRED', 'GOVERNED_RISK_REVOKED']);
  });
});

describe('M17-S3 GOVERNED_RISK shape checks (mirror of the closed DB reasons)', () => {
  it('subject: closed object / relationship-state union; PROMPT / KNOWLEDGE_BASE / SKILL are never direct subjects', () => {
    assert.equal(checkGovernedRiskSubject({ subjectType: 'CANONICAL_OBJECT', canonicalKind: 'TOOL', canonicalObjectId: 'tool:1' }),
      'CANONICAL_OBJECT|4:TOOL|6:tool:1');
    assert.equal(checkGovernedRiskSubject({ subjectType: 'RELATIONSHIP_STATE', relationshipId: 'r', relationshipStateId: 'r:é' }),
      'RELATIONSHIP_STATE|1:r|3:r:é', 'code points (PostgreSQL length), never bytes / UTF-16 units');
    for (const kind of ['PROMPT', 'KNOWLEDGE_BASE', 'SKILL', 'RISK_EXCEPTION']) {
      rejects(() => checkGovernedRiskSubject({ subjectType: 'CANONICAL_OBJECT', canonicalKind: kind as never, canonicalObjectId: 'x' }), 'SUBJECT_KIND_NOT_LEGAL');
    }
    rejects(() => checkGovernedRiskSubject({ subjectType: 'RELATIONSHIP_TYPE' } as never), 'SUBJECT_TYPE_UNKNOWN');
    rejects(() => checkGovernedRiskSubject({ subjectType: 'RELATIONSHIP_STATE', relationshipId: 'r', relationshipStateId: 'r:1',
      canonicalKind: 'TOOL' } as never), 'SUBJECT_SHAPE_INVALID');
    rejects(() => checkGovernedRiskSubject({ subjectType: 'CANONICAL_OBJECT', canonicalKind: 'TOOL', canonicalObjectId: ' padded' }), 'SUBJECT_OPERAND_MALFORMED');
  });
  it('proposal: LOCAL_HUMAN only (SYSTEM_SEED inadmissible, SOURCE_CONNECTION dependency-deferred); closure / target / interval rules', () => {
    checkGovernedRiskProposal(GOLDEN_PROPOSAL);
    checkGovernedRiskProposal(GOLDEN_REVOKE);
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, sourceClass: 'SYSTEM_SEED' as never }), 'SYSTEM_SEED_NOT_ADMISSIBLE');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, sourceClass: 'SOURCE_CONNECTION' as never }), 'SOURCE_CLASS_NOT_EXECUTABLE');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, sourceClass: 'SYSTEM_DETECTOR' as never }), 'PROPOSAL_VOCABULARY_UNKNOWN');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, intent: 'REPIN' as never }), 'PROPOSAL_VOCABULARY_UNKNOWN');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, scenarioContentHash: 'x' }), 'CONTENT_HASH_MALFORMED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, closureReason: 'SUBJECT_RETIRED' }), 'CLOSURE_REASON_NOT_PERMITTED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, targetStateId: STATE_ID }), 'TARGET_STATE_NOT_PERMITTED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_REVOKE, closureReason: null }), 'CLOSURE_REASON_REQUIRED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_REVOKE, closureReason: 'BECAUSE' as never }), 'CLOSURE_REASON_UNKNOWN');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_REVOKE, targetStateId: null }), 'TARGET_STATE_REQUIRED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_REVOKE, requestedEffectiveTo: '2027-10-13T12:00:00.000000Z' }), 'EFFECTIVE_TO_NOT_PERMITTED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_REVOKE, expectedCurrentStateId: null }), 'EXPECTATION_MALFORMED');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, requestedEffectiveFrom: '2026-10-13T12:00:00Z' }), 'EFFECTIVE_INSTANT_NOT_CANONICAL');
    rejects(() => checkGovernedRiskProposal({ ...GOLDEN_PROPOSAL, requestedEffectiveTo: GOLDEN_PROPOSAL.requestedEffectiveFrom }), 'EFFECTIVE_INTERVAL_INVALID');
  });
  it('decide: closure only on REVOKE; support malformed / unknown / duplicate / over-limit fail closed', () => {
    rejects(() => decide(GOLDEN_REVOKE, 'REVOKE', null, STATE_ID, NONE), 'CLOSURE_REASON_REQUIRED');
    rejects(() => decide(GOLDEN_PROPOSAL, 'VALIDATE', 'SUBJECT_RETIRED'), 'CLOSURE_REASON_NOT_PERMITTED');
    rejects(() => decide(GOLDEN_REVOKE, 'REVOKE', 'NOT_A_REASON', STATE_ID, NONE), 'CLOSURE_REASON_UNKNOWN');
    rejects(() => governedRiskSupportParts({ status: 'NONE', entries: GOLDEN_SUPPORT.entries } as never), 'SUPPORT_MALFORMED');
    rejects(() => governedRiskSupportParts({ status: 'PRESENT', entries: [] } as never), 'SUPPORT_MALFORMED');
    rejects(() => governedRiskSupportParts({ status: 'PRESENT', entries: [{ tag: 'GOVERNED_RISK' as never, targetId: 'x' }] }), 'SUPPORT_TAG_UNKNOWN');
    rejects(() => governedRiskSupportParts({ status: 'PRESENT', entries: [GOLDEN_SUPPORT.entries[0]!, GOLDEN_SUPPORT.entries[0]!] }), 'SUPPORT_DUPLICATE');
    rejects(() => governedRiskSupportParts({ status: 'PRESENT', entries: Array.from({ length: 65 }, (_, i) =>
      ({ tag: 'DISCOVERY_EVIDENCE' as const, targetId: `ev-${i}` })) }), 'SUPPORT_MALFORMED');
  });
});
