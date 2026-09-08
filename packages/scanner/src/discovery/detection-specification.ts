// Strategy / Specification boundary for detection rules. A specification
// only ever inspects one artifact's already-read text; it never touches the
// source adapter, and it never decides trust or governance — that belongs
// to the pipeline assembling canonical evidence around its output.

import type { DiscoveryCandidateKind, TrustState } from '@council/canonical-contracts';

import type { SourceArtifactContent } from './source-adapter';

/** One textual match a specification found inside a single artifact. */
export interface DetectionMatch {
  /** Human-readable label for the detected thing (e.g. a model reference literal). */
  readonly displayValue: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  /** Exact matched text, trimmed; carried into evidence as a redacted excerpt. */
  readonly excerpt: string;
  /** 0..1. This is the specification's own confidence, never governed truth. */
  readonly confidence: number;
  /**
   * Per-fact trust state (frozen vocabulary: INFERRED/DECLARED/IMPORTED/
   * OBSERVED/VALIDATED — see GOVIA-L0L16-CIA-v1.0.md §3). Optional and
   * defaults to INFERRED in evidence-assembly.ts when absent, preserving
   * every pre-existing specification's exact prior behavior unchanged. Set
   * this to DECLARED only when the matched value sits in a semantically
   * authoritative declaration position the source/config format itself
   * defines as an explicit identity (e.g. a named JSON config key, a
   * dedicated config file's own field, a file-path convention) — never
   * because confidence is high, and never OBSERVED/VALIDATED from
   * design-time source (a specification must never set either).
   */
  readonly trustState?: TrustState;
  /**
   * Optional controlled content fingerprint (e.g. sha256 of a Prompt
   * declaration's own parsed string value, truncated the same way every
   * other stable-suffix hash in this package is) — deliberately never the
   * raw content itself. Threaded through to DiscoveryCandidate.contentFingerprint
   * (evidence-assembly.ts) so a downstream correlation (e.g.
   * agent-version-correlation.ts's technical revision projection) can be
   * sensitive to a fact's own *content* without that content, or a
   * derived-from-content value, ever entering canonical object identity
   * (NormalizedObjectCandidate.proposedIdentity) or the evidence excerpt.
   */
  readonly contentFingerprint?: string;
}

/**
 * A single, named detection rule (Specification pattern). Implementations
 * must be deterministic: the same artifact content always yields the same
 * matches, in the same order.
 */
export interface DetectionSpecification {
  /** Stable identifier recorded as the assertion/finding method code. */
  readonly code: string;
  readonly version: string;
  readonly candidateKind: DiscoveryCandidateKind;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[];
}
