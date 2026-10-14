import { createHash } from 'node:crypto';
import {
  L15_GOVERNANCE_REASON_CODES, L15_RISK_ASSESSMENT_BASES, L15_RISK_ASSESSMENT_OUTCOMES, L15_RISK_ASSESSMENT_SUPPORT_MAX_ENTRIES,
  L15_RISK_ASSESSMENT_SUPPORT_TAGS, L15_SUPPORT_TARGET_TAGS,
  type L14GovernanceOutcome, type L15InherentRiskAssessmentProposalContent, type L15RiskAssessmentSupport,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid } from './l14-authority-policy.ts';

/**
 * M17-S4 RISK_ASSESSMENT canonical framing — a byte-for-byte MIRROR of the PostgreSQL shape checks and fingerprint frames of
 * 20261013160000_m17_s4_inherent_risk_assessment_v1.sql, for preflight UX only. PostgreSQL recomputes every fingerprint
 * (GV008), re-validates every shape, resolves the governed-risk / methodology dependencies, proves level membership in the
 * pinned scales, derives the rating band from the pinned cell, enforces the validity maximum and decides authority; nothing
 * here grants authority, resolves a dependency, derives a band or validates anything.
 */

const COMMAND_TAG = 'L15_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const HASH = /^[0-9a-f]{64}$/;
/** Caller-supplied keys that can never be governed assessment content (the band is DB-derived; no numeric score exists). */
const FORBIDDEN_KEYS = ['ratingBand', 'rating_band', 'band', 'score', 'riskScore', 'weight', 'percentage', 'product'] as const;
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = (reason: string): never => { throw new L14ContractError(reason); };
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const operand = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= 500 && value === value.trim();

/** Mirror of gov_repo.l15_governed_risk_support_parts_v1 (the RISK_ASSESSMENT rank-3 admissibility is the same ten tags). */
export function riskAssessmentSupportParts(support: L15RiskAssessmentSupport): string[] {
  const entries = support?.entries;
  if (!support || !['NONE', 'PRESENT'].includes(support.status) || !Array.isArray(entries) || entries.some(e => e == null || e.tag == null || e.targetId == null)) {
    fail('SUPPORT_MALFORMED');
  }
  if ((support.status === 'NONE') !== (entries.length === 0) || entries.length > L15_RISK_ASSESSMENT_SUPPORT_MAX_ENTRIES
    || entries.some(e => !operand(e.targetId))) {
    fail('SUPPORT_MALFORMED');
  }
  if (entries.some(e => !within(L15_SUPPORT_TARGET_TAGS, e.tag) || !within(L15_RISK_ASSESSMENT_SUPPORT_TAGS, e.tag))) fail('SUPPORT_TAG_UNKNOWN');
  if (new Set(entries.map(e => frameIdentity([e.tag, e.targetId]))).size !== entries.length) fail('SUPPORT_DUPLICATE');
  const sorted = [...entries].sort((a, b) => byteOrder(a.tag, b.tag) || byteOrder(a.targetId, b.targetId));
  return ['SUPPORT', support.status, String(entries.length), ...sorted.flatMap(e => [e.tag, e.targetId])];
}

/** The unchanged subject x outcome reason-code rule: RISK_ASSESSMENT_{VALIDATED,REJECTED,DEFERRED,REVOKED}. */
export function riskAssessmentReasonCode(outcome: L14GovernanceOutcome): string {
  return L15_GOVERNANCE_REASON_CODES.RISK_ASSESSMENT?.[outcome] ?? fail('DECISION_VOCABULARY_INVALID');
}

