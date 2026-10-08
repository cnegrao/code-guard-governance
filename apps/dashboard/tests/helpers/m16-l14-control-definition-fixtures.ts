import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14ControlDefinitionAdmitExpectation, L14ControlDefinitionProposalContent,
  L14ControlDefinitionVersionContent, L14ControlDefinitionVersionSubject, L14GovernanceOutcome, L14SourceClass, L14Support,
} from '@council/canonical-contracts';
import {
  admitControlDefinitionVersionFingerprint, controlDefinitionContentHash, controlDefinitionReasonCode,
  decideControlDefinitionProposalFingerprint, submitControlDefinitionProposalFingerprint,
} from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { successorKit } from './m16-l14-successor-fixtures';

/**
 * M16-S1B.6 CONTROL_DEFINITION registry fixtures on the S1B6-horizon L14 cluster (full canonical chain + S1B.3 + S1B.4 +
 * S1B.5 + S1B.6). Every organisation's Authority Policy is bootstrapped through the real AP RPCs; every control definition
 * command goes through the real S1B.6 RPCs as service_role with the content hash and caller fingerprint computed by the
 * production TypeScript mirror (@council/governance-review). Owner access only inserts administrator support rows, reads
 * evidence and runs rolled-back structural probes.
 */
export const CONTROL_TABLES = [
  'l14_control_definitions', 'l14_control_definition_versions', 'l14_control_definition_proposals',
  'l14_control_definition_states', 'l14_control_definition_heads',
] as const;
export const L14_S1B6_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', ...CONTROL_TABLES,
  'l14_governance_parties', 'l14_policy_admissions', 'l14_policy_version_admissions', 'l14_policy_version_states',
  'l14_domain_admissions', 'l14_domain_states',
] as const;
const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);

export interface ControlRuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }

/** A version admitted through the real RPC: the exact governed tuple + its content. */
export interface AdmittedVersion extends L14ControlDefinitionVersionSubject { readonly content: L14ControlDefinitionVersionContent }

