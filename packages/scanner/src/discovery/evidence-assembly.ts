import { createHash } from 'node:crypto';

import {
  EVIDENCE_HANDLING,
  EVIDENCE_LOCATION_KIND,
  FINDING_REVIEW_STATUS,
  TRUST_STATE,
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asSourceAssertionId,
  asSourceSnapshotId,
  createEvidence,
  sanitizeEvidenceLocator,
  type AcquisitionRun,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type Evidence,
  type SourceAssertion,
  type SourceConnectionReference,
  type SourceObjectIdentity,
} from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from './detection-specification';
import type { SourceArtifactContent } from './source-adapter';

/** One evidence-backed candidate: never governed truth (see DiscoveryFinding). */
export interface DiscoveryCandidate {
  readonly finding: DiscoveryFinding<DiscoveryCandidateKind>;
  readonly assertion: SourceAssertion;
  readonly evidence: Evidence;
  readonly displayValue: string;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * Assembles one {@link DiscoveryCandidate} from a single specification match.
 * Every field it does not itself observe (trust state, review status,
 * candidate-vs-canonical status) is fixed to the values that keep detection
 * from ever silently becoming governed truth.
 */
export function assembleDiscoveryCandidate(params: {
  readonly connection: SourceConnectionReference;
  readonly run: AcquisitionRun;
  readonly artifact: SourceArtifactContent;
  readonly specification: DetectionSpecification;
  readonly match: DetectionMatch;
  readonly observedAt: string;
}): DiscoveryCandidate {
  const { connection, run, artifact, specification, match, observedAt } = params;

  const sourceObject: SourceObjectIdentity = {
    connectionId: connection.connectionId,
    externalType: 'file',
    externalId: asExternalId(artifact.locator),
  };

  const idSeed = [
    connection.connectionId,
    artifact.locator,
    specification.code,
    specification.version,
    String(match.lineStart),
    String(match.lineEnd),
    match.displayValue,
  ];

  const sanitizedLocator = sanitizeEvidenceLocator(artifact.locator);
  const observed = asIsoTimestamp(observedAt);

  const evidence = createEvidence({
    evidenceId: asEvidenceId(`evidence:${stableSuffix(idSeed)}`),
    handling: EVIDENCE_HANDLING.NON_SENSITIVE,
    locations: [
      {
        kind: EVIDENCE_LOCATION_KIND.REPOSITORY,
        locator: sanitizedLocator,
        path: artifact.locator,
        lineStart: match.lineStart,
        lineEnd: match.lineEnd,
      },
    ],
    hashes: [{ algorithm: 'sha256', value: artifact.contentHash }],
    redactedExcerpt: match.excerpt,
    capturedAt: observed,
  });

  const assertion: SourceAssertion = {
    assertionId: asSourceAssertionId(`source-assertion:${stableSuffix(idSeed)}`),
    sourceObject,
    runId: run.runId,
    snapshot: {
      snapshotId: asSourceSnapshotId(
        `source-snapshot:${stableSuffix([connection.connectionId, artifact.locator, artifact.contentHash])}`,
      ),
      sourceObject,
      observedAt: observed,
      contentHash: { algorithm: 'sha256', value: artifact.contentHash },
      locator: sanitizedLocator,
    },
    method: { code: specification.code, version: specification.version },
    // Discovery conclusions are always INFERRED; this is not a second
    // "declared" trust level with the same meaning.
    trustState: TRUST_STATE.INFERRED,
    confidence: match.confidence,
    observedAt: observed,
    recordedAt: observed,
    evidenceIds: [evidence.evidenceId],
  };

  const finding: DiscoveryFinding<DiscoveryCandidateKind> = {
    findingId: asDiscoveryFindingId(`discovery-finding:${stableSuffix([...idSeed, specification.candidateKind])}`),
    findingNature: 'CANDIDATE',
    candidateKind: specification.candidateKind,
    sourceObject,
    assertionIds: [assertion.assertionId],
    evidenceIds: [evidence.evidenceId],
    confidence: match.confidence,
    reviewStatus: FINDING_REVIEW_STATUS.UNREVIEWED,
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: observed,
  };

  return { finding, assertion, evidence, displayValue: match.displayValue };
}
