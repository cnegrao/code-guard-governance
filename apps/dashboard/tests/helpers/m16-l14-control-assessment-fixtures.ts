import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14ControlApplicabilityTarget, L14ControlAssessmentOutcome, L14ControlAssessmentProposalContent,
  L14GovernanceOutcome, L14Support,
} from '@council/canonical-contracts';
import {
  controlAssessmentReasonCode, decideControlAssessmentProposalFingerprint, submitControlAssessmentProposalFingerprint,
} from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import {
  CONTROL_APPLICABILITY_TABLES, controlApplicabilityKit, type ControlApplicabilityKit, type ControlPin, type Objects, type Rels,
} from './m16-l14-control-applicability-fixtures';

/**
 * M16-S1C.5 CONTROL_ASSESSMENT fixtures on the S1C5-horizon L14 cluster (full canonical chain + S1B.3..S1C.4 + S1C.5). Every
 * Authority Policy is bootstrapped through the real AP RPCs; every control definition version / validation through the real
 * S1B.6 RPCs; every applicability through the real S1C.4 RPCs; every assessment command through the real S1C.5 RPCs as
 * service_role with the caller fingerprint computed by the production TypeScript mirror (@council/governance-review). Owner
 * access only inserts administrator support rows, reads evidence and runs rolled-back probes.
 */
export const CONTROL_ASSESSMENT_TABLES = [
  'l14_control_assessment_proposals', 'l14_control_assessment_states', 'l14_control_assessment_heads',
] as const;
export const L14_S1C5_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', 'l14_fact_states',
  ...CONTROL_APPLICABILITY_TABLES, ...CONTROL_ASSESSMENT_TABLES, 'l14_control_definitions', 'l14_control_definition_versions',
  'l14_control_definition_states', 'l14_control_definition_proposals', 'l14_control_definition_heads',
] as const;
export const ASSESSMENT_OUTCOMES = ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'NOT_ASSESSED', 'INSUFFICIENT_EVIDENCE'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const tsOrNull = (value: string | null) => (value === null ? 'null::timestamptz' : `${lit(value)}::timestamptz`);
const textOrNull = (value: string | null | undefined) => (value == null ? 'null::text' : lit(value));
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
/** A syntactically valid but WRONG caller fingerprint (for inputs the TS mirror itself refuses to frame). */
export const BOGUS_FINGERPRINT = 'b'.repeat(64);
/** A canonical UTC instant `days` from now (microsecond precision, as the mirror requires). */
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');

/** An S1C.4 applicability state of a target + pinned control version, as the assessment pin. */
export interface Applicability { target: L14ControlApplicabilityTarget; pin: ControlPin; stateId: string }

