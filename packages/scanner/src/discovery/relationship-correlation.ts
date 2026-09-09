import { createHash } from 'node:crypto';
import {
  FINDING_REVIEW_STATUS,
  GOVERNED_RELATIONSHIP_TYPE,
  asDiscoveryFindingId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  type NormalizedRelationshipCandidate,
  type OrganisationId,
  type RelationshipDiscoveryFinding,
  type SourceConnectionId,
  type SourceObjectIdentity,
} from '@council/canonical-contracts';
import { correlateAgentVersions, type AgentVersionCorrelationResult } from './agent-version-correlation';
import type { DiscoveryCandidate } from './evidence-assembly';
import { normalizeObjectCandidate } from './object-candidate-normalization';
import type { TechnicalProfileSignal } from './technical-profile-signal';

/** Existing finding + normalized candidate boundary; never governed truth. */
export interface RelationshipCorrelationResult {
  readonly finding: RelationshipDiscoveryFinding;
  readonly candidate: NormalizedRelationshipCandidate;
}

/**
 * Trusted intake scopes all inputs to one organisation and acquisition
 * connection. Canonical discovery contracts carry tenancy through that context,
 * not an invented organisation field on NormalizedCandidate.
 */
export interface RelationshipCorrelationContext {
  readonly organisationId: OrganisationId;
  readonly connectionId: SourceConnectionId;
  readonly agentVersions: readonly AgentVersionCorrelationResult[];
  readonly technicalProfileSignals: readonly TechnicalProfileSignal[];
}

const unique = <T extends string>(ids: readonly T[]): readonly T[] => Object.freeze([...new Set(ids)].sort());
const sourceKey = (source: SourceObjectIdentity) => JSON.stringify([source.connectionId, source.externalType, source.externalId]);

function hasEvidence(candidate: DiscoveryCandidate): boolean {
  if (!candidate.assertion.snapshot?.contentHash?.value) return false;
  return candidate.finding.assertionIds.includes(candidate.assertion.assertionId) &&
    candidate.finding.evidenceIds.includes(candidate.evidence.evidenceId) &&
    candidate.assertion.evidenceIds.includes(candidate.evidence.evidenceId) &&
    sourceKey(candidate.finding.sourceObject) === sourceKey(candidate.assertion.sourceObject) &&
    sourceKey(candidate.finding.sourceObject) === sourceKey(candidate.assertion.snapshot.sourceObject) &&
    candidate.evidence.locations.some((location) => 'path' in location &&
      location.path === candidate.finding.sourceObject.externalId &&
      'lineStart' in location && typeof location.lineStart === 'number' && location.lineStart > 0) &&
    candidate.evidence.hashes.some((hash) => hash.algorithm === 'sha256' &&
      hash.value === candidate.assertion.snapshot?.contentHash?.value);
}

