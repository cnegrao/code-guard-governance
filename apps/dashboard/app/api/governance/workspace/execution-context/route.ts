import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from '@/lib/auth';
import { resolveCurrentGovernanceRole } from '@/lib/auth/current-authorization';
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
    const forbidden=error instanceof Error&&error.message==='EXECUTION_REVIEW_FORBIDDEN';
    return NextResponse.json({error:forbidden?'Not authorized.':'Execution review changed or decision is invalid. Reload and review again.'},{status:forbidden?403:409});
  }
}
