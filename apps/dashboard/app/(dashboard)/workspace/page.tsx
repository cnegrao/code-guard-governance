import { passportPrincipal } from '@/lib/governance/passport-session';
import { ExecutiveAuthorizationError, getExecutiveWorkspace } from '@/lib/workspace/executive-query';
import { ExecutiveWorkspace } from '@/components/workspace/ExecutiveWorkspace';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function BusinessWorkspacePage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const principal = await passportPrincipal();
  const { page } = await searchParams;
  try {
    // M16 admission and all protected acquisition happen in one PostgreSQL
    // transaction. Its commit is the consistency boundary, not HTTP delivery.
    const model = await getExecutiveWorkspace(principal, page);
    return <ExecutiveWorkspace model={model} />;
  } catch (error) {
    if (error instanceof ExecutiveAuthorizationError) notFound();
    throw error;
  }
}
