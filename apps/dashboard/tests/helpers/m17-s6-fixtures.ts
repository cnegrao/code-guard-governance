import type { L15ResidualRiskAssessmentProposalContent as Proposal, L15RiskAssessmentSupport, L14GovernanceOutcome } from '@council/canonical-contracts';
import { submitResidualRiskAssessmentProposalFingerprint, decideResidualRiskAssessmentProposalFingerprint } from '@council/governance-review';
import { m17s4Kit, NONE, type Meth } from './m17-s4-fixtures';
import type { Actor, L14Cluster, SessionOverride } from './m16-l14-fixtures';
import { val, arr } from './m17-s5-fixtures';
export async function m17s6Kit(c: L14Cluster) {
  const k4 = await m17s4Kit(c);
  const proposal = (risk: string, m: Meth, inherent: string, until: string, over: Partial<Proposal> = {}): Proposal => ({
    ...k4.rated(risk, m, 'L1', 'I1', until), assessmentBasis: 'RESIDUAL', inherentAssessmentStateId: inherent,
    methodologyValidatedStateId: m.stateId, treatmentStateIds: [], controlAssessmentStateIds: [], ...over,
  });
  interface Submit { commandId: string; proposal: Proposal; support?: L15RiskAssessmentSupport; prior?: string | null;
    fingerprint?: string; session?: SessionOverride; rawPins?: string }
  function submitSql(actor: Actor, o: Submit) {
    const p = o.proposal;
    const fingerprint = o.fingerprint ?? submitResidualRiskAssessmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, proposal: p, priorProposalId: o.prior ?? null, support: o.support ?? NONE });
    return k4.submitSql(actor, { ...o, proposal: p as never, fingerprint })
      .replace('l15_submit_risk_assessment_proposal_v1(', 'l15_submit_risk_assessment_proposal_v2(')
      .replace('p_caller_fingerprint =>', `${o.rawPins ?? `p_inherent_assessment_state_id => ${val(p.inherentAssessmentStateId, 'uuid')},
        p_methodology_validated_state_id => ${val(p.methodologyValidatedStateId, 'uuid')},
        p_treatment_state_ids => ${arr(p.treatmentStateIds, 'uuid')}, p_control_assessment_state_ids => ${arr(p.controlAssessmentStateIds, 'uuid')}`}, p_caller_fingerprint =>`);
  }
  interface Decide { commandId: string; proposalId: string; proposal: Proposal; outcome?: L14GovernanceOutcome;
    expected?: string | null; support?: L15RiskAssessmentSupport; fingerprint?: string; session?: SessionOverride }
  function decideSql(actor: Actor, o: Decide) {
    const fingerprint = o.fingerprint ?? decideResidualRiskAssessmentProposalFingerprint({ organisationId: o.session?.org ?? actor.org,
      actorUserId: actor.id, proposal: o.proposal, proposalId: o.proposalId, outcome: o.outcome ?? 'VALIDATE',
      expectedCurrentStateId: o.expected === undefined ? o.proposal.expectedCurrentStateId : o.expected, support: o.support ?? NONE });
    return k4.decideSql(actor, { ...o, proposal: o.proposal as never, fingerprint });
  }
  type Ctx = Awaited<ReturnType<typeof k4.setup>>;
  const submit = (x: Ctx, name: string, p: Proposal, o: Partial<Submit> = {}, actor = x.member) =>
    c.exec(submitSql(actor, { commandId: x.cmd(name), proposal: p, ...o }));
  const decide = (x: Ctx, name: string, submitted: Record<string, any>, p: Proposal, o: Partial<Decide> = {}, actor = x.assessor) =>
    c.exec(decideSql(actor, { commandId: x.cmd(name), proposalId: submitted.proposal_id, proposal: p, ...o }));
  async function assess(x: Ctx, name: string, p: Proposal) {
    const submitted = await submit(x, `${name}-submit`, p);
    const decided = await decide(x, `${name}-decide`, submitted, p, {}, p.requestedEffectiveFrom ? x.raDater : x.assessor);
    return { proposal: p, submitted, decided, stateId: decided.state_id as string };
  }
  const readSql = (actor: Actor, risk: string, at: string | null = null, cutoff: string | null = null, session?: SessionOverride) =>
    k4.readSql(actor, risk, val(at, 'timestamptz'), val(cutoff, 'timestamptz'), 'RESIDUAL', session).replace('l15_read_risk_assessment_v1(', 'l15_read_risk_assessment_v2(');
  const read = (actor: Actor, risk: string, at: string | null = null, cutoff: string | null = null) => c.exec(readSql(actor, risk, at, cutoff));
  return { ...k4, k4, proposal, submitSql, decideSql, submit, decide, assess, readSql, read };
}
