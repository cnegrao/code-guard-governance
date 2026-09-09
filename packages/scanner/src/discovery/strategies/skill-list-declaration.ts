import { CANONICAL_OBJECT_KIND, TRUST_STATE } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Real-source convention, not invented by this milestone: reuses
// `packages/scanner/src/codeguard/agent-detector.ts`'s own pre-existing,
// already-shipped `CONFIG_DETECTORS` path pattern for a Claude Code Skill —
// `.claude/skills/<name>/SKILL.md` — the same convention that legacy
// detector already treats as "definitive" (path-based, no content
// heuristic needed) with its own highest confidence tier. No Golden
// Repository fixture currently models SKILL (confirmed by inspection before
// implementation), so this real, externally-recognized Claude Code
// convention is the only defensible real-source pattern available for this
// object kind in this round — a generic function definition, a Tool
// declaration, or a capability mentioned in prose is never sufficient on
// its own; only this exact path shape counts as evidence.
const CLAUDE_SKILL_PATH_PATTERN = /(^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i;

/**
 * Detects the path convention `.claude/skills/<name>/SKILL.md`, promoting
 * the directory's own name to `proposedIdentity.declarationReference` — the
 * file's existence at this defined skill-directory path is itself the
 * declaration, exactly as `codeguard/agent-detector.ts` already treats it.
 */
export class SkillListDeclarationSpecification implements DetectionSpecification {
  readonly code = 'CLAUDE_SKILL_PATH';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.SKILL;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const match = CLAUDE_SKILL_PATH_PATTERN.exec(artifact.locator);
    if (!match) return [];

    const skillName = match[2];
    return [
      {
        displayValue: skillName,
        lineStart: 1,
        lineEnd: 1,
        excerpt: artifact.locator.slice(0, 200),
        confidence: 0.9,
        // A file's existence at this defined skill-directory path is
        // itself the declaration — a path convention, not a scanner
        // inference from content.
        trustState: TRUST_STATE.DECLARED,
      },
    ];
  }
}
