import { createHash } from 'node:crypto';
import {
  L14_CONTROL_ASSESSMENT_OUTCOMES, L14_CONTROL_ASSESSMENT_REASON_CODES, L14_CONTROL_ASSESSMENT_UNSUPPORTED_OUTCOMES,
  L14_PROPOSAL_INTENTS, L14_SOURCE_CLASSES,
  type L14GovernanceOutcome, type L14ControlAssessmentOutcome, type L14ControlAssessmentProposalContent,
  type L14ControlAssessmentReasonCode, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1C.5 CONTROL_ASSESSMENT canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261010120000_m16_s1c5_control_assessment_v1.sql. PostgreSQL recomputes every fingerprint (a mismatch is GV008),
 * re-validates every shape, resolves the exact pinned applicability state (VALIDATED, APPLIES, valid at the effective
 * instant) and its immutable tuple, and decides authority itself; nothing here grants authority. The target, control
 * version, relationship type, a score or a finding are never framed (the applicability state id is the exact pin).
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const SUBJECT = 'CONTROL_ASSESSMENT';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

/** Mirror of the RPC outcome vocabulary checks (WAIVED: CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED; else _OUTCOME_UNKNOWN). */
export function l14ControlAssessmentOutcome(value: string): L14ControlAssessmentOutcome {
  if (within(L14_CONTROL_ASSESSMENT_UNSUPPORTED_OUTCOMES, value)) throw new L14ContractError('CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED');
  if (!within(L14_CONTROL_ASSESSMENT_OUTCOMES, value)) throw new L14ContractError('CONTROL_ASSESSMENT_OUTCOME_UNKNOWN');
  return value as L14ControlAssessmentOutcome;
}

/** Mirror of the CONTROL_ASSESSMENT reason-code rule (one closed code per outcome). */
export function controlAssessmentReasonCode(outcome: L14GovernanceOutcome): L14ControlAssessmentReasonCode {
  const code = L14_CONTROL_ASSESSMENT_REASON_CODES[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function instant(value: string, reason: string): string {
  if (!CANONICAL_INSTANT.test(value)) throw new L14ContractError(reason);
  return value;
}

function proposalContentParts(content: L14ControlAssessmentProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if (content.sourceClass !== 'LOCAL_HUMAN') throw new L14ContractError('SOURCE_CLASS_NOT_EXECUTABLE');
  const applicabilityState = canonicalUuid(content.controlApplicabilityStateId, 'CONTROL_APPLICABILITY_STATE_REQUIRED');
  const outcome = l14ControlAssessmentOutcome(content.assessmentOutcome);
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  if (content.intent === 'VALIDATE' && content.requestedValidUntil === null) throw new L14ContractError('VALID_UNTIL_REQUIRED');
  if (content.intent === 'REVOKE' && content.requestedValidUntil !== null) throw new L14ContractError('VALID_UNTIL_NOT_PERMITTED');
  const from = content.requestedEffectiveFrom === null ? null : instant(content.requestedEffectiveFrom, 'EFFECTIVE_FROM_NOT_CANONICAL');
  const until = content.requestedValidUntil === null ? null : instant(content.requestedValidUntil, 'VALID_UNTIL_NOT_CANONICAL');
  // Canonical UTC microsecond strings order lexicographically exactly like the instants they denote.
  if (from !== null && until !== null && !(until > from)) throw new L14ContractError('EFFECTIVE_INTERVAL_INVALID');
  return [SUBJECT, content.intent, content.sourceClass, applicabilityState, outcome,
    ...(from === null ? ['IMMEDIATE'] : ['EXPLICIT', from]),
    ...(until === null ? ['NO_VALID_UNTIL'] : ['VALID_UNTIL', until]),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitControlAssessmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14ControlAssessmentProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitControlAssessmentProposalFingerprint(input: L14SubmitControlAssessmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideControlAssessmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14ControlAssessmentProposalContent;
  /** null = explicit expected-none (no assessment of the applicability state yet); otherwise the exact current state. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideControlAssessmentProposalFingerprint(input: L14DecideControlAssessmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, controlAssessmentReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
