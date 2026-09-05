import type { DetectionMatch } from '../detection-specification';

/**
 * Shared line-oriented scan used by the first-generation detection
 * specifications. Each specification supplies its own regular expression and
 * confidence; this only walks lines deterministically and builds the match.
 */
export function scanLines(
  text: string,
  pattern: RegExp,
  confidence: number,
  toDisplayValue: (match: RegExpMatchArray) => string,
): readonly DetectionMatch[] {
  const matches: DetectionMatch[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    const match = pattern.exec(line);
    if (!match) return;
    const lineNumber = index + 1;
    matches.push({
      displayValue: toDisplayValue(match),
      lineStart: lineNumber,
      lineEnd: lineNumber,
      excerpt: line.trim().slice(0, 200),
      confidence,
    });
  });

  return matches;
}