/** Mirror of the S4 SUBMIT shape checks (closed details, same order as the RPC; the band-injection check is TS-only UX). */
export function checkRiskAssessmentProposal(p: L15InherentRiskAssessmentProposalContent): void {
  const raw = p as unknown as Record<string, unknown>;
  if (raw && FORBIDDEN_KEYS.some(k => Object.prototype.hasOwnProperty.call(raw, k))) fail('RATING_BAND_NOT_ACCEPTED');
  if (!within(['VALIDATE', 'REVOKE'], p?.intent) || !within(['SYSTEM_SEED', 'LOCAL_HUMAN', 'SOURCE_CONNECTION'], p.sourceClass)) {
    fail('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if ((p.sourceClass as string) === 'SYSTEM_SEED') fail('SYSTEM_SEED_NOT_ADMISSIBLE');
  if ((p.sourceClass as string) === 'SOURCE_CONNECTION') fail('SOURCE_CONNECTION_NOT_ADMISSIBLE');
  if (!within(L15_RISK_ASSESSMENT_BASES, p.assessmentBasis)) fail('ASSESSMENT_BASIS_UNKNOWN');
  if (p.assessmentBasis !== 'INHERENT') fail('ASSESSMENT_BASIS_NOT_EXECUTABLE');
  if (p.governedRiskStateId == null) fail('GOVERNED_RISK_STATE_REQUIRED');
  canonicalUuid(p.governedRiskStateId, 'GOVERNED_RISK_STATE_REQUIRED');
  canonicalUuid(p.methodologyId, 'METHODOLOGY_IDS_REQUIRED');
  canonicalUuid(p.methodologyVersionId, 'METHODOLOGY_IDS_REQUIRED');
  if (typeof p.methodologyContentHash !== 'string' || !HASH.test(p.methodologyContentHash)) fail('CONTENT_HASH_MALFORMED');
  if (p.assessmentOutcome !== null && !within(L15_RISK_ASSESSMENT_OUTCOMES, p.assessmentOutcome)) fail('ASSESSMENT_OUTCOME_UNKNOWN');
  if (p.intent === 'VALIDATE' && p.targetStateId !== null) fail('TARGET_STATE_NOT_PERMITTED');
  if (p.intent === 'VALIDATE' && p.assessmentOutcome === null) fail('ASSESSMENT_OUTCOME_REQUIRED');
  if (p.intent === 'VALIDATE' && p.requestedValidUntil === null) fail('VALID_UNTIL_REQUIRED');
  if (p.intent === 'REVOKE' && p.targetStateId === null) fail('TARGET_STATE_REQUIRED');
  if (p.intent === 'REVOKE' && (p.assessmentOutcome !== null || p.likelihoodLevelCode !== null || p.impactLevelCode !== null
    || p.requestedValidUntil !== null)) {
    fail('ASSESSMENT_CONTENT_NOT_PERMITTED');
  }
  if (p.intent === 'REVOKE' && p.expectedCurrentStateId !== p.targetStateId) fail('EXPECTATION_MALFORMED');
  if (p.assessmentOutcome === 'RATED' && p.likelihoodLevelCode === null) fail('LIKELIHOOD_LEVEL_REQUIRED');
  if (p.assessmentOutcome === 'RATED' && p.impactLevelCode === null) fail('IMPACT_LEVEL_REQUIRED');
  if (p.assessmentOutcome === 'INSUFFICIENT_EVIDENCE' && p.likelihoodLevelCode !== null) fail('LIKELIHOOD_LEVEL_NOT_PERMITTED');
  if (p.assessmentOutcome === 'INSUFFICIENT_EVIDENCE' && p.impactLevelCode !== null) fail('IMPACT_LEVEL_NOT_PERMITTED');
  for (const code of [p.likelihoodLevelCode, p.impactLevelCode]) {
    if (code !== null && (typeof code !== 'string' || code.length === 0)) fail('LEVEL_CODE_MALFORMED');
  }
  for (const instant of [p.requestedEffectiveFrom, p.requestedValidUntil]) {
    if (instant !== null && !CANONICAL_INSTANT.test(instant)) fail('EFFECTIVE_INSTANT_NOT_CANONICAL');
  }
  if (p.requestedEffectiveFrom !== null && p.requestedValidUntil !== null && !(p.requestedValidUntil > p.requestedEffectiveFrom)) {
    fail('EFFECTIVE_INTERVAL_INVALID');
  }
}

const pinParts = (p: L15InherentRiskAssessmentProposalContent) => [canonicalUuid(p.governedRiskStateId), p.assessmentBasis,
  canonicalUuid(p.methodologyId), canonicalUuid(p.methodologyVersionId), p.methodologyContentHash];
const contentParts = (p: L15InherentRiskAssessmentProposalContent) => [
  ...(p.assessmentOutcome === null ? ['NO_ASSESSMENT_OUTCOME'] : ['ASSESSMENT_OUTCOME', p.assessmentOutcome]),
  ...(p.likelihoodLevelCode === null ? ['NO_LIKELIHOOD_LEVEL'] : ['LIKELIHOOD_LEVEL', p.likelihoodLevelCode]),
  ...(p.impactLevelCode === null ? ['NO_IMPACT_LEVEL'] : ['IMPACT_LEVEL', p.impactLevelCode]),
];
const temporalParts = (p: L15InherentRiskAssessmentProposalContent) => [
  ...(p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]),
  ...(p.requestedValidUntil === null ? ['NO_VALID_UNTIL'] : ['VALID_UNTIL', p.requestedValidUntil]),
];
const targetParts = (p: L15InherentRiskAssessmentProposalContent) => (p.targetStateId === null ? ['NO_TARGET_STATE']
  : ['TARGET_STATE', canonicalUuid(p.targetStateId)]);
const expectedParts = (id: string | null) => (id === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(id)]);

export interface L15SubmitRiskAssessmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L15InherentRiskAssessmentProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L15RiskAssessmentSupport;
}

/** Mirror of the l15_submit_risk_assessment_proposal_v1 fingerprint frame (no band: the caller never supplies one). */
export function submitRiskAssessmentProposalFingerprint(input: L15SubmitRiskAssessmentProposalFingerprintInput): string {
  const p = input.proposal;
  checkRiskAssessmentProposal(p);
  const support = riskAssessmentSupportParts(input.support);
  return sha256Frame([COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'RISK_ASSESSMENT', p.intent, p.sourceClass, ...pinParts(p), ...contentParts(p), ...temporalParts(p),
    ...expectedParts(p.expectedCurrentStateId), ...targetParts(p),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...support]);
}

export interface L15DecideRiskAssessmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L15InherentRiskAssessmentProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15RiskAssessmentSupport;
}

/** Mirror of the l15_decide_risk_assessment_proposal_v1 fingerprint frame. */
export function decideRiskAssessmentProposalFingerprint(input: L15DecideRiskAssessmentProposalFingerprintInput): string {
  const p = input.proposal;
  const support = riskAssessmentSupportParts(input.support);
  return sha256Frame([COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, riskAssessmentReasonCode(input.outcome), canonicalUuid(input.proposalId), 'RISK_ASSESSMENT', p.intent,
    p.sourceClass, ...pinParts(p), ...contentParts(p), ...temporalParts(p), ...targetParts(p),
    ...expectedParts(input.expectedCurrentStateId), ...support]);
}
