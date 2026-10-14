import { createHash } from 'node:crypto';
import {
  L15_GOVERNANCE_REASON_CODES, L15_GOVERNED_RISK_CLOSURE_REASONS, L15_GOVERNED_RISK_SUPPORT_MAX_ENTRIES,
  L15_GOVERNED_RISK_SUPPORT_TAGS, L15_OBJECT_SUBJECT_KINDS, L15_SUPPORT_TARGET_TAGS, l15RiskSubjectKey,
  type L14GovernanceOutcome, type L15GovernedRiskProposalContent, type L15GovernedRiskSubject, type L15GovernedRiskSupport,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid } from './l14-authority-policy.ts';

/**
 * M17-S3 GOVERNED_RISK canonical framing — a byte-for-byte MIRROR of the PostgreSQL helpers and RPCs in
 * 20261013140000_m17_s3_governed_risk_v1.sql, for preflight UX only. PostgreSQL recomputes every fingerprint (GV008),
 * re-validates every shape, resolves the subject / scenario / domain itself and decides authority; nothing here grants
 * authority, derives a domain, resolves a subject or validates anything.
 */

const COMMAND_TAG = 'L15_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const HASH = /^[0-9a-f]{64}$/;
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = (reason: string): never => { throw new L14ContractError(reason); };
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const operand = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= 500 && value === value.trim();

/** Mirror of gov_repo.l15_risk_subject_shape_v1 (same closed details, same order). Returns the exact subject key. */
export function checkGovernedRiskSubject(subject: L15GovernedRiskSubject): string {
  if (!subject || !within(['CANONICAL_OBJECT', 'RELATIONSHIP_STATE'], subject.subjectType)) fail('SUBJECT_TYPE_UNKNOWN');
  const s = subject as unknown as Record<string, unknown>;
  if (subject.subjectType === 'CANONICAL_OBJECT'
    ? (s.relationshipId != null || s.relationshipStateId != null || s.canonicalKind == null || s.canonicalObjectId == null)
    : (s.canonicalKind != null || s.canonicalObjectId != null || s.relationshipId == null || s.relationshipStateId == null)) {
    fail('SUBJECT_SHAPE_INVALID');
  }
  if (subject.subjectType === 'CANONICAL_OBJECT' && !within(L15_OBJECT_SUBJECT_KINDS, subject.canonicalKind)) fail('SUBJECT_KIND_NOT_LEGAL');
  const operands = subject.subjectType === 'CANONICAL_OBJECT'
    ? [subject.canonicalObjectId] : [subject.relationshipId, subject.relationshipStateId];
  if (operands.some(o => !operand(o))) fail('SUBJECT_OPERAND_MALFORMED');
  return l15RiskSubjectKey(subject)!;
}

const subjectParts = (subject: L15GovernedRiskSubject): string[] => (subject.subjectType === 'CANONICAL_OBJECT'
  ? [subject.subjectType, subject.canonicalKind, subject.canonicalObjectId]
  : [subject.subjectType, subject.relationshipId, subject.relationshipStateId]);

/** Mirror of gov_repo.l15_governed_risk_support_parts_v1. */
export function governedRiskSupportParts(support: L15GovernedRiskSupport): string[] {
  const entries = support?.entries;
  if (!support || !['NONE', 'PRESENT'].includes(support.status) || !Array.isArray(entries) || entries.some(e => e == null || e.tag == null || e.targetId == null)) {
    fail('SUPPORT_MALFORMED');
  }
  if ((support.status === 'NONE') !== (entries.length === 0) || entries.length > L15_GOVERNED_RISK_SUPPORT_MAX_ENTRIES
    || entries.some(e => !operand(e.targetId))) {
    fail('SUPPORT_MALFORMED');
  }
  if (entries.some(e => !within(L15_SUPPORT_TARGET_TAGS, e.tag) || !within(L15_GOVERNED_RISK_SUPPORT_TAGS, e.tag))) fail('SUPPORT_TAG_UNKNOWN');
  if (new Set(entries.map(e => frameIdentity([e.tag, e.targetId]))).size !== entries.length) fail('SUPPORT_DUPLICATE');
  const sorted = [...entries].sort((a, b) => byteOrder(a.tag, b.tag) || byteOrder(a.targetId, b.targetId));
  return ['SUPPORT', support.status, String(entries.length), ...sorted.flatMap(e => [e.tag, e.targetId])];
}

/** The unchanged subject x outcome reason-code rule: GOVERNED_RISK_{VALIDATED,REJECTED,DEFERRED,REVOKED}. */
export function governedRiskReasonCode(outcome: L14GovernanceOutcome): string {
  return L15_GOVERNANCE_REASON_CODES.GOVERNED_RISK?.[outcome] ?? fail('DECISION_VOCABULARY_INVALID');
}

