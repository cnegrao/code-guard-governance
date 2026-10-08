import { createHash } from 'node:crypto';
import {
  L14_PROPOSAL_INTENTS, L14_RESPONSIBILITY_REASON_CODES, L14_RESPONSIBILITY_ROLES, L14_RESPONSIBILITY_ROLE_MATRIX,
  L14_RESPONSIBILITY_TARGET_KINDS, L14_SINGLE_OWNER_RESPONSIBILITY_ROLES, L14_SOURCE_CLASSES,
  type L14GovernanceOutcome, type L14ResponsibilityAssignmentProposalContent, type L14ResponsibilityReasonCode,
  type L14ResponsibilityRole, type L14ResponsibilityTargetKind, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1C.1 RESPONSIBILITY_ASSIGNMENT canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261008220000_m16_s1c1_responsibility_assignment_v1.sql. PostgreSQL recomputes every fingerprint (a mismatch is GV008),
 * re-validates every shape, resolves the exact target / Party dependency and decides authority itself; nothing here grants
 * authority. No Party PII (name, email, phone, profile, directory id) and no legacy owner field is ever framed.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const SUBJECT = 'RESPONSIBILITY_ASSIGNMENT';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

/** Mirror of the RPC target-kind check (RESPONSIBILITY_TARGET_KIND_ILLEGAL): AGENT_VERSION and every other kind fail. */
export function l14ResponsibilityTargetKind(value: string): L14ResponsibilityTargetKind {
  if (!within(L14_RESPONSIBILITY_TARGET_KINDS, value)) throw new L14ContractError('RESPONSIBILITY_TARGET_KIND_ILLEGAL');
  return value as L14ResponsibilityTargetKind;
}

/** Mirror of the RPC role vocabulary check (RESPONSIBILITY_ROLE_UNKNOWN). */
export function l14ResponsibilityRole(value: string): L14ResponsibilityRole {
  if (!within(L14_RESPONSIBILITY_ROLES, value)) throw new L14ContractError('RESPONSIBILITY_ROLE_UNKNOWN');
  return value as L14ResponsibilityRole;
}

/** True iff the pairing is in the closed matrix (ADR §11). */
export function isLegalResponsibilityPairing(targetKind: string, role: string): boolean {
  return within(L14_RESPONSIBILITY_TARGET_KINDS, targetKind)
    && (L14_RESPONSIBILITY_ROLE_MATRIX[targetKind as L14ResponsibilityTargetKind] as readonly string[]).includes(role);
}

/** True for BUSINESS_OWNER / TECHNICAL_OWNER / DATA_OWNER (one effective assignment per target + role, any Party). */
export function isSingleOwnerResponsibilityRole(role: L14ResponsibilityRole): boolean {
  return (L14_SINGLE_OWNER_RESPONSIBILITY_ROLES as readonly string[]).includes(role);
}

/** Mirror of the RPC target id check (TARGET_OBJECT_ID_MALFORMED): 1..500 code points, trimmed. Never resolved here. */
export function l14ResponsibilityTargetObjectId(value: string): string {
  const length = typeof value === 'string' ? [...value].length : 0;
  if (typeof value !== 'string' || length < 1 || length > 500 || value !== value.trim()) {
    throw new L14ContractError('TARGET_OBJECT_ID_MALFORMED');
  }
  return value;
}

/** Mirror of the RESPONSIBILITY_ASSIGNMENT reason-code rule (one closed code per outcome). */
export function responsibilityReasonCode(outcome: L14GovernanceOutcome): L14ResponsibilityReasonCode {
  const code = L14_RESPONSIBILITY_REASON_CODES[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function instant(value: string, reason: string): string {
  if (!CANONICAL_INSTANT.test(value)) throw new L14ContractError(reason);
  return value;
}

function proposalContentParts(content: L14ResponsibilityAssignmentProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if (content.sourceClass !== 'LOCAL_HUMAN') throw new L14ContractError('SOURCE_CLASS_NOT_EXECUTABLE');
  const targetKind = l14ResponsibilityTargetKind(content.targetKind);
  const role = l14ResponsibilityRole(content.responsibilityRole);
  if (!isLegalResponsibilityPairing(targetKind, role)) throw new L14ContractError('RESPONSIBILITY_ROLE_TARGET_ILLEGAL');
  const objectId = l14ResponsibilityTargetObjectId(content.targetCanonicalObjectId);
  const party = canonicalUuid(content.governancePartyId, 'PARTY_DEPENDENCY_REQUIRED');
  const partyState = canonicalUuid(content.partyValidatedStateId, 'PARTY_DEPENDENCY_REQUIRED');
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  if (content.intent === 'REVOKE' && content.requestedEffectiveTo !== null) throw new L14ContractError('EFFECTIVE_TO_NOT_PERMITTED');
  const from = content.requestedEffectiveFrom === null ? null : instant(content.requestedEffectiveFrom, 'EFFECTIVE_FROM_NOT_CANONICAL');
  const to = content.requestedEffectiveTo === null ? null : instant(content.requestedEffectiveTo, 'EFFECTIVE_TO_NOT_CANONICAL');
  // Canonical UTC microsecond strings order lexicographically exactly like the instants they denote.
  if (from !== null && to !== null && !(to > from)) throw new L14ContractError('EFFECTIVE_INTERVAL_INVALID');
  return [SUBJECT, content.intent, content.sourceClass, targetKind, objectId, role, party, partyState,
    ...(from === null ? ['IMMEDIATE'] : ['EXPLICIT', from]),
    ...(to === null ? ['NO_EFFECTIVE_TO'] : ['EFFECTIVE_TO', to]),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitResponsibilityAssignmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14ResponsibilityAssignmentProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitResponsibilityAssignmentProposalFingerprint(input: L14SubmitResponsibilityAssignmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideResponsibilityAssignmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14ResponsibilityAssignmentProposalContent;
  /** null = explicit expected-none (no state of the exact fact key yet). */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideResponsibilityAssignmentProposalFingerprint(input: L14DecideResponsibilityAssignmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, responsibilityReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
