import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L15InherentRiskAssessmentProposalContent, L15MethodologyLevel,
  L15MethodologyVersionContent, L15RatingBand, L15RiskAssessmentSupport,
} from '@council/canonical-contracts';
import {
  decideRiskAssessmentProposalFingerprint, riskAssessmentReasonCode, submitRiskAssessmentProposalFingerprint,
} from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { METHODOLOGY } from './m17-s2-fixtures';
import { m17s3Kit, objectSubject, type Rel } from './m17-s3-fixtures';

/**
 * M17-S4 INHERENT RISK_ASSESSMENT fixtures on the M17S4-horizon L14 cluster (full canonical chain + M16 + M17-S0..S3R1 + S4).
 * Owner access only inserts administrator support rows (via the S1..S3 kits) and runs rolled-back probes. Every governance
 * write goes through the real RPCs as service_role with a verified principal and the caller fingerprint computed by the
 * production TypeScript mirror; L15 authority enters each organisation ONLY through a normal Authority Policy successor.
 */
export const RA_TABLES = ['l15_risk_assessment_proposals', 'l15_risk_assessment_states', 'l15_risk_assessment_heads'] as const;
export const NONE: L15RiskAssessmentSupport = Object.freeze({ status: 'NONE', entries: [] as const });
export const BOGUS = 'b'.repeat(64);
export const BANDS: readonly L15RatingBand[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

const textArray = (vs: readonly unknown[]) => (vs.length ? `array[${vs.map(v => (v === null ? 'null' : lit(String(v)))).join(',')}]::text[]` : `'{}'::text[]`);
const uuidOrNull = (v: string | null | undefined) => (v == null ? 'null::uuid' : `${lit(v)}::uuid`);
const tsOrNull = (v: string | null | undefined) => (v == null ? 'null::timestamptz' : `${lit(v)}::timestamptz`);
const textOrNull = (v: string | null | undefined) => (v == null ? 'null::text' : lit(v));

const level = (code: string, ordinal: number): L15MethodologyLevel => ({ levelCode: code, ordinal,
  definition: { namespace: 'ORGANISATION_DEFINITION_CODE', code: `DEF-${code}` } });
/**
 * A 4 x 4 methodology whose TOTAL matrix is deliberately NOT monotone in the ordinals (the corner L1 x I1 is CRITICAL and
 * L4 x I4 is LOW): any arithmetic over ordinals (product, sum, average) would disagree with it, so a stored band can only be
 * reproduced by the exact cell lookup. Every band appears.
 */
export const NON_MONOTONE_CELLS: Readonly<Record<string, L15RatingBand>> = Object.freeze({
  'L1:I1': 'CRITICAL', 'L1:I2': 'LOW', 'L1:I3': 'MODERATE', 'L1:I4': 'HIGH',
  'L2:I1': 'LOW', 'L2:I2': 'HIGH', 'L2:I3': 'CRITICAL', 'L2:I4': 'MODERATE',
  'L3:I1': 'MODERATE', 'L3:I2': 'CRITICAL', 'L3:I3': 'LOW', 'L3:I4': 'HIGH',
  'L4:I1': 'HIGH', 'L4:I2': 'MODERATE', 'L4:I3': 'CRITICAL', 'L4:I4': 'LOW',
});
export function matrixMethodology(cells: Readonly<Record<string, L15RatingBand>> = NON_MONOTONE_CELLS,
  validity: L15MethodologyVersionContent['assessmentValidityMaximum'] = { months: 0, days: 90, microseconds: 0 },
  prefix = { l: 'L', i: 'I' }): L15MethodologyVersionContent {
  const lik = [...new Set(Object.keys(cells).map(k => k.split(':')[0]!))].sort();
  const imp = [...new Set(Object.keys(cells).map(k => k.split(':')[1]!))].sort();
  return {
    likelihoodScale: lik.map((c, n) => level(c.replace(/^L/, prefix.l), n + 1)),
    impactScale: imp.map((c, n) => level(c.replace(/^I/, prefix.i), n + 1)),
    ratingMatrix: Object.entries(cells).map(([k, ratingBand]) => {
      const [l, i] = k.split(':') as [string, string];
      return { likelihoodLevelCode: l.replace(/^L/, prefix.l), impactLevelCode: i.replace(/^I/, prefix.i), ratingBand };
    }),
    assessmentValidityMaximum: validity,
  };
}

export type Meth = { id: string; versionId: string; hash: string; stateId: string; admitted: Record<string, any> };

export async function m17s4Kit(c: L14Cluster) {
  const { owner, exec } = c;
  const k3 = await m17s3Kit(c);
  const s2 = k3.s2;
  const role = async (code: string) => {
    const existing = (await owner(`select role_id from gov_repo.governance_roles where role_code='${code}'`)).trim();
    if (existing) return existing;
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const roles = {
    ra: await role('M17_RA_VALIDATE'), raSelf: await role('M17_RA_SELF'), raDating: await role('M17_RA_DATING'),
    raKind: await role('M17_RA_KIND_AGENT_VERSION'), raRelType: await role('M17_RA_RELTYPE_READS'), raObject: await role('M17_RA_OBJECT'),
    raRelState: await role('M17_RA_RELSTATE'), raContrib: await role('M17_RA_CONTRIB'), raValidateOnly: await role('M17_RA_VALIDATE_ONLY'),
  };
  const ACTIONS = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
  const P = 'L15_RISK_ASSESSMENT_VALIDATE' as const;
  /** The RISK_ASSESSMENT rules of an organisation (objects / rels give the typed-scope operands of the RISK SUBJECT). */
  const raRules = (o: Record<string, string>, rels: Record<string, Rel>): L14AuthorityPolicyRule[] => [
    ...ACTIONS.map(a => rule(roles.ra, P, a)),
    ...ACTIONS.map(a => rule(roles.raSelf, P, a, a === 'VALIDATE' ? { allowSelfValidation: true } : {})),
    ...(['VALIDATE', 'REVOKE'] as const).map(a => rule(roles.raDating, P, a, { allowBackdating: true, allowFutureDating: true })),
    rule(roles.raKind, P, 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT_VERSION' }),
    rule(roles.raRelType, P, 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'READS_FROM' }),
    rule(roles.raObject, P, 'VALIDATE', { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'MODEL', scopeCanonicalObjectId: o.MODEL! }),
    rule(roles.raRelState, P, 'VALIDATE', { scopeTag: 'RELATIONSHIP_STATE', scopeRelationshipId: rels.READS_FROM!.relationshipId,
      scopeRelationshipStateId: rels.READS_FROM!.relationshipStateId }),
    rule(roles.raContrib, P, 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(roles.raValidateOnly, P, 'VALIDATE'),
  ];

  /** An organisation with the S3 setup (scenario / methodology / GOVERNED_RISK rules) and, unless `ra = false`, the RA rules. */
  async function setup(options: { ra?: boolean; extra?: (o: Record<string, string>, r: Record<string, Rel>) => L14AuthorityPolicyRule[] } = {}) {
    const x = await k3.setup({ extra: (o, r) => [...(options.ra === false ? [] : raRules(o, r)), ...(options.extra?.(o, r) ?? [])] });
    const u = async (...r: string[]) => c.mkUser(x.org, r);
    const actors = {
      methodologyAdmitter: await u(s2.roles.methodologyAdmit), methodologyValidator: await u(s2.roles.methodologyValidate),
      methodologyDater: await u(s2.roles.dating),
      assessor: await u(roles.ra), assessor2: await u(roles.ra), raSelf: await u(roles.raSelf), raDater: await u(roles.raDating),
      raKind: await u(roles.raKind), raRelType: await u(roles.raRelType), raObject: await u(roles.raObject),
      raRelState: await u(roles.raRelState), raContrib: await u(roles.raContrib), raValidateOnly: await u(roles.raValidateOnly),
    };
    return { ...x, ...actors };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** ADMIT + VALIDATE an exact methodology version (optionally future-dated validation). */
  async function methodology(x: Ctx, name: string, content: L15MethodologyVersionContent = matrixMethodology(),
    o: { from?: string | null } = {}): Promise<Meth> {
    const admitted = await s2.admitMethodology(x as never, name, content, {}, x.methodologyAdmitter);
    const v = await s2.validate(x as never, name, METHODOLOGY, admitted, o.from ? x.methodologyDater : x.methodologyValidator, null,
      o.from ? { requestedEffectiveFrom: o.from } : {});
    return { admitted, stateId: v.decided.state_id as string, id: admitted.methodology_id as string,
      versionId: admitted.methodology_version_id as string, hash: admitted.content_hash as string };
  }
  /** ADMIT a successor version of an existing methodology (+ VALIDATE it). Never repins any assessment. */
  async function methodologySuccessor(x: Ctx, name: string, prev: Meth, content: L15MethodologyVersionContent = matrixMethodology()) {
    const admitted = await s2.admitMethodology(x as never, name, content,
      { identityId: prev.id, expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: prev.versionId } }, x.methodologyAdmitter);
    const v = await s2.validate(x as never, name, METHODOLOGY, admitted, x.methodologyValidator);
    return { admitted, stateId: v.decided.state_id as string, id: prev.id, versionId: admitted.methodology_version_id as string,
      hash: admitted.content_hash as string } as Meth;
  }
  const revokeMethodology = (x: Ctx, name: string, m: Meth) => s2.revoke(x as never, name, METHODOLOGY, m.admitted, m.stateId,
    x.methodologyValidator);

  /** A VALIDATED GOVERNED_RISK state on an exact object subject (S3 real RPCs). */
  async function risk(x: Ctx, name: string, kind = 'AGENT_VERSION', o: { scenario?: Awaited<ReturnType<typeof k3.scenario>>;
    objectId?: string } = {}) {
    const scen = o.scenario ?? await k3.scenario(x, `${name}-scn`, 'OPERATIONAL', ['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API']);
    const subject = objectSubject(kind, o.objectId ?? x.objects[kind]!);
    const v = await k3.validateRisk(x, `${name}-gr`, subject, scen);
    return { scen, subject, stateId: v.stateId, decided: v.decided };
  }

  const rated = (riskStateId: string, m: Meth, likelihood: string, impact: string, validUntil: string,
    over: Partial<L15InherentRiskAssessmentProposalContent> = {}): L15InherentRiskAssessmentProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', governedRiskStateId: riskStateId, assessmentBasis: 'INHERENT',
    methodologyId: m.id, methodologyVersionId: m.versionId, methodologyContentHash: m.hash, assessmentOutcome: 'RATED',
    likelihoodLevelCode: likelihood, impactLevelCode: impact, requestedEffectiveFrom: null, requestedValidUntil: validUntil,
    expectedCurrentStateId: null, targetStateId: null, ...over });
  const insufficient = (riskStateId: string, m: Meth, validUntil: string,
    over: Partial<L15InherentRiskAssessmentProposalContent> = {}): L15InherentRiskAssessmentProposalContent =>
    rated(riskStateId, m, 'X', 'X', validUntil, { assessmentOutcome: 'INSUFFICIENT_EVIDENCE', likelihoodLevelCode: null,
      impactLevelCode: null, ...over });
  const revocation = (riskStateId: string, m: Meth, stateId: string,
    over: Partial<L15InherentRiskAssessmentProposalContent> = {}): L15InherentRiskAssessmentProposalContent =>
    rated(riskStateId, m, 'X', 'X', 'X', { intent: 'REVOKE', assessmentOutcome: null, likelihoodLevelCode: null,
      impactLevelCode: null, requestedValidUntil: null, expectedCurrentStateId: stateId, targetStateId: stateId, ...over });

  const supportSql = (s: L15RiskAssessmentSupport) => ({ p_support_status: lit(s.status), p_support_tags: textArray(s.entries.map(e => e.tag)),
    p_support_target_ids: textArray(s.entries.map(e => e.targetId)) });

  /** Raw (deliberately loose) operands so adversarial shapes can be sent past the TS mirror. */
  interface SubmitOps { commandId: string; proposal: L15InherentRiskAssessmentProposalContent; prior?: string | null;
    support?: L15RiskAssessmentSupport; fingerprint?: string; session?: SessionOverride; raw?: Partial<Record<string, string | null>> }
  function submitSql(actor: Actor, o: SubmitOps) {
    const support = o.support ?? NONE, prior = o.prior ?? null, p = o.proposal;
    const fingerprint = o.fingerprint ?? submitRiskAssessmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    const r = o.raw ?? {};
    const pick = (key: string, value: string | null) => (key in r ? r[key]! : value);
    return `select to_json(r) from gov_repo.l15_submit_risk_assessment_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_intent: textOrNull(pick('intent', p.intent)),
      p_source_class: textOrNull(pick('sourceClass', p.sourceClass)),
      p_governed_risk_state_id: uuidOrNull(pick('governedRiskStateId', p.governedRiskStateId)),
      p_assessment_basis: textOrNull(pick('assessmentBasis', p.assessmentBasis)),
      p_methodology_id: uuidOrNull(pick('methodologyId', p.methodologyId)),
      p_methodology_version_id: uuidOrNull(pick('methodologyVersionId', p.methodologyVersionId)),
      p_methodology_content_hash: textOrNull(pick('methodologyContentHash', p.methodologyContentHash)),
      p_assessment_outcome: textOrNull(pick('assessmentOutcome', p.assessmentOutcome)),
      p_likelihood_level_code: textOrNull(pick('likelihoodLevelCode', p.likelihoodLevelCode)),
      p_impact_level_code: textOrNull(pick('impactLevelCode', p.impactLevelCode)),
      p_requested_effective_from: tsOrNull(pick('requestedEffectiveFrom', p.requestedEffectiveFrom)),
      p_requested_valid_until: tsOrNull(pick('requestedValidUntil', p.requestedValidUntil)),
      p_expected_current_state_id: uuidOrNull(pick('expectedCurrentStateId', p.expectedCurrentStateId)),
      p_target_state_id: uuidOrNull(pick('targetStateId', p.targetStateId)), p_prior_proposal_id: uuidOrNull(prior),
      ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideOps { commandId: string; proposalId: string; proposal: L15InherentRiskAssessmentProposalContent;
    outcome?: L14GovernanceOutcome; expected?: string | null; support?: L15RiskAssessmentSupport; fingerprint?: string;
    reason?: string; session?: SessionOverride }
  function decideSql(actor: Actor, o: DecideOps) {
    const support = o.support ?? NONE, outcome = o.outcome ?? 'VALIDATE';
    const expected = o.expected !== undefined ? o.expected : o.proposal.expectedCurrentStateId;
    const fingerprint = o.fingerprint ?? decideRiskAssessmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, outcome, proposalId: o.proposalId, proposal: o.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l15_decide_risk_assessment_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_proposal_id: uuidOrNull(o.proposalId), p_outcome: lit(outcome),
      p_reason_code: lit(o.reason ?? riskAssessmentReasonCode(outcome)), p_expected_current_state_id: uuidOrNull(expected),
      ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }

  const submit = (x: Ctx, name: string, proposal: L15InherentRiskAssessmentProposalContent, o: Partial<SubmitOps> = {}, actor: Actor = x.member) =>
    exec(submitSql(actor, { commandId: x.cmd(`${name}-ra-submit`), proposal, ...o }));
  const decide = (x: Ctx, name: string, submitted: Record<string, any>, proposal: L15InherentRiskAssessmentProposalContent,
    o: Partial<DecideOps> = {}, actor: Actor = x.assessor) =>
    exec(decideSql(actor, { commandId: x.cmd(`${name}-ra-decide`), proposalId: submitted.proposal_id, proposal, ...o }));
  /** SUBMIT (member) -> DECIDE VALIDATE (assessor; the dating assessor for an explicit start). */
  async function assess(x: Ctx, name: string, proposal: L15InherentRiskAssessmentProposalContent,
    o: { assessor?: Actor; support?: L15RiskAssessmentSupport; decideSupport?: L15RiskAssessmentSupport } = {}) {
    const submitted = await submit(x, name, proposal, { support: o.support });
    const decided = await decide(x, name, submitted, proposal, { support: o.decideSupport ?? NONE },
      o.assessor ?? (proposal.requestedEffectiveFrom ? x.raDater : x.assessor));
    return { proposal, submitted, decided, stateId: decided.state_id as string };
  }
  async function revokeAssessment(x: Ctx, name: string, riskStateId: string, m: Meth, stateId: string,
    o: { from?: string | null; assessor?: Actor } = {}) {
    const proposal = revocation(riskStateId, m, stateId, { requestedEffectiveFrom: o.from ?? null });
    const submitted = await submit(x, name, proposal);
    const decided = await decide(x, name, submitted, proposal, { outcome: 'REVOKE' }, o.assessor ?? (o.from ? x.raDater : x.assessor));
    return { proposal, submitted, decided, stateId: decided.state_id as string };
  }

  const json = k3.json, one = k3.one;
  /** Exact resolver (owner): the current assessment state id of (risk state, INHERENT) at (at, cutoff) SQL expressions, or null. */
  const resolve = async (org: string, riskStateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') => {
    const rows = await json(`select coalesce(json_agg(r), '[]') from gov_repo.l15_risk_assessment_valid_state_v1('${org}', '${riskStateId}',
      'INHERENT', ${at}, ${cutoff}) r`) as Array<{ state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.state_id ?? null;
  };
  const resolution = async (org: string, riskStateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    json(`select to_json(r) from gov_repo.l15_risk_assessment_resolution_v1('${org}', '${riskStateId}', 'INHERENT', ${at}, ${cutoff}) r`) as
      Promise<{ resolution: string; state_id: string | null; state_kind: string | null }>;
  const stateCurrent = async (org: string, stateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    (await one(`select gov_repo.l15_risk_assessment_state_current_v1('${org}', '${stateId}', ${at}, ${cutoff})::text`)) === 'true';
  /** The member read RPC (service_role, verified principal). */
  const readSql = (actor: Actor, riskStateId: string, at: string | null = null, cutoff: string | null = null, basis = 'INHERENT',
    session?: SessionOverride) => `select to_json(r) from gov_repo.l15_read_risk_assessment_v1(${named({
      ...c.principal(actor, session), p_governed_risk_state_id: uuidOrNull(riskStateId), p_assessment_basis: lit(basis),
      p_effective_at: at ?? 'null::timestamptz', p_recorded_cutoff: cutoff ?? 'null::timestamptz' })}) r;`;
  const read = (actor: Actor, riskStateId: string, at: string | null = null, cutoff: string | null = null) =>
    exec(readSql(actor, riskStateId, at, cutoff));
  const counts = async (org: string) => json(`select json_build_object(${[...RA_TABLES, 'l14_authorization_decisions', 'l14_proposals',
    'l14_governance_decisions', 'l14_command_results', 'l15_support_links'].map(t => `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`) as Promise<Record<string, number>>;
  const raCounts = async (org: string) => json(`select json_build_object('proposals',(select count(*) from gov_repo.l15_risk_assessment_proposals where organisation_id='${org}'),
    'states',(select count(*) from gov_repo.l15_risk_assessment_states where organisation_id='${org}'),
    'heads',(select count(*) from gov_repo.l15_risk_assessment_heads where organisation_id='${org}' and latest_state_id is not null),
    'decisions',(select count(*) from gov_repo.l14_governance_decisions where organisation_id='${org}' and subject_kind='RISK_ASSESSMENT'),
    'authz',(select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${org}' and subject_kind='RISK_ASSESSMENT'))`) as
      Promise<{ proposals: number; states: number; heads: number; decisions: number; authz: number }>;
  /** md5 of every RISK_ASSESSMENT history row of an organisation (states + proposals + their support links). */
  const historyDigest = async (org: string) => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 's:'||t::text x from gov_repo.l15_risk_assessment_states t where organisation_id='${org}'
    union all select 'p:'||t::text from gov_repo.l15_risk_assessment_proposals t where organisation_id='${org}'
    union all select 'l:'||t::text from gov_repo.l15_support_links t where organisation_id='${org}' and owner_kind='RISK_ASSESSMENT') s`);
  /** md5 of every GOVERNED_RISK / M16 / canonical / treatment-like governed row an assessment must never touch. */
  const unrelatedDigest = async (org: string) => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 'gs:'||t::text x from gov_repo.l15_governed_risk_states t where organisation_id='${org}'
    union all select 'gh:'||t::text from gov_repo.l15_governed_risk_heads t where organisation_id='${org}'
    union all select 'gp:'||t::text from gov_repo.l15_governed_risk_proposals t where organisation_id='${org}'
    union all select 'f:'||t::text from gov_repo.l14_fact_states t where organisation_id='${org}'
    union all select 'r:'||t::text from gov_repo.l14_registry_states t where organisation_id='${org}'
    union all select 'co:'||t::text from gov_repo.canonical_objects t where organisation_id='${org}'
    union all select 'cr:'||t::text from gov_repo.canonical_relationships t where organisation_id='${org}'
    union all select 'sg:'||t::text from gov_repo.l15_risk_signals t where organisation_id='${org}'
    union all select 'hy:'||t::text from gov_repo.l15_risk_hypotheses t where organisation_id='${org}'
    union all select 'ms:'||t::text from gov_repo.l15_risk_methodology_states t where organisation_id='${org}'
    union all select 'ss:'||t::text from gov_repo.l15_risk_scenario_definition_states t where organisation_id='${org}') s`);
  const stateRow = async (org: string, stateId: string) => one(`select t::text from gov_repo.l15_risk_assessment_states t
    where organisation_id='${org}' and state_id='${stateId}'`);
  const head = async (org: string, riskStateId: string) => {
    const r = await json(`select coalesce((select to_json(h.latest_state_id) from gov_repo.l15_risk_assessment_heads h where organisation_id='${org}'
      and governed_risk_state_id='${riskStateId}' and assessment_basis='INHERENT'), 'null'::json)`);
    return r as string | null;
  };
  /** The band PostgreSQL stores for the exact pinned cell (direct cell read, never arithmetic). */
  const cellBand = async (org: string, versionId: string, l: string, i: string) => one(`select rating_band from gov_repo.l15_risk_methodology_rating_cells
    where organisation_id='${org}' and methodology_version_id='${versionId}' and likelihood_level_code='${l}' and impact_level_code='${i}'`);
  const instant = k3.instant;
  return { k3, s2, roles, raRules, setup, methodology, methodologySuccessor, revokeMethodology, risk, rated, insufficient, revocation,
    submitSql, decideSql, submit, decide, assess, revokeAssessment, resolve, resolution, stateCurrent, readSql, read, counts, raCounts,
    historyDigest, unrelatedDigest, stateRow, head, cellBand, json, one, instant };
}
export type M17S4Kit = Awaited<ReturnType<typeof m17s4Kit>>;
export type M17S4Ctx = Awaited<ReturnType<M17S4Kit['setup']>>;
