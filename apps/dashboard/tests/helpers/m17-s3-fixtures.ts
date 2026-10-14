import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L15GovernedRiskClosureReason, L15GovernedRiskProposalContent,
  L15GovernedRiskSubject, L15GovernedRiskSupport, L15RiskDomain,
} from '@council/canonical-contracts';
import {
  decideGovernedRiskProposalFingerprint, governedRiskReasonCode, submitGovernedRiskProposalFingerprint,
} from '@council/governance-review';
import { canonicalObjectKit, lit, named } from './m16-governed-write-fixtures';
import { lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { m17s2Kit, scenarioContent, SCENARIO } from './m17-s2-fixtures';

/**
 * M17-S3 GOVERNED_RISK fixtures on the M17S3-horizon L14 cluster (full canonical chain + M16 + M17-S0..S2R1 + S3). Owner
 * access only inserts administrator support rows (organisations, users, roles, canonical objects / relationship states,
 * evidence) and runs rolled-back probes. Every governance write goes through the real RPCs as service_role with a verified
 * principal and the caller fingerprint computed by the production TypeScript mirror; L15 authority enters each organisation
 * ONLY through a normal Authority Policy successor validated under the effective policy (no L15 bootstrap).
 */
export const GR_TABLES = ['l15_governed_risk_proposals', 'l15_governed_risk_states', 'l15_governed_risk_heads'] as const;
export const NONE: L15GovernedRiskSupport = Object.freeze({ status: 'NONE', entries: [] as const });
export const BOGUS = 'b'.repeat(64);
export const OBJECT_KINDS = ['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'DATA_ASSET', 'DATA_ELEMENT'] as const;
export const ALL_OBJECT_KINDS = [...OBJECT_KINDS, 'PROMPT', 'KNOWLEDGE_BASE', 'SKILL'] as const;
export const REL_TYPES = ['USES_MODEL', 'USES_TOOL', 'USES_MCP', 'INVOKES', 'USES_PROMPT', 'USES_KNOWLEDGE_BASE', 'USES_SKILL',
  'EXPOSES', 'HANDOFF_TO', 'READS_FROM', 'WRITES_TO', 'DERIVED_FROM'] as const;
export const DOMAINS = ['PRIVACY', 'CYBERSECURITY', 'AUTHORIZATION', 'AUTONOMY', 'MODEL', 'DATA', 'CONNECTIVITY', 'OPERATIONAL', 'FINOPS'] as const;
export type Rel = { relationshipId: string; relationshipStateId: string; relationshipType: string };

const textArray = (vs: readonly unknown[]) => (vs.length ? `array[${vs.map(v => (v === null ? 'null' : lit(String(v)))).join(',')}]::text[]` : `'{}'::text[]`);
const uuidOrNull = (v: string | null | undefined) => (v == null ? 'null::uuid' : `${lit(v)}::uuid`);
const tsOrNull = (v: string | null | undefined) => (v == null ? 'null::timestamptz' : `${lit(v)}::timestamptz`);
const textOrNull = (v: string | null | undefined) => (v == null ? 'null::text' : lit(v));

export const objectSubject = (kind: string, id: string): L15GovernedRiskSubject =>
  ({ subjectType: 'CANONICAL_OBJECT', canonicalKind: kind as never, canonicalObjectId: id });
export const relSubject = (r: { relationshipId: string; relationshipStateId: string }): L15GovernedRiskSubject =>
  ({ subjectType: 'RELATIONSHIP_STATE', relationshipId: r.relationshipId, relationshipStateId: r.relationshipStateId });

export async function m17s3Kit(c: L14Cluster) {
  const { owner, exec } = c;
  const s2 = await m17s2Kit(c);
  const role = async (code: string) => {
    const existing = (await owner(`select role_id from gov_repo.governance_roles where role_code='${code}'`)).trim();
    if (existing) return existing;
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const roles = {
    gr: await role('M17_GR_VALIDATE'), grSelf: await role('M17_GR_SELF'), grDating: await role('M17_GR_DATING'),
    grKind: await role('M17_GR_KIND_AGENT_VERSION'), grRelType: await role('M17_GR_RELTYPE_READS'), grObject: await role('M17_GR_OBJECT'),
    grRelState: await role('M17_GR_RELSTATE'), grContrib: await role('M17_GR_CONTRIB'), grValidateOnly: await role('M17_GR_VALIDATE_ONLY'),
    treatment: await role('M17_TREATMENT_VALIDATE'), l14Resp: await role('M17_L14_RESPONSIBILITY'),
  };
  const ACTIONS = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
  const P = 'L15_GOVERNED_RISK_VALIDATE' as const;
  /** The GOVERNED_RISK rules of an organisation (objects / rels give the typed-scope operands). */
  const grRules = (o: Record<string, string>, rels: Record<string, Rel>): L14AuthorityPolicyRule[] => [
    ...ACTIONS.map(a => rule(roles.gr, P, a)),
    ...ACTIONS.map(a => rule(roles.grSelf, P, a, a === 'VALIDATE' ? { allowSelfValidation: true } : {})),
    ...(['VALIDATE', 'REVOKE'] as const).map(a => rule(roles.grDating, P, a, { allowBackdating: true, allowFutureDating: true })),
    rule(roles.grKind, P, 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT_VERSION' }),
    rule(roles.grRelType, P, 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'READS_FROM' }),
    rule(roles.grObject, P, 'VALIDATE', { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'DATA_ASSET', scopeCanonicalObjectId: o.DATA_ASSET! }),
    rule(roles.grRelState, P, 'VALIDATE', { scopeTag: 'RELATIONSHIP_STATE', scopeRelationshipId: rels.READS_FROM!.relationshipId,
      scopeRelationshipStateId: rels.READS_FROM!.relationshipStateId }),
    rule(roles.grContrib, P, 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(roles.grValidateOnly, P, 'VALIDATE'),
    ...ACTIONS.map(a => rule(roles.treatment, 'L15_RISK_TREATMENT_VALIDATE', a)),
    ...ACTIONS.map(a => rule(roles.l14Resp, 'L14_RESPONSIBILITY_VALIDATE', a)),
  ];

  let n = 0;
  /** Canonical objects of every kind (+ a second AGENT_VERSION / DATA_ELEMENT) and one exact relationship state per type. */
  async function objectsFor(org: string, label: string) {
    const make = (suffix: string, kind: string) => canonicalObjectKit(org, `${label}-${suffix}`, kind,
      { proposedIdentity: { reference: `${label}-${suffix}` }, identity: `${label}-${suffix}` });
    const kits = Object.fromEntries(ALL_OBJECT_KINDS.map(k => [k, make(k.toLowerCase().replace(/_/g, ''), k)]));
    kits.AGENT_VERSION_2 = make('agentversion2', 'AGENT_VERSION');
    kits.DATA_ELEMENT_2 = make('dataelement2', 'DATA_ELEMENT');
    await owner(Object.values(kits).map(k => k.sql).join('\n'));
    const objects = Object.fromEntries(Object.entries(kits).map(([k, v]) => [k, v.objectId])) as Record<string, string>;
    const rels: Record<string, Rel> = {};
    for (const type of REL_TYPES) {
      const relationshipId = `canonical-relationship:${label}-${type.toLowerCase()}`;
      const relationshipStateId = `${relationshipId}:initial`;
      const decision = `decision-rel-${label}-${type.toLowerCase()}`;
      await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,
          reason_code,decided_at,relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
        values(${lit(decision)},'${org}','RELATIONSHIP','CREATE_NEW','RELATIONSHIP','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),
          ${lit(`candidate:rel-${label}-${type}`)},${lit(type)},'1.1','{}',repeat('a',64));
        insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,source_canonical_object_id,
          source_kind,target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
        values(${lit(relationshipId)},'${org}',${lit(relationshipStateId)},${lit(type)},${lit(objects.AGENT_VERSION!)},'AGENT_VERSION',
          ${lit(objects.TOOL!)},'TOOL',now(),now(),${lit(decision)});`);
      rels[type] = { relationshipId, relationshipStateId, relationshipType: type };
    }
    return { objects, rels };
  }

  /** An organisation with AP v1 (L14 only) and, unless `l15 = false`, an AP successor carrying the S2 + GOVERNED_RISK rules. */
  async function setup(options: { l15?: boolean; gr?: boolean; extra?: (o: Record<string, string>, r: Record<string, Rel>) => L14AuthorityPolicyRule[] } = {}) {
    const base = await s2.sk.setup(s2.opsRules());
    const label = `s3o${++n}-${randomUUID().slice(0, 6)}`;
    const { objects, rels } = await objectsFor(base.org, label);
    const u = async (...r: string[]) => c.mkUser(base.org, r);
    const actors = {
      scenarioAdmitter: await u(s2.roles.scenarioAdmit), scenarioValidator: await u(s2.roles.scenarioValidate),
      scenarioDater: await u(s2.roles.dating),
      validator: await u(roles.gr), validator2: await u(roles.gr), self: await u(roles.grSelf), dater: await u(roles.grDating),
      kindScoped: await u(roles.grKind), relTypeScoped: await u(roles.grRelType), objectScoped: await u(roles.grObject),
      relStateScoped: await u(roles.grRelState), contrib: await u(roles.grContrib), validateOnly: await u(roles.grValidateOnly),
      treatment: await u(roles.treatment), l14Resp: await u(roles.l14Resp), admin: await u(c.adminRole),
      member2: await u(c.memberRole),
    };
    if (options.l15 !== false) {
      await s2.sk.successor(base, 'l15', [...s2.opsRules(), ...s2.l15Rules(), ...(options.gr === false ? [] : grRules(objects, rels)),
        ...(options.extra?.(objects, rels) ?? [])]);
    }
    const ev = await c.evidence(base.org, `evidence:${label}`);
    return { ...base, ...actors, objects, rels, evidence: ev, label, cmd: (x: string) => `${label}-${x}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  /**
   * The S3 actors on an EXISTING M16 organisation (e.g. a control-assessment fixture org whose AP v1 carries `baseRules`):
   * the L15 + GOVERNED_RISK rules enter through a normal AP successor that keeps `baseRules`, so the M16 family stays
   * administrable (and revocable) after succession. Used by the O44 support-currency suite.
   */
  async function attach(base: { org: string; label: string; member: Actor; ops: Actor; v1: Record<string, any>; cmd: (x: string) => string },
    baseRules: readonly L14AuthorityPolicyRule[], objects: Record<string, string>, rels: Record<string, Rel>) {
    const u = async (...r: string[]) => c.mkUser(base.org, r);
    const actors = {
      scenarioAdmitter: await u(s2.roles.scenarioAdmit), scenarioValidator: await u(s2.roles.scenarioValidate),
      scenarioDater: await u(s2.roles.dating), validator: await u(roles.gr), dater: await u(roles.grDating),
    };
    await s2.sk.successor(base as never, 'l15-gr', [...baseRules, ...s2.l15Rules(), ...grRules(objects, rels)]);
    const ev = await c.evidence(base.org, `evidence:${base.label}-s3`);
    return { ...base, ...actors, objects, rels, evidence: ev } as unknown as Ctx;
  }

  /** ADMIT + VALIDATE an exact scenario version of the domain declaring the given subject tokens. */
  async function scenario(x: Ctx, name: string, domain: L15RiskDomain, subjectKinds: readonly string[], o: { from?: string | null } = {}) {
    const admitted = await s2.admitScenario(x as never, name,
      scenarioContent({ riskDomain: domain, subjectKinds: subjectKinds as never }, `SCN-${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`));
    const v = await s2.validate(x as never, name, SCENARIO, admitted, o.from ? x.scenarioDater : x.scenarioValidator, null,
      o.from ? { requestedEffectiveFrom: o.from } : {});
    return { admitted, stateId: v.decided.state_id as string, id: admitted.scenario_definition_id as string,
      versionId: admitted.scenario_definition_version_id as string, hash: admitted.content_hash as string };
  }
  type Scen = { id: string; versionId: string; hash: string; admitted?: Record<string, any> };
  /** ADMIT a successor version of an existing scenario (+ optionally VALIDATE it). Never repins any risk. */
  async function scenarioSuccessor(x: Ctx, name: string, prev: Scen, domain: L15RiskDomain, subjectKinds: readonly string[], validate = true) {
    const admitted = await s2.admitScenario(x as never, name,
      scenarioContent({ riskDomain: domain, subjectKinds: subjectKinds as never }, `SCN-${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`),
      { identityId: prev.id, expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: prev.versionId } });
    const stateId = validate ? (await s2.validate(x as never, name, SCENARIO, admitted)).decided.state_id as string : null;
    return { admitted, stateId, id: prev.id, versionId: admitted.scenario_definition_version_id as string, hash: admitted.content_hash as string };
  }
  const revokeScenario = (x: Ctx, name: string, scen: { admitted: Record<string, any>; stateId: string }) =>
    s2.revoke(x as never, name, SCENARIO, scen.admitted, scen.stateId);

  const proposalOf = (subject: L15GovernedRiskSubject, scen: Scen, over: Partial<L15GovernedRiskProposalContent> = {}): L15GovernedRiskProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', subject, scenarioDefinitionId: scen.id, scenarioDefinitionVersionId: scen.versionId,
    scenarioContentHash: scen.hash, requestedEffectiveFrom: null, requestedEffectiveTo: null, expectedCurrentStateId: null,
    targetStateId: null, closureReason: null, ...over });
  const supportSql = (s: L15GovernedRiskSupport) => ({ p_support_status: lit(s.status), p_support_tags: textArray(s.entries.map(e => e.tag)),
    p_support_target_ids: textArray(s.entries.map(e => e.targetId)) });
  const subjectSql = (s: L15GovernedRiskSubject | Record<string, string | null>) => {
    const r = s as Record<string, string | null | undefined>;
    return { p_subject_type: textOrNull(r.subjectType), p_subject_canonical_kind: textOrNull(r.canonicalKind),
      p_subject_canonical_object_id: textOrNull(r.canonicalObjectId), p_subject_relationship_id: textOrNull(r.relationshipId),
      p_subject_relationship_state_id: textOrNull(r.relationshipStateId) };
  };

  interface SubmitOps { commandId: string; proposal: L15GovernedRiskProposalContent; prior?: string | null; support?: L15GovernedRiskSupport;
    fingerprint?: string; session?: SessionOverride; rawSubject?: Record<string, string | null>; rawSource?: string; rawClosure?: string | null }
  function submitSql(actor: Actor, o: SubmitOps) {
    const support = o.support ?? NONE, prior = o.prior ?? null, p = o.proposal;
    const fingerprint = o.fingerprint ?? submitGovernedRiskProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l15_submit_governed_risk_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_intent: lit(p.intent), p_source_class: lit(o.rawSource ?? p.sourceClass),
      ...subjectSql(o.rawSubject ?? p.subject), p_scenario_definition_id: uuidOrNull(p.scenarioDefinitionId),
      p_scenario_definition_version_id: uuidOrNull(p.scenarioDefinitionVersionId), p_scenario_content_hash: lit(p.scenarioContentHash),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_requested_effective_to: tsOrNull(p.requestedEffectiveTo),
      p_expected_current_state_id: uuidOrNull(p.expectedCurrentStateId), p_target_state_id: uuidOrNull(p.targetStateId),
      p_closure_reason: textOrNull(o.rawClosure !== undefined ? o.rawClosure : p.closureReason), p_prior_proposal_id: uuidOrNull(prior),
      ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideOps { commandId: string; proposalId: string; proposal: L15GovernedRiskProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L15GovernedRiskSupport; fingerprint?: string; reason?: string; closure?: string | null;
    session?: SessionOverride }
  function decideSql(actor: Actor, o: DecideOps) {
    const support = o.support ?? NONE, outcome = o.outcome ?? 'VALIDATE';
    const expected = o.expected !== undefined ? o.expected : o.proposal.expectedCurrentStateId;
    const closure = o.closure !== undefined ? o.closure : (outcome === 'REVOKE' ? o.proposal.closureReason : null);
    const fingerprint = o.fingerprint ?? decideGovernedRiskProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, outcome, proposalId: o.proposalId, proposal: o.proposal, closureReason: closure,
      expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l15_decide_governed_risk_proposal_v1(${named({
      ...c.principal(actor, o.session), p_command_id: lit(o.commandId), p_proposal_id: uuidOrNull(o.proposalId), p_outcome: lit(outcome),
      p_reason_code: lit(o.reason ?? governedRiskReasonCode(outcome)), p_closure_reason: textOrNull(closure),
      p_expected_current_state_id: uuidOrNull(expected), ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }

  const submit = (x: Ctx, name: string, proposal: L15GovernedRiskProposalContent, o: Partial<SubmitOps> = {}, actor: Actor = x.member) =>
    exec(submitSql(actor, { commandId: x.cmd(`${name}-submit`), proposal, ...o }));
  const decide = (x: Ctx, name: string, submitted: Record<string, any>, proposal: L15GovernedRiskProposalContent, o: Partial<DecideOps> = {},
    actor: Actor = x.validator) => exec(decideSql(actor, { commandId: x.cmd(`${name}-decide`), proposalId: submitted.proposal_id, proposal, ...o }));
  /** SUBMIT (member) -> DECIDE VALIDATE (validator). */
  async function validateRisk(x: Ctx, name: string, subject: L15GovernedRiskSubject, scen: Scen,
    o: { validator?: Actor; over?: Partial<L15GovernedRiskProposalContent>; support?: L15GovernedRiskSupport; decideSupport?: L15GovernedRiskSupport } = {}) {
    const proposal = proposalOf(subject, scen, o.over);
    const submitted = await submit(x, name, proposal, { support: o.support });
    const decided = await decide(x, name, submitted, proposal, { support: o.decideSupport ?? NONE },
      o.validator ?? (proposal.requestedEffectiveFrom || proposal.requestedEffectiveTo ? x.dater : x.validator));
    return { proposal, submitted, decided, stateId: decided.state_id as string };
  }
  async function revokeRisk(x: Ctx, name: string, subject: L15GovernedRiskSubject, scen: Scen, stateId: string,
    closureReason: L15GovernedRiskClosureReason = 'RISK_NO_LONGER_APPLICABLE', o: { from?: string | null; validator?: Actor } = {}) {
    const proposal = proposalOf(subject, scen, { intent: 'REVOKE', targetStateId: stateId, expectedCurrentStateId: stateId, closureReason,
      requestedEffectiveFrom: o.from ?? null });
    const submitted = await submit(x, name, proposal);
    const decided = await decide(x, name, submitted, proposal, { outcome: 'REVOKE' }, o.validator ?? (o.from ? x.dater : x.validator));
    return { proposal, submitted, decided, stateId: decided.state_id as string };
  }

  const json = async (query: string) => JSON.parse(lastLine(await owner(query)));
  const one = async (query: string) => lastLine(await owner(query));
  const subjectArgsSql = (s: L15GovernedRiskSubject) => {
    const a = subjectSql(s);
    return `${a.p_subject_type}, ${a.p_subject_canonical_kind}, ${a.p_subject_canonical_object_id}, ${a.p_subject_relationship_id}, ${a.p_subject_relationship_state_id}`;
  };
  /** Exact resolver (owner): the current state id of the logical key at (at, cutoff) SQL expressions, or null. */
  const resolve = async (org: string, s: L15GovernedRiskSubject, scenarioId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') => {
    const rows = await json(`select coalesce(json_agg(r), '[]') from gov_repo.l15_governed_risk_valid_state_v1('${org}', ${subjectArgsSql(s)},
      '${scenarioId}', ${at}, ${cutoff}) r`) as Array<{ state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.state_id ?? null;
  };
  const resolution = async (org: string, s: L15GovernedRiskSubject, scenarioId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    json(`select to_json(r) from gov_repo.l15_governed_risk_resolution_v1('${org}', ${subjectArgsSql(s)}, '${scenarioId}', ${at}, ${cutoff}) r`) as
      Promise<{ resolution: string; state_id: string | null; state_kind: string | null }>;
  /** The member read RPC (service_role, verified principal). */
  const readSql = (actor: Actor, s: L15GovernedRiskSubject, scenarioId: string, at: string | null = null, cutoff: string | null = null,
    session?: SessionOverride) => `select to_json(r) from gov_repo.l15_read_governed_risk_v1(${named({
      ...c.principal(actor, session), ...subjectSql(s), p_scenario_definition_id: uuidOrNull(scenarioId),
      p_effective_at: at ?? 'null::timestamptz', p_recorded_cutoff: cutoff ?? 'null::timestamptz' })}) r;`;
  const read = (actor: Actor, s: L15GovernedRiskSubject, scenarioId: string, at: string | null = null, cutoff: string | null = null) =>
    exec(readSql(actor, s, scenarioId, at, cutoff));
  const supportCurrency = async (org: string, stateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    json(`select coalesce(to_json(array_agg(r order by r.n)), '[]') from gov_repo.l15_governed_risk_support_currency_v1('${org}', '${stateId}', ${at}, ${cutoff})
      with ordinality r(link_id, target_tag, target_id, link_currency, failure_reason, upstream_link_id, n)`) as
      Promise<Array<{ link_id: string; target_tag: string; target_id: string; link_currency: string; failure_reason: string | null; upstream_link_id: string | null }>>;
  const counts = async (org: string) => json(`select json_build_object(${[...GR_TABLES, 'l14_authorization_decisions', 'l14_proposals',
    'l14_governance_decisions', 'l14_command_results', 'l15_support_links'].map(t => `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`) as Promise<Record<string, number>>;
  const grCounts = async (org: string) => json(`select json_build_object('proposals',(select count(*) from gov_repo.l15_governed_risk_proposals where organisation_id='${org}'),
    'states',(select count(*) from gov_repo.l15_governed_risk_states where organisation_id='${org}'),
    'heads',(select count(*) from gov_repo.l15_governed_risk_heads where organisation_id='${org}' and latest_state_id is not null),
    'decisions',(select count(*) from gov_repo.l14_governance_decisions where organisation_id='${org}' and subject_kind='GOVERNED_RISK'),
    'authz',(select count(*) from gov_repo.l14_authorization_decisions where organisation_id='${org}' and subject_kind='GOVERNED_RISK'))`) as
      Promise<{ proposals: number; states: number; heads: number; decisions: number; authz: number }>;
  /** md5 of every GOVERNED_RISK history row of an organisation (states + proposals + their support links). */
  const historyDigest = async (org: string) => one(`select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 's:'||t::text x from gov_repo.l15_governed_risk_states t where organisation_id='${org}'
    union all select 'p:'||t::text from gov_repo.l15_governed_risk_proposals t where organisation_id='${org}'
    union all select 'l:'||t::text from gov_repo.l15_support_links t where organisation_id='${org}' and owner_kind='GOVERNED_RISK') s`);
  const head = async (org: string, s: L15GovernedRiskSubject, scenarioId: string) => {
    const r = await json(`select coalesce((select to_json(h.latest_state_id) from gov_repo.l15_governed_risk_heads h where organisation_id='${org}'
      and subject_key = gov_repo.l15_risk_subject_key_v1(${subjectArgsSql(s)}) and scenario_definition_id='${scenarioId}'), 'null'::json)`);
    return r as string | null;
  };
  const instant = s2.instant;
  return { s2, roles, grRules, setup, attach, scenario, scenarioSuccessor, revokeScenario, proposalOf, submitSql, decideSql, submit, decide,
    validateRisk, revokeRisk, resolve, resolution, readSql, read, supportCurrency, counts, grCounts, historyDigest, head, json, one, instant };
}
export type M17S3Kit = Awaited<ReturnType<typeof m17s3Kit>>;
export type M17S3Ctx = Awaited<ReturnType<M17S3Kit['setup']>>;
