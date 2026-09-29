import { createHash } from 'node:crypto';
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_AUTHORITY_POLICY_REASON_CODES, L14_PERMISSIONS,
  L14_PROPOSAL_INTENTS, L14_PROPOSAL_SUBJECT_KINDS, L14_REQUESTED_ACTIONS, L14_SCOPE_TAGS, L14_SOURCE_CLASSES,
  L14_SOURCE_DISPOSITIONS, L14_SUPPORT_STATUSES,
  type L14AuthorityPolicyReasonCode, type L14AuthorityPolicyRule, type L14GovernanceOutcome, type L14ProposalIntent,
  type L14ProposalSubjectKind, type L14SourceClass, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';

/**
 * M16-S1A L14 Authority Policy canonical framing — a byte-for-byte MIRROR of the PostgreSQL
 * functions in 20260929120000_m16_s1a_l14_authority_policy_v1.sql. PostgreSQL recomputes every
 * content hash and command fingerprint itself; the values computed here are assertions only and a
 * mismatch is rejected by the database (GV008). Ordering is always by UTF-8 bytes (Buffer.compare),
 * never by caller order, JavaScript UTF-16 sort or locale.
 */

export class L14ContractError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`L14_CONTRACT_INVALID: ${reason}`);
    this.name = 'L14ContractError';
    this.reason = reason;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const KINDS: readonly string[] = Object.values(CANONICAL_OBJECT_KIND);
const RELATIONSHIP_TYPES: readonly string[] = Object.values(GOVERNED_RELATIONSHIP_TYPE);

const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const byUtf8 = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
const optional = (value: string | null) => (value === null ? 'N' : `V${value}`);
const flag = (value: boolean) => (value ? 'T' : 'F');

/** Canonical lower-case UUID text, exactly PostgreSQL's uuid::text. */
export function canonicalUuid(value: string, reason = 'UUID_INVALID'): string {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID.test(lower)) throw new L14ContractError(reason);
  return lower;
}

function operand(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || value !== value.trim()) {
    throw new L14ContractError('RULE_OPERAND_INVALID');
  }
  return value;
}

/** Closed-contract validation mirroring the database rule constraints (tenant resolution is DB-only). */
export function validateAuthorityPolicyRule(rule: L14AuthorityPolicyRule): void {
  if (!within(L14_PERMISSIONS, rule.permission) || !within(L14_REQUESTED_ACTIONS, rule.requestedAction)
    || !within(L14_SOURCE_CLASSES, rule.sourceClass) || !within(L14_SOURCE_DISPOSITIONS, rule.sourceDisposition)
    || !within(L14_SCOPE_TAGS, rule.scopeTag)
    || (rule.scopeCanonicalKind !== null && !within(KINDS, rule.scopeCanonicalKind))
    || (rule.scopeRelationshipType !== null && !within(RELATIONSHIP_TYPES, rule.scopeRelationshipType))) {
    throw new L14ContractError('RULE_VOCABULARY_UNKNOWN');
  }
  if (!UUID.test(rule.roleId)) throw new L14ContractError('RULE_ROLE_MALFORMED');
  for (const value of [rule.scopeCanonicalKind, rule.scopeCanonicalObjectId, rule.scopeRelationshipType,
    rule.scopeRelationshipId, rule.scopeRelationshipStateId]) operand(value);
  for (const value of [rule.allowSelfValidation, rule.allowFutureDating, rule.allowBackdating]) {
    if (typeof value !== 'boolean') throw new L14ContractError('RULE_FIELD_TYPE_INVALID');
  }
  const present = {
    kind: rule.scopeCanonicalKind !== null, object: rule.scopeCanonicalObjectId !== null,
    type: rule.scopeRelationshipType !== null, relationship: rule.scopeRelationshipId !== null,
    state: rule.scopeRelationshipStateId !== null,
  };
  const shape: Record<L14AuthorityPolicyRule['scopeTag'], boolean> = {
    ALL_ALLOWED_TARGETS: !present.kind && !present.object && !present.type && !present.relationship && !present.state,
    CANONICAL_KIND: present.kind && !present.object && !present.type && !present.relationship && !present.state,
    CANONICAL_OBJECT: present.kind && present.object && !present.type && !present.relationship && !present.state,
    RELATIONSHIP_TYPE: present.type && !present.kind && !present.object && !present.relationship && !present.state,
    RELATIONSHIP_STATE: present.relationship && present.state && !present.kind && !present.object && !present.type,
  };
  if (!shape[rule.scopeTag]) throw new L14ContractError('RULE_SCOPE_OPERANDS_INVALID');
  if (rule.permission.endsWith('_ADMIT') !== (rule.requestedAction === 'ADMIT')) {
    throw new L14ContractError('RULE_PERMISSION_ACTION_INCOMPATIBLE');
  }
  if ((rule.permission === 'L14_AUTHORITY_POLICY_ADMIT' || rule.permission === 'L14_AUTHORITY_POLICY_ADMIN')
    && rule.scopeTag !== 'ALL_ALLOWED_TARGETS') {
    throw new L14ContractError('RULE_AUTHORITY_SCOPE_INVALID');
  }
  if (rule.requestedAction === 'ADMIT' && (rule.allowSelfValidation || rule.allowFutureDating || rule.allowBackdating)) {
    throw new L14ContractError('RULE_ADMIT_FLAGS_INVALID');
  }
}

