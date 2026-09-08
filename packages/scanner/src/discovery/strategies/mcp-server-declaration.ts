import { CANONICAL_OBJECT_KIND, TRUST_STATE } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Real-source convention, not invented by this milestone: the frozen Golden
// Repository `04-mcp-not-agent/mcp.json` (read, never modified) already
// declares an MCP server exactly this way —
// `{ "serverIdentity": "synthetic-catalog-mcp", "entrypoint": "...", "tools": [...] }`
// — and its own `.govia-lab/expected.json` documents `serverIdentity` as
// the server's identity field, `sourcePath: "mcp.json"`, and
// `methodCode: "MCP_CONFIG"`. The path patterns below additionally reuse
// `packages/scanner/src/codeguard/agent-detector.ts`'s own pre-existing,
// already-shipped `CONFIG_DETECTORS` MCP path convention (`.mcp.json`,
// `mcp.json`, `claude_desktop_config.json`, `mcp_config.json`,
// `.vscode/mcp.json`) and its real `mcpServers`/`servers` dict-of-named-
// servers shape, since that is also a genuine, already-supported MCP
// configuration convention distinct from the Golden Repository's flat
// single-server shape — both are real, neither is fabricated for this PR.
const MCP_CONFIG_PATH_PATTERN =
  /(^|\/)(\.mcp\.json|mcp\.json|claude_desktop_config\.json|mcp_config\.json|\.vscode\/mcp\.json)$/i;

function lineNumberAtIndex(text: string, index: number): number {
  if (index < 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function excerptForLine(text: string, lineNumber: number): string {
  const lines = text.split(/\r\n|\r|\n/);
  return (lines[lineNumber - 1] ?? '').trim().slice(0, 200);
}

/**
 * Detects a real, structured MCP server configuration file (`mcp.json` and
 * its recognized filename variants). Fails closed on anything that is not
 * valid JSON, or valid JSON without either a `serverIdentity` string field
 * (Golden-Repository-shaped, one server per file) or an `mcpServers`/
 * `servers` object (legacy-shaped, named-server dictionary) — an
 * `mcp`-related import elsewhere in unrelated source code is never
 * sufficient on its own (that risk belongs to a different file entirely and
 * is never inspected by this path-scoped detector).
 */
export class McpServerDeclarationSpecification implements DetectionSpecification {
  readonly code = 'MCP_CONFIG';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.MCP_SERVER;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    if (!MCP_CONFIG_PATH_PATTERN.test(artifact.locator)) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.text);
    } catch {
      return [];
    }
    if (typeof parsed !== 'object' || parsed === null) return [];
    const record = parsed as Record<string, unknown>;

    const matches: DetectionMatch[] = [];

    if (typeof record.serverIdentity === 'string' && record.serverIdentity.trim().length > 0) {
      const identity = record.serverIdentity.trim();
      const index = artifact.text.indexOf('"serverIdentity"');
      const lineNumber = lineNumberAtIndex(artifact.text, index);
      matches.push({
        displayValue: identity,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        excerpt: excerptForLine(artifact.text, lineNumber),
        confidence: 0.9,
        trustState: TRUST_STATE.DECLARED,
      });
      return matches;
    }

    const namedServers = record.mcpServers ?? record.servers;
    if (typeof namedServers === 'object' && namedServers !== null) {
      for (const name of Object.keys(namedServers as Record<string, unknown>)) {
        const index = artifact.text.indexOf(`"${name}"`);
        const lineNumber = lineNumberAtIndex(artifact.text, index);
        matches.push({
          displayValue: name,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          excerpt: excerptForLine(artifact.text, lineNumber),
          confidence: 0.85,
          trustState: TRUST_STATE.DECLARED,
        });
      }
    }

    return matches;
  }
}