function correlateBehaviorRelationships(
  candidates: readonly DiscoveryCandidate[],
  observedAt: string,
  context?: RelationshipCorrelationContext,
): readonly RelationshipCorrelationResult[] {
  // Old callers lacking version/tenant context stop emitting, never fall back
  // to logical AGENT or mutable SOURCE_OBJECT version resolution.
  if (!context?.organisationId?.trim() || !context.connectionId?.trim()) return [];
  if (candidates.some((item) => item.finding.sourceObject.connectionId !== context.connectionId) ||
      context.agentVersions.some((item) => item.candidate.sourceObject.connectionId !== context.connectionId) ||
      context.technicalProfileSignals.some((item) => item.sourceObject.connectionId !== context.connectionId)) return [];

  // Validate exact version against this batch, including protected Prompt
  // revision and technical signals. Stale versions cannot borrow evidence IDs
  // that happen to replay across changed snapshots.
  const expectedVersions = correlateAgentVersions(candidates, context.technicalProfileSignals, { observedAt });
  const results = new Map<string, RelationshipCorrelationResult>();
  for (const version of context.agentVersions) {
    if (version.candidate.candidateKind !== 'AGENT_VERSION' || version.finding.candidateKind !== 'AGENT_VERSION') continue;
    const expected = expectedVersions.find((item) => item.candidate.candidateId === version.candidate.candidateId);
    if (!expected || expected.finding.findingId !== version.finding.findingId ||
        sourceKey(expected.candidate.sourceObject) !== sourceKey(version.candidate.sourceObject)) continue;
    // A valid ID cannot repair a supplied source candidate stripped of its
    // provenance. Require the actual source envelope to retain all support.
    if (expected.candidate.assertionIds.some((id) => !version.candidate.assertionIds.includes(id) || !version.finding.assertionIds.includes(id)) ||
        expected.candidate.evidenceIds.some((id) => !version.candidate.evidenceIds.includes(id) || !version.finding.evidenceIds.includes(id))) continue;
    const inFile = candidates.filter((item) => sourceKey(item.finding.sourceObject) === sourceKey(expected.candidate.sourceObject));
    const agents = inFile.filter((item) => item.finding.candidateKind === 'AGENT');
    if (agents.length !== 1 || !hasEvidence(agents[0]) || agents[0].assertion.method.code !== 'agent-kind-declaration') continue;
    const agent = agents[0];
    const normalizedAgent = normalizeObjectCandidate(agent);
    if (normalizedAgent.status !== 'NORMALIZED' || normalizedAgent.candidate.candidateKind !== 'AGENT') continue;

    for (const target of inFile) {
      const binding = target.behaviorBinding;
      if (!binding || binding.method !== 'DIRECT_AGENT_PROPERTY_V1' || !hasEvidence(target) ||
          binding.agentDeclarationKey !== normalizedAgent.candidate.proposedIdentity.agentCode ||
          target.assertion.snapshot?.snapshotId !== agent.assertion.snapshot?.snapshotId ||
          target.assertion.snapshot?.contentHash?.value !== agent.assertion.snapshot?.contentHash?.value ||
          !agent.evidence.locations.some((location) => 'lineStart' in location && location.lineStart === binding.agentMarkerLine)) continue;
      const normalized = normalizeObjectCandidate(target);
      if (normalized.status !== 'NORMALIZED') continue;
      const object = normalized.candidate;
      // Closed implemented subset; other families lack binding evidence.
      let relationshipTypeCode: string;
      if (object.candidateKind === 'MODEL' && target.assertion.method.code === 'model-reference-declaration') {
        relationshipTypeCode = GOVERNED_RELATIONSHIP_TYPE.USES_MODEL;
      } else if (object.candidateKind === 'TOOL' && target.assertion.method.code === 'tool-list-declaration') {
        relationshipTypeCode = GOVERNED_RELATIONSHIP_TYPE.USES_TOOL;
      } else continue;

      const suffix = createHash('sha256').update(JSON.stringify([
        'agent-version-behavior-v1', context.organisationId, relationshipTypeCode,
        expected.candidate.candidateId, object.candidateKind, object.candidateId,
      ])).digest('hex').slice(0, 32);
      const assertionIds = unique([...expected.candidate.assertionIds, ...object.assertionIds]);
      const evidenceIds = unique([...expected.candidate.evidenceIds, ...object.evidenceIds]);
      const finding: RelationshipDiscoveryFinding = {
        findingId: asDiscoveryFindingId(`discovery-finding:relationship:${suffix}`),
        findingNature: 'CANDIDATE', candidateKind: 'RELATIONSHIP',
        sourceObject: expected.candidate.sourceObject, assertionIds, evidenceIds,
        confidence: Math.min(expected.candidate.confidence, object.confidence),
        reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED, requiresReview: true,
        createsCanonicalObject: false, detectedAt: asIsoTimestamp(observedAt),
      };
      // Existing normalization envelope with exact normalized object IDs.
      const candidate: NormalizedRelationshipCandidate = {
        candidateId: asNormalizedCandidateId(`candidate:relationship:${suffix}`),
        candidateKind: 'RELATIONSHIP', sourceObject: finding.sourceObject,
        findingId: finding.findingId, assertionIds, evidenceIds,
        confidence: finding.confidence, requiresReconciliation: true, relationshipTypeCode,
        sourceEndpoint: { referenceKind: 'CANDIDATE', candidateKind: 'AGENT_VERSION', candidateId: expected.candidate.candidateId },
        targetEndpoint: { referenceKind: 'CANDIDATE', candidateKind: object.candidateKind, candidateId: object.candidateId },
      };
      results.set(candidate.candidateId, { finding, candidate });
    }
  }
  return Object.freeze([...results.values()].sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId)));
}

/** Compatibility name only: output source is always AGENT_VERSION. */
export function correlateAgentUsesModelRelationships(
  candidates: readonly DiscoveryCandidate[],
  options: { readonly observedAt: string; readonly context?: RelationshipCorrelationContext },
): readonly RelationshipCorrelationResult[] {
  return correlateBehaviorRelationships(candidates, options.observedAt, options.context)
    .filter((item) => item.candidate.relationshipTypeCode === 'USES_MODEL');
}

/** Compatibility name only: output source is always AGENT_VERSION. */
export function correlateAgentUsesToolRelationships(
  candidates: readonly DiscoveryCandidate[],
  options: { readonly observedAt: string; readonly context?: RelationshipCorrelationContext },
): readonly RelationshipCorrelationResult[] {
  return correlateBehaviorRelationships(candidates, options.observedAt, options.context)
    .filter((item) => item.candidate.relationshipTypeCode === 'USES_TOOL');
}

export class RelationshipCorrelationStrategy {
  correlate(candidates: readonly DiscoveryCandidate[], observedAt: string, context?: RelationshipCorrelationContext): readonly RelationshipCorrelationResult[] {
    return correlateBehaviorRelationships(candidates, observedAt, context);
  }
}
