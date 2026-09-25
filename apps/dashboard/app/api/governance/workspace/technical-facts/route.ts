import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from '@/lib/auth';
import { resolveCurrentGovernanceRole, CurrentAuthorizationInfrastructureError } from '@/lib/auth/current-authorization';
import { technicalFieldReviewQueue, submitTechnicalFieldDecision, type ReviewedFieldDecision } from '@/lib/governance/multivendor-exchange';
export async function GET() {
  try {
    const principal=await requireVerifiedGovernancePrincipal();
    return NextResponse.json(await technicalFieldReviewQueue(asOrganisationId(principal.organisationId)));
  } catch(error) {
    if(error instanceof SessionAuthenticationError)return NextResponse.json({error:'Not authenticated.'},{status:401});
    return NextResponse.json({error:'Unable to load technical field reviews.'},{status:500});
  }
}
export async function POST(request: Request) {
  try {
    const principal=await requireVerifiedGovernancePrincipal();
    const currentRole=await resolveCurrentGovernanceRole(principal);
    if(currentRole!=='org_admin')return NextResponse.json({error:'Not authorized.'},{status:403});
    const raw = await request.text(); if (raw.length > 32768) return NextResponse.json({error:'Request too large.'},{status:400});
    const input = JSON.parse(raw) as ReviewedFieldDecision;
    if (!input || typeof input !== 'object' || Object.keys(input).some(k=>!['decisionId','canonicalObject','field','proposalId','observationIds','expectedSourceObservationId','expectedSourceSnapshotId','expectedCurrentStateId','policyId','policyVersion','outcome'].includes(k)) ||
      !Array.isArray(input.observationIds) || input.observationIds.length > 5000) return NextResponse.json({error:'Invalid field decision.'},{status:400});
    const result = await submitTechnicalFieldDecision(input,{organisationId:asOrganisationId(principal.organisationId),actorReference:principal.userId,currentRole});
    return NextResponse.json(result);
  } catch(error) {
    if(error instanceof SessionAuthenticationError)return NextResponse.json({error:'Not authenticated.'},{status:401});
    if(error instanceof CurrentAuthorizationInfrastructureError)return NextResponse.json({error:'Unable to authorize field review.'},{status:500});
    const message = error instanceof Error ? error.message : '';
    if(message==='FIELD_AUTHORIZATION_DENIED')return NextResponse.json({error:'Not authorized.'},{status:403});
    // Match exact known business errors, never substrings of private DB diagnostics.
    if(['FIELD_STALE_SOURCE','FIELD_STALE_POLICY','FIELD_STALE_STATE','FIELD_DECISION_REPLAY_CONFLICT',
      'FIELD_DECISION_CONTEXT_MISMATCH','FIELD_NOT_AUTHORITATIVE','FIELD_ACTOR_REQUIRED',
      'FIELD_MACHINE_AUTHORITY_FORBIDDEN'].includes(message)) {
      return NextResponse.json({error:'Field review changed or decision is invalid. Reload and review again.',
        code:message==='FIELD_STALE_SOURCE'||message==='FIELD_STALE_POLICY'?message:'FIELD_DECISION_REJECTED'},{status:409});
    }
    return NextResponse.json({error:'Unable to submit field review.'},{status:500});
  }
}
