import { notFound } from 'next/navigation';
import { passportPrincipal } from '@/lib/governance/passport-session';
import { getAgentPassport } from '@/lib/governance/passport-query';
import { AgentPassport } from '@/components/agents/AgentPassport';

export const dynamic = 'force-dynamic';

export default async function CanonicalAgentPassportPage({ params, searchParams }: {
  params: Promise<{ canonicalObjectId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const principal = await passportPrincipal();
  const { canonicalObjectId } = await params;
  const { version } = await searchParams;
  if (Array.isArray(version)) notFound();
  // Next's dynamic segment value retains one URI transport layer. Query the
  // persisted opaque identity, including literal percent escapes, exactly once.
  let objectId: string;
  try { objectId = decodeURIComponent(canonicalObjectId); }
  catch { notFound(); }
  const passport = await getAgentPassport(principal, objectId, version);
  if (!passport) notFound();
  return <AgentPassport passport={passport} />;
}