/** `existing`: reuse an S1C.4 kit already created on this cluster (its role codes are cluster-unique). */
export async function controlAssessmentKit(c: L14Cluster, existing?: ControlApplicabilityKit) {
  const { owner, exec } = c;
  const cak = existing ?? await controlApplicabilityKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const assessorRole = await role('L14_AS_ASSESSOR');
  const flexAssessorRole = await role('L14_AS_FLEX_ASSESSOR');
  const contribAssessorRole = await role('L14_AS_CONTRIBUTOR');
  const kindAssessorRole = await role('L14_AS_AGENT_KIND_ASSESSOR');
  const objectAssessorRole = await role('L14_AS_OBJECT_ASSESSOR');
  const relTypeAssessorRole = await role('L14_AS_REL_TYPE_ASSESSOR');
  const relStateAssessorRole = await role('L14_AS_REL_STATE_ASSESSOR');
  const applicabilityOnlyRole = await role('L14_AS_APPLICABILITY_ONLY');

  /**
   * Control applicability administration (S1C.4 kit, incl. CONTROL_DEFINITION) + assessment administration. assessor:
   * every decision, ALL_ALLOWED_TARGETS, no flags. flex: every decision with self-validation / future / back dating.
   * contributor: a CONTRIBUTING (never authorizing) VALIDATE rule. kind: VALIDATE on CANONICAL_KIND AGENT. object: VALIDATE
   * on the exact CANONICAL_OBJECT DATA_ASSET. relType: VALIDATE on RELATIONSHIP_TYPE EXPOSES. relState: VALIDATE on the exact
   * RELATIONSHIP_STATE `reads`. applicabilityOnly: the CONTROL_APPLICABILITY permission (another fact family never
   * administers assessments).
   */
  const rules = (o: Objects, r: Rels, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    ...cak.rules(o, r),
    rule(assessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE'),
    rule(assessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'REJECT'),
    rule(assessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'DEFER'),
    rule(assessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'REVOKE'),
    rule(flexAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(flexAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'REJECT'),
    rule(flexAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'DEFER'),
    rule(contribAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(kindAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }),
    rule(objectAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'DATA_ASSET', scopeCanonicalObjectId: o.byKind.DATA_ASSET }),
    rule(relTypeAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'EXPOSES' }),
    rule(relStateAssessorRole, 'L14_CONTROL_ASSESSMENT_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_STATE',
      scopeRelationshipId: r.reads.relationshipId, scopeRelationshipStateId: r.reads.relationshipStateId }),
    rule(applicabilityOnlyRole, 'L14_CONTROL_APPLICABILITY_VALIDATE', 'VALIDATE'),
  ].filter(x => !drop.includes(`${x.roleId}:${x.permission}:${x.requestedAction}`));

  async function setup(options: { rules?: (o: Objects, r: Rels) => readonly L14AuthorityPolicyRule[]; bootstrap?: boolean } = {}) {
    const base = await cak.setup({ bootstrap: false });
    const mk = (roles: readonly string[]) => c.mkUser(base.org, roles);
    const [as, as2, asflex, ascontrib, askind, asobject, asreltype, asrelstate, asapplicability] = [
      await mk([assessorRole]), await mk([assessorRole]), await mk([flexAssessorRole]), await mk([contribAssessorRole]),
      await mk([kindAssessorRole]), await mk([objectAssessorRole]), await mk([relTypeAssessorRole]), await mk([relStateAssessorRole]),
      await mk([applicabilityOnlyRole])];
    const policyRules = options.rules ? options.rules(base.objects, base.rels) : rules(base.objects, base.rels);
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(base.boot, `${base.label}-as`, policyRules);
    return { ...base, as, as2, asflex, ascontrib, askind, asobject, asreltype, asrelstate, asapplicability,
      v1: first?.admitted as Record<string, any> };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** A VALIDATED S1C.4 applicability (APPLIES by default) of `target` pinning a fresh VALIDATED control definition. */
  async function applicability(ctx: Ctx, name: string, target: L14ControlApplicabilityTarget, options: {
    pin?: ControlPin; applicability?: 'APPLIES' | 'DOES_NOT_APPLY'; from?: string | null; to?: string | null } = {}): Promise<Applicability> {
    const pin = options.pin ?? await cak.control(ctx as never, `${name}-ctl`);
    const r = await cak.apply(ctx as never, `${name}-ca`, target, pin,
      { applicability: options.applicability ?? 'APPLIES', from: options.from ?? null, to: options.to ?? null });
    return { target, pin, stateId: r.stateId };
  }

  // ---- CONTROL_ASSESSMENT commands ----
  const validateProposal = (applicabilityStateId: string, outcome: L14ControlAssessmentOutcome = 'SATISFIED',
    requestedValidUntil: string | null = inDays(30), requestedEffectiveFrom: string | null = null): L14ControlAssessmentProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', controlApplicabilityStateId: applicabilityStateId, assessmentOutcome: outcome,
    requestedEffectiveFrom, requestedValidUntil, targetStateId: null });
  const revokeProposal = (applicabilityStateId: string, targetStateId: string, outcome: L14ControlAssessmentOutcome = 'SATISFIED',
    requestedEffectiveFrom: string | null = null): L14ControlAssessmentProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', controlApplicabilityStateId: applicabilityStateId, assessmentOutcome: outcome,
    requestedEffectiveFrom, requestedValidUntil: null, targetStateId });

  interface SubmitInput {
    commandId: string; proposal: L14ControlAssessmentProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
    /** Raw operand overrides (shapes the TS mirror itself refuses to frame). */
    raw?: Partial<Record<'outcome' | 'applicabilityStateId' | 'validUntil' | 'sourceClass', string | null>>;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal, raw = input.raw ?? {};
    const fingerprint = input.fingerprint ?? submitControlAssessmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    const pick = (key: keyof NonNullable<SubmitInput['raw']>, value: string | null | undefined) => (key in raw ? raw[key] : value);
    const applicabilityState = pick('applicabilityStateId', p.controlApplicabilityStateId);
    const validUntil = pick('validUntil', p.requestedValidUntil);
    return `select to_json(r) from gov_repo.l14_submit_control_assessment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: textOrNull(pick('sourceClass', p.sourceClass)),
      p_control_applicability_state_id: applicabilityState == null ? 'null::uuid' : `${lit(applicabilityState)}::uuid`,
      p_assessment_outcome: textOrNull(pick('outcome', p.assessmentOutcome)),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_requested_valid_until: tsOrNull(validUntil ?? null),
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14ControlAssessmentProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideControlAssessmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_control_assessment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? controlAssessmentReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14ControlAssessmentProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const head = async (org: string, applicabilityStateId: string) => {
    const h = JSON.parse(lastLine(await owner(
      `select coalesce((select to_json(h) from gov_repo.l14_control_assessment_heads h where organisation_id='${org}'
         and control_applicability_state_id='${applicabilityStateId}'), 'null'::json)`,
    ))) as { latest_state_id: string | null } | null;
    return h?.latest_state_id ?? null;
  };
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14ControlAssessmentProposalContent, prior: string | null = null,
    support?: L14Support) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior, support }));
  }
  /** DECIDE with the key's CURRENT head as the exact expectation (NULL = expected-none). */
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14ControlAssessmentProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE', support?: L14Support) {
    const expected = await head(ctx.org, proposal.controlApplicabilityStateId);
    return exec(decideSql(actor, { commandId: ctx.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, expected, support }));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (assessor, or flex for explicit dating). On a key with a head: renewal / correction. */
  async function assess(ctx: Ctx, name: string, applicabilityStateId: string, options: {
    outcome?: L14ControlAssessmentOutcome; from?: string | null; until?: string; validator?: Actor } = {}) {
    const proposal = validateProposal(applicabilityStateId, options.outcome ?? 'SATISFIED', options.until ?? inDays(30), options.from ?? null);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const validator = options.validator ?? (options.from != null ? ctx.asflex : ctx.as);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided, stateId: decided.fact_state_id as string };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (assessor, or flex for dating) of the key's current VALIDATED assessment. */
  async function revoke(ctx: Ctx, name: string, applicabilityStateId: string, targetStateId: string,
    outcome: L14ControlAssessmentOutcome = 'SATISFIED', from: string | null = null, actor?: Actor) {
    const proposal = revokeProposal(applicabilityStateId, targetStateId, outcome, from);
    const submitted = await submit(ctx, ctx.member, `${name}-rv-submit`, proposal);
    const decided = await decide(ctx, actor ?? (from === null ? ctx.as : ctx.asflex), `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED assessment of the applicability state at business instant `at` as known at cutoff `cutoff` (SQL). */
  const resolveRow = async (org: string, applicabilityStateId: string, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_control_assessment_valid_state_v1('${org}', '${applicabilityStateId}'::uuid, ${at}, ${cutoff}) r`))) as Array<Record<string, any>>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0] ?? null;
  };
  const resolve = async (org: string, applicabilityStateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    ((await resolveRow(org, applicabilityStateId, at, cutoff))?.fact_state_id as string | undefined) ?? null;
  /** The read answer of a key: one of the five outcomes | UNKNOWN (no row). */
  const outcome = async (org: string, applicabilityStateId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    ((await resolveRow(org, applicabilityStateId, at, cutoff))?.assessment_outcome as string | undefined) ?? 'UNKNOWN';
  /** Current assessments of one exact target (control_definition_id|control_applicability_state_id|outcome|fact_state_id, sorted). */
  const current = async (org: string, target: L14ControlApplicabilityTarget, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    JSON.parse(lastLine(await owner(`select coalesce(json_agg(r.control_definition_id||'|'||r.control_applicability_state_id||'|'||r.assessment_outcome||'|'||r.fact_state_id
      order by r.control_definition_id), '[]') from gov_repo.l14_control_assessments_current_v1('${org}', ${cak.targetOperands(target).join(', ')}, ${at}, ${cutoff}) r`))) as string[];
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1C5_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every CONTROL_ASSESSMENT-subject row of an organisation (typed tables, heads, envelope rows of that subject). */
  const factDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...CONTROL_ASSESSMENT_TABLES]
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all ${['l14_fact_states', 'l14_proposals', 'l14_authorization_decisions', 'l14_governance_decisions', 'l14_command_results']
      .map(t => `select '${t}:'||t::text from gov_repo.${t} t where organisation_id='${org}' and subject_kind='CONTROL_ASSESSMENT'`).join(' union all ')}) s`));
  /** md5 of every S1C.4 CONTROL_APPLICABILITY row of an organisation (the dependency history an assessment must never touch). */
  const applicabilityDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...CONTROL_APPLICABILITY_TABLES]
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all select 'f:'||t::text from gov_repo.l14_fact_states t where organisation_id='${org}' and subject_kind='CONTROL_APPLICABILITY') s`));
  /** md5 of every immutable governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_fact_states', 'l14_control_applicability_proposals', 'l14_control_applicability_states', 'l14_control_assessment_proposals',
      'l14_control_assessment_states', 'l14_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
      'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** Full-row text of one fact state (envelope + typed detail) plus its system columns (xmin / ctid): an UPDATE changes them. */
  const stateRows = async (org: string, factStateId: string) => lastLine(await owner(`select
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_fact_states t where organisation_id='${org}' and fact_state_id='${factStateId}')||'#'||
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_control_assessment_states t where organisation_id='${org}' and fact_state_id='${factStateId}')`));
  return {
    cak, assessorRole, flexAssessorRole, contribAssessorRole, kindAssessorRole, objectAssessorRole, relTypeAssessorRole,
    relStateAssessorRole, applicabilityOnlyRole, rules, setup, applicability, validateProposal, revokeProposal, submitSql, decideSql,
    decideSqlFor, head, submit, decide, assess, revoke, resolveRow, resolve, outcome, current, counts, factDigest, applicabilityDigest,
    stateRows, historyDigest, instant: cak.instant, canonical: cak.canonical,
  };
}
export type ControlAssessmentKit = Awaited<ReturnType<typeof controlAssessmentKit>>;
