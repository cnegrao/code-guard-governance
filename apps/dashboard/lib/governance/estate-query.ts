import 'server-only';
import { projectCanonicalGraph } from '@council/graphos/governed';
import { CANONICAL_OBJECT_KIND, type OrganisationId } from '@council/canonical-contracts';
import { intelligenceReader } from './intelligence-read-store';
import { privilegedDb } from './persistence';

export async function readGovernedEstate(organisationId: OrganisationId) {
  const asOf = new Date().toISOString();
  const [population, review] = await Promise.all([
    intelligenceReader(organisationId).graphRows(),
    privilegedDb.from('review_subjects').select('review_subject_id', { count: 'exact', head: true })
      .eq('organisation_id', organisationId).in('state', ['DETECTED', 'PROPOSED', 'CONFIRMED']),
  ]);
  if (review.error || review.count === null || !Number.isSafeInteger(review.count) || review.count < 0) throw new Error('ESTATE_REVIEW_COUNT_UNKNOWN');
  const graph = projectCanonicalGraph({ organisationId, asOf, source: 'CANONICAL_PERSISTENCE', ...population });
  const byKind = Object.fromEntries(Object.values(CANONICAL_OBJECT_KIND).map(kind => [kind, 0]));
  for (const node of graph.nodes) byKind[node.canonicalObjectKind] += 1;
  return { byKind, canonicalObjects: graph.nodes.length, canonicalRelationships: graph.edges.length,
    pendingReview: review.count, asOf };
}
