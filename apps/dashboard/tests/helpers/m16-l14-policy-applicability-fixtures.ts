import { randomUUID } from 'node:crypto';
import type {
  L14AuthorityPolicyRule, L14GovernanceOutcome, L14PolicyApplicabilityOutcome, L14PolicyApplicabilityProposalContent,
  L14PolicyApplicabilityTarget, L14PolicyVersionSubject, L14Support,
} from '@council/canonical-contracts';
import {
  decidePolicyApplicabilityProposalFingerprint, policyApplicabilityReasonCode, submitPolicyApplicabilityProposalFingerprint,
} from '@council/governance-review';
import { canonicalObjectKit, lit, named } from './m16-governed-write-fixtures';
import { NONE, lastLine, rule, type Actor, type L14Cluster, type SessionOverride } from './m16-l14-fixtures';
import { policyValidationKit } from './m16-l14-policy-validation-fixtures';

/**
 * M16-S1C.3 POLICY_APPLICABILITY fixtures on the S1C3-horizon L14 cluster (full canonical chain + S1B.3..S1C.1R1 + S1C.3). Every
 * organisation's Authority Policy is bootstrapped through the real AP RPCs; every policy / version through the real S1B.3 RPCs
 * and every POLICY_VERSION validation / revocation through the real S1B.4 RPCs; every applicability command goes through the
 * real S1C.3 RPCs as service_role with the caller fingerprint computed by the production TypeScript mirror
 * (@council/governance-review). Owner access only inserts administrator support rows (organisations, users, roles, canonical
 * objects, canonical relationships + their reconciliation decisions, evidence), reads evidence and runs rolled-back probes.
 */
export const APPLICABILITY_TABLES = [
  'l14_policy_applicability_proposals', 'l14_policy_applicability_states', 'l14_policy_applicability_heads',
] as const;
export const L14_S1C3_TABLES = [
  'l14_authority_policies', 'l14_authority_policy_versions', 'l14_authority_policy_rules', 'l14_proposals',
  'l14_authority_policy_version_proposals', 'l14_authorization_decisions', 'l14_authorization_decision_roles',
  'l14_authorization_decision_rules', 'l14_governance_decisions', 'l14_authority_policy_states',
  'l14_authority_policy_heads', 'l14_command_results', 'l14_support_links', 'l14_registry_states', 'l14_fact_states',
  ...APPLICABILITY_TABLES, 'l14_policy_admissions', 'l14_policy_version_admissions', 'l14_policy_version_states',
  'l14_policy_version_proposals', 'l14_policy_version_heads', 'governance_policies', 'policy_versions',
] as const;
export const ALL_KINDS = ['AGENT', 'AGENT_VERSION', 'MODEL', 'TOOL', 'MCP_SERVER', 'API', 'PROMPT', 'KNOWLEDGE_BASE', 'DATA_ASSET',
  'DATA_ELEMENT', 'SKILL'] as const;