/** Mirror of the S3 SUBMIT shape checks (closed details, same order as the RPC). */
export function checkGovernedRiskProposal(p: L15GovernedRiskProposalContent): void {
  if (!within(['VALIDATE', 'REVOKE'], p?.intent) || !within(['SYSTEM_SEED', 'LOCAL_HUMAN', 'SOURCE_CONNECTION'], p.sourceClass)) {
    fail('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if ((p.sourceClass as string) === 'SYSTEM_SEED') fail('SYSTEM_SEED_NOT_ADMISSIBLE');
  if ((p.sourceClass as string) === 'SOURCE_CONNECTION') fail('SOURCE_CLASS_NOT_EXECUTABLE');
  checkGovernedRiskSubject(p.subject);
  canonicalUuid(p.scenarioDefinitionId, 'SCENARIO_IDS_REQUIRED');
  canonicalUuid(p.scenarioDefinitionVersionId, 'SCENARIO_IDS_REQUIRED');
  if (!HASH.test(p.scenarioContentHash)) fail('CONTENT_HASH_MALFORMED');
  if (p.closureReason !== null && !within(L15_GOVERNED_RISK_CLOSURE_REASONS, p.closureReason)) fail('CLOSURE_REASON_UNKNOWN');
  if (p.intent === 'VALIDATE' && p.targetStateId !== null) fail('TARGET_STATE_NOT_PERMITTED');
  if (p.intent === 'VALIDATE' && p.closureReason !== null) fail('CLOSURE_REASON_NOT_PERMITTED');
  if (p.intent === 'REVOKE' && p.targetStateId === null) fail('TARGET_STATE_REQUIRED');
  if (p.intent === 'REVOKE' && p.closureReason === null) fail('CLOSURE_REASON_REQUIRED');
  if (p.intent === 'REVOKE' && p.requestedEffectiveTo !== null) fail('EFFECTIVE_TO_NOT_PERMITTED');
  if (p.intent === 'REVOKE' && p.expectedCurrentStateId !== p.targetStateId) fail('EXPECTATION_MALFORMED');
  for (const instant of [p.requestedEffectiveFrom, p.requestedEffectiveTo]) {
    if (instant !== null && !CANONICAL_INSTANT.test(instant)) fail('EFFECTIVE_INSTANT_NOT_CANONICAL');
  }
  if (p.requestedEffectiveFrom !== null && p.requestedEffectiveTo !== null && !(p.requestedEffectiveTo > p.requestedEffectiveFrom)) {
    fail('EFFECTIVE_INTERVAL_INVALID');
  }
}

const temporalParts = (p: L15GovernedRiskProposalContent) => [
  ...(p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]),
  ...(p.requestedEffectiveTo === null ? ['NO_EFFECTIVE_TO'] : ['EFFECTIVE_TO', p.requestedEffectiveTo]),
];
const pinParts = (p: L15GovernedRiskProposalContent) => [canonicalUuid(p.scenarioDefinitionId), canonicalUuid(p.scenarioDefinitionVersionId),
  p.scenarioContentHash];
const targetParts = (p: L15GovernedRiskProposalContent) => (p.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(p.targetStateId)]);
const expectedParts = (id: string | null) => (id === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(id)]);
const closureParts = (reason: string | null) => (reason === null ? ['NO_CLOSURE_REASON'] : ['CLOSURE_REASON', reason]);

export interface L15SubmitGovernedRiskProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L15GovernedRiskProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L15GovernedRiskSupport;
}

/** Mirror of the l15_submit_governed_risk_proposal_v1 fingerprint frame. */
export function submitGovernedRiskProposalFingerprint(input: L15SubmitGovernedRiskProposalFingerprintInput): string {
  const p = input.proposal;
  checkGovernedRiskProposal(p);
  const support = governedRiskSupportParts(input.support);
  return sha256Frame([COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'GOVERNED_RISK', p.intent, p.sourceClass, ...subjectParts(p.subject), ...pinParts(p), ...temporalParts(p),
    ...expectedParts(p.expectedCurrentStateId), ...targetParts(p), ...closureParts(p.closureReason),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...support]);
}

export interface L15DecideGovernedRiskProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L15GovernedRiskProposalContent;
  /** REVOKE only (= the proposal's closure reason); null otherwise. */
  readonly closureReason: string | null;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15GovernedRiskSupport;
}

/** Mirror of the l15_decide_governed_risk_proposal_v1 fingerprint frame. */
export function decideGovernedRiskProposalFingerprint(input: L15DecideGovernedRiskProposalFingerprintInput): string {
  const p = input.proposal;
  if (input.closureReason !== null && !within(L15_GOVERNED_RISK_CLOSURE_REASONS, input.closureReason)) fail('CLOSURE_REASON_UNKNOWN');
  if (input.outcome === 'REVOKE' && input.closureReason === null) fail('CLOSURE_REASON_REQUIRED');
  if (input.outcome !== 'REVOKE' && input.closureReason !== null) fail('CLOSURE_REASON_NOT_PERMITTED');
  const support = governedRiskSupportParts(input.support);
  return sha256Frame([COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, governedRiskReasonCode(input.outcome), canonicalUuid(input.proposalId), 'GOVERNED_RISK', p.intent,
    p.sourceClass, ...subjectParts(p.subject), ...pinParts(p), ...temporalParts(p), ...targetParts(p),
    ...expectedParts(input.expectedCurrentStateId), ...closureParts(input.closureReason), ...support]);
}
