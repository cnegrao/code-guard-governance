import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L14ResponsibilityAssignmentProposalContent, L14ResponsibilityRole,
  L14ResponsibilityTargetKind, L14Support,
} from '@council/canonical-contracts';
import {
  decideResponsibilityAssignmentProposalFingerprint, responsibilityReasonCode, submitResponsibilityAssignmentProposalFingerprint,
} from '@council/governance-review';
import { canonicalObjectKit, lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { partyKit } from './m16-l14-party-fixtures';

/**
 * M16-S1C.1 RESPONSIBILITY_ASSIGNMENT fixtures on the S1C1-horizon L14 cluster (full canonical chain + S1B.3..S1B.6 +
 * S1C.1). Every organisation's Authority Policy is bootstrapped through the real AP RPCs; every GovernanceParty goes
 * through the real S1B.1 Party RPCs; every responsibility command goes through the real S1C.1 RPCs as service_role with the
 * caller fingerprint computed by the production TypeScript mirror (@council/governance-review). Owner access only inserts
 * administrator support rows (organisations, users, roles, canonical objects, evidence, directory profiles), reads evidence
 * and runs rolled-back structural probes.
 */
export const RESPONSIBILITY_TABLES = [
  'l14_fact_states', 'l14_responsibility_assignment_proposals', 'l14_responsibility_assignment_states',
  'l14_responsibility_assignment_heads',
] as const;
export const L14_S1C1_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', ...RESPONSIBILITY_TABLES,
  'l14_governance_parties', 'l14_governance_party_states', 'l14_governance_party_proposals', 'l14_governance_party_heads',
] as const;
const KINDS = ['AGENT', 'MODEL', 'TOOL', 'API', 'PROMPT', 'SKILL', 'DATA_ASSET', 'DATA_ELEMENT', 'MCP_SERVER', 'KNOWLEDGE_BASE', 'AGENT_VERSION'] as const;
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const tsOrNull = (value: string | null) => (value === null ? 'null::timestamptz' : `${lit(value)}::timestamptz`);
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
/** A syntactically valid but WRONG caller fingerprint (for inputs the TS mirror itself refuses to frame). */
export const BOGUS_FINGERPRINT = 'a'.repeat(64);

export interface ResponsibilityRuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }
/** The canonical objects created for every organisation (exact ids). */
export interface Objects { agent: string; agent2: string; asset: string; asset2: string; element: string; element2: string; agentVersion: string; model: string }
export interface Key { targetKind: L14ResponsibilityTargetKind; targetCanonicalObjectId: string; responsibilityRole: L14ResponsibilityRole; governancePartyId: string }
export interface PartyPin { partyId: string; stateId: string; partyKind?: 'PERSON' | 'GROUP' | 'ORGANISATIONAL_UNIT' }

