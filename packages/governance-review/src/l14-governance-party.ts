import { createHash } from 'node:crypto';
import {
  L14_GOVERNANCE_PARTY_KINDS, L14_PROPOSAL_INTENTS, L14_REGISTRY_REASON_CODES, L14_SOURCE_CLASSES,
  type L14GovernanceOutcome, type L14GovernancePartyKind, type L14GovernancePartyProposalContent, type L14RegistryReasonCode,
  type L14SourceClass, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1B.1 GovernanceParty canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20260930130000_m16_s1b1_l14_governance_party_v1.sql. PostgreSQL recomputes every fingerprint
 * itself (a mismatch is GV008) and mints every governance_party_id; nothing here grants authority.
 * No PII (name, email, phone, profile text, user mapping, external identity) is ever framed.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

function partyKind(value: L14GovernancePartyKind): string {
  if (!within(L14_GOVERNANCE_PARTY_KINDS, value)) throw new L14ContractError('PARTY_KIND_UNKNOWN');
  return value;
}

function temporal(requestedEffectiveFrom: string | null): string[] {
  if (requestedEffectiveFrom === null) return ['IMMEDIATE'];
  if (!CANONICAL_INSTANT.test(requestedEffectiveFrom)) throw new L14ContractError('EFFECTIVE_FROM_NOT_CANONICAL');
  return ['EXPLICIT', requestedEffectiveFrom];
}

/** Mirror of gov_repo.l14_governance_party_content_hash_v1 (F-4 attempted-content evidence of an ADMIT). */
export function governancePartyContentHash(kind: L14GovernancePartyKind): string {
  return sha256Frame(['L14_GOVERNANCE_PARTY_CONTENT_V1', partyKind(kind)]);
}

/** Mirror of the Party reason-code rule (one closed code per outcome). */
export function governancePartyReasonCode(outcome: L14GovernanceOutcome): L14RegistryReasonCode {
  const code = L14_REGISTRY_REASON_CODES.GOVERNANCE_PARTY[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

export interface L14AdmitGovernancePartyFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly partyKind: L14GovernancePartyKind;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

/** The caller never supplies a governance_party_id: an ADMIT is always EXPECTED_NONE. */
export function admitGovernancePartyFingerprint(input: L14AdmitGovernancePartyFingerprintInput): string {
  if (!within(L14_SOURCE_CLASSES, input.sourceClass)) throw new L14ContractError('SOURCE_CLASS_UNKNOWN');
  return sha256Frame([
    COMMAND_TAG, 'ADMIT_GOVERNANCE_PARTY', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', 'GOVERNANCE_PARTY', partyKind(input.partyKind), input.sourceClass, 'EXPECTED_NONE',
    ...supportParts(input.support),
  ]);
}

function proposalContentParts(content: L14GovernancePartyProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  return ['GOVERNANCE_PARTY', content.intent, content.sourceClass, canonicalUuid(content.governancePartyId),
    partyKind(content.partyKind), ...temporal(content.requestedEffectiveFrom),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitGovernancePartyProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14GovernancePartyProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitGovernancePartyProposalFingerprint(input: L14SubmitGovernancePartyProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideGovernancePartyProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14GovernancePartyProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideGovernancePartyProposalFingerprint(input: L14DecideGovernancePartyProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, governancePartyReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
