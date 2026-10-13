import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { L15MethodologyVersionContent, L15ScenarioDefinitionVersionContent } from '@council/canonical-contracts';
import {
  admitMethodologyVersionFingerprint, admitScenarioVersionFingerprint, checkMethodologyContent, checkScenarioContent,
  decideRegistryProposalFingerprint, l15RegistryReasonCode, methodologyContentHash, registrySupportParts, scenarioContentHash,
  submitRegistryProposalFingerprint, validityMaximumInterval, validityMaximumParts,
} from '../src/index.ts';

/**
 * M17-S2 registry mirror tests. The golden hashes below are ALSO asserted against the PostgreSQL functions
 * (gov_repo.l15_risk_scenario_content_hash_v1 / l15_risk_methodology_content_hash_v1) in
 * apps/dashboard/tests/postgres-m16/m17-s2-registries.test.ts, so both sides are pinned to the same bytes.
 */
export const GOLDEN_SCENARIO: L15ScenarioDefinitionVersionContent = {
  riskDomain: 'PRIVACY', subjectKinds: ['DATA_ELEMENT', 'REL:READS_FROM'],
  references: [{ namespace: 'ORGANISATION_SCENARIO_CODE', code: 'GOLDEN-1' }, { namespace: 'SCANNER_RULE_ID', code: 'RISK-PII-DETECTED' }],
};
export const GOLDEN_SCENARIO_HASH = '8cb19829917b2f4ea121dba77c9e7e6702e6254c412533b4804b094ebb663acd';
const lv = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ levelCode: `${p}${i + 1}`, ordinal: i + 1,
  definition: { namespace: 'ORGANISATION_DEFINITION_CODE' as const, code: `DEF-${p}${i + 1}` } }));
const lik = lv('L', 2), imp = lv('I', 2);
export const GOLDEN_METHODOLOGY: L15MethodologyVersionContent = {
  likelihoodScale: lik, impactScale: imp,
  ratingMatrix: lik.flatMap((l, i) => imp.map((m, j) => ({ likelihoodLevelCode: l.levelCode, impactLevelCode: m.levelCode,
    ratingBand: (['LOW', 'MODERATE', 'HIGH'] as const)[i + j]! }))),
  assessmentValidityMaximum: { months: 0, days: 90, microseconds: 0 },
};
export const GOLDEN_METHODOLOGY_HASH = '91ea62c91b130b134a1418b5b755f738a920323128973f8943ac404cf481d230';

const ORG = '00000000-0000-4000-8000-000000000017';
const ACTOR = '00000000-0000-4000-8000-000000000018';
const ID = '00000000-0000-4000-8000-0000000000a1';
const VER = '00000000-0000-4000-8000-0000000000a2';
const rejects = (fn: () => unknown, reason: string) => assert.throws(fn, (e: Error & { reason?: string }) => e.reason === reason, reason);

