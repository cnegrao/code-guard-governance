import { createHash } from 'node:crypto';
import {
  L14_CONTROL_APPLICABILITY_OBJECT_KINDS, L14_CONTROL_APPLICABILITY_OUTCOMES, L14_CONTROL_APPLICABILITY_REASON_CODES,
  L14_CONTROL_APPLICABILITY_TARGET_TYPES, L14_PROPOSAL_INTENTS, L14_SOURCE_CLASSES,
  type L14GovernanceOutcome, type L14ControlApplicabilityOutcome, type L14ControlApplicabilityProposalContent,
  type L14ControlApplicabilityReasonCode, type L14ControlApplicabilityTarget, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1C.4 CONTROL_APPLICABILITY canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261009220000_m16_s1c4_control_applicability_v1.sql. PostgreSQL recomputes every fingerprint (a mismatch is GV008),
 * re-validates every shape, resolves the exact target (object, or exact relationship-state triple), the S1B.6 control
 * definition identity, the admitted version tuple with its DB-computed content hash and the pinned VALIDATED
 * CONTROL_DEFINITION state, and decides authority itself; nothing here grants authority. A relationship type is never
 * framed (it is DB-resolved); a control code / title / description / cg_* flag is never framed (never authority).
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const SUBJECT = 'CONTROL_APPLICABILITY';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

/** 1..500 code points, trimmed (mirror of the RPC operand checks). Never resolved here. */
function operand(value: unknown, reason: string): string {
  const length = typeof value === 'string' ? [...value].length : 0;
  if (typeof value !== 'string' || length < 1 || length > 500 || value !== value.trim()) throw new L14ContractError(reason);
  return value;
}

/** Mirror of the closed target union checks: returns the framed target parts [targetType, operand1, operand2]. */
export function controlApplicabilityTargetParts(target: L14ControlApplicabilityTarget): string[] {
  const t = target as unknown as Record<string, unknown>;
  if (!t || !within(L14_CONTROL_APPLICABILITY_TARGET_TYPES, t.targetType)) {
    throw new L14ContractError('CONTROL_APPLICABILITY_TARGET_TYPE_UNKNOWN');
  }
  if (t.targetType === 'CANONICAL_OBJECT') {
    if (t.relationshipId != null || t.relationshipStateId != null) throw new L14ContractError('CONTROL_APPLICABILITY_TARGET_UNION_INVALID');
    if (!within(L14_CONTROL_APPLICABILITY_OBJECT_KINDS, t.targetCanonicalKind)) throw new L14ContractError('TARGET_CANONICAL_KIND_UNKNOWN');
    return ['CANONICAL_OBJECT', t.targetCanonicalKind as string, operand(t.targetCanonicalObjectId, 'TARGET_OBJECT_ID_MALFORMED')];
  }
  if (t.targetCanonicalKind != null || t.targetCanonicalObjectId != null) throw new L14ContractError('CONTROL_APPLICABILITY_TARGET_UNION_INVALID');
  return ['RELATIONSHIP_STATE', operand(t.relationshipId, 'TARGET_RELATIONSHIP_ID_MALFORMED'),
    operand(t.relationshipStateId, 'TARGET_RELATIONSHIP_STATE_ID_MALFORMED')];
}

/** Mirror of the RPC outcome vocabulary check (CONTROL_APPLICABILITY_OUTCOME_UNKNOWN). */
export function l14ControlApplicabilityOutcome(value: string): L14ControlApplicabilityOutcome {
  if (!within(L14_CONTROL_APPLICABILITY_OUTCOMES, value)) throw new L14ContractError('CONTROL_APPLICABILITY_OUTCOME_UNKNOWN');
  return value as L14ControlApplicabilityOutcome;
}

/** Mirror of the CONTROL_APPLICABILITY reason-code rule (one closed code per outcome). */
export function controlApplicabilityReasonCode(outcome: L14GovernanceOutcome): L14ControlApplicabilityReasonCode {
  const code = L14_CONTROL_APPLICABILITY_REASON_CODES[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function instant(value: string, reason: string): string {
  if (!CANONICAL_INSTANT.test(value)) throw new L14ContractError(reason);
  return value;
}

function proposalContentParts(content: L14ControlApplicabilityProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if (content.sourceClass !== 'LOCAL_HUMAN') throw new L14ContractError('SOURCE_CLASS_NOT_EXECUTABLE');
  const target = controlApplicabilityTargetParts(content.target);
  const d = content.dependency;
  if (!d) throw new L14ContractError('CONTROL_DEFINITION_VERSION_REQUIRED');
  const controlDefinitionId = canonicalUuid(d.controlDefinitionId, 'CONTROL_DEFINITION_VERSION_REQUIRED');
  const versionId = canonicalUuid(d.controlDefinitionVersionId, 'CONTROL_DEFINITION_VERSION_REQUIRED');
  if (typeof d.contentHash !== 'string' || !CONTENT_HASH.test(d.contentHash)) throw new L14ContractError('CONTENT_HASH_MALFORMED');
  const dependencyState = canonicalUuid(d.controlDefinitionValidatedStateId, 'CONTROL_DEFINITION_DEPENDENCY_REQUIRED');
  const applicability = l14ControlApplicabilityOutcome(content.applicability);
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  if (content.intent === 'REVOKE' && content.requestedEffectiveTo !== null) throw new L14ContractError('EFFECTIVE_TO_NOT_PERMITTED');
  const from = content.requestedEffectiveFrom === null ? null : instant(content.requestedEffectiveFrom, 'EFFECTIVE_FROM_NOT_CANONICAL');
  const to = content.requestedEffectiveTo === null ? null : instant(content.requestedEffectiveTo, 'EFFECTIVE_TO_NOT_CANONICAL');
  // Canonical UTC microsecond strings order lexicographically exactly like the instants they denote.
  if (from !== null && to !== null && !(to > from)) throw new L14ContractError('EFFECTIVE_INTERVAL_INVALID');
  return [SUBJECT, content.intent, content.sourceClass, ...target, controlDefinitionId, versionId, d.contentHash, dependencyState, applicability,
    ...(from === null ? ['IMMEDIATE'] : ['EXPLICIT', from]),
    ...(to === null ? ['NO_EFFECTIVE_TO'] : ['EFFECTIVE_TO', to]),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitControlApplicabilityProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14ControlApplicabilityProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitControlApplicabilityProposalFingerprint(input: L14SubmitControlApplicabilityProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideControlApplicabilityProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14ControlApplicabilityProposalContent;
  /** null = explicit expected-none (no state of the exact fact key yet); otherwise the exact current state (supersession). */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideControlApplicabilityProposalFingerprint(input: L14DecideControlApplicabilityProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, controlApplicabilityReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
