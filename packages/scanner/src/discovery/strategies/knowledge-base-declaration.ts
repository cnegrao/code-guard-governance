import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const KNOWLEDGE_BASE_REFERENCE_PATTERN =
  /^\s*(?:KNOWLEDGE_BASE_REFERENCE|knowledgeBaseReference)\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects the explicit structural declaration
 * `KNOWLEDGE_BASE_REFERENCE = "..."` / `knowledgeBaseReference: "..."` naming
 * a retrievable knowledge resource this component is bound to. Deliberately
 * narrow: the bare word "memory" or a generic vector-store import is never
 * sufficient on its own — Memory and Knowledge Base are distinct concepts
 * (see agent-version-technical-signal-declaration.ts for Memory's own,
 * separate, non-canonical-object evidence lane) and this detector never
 * conflates them. Only this explicit declaration key counts as evidence.
 */
export class KnowledgeBaseDeclarationSpecification implements DetectionSpecification {
  readonly code = 'knowledge-base-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, KNOWLEDGE_BASE_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}
