// Strategy / Specification boundary for detection rules. A specification
// only ever inspects one artifact's already-read text; it never touches the
// source adapter, and it never decides trust or governance — that belongs
// to the pipeline assembling canonical evidence around its output.

import type { DiscoveryCandidateKind } from '@council/canonical-contracts';

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