describe('M17-S2 registry content hashes (mirror of the DB)', () => {
  it('golden vectors (pinned against PostgreSQL by the PG17 suite)', () => {
    assert.equal(scenarioContentHash(GOLDEN_SCENARIO), GOLDEN_SCENARIO_HASH);
    assert.equal(methodologyContentHash(GOLDEN_METHODOLOGY), GOLDEN_METHODOLOGY_HASH);
  });
  it('input order never changes the hash; any content change does', () => {
    assert.equal(scenarioContentHash({ ...GOLDEN_SCENARIO, subjectKinds: [...GOLDEN_SCENARIO.subjectKinds].reverse(),
      references: [...GOLDEN_SCENARIO.references].reverse() }), GOLDEN_SCENARIO_HASH);
    assert.equal(methodologyContentHash({ ...GOLDEN_METHODOLOGY, likelihoodScale: [...lik].reverse(), impactScale: [...imp].reverse(),
      ratingMatrix: [...GOLDEN_METHODOLOGY.ratingMatrix].reverse() }), GOLDEN_METHODOLOGY_HASH);
    assert.notEqual(scenarioContentHash({ ...GOLDEN_SCENARIO, riskDomain: 'DATA' }), GOLDEN_SCENARIO_HASH);
    assert.notEqual(methodologyContentHash({ ...GOLDEN_METHODOLOGY, assessmentValidityMaximum: { months: 3, days: 0, microseconds: 0 } }),
      GOLDEN_METHODOLOGY_HASH);
    assert.notEqual(methodologyContentHash({ ...GOLDEN_METHODOLOGY, ratingMatrix: GOLDEN_METHODOLOGY.ratingMatrix.map((c, i) =>
      (i === 0 ? { ...c, ratingBand: 'CRITICAL' as const } : c)) }), GOLDEN_METHODOLOGY_HASH);
  });
  it('scenario checks mirror the DB closed reasons', () => {
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, riskDomain: 'COMPLIANCE' as never }), 'RISK_DOMAIN_UNKNOWN');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, subjectKinds: [] }), 'SUBJECT_KINDS_EMPTY');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, subjectKinds: ['PROMPT' as never] }), 'SUBJECT_KIND_UNKNOWN');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, subjectKinds: ['DATA_ELEMENT', 'DATA_ELEMENT'] }), 'SUBJECT_KIND_DUPLICATE');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, subjectKinds: ['AGENT'] }), 'DOMAIN_SUBJECT_ILLEGAL');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, references: [] }), 'REFERENCES_MALFORMED');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, references: [{ namespace: 'URL' as never, code: 'x' }] }), 'REFERENCE_NAMESPACE_UNKNOWN');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, references: [{ namespace: 'ORGANISATION_SCENARIO_CODE', code: 'free text' }] }), 'REFERENCE_CODE_MALFORMED');
    rejects(() => checkScenarioContent({ ...GOLDEN_SCENARIO, references: [GOLDEN_SCENARIO.references[0]!, GOLDEN_SCENARIO.references[0]!] }), 'REFERENCE_DUPLICATE');
  });
  it('methodology checks mirror the DB closed reasons (scales, total matrix, bands, validity)', () => {
    const m = GOLDEN_METHODOLOGY;
    rejects(() => checkMethodologyContent({ ...m, likelihoodScale: lv('L', 1), ratingMatrix: m.ratingMatrix.slice(0, 2) }), 'LIKELIHOOD_SCALE_SIZE_INVALID');
    rejects(() => checkMethodologyContent({ ...m, impactScale: lv('I', 8) }), 'IMPACT_SCALE_SIZE_INVALID');
    rejects(() => checkMethodologyContent({ ...m, likelihoodScale: [lik[0]!, { ...lik[1]!, ordinal: 1 }] }), 'LIKELIHOOD_LEVEL_ORDINAL_INVALID');
    rejects(() => checkMethodologyContent({ ...m, impactScale: [imp[0]!, { ...imp[1]!, ordinal: 3 }] }), 'IMPACT_LEVEL_ORDINAL_INVALID');
    rejects(() => checkMethodologyContent({ ...m, likelihoodScale: [lik[0]!, { ...lik[1]!, levelCode: 'L1' }] }), 'LIKELIHOOD_LEVEL_CODE_DUPLICATE');
    rejects(() => checkMethodologyContent({ ...m, ratingMatrix: m.ratingMatrix.slice(1) }), 'RATING_MATRIX_INCOMPLETE');
    rejects(() => checkMethodologyContent({ ...m, ratingMatrix: [...m.ratingMatrix.slice(1), m.ratingMatrix[1]!] }), 'RATING_MATRIX_CELL_DUPLICATE');
    rejects(() => checkMethodologyContent({ ...m, ratingMatrix: [{ ...m.ratingMatrix[0]!, likelihoodLevelCode: 'L9' }, ...m.ratingMatrix.slice(1)] }), 'RATING_MATRIX_LEVEL_UNKNOWN');
    rejects(() => checkMethodologyContent({ ...m, ratingMatrix: [{ ...m.ratingMatrix[0]!, ratingBand: 'SEVERE' as never }, ...m.ratingMatrix.slice(1)] }), 'RATING_BAND_UNKNOWN');
    for (const v of [{ months: 0, days: 0, microseconds: 0 }, { months: -1, days: 40, microseconds: 0 }, { months: 0, days: 1.5, microseconds: 0 }]) {
      rejects(() => checkMethodologyContent({ ...m, assessmentValidityMaximum: v }), 'ASSESSMENT_VALIDITY_MAXIMUM_INVALID');
    }
    assert.deepEqual(validityMaximumParts({ months: 14, days: 3, microseconds: 14706789000 }), ['14', '3', '14706789000']);
    assert.equal(validityMaximumInterval({ months: 0, days: 90, microseconds: 0 }), '0 mons 90 days 0 microseconds');
  });
});

