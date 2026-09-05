import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Matches a single-line `tools = [a, b]` / `tools: [a, b]` structural
// declaration, the shape the Discovery Validation Lab's golden repositories
// use to bind an Agent (or an MCP server) to the bare identifiers of the
// tools it exposes. Deliberately narrow: quoted string items (e.g. the JSON
// `"tools": ["a", "b"]` shape used for source-of-truth config rather than a
// code-level binding) never match, and neither does prose mentioning the
// word "tools".
const TOOLS_ARRAY_LINE_PATTERN =
  /^\s*(?:export\s+)?(?:const\s+|readonly\s+)?["']?tools["']?\s*[:=]\s*\[\s*([^\]]*?)\s*\]\s*,?\s*$/;
const BARE_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Detects the structural declaration `tools = [...]` / `tools: [...]` used
 * across the Discovery Validation Lab's golden repositories to explicitly
 * bind an Agent (or MCP server) to the bare identifiers of the tools it
 * uses. Syntactic and fail-closed only:
 *
 * - Every item inside the brackets must be a bare identifier. A single
 *   non-identifier item (a quoted string, a nested call, a spread) makes
 *   the whole declaration ambiguous and it is skipped entirely rather than
 *   partially trusted.
 * - A bare function definition elsewhere in the file, a generic import, or
 *   a filename containing "tool" is never sufficient on its own — only
 *   this explicit array-literal binding counts as evidence.
 * - A prose mention of "tools" never matches: the pattern requires the
 *   `tools` token to be the start of a `:`/`=` array-literal assignment.
 */
export class ToolListDeclarationSpecification implements DetectionSpecification {
  readonly code = 'tool-list-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.TOOL;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      const match = TOOLS_ARRAY_LINE_PATTERN.exec(line);
      if (!match) return;

      const rawItems = match[1]
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (rawItems.length === 0) return;
      if (!rawItems.every((item) => BARE_IDENTIFIER_PATTERN.test(item))) return;

      const lineNumber = index + 1;
      const excerpt = line.trim().slice(0, 200);
      // Dedupe identical identifiers repeated on the same declaration line
      // so a typo like `tools = [a, a]` never yields two candidates.
      const uniqueItems = Array.from(new Set(rawItems));

      for (const item of uniqueItems) {
        matches.push({
          displayValue: item,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          excerpt,
          confidence: 0.6,
        });
      }
    });

    return matches;
  }
}
