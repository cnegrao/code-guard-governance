import { CANONICAL_OBJECT_KIND } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Mirrors ToolListDeclarationSpecification (tool-list-declaration.ts)
// exactly, for the same reason: `skills = [...]` / `skills: [...]` is the
// explicit structural binding this Discovery Engine trusts, never a bare
// function definition, a generic import, or a filename containing "skill".
const SKILLS_ARRAY_LINE_PATTERN =
  /^\s*(?:export\s+)?(?:const\s+|readonly\s+)?["']?skills["']?\s*[:=]\s*\[\s*([^\]]*?)\s*\]\s*,?\s*$/;
const BARE_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Detects the structural declaration `skills = [...]` / `skills: [...]`
 * binding an Agent to the bare identifiers of the Skills it uses. A Skill is
 * a distinct canonical object from Tool (see contracts.ts's SkillTechnicalProfile
 * doc comment): a generic function, a Tool declaration, or a capability
 * mentioned in prose is never sufficient on its own — only this explicit
 * array-literal binding, using the `skills` key specifically (never `tools`),
 * counts as evidence.
 */
export class SkillListDeclarationSpecification implements DetectionSpecification {
  readonly code = 'skill-list-declaration';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.SKILL;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      const match = SKILLS_ARRAY_LINE_PATTERN.exec(line);
      if (!match) return;

      const rawItems = match[1]
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (rawItems.length === 0) return;
      if (!rawItems.every((item) => BARE_IDENTIFIER_PATTERN.test(item))) return;

      const lineNumber = index + 1;
      const excerpt = line.trim().slice(0, 200);
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
