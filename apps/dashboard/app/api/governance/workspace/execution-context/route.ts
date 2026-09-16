import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { getSession } from '@/lib/auth';
import { executionReviewQueue, submitExecutionDecision } from '@/lib/governance/execution-context-review';
export async function GET() {
  try {
    const session=await executionSession();
    if(!session)return NextResponse.json({error:'Not authenticated.'},{status:401});
    return NextResponse.json(await executionReviewQueue(asOrganisationId(session.org)));
  }
  catch { return NextResponse.json({error:'Unable to load execution declaration reviews.'},{status:500}); }
}
export async function POST(request:Request) {
  try {
    const session=await executionSession();
    if(!session)return NextResponse.json({error:'Not authenticated.'},{status:401});
    if(session.role!=='org_admin')return NextResponse.json({error:'Not authorized.'},{status:403});
    const text=await request.text();if(text.length>16384)return NextResponse.json({error:'Request too large.'},{status:400});
    return NextResponse.json(await submitExecutionDecision(JSON.parse(text),{organisationId:asOrganisationId(session.org),
      actorReference:session.sub,role:session.role}));
  } catch(error) {
    const forbidden=error instanceof Error&&error.message==='EXECUTION_REVIEW_FORBIDDEN';
    return NextResponse.json({error:forbidden?'Not authorized.':'Execution review changed or decision is invalid. Reload and review again.'},{status:forbidden?403:409});
  }
}

async function executionSession() {
  if(!process.env.JWT_SECRET||process.env.JWT_SECRET==='fallback-dev-secret-change-in-production')return null;
  const session=await getSession();
  return session&&typeof session.org==='string'&&session.org.trim()&&typeof session.sub==='string'&&session.sub.trim()?session:null;
}
