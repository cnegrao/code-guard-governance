import { createHash } from 'node:crypto';
import {
  L14_DOMAIN_ID_MAX_LENGTH, L14_DOMAIN_SUBJECT_KINDS, L14_PROPOSAL_INTENTS, L14_REGISTRY_REASON_CODES, L14_SOURCE_CLASSES,
  type L14DomainProposalContent, type L14DomainSubjectKind, type L14GovernanceOutcome, type L14RegistryReasonCode,
  type L14SourceClass, type L14Support,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid, supportParts } from './l14-authority-policy.ts';

/**
 * M16-S1B.5 BUSINESS_DOMAIN / INFORMATION_DOMAIN canonical framing — a byte-for-byte MIRROR of the PostgreSQL RPCs in
 * 20261008180000_m16_s1b5_domain_registries_v1.sql. PostgreSQL recomputes every fingerprint itself (a mismatch is
 * GV008) and re-validates every shape; nothing here grants authority. The domain id is the L6 identity verbatim.
 */

const COMMAND_TAG = 'L14_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
// PostgreSQL: length (code points) 1..500, equal to btrim (leading / trailing spaces), no [[:cntrl:]] character
// (PostgreSQL stays authoritative: its locale-aware class may reject more than the ASCII controls checked here).
const CONTROL = /[\u0000-\u001f\u007f]/;
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');

function subjectKind(value: L14DomainSubjectKind): string {
  if (!within(L14_DOMAIN_SUBJECT_KINDS, value)) throw new L14ContractError('DOMAIN_KIND_UNKNOWN');
  return value;
}

/** Mirror of the PostgreSQL domain id shape check (DOMAIN_ID_MALFORMED). */
export function l14DomainId(value: string): string {
  if (typeof value !== 'string') throw new L14ContractError('DOMAIN_ID_MALFORMED');
  const length = [...value].length;
  if (length < 1 || length > L14_DOMAIN_ID_MAX_LENGTH || value !== value.replace(/^ +| +$/g, '') || CONTROL.test(value)) {
    throw new L14ContractError('DOMAIN_ID_MALFORMED');
  }
  return value;
}

function temporal(requestedEffectiveFrom: string | null): string[] {
  if (requestedEffectiveFrom === null) return ['IMMEDIATE'];
  if (!CANONICAL_INSTANT.test(requestedEffectiveFrom)) throw new L14ContractError('EFFECTIVE_FROM_NOT_CANONICAL');
  return ['EXPLICIT', requestedEffectiveFrom];
}

/** Mirror of gov_repo.l14_domain_content_hash_v1 (F-4 attempted-content evidence of an ADMIT). */
export function domainContentHash(kind: L14DomainSubjectKind, domainId: string): string {
  return sha256Frame(['L14_DOMAIN_CONTENT_V1', subjectKind(kind), l14DomainId(domainId)]);
}

/** Mirror of the domain reason-code rule (one closed code per kind x outcome). */
export function domainReasonCode(kind: L14DomainSubjectKind, outcome: L14GovernanceOutcome): L14RegistryReasonCode {
  const code = L14_REGISTRY_REASON_CODES[subjectKind(kind) as L14DomainSubjectKind][outcome];
  if (!code) throw new L14ContractError('DECISION_VOCABULARY_INVALID');
  return code;
}

export interface L14AdmitDomainFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly subjectKind: L14DomainSubjectKind;
  readonly domainId: string;
  readonly sourceClass: L14SourceClass;
  readonly support: L14Support;
}

/** An ADMIT is always EXPECTED_NONE: the exact L6 identity must not be admitted yet. */
export function admitDomainFingerprint(input: L14AdmitDomainFingerprintInput): string {
  if (!within(L14_SOURCE_CLASSES, input.sourceClass)) throw new L14ContractError('SOURCE_CLASS_UNKNOWN');
  const kind = subjectKind(input.subjectKind);
  return sha256Frame([
    COMMAND_TAG, `ADMIT_${kind}`, canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    'ADMIT', kind, l14DomainId(input.domainId), input.sourceClass, 'EXPECTED_NONE',
    ...supportParts(input.support),
  ]);
}

function proposalContentParts(content: L14DomainProposalContent): string[] {
  if (!within(L14_PROPOSAL_INTENTS, content.intent) || !within(L14_DOMAIN_SUBJECT_KINDS, content.subjectKind)
    || !within(L14_SOURCE_CLASSES, content.sourceClass)) {
    throw new L14ContractError('PROPOSAL_VOCABULARY_UNKNOWN');
  }
  if ((content.intent === 'VALIDATE') !== (content.targetStateId === null)) {
    throw new L14ContractError(content.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  }
  return [content.subjectKind, content.intent, content.sourceClass, l14DomainId(content.domainId),
    ...temporal(content.requestedEffectiveFrom),
    ...(content.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(content.targetStateId)])];
}

export interface L14SubmitDomainProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L14DomainProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L14Support;
}

export function submitDomainProposalFingerprint(input: L14SubmitDomainProposalFingerprintInput): string {
  return sha256Frame([
    COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalContentParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...supportParts(input.support),
  ]);
}

export interface L14DecideDomainProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L14DomainProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L14Support;
}

export function decideDomainProposalFingerprint(input: L14DecideDomainProposalFingerprintInput): string {
  const parts = proposalContentParts(input.proposal);
  return sha256Frame([
    COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, domainReasonCode(input.proposal.subjectKind, input.outcome), canonicalUuid(input.proposalId),
    ...parts,
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...supportParts(input.support),
  ]);
}