export async function controlDefinitionKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const ap = await successorKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const registrarRole = await role('L14_CONTROL_REGISTRAR');
  const stewardRole = await role('L14_CONTROL_STEWARD');
  const flexRole = await role('L14_CONTROL_FLEX_STEWARD');
  const contribRole = await role('L14_CONTROL_CONTRIBUTOR');
  const domainRole = await role('L14_CONTROL_DOMAIN_ADMIN');

  /**
   * AP administration (opsRole) + control-definition administration. registrar: ADMIT. steward: every decision, no flags.
   * flex: every decision with self-validation / future / back dating. contributor: a CONTRIBUTING (never authorizing) ADMIT
   * and VALIDATE rule. domainAdmin: the domain permissions (a different registry never administers control definitions).
   * All registry rules are ALL_ALLOWED_TARGETS (D-14). variant only varies content (a distinct content hash per successor).
   */
  const controlRules = (variant = 0, flags: ControlRuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REJECT'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'DEFER'),
    rule(ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REVOKE'),
    rule(registrarRole, 'L14_CONTROL_DEFINITION_ADMIT', 'ADMIT'),
    rule(contribRole, 'L14_CONTROL_DEFINITION_ADMIT', 'ADMIT', { sourceDisposition: 'CONTRIBUTING' }),
    rule(contribRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(stewardRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'VALIDATE', flags.validate),
    rule(stewardRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'REJECT'),
    rule(stewardRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'DEFER'),
    rule(stewardRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_CONTROL_DEFINITION_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(domainRole, 'L14_DOMAIN_ADMIT', 'ADMIT'),
    rule(domainRole, 'L14_DOMAIN_VALIDATE', 'VALIDATE'),
    ...KINDS.slice(0, variant).map(kind => rule(memberRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: kind })),
  ].filter(r => !drop.includes(`${r.roleId}:${r.permission}:${r.requestedAction}`));

  let n = 0;
  async function setup(rules: readonly L14AuthorityPolicyRule[] = controlRules(), options: { bootstrap?: boolean } = {}) {
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
    const domain = await c.mkUser(org, [domainRole]);
    const label = `cd${++n}`;
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(boot, label, rules);
    return { org, boot, ops, registrar, registrar2, steward, steward2, flex, member, contrib, domain, label,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** Fresh descriptive content (never identity). */
  const content = (name: string, overrides: Partial<L14ControlDefinitionVersionContent> = {}): L14ControlDefinitionVersionContent => ({
    controlCode: `CTRL-${name}`, title: `Control ${name}`, description: `Description of control ${name}.\nSecond line.`, ...overrides });
  const hashOf = (value: L14ControlDefinitionVersionContent) => controlDefinitionContentHash(value);

  interface AdmitInput {
    commandId: string; controlDefinitionId: string; versionId: string; content: L14ControlDefinitionVersionContent;
    expectation?: L14ControlDefinitionAdmitExpectation; rawExpectationKind?: string | null; rawExpectedLatest?: string | null;
    contentHash?: string; support?: L14Support; sourceClass?: L14SourceClass | string; fingerprint?: string; session?: SessionOverride;
  }
  function admitSql(actor: Actor, input: AdmitInput) {
    const support = input.support ?? NONE, sourceClass = input.sourceClass ?? 'LOCAL_HUMAN';
    const expectation = input.expectation ?? { kind: 'EXPECTED_NONE' };
    const fingerprint = input.fingerprint ?? admitControlDefinitionVersionFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, controlDefinitionId: input.controlDefinitionId,
      controlDefinitionVersionId: input.versionId, expectation, content: input.content, sourceClass: sourceClass as L14SourceClass, support });
    const kind = input.rawExpectationKind !== undefined ? input.rawExpectationKind : expectation.kind;
    const latest = input.rawExpectedLatest !== undefined ? input.rawExpectedLatest
      : expectation.kind === 'EXPECTED_CURRENT' ? expectation.latestVersionId : null;
    return `select to_json(r) from gov_repo.l14_admit_control_definition_version_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId),
      p_control_definition_id: uuidOrNull(input.controlDefinitionId), p_control_definition_version_id: uuidOrNull(input.versionId),
      p_expectation_kind: kind === null ? 'null::text' : lit(kind), p_expected_latest_version_id: uuidOrNull(latest),
      p_control_code: lit(input.content.controlCode), p_title: lit(input.content.title), p_description: lit(input.content.description),
      p_content_hash: lit(input.contentHash ?? hashOf(input.content)), p_source_class: lit(sourceClass),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface SubmitInput {
    commandId: string; proposal: L14ControlDefinitionProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal;
    const fingerprint = input.fingerprint ?? submitControlDefinitionProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l14_submit_control_definition_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_control_definition_id: uuidOrNull(p.controlDefinitionId),
      p_control_definition_version_id: uuidOrNull(p.controlDefinitionVersionId), p_content_hash: lit(p.contentHash),
      p_requested_effective_from: p.requestedEffectiveFrom === null ? 'null::timestamptz' : `${lit(p.requestedEffectiveFrom)}::timestamptz`,
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14ControlDefinitionProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideControlDefinitionProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_control_definition_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? controlDefinitionReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14ControlDefinitionProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const subjectOf = (v: L14ControlDefinitionVersionSubject): L14ControlDefinitionVersionSubject => ({
    controlDefinitionId: v.controlDefinitionId, controlDefinitionVersionId: v.controlDefinitionVersionId, contentHash: v.contentHash });
  const validateProposal = (v: L14ControlDefinitionVersionSubject, requestedEffectiveFrom: string | null = null): L14ControlDefinitionProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', ...subjectOf(v), requestedEffectiveFrom, targetStateId: null });
  const revokeProposal = (v: L14ControlDefinitionVersionSubject, targetStateId: string, requestedEffectiveFrom: string | null = null): L14ControlDefinitionProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', ...subjectOf(v), requestedEffectiveFrom, targetStateId });

  const head = async (org: string, v: L14ControlDefinitionVersionSubject) => JSON.parse(lastLine(await owner(
    `select coalesce((select to_json(h) from gov_repo.l14_control_definition_heads h where organisation_id='${org}'
       and control_definition_id='${v.controlDefinitionId}' and control_definition_version_id='${v.controlDefinitionVersionId}'), 'null'::json)`,
  ))) as { content_hash: string; latest_state_id: string | null } | null;

  /** ADMIT the first version of a NEW identity (EXPECTED_NONE) as the registrar. */
  async function admitFirst(ctx: Ctx, name: string, value: L14ControlDefinitionVersionContent = content(name), actor: Actor = ctx.registrar) {
    const controlDefinitionId = randomUUID(), versionId = randomUUID();
    const r = await exec(admitSql(actor, { commandId: ctx.cmd(`${name}-admit`), controlDefinitionId, versionId, content: value }));
    return { r, version: { controlDefinitionId, controlDefinitionVersionId: versionId, contentHash: hashOf(value), content: value } as AdmittedVersion };
  }
  /** ADMIT a successor version pinned to the exact expected latest admitted version (EXPECTED_CURRENT). */
  async function admitNext(ctx: Ctx, name: string, latest: AdmittedVersion, value: L14ControlDefinitionVersionContent, actor: Actor = ctx.registrar) {
    const versionId = randomUUID();
    const r = await exec(admitSql(actor, { commandId: ctx.cmd(`${name}-admit`), controlDefinitionId: latest.controlDefinitionId, versionId,
      content: value, expectation: { kind: 'EXPECTED_CURRENT', latestVersionId: latest.controlDefinitionVersionId } }));
    return { r, version: { controlDefinitionId: latest.controlDefinitionId, controlDefinitionVersionId: versionId, contentHash: hashOf(value),
      content: value } as AdmittedVersion };
  }
  async function admitted(ctx: Ctx, name: string) { return (await admitFirst(ctx, name)).version; }
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14ControlDefinitionProposalContent, prior: string | null = null) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior }));
  }
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14ControlDefinitionProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE') {
    const h = await head(ctx.org, proposal);
    return exec(decideSqlFor(actor, ctx.cmd(name), submitted.proposal_id, proposal, outcome, h?.latest_state_id ?? null));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (steward) of an admitted version tuple. */
  async function validate(ctx: Ctx, name: string, v: L14ControlDefinitionVersionSubject, requestedEffectiveFrom: string | null = null,
    validator: Actor = ctx.steward) {
    const proposal = validateProposal(v, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (actor) of the tuple's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, v: L14ControlDefinitionVersionSubject, stateId: string, requestedEffectiveFrom: string | null = null,
    actor: Actor = ctx.steward) {
    const proposal = revokeProposal(v, stateId, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, actor, `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED state of the tuple at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolve = async (org: string, v: L14ControlDefinitionVersionSubject, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_control_definition_valid_state_v1('${org}', '${v.controlDefinitionId}', '${v.controlDefinitionVersionId}',
        ${lit(v.contentHash)}, ${at}, ${cutoff}) r`))) as Array<{ state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.state_id ?? null;
  };
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1B6_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable control-definition governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...CONTROL_TABLES, 'l14_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
      'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_registry_states', 'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** A successor Authority Policy through the real AP RPCs (ops ADMIT → member SUBMIT → ops VALIDATE). */
  async function apSuccessor(ctx: Ctx, name: string, rules: readonly L14AuthorityPolicyRule[]) {
    return ap.successor(ctx as never, name, rules);
  }
  return {
    ap, registrarRole, stewardRole, flexRole, contribRole, domainRole, controlRules, setup, content, hashOf, admitSql, submitSql,
    decideSql, decideSqlFor, validateProposal, revokeProposal, subjectOf, head, admitFirst, admitNext, admitted, submit, decide,
    validate, revoke, resolve, counts, historyDigest, apSuccessor, instant: ap.instant, canonical: ap.canonical,
  };
}
export type ControlDefinitionKit = Awaited<ReturnType<typeof controlDefinitionKit>>;
