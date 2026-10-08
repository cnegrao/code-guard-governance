import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14DomainProposalContent, L14DomainSubject, L14DomainSubjectKind, L14GovernanceOutcome, L14SourceClass,
  L14Support,
} from '@council/canonical-contracts';
import {
  admitDomainFingerprint, decideDomainProposalFingerprint, domainReasonCode, submitDomainProposalFingerprint,
} from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { successorKit } from './m16-l14-successor-fixtures';

/**
 * M16-S1B.5 BUSINESS_DOMAIN / INFORMATION_DOMAIN registry fixtures on the S1B5-horizon L14 cluster (full canonical chain +
 * S1B.3 + S1B.4 + S1B.5). Every organisation's Authority Policy is bootstrapped through the real AP RPCs; every domain
 * command goes through the real S1B.5 RPCs as service_role with the caller fingerprint computed by the production
 * TypeScript mirror (@council/governance-review). Owner access only inserts administrator support rows, reads evidence
 * and runs rolled-back structural probes.
 */
export const DOMAIN_TABLES = ['l14_domain_admissions', 'l14_domain_proposals', 'l14_domain_states', 'l14_domain_heads'] as const;
export const L14_S1B5_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', ...DOMAIN_TABLES,
  'l14_governance_parties', 'l14_policy_admissions', 'l14_policy_version_admissions', 'l14_policy_version_states',
] as const;
const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);

export interface DomainRuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }

export async function domainKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const ap = await successorKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const registrarRole = await role('L14_DOMAIN_REGISTRAR');
  const stewardRole = await role('L14_DOMAIN_STEWARD');
  const flexRole = await role('L14_DOMAIN_FLEX_STEWARD');
  const contribRole = await role('L14_DOMAIN_CONTRIBUTOR');
  const partyRole = await role('L14_DOMAIN_PARTY_ADMIN');

  /**
   * AP administration (opsRole) + domain administration. registrar: ADMIT. steward: every decision, no flags. flex: every
   * decision with self-validation / future / back dating. contributor: a CONTRIBUTING (never authorizing) ADMIT and
   * VALIDATE rule. partyAdmin: the Party permissions (a different registry never administers domains). All registry
   * rules are ALL_ALLOWED_TARGETS (D-14). variant only varies content (a distinct content hash per successor).
   */
  const domainRules = (variant = 0, flags: DomainRuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REJECT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'DEFER'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REVOKE'),
    rule(registrarRole, 'L14_DOMAIN_ADMIT', 'ADMIT'),
    rule(contribRole, 'L14_DOMAIN_ADMIT', 'ADMIT', { sourceDisposition: 'CONTRIBUTING' }),
    rule(contribRole, 'L14_DOMAIN_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(stewardRole, 'L14_DOMAIN_VALIDATE', 'VALIDATE', flags.validate),
    rule(stewardRole, 'L14_DOMAIN_VALIDATE', 'REJECT'),
    rule(stewardRole, 'L14_DOMAIN_VALIDATE', 'DEFER'),
    rule(stewardRole, 'L14_DOMAIN_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_DOMAIN_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_DOMAIN_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(partyRole, 'L14_PARTY_ADMIT', 'ADMIT'),
    rule(partyRole, 'L14_PARTY_VALIDATE', 'VALIDATE'),
    ...KINDS.slice(0, variant).map(kind => rule(memberRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: kind })),
  ].filter(r => !drop.includes(`${r.roleId}:${r.permission}:${r.requestedAction}`));

  let n = 0;
  async function setup(rules: readonly L14AuthorityPolicyRule[] = domainRules(), options: { bootstrap?: boolean } = {}) {
    const org = await c.newOrg();
    const boot = await c.mkUser(org, [adminRole, ap.opsRole]);
    const ops = await c.mkUser(org, [ap.opsRole]);
    const registrar = await c.mkUser(org, [registrarRole]);
    const registrar2 = await c.mkUser(org, [registrarRole]);
    const steward = await c.mkUser(org, [stewardRole]);
    const steward2 = await c.mkUser(org, [stewardRole]);
    const flex = await c.mkUser(org, [flexRole]);
    const member = await c.mkUser(org, [memberRole]);
    const contrib = await c.mkUser(org, [contribRole]);
    const party = await c.mkUser(org, [partyRole]);
    const label = `dom${++n}`;
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(boot, label, rules);
    return { org, boot, ops, registrar, registrar2, steward, steward2, flex, member, contrib, party, label,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** A fresh L6 domain identity value (opaque, as the L6 contract types it). */
  const subject = (kind: L14DomainSubjectKind, name: string): L14DomainSubject => ({
    subjectKind: kind, domainId: `${kind === 'BUSINESS_DOMAIN' ? 'business-domain' : 'information-domain'}:${name}:${randomUUID()}` });

  interface AdmitInput {
    commandId: string; subject: L14DomainSubject | { subjectKind: string; domainId: string }; support?: L14Support;
    sourceClass?: L14SourceClass | string; expectation?: string | null; fingerprint?: string; session?: SessionOverride;
  }
  function admitSql(actor: Actor, input: AdmitInput) {
    const support = input.support ?? NONE, sourceClass = input.sourceClass ?? 'LOCAL_HUMAN', s = input.subject;
    const fingerprint = input.fingerprint ?? admitDomainFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, subjectKind: s.subjectKind as L14DomainSubjectKind,
      domainId: s.domainId, sourceClass: sourceClass as L14SourceClass, support });
    return `select to_json(r) from gov_repo.l14_admit_domain_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId),
      p_expectation_kind: input.expectation === null ? 'null::text' : lit(input.expectation ?? 'EXPECTED_NONE'),
      p_subject_kind: lit(s.subjectKind), p_domain_id: lit(s.domainId), p_source_class: lit(sourceClass),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface SubmitInput {
    commandId: string; proposal: L14DomainProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal;
    const fingerprint = input.fingerprint ?? submitDomainProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l14_submit_domain_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_subject_kind: lit(p.subjectKind), p_domain_id: lit(p.domainId),
      p_requested_effective_from: p.requestedEffectiveFrom === null ? 'null::timestamptz' : `${lit(p.requestedEffectiveFrom)}::timestamptz`,
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14DomainProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideDomainProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_domain_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? domainReasonCode(input.proposal.subjectKind, outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14DomainProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const validateProposal = (s: L14DomainSubject, requestedEffectiveFrom: string | null = null): L14DomainProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', ...s, requestedEffectiveFrom, targetStateId: null });
  const revokeProposal = (s: L14DomainSubject, targetStateId: string, requestedEffectiveFrom: string | null = null): L14DomainProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', ...s, requestedEffectiveFrom, targetStateId });

  const head = async (org: string, s: L14DomainSubject) => JSON.parse(lastLine(await owner(
    `select coalesce((select to_json(h) from gov_repo.l14_domain_heads h where organisation_id='${org}'
       and subject_kind=${lit(s.subjectKind)} and domain_id=${lit(s.domainId)}), 'null'::json)`,
  ))) as { organisation_id: string; subject_kind: string; domain_id: string; latest_state_id: string | null } | null;

  async function admit(ctx: Ctx, actor: Actor, name: string, s: L14DomainSubject, support?: L14Support) {
    return exec(admitSql(actor, { commandId: ctx.cmd(name), subject: s, support }));
  }
  /** A fresh L6 identity admitted by the registrar (ADMIT only: no decision, no state). */
  async function admitted(ctx: Ctx, name: string, kind: L14DomainSubjectKind = 'BUSINESS_DOMAIN') {
    const s = subject(kind, name);
    await admit(ctx, ctx.registrar, `${name}-admit`, s);
    return s;
  }
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14DomainProposalContent, prior: string | null = null) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior }));
  }
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14DomainProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE') {
    const h = await head(ctx.org, proposal);
    return exec(decideSqlFor(actor, ctx.cmd(name), submitted.proposal_id, proposal, outcome, h?.latest_state_id ?? null));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (steward) of an admitted domain. */
  async function validate(ctx: Ctx, name: string, s: L14DomainSubject, requestedEffectiveFrom: string | null = null,
    validator: Actor = ctx.steward) {
    const proposal = validateProposal(s, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (actor) of the domain's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, s: L14DomainSubject, stateId: string, requestedEffectiveFrom: string | null = null,
    actor: Actor = ctx.steward) {
    const proposal = revokeProposal(s, stateId, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, actor, `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED state of the domain at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolve = async (org: string, s: L14DomainSubject, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_domain_valid_state_v1('${org}', ${lit(s.subjectKind)}, ${lit(s.domainId)}, ${at}, ${cutoff}) r`))) as Array<{ state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.state_id ?? null;
  };
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1B5_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable domain-governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...DOMAIN_TABLES, 'l14_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
      'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_registry_states', 'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** A successor Authority Policy through the real AP RPCs (ops ADMIT → member SUBMIT → ops VALIDATE). */
  async function apSuccessor(ctx: Ctx, name: string, rules: readonly L14AuthorityPolicyRule[]) {
    return ap.successor(ctx as never, name, rules);
  }
  return {
    ap, registrarRole, stewardRole, flexRole, contribRole, partyRole, domainRules, setup, subject, admitSql, submitSql, decideSql,
    decideSqlFor, validateProposal, revokeProposal, head, admit, admitted, submit, decide, validate, revoke, resolve, counts,
    historyDigest, apSuccessor, instant: ap.instant, canonical: ap.canonical,
  };
}
export type DomainKit = Awaited<ReturnType<typeof domainKit>>;
