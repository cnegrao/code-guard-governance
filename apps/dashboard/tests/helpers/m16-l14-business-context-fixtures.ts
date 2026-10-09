import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14BusinessContextAssignmentProposalContent, L14BusinessContextSemanticKind, L14BusinessContextTargetKind,
  L14DomainSubject, L14GovernanceOutcome, L14Support,
} from '@council/canonical-contracts';
import {
  businessContextReasonCode, decideBusinessContextAssignmentProposalFingerprint, submitBusinessContextAssignmentProposalFingerprint,
} from '@council/governance-review';
import { canonicalObjectKit, lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { domainKit } from './m16-l14-domain-fixtures';

/**
 * M16-S1C.2 BUSINESS_CONTEXT_ASSIGNMENT fixtures on the S1C2-horizon L14 cluster (full canonical chain + S1B.3..S1B.6 +
 * S1C.1 + S1C.2). Every organisation's Authority Policy is bootstrapped through the real AP RPCs; every domain goes through
 * the real S1B.5 domain RPCs (ADMIT → SUBMIT → DECIDE); every business-context command goes through the real S1C.2 RPCs as
 * service_role with the caller fingerprint computed by the production TypeScript mirror (@council/governance-review). Owner
 * access only inserts administrator support rows (organisations, users, roles, canonical objects, evidence), reads evidence
 * and runs rolled-back structural probes.
 */
export const BUSINESS_CONTEXT_TABLES = [
  'l14_business_context_assignment_proposals', 'l14_business_context_assignment_states', 'l14_business_context_assignment_heads',
] as const;
export const L14_S1C2_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', 'l14_fact_states',
  ...BUSINESS_CONTEXT_TABLES, 'l14_domain_admissions', 'l14_domain_proposals', 'l14_domain_states', 'l14_domain_heads',
] as const;
const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const tsOrNull = (value: string | null) => (value === null ? 'null::timestamptz' : `${lit(value)}::timestamptz`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
/** A syntactically valid but WRONG caller fingerprint (for inputs the TS mirror itself refuses to frame). */
export const BOGUS_FINGERPRINT = 'a'.repeat(64);

export interface BusinessContextRuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }
/** The canonical objects created for every organisation (exact ids). */
export interface Objects { agent: string; agent2: string; asset: string; asset2: string; element: string; element2: string; agentVersion: string; model: string }
export interface Key { targetKind: L14BusinessContextTargetKind; targetCanonicalObjectId: string; semanticKind: L14BusinessContextSemanticKind }
/** An admitted + VALIDATED S1B.5 domain: the L6 identity and the exact VALIDATED state to pin. */
export interface DomainPin { subject: L14DomainSubject; stateId: string }

