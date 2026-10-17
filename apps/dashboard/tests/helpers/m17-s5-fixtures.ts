import { randomUUID } from 'node:crypto';
import type { L15RiskTreatmentProposalContent as Proposal, L15RiskTreatmentSupport as Support, L14GovernanceOutcome } from '@council/canonical-contracts';
import { submitRiskTreatmentProposalFingerprint, decideRiskTreatmentProposalFingerprint, riskTreatmentReasonCode } from '@council/governance-review';
import { m17s3Kit, objectSubject } from './m17-s3-fixtures';
import { partyKit } from './m16-l14-party-fixtures';
import { controlDefinitionKit } from './m16-l14-control-definition-fixtures';
import { type L14Cluster, type Actor, type SessionOverride, rule } from './m16-l14-fixtures';
import { lit, named } from './m16-governed-write-fixtures';
export const NONE: Support = { status: 'NONE', entries: [] };
export const RT_TABLES = ['l15_risk_treatment_proposals', 'l15_risk_treatment_states', 'l15_risk_treatment_heads',
  'l15_risk_treatment_proposal_control_pins', 'l15_risk_treatment_state_control_pins'];
export const val = (x: string | null, type = 'text') => x === null ? `null::${type}` : `${lit(x)}::${type}`;
export const arr = (x: readonly string[], type = 'text') => `ARRAY[${x.map(lit).join(',')}]::${type}[]`;
export async function m17s5Kit(c: L14Cluster, controlKit?: Awaited<ReturnType<typeof controlDefinitionKit>>) {
  const k3 = await m17s3Kit(c), pk = await partyKit(c), ck = controlKit ?? await controlDefinitionKit(c);
  const flexRole = randomUUID();
  await c.owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role) values('${flexRole}','S5_FLEX','S5 flex','organisation',false)`);
  const actions = ['VALIDATE', 'REJECT', 'DEFER', 'REVOKE'] as const;
  async function setup() {
    const x = await k3.setup({ extra: () => [
      ...pk.partyRules().filter(r => r.permission.startsWith('L14_PARTY_')),
      ...ck.controlRules().filter(r => r.permission.startsWith('L14_CONTROL_DEFINITION_')),
      ...actions.map(a => rule(flexRole, 'L15_RISK_TREATMENT_VALIDATE', a, { allowBackdating: true, allowFutureDating: true, allowSelfValidation: true })),
    ] });
    const party = { ...x, registrar: await c.mkUser(x.org, [pk.registrarRole]), steward: await c.mkUser(x.org, [pk.stewardRole]), flex: await c.mkUser(x.org, [pk.flexRole]) };
    const control = { ...x, registrar: await c.mkUser(x.org, [ck.registrarRole]), steward: await c.mkUser(x.org, [ck.stewardRole]), flex: await c.mkUser(x.org, [ck.flexRole]) };
    const responsible = await pk.validated(party as never, 'responsible');
    const flex = await c.mkUser(x.org, [flexRole]);
    return { ...x, party, control, responsible, flex };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  async function risk(x: Ctx, name: string) {
    const scen = await k3.scenario(x, `${name}-scenario`, 'OPERATIONAL', ['AGENT_VERSION']);
    const subject = objectSubject('AGENT_VERSION', x.objects.AGENT_VERSION!);
    const r = await k3.validateRisk(x, name, subject, scen);
    return { ...r, scen, subject };
  }
  async function control(x: Ctx, name: string) {
    const admitted = await ck.admitFirst(x.control as never, name);
    const validated = await ck.validate(x.control as never, name, admitted.version);
    return { ...admitted, ...validated, stateId: validated.decided.registry_state_id as string, versionId: admitted.version.controlDefinitionVersionId };
  }
  const proposal = (x: Ctx, riskId: string, over: Partial<Proposal> = {}): Proposal => ({ intent: 'VALIDATE', sourceClass: 'LOCAL_HUMAN',
    governedRiskStateId: riskId, treatmentOption: 'MITIGATE', treatmentOrdinalKey: 'main', responsibleGovernancePartyId: x.responsible.partyId,
    partyValidatedStateId: x.responsible.decided.registry_state_id, implementationStatus: 'PLANNED', targetImplementationDate: null,
    treatmentRevocationReason: null, controlDefinitionVersionIds: [], requestedEffectiveFrom: null, requestedEffectiveTo: null,
    expectedCurrentStateId: null, targetStateId: null, ...over });
  interface Submit { commandId: string; proposal: Proposal; support?: Support; prior?: string | null; fingerprint?: string; session?: SessionOverride; raw?: Record<string, string> }
  const supportSql = (s: Support) => ({ p_support_status: lit(s.status), p_support_tags: arr(s.entries.map(e => e.tag)), p_support_target_ids: arr(s.entries.map(e => e.targetId)) });
  function submitSql(actor: Actor, o: Submit) {
    const p = o.proposal, support = o.support ?? NONE, prior = o.prior ?? null;
    const fingerprint = o.fingerprint ?? submitRiskTreatmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org, actorUserId: actor.id, proposal: p, support, priorProposalId: prior });
    return `select to_json(r) from gov_repo.l15_submit_risk_treatment_proposal_v1(${named({ ...c.principal(actor, o.session),
      p_command_id: lit(o.commandId), p_intent: lit(p.intent), p_source_class: lit(p.sourceClass), p_governed_risk_state_id: val(p.governedRiskStateId, 'uuid'),
      p_treatment_option: lit(p.treatmentOption), p_treatment_ordinal_key: lit(p.treatmentOrdinalKey),
      p_responsible_governance_party_id: val(p.responsibleGovernancePartyId, 'uuid'), p_party_validated_state_id: val(p.partyValidatedStateId, 'uuid'),
      p_implementation_status: val(p.implementationStatus), p_target_implementation_date: val(p.targetImplementationDate, 'date'),
      p_treatment_revocation_reason: val(p.treatmentRevocationReason), p_control_definition_version_ids: arr(p.controlDefinitionVersionIds, 'uuid'),
      p_requested_effective_from: val(p.requestedEffectiveFrom, 'timestamptz'), p_requested_effective_to: val(p.requestedEffectiveTo, 'timestamptz'),
      p_expected_current_state_id: val(p.expectedCurrentStateId, 'uuid'), p_target_state_id: val(p.targetStateId, 'uuid'),
      p_prior_proposal_id: val(prior, 'uuid'), ...supportSql(support), p_caller_fingerprint: lit(fingerprint), ...o.raw })}) r;`;
  }
  interface Decide { commandId: string; proposalId: string; proposal: Proposal; outcome?: L14GovernanceOutcome; support?: Support;
    expected?: string | null; fingerprint?: string; session?: SessionOverride; reason?: string }
  function decideSql(actor: Actor, o: Decide) {
    const support = o.support ?? NONE, outcome = o.outcome ?? 'VALIDATE', expected = o.expected === undefined ? o.proposal.expectedCurrentStateId : o.expected;
    const fingerprint = o.fingerprint ?? decideRiskTreatmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org, actorUserId: actor.id,
      proposal: o.proposal, proposalId: o.proposalId, outcome, expectedCurrentStateId: expected, support });
    return `select to_json(r) from gov_repo.l15_decide_risk_treatment_proposal_v1(${named({ ...c.principal(actor, o.session),
      p_command_id: lit(o.commandId), p_proposal_id: val(o.proposalId, 'uuid'), p_outcome: lit(outcome), p_reason_code: lit(o.reason ?? riskTreatmentReasonCode(outcome)),
      p_expected_current_state_id: val(expected, 'uuid'), ...supportSql(support), p_caller_fingerprint: lit(fingerprint) })}) r;`;
  }
  const evidence = (x: Ctx): Support => ({ status: 'PRESENT', entries: [{ tag: 'DISCOVERY_EVIDENCE', targetId: x.evidence }] });
  const submit = (x: Ctx, name: string, p: Proposal, o: Partial<Submit> = {}, actor = x.member) => c.exec(submitSql(actor, { commandId: x.cmd(name), proposal: p, ...o }));
  const decide = (x: Ctx, name: string, submitted: Record<string, any>, p: Proposal, o: Partial<Decide> = {}, actor = x.treatment) =>
    c.exec(decideSql(actor, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal: p, ...o }));
  async function treat(x: Ctx, name: string, p: Proposal, support = NONE, actor = x.treatment) {
    const submitted = await submit(x, `${name}-submit`, p);
    const decided = await decide(x, `${name}-decide`, submitted, p, { support }, actor);
    return { proposal: p, submitted, decided, stateId: decided.state_id as string };
  }
  function revocation(p: Proposal, stateId: string, reason: Proposal['treatmentRevocationReason'] = 'TREATMENT_WITHDRAWN'): Proposal {
    return { ...p, intent: 'REVOKE', implementationStatus: null, targetImplementationDate: null, requestedEffectiveFrom: null,
      requestedEffectiveTo: null, expectedCurrentStateId: stateId, targetStateId: stateId, treatmentRevocationReason: reason };
  }
  const readSql = (actor: Actor, p: Proposal, at: string | null = null, cutoff: string | null = null, session?: SessionOverride) =>
    `select to_json(r) from gov_repo.l15_read_risk_treatment_v1(${named({ ...c.principal(actor, session), p_governed_risk_state_id: val(p.governedRiskStateId, 'uuid'),
      p_treatment_option: lit(p.treatmentOption), p_treatment_ordinal_key: lit(p.treatmentOrdinalKey), p_effective_at: val(at, 'timestamptz'), p_recorded_cutoff: val(cutoff, 'timestamptz') })}) r;`;
  const read = (actor: Actor, p: Proposal, at: string | null = null, cutoff: string | null = null) => c.exec(readSql(actor, p, at, cutoff));
  const history = (org: string) => k3.one(`select md5(coalesce(string_agg(x,'|' order by x),'')) from (${RT_TABLES.filter(t => !t.endsWith('heads')).map(t => `select '${t}:'||t::text x from gov_repo.${t} t where organisation_id='${org}'`).join(' union all ')}
    union all select 'support:'||t::text from gov_repo.l15_support_links t where organisation_id='${org}' and owner_kind='RISK_TREATMENT') h`);
  return { k3, pk, ck, setup, risk, control, proposal, submitSql, decideSql, submit, decide, treat, revocation, evidence, readSql, read, history,
    json: k3.json, one: k3.one, instant: k3.instant };
}
export type M17S5Kit = Awaited<ReturnType<typeof m17s5Kit>>;
