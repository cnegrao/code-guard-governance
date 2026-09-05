import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const MODEL_REFERENCE_PATTERN =
  /^\s*(?:MODEL_REFERENCE|modelReference)\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects the structural declaration `MODEL_REFERENCE = "..."` /
 * `modelReference: "..."` used across the Discovery Validation Lab's golden
 * repositories to name the model a component is bound to. Syntactic only:
 * it captures the declared literal, never validates it against a real
 * provider catalogue.
 */
export class ModelReferenceDeclarationSpecification implements DetectionSpecification {
  readonly code = 'model-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.MODEL;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(
      artifact.text,
      MODEL_REFERENCE_PATTERN,
      0.6,
      (match) => match[1],
    );
  }
}
