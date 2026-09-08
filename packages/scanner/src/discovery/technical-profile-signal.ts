import { createHash } from 'node:crypto';

import {
  EVIDENCE_HANDLING,
  EVIDENCE_LOCATION_KIND,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asSourceAssertionId,
  asSourceSnapshotId,
  createEvidence,
  sanitizeEvidenceLocator,
  type AcquisitionRun,
  type Evidence,
  type SourceAssertion,
  type SourceConnectionReference,
  type SourceObjectIdentity,
  type TrustState,
} from '@council/canonical-contracts';

import type { SourceArtifactContent } from './source-adapter';

/**
 * AgentVersion technical-profile SIGNAL — deliberately NOT a
 * DiscoveryCandidate<CanonicalObjectKind> and never routed through Object
 * Candidate Normalization, ReviewSubject creation, or canonical
 * materialization. A Framework/Memory/Orchestration fact is evidence ABOUT
 * an AgentVersion's technical configuration; it is not itself an
 * independently governable canonical object, and must never masquerade as
 * one by borrowing `candidateKind: AGENT_VERSION` (the defect this module
 * corrects — see the PR #24 correction's Blocker #2). It still carries the
 * same evidence rigor as a DiscoveryCandidate: its own Evidence +
 * SourceAssertion, its own detector identity, its own trust state, its own
 * confidence — never a single opaque blob.
 *
 * The closed CanonicalObjectKind taxonomy in canonical-contracts is not
 * extended by this module. `signalKind` is a scanner-internal vocabulary
 * with no bearing on CanonicalObjectKind/DiscoveryCandidateKind.
 */
export const TECHNICAL_PROFILE_SIGNAL_KIND = {
  FRAMEWORK: 'FRAMEWORK',
  MEMORY: 'MEMORY',
  ORCHESTRATION: 'ORCHESTRATION',
} as const;
export type TechnicalProfileSignalKind =
  (typeof TECHNICAL_PROFILE_SIGNAL_KIND)[keyof typeof TECHNICAL_PROFILE_SIGNAL_KIND];

/**
 * Technology/Build and Guardrail/HITL deliberately have no signal kind here:
 * no defensible real-source pattern was found for them within this
 * correction's inspection scope (see the evidence document's
 * REAL_SOURCE_EVIDENCE section) and none is fabricated to fill the slot.
 */

/** One match a TechnicalProfileSignalSpecification found inside one artifact. */
export interface TechnicalProfileSignalMatch {
  readonly value: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly excerpt: string;
  readonly confidence: number;
  /**
   * Required (unlike DetectionMatch.trustState, which defaults for backward
   * compatibility): every technical-profile signal specification is new in
   * this correction, so each must make its trust-state justification
   * explicit rather than inheriting a silent default.
   */
  readonly trustState: TrustState;
}

export interface TechnicalProfileSignalSpecification {
  readonly code: string;
  readonly version: string;
  readonly signalKind: TechnicalProfileSignalKind;
  detect(artifact: SourceArtifactContent): readonly TechnicalProfileSignalMatch[];
}

export interface TechnicalProfileSignal {
  readonly signalKind: TechnicalProfileSignalKind;
  readonly sourceObject: SourceObjectIdentity;
  readonly value: string;
  readonly detector: { readonly code: string; readonly version: string };
  readonly assertion: SourceAssertion;
  readonly evidence: Evidence;
  readonly confidence: number;
}

function stableSuffix(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * Mirrors assembleDiscoveryCandidate (evidence-assembly.ts) exactly for
 * Evidence/SourceAssertion construction — same locator sanitization, same
 * content-hash inclusion, same redacted-excerpt handling — but never
 * produces a DiscoveryFinding: a technical-profile signal has no
 * CanonicalObjectKind to carry one (see this module's own top-level doc
 * comment). trustState comes from the match itself, never a hardcoded
 * default, since every specification here must justify its own trust tier.
 */
export function assembleTechnicalProfileSignal(params: {
  readonly connection: SourceConnectionReference;
  readonly run: AcquisitionRun;
  readonly artifact: SourceArtifactContent;
  readonly specification: TechnicalProfileSignalSpecification;
  readonly match: TechnicalProfileSignalMatch;
  readonly observedAt: string;
}): TechnicalProfileSignal {
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
    match.value,
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
    trustState: match.trustState,
    confidence: match.confidence,
    observedAt: observed,
    recordedAt: observed,
    evidenceIds: [evidence.evidenceId],
  };

  return {
    signalKind: specification.signalKind,
    sourceObject,
    value: match.value,
    detector: { code: specification.code, version: specification.version },
    assertion,
    evidence,
    confidence: match.confidence,
  };
}