export async function businessContextKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const dk = await domainKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const stewardRole = await role('L14_BC_STEWARD');
  const flexRole = await role('L14_BC_FLEX_STEWARD');
  const contribRole = await role('L14_BC_CONTRIBUTOR');
  const kindRole = await role('L14_BC_AGENT_KIND_STEWARD');
  const objectRole = await role('L14_BC_OBJECT_STEWARD');
  const relRole = await role('L14_BC_REL_TYPE_STEWARD');
  const respRole = await role('L14_BC_RESPONSIBILITY_STEWARD');

  /**
   * AP administration + domain administration (S1B.5 registrar / steward / flex) + business-context administration.
   * steward: every decision, ALL_ALLOWED_TARGETS, no flags. flex: every decision with self-validation / future / back dating.
   * contributor: a CONTRIBUTING (never authorizing) VALIDATE rule. kind: VALIDATE on CANONICAL_KIND AGENT only. object:
   * VALIDATE on the exact CANONICAL_OBJECT `asset` only. rel: VALIDATE on a RELATIONSHIP_TYPE scope (never matches an object
   * target). resp: the RESPONSIBILITY permission (another fact family never administers business context).
   */
  const rules = (o: Objects, variant = 0, flags: BusinessContextRuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    ...dk.domainRules(),
    rule(stewardRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE', flags.validate),
    rule(stewardRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'REJECT'),
    rule(stewardRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'DEFER'),
    rule(stewardRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'REJECT'),
    rule(flexRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'DEFER'),
    rule(contribRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(kindRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }),
    rule(objectRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'DATA_ASSET', scopeCanonicalObjectId: o.asset }),
    rule(relRole, 'L14_BUSINESS_CONTEXT_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'READS_FROM' }),
    rule(respRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE'),
    ...KINDS.slice(0, variant).map(kind => rule(memberRole, 'L14_CONTROL_APPLICABILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: kind })),
  ].filter(r => !drop.includes(`${r.roleId}:${r.permission}:${r.requestedAction}`));

  let n = 0;
  async function objectsFor(org: string, label: string): Promise<Objects> {
    const make = (suffix: string, kind: string) => canonicalObjectKit(org, `${label}-${suffix}`, kind,
      { proposedIdentity: { reference: `${label}-${suffix}` }, identity: `${label}-${suffix}` });
    const kits = { agent: make('agent', 'AGENT'), agent2: make('agent2', 'AGENT'), asset: make('asset', 'DATA_ASSET'),
      asset2: make('asset2', 'DATA_ASSET'), element: make('element', 'DATA_ELEMENT'), element2: make('element2', 'DATA_ELEMENT'),
      agentVersion: make('agentversion', 'AGENT_VERSION'), model: make('model', 'MODEL') };
    await owner(Object.values(kits).map(k => k.sql).join('\n'));
    return Object.fromEntries(Object.entries(kits).map(([name, k]) => [name, k.objectId])) as unknown as Objects;
  }
  async function setup(options: { rules?: (o: Objects) => readonly L14AuthorityPolicyRule[]; bootstrap?: boolean } = {}) {
    const org = await c.newOrg();
    const label = `bc${++n}-${randomUUID().slice(0, 8)}`;
    const objects = await objectsFor(org, label);
    const boot = await c.mkUser(org, [adminRole, dk.ap.opsRole]);
    const ops = await c.mkUser(org, [dk.ap.opsRole]);
    const registrar = await c.mkUser(org, [dk.registrarRole]);
    const steward = await c.mkUser(org, [dk.stewardRole]);
    const flex = await c.mkUser(org, [dk.flexRole]);
    const member = await c.mkUser(org, [memberRole]);
    const member2 = await c.mkUser(org, [memberRole]);
    const bs = await c.mkUser(org, [stewardRole]);
    const bs2 = await c.mkUser(org, [stewardRole]);
    const bflex = await c.mkUser(org, [flexRole]);
    const bcontrib = await c.mkUser(org, [contribRole]);
    const bkind = await c.mkUser(org, [kindRole]);
    const bobject = await c.mkUser(org, [objectRole]);
    const brel = await c.mkUser(org, [relRole]);
    const bresp = await c.mkUser(org, [respRole]);
    const policyRules = options.rules ? options.rules(objects) : rules(objects);
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(boot, label, policyRules);
    return { org, label, objects, boot, ops, registrar, steward, flex, member, member2, bs, bs2, bflex, bcontrib, bkind, bobject, brel, bresp,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // ---- Domain lifecycle through the real S1B.5 RPCs ----
  /** ADMIT (registrar) → SUBMIT VALIDATE (member) → DECIDE VALIDATE (domain steward, or domain flex for dating). */
  async function domain(ctx: Ctx, name: string, kind: L14BusinessContextSemanticKind = 'BUSINESS_DOMAIN',
    requestedEffectiveFrom: string | null = null): Promise<DomainPin> {
    const subject = await dk.admitted(ctx as never, `${name}-dom`, kind);
    const v = await dk.validate(ctx as never, `${name}-dom`, subject, requestedEffectiveFrom,
      requestedEffectiveFrom === null ? ctx.steward : ctx.flex);
    return { subject, stateId: v.decided.registry_state_id as string };
  }
  /** Admitted but never validated. */
  async function admittedDomain(ctx: Ctx, name: string, kind: L14BusinessContextSemanticKind = 'BUSINESS_DOMAIN') {
    return dk.admitted(ctx as never, `${name}-dom-admit`, kind);
  }
  async function revokeDomain(ctx: Ctx, name: string, pin: DomainPin, requestedEffectiveFrom: string | null = null) {
    const r = await dk.revoke(ctx as never, `${name}-dom-rv`, pin.subject, pin.stateId, requestedEffectiveFrom,
      requestedEffectiveFrom === null ? ctx.steward : ctx.flex);
    return r.decided;
  }
  /** Re-validation of a revoked domain (a NEW domain state; never the old one). */
  async function revalidateDomain(ctx: Ctx, name: string, pin: DomainPin): Promise<DomainPin> {
    const v = await dk.validate(ctx as never, `${name}-dom-reval`, pin.subject);
    return { subject: pin.subject, stateId: v.decided.registry_state_id as string };
  }

  // ---- BUSINESS_CONTEXT_ASSIGNMENT commands ----
  interface SubmitInput {
    commandId: string; proposal: L14BusinessContextAssignmentProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal;
    const fingerprint = input.fingerprint ?? submitBusinessContextAssignmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l14_submit_business_context_assignment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_target_kind: lit(p.targetKind), p_target_canonical_object_id: lit(p.targetCanonicalObjectId),
      p_semantic_kind: lit(p.semanticKind), p_domain_id: lit(p.domainId),
      p_domain_validated_state_id: uuidOrNull(p.domainValidatedStateId),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_requested_effective_to: tsOrNull(p.requestedEffectiveTo),
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14BusinessContextAssignmentProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideBusinessContextAssignmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_business_context_assignment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? businessContextReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14BusinessContextAssignmentProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const keyOf = (targetKind: L14BusinessContextTargetKind, targetCanonicalObjectId: string, semanticKind: L14BusinessContextSemanticKind): Key =>
    ({ targetKind, targetCanonicalObjectId, semanticKind });
  const validateProposal = (key: Key, pin: DomainPin, requestedEffectiveFrom: string | null = null,
    requestedEffectiveTo: string | null = null): L14BusinessContextAssignmentProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', ...key, domainId: pin.subject.domainId, domainValidatedStateId: pin.stateId,
    requestedEffectiveFrom, requestedEffectiveTo, targetStateId: null });
  const revokeProposal = (key: Key, pin: DomainPin, targetStateId: string,
    requestedEffectiveFrom: string | null = null): L14BusinessContextAssignmentProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', ...key, domainId: pin.subject.domainId, domainValidatedStateId: pin.stateId,
    requestedEffectiveFrom, requestedEffectiveTo: null, targetStateId });

  const head = async (org: string, key: Key) => {
    const h = JSON.parse(lastLine(await owner(
      `select coalesce((select to_json(h) from gov_repo.l14_business_context_assignment_heads h where organisation_id='${org}'
         and target_kind=${lit(key.targetKind)} and target_canonical_object_id=${lit(key.targetCanonicalObjectId)}
         and semantic_kind=${lit(key.semanticKind)}), 'null'::json)`,
    ))) as { latest_state_id: string | null } | null;
    return h?.latest_state_id ?? null;
  };
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14BusinessContextAssignmentProposalContent, prior: string | null = null,
    support?: L14Support) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior, support }));
  }
  /** DECIDE with the key's CURRENT head as the exact expectation (NULL = expected-none). */
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14BusinessContextAssignmentProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE', support?: L14Support) {
    const expected = await head(ctx.org, proposal);
    return exec(decideSql(actor, { commandId: ctx.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, expected, support }));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (bc steward, or flex for dating). On a VALIDATED key this is a supersession. */
  async function assign(ctx: Ctx, name: string, key: Key, pin: DomainPin, options: { from?: string | null; to?: string | null;
    validator?: Actor } = {}) {
    const proposal = validateProposal(key, pin, options.from ?? null, options.to ?? null);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const validator = options.validator ?? (options.from != null || options.to != null ? ctx.bflex : ctx.bs);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided, stateId: decided.fact_state_id as string };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (bc steward, or flex for dating) of the key's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, key: Key, pin: DomainPin, targetStateId: string, from: string | null = null, actor?: Actor) {
    const proposal = revokeProposal(key, pin, targetStateId, from);
    const submitted = await submit(ctx, ctx.member, `${name}-rv-submit`, proposal);
    const decided = await decide(ctx, actor ?? (from === null ? ctx.bs : ctx.bflex), `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED assignment of the key at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolveRow = async (org: string, key: Key, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_business_context_assignment_valid_state_v1('${org}', ${lit(key.targetKind)}, ${lit(key.targetCanonicalObjectId)},
        ${lit(key.semanticKind)}, ${at}, ${cutoff}) r`))) as Array<Record<string, any>>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0] ?? null;
  };
  const resolve = async (org: string, key: Key, at: string, cutoff: string) =>
    ((await resolveRow(org, key, at, cutoff))?.fact_state_id as string | undefined) ?? null;
  /** Current business context of one exact target (semantic_kind|domain_id|fact_state_id, sorted by semantic kind). */
  const current = async (org: string, targetKind: string, targetId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    JSON.parse(lastLine(await owner(`select coalesce(json_agg(r.semantic_kind||'|'||r.domain_id||'|'||r.fact_state_id
      order by r.semantic_kind), '[]') from gov_repo.l14_business_context_assignments_current_v1('${org}',
      ${lit(targetKind)}, ${lit(targetId)}, ${at}, ${cutoff}) r`))) as string[];
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1C2_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_fact_states', 'l14_business_context_assignment_proposals', 'l14_business_context_assignment_states', 'l14_proposals',
      'l14_authorization_decisions', 'l14_authorization_decision_roles', 'l14_authorization_decision_rules', 'l14_governance_decisions',
      'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** md5 of every BUSINESS_CONTEXT_ASSIGNMENT-subject row of an organisation (typed tables, heads, envelope rows of that subject). */
  const factDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...BUSINESS_CONTEXT_TABLES]
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all ${['l14_fact_states', 'l14_proposals', 'l14_authorization_decisions', 'l14_governance_decisions', 'l14_command_results']
      .map(t => `select '${t}:'||t::text from gov_repo.${t} t where organisation_id='${org}' and subject_kind='BUSINESS_CONTEXT_ASSIGNMENT'`).join(' union all ')}
    union all select 'fact-support:'||t::text from gov_repo.l14_support_links t where organisation_id='${org}' and owner_kind='FACT_STATE') s`));
  /** Full-row text of one fact state (envelope + typed detail) plus its system columns (xmin / ctid): an UPDATE changes them. */
  const stateRows = async (org: string, factStateId: string) => lastLine(await owner(`select
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_fact_states t where organisation_id='${org}' and fact_state_id='${factStateId}')||'#'||
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_business_context_assignment_states t where organisation_id='${org}' and fact_state_id='${factStateId}')`));
  const instant = (offset: string) => dk.instant(offset);
  return {
    dk, stewardRole, flexRole, contribRole, kindRole, objectRole, relRole, respRole, rules, setup, domain, admittedDomain, revokeDomain,
    revalidateDomain, submitSql, decideSql, decideSqlFor, keyOf, validateProposal, revokeProposal, head, submit, decide, assign, revoke,
    resolveRow, resolve, current, counts, historyDigest, factDigest, stateRows, instant, canonical: dk.canonical,
  };
}
export type BusinessContextKit = Awaited<ReturnType<typeof businessContextKit>>;
