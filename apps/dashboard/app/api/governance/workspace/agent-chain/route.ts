import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from '@/lib/auth';
import { toGovernanceWritePrincipal } from '@/lib/auth/governance-write-principal';
import { approveAgentChain, previewAgentChain, type ApproveChainInput } from '@/lib/governance/agent-chain-service';
import { ChainCommandError } from '@/lib/governance/agent-chain';
import { governedWriteErrorResponse } from '@/lib/governance/governed-write-errors';

function failure(error: unknown) {
  if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (error instanceof ChainCommandError) return NextResponse.json({ error: error.message }, { status: 409 });
  const security = governedWriteErrorResponse(error);
  if (security) return security;
  console.error('Agent chain operation failed', error);
  return NextResponse.json({ error: 'Unable to process this agent chain.' }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    const params = new URL(request.url).searchParams;
    const anchor = { ...(params.get('reviewId') ? { reviewId: params.get('reviewId')! } : {}),
      ...(params.get('canonicalId') ? { canonicalId: params.get('canonicalId')! } : {}) };
    return NextResponse.json(await previewAgentChain(asOrganisationId(principal.organisationId), anchor));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !body.anchor || typeof body.anchor !== 'object' ||
      (body.anchor.reviewId !== undefined && typeof body.anchor.reviewId !== 'string') ||
      (body.anchor.canonicalId !== undefined && typeof body.anchor.canonicalId !== 'string') ||
      typeof body.previewKey !== 'string' || typeof body.batchId !== 'string' || typeof body.justification !== 'string' ||
      !Array.isArray(body.selectedIds) || body.selectedIds.length > 10000 || !body.selectedIds.every((id: unknown) => typeof id === 'string')) {
      return NextResponse.json({ error: 'A preview, selection and justification are required.' }, { status: 400 });
    }
    // Only semantic inputs cross this boundary. Authority always comes from
    // the verified session, even if the body supplies forged actor/org fields.
    const input: ApproveChainInput = { anchor: { reviewId: body.anchor.reviewId, canonicalId: body.anchor.canonicalId },
      previewKey: body.previewKey, batchId: body.batchId, selectedIds: body.selectedIds, justification: body.justification };
    return NextResponse.json(await approveAgentChain(toGovernanceWritePrincipal(principal), input));
  } catch (error) { return failure(error); }
}
