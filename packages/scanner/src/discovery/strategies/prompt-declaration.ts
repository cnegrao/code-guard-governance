import { CANONICAL_OBJECT_KIND, TRUST_STATE } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Real-source convention, not invented by this milestone: every Golden
// Repository fixture that already models a Prompt (01-simple-agent's
// `SUPPORT_PROMPT`, 02-multi-agent's `TRIAGE_PROMPT`/`BILLING_PROMPT`/
// `RETENTION_PROMPT`, 06-care-coordination's `CARE_PROMPT`) declares it as a
// module-level constant whose own name ends in `_PROMPT`, holding the
// prompt text as a string literal, and referenced elsewhere via
// `instructions = <NAME>_PROMPT` (a bare identifier, never re-matched by
// this pattern since it requires a quoted string immediately after `=`).
// The Golden Repositories' own `.govia-lab/expected.json` for each of these
// fixtures already documents `declarationKey` as the constant's own name
// (e.g. "SUPPORT_PROMPT") and `methodCode: "PROMPT_DECLARATION"` — this
// detector's `code` and identity-extraction rule match that pre-existing,
// independently-authored oracle exactly (read, never modified, per the
// milestone's Golden Repository boundary).
const PROMPT_CONSTANT_PATTERN =
  /^\s*(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_][A-Za-z0-9_]*_PROMPT)\s*=\s*["']([^"']*)["']\s*,?;?\s*$/;

/**
 * Detects a module-level `<NAME>_PROMPT = "..."` constant declaration. The
 * captured identifier (never the prompt string itself) is promoted to
 * `proposedIdentity.declarationKey` — raw prompt content never enters
 * identity, satisfying the milestone's "never leak prompt content"
 * requirement structurally, not by redaction after the fact.
 */
export class PromptDeclarationSpecification implements DetectionSpecification {
  readonly code = 'PROMPT_DECLARATION';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.PROMPT;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      const match = PROMPT_CONSTANT_PATTERN.exec(line);
      if (!match) return;
      const lineNumber = index + 1;
      matches.push({
        displayValue: match[1],
        lineStart: lineNumber,
        lineEnd: lineNumber,
        excerpt: line.trim().slice(0, 200),
        confidence: 0.7,
        // A named `_PROMPT` constant assignment is an explicit, semantically
        // authoritative declaration position (the same convention the
        // frozen Golden Repository oracle itself uses), not a scanner
        // inference from prose or a loose keyword.
        trustState: TRUST_STATE.DECLARED,
      });
    });

    return matches;
  }
}
