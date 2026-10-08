import { createHash } from 'node:crypto';
import {
  L14_CONTROL_DEFINITION_CONTENT_BOUNDS, L14_PROPOSAL_INTENTS, L14_REGISTRY_REASON_CODES, L14_SOURCE_CLASSES,
  type L14ControlDefinitionAdmitExpectation, type L14ControlDefinitionProposalContent,
  type L14ControlDefinitionVersionContent, type L14GovernanceOutcome, type L14RegistryReasonCode, type L14SourceClass,
  type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1B.6 CONTROL_DEFINITION canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261008200000_m16_s1b6_control_definition_registry_v1.sql. PostgreSQL recomputes the content hash (a mismatch is
 * GV010 CONTENT_HASH_MISMATCH) and every fingerprint (a mismatch is GV008) itself and re-validates every shape; nothing
 * here grants authority. No CG-AG flag, score or scanner mapping is read here.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const CONTENT_TAG = 'L14_CONTROL_DEFINITION_CONTENT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const HASH = /^[0-9a-f]{64}$/;
// PostgreSQL: length in code points, equal to btrim, no [[:cntrl:]] character (PostgreSQL stays authoritative: its
// locale-aware class may reject more than the ASCII controls checked here). The description additionally allows LF / TAB
// inside and trims space / LF / TAB at both ends.
const CONTROL = /[\u0000-\u001f\u007f]/;
const DESCRIPTION_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const codePoints = (value: string) => [...value].length;

function bounded(value: unknown, max: number, reason: string): string {
  if (typeof value !== 'string') throw new L14ContractError(reason);
  const length = codePoints(value);
  if (length < 1 || length > max || value !== value.replace(/^ +| +$/g, '') || CONTROL.test(value)) {
    throw new L14ContractError(reason);
  }
  return value;
}

/** Mirror of the PostgreSQL control_code check (CONTROL_CODE_MALFORMED). A descriptive reference, never identity. */
export function l14ControlCode(value: string): string {
  return bounded(value, L14_CONTROL_DEFINITION_CONTENT_BOUNDS.controlCode, 'CONTROL_CODE_MALFORMED');
}

/** Mirror of the PostgreSQL title check (CONTROL_TITLE_MALFORMED). */
export function l14ControlTitle(value: string): string {
  return bounded(value, L14_CONTROL_DEFINITION_CONTENT_BOUNDS.title, 'CONTROL_TITLE_MALFORMED');
}

/** Mirror of the PostgreSQL description check (CONTROL_DESCRIPTION_MALFORMED). */
export function l14ControlDescription(value: string): string {
  if (typeof value !== 'string') throw new L14ContractError('CONTROL_DESCRIPTION_MALFORMED');
  const length = codePoints(value);
  if (length < 1 || length > L14_CONTROL_DEFINITION_CONTENT_BOUNDS.description
    || value !== value.replace(/^[ \n\t]+|[ \n\t]+$/g, '') || DESCRIPTION_CONTROL.test(value)) {
    throw new L14ContractError('CONTROL_DESCRIPTION_MALFORMED');
  }
  return value;
}

function contentHashShape(value: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new L14ContractError('CONTENT_HASH_MALFORMED');
  return value;
}

function temporal(requestedEffectiveFrom: string | null): string[] {
  if (requestedEffectiveFrom === null) return ['IMMEDIATE'];
  if (!CANONICAL_INSTANT.test(requestedEffectiveFrom)) throw new L14ContractError('EFFECTIVE_FROM_NOT_CANONICAL');
  return ['EXPLICIT', requestedEffectiveFrom];
}

/**
 * Mirror of gov_repo.l14_control_definition_content_hash_v1: lowercase hex SHA-256 over the length-framed exact UTF-8
 * bytes of (L14_CONTROL_DEFINITION_CONTENT_V1, control_code, title, description). No normalization.
 */
export function controlDefinitionContentHash(content: L14ControlDefinitionVersionContent): string {
  return sha256Frame([CONTENT_TAG, l14ControlCode(content.controlCode), l14ControlTitle(content.title),
    l14ControlDescription(content.description)]);
}

/** Mirror of the CONTROL_DEFINITION reason-code rule (one closed code per outcome). */
export function controlDefinitionReasonCode(outcome: L14GovernanceOutcome): L14RegistryReasonCode {
  const code = L14_REGISTRY_REASON_CODES.CONTROL_DEFINITION[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function expectationParts(expectation: L14ControlDefinitionAdmitExpectation, versionId: string): string[] {
  if (expectation?.kind === 'EXPECTED_NONE') return ['EXPECTED_NONE'];
  if (expectation?.kind === 'EXPECTED_CURRENT') {
    const latest = canonicalUuid(expectation.latestVersionId, 'EXPECTATION_MALFORMED');
    if (latest === versionId) throw new L14ContractError('EXPECTATION_MALFORMED');
    return ['EXPECTED_CURRENT', latest];
  }
  throw new L14ContractError('EXPECTATION_MALFORMED');
}

export interface L14AdmitControlDefinitionVersionFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly controlDefinitionId: string;
  readonly controlDefinitionVersionId: string;
  readonly expectation: L14ControlDefinitionAdmitExpectation;
  readonly content: L14ControlDefinitionVersionContent;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

/** The fingerprint binds the ids, the content hash (never the raw content alone), the source and the expectation. */
export function admitControlDefinitionVersionFingerprint(input: L14AdmitControlDefinitionVersionFingerprintInput): string {
  if (!within(L14_SOURCE_CLASSES, input.sourceClass)) throw new L14ContractError('SOURCE_CLASS_UNKNOWN');
  const identity = canonicalUuid(input.controlDefinitionId, 'CONTROL_DEFINITION_IDS_REQUIRED');
  const version = canonicalUuid(input.controlDefinitionVersionId, 'CONTROL_DEFINITION_IDS_REQUIRED');
  if (identity === version) throw new L14ContractError('CONTROL_DEFINITION_IDS_REQUIRED');
  return sha256Frame([
    COMMAND_TAG, 'ADMIT_CONTROL_DEFINITION_VERSION', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', 'CONTROL_DEFINITION', identity, version, controlDefinitionContentHash(input.content), input.sourceClass,
    ...expectationParts(input.expectation, version),
    ...supportParts(input.support),
  ]);
}

function proposalContentParts(content: L14ControlDefinitionProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  return ['CONTROL_DEFINITION', content.intent, content.sourceClass,
    canonicalUuid(content.controlDefinitionId, 'CONTROL_DEFINITION_IDS_REQUIRED'),
    canonicalUuid(content.controlDefinitionVersionId, 'CONTROL_DEFINITION_IDS_REQUIRED'), contentHashShape(content.contentHash)];
}

function proposalTailParts(content: L14ControlDefinitionProposalContent): string[] {
  return [...temporal(content.requestedEffectiveFrom),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitControlDefinitionProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14ControlDefinitionProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitControlDefinitionProposalFingerprint(input: L14SubmitControlDefinitionProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal), ...proposalTailParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideControlDefinitionProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14ControlDefinitionProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideControlDefinitionProposalFingerprint(input: L14DecideControlDefinitionProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, controlDefinitionReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal), ...proposalTailParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
