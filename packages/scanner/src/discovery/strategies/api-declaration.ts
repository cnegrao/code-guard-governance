import { CANONICAL_OBJECT_KIND, TRUST_STATE } from '@council/canonical-contracts';

import type { DetectionMatch, DetectionSpecification } from '../detection-specification';
import type { SourceArtifactContent } from '../source-adapter';

// Real-source convention, not invented by this milestone: the frozen Golden
// Repository `06-care-coordination/src/care_agent.py` (read, never
// modified) already declares an external API dependency exactly this way —
//   CARE_NETWORK_API = {
//       "id": "care-network-api",
//       "base_url": "https://care-network.invalid/v1/follow-ups",
//   }
// — and its own `.govia-lab/expected.json` documents `apiIdentity` as the
// object's own `"id"` field value and `methodCode: "EXTERNAL_API_REFERENCE"`.
// A bare URL literal anywhere else in source is never sufficient on its own
// (see the object-block requirement below): only an explicit `<NAME>_API`
// object literal carrying its own `"id"` field counts as evidence.
const API_OBJECT_OPEN_PATTERN = /^(\s*)(?:export\s+)?(?:const|let|var)?\s*[A-Za-z_][A-Za-z0-9_]*_API\s*[:=]\s*\{\s*$/;
const ID_FIELD_PATTERN = /^\s*["']?id["']?\s*[:=]\s*["']([^"']+)["']\s*,?\s*$/;

/**
 * Detects a `<NAME>_API = { ... "id": "..." ... }` object-literal block and
 * promotes only its explicit `id` field value to identity — never the base
 * URL, never the object's own variable name. Fails closed (no candidate) if
 * the block never closes within the artifact, or if it contains zero or
 * more than one `id` field (ambiguous).
 */
export class ApiDeclarationSpecification implements DetectionSpecification {
  readonly code = 'EXTERNAL_API_REFERENCE';
  readonly version = '1.0.0';
  readonly candidateKind = CANONICAL_OBJECT_KIND.API;

  isSatisfiedBy(artifact: SourceArtifactContent): readonly DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    const lines = artifact.text.split(/\r\n|\r|\n/);

    for (let openIndex = 0; openIndex < lines.length; openIndex += 1) {
      const openMatch = API_OBJECT_OPEN_PATTERN.exec(lines[openIndex]);
      if (!openMatch) continue;
      const baseIndent = openMatch[1].length;

      let closeIndex = -1;
      const idValues: string[] = [];
      for (let i = openIndex + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (new RegExp(`^\\s{0,${baseIndent}}\\}\\s*,?\\s*$`).test(line)) {
          closeIndex = i;
          break;
        }
        const idMatch = ID_FIELD_PATTERN.exec(line);
        if (idMatch) idValues.push(idMatch[1]);
      }

      if (closeIndex === -1 || idValues.length !== 1) continue;

      matches.push({
        displayValue: idValues[0],
        lineStart: openIndex + 1,
        lineEnd: closeIndex + 1,
        excerpt: lines.slice(openIndex, closeIndex + 1).join(' ').trim().slice(0, 200),
        confidence: 0.75,
        // The object's own explicit `id` field is a semantically
        // authoritative declaration position within this convention, not a
        // scanner inference from prose or an arbitrary URL.
        trustState: TRUST_STATE.DECLARED,
      });
    }

    return matches;
  }
}
