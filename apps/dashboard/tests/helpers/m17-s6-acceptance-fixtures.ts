import { randomUUID } from 'node:crypto';
import type { L15RiskAcceptanceProposalContent as Proposal, L15RiskAcceptanceSupport as Support, L14GovernanceOutcome } from '@council/canonical-contracts';
import { submitRiskAcceptanceProposalFingerprint, decideRiskAcceptanceProposalFingerprint, riskAcceptanceReasonCode } from '@council/governance-review';
import { m17s6Kit } from './m17-s6-fixtures';
import { type L14Cluster, type Actor, type SessionOverride, rule } from './m16-l14-fixtures';
import { lit, named } from './m16-governed-write-fixtures';
import { val, arr, NONE } from './m17-s5-fixtures';
export async function acceptanceKit(c: L14Cluster) {
  const k = await m17s6Kit(c);
  const roles = { accept: randomUUID(), flex: randomUUID(), kind: randomUUID() };
  for (const [name,id] of Object.entries(roles)) await c.owner(`insert into gov_repo.governance_roles(role_id,role_code,role_name,role_tier,is_system_role) values('${id}','S6_ACCEPT_${name}','acceptance ${name}','organisation',false)`);
  const actions = ['VALIDATE','REJECT','DEFER','REVOKE'] as const;
  const acceptanceRules = () => [
    ...actions.map(a => rule(roles.accept,'L15_RISK_ACCEPTANCE_VALIDATE',a)),
    ...actions.map(a => rule(roles.flex,'L15_RISK_ACCEPTANCE_VALIDATE',a,{allowSelfValidation:true,allowBackdating:true,allowFutureDating:true})),
    rule(roles.kind,'L15_RISK_ACCEPTANCE_VALIDATE','VALIDATE',{scopeTag:'CANONICAL_KIND',scopeCanonicalKind:'AGENT_VERSION'}),
  ];
  async function setup() {
    const x = await k.setup({extra:acceptanceRules});
    return {...x,acceptor:await c.mkUser(x.org,[roles.accept]),acceptor2:await c.mkUser(x.org,[roles.accept]),
      acceptFlex:await c.mkUser(x.org,[roles.flex]),acceptKind:await c.mkUser(x.org,[roles.kind])};
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  const proposal = (residual:string,until:string,over:Partial<Proposal>={}):Proposal => ({intent:'VALIDATE',sourceClass:'LOCAL_HUMAN',residualAssessmentStateId:residual,
    requestedEffectiveFrom:null,requestedValidUntil:until,expectedCurrentStateId:null,targetStateId:null,...over});
  const supportSql=(s:Support)=>({p_support_status:lit(s.status),p_support_tags:arr(s.entries.map(e=>e.tag)),p_support_target_ids:arr(s.entries.map(e=>e.targetId))});
  interface Submit {commandId:string;proposal:Proposal;support?:Support;prior?:string|null;fingerprint?:string;session?:SessionOverride;raw?:Record<string,string>}
  function submitSql(actor:Actor,o:Submit) {
    const p=o.proposal,support=o.support??NONE,prior=o.prior??null;
    const fingerprint=o.fingerprint??submitRiskAcceptanceProposalFingerprint({organisationId:o.session?.org??actor.org,actorUserId:actor.id,proposal:p,support,priorProposalId:prior});
    return `select to_json(r) from gov_repo.l15_submit_risk_acceptance_proposal_v1(${named({...c.principal(actor,o.session),
      p_command_id:lit(o.commandId),p_intent:lit(p.intent),p_source_class:lit(p.sourceClass),p_residual_assessment_state_id:val(p.residualAssessmentStateId,'uuid'),
      p_requested_effective_from:val(p.requestedEffectiveFrom,'timestamptz'),p_requested_valid_until:val(p.requestedValidUntil,'timestamptz'),
      p_expected_current_state_id:val(p.expectedCurrentStateId,'uuid'),p_target_state_id:val(p.targetStateId,'uuid'),p_prior_proposal_id:val(prior,'uuid'),
      ...supportSql(support),p_caller_fingerprint:lit(fingerprint),...o.raw})}) r;`;
  }
  interface Decide {commandId:string;proposalId:string;proposal:Proposal;outcome?:L14GovernanceOutcome;expected?:string|null;support?:Support;fingerprint?:string;session?:SessionOverride;reason?:string}
  function decideSql(actor:Actor,o:Decide) {
    const support=o.support??NONE,outcome=o.outcome??'VALIDATE',expected=o.expected===undefined?o.proposal.expectedCurrentStateId:o.expected;
    const fingerprint=o.fingerprint??decideRiskAcceptanceProposalFingerprint({organisationId:o.session?.org??actor.org,actorUserId:actor.id,proposal:o.proposal,proposalId:o.proposalId,outcome,expectedCurrentStateId:expected,support});
    return `select to_json(r) from gov_repo.l15_decide_risk_acceptance_proposal_v1(${named({...c.principal(actor,o.session),
      p_command_id:lit(o.commandId),p_proposal_id:val(o.proposalId,'uuid'),p_outcome:lit(outcome),p_reason_code:lit(o.reason??riskAcceptanceReasonCode(outcome)),
      p_expected_current_state_id:val(expected,'uuid'),...supportSql(support),p_caller_fingerprint:lit(fingerprint)})}) r;`;
  }
  const submit=(x:Ctx,name:string,p:Proposal,o:Partial<Submit>={},actor=x.member)=>c.exec(submitSql(actor,{commandId:x.cmd(name),proposal:p,...o}));
  const decide=(x:Ctx,name:string,s:Record<string,any>,p:Proposal,o:Partial<Decide>={},actor=x.acceptor)=>c.exec(decideSql(actor,{commandId:x.cmd(name),proposalId:s.proposal_id,proposal:p,...o}));
  async function accept(x:Ctx,name:string,p:Proposal,support:Support=NONE,actor=x.acceptor) {
    const submitted=await submit(x,`${name}-submit`,p,{support});
    const decided=await decide(x,`${name}-decide`,submitted,p,{support},actor);
    return {proposal:p,submitted,decided,stateId:decided.state_id as string};
  }
  const revocation=(p:Proposal,stateId:string):Proposal=>({...p,intent:'REVOKE',requestedEffectiveFrom:null,requestedValidUntil:null,expectedCurrentStateId:stateId,targetStateId:stateId});
  const readSql=(actor:Actor,residual:string,at:string|null=null,cutoff:string|null=null,session?:SessionOverride)=>
    `select to_json(r) from gov_repo.l15_read_risk_acceptance_v1(${named({...c.principal(actor,session),p_residual_assessment_state_id:val(residual,'uuid'),p_effective_at:val(at,'timestamptz'),p_recorded_cutoff:val(cutoff,'timestamptz')})}) r;`;
  const read=(actor:Actor,residual:string,at:string|null=null,cutoff:string|null=null)=>c.exec(readSql(actor,residual,at,cutoff));
  async function residual(x:Ctx,name:string,kind='AGENT_VERSION') {
    const risk=await k.risk(x,`${name}-risk`,kind as never),m=await k.methodology(x,`${name}-method`),until=await k.instant('20 days');
    const inherent=await k.k4.assess(x,`${name}-inherent`,k.k4.insufficient(risk.stateId,m,until));
    const r=await k.assess(x,`${name}-residual`,k.proposal(risk.stateId,m,inherent.stateId,until));
    return {...r,risk,m,inherent,until};
  }
  const history=(org:string)=>k.one(`select md5(coalesce(string_agg(t::text,'|' order by state_id),'')) from gov_repo.l15_risk_acceptance_states t where organisation_id='${org}'`);
  return {k,roles,acceptanceRules,setup,proposal,submitSql,decideSql,submit,decide,accept,revocation,readSql,read,residual,history};
}