export type Kind = (typeof ALL_KINDS)[number];
const uuidOrNull = (value: string | null) => (value === null ? 'null::uuid' : `'${value}'::uuid`);
const tsOrNull = (value: string | null) => (value === null ? 'null::timestamptz' : `${lit(value)}::timestamptz`);
const textOrNull = (value: string | null | undefined) => (value == null ? 'null::text' : lit(value));
const idsSql = (ids: readonly string[]) => (ids.length ? `array[${ids.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
/** A syntactically valid but WRONG caller fingerprint (for inputs the TS mirror itself refuses to frame). */
export const BOGUS_FINGERPRINT = 'a'.repeat(64);

/** Exact canonical objects of every kind (+ a second AGENT / DATA_ASSET) and two exact relationship states. */
export interface Objects { byKind: Record<Kind, string>; agent2: string; asset2: string }
export interface Rel { relationshipId: string; relationshipStateId: string; relationshipType: string }
export interface Rels { exposes: Rel; reads: Rel }
/** An admitted + VALIDATED S1B.4 policy version: the exact tuple and the exact VALIDATED state to pin. */
export interface PolicyPin { subject: L14PolicyVersionSubject; stateId: string }
export interface RuleFlags { readonly validate?: Partial<L14AuthorityPolicyRule>; readonly revoke?: Partial<L14AuthorityPolicyRule> }

export async function policyApplicabilityKit(c: L14Cluster) {
  const { owner, exec, adminRole, memberRole } = c;
  const pvk = await policyValidationKit(c);
  const role = async (code: string) => {
    const id = randomUUID();
    await owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role)
      values('${id}','${code}','${code}','organisation',false)`);
    return id;
  };
  const stewardRole = await role('L14_PA_STEWARD');
  const flexRole = await role('L14_PA_FLEX_STEWARD');
  const contribRole = await role('L14_PA_CONTRIBUTOR');
  const kindRole = await role('L14_PA_AGENT_KIND_STEWARD');
  const objectRole = await role('L14_PA_OBJECT_STEWARD');
  const relTypeRole = await role('L14_PA_REL_TYPE_STEWARD');
  const relStateRole = await role('L14_PA_REL_STATE_STEWARD');
  const respRole = await role('L14_PA_RESPONSIBILITY_STEWARD');
  const selfRelRole = await role('L14_PA_SELF_REL_STEWARD');

  /**
   * POLICY_VERSION administration (S1B.3 / S1B.4 kits) + applicability administration. steward: every decision,
   * ALL_ALLOWED_TARGETS, no flags. flex: every decision with self-validation / future / back dating. contributor: a
   * CONTRIBUTING (never authorizing) VALIDATE rule. kind: VALIDATE on CANONICAL_KIND AGENT. object: VALIDATE on the exact
   * CANONICAL_OBJECT DATA_ASSET. relType: VALIDATE + REVOKE on RELATIONSHIP_TYPE EXPOSES. relState: VALIDATE on the exact
   * RELATIONSHIP_STATE `reads`. selfRel: VALIDATE with self-validation on RELATIONSHIP_STATE `exposes` only. resp: the
   * RESPONSIBILITY permission (another fact family never administers applicability).
   */
  const rules = (o: Objects, r: Rels, flags: RuleFlags = {}, drop: readonly string[] = []): L14AuthorityPolicyRule[] => [
    ...pvk.validationRules(),
    rule(stewardRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', flags.validate),
    rule(stewardRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REJECT'),
    rule(stewardRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'DEFER'),
    rule(stewardRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REVOKE', flags.revoke),
    rule(flexRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { allowSelfValidation: true, allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REVOKE', { allowFutureDating: true, allowBackdating: true }),
    rule(flexRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REJECT'),
    rule(flexRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'DEFER'),
    rule(contribRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { sourceDisposition: 'CONTRIBUTING' }),
    rule(kindRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { scopeTag: 'CANONICAL_KIND', scopeCanonicalKind: 'AGENT' }),
    rule(objectRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE',
      { scopeTag: 'CANONICAL_OBJECT', scopeCanonicalKind: 'DATA_ASSET', scopeCanonicalObjectId: o.byKind.DATA_ASSET }),
    rule(relTypeRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'EXPOSES' }),
    rule(relTypeRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'REVOKE', { scopeTag: 'RELATIONSHIP_TYPE', scopeRelationshipType: 'EXPOSES' }),
    rule(relStateRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_STATE',
      scopeRelationshipId: r.reads.relationshipId, scopeRelationshipStateId: r.reads.relationshipStateId }),
    rule(selfRelRole, 'L14_POLICY_APPLICABILITY_VALIDATE', 'VALIDATE', { scopeTag: 'RELATIONSHIP_STATE', allowSelfValidation: true,
      scopeRelationshipId: r.exposes.relationshipId, scopeRelationshipStateId: r.exposes.relationshipStateId }),
    rule(respRole, 'L14_RESPONSIBILITY_VALIDATE', 'VALIDATE'),
  ].filter(x => !drop.includes(`${x.roleId}:${x.permission}:${x.requestedAction}`));

  let n = 0;
  const HASH = `repeat('a',64)`;
  /** Administrator support rows: one canonical object per kind (+ extras) and two exact canonical relationship states. */
  async function objectsFor(org: string, label: string): Promise<{ objects: Objects; rels: Rels }> {
    const make = (suffix: string, kind: string) => canonicalObjectKit(org, `${label}-${suffix}`, kind,
      { proposedIdentity: { reference: `${label}-${suffix}` }, identity: `${label}-${suffix}` });
    const kits = Object.fromEntries(ALL_KINDS.map(kind => [kind, make(kind.toLowerCase().replace(/_/g, ''), kind)])) as Record<Kind, ReturnType<typeof make>>;
    const extra = { agent2: make('agent2', 'AGENT'), asset2: make('asset2', 'DATA_ASSET') };
    await owner([...Object.values(kits), ...Object.values(extra)].map(k => k.sql).join('\n'));
    const objects: Objects = { byKind: Object.fromEntries(ALL_KINDS.map(k => [k, kits[k].objectId])) as Record<Kind, string>,
      agent2: extra.agent2.objectId, asset2: extra.asset2.objectId };
    const relationship = async (suffix: string, type: string, source: Kind, target: Kind): Promise<Rel> => {
      const relationshipId = `canonical-relationship:${label}-${suffix}`;
      const relationshipStateId = `${relationshipId}:initial`;
      const decision = `decision-rel-${label}-${suffix}`;
      await owner(`insert into gov_repo.reconciliation_decisions(decision_id,organisation_id,family,outcome,candidate_kind,authority_kind,authority_reference,
          reason_code,decided_at,relationship_candidate_id,relationship_type_code,contract_version,envelope,envelope_hash)
        values(${lit(decision)},'${org}','RELATIONSHIP','CREATE_NEW','RELATIONSHIP','HUMAN','fixture-admin','MANUAL_APPROVAL',now(),
          ${lit(`candidate:rel-${label}-${suffix}`)},${lit(type)},'1.1','{}',${HASH});
        insert into gov_repo.canonical_relationships(relationship_id,organisation_id,relationship_state_id,relationship_type,source_canonical_object_id,
          source_kind,target_canonical_object_id,target_kind,valid_from,recorded_at,created_by_decision_id)
        values(${lit(relationshipId)},'${org}',${lit(relationshipStateId)},${lit(type)},${lit(objects.byKind[source])},${lit(source)},
          ${lit(objects.byKind[target])},${lit(target)},now(),now(),${lit(decision)});`);
      return { relationshipId, relationshipStateId, relationshipType: type };
    };
    const rels: Rels = { exposes: await relationship('exposes', 'EXPOSES', 'MCP_SERVER', 'TOOL'),
      reads: await relationship('reads', 'READS_FROM', 'AGENT', 'DATA_ASSET') };
    return { objects, rels };
  }
  async function setup(options: { rules?: (o: Objects, r: Rels) => readonly L14AuthorityPolicyRule[]; bootstrap?: boolean } = {}) {
    const base = await pvk.setup(undefined, { bootstrap: false });
    const label = `pa${++n}-${randomUUID().slice(0, 8)}`;
    const { objects, rels } = await objectsFor(base.org, label);
    const mk = (roles: readonly string[]) => c.mkUser(base.org, roles);
    const [member2, ps, ps2, pflex, pcontrib, pkind, pobject, preltype, prelstate, pselfrel, presp] = [
      await mk([memberRole]), await mk([stewardRole]), await mk([stewardRole]), await mk([flexRole]), await mk([contribRole]),
      await mk([kindRole]), await mk([objectRole]), await mk([relTypeRole]), await mk([relStateRole]), await mk([selfRelRole]), await mk([respRole])];
    const policyRules = options.rules ? options.rules(objects, rels) : rules(objects, rels);
    const first = options.bootstrap === false ? null : await c.bootstrapPolicy(base.boot, label, policyRules);
    return { ...base, label, objects, rels, member2, ps, ps2, pflex, pcontrib, pkind, pobject, preltype, prelstate, pselfrel, presp,
      v1: first?.admitted as Record<string, any>, cmd: (name: string) => `${label}-${name}` };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  void adminRole;

  // ---- POLICY_VERSION lifecycle through the real S1B.3 / S1B.4 RPCs ----
  /** A fresh admitted policy + first version, VALIDATED (validator, or flex for dating). */
  let pc = 0;
  /** A fresh M16-admitted policy + first version through the real S1B.3 RPCs (short unique policy code per organisation). */
  async function admittedSubject(ctx: Ctx, name: string): Promise<L14PolicyVersionSubject> {
    const pol = await pvk.pk.admitPolicy(ctx as never, ctx.author, `${name}-admit-policy`, pvk.pk.descriptor(`${ctx.label}-p${++pc}`));
    const version = await pvk.pk.admitVersion(ctx as never, ctx.author, `${name}-admit-version`, pol.policy_id, `# ${name} ${randomUUID()}`);
    return { policyId: version.policy_id, versionId: version.version_id, contentHash: version.content_hash };
  }
  async function policy(ctx: Ctx, name: string, requestedEffectiveFrom: string | null = null): Promise<PolicyPin> {
    const subject = await admittedSubject(ctx, `${name}-pol`);
    const v = await pvk.validate(ctx as never, `${name}-pv`, subject, requestedEffectiveFrom, requestedEffectiveFrom === null ? ctx.validator : ctx.flex);
    return { subject, stateId: v.decided.registry_state_id as string };
  }
  /** The next admitted version of the SAME policy, VALIDATED. */
  async function nextVersion(ctx: Ctx, name: string, prior: PolicyPin, validate = true): Promise<PolicyPin> {
    const version = await pvk.pk.admitVersion(ctx as never, ctx.author, `${name}-admit-next`, prior.subject.policyId,
      `# ${name} ${randomUUID()}`, prior.subject.versionId);
    const subject = { policyId: version.policy_id, versionId: version.version_id, contentHash: version.content_hash } as L14PolicyVersionSubject;
    if (!validate) return { subject, stateId: '' };
    const v = await pvk.validate(ctx as never, `${name}-pv-next`, subject);
    return { subject, stateId: v.decided.registry_state_id as string };
  }
  /** Admitted but never validated. */
  async function admittedOnly(ctx: Ctx, name: string) { return admittedSubject(ctx, `${name}-pol-admit`); }
  async function revokePolicyVersion(ctx: Ctx, name: string, pin: PolicyPin, requestedEffectiveFrom: string | null = null) {
    const r = await pvk.revoke(ctx as never, `${name}-pv-rv`, pin.subject, pin.stateId, requestedEffectiveFrom,
      requestedEffectiveFrom === null ? ctx.validator : ctx.flex);
    return r.decided;
  }
  /** Re-validation of a revoked version (a NEW POLICY_VERSION state; never the old one). */
  async function revalidatePolicyVersion(ctx: Ctx, name: string, pin: PolicyPin): Promise<PolicyPin> {
    const v = await pvk.validate(ctx as never, `${name}-pv-reval`, pin.subject);
    return { subject: pin.subject, stateId: v.decided.registry_state_id as string };
  }

  // ---- Targets ----
  const objectTarget = (kind: Kind, id: string): L14PolicyApplicabilityTarget =>
    ({ targetType: 'CANONICAL_OBJECT', targetCanonicalKind: kind, targetCanonicalObjectId: id });
  const relTarget = (r: { relationshipId: string; relationshipStateId: string }): L14PolicyApplicabilityTarget =>
    ({ targetType: 'RELATIONSHIP_STATE', relationshipId: r.relationshipId, relationshipStateId: r.relationshipStateId });
  /** The five exact target SQL operands (inactive branch NULL) — also used to call the owner-only resolver / read. */
  const targetOperands = (t: L14PolicyApplicabilityTarget) => t.targetType === 'CANONICAL_OBJECT'
    ? [lit(t.targetType), lit(t.targetCanonicalKind), lit(t.targetCanonicalObjectId), 'null::text', 'null::text']
    : [lit(t.targetType), 'null::text', 'null::text', lit(t.relationshipId), lit(t.relationshipStateId)];

  // ---- POLICY_APPLICABILITY commands ----
  const validateProposal = (target: L14PolicyApplicabilityTarget, pin: PolicyPin, applicability: L14PolicyApplicabilityOutcome = 'APPLIES',
    requestedEffectiveFrom: string | null = null, requestedEffectiveTo: string | null = null): L14PolicyApplicabilityProposalContent => ({
    intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN', target, applicability, requestedEffectiveFrom, requestedEffectiveTo, targetStateId: null,
    dependency: { ...pin.subject, policyVersionValidatedStateId: pin.stateId } });
  const revokeProposal = (target: L14PolicyApplicabilityTarget, pin: PolicyPin, targetStateId: string,
    applicability: L14PolicyApplicabilityOutcome = 'APPLIES', requestedEffectiveFrom: string | null = null): L14PolicyApplicabilityProposalContent => ({
    intent: 'REVOKE', sourceClass: 'LOCAL_HUMAN', target, applicability, requestedEffectiveFrom, requestedEffectiveTo: null, targetStateId,
    dependency: { ...pin.subject, policyVersionValidatedStateId: pin.stateId } });

  interface SubmitInput {
    commandId: string; proposal: L14PolicyApplicabilityProposalContent; prior?: string | null; support?: L14Support;
    fingerprint?: string; session?: SessionOverride;
    /** Raw operand overrides (hybrid / partial / malformed shapes the TS mirror itself refuses to frame). */
    raw?: Partial<Record<'targetType' | 'kind' | 'objectId' | 'relationshipId' | 'relationshipStateId' | 'contentHash' | 'applicability', string | null>>;
  }
  function submitSql(actor: Actor, input: SubmitInput) {
    const support = input.support ?? NONE, prior = input.prior ?? null, p = input.proposal, raw = input.raw ?? {};
    const fingerprint = input.fingerprint ?? submitPolicyApplicabilityProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, priorProposalId: prior, support });
    const t = p.target as Record<string, any>;
    const pick = (key: keyof NonNullable<SubmitInput['raw']>, value: string | null | undefined) => (key in raw ? raw[key] : value);
    return `select to_json(r) from gov_repo.l14_submit_policy_applicability_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_intent: lit(p.intent),
      p_source_class: lit(p.sourceClass), p_target_type: textOrNull(pick('targetType', t.targetType)),
      p_target_canonical_kind: textOrNull(pick('kind', t.targetCanonicalKind)),
      p_target_canonical_object_id: textOrNull(pick('objectId', t.targetCanonicalObjectId)),
      p_target_relationship_id: textOrNull(pick('relationshipId', t.relationshipId)),
      p_target_relationship_state_id: textOrNull(pick('relationshipStateId', t.relationshipStateId)),
      p_policy_id: uuidOrNull(p.dependency.policyId), p_version_id: uuidOrNull(p.dependency.versionId),
      p_content_hash: textOrNull(pick('contentHash', p.dependency.contentHash)),
      p_policy_version_validated_state_id: uuidOrNull(p.dependency.policyVersionValidatedStateId),
      p_applicability: textOrNull(pick('applicability', p.applicability)),
      p_requested_effective_from: tsOrNull(p.requestedEffectiveFrom), p_requested_effective_to: tsOrNull(p.requestedEffectiveTo),
      p_target_state_id: uuidOrNull(p.targetStateId), p_prior_proposal_id: uuidOrNull(prior),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  interface DecideInput {
    commandId: string; proposalId: string; proposal: L14PolicyApplicabilityProposalContent; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L14Support; fingerprint?: string; session?: SessionOverride; reasonCode?: string;
  }
  function decideSql(actor: Actor, input: DecideInput) {
    const support = input.support ?? NONE, outcome = input.outcome ?? 'VALIDATE', expected = input.expected ?? null;
    const fingerprint = input.fingerprint ?? decidePolicyApplicabilityProposalFingerprint({
      organisationId: input.session?.org ?? actor.org, actorUserId: actor.id, outcome, proposalId: input.proposalId,
      proposal: input.proposal, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l14_decide_policy_applicability_proposal_v1(${named({
      ...c.principal(actor, input.session), p_command_id: lit(input.commandId), p_proposal_id: uuidOrNull(input.proposalId),
      p_outcome: lit(outcome), p_reason_code: lit(input.reasonCode ?? policyApplicabilityReasonCode(outcome)),
      p_expected_current_state_id: uuidOrNull(expected),
      p_support_status: lit(support.status), p_support_evidence_ids: idsSql(support.evidenceIds),
      p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const decideSqlFor = (actor: Actor, commandId: string, proposalId: string, proposal: L14PolicyApplicabilityProposalContent,
    outcome: L14GovernanceOutcome, expected: string | null) => decideSql(actor, { commandId, proposalId, proposal, outcome, expected });

  const keySql = (t: L14PolicyApplicabilityTarget) => `gov_repo.l14_policy_applicability_target_key_v1(${targetOperands(t).join(',')})`;
  const head = async (org: string, target: L14PolicyApplicabilityTarget, policyId: string) => {
    const h = JSON.parse(lastLine(await owner(
      `select coalesce((select to_json(h) from gov_repo.l14_policy_applicability_heads h where organisation_id='${org}'
         and target_key=${keySql(target)} and policy_id='${policyId}'), 'null'::json)`,
    ))) as { latest_state_id: string | null } | null;
    return h?.latest_state_id ?? null;
  };
  async function submit(ctx: Ctx, actor: Actor, name: string, proposal: L14PolicyApplicabilityProposalContent, prior: string | null = null,
    support?: L14Support) {
    return exec(submitSql(actor, { commandId: ctx.cmd(name), proposal, prior, support }));
  }
  /** DECIDE with the key's CURRENT head as the exact expectation (NULL = expected-none). */
  async function decide(ctx: Ctx, actor: Actor, name: string, submitted: Record<string, any>, proposal: L14PolicyApplicabilityProposalContent,
    outcome: L14GovernanceOutcome = 'VALIDATE', support?: L14Support) {
    const expected = await head(ctx.org, proposal.target, proposal.dependency.policyId);
    return exec(decideSql(actor, { commandId: ctx.cmd(name), proposalId: submitted.proposal_id, proposal, outcome, expected, support }));
  }
  /** SUBMIT VALIDATE (member) → DECIDE VALIDATE (steward, or flex for dating). On a VALIDATED key this is a supersession. */
  async function apply(ctx: Ctx, name: string, target: L14PolicyApplicabilityTarget, pin: PolicyPin, options: {
    applicability?: L14PolicyApplicabilityOutcome; from?: string | null; to?: string | null; validator?: Actor } = {}) {
    const proposal = validateProposal(target, pin, options.applicability ?? 'APPLIES', options.from ?? null, options.to ?? null);
    const submitted = await submit(ctx, ctx.member, `${name}-submit`, proposal);
    const validator = options.validator ?? (options.from != null || options.to != null ? ctx.pflex : ctx.ps);
    const decided = await decide(ctx, validator, `${name}-validate`, submitted, proposal);
    return { proposal, submitted, decided, stateId: decided.fact_state_id as string };
  }
  /** SUBMIT REVOKE (member) → DECIDE REVOKE (steward, or flex for dating) of the key's current VALIDATED state. */
  async function revoke(ctx: Ctx, name: string, target: L14PolicyApplicabilityTarget, pin: PolicyPin, targetStateId: string,
    applicability: L14PolicyApplicabilityOutcome = 'APPLIES', from: string | null = null, actor?: Actor) {
    const proposal = revokeProposal(target, pin, targetStateId, applicability, from);
    const submitted = await submit(ctx, ctx.member, `${name}-rv-submit`, proposal);
    const decided = await decide(ctx, actor ?? (from === null ? ctx.ps : ctx.pflex), `${name}-revoke`, submitted, proposal, 'REVOKE');
    return { proposal, submitted, decided };
  }
  /** Exact VALIDATED applicability of the key (target + policy) at business instant `at` as known at cutoff `cutoff` (SQL). */
  const resolveRow = async (org: string, target: L14PolicyApplicabilityTarget, policyId: string, at: string, cutoff: string) => {
    const rows = JSON.parse(lastLine(await owner(`select coalesce(json_agg(r), '[]') from
      gov_repo.l14_policy_applicability_valid_state_v1('${org}', ${targetOperands(target).join(', ')}, '${policyId}'::uuid, ${at}, ${cutoff}) r`))) as Array<Record<string, any>>;
    if (rows.length > 1) throw new Error('resolver returned more than one state');
    return rows[0] ?? null;
  };
  const resolve = async (org: string, target: L14PolicyApplicabilityTarget, policyId: string, at: string, cutoff: string) =>
    ((await resolveRow(org, target, policyId, at, cutoff))?.fact_state_id as string | undefined) ?? null;
  /** The read answer of a key: APPLIES | DOES_NOT_APPLY | UNKNOWN (no row). */
  const outcome = async (org: string, target: L14PolicyApplicabilityTarget, policyId: string, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    ((await resolveRow(org, target, policyId, at, cutoff))?.applicability as string | undefined) ?? 'UNKNOWN';
  /** Current applicability of one exact target (policy_id|version_id|applicability|fact_state_id, sorted by policy). */
  const current = async (org: string, target: L14PolicyApplicabilityTarget, at = 'clock_timestamp()', cutoff = 'clock_timestamp()') =>
    JSON.parse(lastLine(await owner(`select coalesce(json_agg(r.policy_id||'|'||r.version_id||'|'||r.applicability||'|'||r.fact_state_id
      order by r.policy_id), '[]') from gov_repo.l14_policy_applicabilities_current_v1('${org}', ${targetOperands(target).join(', ')}, ${at}, ${cutoff}) r`))) as string[];
  const counts = async (org: string) => JSON.parse(lastLine(await owner(`select json_build_object(${L14_S1C3_TABLES.map(t =>
    `'${t}',(select count(*) from gov_repo.${t} where organisation_id='${org}')`).join(',')})`))) as Record<string, number>;
  /** md5 of every immutable governance history row of an organisation (full-row text, deterministic order). */
  const historyDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${['l14_fact_states', 'l14_policy_applicability_proposals', 'l14_policy_applicability_states', 'l14_proposals',
      'l14_authorization_decisions', 'l14_authorization_decision_roles', 'l14_authorization_decision_rules', 'l14_governance_decisions',
      'l14_command_results', 'l14_support_links']
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}) s`));
  /** md5 of every POLICY_APPLICABILITY-subject row of an organisation (typed tables, heads, envelope rows of that subject). */
  const factDigest = async (org: string) => lastLine(await owner(`select md5(string_agg(x, '|' order by x)) from (
    ${[...APPLICABILITY_TABLES]
      .map(t => `select '${t}:'||t::text as x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all ${['l14_fact_states', 'l14_proposals', 'l14_authorization_decisions', 'l14_governance_decisions', 'l14_command_results']
      .map(t => `select '${t}:'||t::text from gov_repo.${t} t where organisation_id='${org}' and subject_kind='POLICY_APPLICABILITY'`).join(' union all ')}
    union all select 'fact-support:'||t::text from gov_repo.l14_support_links t where organisation_id='${org}' and owner_kind='FACT_STATE') s`));
  /** Full-row text of one fact state (envelope + typed detail) plus its system columns (xmin / ctid): an UPDATE changes them. */
  const stateRows = async (org: string, factStateId: string) => lastLine(await owner(`select
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_fact_states t where organisation_id='${org}' and fact_state_id='${factStateId}')||'#'||
    (select t::text||'@'||t.xmin::text||t.ctid::text from gov_repo.l14_policy_applicability_states t where organisation_id='${org}' and fact_state_id='${factStateId}')`));
  return {
    pvk, stewardRole, flexRole, contribRole, kindRole, objectRole, relTypeRole, relStateRole, respRole, selfRelRole, rules, setup,
    policy, nextVersion, admittedOnly, revokePolicyVersion, revalidatePolicyVersion, objectTarget, relTarget, targetOperands, keySql,
    validateProposal, revokeProposal, submitSql, decideSql, decideSqlFor, head, submit, decide, apply, revoke, resolveRow, resolve, outcome,
    current, counts, historyDigest, factDigest, stateRows, instant: pvk.instant, canonical: pvk.canonical,
  };
}
export type PolicyApplicabilityKit = Awaited<ReturnType<typeof policyApplicabilityKit>>;