/** Mirror of gov_repo.l14_authority_policy_rule_frame_v1. */
export function authorityPolicyRuleFrame(rule: L14AuthorityPolicyRule): string {
  validateAuthorityPolicyRule(rule);
  return frameIdentity([
    'L14_AUTHORITY_POLICY_RULE_V1', rule.roleId, rule.permission, rule.requestedAction, rule.sourceClass,
    rule.sourceDisposition, rule.scopeTag, optional(rule.scopeCanonicalKind), optional(rule.scopeCanonicalObjectId),
    optional(rule.scopeRelationshipType), optional(rule.scopeRelationshipId), optional(rule.scopeRelationshipStateId),
    flag(rule.allowSelfValidation), flag(rule.allowFutureDating), flag(rule.allowBackdating),
  ]);
}

/** Mirror of gov_repo.l14_authority_policy_content_hash_v1 over the complete rule set. */
export function authorityPolicyContentHash(rules: readonly L14AuthorityPolicyRule[]): string {
  const frames = rules.map(authorityPolicyRuleFrame).sort(byUtf8);
  if (new Set(frames).size !== frames.length) throw new L14ContractError('RULE_DUPLICATE');
  return sha256Frame(['L14_AUTHORITY_POLICY_CONTENT_V1', String(frames.length), ...frames]);
}

/** Mirror of gov_repo.l14_support_parts_v1 (tenant resolution is DB-only). */
export function supportParts(support: L14Support): string[] {
  if (!within(L14_SUPPORT_STATUSES, support.status) || !Array.isArray(support.evidenceIds)) {
    throw new L14ContractError('SUPPORT_MALFORMED');
  }
  const ids = [...support.evidenceIds];
  if ((support.status === 'NONE') !== (ids.length === 0) || ids.length > 200 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 500 || id !== id.trim())) {
    throw new L14ContractError('SUPPORT_MALFORMED');
  }
  return [support.status, String(ids.length), ...ids.sort(byUtf8)];
}

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';

function temporal(requestedEffectiveFrom: string | null): string[] {
  if (requestedEffectiveFrom === null) return ['IMMEDIATE'];
  if (!CANONICAL_INSTANT.test(requestedEffectiveFrom)) throw new L14ContractError('EFFECTIVE_FROM_NOT_CANONICAL');
  return ['EXPLICIT', requestedEffectiveFrom];
}

export interface L14AdmitFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  /** null = explicit expected-none (first policy). */
  readonly expected: { readonly authorityPolicyId: string; readonly latestVersionId: string } | null;
  readonly sourceClass: L14SourceClass;
  readonly rules: readonly L14AuthorityPolicyRule[];
  readonly support: L14Support;
}

export function admitAuthorityPolicyVersionFingerprint(input: L14AdmitFingerprintInput): string {
  if (!within(L14_SOURCE_CLASSES, input.sourceClass)) throw new L14ContractError('SOURCE_CLASS_UNKNOWN');
  return sha256Frame([
    COMMAND_TAG, 'ADMIT_AUTHORITY_POLICY_VERSION', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', 'AUTHORITY_POLICY_VERSION',
    ...(input.expected === null ? ['EXPECTED_NONE']
      : ['EXPECTED_CURRENT', canonicalUuid(input.expected.authorityPolicyId), canonicalUuid(input.expected.latestVersionId)]),
    input.sourceClass, authorityPolicyContentHash(input.rules), ...supportParts(input.support),
  ]);
}

export interface L14AuthorityPolicyProposalContent {
  readonly subjectKind: L14ProposalSubjectKind;
  readonly intent: L14ProposalIntent;
  readonly sourceClass: L14SourceClass;
  readonly authorityPolicyId: string;
  readonly versionId: string;
  readonly contentHash: string;
  /** null = IMMEDIATE intent (DB transaction instant); otherwise canonical UTC microseconds. */
  readonly requestedEffectiveFrom: string | null;
  readonly targetStateId: string | null;
}

function proposalContentParts(content: L14AuthorityPolicyProposalContent): string[] {
  if (!within(L14_PROPOSAL_SUBJECT_KINDS, content.subjectKind) || !within(L14_PROPOSAL_INTENTS, content.intent)
    || !within(L14_SOURCE_CLASSES, content.sourceClass) || !/^[0-9a-f]{64}$/.test(content.contentHash)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  return [content.subjectKind, content.intent, content.sourceClass, canonicalUuid(content.authorityPolicyId),
    canonicalUuid(content.versionId), content.contentHash, ...temporal(content.requestedEffectiveFrom),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14AuthorityPolicyProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitProposalFingerprint(input: L14SubmitFingerprintInput): string {
  const [subjectKind, intent, sourceClass, ...rest] = proposalContentParts(input.proposal);
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    subjectKind!, intent!, sourceClass!, ...rest,
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14AuthorityPolicyProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function authorityPolicyReasonCode(outcome: L14GovernanceOutcome): L14AuthorityPolicyReasonCode {
  const code = L14_AUTHORITY_POLICY_REASON_CODES[outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

export function decideProposalFingerprint(input: L14DecideFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, authorityPolicyReasonCode(input.outcome), canonicalUuid(input.proposalId),
    ...proposalContentParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
