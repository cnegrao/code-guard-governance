import { createHash } from 'node:crypto';
import {
  L14_BUSINESS_CONTEXT_REASON_CODES, L14_BUSINESS_CONTEXT_SEMANTIC_KINDS, L14_BUSINESS_CONTEXT_SEMANTIC_KIND_MATRIX,
  L14_BUSINESS_CONTEXT_TARGET_KINDS, L14_PROPOSAL_INTENTS, L14_SOURCE_CLASSES,
  type L14BusinessContextAssignmentProposalContent, type L14BusinessContextReasonCode, type L14BusinessContextSemanticKind,
  type L14BusinessContextTargetKind, type L14GovernanceOutcome, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';
import { l14DomainId } from './l14-domain-registry.ts';

/**
 * M16-S1C.2 BUSINESS_CONTEXT_ASSIGNMENT canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261009120000_m16_s1c2_business_context_assignment_v1.sql. PostgreSQL recomputes every fingerprint (a mismatch is GV008),
 * re-validates every shape, resolves the exact target / admitted domain / domain dependency and decides authority itself;
 * nothing here grants authority. No label, description, legacy domain string or scanner classification is ever framed.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const SUBJECT = 'BUSINESS_CONTEXT_ASSIGNMENT';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

/** Mirror of the RPC target-kind check (BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL): AGENT_VERSION and every other kind fail. */
export function l14BusinessContextTargetKind(value: string): L14BusinessContextTargetKind {
  if (!within(L14_BUSINESS_CONTEXT_TARGET_KINDS, value)) throw new L14ContractError('BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL');
  return value as L14BusinessContextTargetKind;
}

/** Mirror of the RPC semantic-kind vocabulary check (BUSINESS_CONTEXT_SEMANTIC_KIND_UNKNOWN). */
export function l14BusinessContextSemanticKind(value: string): L14BusinessContextSemanticKind {
  if (!within(L14_BUSINESS_CONTEXT_SEMANTIC_KINDS, value)) throw new L14ContractError('BUSINESS_CONTEXT_SEMANTIC_KIND_UNKNOWN');
  return value as L14BusinessContextSemanticKind;
}

/** True iff the pairing is in the closed matrix (AGENT: BUSINESS; DATA_ASSET: both; DATA_ELEMENT: INFORMATION). */
export function isLegalBusinessContextPairing(targetKind: string, semanticKind: string): boolean {
  return within(L14_BUSINESS_CONTEXT_TARGET_KINDS, targetKind)
    && (L14_BUSINESS_CONTEXT_SEMANTIC_KIND_MATRIX[targetKind as L14BusinessContextTargetKind] as readonly string[]).includes(semanticKind);
}

/** Mirror of the RPC target id check (TARGET_OBJECT_ID_MALFORMED): 1..500 code points, trimmed. Never resolved here. */
export function l14BusinessContextTargetObjectId(value: string): string {
  const length = typeof value === 'string' ? [...value].length : 0;
  if (typeof value !== 'string' || length < 1 || length > 500 || value !== value.trim()) {
    throw new L14ContractError('TARGET_OBJECT_ID_MALFORMED');
  }
  return value;
}

/** Mirror of the BUSINESS_CONTEXT_ASSIGNMENT reason-code rule (one closed code per outcome). */
export function businessContextReasonCode(outcome: L14GovernanceOutcome): L14BusinessContextReasonCode {
  const code = L14_BUSINESS_CONTEXT_REASON_CODES[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function instant(value: string, reason: string): string {
  if (!CANONICAL_INSTANT.test(value)) throw new L14ContractError(reason);
  return value;
}

function proposalContentParts(content: L14BusinessContextAssignmentProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if (content.sourceClass !== 'LOCAL_HUMAN') throw new L14ContractError('SOURCE_CLASS_NOT_EXECUTABLE');
  const targetKind = l14BusinessContextTargetKind(content.targetKind);
  const semanticKind = l14BusinessContextSemanticKind(content.semanticKind);
  if (!isLegalBusinessContextPairing(targetKind, semanticKind)) throw new L14ContractError('BUSINESS_CONTEXT_SEMANTIC_KIND_TARGET_ILLEGAL');
  const objectId = l14BusinessContextTargetObjectId(content.targetCanonicalObjectId);
  const domainId = l14DomainId(content.domainId);
  const domainState = canonicalUuid(content.domainValidatedStateId, 'DOMAIN_DEPENDENCY_REQUIRED');
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  if (content.intent === 'REVOKE' && content.requestedEffectiveTo !== null) throw new L14ContractError('EFFECTIVE_TO_NOT_PERMITTED');
  const from = content.requestedEffectiveFrom === null ? null : instant(content.requestedEffectiveFrom, 'EFFECTIVE_FROM_NOT_CANONICAL');
  const to = content.requestedEffectiveTo === null ? null : instant(content.requestedEffectiveTo, 'EFFECTIVE_TO_NOT_CANONICAL');
  // Canonical UTC microsecond strings order lexicographically exactly like the instants they denote.
  if (from !== null && to !== null && !(to > from)) throw new L14ContractError('EFFECTIVE_INTERVAL_INVALID');
  return [SUBJECT, content.intent, content.sourceClass, targetKind, objectId, semanticKind, domainId, domainState,
    ...(from === null ? ['IMMEDIATE'] : ['EXPLICIT', from]),
    ...(to === null ? ['NO_EFFECTIVE_TO'] : ['EFFECTIVE_TO', to]),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitBusinessContextAssignmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14BusinessContextAssignmentProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitBusinessContextAssignmentProposalFingerprint(input: L14SubmitBusinessContextAssignmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideBusinessContextAssignmentProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14BusinessContextAssignmentProposalContent;
  /** null = explicit expected-none (no state of the exact fact key yet); otherwise the exact current state (supersession). */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideBusinessContextAssignmentProposalFingerprint(input: L14DecideBusinessContextAssignmentProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, businessContextReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
