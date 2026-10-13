import { createHash } from 'node:crypto';
import {
  L15_GOVERNANCE_REASON_CODES, L15_METHODOLOGY_DEFINITION_CODE, L15_METHODOLOGY_DEFINITION_NAMESPACES, L15_METHODOLOGY_LEVEL_CODE,
  L15_RATING_BANDS, L15_REGISTRY_SOURCE_CLASSES, L15_REGISTRY_SUPPORT_MAX_ENTRIES, L15_REGISTRY_SUPPORT_TAGS, L15_RISK_DOMAINS,
  L15_SCENARIO_MAX_SUBJECT_KINDS, L15_SCENARIO_REFERENCE_BOUNDS, L15_SCENARIO_REFERENCE_NAMESPACES, L15_SCENARIO_SUBJECT_TOKENS,
  L15_SUPPORT_TARGET_TAGS, isLegalL15ScenarioSubject, isValidL15ScenarioReference,
  type L14GovernanceOutcome, type L15AssessmentValidityMaximum, type L15MethodologyLevel, type L15MethodologyVersionContent,
  type L15RegistryAdmitExpectation, type L15RegistryProposalContent, type L15RegistrySourceClass, type L15RegistrySubjectKind,
  type L15RegistrySupport, type L15ScenarioDefinitionVersionContent,
} from '@council/canonical-contracts';
import { frameIdentity } from './canonical-endpoint-resolution.ts';
import { L14ContractError, canonicalUuid } from './l14-authority-policy.ts';

/**
 * M17-S2 RISK_SCENARIO_DEFINITION / RISK_METHODOLOGY canonical framing — a byte-for-byte MIRROR of the PostgreSQL helpers and
 * RPCs in 20261013120000_m17_s2_scenario_methodology_registries_v1.sql, for preflight UX only. PostgreSQL recomputes every
 * content hash (GV010 CONTENT_HASH_MISMATCH) and fingerprint (GV008) itself and re-validates every shape; nothing here grants
 * authority, selects a version or validates anything.
 */

