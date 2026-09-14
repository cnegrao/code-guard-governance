import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { getOrgId, getSessionContext, getUserId } from '@/lib/session';
import { technicalFieldReviewQueue, submitTechnicalFieldDecision, type ReviewedFieldDecision } from '@/lib/governance/multivendor-exchange';
export async function GET() {
  try { return NextResponse.json(await technicalFieldReviewQueue(asOrganisationId(await getOrgId()))); }
  catch { return NextResponse.json({error:'Unable to load technical field reviews.'},{status:500}); }
}
export async function POST(request: Request) {
  try {
    const raw = await request.text(); if (raw.length > 32768) return NextResponse.json({error:'Request too large.'},{status:400});
    const input = JSON.parse(raw) as ReviewedFieldDecision;
    if (!input || typeof input !== 'object' || Object.keys(input).some(k=>!['decisionId','canonicalObject','field','proposalId','observationIds','expectedSourceObservationId','expectedSourceSnapshotId','expectedCurrentStateId','policyId','policyVersion','outcome'].includes(k)) ||
      !Array.isArray(input.observationIds) || input.observationIds.length > 5000) return NextResponse.json({error:'Invalid field decision.'},{status:400});
    const result = await submitTechnicalFieldDecision(input,{organisationId:asOrganisationId(await getOrgId()),actorReference:await getUserId(),role:(await getSessionContext()).role});
    return NextResponse.json(result);
  } catch(error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({error:message.includes('FIELD_AUTHORIZATION_DENIED') ? 'Not authorized.' : 'Field review changed or decision is invalid. Reload and review again.',
      code:message.includes('FIELD_STALE_SOURCE') ? 'FIELD_STALE_SOURCE' : message.includes('FIELD_STALE_POLICY') ? 'FIELD_STALE_POLICY' : 'FIELD_DECISION_REJECTED'},{status:message.includes('FIELD_AUTHORIZATION_DENIED') ? 403 : 409});
  }
}
