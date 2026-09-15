import 'server-only';
import { asOrganisationId } from '@council/canonical-contracts';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';

/** Passport tenant comes from the verified session cookie, never request headers or query parameters. */
export async function passportOrganisation() {
  // Do not enable a privileged canonical read using the legacy development fallback key.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fallback-dev-secret-change-in-production') notFound();
  const session = await getSession();
  if (!session?.sub || !session.org) notFound();
  return asOrganisationId(session.org);
}
