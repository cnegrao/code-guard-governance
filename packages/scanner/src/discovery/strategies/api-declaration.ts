import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const API_REFERENCE_PATTERN =
  /^\s*(?:API_REFERENCE|apiReference)\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects the explicit structural declaration `API_REFERENCE = "..."` /
 * `apiReference: "..."` naming an external API dependency this component is
 * bound to. Deliberately narrow: a bare URL literal anywhere in the source
 * is never sufficient on its own — an arbitrary URL is not an API candidate
 * (L10 connectivity/network topology is explicitly out of scope for this
 * detector; see the milestone's API-discovery boundary). Only this explicit
 * declaration key counts as evidence.
 */
export class ApiDeclarationSpecification implements DetectionSpecification {
  readonly code = 'api-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.API;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, API_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}
