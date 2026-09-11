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
import type { SqlDataDeclaration, SqlColumnTransformation } from './strategies/sql-create-table';
import { findBehaviorDeclarationBinding, type BehaviorDeclarationBinding } from './behavior-declaration-binding';

/** One evidence-backed candidate: never governed truth (see DiscoveryFinding). */
export interface DiscoveryCandidate {
  readonly transformation?: SqlColumnTransformation;
  readonly dataDeclaration?: SqlDataDeclaration;
  readonly finding: DiscoveryFinding<DiscoveryCandidateKind>;
  readonly assertion: SourceAssertion;
  readonly evidence: Evidence;
  readonly displayValue: string;
  /**
   * Optional controlled content fingerprint (see DetectionMatch.contentFingerprint's
   * own doc comment) — deliberately scanner-internal plumbing, never part of
   * NormalizedObjectCandidate.proposedIdentity or any canonical-contracts type.
   */
  readonly contentFingerprint?: string;
  /** Direct declaration containment, backed by this candidate's snapshot/evidence. */
  readonly behaviorBinding?: BehaviorDeclarationBinding;
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
  // Data declarations retain snapshot-specific evidence/candidate rows when
  // datatype/default/containment changes at the same location. Semantic object
  // identity remains sourceReference / parent + elementPath, never this seed.
  if (match.dataDeclaration) {
    idSeed.push(artifact.contentHash, match.dataDeclaration.sourceReference,
      match.dataDeclaration.statementFingerprint, match.dataDeclaration.elementPath ?? '');
  }
  if (match.transformation) idSeed.push(artifact.contentHash, match.transformation.statementFingerprint);

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
    hashes: [{ algorithm: 'sha256', value: artifact.contentHash },
      ...(match.transformation ? [{ algorithm: 'sha256' as const, value: match.transformation.statementFingerprint }] : [])],
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
    // Per-fact trust: a specification may opt a specific match into DECLARED
    // when its own match carries trustState (see detection-specification.ts's
    // DetectionMatch doc comment for the exact justification rule). Absent
    // trustState defaults to INFERRED, exactly as before this field existed —
    // every pre-existing specification (AGENT/MODEL/TOOL) never sets it and
    // is therefore completely unaffected by this extension.
    trustState: match.trustState ?? TRUST_STATE.INFERRED,
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

  const behaviorBinding =
    (specification.code === 'model-reference-declaration' && specification.candidateKind === 'MODEL') ||
    (specification.code === 'tool-list-declaration' && specification.candidateKind === 'TOOL')
      ? findBehaviorDeclarationBinding(artifact, match.lineStart)
      : undefined;

  return {
    finding,
    assertion,
    evidence,
    displayValue: match.displayValue,
    ...(match.transformation === undefined ? {} : { transformation: match.transformation }),
    ...(match.dataDeclaration === undefined ? {} : { dataDeclaration: match.dataDeclaration }),
    ...(match.contentFingerprint === undefined ? {} : { contentFingerprint: match.contentFingerprint }),
    ...(behaviorBinding === undefined ? {} : { behaviorBinding }),
  };
}
