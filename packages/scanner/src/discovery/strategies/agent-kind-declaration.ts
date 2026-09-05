import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const KIND_AGENT_PATTERN = /^\s*["']?kind["']?\s*[:=]\s*["']agent["']\s*,?\s*$/i;

/**
 * Detects the structural self-declaration `kind = "agent"` /
 * `kind: "agent"` used across the Discovery Validation Lab's golden
 * repositories to mark a class or object as an Agent. Purely syntactic: it
 * proves nothing about runtime behavior, only that the source declares this
 * shape.
 */
export class AgentKindDeclarationSpecification implements DetectionSpecification {
  readonly code = 'agent-kind-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, KIND_AGENT_PATTERN, 0.6, () => 'agent');
  }
}
