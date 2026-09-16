import 'server-only';
import { asCanonicalObjectId, asIsoTimestamp, DIRECT_EXECUTION_FIELDS, type OrganisationId, type ExecutionFieldDecision } from '@council/canonical-contracts';
import { executionPolicy, reconcileExecutionField } from '@council/governance-review';
import { executionRows, readExecutionReview, readExecutionDecision } from './execution-context-read';
import { executionContextPersistence } from './execution-context-persistence';

export async function executionReviewQueue(org:OrganisationId) {
  const rows=await executionRows(org,'execution_source_snapshots');
  const result=[];
  for(const row of rows)for(const field of DIRECT_EXECUTION_FIELDS) {
    const ctx=await readExecutionReview(org,row.snapshot_id,field);
    let policy;let policyError=false;try{policy=executionPolicy(ctx,field);}catch{policyError=true;}
    result.push({snapshotId:row.snapshot_id,field,canonicalObjectId:ctx.object?.objectId??null,
      facts:ctx.snapshot.facts.filter(f=>f.fact.field===field),authorizationState:'UNKNOWN',trustState:'DECLARED',
      expectedCurrentStateId:ctx.currentStateId??null,currentSourceSnapshotId:ctx.currentSourceSnapshotId??null,
      policyId:policy?.policyId??null,policyVersion:policy?.version??null,
      canAccept:!!ctx.object&&!policyError&&ctx.currentSourceSnapshotId===row.snapshot_id&&!!policy&&policy.disposition!=='NON_AUTHORITATIVE'});
  }
  return result;
}
export async function submitExecutionDecision(input:unknown,ctx:{organisationId:OrganisationId;actorReference:string;role:string}) {
  if(ctx.role!=='org_admin'||!ctx.actorReference)throw new Error('EXECUTION_REVIEW_FORBIDDEN');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('EXECUTION_DECISION_INVALID');
  const raw=input as Record<string,unknown>;
  const required=['decisionId','canonicalObjectId','snapshotId','field','outcome'];
  const optional=['expectedCurrentStateId','policyId','policyVersion'];
  if(Object.keys(raw).some(k=>![...required,...optional].includes(k))||required.some(k=>typeof raw[k]!=='string'||!(raw[k] as string).trim())||
    optional.some(k=>raw[k]!==undefined&&(typeof raw[k]!=='string'||!(raw[k] as string).trim())))throw new Error('EXECUTION_DECISION_INVALID');
  const prior=await readExecutionDecision(ctx.organisationId,raw.decisionId as string);
  const decision:ExecutionFieldDecision={organisationId:ctx.organisationId,decisionId:raw.decisionId as string,
    canonicalObject:{organisationId:ctx.organisationId,kind:'AGENT_VERSION',objectId:asCanonicalObjectId(raw.canonicalObjectId as string)},
    snapshotId:raw.snapshotId as string,field:raw.field as ExecutionFieldDecision['field'],outcome:raw.outcome as ExecutionFieldDecision['outcome'],
    ...(raw.expectedCurrentStateId?{expectedCurrentStateId:raw.expectedCurrentStateId as string}:{}),
    ...(raw.policyId?{policyId:raw.policyId as string}:{}),...(raw.policyVersion?{policyVersion:raw.policyVersion as string}:{}),
    actor:{authorityKind:'HUMAN',actorReference:ctx.actorReference},decidedAt:prior?.decision.decidedAt??asIsoTimestamp(new Date().toISOString())};
  return reconcileExecutionField(decision,executionContextPersistence,{authorize:d=>d.organisationId===ctx.organisationId&&d.actor.actorReference===ctx.actorReference});
}
