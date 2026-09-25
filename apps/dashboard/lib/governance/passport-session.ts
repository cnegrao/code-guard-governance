import 'server-only';
import { asOrganisationId } from '@council/canonical-contracts';
import { notFound } from 'next/navigation';
import { requireVerifiedGovernancePrincipal } from '@/lib/auth';

/** Passport tenant comes from the verified session cookie, never request headers or query parameters. */
export async function passportOrganisation() {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    return asOrganisationId(principal.organisationId);
  } catch { notFound(); }
}