export async function responsibilityKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const pk = await partyKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const stewardRole = await role('L14_RESP_STEWARD');
  const flexRole = await role('L14_RESP_FLEX_STEWARD');
  const contribRole = await role('L14_RESP_CONTRIBUTOR');
  const kindRole = await role('L14_RESP_AGENT_KIND_STEWARD');
  const objectRole = await role('L14_RESP_OBJECT_STEWARD');
  const relRole = await role('L14_RESP_REL_TYPE_STEWARD');

  /**
   * AP administration (opsRole) + Party administration (registrar ADMIT; steward every decision; flex dating) +
   * responsibility administration. steward: every decision, ALL_ALLOWED_TARGETS, no flags. flex: every decision with
   * self-validation / future / back dating. contributor: a CONTRIBUTING (never authorizing) VALIDATE rule. kind: VALIDATE on
   * CANONICAL_KIND AGENT only. object: VALIDATE on the exact CANONICAL_OBJECT `asset` only. rel: VALIDATE on a
   * RELATIONSHIP_TYPE scope (never matches an object target). variant only varies content.
   */
  const rules = (o: Objects, variant = 0, flags: ResponsibilityRuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    rule(adminRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(pk.ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIT', 'ADMIT'),
    rule(pk.ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'VALIDATE'),
    rule(pk.ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REJECT'),
    rule(pk.ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'DEFER'),
    rule(pk.ap.opsRole, 'L14_AUTHORITY_POLICY_ADMIN', 'REVOKE'),
    rule(pk.registrarRole, 'L14_PARTY_ADMIT', 'ADMIT'),
    rule(pk.stewardRole, 'L14_PARTY_VALIDATE', 'VALIDATE'),
    rule(pk.stewardRole, 'L14_PARTY_VALIDATE', 'REJECT'),
    rule(pk.stewardRole, 'L14_PARTY_VALIDATE', 'DEFER'),
    rule(pk.stewardRole, 'L14_PARTY_VALIDATE', 'REVOKE'),
    rule(pk.flexRole, 'L14_PARTY_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(pk.flexRole, 'L14_PARTY_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(stewardRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', flags.validate),
    rule(stewardRole, 'L14_RESPONSIBILITY_VALIDATE', 'REJECT'),
    rule(stewardRole, 'L14_RESPONSIBILITY_VALIDATE', 'DEFER'),
    rule(stewardRole, 'L14_RESPONSIBILITY_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_RESPONSIBILITY_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_RESPONSIBILITY_VALIDATE', 'REJECT'),
    rule(flexRole, 'L14_RESPONSIBILITY_VALIDATE', 'DEFER'),
    rule(contribRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(kindRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }),
    rule(objectRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'DATA_ASSET', scopeCanonicalObjectId: o.asset }),
    rule(relRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'USES_MODEL' }),
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
    const label = `ra${++n}-${randomUUID().slice(0, 8)}`;
    const objects = await objectsFor(org, label);
    const boot = await c.mkUser(org, [adminRole, pk.ap.opsRole]);
    const ops = await c.mkUser(org, [pk.ap.opsRole]);
    const registrar = await c.mkUser(org, [pk.registrarRole]);
    const steward = await c.mkUser(org, [pk.stewardRole]);
    const pflex = await c.mkUser(org, [pk.flexRole]);
    const member = await c.mkUser(org, [memberRole]);
    const member2 = await c.mkUser(org, [memberRole]);
    const rs = await c.mkUser(org, [stewardRole]);
    const rs2 = await c.mkUser(org, [stewardRole]);
    const rflex = await c.mkUser(org, [flexRole]);
    const rcontrib = await c.mkUser(org, [contribRole]);
    const rkind = await c.mkUser(org, [kindRole]);
    const robject = await c.mkUser(org, [objectRole]);
    const rrel = await c.mkUser(org, [relRole]);
    const policyRules = options.rules ? options.rules(objects) : rules(objects);
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(boot, label, policyRules);
    return { org, label, objects, boot, ops, registrar, steward, pflex, member, member2, rs, rs2, rflex, rcontrib, rkind, robject, rrel,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // ---- GovernanceParty lifecycle through the real S1B.1 RPCs ----
  /** ADMIT (registrar) → SUBMIT VALIDATE (member) → DECIDE VALIDATE (party steward or flex for dating). */
  async function party(ctx: Ctx, name: string, partyKind: 'PERSON' | 'GROUP' | 'ORGANISATIONAL_UNIT' = 'PERSON',
    requestedEffectiveFrom: string | null = null): Promise<PartyPin> {
    const v = await pk.validated(ctx as never, `${name}-party`, partyKind, requestedEffectiveFrom,
      requestedEffectiveFrom === null ? ctx.steward : ctx.pflex);
    return { partyId: v.partyId, stateId: v.decided.registry_state_id, partyKind };
  }
  /** Admitted but never validated. */
  async function admittedParty(ctx: Ctx, name: string) {
    const r = await pk.admit(ctx as never, ctx.registrar, `${name}-party-admit`);
    return r.governance_party_id as string;
  }
  async function revokeParty(ctx: Ctx, name: string, pin: PartyPin, requestedEffectiveFrom: string | null = null) {
    const r = await pk.revoke(ctx as never, `${name}-party-rv`, pin.partyId, pin.stateId, pin.partyKind ?? 'PERSON', requestedEffectiveFrom,
      requestedEffectiveFrom === null ? ctx.steward : ctx.pflex);
    return r.decided;
  }
  /** Re-validation of a revoked Party (a NEW Party state; never the old one). */
  async function revalidateParty(ctx: Ctx, name: string, pin: PartyPin): Promise<PartyPin> {
    const proposal = pk.validateProposal(pin.partyId, pin.partyKind ?? 'PERSON');
    const submitted = await pk.submit(ctx as never, ctx.member, `${name}-party-reval-submit`, proposal);
    const decided = await pk.decide(ctx as never, ctx.steward, `${name}-party-reval`, submitted, proposal);
    return { partyId: pin.partyId, stateId: decided.registry_state_id, partyKind: pin.partyKind };
  }

  // ---- RESPONSIBILITY_ASSIGNMENT commands ----
  interface SubmitInput {
    commandId: string; proposal: L14ResponsibilityAssignmentProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride; raw?: Partial<Record<string, string>>;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal;
    const fingerprint = input.fingerprint ?? submitResponsibilityAssignmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    return `select to_json(r) from gov_repo.l14_submit_responsibility_assignment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_target_kind: lit(p.targetKind), p_target_canonical_object_id: lit(p.targetCanonicalObjectId),
      p_responsibility_role: lit(p.responsibilityRole), p_governance_party_id: uuidOrNull(p.governancePartyId),
      p_party_validated_state_id: uuidOrNull(p.partyValidatedStateId),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_requested_effective_to: tsOrNull(p.requestedEffectiveTo),
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint), ...input.raw })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14ResponsibilityAssignmentProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decideResponsibilityAssignmentProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_responsibility_assignment_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? responsibilityReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14ResponsibilityAssignmentProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const keyOf = (targetKind: L14ResponsibilityTargetKind, targetCanonicalObjectId: string, responsibilityRole: L14ResponsibilityRole,
    governancePartyId: string): Key => ({ targetKind, targetCanonicalObjectId, responsibilityRole, governancePartyId });
  const validateProposal = (key: Key, partyValidatedStateId: string, requestedEffectiveFrom: string | null = null,
    requestedEffectiveTo: string | null = null): L14ResponsibilityAssignmentProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', ...key, partyValidatedStateId, requestedEffectiveFrom, requestedEffectiveTo,
    targetStateId: null });
  const revokeProposal = (key: Key, partyValidatedStateId: string, targetStateId: string,
    requestedEffectiveFrom: string | null = null): L14ResponsibilityAssignmentProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', ...key, partyValidatedStateId, requestedEffectiveFrom, requestedEffectiveTo: null,
    targetStateId });

  const head = async (org: string, key: Key) => {
    const h = JSON.parse(lastLine(await owner(
      `select coalesce((select to_json(h) from gov_repo.l14_responsibility_assignment_heads h where organisation_id='${org}'
         and target_kind=${lit(key.targetKind)} and target_canonical_object_id=${lit(key.targetCanonicalObjectId)}
         and responsibility_role=${lit(key.responsibilityRole)} and governance_party_id='${key.governancePartyId}'), 'null'::json)`,
    ))) as { latest_state_id: string | null } | null;
    return h?.latest_state_id ?? null;
  };
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14ResponsibilityAssignmentProposalContent, prior: string | null = null,
    support?: L14Support) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior, support }));
  }
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14ResponsibilityAssignmentProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE', support?: L14Support) {
    const expected = await head(ctx.org, proposal);
    return exec(decideSql(actor, { commandId: ctx.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, expected, support }));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (responsibility steward, or flex for dating). */
  async function assign(ctx: Ctx, name: string, key: Key, pin: PartyPin | string, options: { from?: string | null; to?: string | null;
    validator?: Actor } = {}) {
    const stateId = typeof pin === 'string' ? pin : pin.stateId;
    const proposal = validateProposal(key, stateId, options.from ?? null, options.to ?? null);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const validator = options.validator ?? (options.from != null || options.to != null ? ctx.rflex : ctx.rs);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided, stateId: decided.fact_state_id as string };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (steward, or flex for dating) of the key's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, key: Key, partyStateId: string, targetStateId: string, from: string | null = null,
    actor?: Actor) {
    const proposal = revokeProposal(key, partyStateId, targetStateId, from);
    const submitted = await submit(ctx, ctx.member, `${name}-rv-submit`, proposal);
    const decided = await decide(ctx, actor ?? (from === null ? ctx.rs : ctx.rflex), `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED assignment of the key at business instant `at` as known at recorded cutoff `cutoff` (SQL expressions). */
  const resolve = async (org: string, key: Key, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_responsibility_assignment_valid_state_v1('${org}', ${lit(key.targetKind)}, ${lit(key.targetCanonicalObjectId)},
        ${lit(key.responsibilityRole)}, '${key.governancePartyId}', ${at}, ${cutoff}) r`))) as Array<{ fact_state_id: string }>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0]?.fact_state_id ?? null;
  };
  /** Current legal responsibilities of one exact target (role:party:state, sorted). */
  const current = async (org: string, targetKind: string, targetId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    JSON.parse(lastLine(await owner(`select coalesce(json_agg(r.responsibility_role||':'||r.governance_party_id||':'||r.fact_state_id
      order by r.responsibility_role, r.governance_party_id::text), '[]') from gov_repo.l14_responsibility_assignments_current_v1('${org}',
      ${lit(targetKind)}, ${lit(targetId)}, ${at}, ${cutoff}) r`))) as string[];
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1C1_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable responsibility governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_fact_states', 'l14_responsibility_assignment_proposals', 'l14_responsibility_assignment_states', 'l14_proposals',
      'l14_authorization_decisions', 'l14_authorization_decision_roles', 'l14_authorization_decision_rules', 'l14_governance_decisions',
      'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** md5 of every RESPONSIBILITY_ASSIGNMENT-subject row of an organisation (typed tables, heads, envelope rows of that subject). */
  const factDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_fact_states', 'l14_responsibility_assignment_proposals', 'l14_responsibility_assignment_states', 'l14_responsibility_assignment_heads']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all ${['l14_proposals', 'l14_authorization_decisions', 'l14_governance_decisions', 'l14_command_results']
      .map(t => `select '${t}:'||t::text from gov_repo.${t} t where organisation_id='${org}' and subject_kind='RESPONSIBILITY_ASSIGNMENT'`).join(' union all ')}
    union all select 'fact-support:'||t::text from gov_repo.l14_support_links t where organisation_id='${org}' and owner_kind='FACT_STATE') s`));
  /** Full-row text of one fact state (envelope + typed detail) for byte-identity checks. */
  const stateRows = async (org: string, factStateId: string) => lastLine(await owner(`select
    (select t::text from gov_repo.l14_fact_states t where organisation_id='${org}' and fact_state_id='${factStateId}')||'#'||
    (select t::text from gov_repo.l14_responsibility_assignment_states t where organisation_id='${org}' and fact_state_id='${factStateId}')`));
  const instant = (offset: string) => pk.ap.instant(offset);
  return {
    pk, stewardRole, flexRole, contribRole, kindRole, objectRole, relRole, rules, setup, party, admittedParty, revokeParty, revalidateParty,
    submitSql, decideSql, decideSqlFor, keyOf, validateProposal, revokeProposal, head, submit, decide, assign, revoke, resolve, current,
    counts, historyDigest, factDigest, stateRows, instant, canonical: pk.ap.canonical,
  };
}
export type ResponsibilityKit = Awaited<ReturnType<typeof responsibilityKit>>;
