import { CANONICAL_OBJECT_KIND, TRUST_STATE } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Real-source convention, not invented by this milestone: the frozen Golden
// Repository `06-care-coordination/config/knowledge-base.yaml` (read, never
// modified) already declares a Knowledge Base exactly this way —
//   knowledge_base:
//     identity: approved-care-handbook
//     source: synthetic-guidance
//     mode: retrieval
// — and its own `.govia-lab/expected.json` documents `sourceIdentity` as
// the nested `identity` field's value, `sourcePath:
// "config/knowledge-base.yaml"`, and `methodCode: "KNOWLEDGE_BASE_CONFIG"`.
// Notably, that same fixture's Agent also carries an inline
// `knowledge_base = "approved-care-handbook"` field on the Agent class
// itself (`src/care_agent.py`) — the Golden Repository's own oracle does
// NOT treat that inline field as KNOWLEDGE_BASE evidence (its
// `sourcePath` points only at the YAML file), so this detector
// deliberately does not either: only the dedicated YAML config block
// counts, never a same-named field on an unrelated declaration. The bare
// word "memory" or a generic vector-store import is never sufficient on
// its own (Memory is a distinct, separate technical-profile signal — see
// framework-import-signal.ts / memory-import-signal.ts — never conflated
// with this canonical object).
const KNOWLEDGE_BASE_TOP_LEVEL_KEY_PATTERN = /^knowledge_base:\s*$/;
const IDENTITY_FIELD_PATTERN = /^(\s+)identity:\s*(\S+)\s*$/;

function leadingWhitespaceLength(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Detects a top-level `knowledge_base:` YAML block with a nested
 * `identity: <value>` field, promoting only that identity value —
 * never the block's `source`/`mode` fields, never an inline same-named
 * field elsewhere in a different file/declaration.
 */
export class KnowledgeBaseDeclarationSpecification implements DetectionSpecification {
  readonly code = 'KNOWLEDGE_BASE_CONFIG';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.KNOWLEDGE_BASE;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    for (let openIndex = 0; openIndex < lines.length; openIndex += 1) {
      if (!KNOWLEDGE_BASE_TOP_LEVEL_KEY_PATTERN.test(lines[openIndex])) continue;

      let identityLineIndex = -1;
      let identityValue: string | undefined;
      let blockEndIndex = openIndex;

      for (let i = openIndex + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        if (leadingWhitespaceLength(line) === 0) break; // dedent: block ended

        blockEndIndex = i;
        const identityMatch = IDENTITY_FIELD_PATTERN.exec(line);
        if (identityMatch) {
          identityLineIndex = i;
          identityValue = identityMatch[2];
        }
      }

      if (identityLineIndex === -1 || !identityValue) continue;

      matches.push({
        displayValue: identityValue,
        lineStart: openIndex + 1,
        lineEnd: Math.max(blockEndIndex + 1, identityLineIndex + 1),
        excerpt: lines[identityLineIndex].trim().slice(0, 200),
        confidence: 0.75,
        trustState: TRUST_STATE.DECLARED,
      });
    }

    return matches;
  }
}
