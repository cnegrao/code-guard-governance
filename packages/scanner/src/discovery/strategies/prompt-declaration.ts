import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const PROMPT_REFERENCE_PATTERN =
  /^\s*(?:PROMPT_REFERENCE|promptReference)\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects the explicit structural declaration `PROMPT_REFERENCE = "..."` /
 * `promptReference: "..."` — the same explicit-literal-declaration contract
 * MODEL_REFERENCE already uses (see model-reference-declaration.ts).
 * Deliberately narrow: a raw prompt string, a docstring, a template literal,
 * or prose mentioning the word "prompt" never matches. Only this explicit
 * declaration key counts as evidence, and the captured value is a declared
 * identifier/reference — never the prompt's own content, so raw prompt text
 * is never leaked into identity (see PromptCandidateNormalizationStrategy in
 * object-candidate-normalization.ts).
 */
export class PromptDeclarationSpecification implements DetectionSpecification {
  readonly code = 'prompt-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.PROMPT;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, PROMPT_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}
