import { createHash } from 'node:crypto';
import {
  L14_PROPOSAL_INTENTS, L14_REGISTRY_REASON_CODES, L14_SOURCE_CLASSES,
  type L14GovernanceOutcome, type L14PolicyVersionProposalContent, type L14RegistryReasonCode, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1B.4 POLICY_VERSION governance framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261008120000_m16_s1b4_policy_version_validation_v1.sql. PostgreSQL recomputes every fingerprint itself (a
 * mismatch is GV008), verifies the exact admitted tuple and its admission source class, and is the sole authority
 * for every authorization, decision and state; nothing here grants authority. No content body is ever framed.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

function temporal(requestedEffectiveFrom: string | null): string[] {
  if (requestedEffectiveFrom === null) return ['IMMEDIATE'];
  if (!CANONICAL_INSTANT.test(requestedEffectiveFrom)) throw new L14ContractError('EFFECTIVE_FROM_NOT_CANONICAL');
  return ['EXPLICIT', requestedEffectiveFrom];
}

/** Mirror of the POLICY_VERSION reason-code rule (one closed code per outcome). */
export function policyVersionReasonCode(outcome: L14GovernanceOutcome): L14RegistryReasonCode {
  const code = L14_REGISTRY_REASON_CODES.POLICY_VERSION[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

function proposalContentParts(content: L14PolicyVersionProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if (typeof content.contentHash !== 'string' || !CONTENT_HASH.test(content.contentHash)) {
    throw new L14ContractError('CONTENT_HASH_MALFORMED');
  }
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  return ['POLICY_VERSION', content.intent, content.sourceClass, canonicalUuid(content.policyId),
    canonicalUuid(content.versionId), content.contentHash, ...temporal(content.requestedEffectiveFrom),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitPolicyVersionProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14PolicyVersionProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitPolicyVersionProposalFingerprint(input: L14SubmitPolicyVersionProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecidePolicyVersionProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14PolicyVersionProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decidePolicyVersionProposalFingerprint(input: L14DecidePolicyVersionProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, policyVersionReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
