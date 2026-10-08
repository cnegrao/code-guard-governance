import { createHash } from 'node:crypto';
import {
  L14_POLICY_CODE_PATTERN, L14_POLICY_CONTENT_MAX_BYTES, L14_POLICY_TITLE_MAX_CHARACTERS, L14_POLICY_TYPES, L14_SOURCE_CLASSES,
  type L14GovernancePolicyDescriptor, type L14PolicyType, type L14SourceClass, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1B.3 policy content admission framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261007120000_m16_s1b3_policy_admission_v1.sql. PostgreSQL recomputes every hash and fingerprint itself
 * (a mismatch is GV010 / GV008) and mints every policy_id, version_id, version_number and version_label;
 * nothing here grants authority. No owner, organisation, actor or change_summary is ever caller-chosen.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// PostgreSQL btrim() strips spaces only; [[:cntrl:]] (C locale) is the ASCII control range.
const EDGE_SPACES = /^ | $/;
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;

function policyType(value: L14PolicyType): string {
  if (!within(L14_POLICY_TYPES, value)) throw new L14ContractError('POLICY_TYPE_UNKNOWN');
  return value;
}

function sourceClass(value: L14SourceClass): string {
  if (!within(L14_SOURCE_CLASSES, value)) throw new L14ContractError('SOURCE_CLASS_UNKNOWN');
  return value;
}

/** Mirror of the RPC descriptor shape checks (POLICY_CODE_INVALID / POLICY_TITLE_INVALID / POLICY_TYPE_UNKNOWN). */
export function assertGovernancePolicyDescriptor(descriptor: L14GovernancePolicyDescriptor): void {
  if (typeof descriptor.policyCode !== 'string' || !L14_POLICY_CODE_PATTERN.test(descriptor.policyCode)) {
    throw new L14ContractError('POLICY_CODE_INVALID');
  }
  const title = descriptor.title;
  if (typeof title !== 'string' || LONE_SURROGATE.test(title) || [...title].length < 1
    || [...title].length > L14_POLICY_TITLE_MAX_CHARACTERS || EDGE_SPACES.test(title) || ASCII_CONTROL.test(title)) {
    throw new L14ContractError('POLICY_TITLE_INVALID');
  }
  policyType(descriptor.policyType);
}

/** Mirror of gov_repo.l14_policy_identity_content_hash_v1 (F-4 attempted-content evidence of an identity ADMIT). */
export function governancePolicyContentHash(descriptor: L14GovernancePolicyDescriptor): string {
  assertGovernancePolicyDescriptor(descriptor);
  return sha256Frame(['L14_GOVERNANCE_POLICY_CONTENT_V1', descriptor.policyCode, descriptor.title, descriptor.policyType]);
}

/** D-3: lowercase hex SHA-256 of the exact UTF-8 bytes of the version content, no normalization. */
export function policyVersionContentHash(contentMarkdown: string): string {
  if (typeof contentMarkdown !== 'string' || LONE_SURROGATE.test(contentMarkdown)) throw new L14ContractError('POLICY_CONTENT_INVALID');
  const bytes = Buffer.byteLength(contentMarkdown, 'utf8');
  if (bytes < 1 || bytes > L14_POLICY_CONTENT_MAX_BYTES) throw new L14ContractError('POLICY_CONTENT_INVALID');
  return createHash('sha256').update(contentMarkdown, 'utf8').digest('hex');
}

export interface L14AdmitGovernancePolicyFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly descriptor: L14GovernancePolicyDescriptor;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

/** The caller never supplies a policy_id: an identity ADMIT is always EXPECTED_NONE. */
export function admitGovernancePolicyFingerprint(input: L14AdmitGovernancePolicyFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'ADMIT_GOVERNANCE_POLICY', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', 'POLICY_VERSION', governancePolicyContentHash(input.descriptor), sourceClass(input.sourceClass), 'EXPECTED_NONE',
    ...supportParts(input.support),
  ]);
}

export interface L14AdmitPolicyVersionFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly policyId: string;
  /** null = expected-none (the first admitted version of the policy). */
  readonly expectedLatestVersionId: string | null;
  /** The exact DB-recomputed content hash (policyVersionContentHash of the content being admitted). */
  readonly contentHash: string;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

export function admitPolicyVersionFingerprint(input: L14AdmitPolicyVersionFingerprintInput): string {
  if (typeof input.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.contentHash)) {
    throw new L14ContractError('CONTENT_HASH_MALFORMED');
  }
  return sha256Frame([
    COMMAND_TAG, 'ADMIT_POLICY_VERSION', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', 'POLICY_VERSION', canonicalUuid(input.policyId), input.contentHash, sourceClass(input.sourceClass),
    ...(input.expectedLatestVersionId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedLatestVersionId)]),
    ...supportParts(input.support),
  ]);
}
