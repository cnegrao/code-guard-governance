import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

const KIND_AGENT_PATTERN = /^\s*["']?kind["']?\s*[:=]\s*["']agent["']\s*,?\s*$/i;
const PYTHON_CLASS_DECLARATION_PATTERN = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/;
const OBJECT_LITERAL_DECLARATION_PATTERN =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{\s*$/;

/**
 * Generic fallback value: proves only the structural `kind = "agent"` shape
 * described in this specification's own doc comment, never a real
 * identity. AgentCandidateNormalizationStrategy must never promote this
 * literal to proposedIdentity.
 */
export const AGENT_KIND_DECLARATION_GENERIC_VALUE = 'agent';

function leadingWhitespaceLength(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Walks backward from the `kind = "agent"` line to find the nearest
 * enclosing named declaration this structural marker sits inside — a Python
 * `class Name:` body, or a TypeScript/JavaScript `const name = { ... }`
 * object-literal body. Purely indentation-based (mirrors the file's own
 * formatting rather than parsing a real AST): deterministic, single-artifact
 * only (it never looks at any other file), and order-independent (the same
 * file text always yields the same result regardless of scan order).
 * Returns undefined when no such enclosing declaration is found — the
 * caller falls back to the generic "agent" literal for that case rather
 * than guessing.
 */
function findEnclosingDeclarationKey(lines: readonly string[], kindLineIndex: number): string | undefined {
  let boundaryIndent = leadingWhitespaceLength(lines[kindLineIndex] ?? '');

  for (let index = kindLineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) continue;
    const indent = leadingWhitespaceLength(line);
    if (indent >= boundaryIndent) continue;

    const classMatch = PYTHON_CLASS_DECLARATION_PATTERN.exec(line);
    if (classMatch) return classMatch[1];
    const objectMatch = OBJECT_LITERAL_DECLARATION_PATTERN.exec(line);
    if (objectMatch) return objectMatch[1];

    // A shallower, unrecognized line still narrows the enclosing boundary:
    // only a declaration strictly between this line and the kind-line can
    // still be "inside" it going forward.
    boundaryIndent = indent;
  }

  return undefined;
}

/**
 * Detects the structural self-declaration `kind = "agent"` /
 * `kind: "agent"` used across the Discovery Validation Lab's golden
 * repositories to mark a class or object as an Agent. Purely syntactic: it
 * proves nothing about runtime behavior, only that the source declares this
 * shape.
 *
 * When this structural marker sits inside a Python `class Name:` body or a
 * TypeScript/JavaScript `const name = {...}` object-literal body, the
 * enclosing declaration's own name is captured as the match's displayValue —
 * the same kind of explicit, already-in-source identifier MODEL/TOOL
 * detection promotes for their own kinds, never an inferred or humanized
 * label. When no such enclosing declaration is found, displayValue remains
 * the generic literal "agent" (see AGENT_KIND_DECLARATION_GENERIC_VALUE),
 * proving only the structural shape and carrying no derivable identity.
 */
export class AgentKindDeclarationSpecification implements DetectionSpecification {
  readonly code = 'agent-kind-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.AGENT;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const lines = artifact.text.split(/\r\n|\r|\n/);
    const matches: DetectionMatch[] = [];

    lines.forEach((line, index) => {
      if (!KIND_AGENT_PATTERN.test(line)) return;

      const declarationKey = findEnclosingDeclarationKey(lines, index);
      const lineNumber = index + 1;
      matches.push({
        displayValue: declarationKey ?? AGENT_KIND_DECLARATION_GENERIC_VALUE,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        excerpt: line.trim().slice(0, 200),
        confidence: 0.6,
      });
    });

    return matches;
  }
}
