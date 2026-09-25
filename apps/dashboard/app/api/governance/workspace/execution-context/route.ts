import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from '@/lib/auth';
import { resolveCurrentGovernanceRole, CurrentAuthorizationInfrastructureError } from '@/lib/auth/current-authorization';
import { executionReviewQueue, submitExecutionDecision } from '@/lib/governance/execution-context-review';
export async function GET() {
  try {
    const principal=await requireVerifiedGovernancePrincipal();
    return NextResponse.json(await executionReviewQueue(asOrganisationId(principal.organisationId)));
  }
  catch(error) {
    if(error instanceof SessionAuthenticationError)return NextResponse.json({error:'Not authenticated.'},{status:401});
    return NextResponse.json({error:'Unable to load execution declaration reviews.'},{status:500});
  }
}
export async function POST(request:Request) {
  try {
    const principal=await requireVerifiedGovernancePrincipal();
    const currentRole=await resolveCurrentGovernanceRole(principal);
    if(currentRole!=='org_admin')return NextResponse.json({error:'Not authorized.'},{status:403});
    const text=await request.text();if(text.length>16384)return NextResponse.json({error:'Request too large.'},{status:400});
    return NextResponse.json(await submitExecutionDecision(JSON.parse(text),{organisationId:asOrganisationId(principal.organisationId),
      actorReference:principal.userId,currentRole}));
  } catch(error) {
    if(error instanceof SessionAuthenticationError)return NextResponse.json({error:'Not authenticated.'},{status:401});
    if(error instanceof CurrentAuthorizationInfrastructureError)return NextResponse.json({error:'Unable to authorize execution review.'},{status:500});
    const message=error instanceof Error?error.message:'';
    if(message==='EXECUTION_REVIEW_FORBIDDEN')return NextResponse.json({error:'Not authorized.'},{status:403});
    // Only known business failures are conflicts. S0.3.3 adds wrapper SQLSTATE mapping.
    if(['EXECUTION_DECISION_INVALID','EXECUTION_REPLAY_CONFLICT','EXECUTION_BINDING_MISMATCH',
      'EXECUTION_STALE_SOURCE','EXECUTION_STALE_STATE','EXECUTION_STALE_POLICY','EXECUTION_NO_FIELD_AUTHORITY'].includes(message)) {
      return NextResponse.json({error:'Execution review changed or decision is invalid. Reload and review again.'},{status:409});
    }
    return NextResponse.json({error:'Unable to submit execution review.'},{status:500});
  }
}
