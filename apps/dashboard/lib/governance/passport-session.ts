import 'server-only';
import { asOrganisationId } from '@council/canonical-contracts';
import { notFound } from 'next/navigation';
import { requireVerifiedGovernancePrincipal } from '@/lib/auth';
import { toGovernanceWritePrincipal, type GovernanceWritePrincipal } from '@/lib/auth/governance-write-principal';

/** Passport tenant comes from the verified session cookie, never request headers or query parameters. */
export async function passportOrganisation() {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    return asOrganisationId(principal.organisationId);
  } catch { notFound(); }
}

/**
 * The verified session principal for Passport reads that PostgreSQL itself must revalidate (the M16 governed projection).
 * Same strict cookie verification as passportOrganisation; never header / query / body values.
 */
export async function passportPrincipal(): Promise<GovernanceWritePrincipal> {
  try {
    const principal = await requireVerifiedGovernancePrincipal();
    asOrganisationId(principal.organisationId);
    return toGovernanceWritePrincipal(principal);
  } catch { notFound(); }
}
