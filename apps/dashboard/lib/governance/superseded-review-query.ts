import 'server-only';
import type { OrganisationId } from '@council/canonical-contracts';
import type { ReviewState } from '@council/governance-review';
import { privilegedDb } from './persistence';
import { rehydrateNormalizedCandidate, normalizedCandidateEnvelopeHash } from './discovery-intake-persistence';
import { latestDiscoveryChain, type ChainCandidate } from './agent-chain';

interface CandidateRow { organisation_id: string; envelope: unknown; envelope_hash: string; acquisition_run_id: string }
interface RunRow { organisation_id: string; run_id: string; source_connection_id: string; started_at: string }
interface ReviewRow { organisation_id: string; review_subject_id: string; finding_id: string; state: ReviewState }

/** Complete tenant reads, bounded like REV-001. Never hide from a truncated history. */
async function readRows<T extends { organisation_id: string }>(org: OrganisationId, table: string, columns: string, order: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await privilegedDb.from(table).select(`organisation_id,${columns}`)
      .eq('organisation_id', org).order(order).range(offset, offset + 199);
    if (error || !Array.isArray(data)) throw new Error('SUPERSEDED_REVIEW_READ_FAILED');
    const rows = data as unknown as T[];
    if (rows.some(row => row.organisation_id !== org)) throw new Error('SUPERSEDED_REVIEW_TENANT_MISMATCH');
    result.push(...rows);
    if (result.length > 10000) throw new Error('SUPERSEDED_REVIEW_READ_LIMIT_EXCEEDED');
    if (rows.length < 200) return result;
  }
}

/** Presentation only: the same proposal chronology and endpoint rule as REV-001. */
export async function readSupersededReviews(org: OrganisationId): Promise<Map<string, ReviewState>> {
  const [candidates, runs, reviews] = await Promise.all([
    readRows<CandidateRow>(org, 'discovery_candidates', 'envelope,envelope_hash,acquisition_run_id', 'candidate_id'),
    readRows<RunRow>(org, 'acquisition_runs', 'run_id,source_connection_id,started_at', 'run_id'),
    readRows<ReviewRow>(org, 'review_subjects', 'review_subject_id,finding_id,state', 'review_subject_id'),
  ]);
  const byRun = new Map(runs.map(run => [run.run_id, run]));
  const byFinding = new Map(reviews.map(review => [review.finding_id, review]));
  const all: ChainCandidate[] = candidates.map(row => {
    const candidate = rehydrateNormalizedCandidate(row.envelope);
    if (normalizedCandidateEnvelopeHash(candidate) !== row.envelope_hash) throw new Error('SUPERSEDED_REVIEW_HASH_MISMATCH');
    const run = byRun.get(row.acquisition_run_id);
    const review = byFinding.get(candidate.findingId);
    // Missing/inconsistent chronology must keep proposals visible for individual review.
    const validRun = run && run.source_connection_id === candidate.sourceObject.connectionId && Number.isFinite(Date.parse(run.started_at));
    return { candidate, reviewSubjectId: review?.review_subject_id, state: review?.state,
      discoveryRun: validRun ? { id: run.run_id, startedAt: run.started_at } : undefined };
  });
  const supersededIds = new Set(latestDiscoveryChain(all).superseded.map(row => row.candidateId));
  return new Map(all.filter(row => row.reviewSubjectId && row.state && row.discoveryRun && supersededIds.has(row.candidate.candidateId))
    .map(row => [row.reviewSubjectId!, row.state!]));
}
