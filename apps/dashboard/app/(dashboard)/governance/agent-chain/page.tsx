import { AgentChainReview } from '@/components/workspace/AgentChainReview';

export default async function AgentChainPage({ searchParams }: { searchParams: Promise<{ reviewId?: string; canonicalId?: string }> }) {
  const { reviewId, canonicalId } = await searchParams;
  return <AgentChainReview reviewId={reviewId} canonicalId={canonicalId} />;
}
