import type { SourceArtifactContent } from './source-adapter';

/** Scanner-only proof coordinates, never an endpoint or semantic identity. */
export interface BehaviorDeclarationBinding {
  readonly method: 'DIRECT_AGENT_PROPERTY_V1';
  readonly agentDeclarationKey: string;
  readonly agentMarkerLine: number;
}

const marker = /^\s*kind\s*[:=]\s*['"]agent['"]\s*,?\s*$/;
const model = /^\s*(?:MODEL_REFERENCE|modelReference)\s*[:=]/;
const tools = /^\s*tools\s*[:=]/;
const indent = (line: string) => line.length - line.trimStart().length;

/**
 * A deliberately restricted structural proof, independent of object detection.
 * Only flat top-level Python classes and JS/TS object declarations qualify.
 * Unknown body syntax, nested scopes and multiline lexical constructs fail
 * closed. In particular, a declaration elsewhere in the file proves nothing.
 * Object detectors still run unchanged even when this proof is unavailable.
 */
export function findBehaviorDeclarationBinding(
  artifact: SourceArtifactContent,
  targetLine: number,
): BehaviorDeclarationBinding | undefined {
  if (!/\.(?:py|ts|js)$/.test(artifact.locator)) return undefined;
  if (/'''|"""|`|\/\*|\*\/|\\\s*$/m.test(artifact.text)) return undefined;
  const lines = artifact.text.split(/\r\n|\r|\n/);
  const python = artifact.locator.endsWith('.py');
  for (let start = 0; start < targetLine - 1; start += 1) {
    const declaration = python
      ? /^class ([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(lines[start])
      : /^(?:export\s+)?const ([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{\s*$/.exec(lines[start]);
    if (!declaration) continue;
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || indent(lines[end]) > 0)) end += 1;
    if (!python && !/^\};?\s*$/.test(lines[end] ?? '')) continue;
    if (targetLine - 1 >= end) continue;
    const body = lines.slice(start + 1, end);
    const meaningful = body.filter((line) => line.trim() && !/^\s*(?:#|\/\/)/.test(line));
    if (!meaningful.length || !meaningful.every((line) => indent(line) === indent(meaningful[0]))) continue;
    // Complete single-line scalar/identifier/list assignments only. No calls,
    // methods, spreads, nested objects, decorators or executable statements.
    const assignment = python
      ? /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:'[^'\\]*'|"[^"\\]*"|[A-Za-z_][A-Za-z0-9_]*|\d+|\[\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*\])\s*$/
      : /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(?:'[^'\\]*'|"[^"\\]*"|[A-Za-z_$][A-Za-z0-9_$]*|\d+|\[\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*\])\s*,?\s*$/;
    if (!meaningful.every((line) => assignment.test(line))) continue;
    const markers = body.flatMap((line, index) => marker.test(line) ? [start + index + 2] : []);
    if (markers.length !== 1 || meaningful.filter((line) => model.test(line)).length > 1 ||
        meaningful.filter((line) => tools.test(line)).length > 1) continue;
    return Object.freeze({ method: 'DIRECT_AGENT_PROPERTY_V1', agentDeclarationKey: declaration[1], agentMarkerLine: markers[0] });
  }
  return undefined;
}
