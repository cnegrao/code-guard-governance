import { createHash } from 'node:crypto';

import {
  CANONICAL_OBJECT_KIND,
  FINDING_REVIEW_STATUS,
  asDiscoveryFindingId,
  asIsoTimestamp,
  asNormalizedCandidateId,
  type EvidenceId,
  type NormalizedAgentVersionCandidate,
  type ObjectDiscoveryFinding,
  type PreCanonicalObjectReference,
  type SourceAssertionId,
  type SourceObjectIdentity,
} from '@council/canonical-contracts';

import type { DiscoveryCandidate } from './evidence-assembly';
import { normalizeObjectCandidate } from './object-candidate-normalization';

/**
 * One evidence-backed AGENT_VERSION candidate: the canonical
 * {@link ObjectDiscoveryFinding}<"AGENT_VERSION"> envelope plus the canonical
 * pre-reconciliation candidate it backs. Mirrors
 * RelationshipCorrelationResult's shape (relationship-correlation.ts) — an
 * AGENT_VERSION is, like a relationship, a correlation product across
 * multiple already-produced {@link DiscoveryCandidate}s, never a single
 * detector's own match: no detector observes "a version" directly.
 */
export interface AgentVersionCorrelationResult {
  readonly finding: ObjectDiscoveryFinding<'AGENT_VERSION'>;
  readonly candidate: NormalizedAgentVersionCandidate;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function dedupeIds<Id extends string>(ids: readonly Id[]): readonly Id[] {
  return Object.freeze(Array.from(new Set(ids)).sort());
}

function fileGroupKey(identity: SourceObjectIdentity): string {
  return JSON.stringify([identity.connectionId, identity.externalType, identity.externalId]);
}

/**
 * Canonical projection of the agent-relevant discovery evidence this
 * milestone's Discovery Engine actually possesses, used to derive a
 * deterministic AGENT_VERSION technical-revision fingerprint (see the
 * milestone evidence document's AGENT_VERSION_FINGERPRINT_INPUTS for the
 * exact, documented input list). Deliberately excludes anything not
 * agent-relevant (a README edit, an unrelated file) and anything volatile
 * (timestamps, candidate traversal order): every input is sorted and
 * deduplicated so input order never changes the projection.
 *
 * The parent AGENT's own findingId (itself already a stable hash of source
 * connection, artifact locator, and the matched declaration — see
 * evidence-assembly.ts) is included first specifically so that two
 * unrelated Agents that merely happen to share the same agentCode and the
 * same correlated Model/Tool identities (e.g. the same generic fixture
 * declared twice under two different files/tenants) can never collapse into
 * one AGENT_VERSION identity: PARENT LOGICAL AGENT IDENTITY + EVIDENCE-
 * BACKED TECHNICAL REVISION, exactly as required, not technical revision
 * alone.
 */
function buildTechnicalRevisionProjection(params: {
  readonly agentFindingId: string;
  readonly agentCode: string;
  readonly modelReferences: readonly string[];
  readonly toolDeclarationKeys: readonly string[];
}): readonly string[] {
  return [
    `agent-finding:${params.agentFindingId}`,
    `agent-code:${params.agentCode}`,
    ...Array.from(new Set(params.modelReferences)).sort().map((value) => `model:${value}`),
    ...Array.from(new Set(params.toolDeclarationKeys)).sort().map((value) => `tool:${value}`),
  ];
}

/**
 * Correlates one already-normalizable AGENT candidate with the MODEL/TOOL
 * candidates correlated alongside it in the same source artifact (same
 * "exactly one Agent per file" rule relationship-correlation.ts already
 * uses for USES_MODEL/USES_TOOL) into one evidence-backed AGENT_VERSION
 * candidate.
 *
 * Correlation and fail-closed rules (deterministic, source-scoped):
 *
 *   - Exactly one AGENT candidate per file, and that AGENT candidate must
 *     itself be safely normalizable
 *     (`normalizeObjectCandidate` returns `NORMALIZED`) — an AGENT with no
 *     real logical identity can never own a version. Zero or more than one
 *     AGENT candidate in the same file is ambiguous and yields no
 *     AGENT_VERSION, matching relationship correlation's own posture.
 *   - At least one MODEL or TOOL candidate correlated in the same file,
 *     itself normalizable, is required as version-relevant technical
 *     evidence beyond the AGENT's own logical identity ("Minimum evidence
 *     for AGENT_VERSION"). An AGENT with no correlated technical signal
 *     fails closed here rather than emitting a placeholder version, even
 *     though its own AGENT candidate may still normalize independently.
 *   - The AGENT_VERSION's findingId/candidateId are derived from a
 *     canonical, sorted, deduplicated projection of the AGENT's own
 *     normalized agentCode plus every correlated MODEL modelReference and
 *     TOOL declarationKey — never from a wall-clock value, a random UUID,
 *     or candidate traversal order. Identical technical inputs always
 *     reproduce the identical AGENT_VERSION identity; a materially
 *     different input set always produces a different one.
 *   - No versionCode is ever fabricated: this V1 correlation observes no
 *     trustworthy explicit version declaration anywhere in the current
 *     Discovery Engine, so `proposedIdentity.versionCode` is always left
 *     absent rather than invented (no "1.0.0"/"v1"/"latest"/UUID/timestamp).
 */
export function correlateAgentVersions(
  candidates: readonly DiscoveryCandidate[],
  options: { readonly observedAt: string },
): readonly AgentVersionCorrelationResult[] {
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

  const results: AgentVersionCorrelationResult[] = [];

  for (const key of Array.from(byFile.keys()).sort()) {
    const bucket = byFile.get(key) ?? [];
    const agents = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.AGENT);
    if (agents.length !== 1) continue;
    const [agent] = agents;

    const normalizedAgent = normalizeObjectCandidate(agent);
    if (normalizedAgent.status !== 'NORMALIZED' || normalizedAgent.candidate.candidateKind !== 'AGENT') continue;
    const { agentCode } = normalizedAgent.candidate.proposedIdentity;
    if (!agentCode) continue;

    const models = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.MODEL);
    const tools = bucket.filter((candidate) => candidate.finding.candidateKind === CANONICAL_OBJECT_KIND.TOOL);

