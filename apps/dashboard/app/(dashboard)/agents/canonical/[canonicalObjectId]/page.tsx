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
  const passport = await getAgentPassport(principal, canonicalObjectId, version);
  if (!passport) notFound();
  return <AgentPassport passport={passport} />;
}
