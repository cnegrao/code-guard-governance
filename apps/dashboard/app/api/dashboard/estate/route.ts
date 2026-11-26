import { NextResponse } from 'next/server';
import { asOrganisationId } from '@council/canonical-contracts';
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from '@/lib/auth';
import { readGovernedEstate } from '@/lib/governance/estate-query';

export async function GET() {
  try {
    const { organisationId } = await requireVerifiedGovernancePrincipal();
    return NextResponse.json(await readGovernedEstate(asOrganisationId(organisationId)));
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    return NextResponse.json({ error: 'Governed estate could not be read. Counts are UNKNOWN.' }, { status: 500 });
  }
}
