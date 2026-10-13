import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L15MethodologyLevel, L15MethodologyVersionContent, L15RatingBand,
  L15RegistryAdmitExpectation, L15RegistryProposalContent, L15RegistrySubjectKind, L15RegistrySupport,
  L15ScenarioDefinitionVersionContent,
} from '@council/canonical-contracts';
import {
  admitMethodologyVersionFingerprint, admitScenarioVersionFingerprint, decideRegistryProposalFingerprint, l15RegistryReasonCode,
  methodologyContentHash, scenarioContentHash, submitRegistryProposalFingerprint, validityMaximumInterval,
} from '@council/governance-review';
import { canonicalObjectKit, lit, named } from './m16-governed-write-fixtures';
import { lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { successorKit } from './m16-l14-successor-fixtures';

/**
 * M17-S2 fixtures on the M17S2-horizon L14 cluster (full canonical chain + M16 + M17-S0 + S1 + S1R1 + S2). Owner access only
 * inserts administrator support rows (organisations, users, roles, discovery evidence, source assertions) and runs
 * rolled-back probes. Every governance write goes through the real RPCs as service_role with a verified principal; the L15
 * authority enters each organisation ONLY through a normal Authority Policy successor validated under the effective policy
 * (there is no L15 bootstrap).
 */
export const REGISTRY_TABLES = [
  'l15_risk_scenario_definitions', 'l15_risk_scenario_definition_versions', 'l15_risk_scenario_definition_subject_kinds',
  'l15_risk_scenario_definition_references', 'l15_risk_scenario_definition_states', 'l15_risk_scenario_definition_proposals',
  'l15_risk_scenario_definition_heads', 'l15_risk_methodologies', 'l15_risk_methodology_versions',
  'l15_risk_methodology_likelihood_levels', 'l15_risk_methodology_impact_levels', 'l15_risk_methodology_rating_cells',
  'l15_risk_methodology_states', 'l15_risk_methodology_proposals', 'l15_risk_methodology_heads',
] as const;
export const NONE: L15RegistrySupport = Object.freeze({ status: 'NONE', entries: [] as const });
export const SCENARIO = 'RISK_SCENARIO_DEFINITION' as const;
export const METHODOLOGY = 'RISK_METHODOLOGY' as const;

const textArray = (vs: readonly unknown[]) => (vs.length ? `array[${vs.map(v => (v === null ? 'null' : lit(String(v)))).join(',')}]::text[]` : `'{}'::text[]`);
const intArray = (vs: readonly unknown[]) => (vs.length ? `array[${vs.map(v => (v === null ? 'null' : String(v))).join(',')}]::integer[]` : `'{}'::integer[]`);
const uuidOrNull = (v: string | null | undefined) => (v == null ? 'null::uuid' : `${lit(v)}::uuid`);
const tsOrNull = (v: string | null | undefined) => (v == null ? 'null::timestamptz' : `${lit(v)}::timestamptz`);

export const scenarioContent = (over: Partial<L15ScenarioDefinitionVersionContent> = {}, code = 'SCN-1'): L15ScenarioDefinitionVersionContent => ({
  riskDomain: 'PRIVACY', subjectKinds: ['DATA_ELEMENT', 'REL:READS_FROM'],
  references: [{ namespace: 'ORGANISATION_SCENARIO_CODE', code }, { namespace: 'SCANNER_RULE_ID', code: 'RISK-PII-DETECTED' }], ...over,
});

const level = (code: string, ordinal: number): L15MethodologyLevel => ({ levelCode: code, ordinal,
  definition: { namespace: 'ORGANISATION_DEFINITION_CODE', code: `DEF-${code}` } });
const BANDS: readonly L15RatingBand[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
export function methodologyContent(n = 3, m = 3, over: Partial<L15MethodologyVersionContent> = {}): L15MethodologyVersionContent {
  const likelihoodScale = Array.from({ length: n }, (_, i) => level(`L${i + 1}`, i + 1));
  const impactScale = Array.from({ length: m }, (_, i) => level(`I${i + 1}`, i + 1));
  const ratingMatrix = likelihoodScale.flatMap((l, i) => impactScale.map((im, j) => ({
    likelihoodLevelCode: l.levelCode, impactLevelCode: im.levelCode, ratingBand: BANDS[Math.min(3, Math.floor((i + j) / 2))]! })));
  return { likelihoodScale, impactScale, ratingMatrix, assessmentValidityMaximum: { months: 0, days: 90, microseconds: 0 }, ...over };
}

/** Raw (deliberately loose) scenario operands so adversarial shapes can be sent past the TS mirror. */
export interface RawScenario { domain: string | null; subjects: readonly (string | null)[]; ns: readonly (string | null)[]; codes: readonly (string | null)[] }
export const rawScenario = (c: L15ScenarioDefinitionVersionContent): RawScenario => ({
  domain: c.riskDomain, subjects: c.subjectKinds, ns: c.references.map(r => r.namespace), codes: c.references.map(r => r.code) });
export interface RawMethodology {
  likCodes: readonly (string | null)[]; likOrd: readonly (number | null)[]; likNs: readonly string[]; likDef: readonly string[];
  impCodes: readonly (string | null)[]; impOrd: readonly (number | null)[]; impNs: readonly string[]; impDef: readonly string[];
  mLik: readonly string[]; mImp: readonly string[]; mBand: readonly string[]; validity: string | null;
}
export const rawMethodology = (c: L15MethodologyVersionContent): RawMethodology => ({
  likCodes: c.likelihoodScale.map(l => l.levelCode), likOrd: c.likelihoodScale.map(l => l.ordinal),
  likNs: c.likelihoodScale.map(l => l.definition.namespace), likDef: c.likelihoodScale.map(l => l.definition.code),
  impCodes: c.impactScale.map(l => l.levelCode), impOrd: c.impactScale.map(l => l.ordinal),
  impNs: c.impactScale.map(l => l.definition.namespace), impDef: c.impactScale.map(l => l.definition.code),
  mLik: c.ratingMatrix.map(x => x.likelihoodLevelCode), mImp: c.ratingMatrix.map(x => x.impactLevelCode),
  mBand: c.ratingMatrix.map(x => x.ratingBand), validity: validityMaximumInterval(c.assessmentValidityMaximum),
});

export interface AdmitOps {
  commandId: string; identityId: string; versionId: string; expectation?: L15RegistryAdmitExpectation;
  sourceClass?: string; hash?: string; fingerprint?: string; session?: SessionOverride;
}

export async function m17s2Kit(c: L14Cluster) {
  const { owner, exec } = c;
  const sk = await successorKit(c);
  const role = async (code: string) => {
    const existing = (await owner(`select role_id from gov_repo.governance_roles where role_code='${code}'`)).trim();
    if (existing) return existing;
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const roles = {
    scenarioAdmit: await role('M17_SCENARIO_ADMIT'), scenarioValidate: await role('M17_SCENARIO_VALIDATE'),
    methodologyAdmit: await role('M17_METHODOLOGY_ADMIT'), methodologyValidate: await role('M17_METHODOLOGY_VALIDATE'),
    l14Registry: await role('M17_L14_CONTROL_STEWARD'), self: await role('M17_SCENARIO_SELF'), dating: await role('M17_REGISTRY_DATING'),
    scenarioValidateOnly: await role('M17_SCENARIO_VALIDATE_ONLY'),
  };
  const decideActions = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
  const l15Rules = (): L14AuthorityPolicyRule[] => [
    rule(roles.scenarioAdmit, 'L15_RISK_SCENARIO_ADMIT', 'ADMIT'),
    ...decideActions.map(a => rule(roles.scenarioValidate, 'L15_RISK_SCENARIO_VALIDATE', a)),
    rule(roles.methodologyAdmit, 'L15_RISK_METHODOLOGY_ADMIT', 'ADMIT'),
    ...decideActions.map(a => rule(roles.methodologyValidate, 'L15_RISK_METHODOLOGY_VALIDATE', a)),
    rule(roles.l14Registry, 'L14_CONTROL_DEFINITION_ADMIT', 'ADMIT'),
    ...decideActions.map(a => rule(roles.l14Registry, 'L14_CONTROL_DEFINITION_VALIDATE', a)),
    ...decideActions.map(a => rule(roles.self, 'L15_RISK_SCENARIO_VALIDATE', a, a === 'VALIDATE' ? { allowSelfValidation: true } : {})),
    ...(['VALIDATE', 'REVOKE'] as const).map(a => rule(roles.dating, 'L15_RISK_SCENARIO_VALIDATE', a, { allowBackdating: true, allowFutureDating: true })),
    ...(['VALIDATE', 'REVOKE'] as const).map(a => rule(roles.dating, 'L15_RISK_METHODOLOGY_VALIDATE', a, { allowBackdating: true, allowFutureDating: true })),
    rule(roles.scenarioValidateOnly, 'L15_RISK_SCENARIO_VALIDATE', 'VALIDATE'),
  ];

  /** M16 Authority Policy administration only (no registry rule with a non-organisation scope). */
  const opsRules = () => sk.opsRules().filter(r => r.permission !== 'L14_PARTY_VALIDATE');
  let n = 0;
  /** An organisation with the M16 AP v1 (L14 only) and, unless `l15 = false`, an AP successor carrying the L15 rules. */
  async function setup(l15 = true) {
    const base = await sk.setup(opsRules());
    const u = async (...r: string[]) => c.mkUser(base.org, r);
    const actors = {
      scenarioAdmitter: await u(roles.scenarioAdmit), scenarioValidator: await u(roles.scenarioValidate),
      scenarioValidator2: await u(roles.scenarioValidate),
      methodologyAdmitter: await u(roles.methodologyAdmit), methodologyValidator: await u(roles.methodologyValidate),
      l14Steward: await u(roles.l14Registry), self: await u(roles.self, roles.scenarioAdmit), dater: await u(roles.dating),
      validateOnly: await u(roles.scenarioValidateOnly), admin: await u(c.adminRole), member: base.member,
    };
    if (l15) await sk.successor(base, 'l15', [...opsRules(), ...l15Rules()]);
    const label = `s2o${++n}`;
    const ev = await c.evidence(base.org, `evidence:${label}`);
    const kit = canonicalObjectKit(base.org, `s2-${label}`, 'AGENT', { proposedIdentity: { reference: label }, identity: `s2-${label}` });
    await owner(kit.sql);
    const assertion = `assertion-s2-${label}`;
    return { ...base, ...actors, evidence: ev, assertion, cmd: (x: string) => `${label}-${x}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  function admitScenarioSqlRaw(actor: Actor, o: AdmitOps, raw: RawScenario, contentForFp?: L15ScenarioDefinitionVersionContent) {
    const expectation = o.expectation ?? { kind: 'EXPECTED_NONE' } as const;
    const sourceClass = o.sourceClass ?? 'LOCAL_HUMAN';
    const hash = o.hash ?? (contentForFp ? scenarioContentHash(contentForFp) : 'a'.repeat(64));
    const fingerprint = o.fingerprint ?? (contentForFp ? admitScenarioVersionFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, identityId: o.identityId, versionId: o.versionId, expectation, sourceClass: sourceClass as never,
      content: contentForFp }) : 'b'.repeat(64));
    return `select to_json(r) from gov_repo.l15_admit_scenario_version_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_scenario_definition_id: uuidOrNull(o.identityId),
      p_scenario_definition_version_id: uuidOrNull(o.versionId), p_expectation_kind: lit(expectation.kind),
      p_expected_latest_version_id: uuidOrNull(expectation.kind === 'EXPECTED_CURRENT' ? expectation.latestVersionId : null),
      p_risk_domain: raw.domain === null ? 'null::text' : lit(raw.domain), p_subject_kinds: textArray(raw.subjects),
      p_reference_namespaces: textArray(raw.ns), p_reference_codes: textArray(raw.codes), p_content_hash: lit(hash),
      p_source_class: lit(sourceClass), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const admitScenarioSql = (actor: Actor, o: AdmitOps, content: L15ScenarioDefinitionVersionContent) =>
    admitScenarioSqlRaw(actor, o, rawScenario(content), content);

  function admitMethodologySqlRaw(actor: Actor, o: AdmitOps, raw: RawMethodology, contentForFp?: L15MethodologyVersionContent) {
    const expectation = o.expectation ?? { kind: 'EXPECTED_NONE' } as const;
    const sourceClass = o.sourceClass ?? 'LOCAL_HUMAN';
    const hash = o.hash ?? (contentForFp ? methodologyContentHash(contentForFp) : 'a'.repeat(64));
    const fingerprint = o.fingerprint ?? (contentForFp ? admitMethodologyVersionFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, identityId: o.identityId, versionId: o.versionId, expectation, sourceClass: sourceClass as never,
      content: contentForFp }) : 'b'.repeat(64));
    return `select to_json(r) from gov_repo.l15_admit_methodology_version_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_methodology_id: uuidOrNull(o.identityId),
      p_methodology_version_id: uuidOrNull(o.versionId), p_expectation_kind: lit(expectation.kind),
      p_expected_latest_version_id: uuidOrNull(expectation.kind === 'EXPECTED_CURRENT' ? expectation.latestVersionId : null),
      p_likelihood_level_codes: textArray(raw.likCodes), p_likelihood_ordinals: intArray(raw.likOrd),
      p_likelihood_definition_namespaces: textArray(raw.likNs), p_likelihood_definition_codes: textArray(raw.likDef),
      p_impact_level_codes: textArray(raw.impCodes), p_impact_ordinals: intArray(raw.impOrd),
      p_impact_definition_namespaces: textArray(raw.impNs), p_impact_definition_codes: textArray(raw.impDef),
      p_matrix_likelihood_level_codes: textArray(raw.mLik), p_matrix_impact_level_codes: textArray(raw.mImp),
      p_matrix_rating_bands: textArray(raw.mBand),
      p_assessment_validity_maximum: raw.validity === null ? 'null::interval' : `${lit(raw.validity)}::interval`,
      p_content_hash: lit(hash), p_source_class: lit(sourceClass), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const admitMethodologySql = (actor: Actor, o: AdmitOps, content: L15MethodologyVersionContent) =>
    admitMethodologySqlRaw(actor, o, rawMethodology(content), content);

  const short = (s: L15RegistrySubjectKind) => (s === SCENARIO ? 'scenario' : 'methodology');
  const idCols = (s: L15RegistrySubjectKind) => (s === SCENARIO
    ? { id: 'p_scenario_definition_id', ver: 'p_scenario_definition_version_id' } : { id: 'p_methodology_id', ver: 'p_methodology_version_id' });
  const supportSql = (s: L15RegistrySupport) => ({ p_support_status: lit(s.status), p_support_tags: textArray(s.entries.map(e => e.tag)),
    p_support_target_ids: textArray(s.entries.map(e => e.targetId)) });

  interface SubmitOps { commandId: string; proposal: L15RegistryProposalContent; prior?: string | null; support?: L15RegistrySupport;
    fingerprint?: string; session?: SessionOverride }
  function submitSql(actor: Actor, o: SubmitOps) {
    const support = o.support ?? NONE, prior = o.prior ?? null, p = o.proposal;
    const fingerprint = o.fingerprint ?? submitRegistryProposalFingerprint({ organisationId: o.session?.org ?? actor.org, actorUserId: actor.id,
      proposal: p, priorProposalId: prior, support });
    const ids = idCols(p.subjectKind);
    return `select to_json(r) from gov_repo.l15_submit_${short(p.subjectKind)}_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_intent: lit(p.intent), p_source_class: lit(p.sourceClass),
      [ids.id]: uuidOrNull(p.identityId), [ids.ver]: uuidOrNull(p.versionId), p_content_hash: lit(p.contentHash),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_target_state_id: uuidOrNull(p.targetStateId),
      p_prior_proposal_id: uuidOrNull(prior), ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideOps { commandId: string; proposalId: string; proposal: L15RegistryProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L15RegistrySupport; fingerprint?: string; reason?: string; session?: SessionOverride;
    via?: L15RegistrySubjectKind }
  function decideSql(actor: Actor, o: DecideOps) {
    const support = o.support ?? NONE, outcome = o.outcome ?? 'VALIDATE', expected = o.expected ?? null;
    const fingerprint = o.fingerprint ?? decideRegistryProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, outcome, proposalId: o.proposalId, proposal: o.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l15_decide_${short(o.via ?? o.proposal.subjectKind)}_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_proposal_id: uuidOrNull(o.proposalId), p_outcome: lit(outcome),
      p_reason_code: lit(o.reason ?? l15RegistryReasonCode(o.proposal.subjectKind, outcome)), p_expected_current_state_id: uuidOrNull(expected),
      ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }

  const proposalOf = (subjectKind: L15RegistrySubjectKind, admitted: Record<string, any>, over: Partial<L15RegistryProposalContent> = {}): L15RegistryProposalContent => ({
    subjectKind, intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN',
    identityId: admitted[subjectKind === SCENARIO ? 'scenario_definition_id' : 'methodology_id'],
    versionId: admitted[subjectKind === SCENARIO ? 'scenario_definition_version_id' : 'methodology_version_id'],
    contentHash: admitted.content_hash, requestedEffectiveFrom: null, targetStateId: null, ...over });
  const evidenceSupport = (id: string): L15RegistrySupport => ({ status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: id }] });

  async function admitScenario(x: Ctx, name: string, content = scenarioContent({}, `SCN-${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`),
    o: Partial<AdmitOps> = {}, actor: Actor = x.scenarioAdmitter) {
    return exec(admitScenarioSql(actor, { commandId: x.cmd(`${name}-admit`), identityId: randomUUID(), versionId: randomUUID(), ...o }, content));
  }
  async function admitMethodology(x: Ctx, name: string, content = methodologyContent(), o: Partial<AdmitOps> = {}, actor: Actor = x.methodologyAdmitter) {
    return exec(admitMethodologySql(actor, { commandId: x.cmd(`${name}-admit`), identityId: randomUUID(), versionId: randomUUID(), ...o }, content));
  }
  /** SUBMIT (member) -> DECIDE VALIDATE (validator) of an admitted version. */
  async function validate(x: Ctx, name: string, subjectKind: L15RegistrySubjectKind, admitted: Record<string, any>,
    validator: Actor = subjectKind === SCENARIO ? x.scenarioValidator : x.methodologyValidator, expected: string | null = null,
    over: Partial<L15RegistryProposalContent> = {}, support: L15RegistrySupport = NONE) {
    const proposal = proposalOf(subjectKind, admitted, over);
    const submitted = await exec(submitSql(x.member, { commandId: x.cmd(`${name}-submit`), proposal, support }));
    const decided = await exec(decideSql(validator, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal, expected }));
    return { proposal, submitted, decided };
  }
  async function revoke(x: Ctx, name: string, subjectKind: L15RegistrySubjectKind, admitted: Record<string, any>, stateId: string,
    validator: Actor = subjectKind === SCENARIO ? x.scenarioValidator : x.methodologyValidator) {
    const proposal = proposalOf(subjectKind, admitted, { intent: 'REVOKE', targetStateId: stateId });
    const submitted = await exec(submitSql(x.member, { commandId: x.cmd(`${name}-submit`), proposal }));
    const decided = await exec(decideSql(validator, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal,
      outcome: 'REVOKE', expected: stateId }));
    return { proposal, submitted, decided };
  }
  const json = async (query: string) => JSON.parse(lastLine(await owner(query)));
  const one = async (query: string) => lastLine(await owner(query));
  const counts = async (org: string) => json(`select json_build_object(${[...REGISTRY_TABLES, 'l14_authorization_decisions', 'l14_proposals',
    'l14_governance_decisions', 'l14_command_results', 'l15_support_links'].map(t => `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`) as Promise<Record<string, number>>;
  const resolve = async (subjectKind: L15RegistrySubjectKind, org: string, admitted: Record<string, any>, at: string, cutoff: string) => {
    const p = proposalOf(subjectKind, admitted);
    const rows = await json(`select coalesce(json_agg(r), '[]') from gov_repo.${subjectKind === SCENARIO ? 'l15_risk_scenario_definition' : 'l15_risk_methodology'}_valid_state_v1(
      '${org}', '${p.identityId}', '${p.versionId}', '${p.contentHash}', ${at}, ${cutoff}) r`) as Array<{ state_id: string }>;
    return rows.length === 1 ? rows[0]!.state_id : rows.length === 0 ? null : 'AMBIGUOUS';
  };
  const instant = sk.instant;
  return { sk, roles, l15Rules, opsRules, setup, admitScenarioSql, admitScenarioSqlRaw, admitMethodologySql, admitMethodologySqlRaw, submitSql,
    decideSql, proposalOf, evidenceSupport, admitScenario, admitMethodology, validate, revoke, json, one, counts, resolve, instant };
}
export type M17S2Kit = Awaited<ReturnType<typeof m17s2Kit>>;
