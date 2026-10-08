import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L14PolicyVersionProposalContent, L14PolicyVersionSubject, L14Support,
} from '@council/canonical-contracts';
import {
  decidePolicyVersionProposalFingerprint, policyVersionReasonCode, submitPolicyVersionProposalFingerprint,
} from '@council/governance-review';
import { lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { policyKit } from './m16-l14-policy-fixtures';

/**
 * M16-S1B.4 POLICY_VERSION governance fixtures on the S1B4-horizon L14 cluster (full canonical chain + S1B.3 + S1B.4).
 * Every Authority Policy goes through the real AP RPCs, every policy / version admission through the real S1B.3 RPCs,
 * and every POLICY_VERSION command through the real S1B.4 RPCs as service_role with the caller fingerprint computed by
 * the production TypeScript mirror (@council/governance-review). Owner access only reads evidence / probes structure.
 */
export const VALIDATION_TABLES = ['l14_policy_version_proposals', 'l14_policy_version_states', 'l14_policy_version_heads'] as const;
export const L14_S1B4_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states',
  'l14_policy_admissions', 'l14_policy_version_admissions', ...VALIDATION_TABLES, 'governance_policies', 'policy_versions',
] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);

export interface ValidationRuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }

export async function policyValidationKit(c: L14Cluster) {
  const { owner, exec } = c;
  const pk = await policyKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const flexRole = await role('L14_POLICY_FLEX_VALIDATOR');
  const contribValidatorRole = await role('L14_POLICY_CONTRIB_VALIDATOR');

  /**
   * The S1B.3 policy rules + POLICY_VERSION governance. validator: every decision (no flags unless given). flex: every
   * decision with self-validation / future / back dating. contributing validator: a CONTRIBUTING (never authorizing)
   * VALIDATE rule. All registry rules ALL_ALLOWED_TARGETS (D-14). The S1B.3 validator VALIDATE rule is replaced by the
   * flagged one here so a variant can vary only the VALIDATE / REVOKE flags.
   */
  const validationRules = (variant = 0, flags: ValidationRuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    ...pk.policyRules(variant).filter(r => !(r.roleId === pk.validatorRole && r.permission === 'L14_POLICY_VERSION_VALIDATE')),
    rule(pk.validatorRole, 'L14_POLICY_VERSION_VALIDATE', 'VALIDATE', flags.validate),
    rule(pk.validatorRole, 'L14_POLICY_VERSION_VALIDATE', 'REJECT'),
    rule(pk.validatorRole, 'L14_POLICY_VERSION_VALIDATE', 'DEFER'),
    rule(pk.validatorRole, 'L14_POLICY_VERSION_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_POLICY_VERSION_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_POLICY_VERSION_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(contribValidatorRole, 'L14_POLICY_VERSION_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
  ].filter(r => !drop.includes(`${r.roleId}:${r.permission}:${r.requestedAction}`));

  async function setup(rules: readonly L14AuthorityPolicyRule[] = validationRules(), options: { bootstrap?: boolean } = {}) {
    const ctx = await pk.setup(rules, options);
    const validator2 = await c.mkUser(ctx.org, [pk.validatorRole]);
    const flex = await c.mkUser(ctx.org, [flexRole]);
    const contribValidator = await c.mkUser(ctx.org, [contribValidatorRole]);
    return { ...ctx, validator2, flex, contribValidator };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** A fresh M16-admitted policy + first version through the real S1B.3 RPCs; returns the exact governed tuple. */
  async function admitted(ctx: Ctx, name: string, content = `# ${name} ${randomUUID()}`): Promise<L14PolicyVersionSubject> {
    const policy = await pk.admitPolicy(ctx, ctx.author, `${name}-admit-policy`, pk.descriptor(`${ctx.label}-${name}`.slice(0, 20)));
    const version = await pk.admitVersion(ctx, ctx.author, `${name}-admit-version`, policy.policy_id, content);
    return { policyId: version.policy_id, versionId: version.version_id, contentHash: version.content_hash };
  }

  const validateProposal = (s: L14PolicyVersionSubject, requestedEffectiveFrom: string | null = null): L14PolicyVersionProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', ...s, requestedEffectiveFrom, targetStateId: null });
  const revokeProposal = (s: L14PolicyVersionSubject, targetStateId: string, requestedEffectiveFrom: string | null = null): L14PolicyVersionProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', ...s, requestedEffectiveFrom, targetStateId });

  interface SubmitInput {
    commandId: string; proposal: L14PolicyVersionProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal;
    const fingerprint = input.fingerprint ?? submitPolicyVersionProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l14_submit_policy_version_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_policy_id: uuidOrNull(p.policyId), p_version_id: uuidOrNull(p.versionId),
      p_content_hash: lit(p.contentHash),
      p_requested_effective_from: p.requestedEffectiveFrom === null ? 'null::timestamptz' : `${lit(p.requestedEffectiveFrom)}::timestamptz`,
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14PolicyVersionProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decidePolicyVersionProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_policy_version_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? policyVersionReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14PolicyVersionProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const head = async (org: string, s: L14PolicyVersionSubject) => JSON.parse(lastLine(await owner(
    `select coalesce((select to_json(h) from gov_repo.l14_policy_version_heads h where organisation_id='${org}'
       and policy_id='${s.policyId}' and version_id='${s.versionId}'), 'null'::json)`,
  ))) as { policy_id: string; version_id: string; content_hash: string; latest_state_id: string | null } | null;

  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14PolicyVersionProposalContent, prior: string | null = null) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior }));
  }
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14PolicyVersionProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE') {
    const h = await head(ctx.org, proposal);
    return exec(decideSqlFor(actor, ctx.cmd(name), submitted.proposal_id, proposal, outcome, h?.latest_state_id ?? null));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (validator) of an exact admitted tuple. */
  async function validate(ctx: Ctx, name: string, s: L14PolicyVersionSubject, requestedEffectiveFrom: string | null = null,
    validator: Actor = ctx.validator) {
    const proposal = validateProposal(s, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (actor) of the tuple's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, s: L14PolicyVersionSubject, stateId: string, requestedEffectiveFrom: string | null = null,
    actor: Actor = ctx.validator) {
    const proposal = revokeProposal(s, stateId, requestedEffectiveFrom);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const decided = await decide(ctx, actor, `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED state of the tuple at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolve = async (org: string, s: L14PolicyVersionSubject, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_policy_version_valid_state_v1('${org}', '${s.policyId}', '${s.versionId}', '${s.contentHash}', ${at}, ${cutoff}) r`))) as Array<{ state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.state_id ?? null;
  };
  /** The descriptor-read row of one exact admitted version (through the real controlled read as service_role). */
  const descriptor = async (actor: Actor, s: L14PolicyVersionSubject) =>
    (await pk.read(actor, s.policyId)).find(r => r.version_id === s.versionId) as Record<string, any>;
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1B4_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable governance-history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_policy_version_proposals', 'l14_policy_version_states', 'l14_proposals', 'l14_authorization_decisions',
      'l14_authorization_decision_roles', 'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_registry_states',
      'l14_command_results', 'l14_support_links', 'l14_policy_admissions', 'l14_policy_version_admissions', 'governance_policies',
      'policy_versions']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  return {
    pk, ap: pk.ap, flexRole, contribValidatorRole, validationRules, setup, admitted, validateProposal, revokeProposal,
    submitSql, decideSql, decideSqlFor, head, submit, decide, validate, revoke, resolve, descriptor, counts, historyDigest,
    instant: pk.ap.instant, canonical: pk.ap.canonical,
  };
}
export type PolicyValidationKit = Awaited<ReturnType<typeof policyValidationKit>>;