const COMMAND_TAG = 'L15_COMMAND_FINGERPRINT_V1';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const HASH = /^[0-9a-f]{64}$/;
const sha256Frame = (parts: readonly string[]) => createHash('sha256').update(frameIdentity(parts), 'utf8').digest('hex');
/** PostgreSQL `ORDER BY convert_to(x, 'UTF8')`: byte order of the UTF-8 encoding. */
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = (reason: string): never => { throw new L14ContractError(reason); };
const within = (values: readonly string[], value: unknown): boolean => typeof value === 'string' && values.includes(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

// ---------------------------------------------------------------------------------------------------------------------
// Scenario content
// ---------------------------------------------------------------------------------------------------------------------

/** Mirror of gov_repo.l15_risk_scenario_content_check_v1 (same closed error details, same order). */
export function checkScenarioContent(content: L15ScenarioDefinitionVersionContent): void {
  if (!within(L15_RISK_DOMAINS, content?.riskDomain)) fail('RISK_DOMAIN_UNKNOWN');
  const subjects = content.subjectKinds;
  if (!Array.isArray(subjects) || subjects.length > L15_SCENARIO_MAX_SUBJECT_KINDS || subjects.some(s => s == null)) fail('SUBJECT_KINDS_MALFORMED');
  if (subjects.length === 0) fail('SUBJECT_KINDS_EMPTY');
  if (subjects.some(s => !within(L15_SCENARIO_SUBJECT_TOKENS, s))) fail('SUBJECT_KIND_UNKNOWN');
  if (new Set(subjects).size !== subjects.length) fail('SUBJECT_KIND_DUPLICATE');
  if (subjects.some(s => !isLegalL15ScenarioSubject(content.riskDomain, s))) fail('DOMAIN_SUBJECT_ILLEGAL');
  const refs = content.references;
  if (!Array.isArray(refs) || refs.length < L15_SCENARIO_REFERENCE_BOUNDS.minReferences
    || refs.length > L15_SCENARIO_REFERENCE_BOUNDS.maxReferences || refs.some(r => r == null || r.namespace == null || r.code == null)) {
    fail('REFERENCES_MALFORMED');
  }
  if (refs.some(r => !within(L15_SCENARIO_REFERENCE_NAMESPACES, r.namespace))) fail('REFERENCE_NAMESPACE_UNKNOWN');
  if (refs.some(r => !isValidL15ScenarioReference(r.namespace, r.code))) fail('REFERENCE_CODE_MALFORMED');
  if (new Set(refs.map(r => frameIdentity([r.namespace, r.code]))).size !== refs.length) fail('REFERENCE_DUPLICATE');
}

/** Mirror of gov_repo.l15_risk_scenario_content_hash_v1 (input order irrelevant). */
export function scenarioContentHash(content: L15ScenarioDefinitionVersionContent): string {
  checkScenarioContent(content);
  const subjects = [...content.subjectKinds].sort(byteOrder);
  const refs = [...content.references].sort((a, b) => byteOrder(a.namespace, b.namespace) || byteOrder(a.code, b.code));
  return sha256Frame(['L15_RISK_SCENARIO_DEFINITION_CONTENT_V1', 'RISK_DOMAIN', content.riskDomain,
    'SUBJECT_KINDS', String(subjects.length), ...subjects,
    'REFERENCES', String(refs.length), ...refs.flatMap(r => [r.namespace, r.code])]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Methodology content
// ---------------------------------------------------------------------------------------------------------------------

/** Mirror of gov_repo.l15_assessment_validity_maximum_parts_v1: [months, days, microseconds] or null (invalid). */
export function validityMaximumParts(value: L15AssessmentValidityMaximum): string[] | null {
  if (!value || !isInt(value.months) || !isInt(value.days) || !isInt(value.microseconds)) return null;
  if (value.months < 0 || value.days < 0 || value.microseconds < 0 || value.months + value.days + value.microseconds <= 0) return null;
  return [String(value.months), String(value.days), String(value.microseconds)];
}

/** The PostgreSQL interval literal of a validity maximum (input to the ADMIT RPC). */
export function validityMaximumInterval(value: L15AssessmentValidityMaximum): string {
  if (validityMaximumParts(value) === null) fail('ASSESSMENT_VALIDITY_MAXIMUM_INVALID');
  return `${value.months} mons ${value.days} days ${value.microseconds} microseconds`;
}

function checkScale(scale: 'LIKELIHOOD' | 'IMPACT', levels: readonly L15MethodologyLevel[]): void {
  if (!Array.isArray(levels) || levels.some(l => l == null || l.levelCode == null || l.ordinal == null
    || l.definition == null || l.definition.namespace == null || l.definition.code == null)) fail(`${scale}_SCALE_MALFORMED`);
  if (levels.length < 2 || levels.length > 7) fail(`${scale}_SCALE_SIZE_INVALID`);
  if (levels.some(l => typeof l.levelCode !== 'string' || !L15_METHODOLOGY_LEVEL_CODE.test(l.levelCode))) fail(`${scale}_LEVEL_CODE_MALFORMED`);
  if (new Set(levels.map(l => l.levelCode)).size !== levels.length) fail(`${scale}_LEVEL_CODE_DUPLICATE`);
  const ordinals = levels.map(l => l.ordinal).sort((a, b) => a - b);
  if (!ordinals.every((o, i) => isInt(o) && o === i + 1)) fail(`${scale}_LEVEL_ORDINAL_INVALID`);
  if (levels.some(l => !within(L15_METHODOLOGY_DEFINITION_NAMESPACES, l.definition.namespace)
    || typeof l.definition.code !== 'string' || l.definition.code.length < 1 || l.definition.code.length > 64
    || !L15_METHODOLOGY_DEFINITION_CODE.test(l.definition.code))) fail(`${scale}_DEFINITION_REFERENCE_MALFORMED`);
}

/** Mirror of gov_repo.l15_risk_methodology_content_check_v1 (same closed error details, same order). */
export function checkMethodologyContent(content: L15MethodologyVersionContent): void {
  checkScale('LIKELIHOOD', content?.likelihoodScale);
  checkScale('IMPACT', content.impactScale);
  const cells = content.ratingMatrix;
  if (!Array.isArray(cells) || cells.some(c => c == null || c.likelihoodLevelCode == null || c.impactLevelCode == null || c.ratingBand == null)) {
    fail('RATING_MATRIX_MALFORMED');
  }
  if (cells.some(c => !within(L15_RATING_BANDS, c.ratingBand))) fail('RATING_BAND_UNKNOWN');
  const lik = new Set(content.likelihoodScale.map(l => l.levelCode));
  const imp = new Set(content.impactScale.map(l => l.levelCode));
  if (cells.some(c => !lik.has(c.likelihoodLevelCode) || !imp.has(c.impactLevelCode))) fail('RATING_MATRIX_LEVEL_UNKNOWN');
  if (new Set(cells.map(c => frameIdentity([c.likelihoodLevelCode, c.impactLevelCode]))).size !== cells.length) fail('RATING_MATRIX_CELL_DUPLICATE');
  if (cells.length !== lik.size * imp.size) fail('RATING_MATRIX_INCOMPLETE');
  if (validityMaximumParts(content.assessmentValidityMaximum) === null) fail('ASSESSMENT_VALIDITY_MAXIMUM_INVALID');
}

/** Mirror of gov_repo.l15_risk_methodology_content_hash_v1 (input order irrelevant). */
export function methodologyContentHash(content: L15MethodologyVersionContent): string {
  checkMethodologyContent(content);
  const byOrdinal = (levels: readonly L15MethodologyLevel[]) => [...levels].sort((a, b) => a.ordinal - b.ordinal);
  const lik = byOrdinal(content.likelihoodScale);
  const imp = byOrdinal(content.impactScale);
  const lord = new Map(lik.map(l => [l.levelCode, l.ordinal]));
  const iord = new Map(imp.map(l => [l.levelCode, l.ordinal]));
  const cells = [...content.ratingMatrix].sort((a, b) =>
    (lord.get(a.likelihoodLevelCode)! - lord.get(b.likelihoodLevelCode)!) || (iord.get(a.impactLevelCode)! - iord.get(b.impactLevelCode)!));
  const levelParts = (levels: readonly L15MethodologyLevel[]) =>
    levels.flatMap(l => [String(l.ordinal), l.levelCode, l.definition.namespace, l.definition.code]);
  return sha256Frame(['L15_RISK_METHODOLOGY_CONTENT_V1',
    'LIKELIHOOD_SCALE', String(lik.length), ...levelParts(lik),
    'IMPACT_SCALE', String(imp.length), ...levelParts(imp),
    'RATING_MATRIX', String(cells.length), ...cells.flatMap(c => [c.likelihoodLevelCode, c.impactLevelCode, c.ratingBand]),
    'ASSESSMENT_VALIDITY_MAXIMUM', ...validityMaximumParts(content.assessmentValidityMaximum)!]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Support, reason codes, fingerprints
// ---------------------------------------------------------------------------------------------------------------------

/** Mirror of gov_repo.l15_registry_support_parts_v1. */
export function registrySupportParts(support: L15RegistrySupport): string[] {
  const entries = support?.entries;
  if (!support || !['NONE', 'PRESENT'].includes(support.status) || !Array.isArray(entries) || entries.some(e => e == null || e.tag == null || e.targetId == null)) {
    fail('SUPPORT_MALFORMED');
  }
  if ((support.status === 'NONE') !== (entries.length === 0) || entries.length > L15_REGISTRY_SUPPORT_MAX_ENTRIES
    || entries.some(e => typeof e.targetId !== 'string' || e.targetId.length < 1 || e.targetId.length > 500 || e.targetId !== e.targetId.trim())) {
    fail('SUPPORT_MALFORMED');
  }
  if (entries.some(e => !within(L15_SUPPORT_TARGET_TAGS, e.tag))) fail('SUPPORT_TAG_UNKNOWN');
  if (entries.some(e => !within(L15_REGISTRY_SUPPORT_TAGS, e.tag))) fail('SUPPORT_TARGET_NOT_ADMISSIBLE');
  if (new Set(entries.map(e => frameIdentity([e.tag, e.targetId]))).size !== entries.length) fail('SUPPORT_DUPLICATE');
  const sorted = [...entries].sort((a, b) => byteOrder(a.tag, b.tag) || byteOrder(a.targetId, b.targetId));
  return ['SUPPORT', support.status, String(entries.length), ...sorted.flatMap(e => [e.tag, e.targetId])];
}

/** The unchanged subject x outcome reason-code rule (no new semantics). */
export function l15RegistryReasonCode(subjectKind: L15RegistrySubjectKind, outcome: L14GovernanceOutcome): string {
  const code = L15_GOVERNANCE_REASON_CODES[subjectKind]?.[outcome];
  return code ?? fail('DECISION_VOCABULARY_INVALID');
}

function expectationParts(expectation: L15RegistryAdmitExpectation, versionId: string): string[] {
  if (expectation?.kind === 'EXPECTED_NONE') return ['EXPECTED_NONE'];
  if (expectation?.kind === 'EXPECTED_CURRENT') {
    const latest = canonicalUuid(expectation.latestVersionId, 'EXPECTATION_MALFORMED');
    if (latest === versionId) fail('EXPECTATION_MALFORMED');
    return ['EXPECTED_CURRENT', latest];
  }
  return fail('EXPECTATION_MALFORMED');
}

function sourceClass(value: L15RegistrySourceClass): string {
  if (value === ('SOURCE_CONNECTION' as never)) fail('SOURCE_CLASS_NOT_EXECUTABLE');
  return within(L15_REGISTRY_SOURCE_CLASSES, value) ? value : fail('SOURCE_CLASS_UNKNOWN');
}

interface AdmitBase {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly identityId: string;
  readonly versionId: string;
  readonly expectation: L15RegistryAdmitExpectation;
  readonly sourceClass: L15RegistrySourceClass;
}
export interface L15AdmitScenarioVersionFingerprintInput extends AdmitBase { readonly content: L15ScenarioDefinitionVersionContent }
export interface L15AdmitMethodologyVersionFingerprintInput extends AdmitBase { readonly content: L15MethodologyVersionContent }

function admitFingerprint(command: string, subject: L15RegistrySubjectKind, input: AdmitBase, contentHash: string): string {
  const identity = canonicalUuid(input.identityId, `${subject}_IDS_REQUIRED`);
  const version = canonicalUuid(input.versionId, `${subject}_IDS_REQUIRED`);
  if (identity === version) fail(`${subject}_IDS_REQUIRED`);
  const expectation = expectationParts(input.expectation, version);
  return sha256Frame([COMMAND_TAG, command, canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId), 'ADMIT', subject,
    identity, version, contentHash, sourceClass(input.sourceClass), ...expectation]);
}

export function admitScenarioVersionFingerprint(input: L15AdmitScenarioVersionFingerprintInput): string {
  return admitFingerprint('ADMIT_RISK_SCENARIO_DEFINITION_VERSION', 'RISK_SCENARIO_DEFINITION', input, scenarioContentHash(input.content));
}

export function admitMethodologyVersionFingerprint(input: L15AdmitMethodologyVersionFingerprintInput): string {
  return admitFingerprint('ADMIT_RISK_METHODOLOGY_VERSION', 'RISK_METHODOLOGY', input, methodologyContentHash(input.content));
}

function proposalParts(p: L15RegistryProposalContent): string[] {
  if (!within(['VALIDATE', 'REVOKE'], p.intent)) fail('PROPOSAL_VOCABULARY_UNKNOWN');
  if (!HASH.test(p.contentHash)) fail('CONTENT_HASH_MALFORMED');
  if ((p.intent === 'VALIDATE') !== (p.targetStateId === null)) fail(p.intent === 'VALIDATE' ? 'TARGET_STATE_NOT_PERMITTED' : 'TARGET_STATE_REQUIRED');
  if (p.requestedEffectiveFrom !== null && !CANONICAL_INSTANT.test(p.requestedEffectiveFrom)) fail('EFFECTIVE_FROM_NOT_CANONICAL');
  return [p.subjectKind, p.intent, sourceClass(p.sourceClass), canonicalUuid(p.identityId), canonicalUuid(p.versionId), p.contentHash];
}
const temporalParts = (p: L15RegistryProposalContent) => (p.requestedEffectiveFrom === null ? ['IMMEDIATE'] : ['EXPLICIT', p.requestedEffectiveFrom]);
const targetParts = (p: L15RegistryProposalContent) => (p.targetStateId === null ? ['NO_TARGET_STATE'] : ['TARGET_STATE', canonicalUuid(p.targetStateId)]);

export interface L15SubmitRegistryProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly proposal: L15RegistryProposalContent;
  readonly priorProposalId: string | null;
  readonly support: L15RegistrySupport;
}

export function submitRegistryProposalFingerprint(input: L15SubmitRegistryProposalFingerprintInput): string {
  const support = registrySupportParts(input.support);
  if (input.proposal.sourceClass === 'SYSTEM_SEED' && input.support.status !== 'PRESENT') fail('SYSTEM_SEED_SUPPORT_REQUIRED');
  return sha256Frame([COMMAND_TAG, 'SUBMIT_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    ...proposalParts(input.proposal), ...temporalParts(input.proposal), ...targetParts(input.proposal),
    ...(input.priorProposalId === null ? ['NO_PRIOR_PROPOSAL'] : ['PRIOR_PROPOSAL', canonicalUuid(input.priorProposalId)]),
    ...support]);
}

export interface L15DecideRegistryProposalFingerprintInput {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly outcome: L14GovernanceOutcome;
  readonly proposalId: string;
  /** The immutable content of the proposal being decided (PostgreSQL reads its own copy). */
  readonly proposal: L15RegistryProposalContent;
  /** null = explicit expected-none. */
  readonly expectedCurrentStateId: string | null;
  readonly support: L15RegistrySupport;
}

export function decideRegistryProposalFingerprint(input: L15DecideRegistryProposalFingerprintInput): string {
  const support = registrySupportParts(input.support);
  const [subject, ...rest] = proposalParts(input.proposal);
  return sha256Frame([COMMAND_TAG, 'DECIDE_PROPOSAL', canonicalUuid(input.organisationId), canonicalUuid(input.actorUserId),
    input.outcome, l15RegistryReasonCode(input.proposal.subjectKind, input.outcome), canonicalUuid(input.proposalId),
    subject, ...rest, ...temporalParts(input.proposal), ...targetParts(input.proposal),
    ...(input.expectedCurrentStateId === null ? ['EXPECTED_NONE'] : ['EXPECTED_CURRENT', canonicalUuid(input.expectedCurrentStateId)]),
    ...support]);
}