    // Defensive fail-closed check, mirroring relationship correlation's own:
    // never correlate candidates observed under different source connections.
    if (
      models.some((model) => model.finding.sourceObject.connectionId !== agent.finding.sourceObject.connectionId) ||
      tools.some((tool) => tool.finding.sourceObject.connectionId !== agent.finding.sourceObject.connectionId)
    ) {
      continue;
    }

    const normalizedModelReferences: string[] = [];
    for (const model of models) {
      const normalized = normalizeObjectCandidate(model);
      if (
        normalized.status === 'NORMALIZED' &&
        normalized.candidate.candidateKind === 'MODEL' &&
        normalized.candidate.proposedIdentity.modelReference
      ) {
        normalizedModelReferences.push(normalized.candidate.proposedIdentity.modelReference);
      }
    }
    const normalizedToolKeys: string[] = [];
    for (const tool of tools) {
      const normalized = normalizeObjectCandidate(tool);
      if (
        normalized.status === 'NORMALIZED' &&
        normalized.candidate.candidateKind === 'TOOL' &&
        normalized.candidate.proposedIdentity.declarationKey
      ) {
        normalizedToolKeys.push(normalized.candidate.proposedIdentity.declarationKey);
      }
    }

    // Minimum evidence for AGENT_VERSION: the AGENT's own logical identity
    // is never sufficient on its own.
    if (normalizedModelReferences.length === 0 && normalizedToolKeys.length === 0) continue;

    const projection = buildTechnicalRevisionProjection({
      agentFindingId: agent.finding.findingId,
      agentCode,
      modelReferences: normalizedModelReferences,
      toolDeclarationKeys: normalizedToolKeys,
    });
    const suffix = stableSuffix(projection);

    const correlatedCandidates = [agent, ...models, ...tools];
    const assertionIds: readonly SourceAssertionId[] = dedupeIds(
      correlatedCandidates.flatMap((candidate) => candidate.finding.assertionIds),
    );
    const evidenceIds: readonly EvidenceId[] = dedupeIds(
      correlatedCandidates.flatMap((candidate) => candidate.finding.evidenceIds),
    );
    const confidence = Math.min(...correlatedCandidates.map((candidate) => candidate.finding.confidence));
    const detectedAt = asIsoTimestamp(options.observedAt);

    const finding: ObjectDiscoveryFinding<'AGENT_VERSION'> = {
      findingId: asDiscoveryFindingId(`discovery-finding:agent-version:${suffix}`),
      findingNature: 'CANDIDATE',
      candidateKind: 'AGENT_VERSION',
      // Provenance anchor only (the artifact the correlated evidence came
      // from), not a claim that this one artifact alone proves the version.
      sourceObject: agent.finding.sourceObject,
      assertionIds,
      evidenceIds,
      confidence,
      reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
      requiresReview: true,
      createsCanonicalObject: false,
      detectedAt,
    };

    const agentReference: PreCanonicalObjectReference<'AGENT'> = {
      referenceKind: 'SOURCE_OBJECT',
      sourceObject: agent.finding.sourceObject,
      candidateKind: CANONICAL_OBJECT_KIND.AGENT,
    };

    const candidate: NormalizedAgentVersionCandidate = {
      candidateId: asNormalizedCandidateId(`candidate:agent-version:${suffix}`),
      candidateKind: 'AGENT_VERSION',
      sourceObject: finding.sourceObject,
      findingId: finding.findingId,
      assertionIds,
      evidenceIds,
      confidence: finding.confidence,
      requiresReconciliation: true,
      proposedIdentity: { agent: agentReference },
    };

    results.push({ finding, candidate });
  }

  return Object.freeze(results);
}

/**
 * Named strategy boundary wrapping {@link correlateAgentVersions}, mirroring
 * RelationshipCorrelationStrategy's own class-based shape so the consumption
 * pattern in apps/dashboard/lib/governance/discovery-intake.ts stays
 * consistent across every correlation-derived (non-single-detector)
 * candidate kind.
 */
export class AgentVersionCorrelationStrategy {
  correlate(
    candidates: readonly DiscoveryCandidate[],
    observedAt: string,
  ): readonly AgentVersionCorrelationResult[] {
    return correlateAgentVersions(candidates, { observedAt });
  }
}
