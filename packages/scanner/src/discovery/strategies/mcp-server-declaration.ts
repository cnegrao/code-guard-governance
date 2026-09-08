import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';
import { scanLines } from './scan-lines';

const MCP_SERVER_REFERENCE_PATTERN =
  /^\s*(?:MCP_SERVER_REFERENCE|mcpServerReference)\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects the explicit structural declaration `MCP_SERVER_REFERENCE = "..."`
 * / `mcpServerReference: "..."` naming an MCP server this component is
 * bound to. Deliberately narrow: an `mcp`-related import/dependency alone,
 * or a Tool declaration, never implies an MCP_SERVER candidate — only this
 * explicit server-naming declaration does (mirrors the same
 * explicit-literal-declaration contract MODEL_REFERENCE already uses).
 */
export class McpServerDeclarationSpecification implements DetectionSpecification {
  readonly code = 'mcp-server-reference-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.MCP_SERVER;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    return scanLines(artifact.text, MCP_SERVER_REFERENCE_PATTERN, 0.6, (match) => match[1]);
  }
}