describe('M17-S2 registry fingerprints / support (mirror of the RPCs)', () => {
  it('support parts are order-independent; rank-3 support targets only DISCOVERY_EVIDENCE / SOURCE_ASSERTION', () => {
    const a = registrySupportParts({ status: 'PRESENT', entries: [{ tag: 'SOURCE_ASSERTION', targetId: 'b' }, { tag: 'DISCOVERY_EVIDENCE', targetId: 'a' }] });
    assert.deepEqual(a, ['SUPPORT', 'PRESENT', '2', 'DISCOVERY_EVIDENCE', 'a', 'SOURCE_ASSERTION', 'b']);
    rejects(() => registrySupportParts({ status: 'PRESENT', entries: [{ tag: 'RISK_SIGNAL' as never, targetId: 'x' }] }), 'SUPPORT_TARGET_NOT_ADMISSIBLE');
    rejects(() => registrySupportParts({ status: 'PRESENT', entries: [{ tag: 'GOVERNED_RISK' as never, targetId: 'x' }] }), 'SUPPORT_TAG_UNKNOWN');
    rejects(() => registrySupportParts({ status: 'NONE', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: 'x' }] as never }), 'SUPPORT_MALFORMED');
  });
  it('fingerprints bind the exact ids, DB hash, source and expectation; SYSTEM_SEED needs PRESENT support; SOURCE_CONNECTION refused', () => {
    const base = { organisationId: ORG, actorUserId: ACTOR, identityId: ID, versionId: VER, expectation: { kind: 'EXPECTED_NONE' } as const };
    const local = admitScenarioVersionFingerprint({ ...base, sourceClass: 'LOCAL_HUMAN', content: GOLDEN_SCENARIO });
    const seed = admitScenarioVersionFingerprint({ ...base, sourceClass: 'SYSTEM_SEED', content: GOLDEN_SCENARIO });
    assert.notEqual(local, seed);
    assert.notEqual(local, admitScenarioVersionFingerprint({ ...base, sourceClass: 'LOCAL_HUMAN', content: GOLDEN_SCENARIO,
      expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: '00000000-0000-4000-8000-0000000000a3' } }));
    assert.match(admitMethodologyVersionFingerprint({ ...base, sourceClass: 'LOCAL_HUMAN', content: GOLDEN_METHODOLOGY }), /^[0-9a-f]{64}$/);
    rejects(() => admitScenarioVersionFingerprint({ ...base, sourceClass: 'SOURCE_CONNECTION' as never, content: GOLDEN_SCENARIO }), 'SOURCE_CLASS_NOT_EXECUTABLE');
    rejects(() => admitScenarioVersionFingerprint({ ...base, versionId: ID, sourceClass: 'LOCAL_HUMAN', content: GOLDEN_SCENARIO }), 'RISK_SCENARIO_DEFINITION_IDS_REQUIRED');
    const proposal = { subjectKind: 'RISK_SCENARIO_DEFINITION' as const, intent: 'VALIDATE' as const, sourceClass: 'SYSTEM_SEED' as const,
      identityId: ID, versionId: VER, contentHash: GOLDEN_SCENARIO_HASH, requestedEffectiveFrom: null, targetStateId: null };
    rejects(() => submitRegistryProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: null,
      support: { status: 'NONE', entries: [] } }), 'SYSTEM_SEED_SUPPORT_REQUIRED');
    const support = { status: 'PRESENT' as const, entries: [{ tag: 'DISCOVERY_EVIDENCE' as const, targetId: 'evidence:1' }] };
    assert.match(submitRegistryProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: null, support }), /^[0-9a-f]{64}$/);
    const decide = (outcome: 'VALIDATE' | 'REJECT') => decideRegistryProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome,
      proposalId: '00000000-0000-4000-8000-0000000000b1', proposal, expectedCurrentStateId: null, support });
    assert.notEqual(decide('VALIDATE'), decide('REJECT'));
    assert.equal(l15RegistryReasonCode('RISK_METHODOLOGY', 'REVOKE'), 'RISK_METHODOLOGY_REVOKED');
    assert.equal(l15RegistryReasonCode('RISK_SCENARIO_DEFINITION', 'DEFER'), 'RISK_SCENARIO_DEFINITION_DEFERRED');
  });
});
