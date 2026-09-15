import 'server-only';
import { buildAnalyticalContext, projectCanonicalGraph } from '@council/graphos/governed';
import { intelligenceReader } from './intelligence-read-store';
import { passportOrganisation } from './passport-session';

/** Authenticated server entry: tenant is resolved from the existing verified session only. */
export async function getGovernedIntelligence(input: {
  readonly seedCanonicalObjectId: string;
  readonly asOf: string;
  readonly maxDepth: number;
  readonly vectorQuery: { readonly anchorRepresentationId: string; readonly minimumCosine: number } | null;
}) {
  const organisationId = await passportOrganisation();
  const reader = intelligenceReader(organisationId);
  const graph = projectCanonicalGraph({ organisationId, asOf: input.asOf, source: 'CANONICAL_PERSISTENCE',
    ...await reader.graphRows() });
  const representations = input.vectorQuery
    ? await reader.compatibleRepresentations(await reader.anchor(input.vectorQuery.anchorRepresentationId)) : [];
  const context = buildAnalyticalContext({ organisationId, graph, seedCanonicalObjectId: input.seedCanonicalObjectId,
    maxDepth: input.maxDepth, vectorQuery: input.vectorQuery, representations });
  return Object.freeze({ ...context, limitations: Object.freeze([...context.limitations,
    'MULTI_QUERY_READ_NOT_TRANSACTION_WIDE_SNAPSHOT',
    'EXACT_READ_LIMIT_10000_ROWS_PER_TABLE_QUERY_FAILS_CLOSED',
    'PRODUCTION_EMBEDDING_POPULATION_NOT_VERIFIED',
  ]) });
}
