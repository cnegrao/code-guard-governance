import { createHash } from 'node:crypto';

import {
  CANONICAL_OBJECT_KIND,
  FINDING_REVIEW_STATUS,
  GOVERNED_RELATIONSHIP_TYPE,
  asDiscoveryFindingId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  type EvidenceId,
  type NormalizedRelationshipCandidate,
  type PreCanonicalObjectReference,
  type RelationshipDiscoveryFinding,
  type SourceAssertionId,
  type SourceObjectIdentity,
} from '@council/canonical-contracts';

import type { DiscoveryCandidate } from './evidence-assembly';

/**
 * One evidence-backed relationship candidate: the canonical
 * {@link RelationshipDiscoveryFinding} envelope plus the canonical
 * pre-reconciliation candidate it backs. Both types come straight from
 * canonical-contracts; nothing scanner-local is introduced, and neither
 * type can ever be mistaken for governed truth (`requiresReview: true`,
 * `requiresReconciliation: true`).
 */
export interface RelationshipCorrelationResult {
  readonly finding: RelationshipDiscoveryFinding;
  readonly candidate: NormalizedRelationshipCandidate;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function dedupeIds<Id extends string>(ids: readonly Id[]): readonly Id[] {
  return Object.freeze(Array.from(new Set(ids)));
}

function fileGroupKey(identity: SourceObjectIdentity): string {
  return JSON.stringify([identity.connectionId, identity.externalType, identity.externalId]);
}

function buildUsesModelRelationship(params: {
  readonly agent: DiscoveryCandidate;
  readonly model: DiscoveryCandidate;
  readonly observedAt: string;
}): RelationshipCorrelationResult {
  const { agent, model, observedAt } = params;

  const suffix = stableSuffix([
    agent.finding.findingId,
    model.finding.findingId,
    GOVERNED_RELATIONSHIP_TYPE.USES_MODEL,
  ]);

  const assertionIds: readonly SourceAssertionId[] = dedupeIds([
    ...agent.finding.assertionIds,
    ...model.finding.assertionIds,
  ]);
  const evidenceIds: readonly EvidenceId[] = dedupeIds([
    ...agent.finding.evidenceIds,
    ...model.finding.evidenceIds,
  ]);
  const detectedAt = asIsoTimestamp(observedAt);

  const finding: RelationshipDiscoveryFinding = {
    findingId: asDiscoveryFindingId(`discovery-finding:relationship:${suffix}`),
    findingNature: 'CANDIDATE',
    candidateKind: 'RELATIONSHIP',
    // Provenance anchor only (the artifact the correlated evidence came
    // from); it is not a claim about which endpoint is "the" source.
    sourceObject: agent.finding.sourceObject,
    assertionIds,
    evidenceIds,
    confidence: Math.min(agent.finding.confidence, model.finding.confidence),
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt,
  };

  const sourceEndpoint: PreCanonicalObjectReference<'AGENT'> = {
    referenceKind: 'SOURCE_OBJECT',
    sourceObject: agent.finding.sourceObject,
    candidateKind: CANONICAL_OBJECT_KIND.AGENT,
  };
  const targetEndpoint: PreCanonicalObjectReference<'MODEL'> = {
    referenceKind: 'SOURCE_OBJECT',
    sourceObject: model.finding.sourceObject,
    candidateKind: CANONICAL_OBJECT_KIND.MODEL,
  };

  const candidate: NormalizedRelationshipCandidate = {
    candidateId: asNormalizedCandidateId(`candidate:relationship:${suffix}`),
    candidateKind: 'RELATIONSHIP',
    sourceObject: finding.sourceObject,
    findingId: finding.findingId,
    assertionIds,
    evidenceIds,
    confidence: finding.confidence,
    requiresReconciliation: true,
    relationshipTypeCode: GOVERNED_RELATIONSHIP_TYPE.USES_MODEL,
    sourceEndpoint,
    targetEndpoint,
  };

  return { finding, candidate };
}

/**
 * Correlates already-produced Agent and Model discovery candidates into
 * evidence-backed `AGENT -> USES_MODEL -> MODEL` relationship candidates.
 *
 * This is a post-detection correlation boundary: it consumes
 * {@link DiscoveryCandidate}s produced by the pipeline (never the source
 * adapter or raw filesystem), and never fabricates a relationship merely
 * because both an Agent and a Model exist somewhere in the same run.
 *
 * Correlation rule (deterministic, fail-closed): an Agent and a Model are
 * only correlated when they were both detected in the exact same source
 * artifact (same connection + externalId) AND that artifact contains
 * exactly one Agent candidate and exactly one Model candidate. Any other
 * shape - no Agent, no Model, or more than one candidate of either kind in
 * the same artifact - is ambiguous and is left uncorrelated rather than
 * guessed at.
 */
export function correlateAgentUsesModelRelationships(
  candidates: readonly DiscoveryCandidate[],
  options: { readonly observedAt: string },
): readonly RelationshipCorrelationResult[] {
  const byFile = new Map<string, DiscoveryCandidate[]>();
  for (const candidate of candidates) {
    const key = fileGroupKey(candidate.finding.sourceObject);
    const bucket = byFile.get(key);
    if (bucket) {
      bucket.push(candidate);
    } else {
      byFile.set(key, [candidate]);
    }
  }

  const results: RelationshipCorrelationResult[] = [];

  for (const key of Array.from(byFile.keys()).sort()) {
    const bucket = byFile.get(key) ?? [];
    const agents = bucket.filter(
      (candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.AGENT,
    );
    const models = bucket.filter(
      (candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.MODEL,
    );

    if (agents.length !== 1 || models.length !== 1) {
      continue;
    }

    const [agent] = agents;
    const [model] = models;

    // Defensive fail-closed check: a future multi-source merge must never
    // let this function silently correlate candidates observed under
    // different source connections.
    if (agent.finding.sourceObject.connectionId !== model.finding.sourceObject.connectionId) {
      continue;
    }

    results.push(buildUsesModelRelationship({ agent, model, observedAt: options.observedAt }));
  }

  return Object.freeze(results);
}

/**
 * Named strategy boundary wrapping {@link correlateAgentUsesModelRelationships}.
 * Kept as a class (rather than a bare export) so future relationship types
 * (e.g. `AGENT -> USES_TOOL -> TOOL`) can be added as sibling strategies
 * without changing the pipeline's consumption pattern.
 */
export class RelationshipCorrelationStrategy {
  correlate(
    candidates: readonly DiscoveryCandidate[],
    observedAt: string,
  ): readonly RelationshipCorrelationResult[] {
    return correlateAgentUsesModelRelationships(candidates, { observedAt });
  }
}
