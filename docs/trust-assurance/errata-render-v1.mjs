// Offline documentary projection only; no runtime claim or assurance evaluator.
function fields(value, depth = 0) {
  const pad = '  '.repeat(depth);
  const entries = Array.isArray(value) ? value.map((v, i) => [i + 1, v]) : Object.entries(value);
  if (!entries.length) return `${pad}- (empty)\n`;
  return entries.map(([key, v]) => v !== null && typeof v === 'object'
    ? `${pad}- **${key}**\n${fields(v, depth + 1)}`
    : `${pad}- **${key}:** ${String(v).replaceAll('|', '\\|')}\n`).join('');
}
export function renderErrata(d) {
  return [
    '# M17.5-V0-E1 — adversarial errata', '',
    '**M17.5 V0 READINESS PACK: CLOSED / PASS**. Overall M17.5: OPEN.', '',
    'Append-only interpretation of the owner-supplied external Claude Code review at the pinned V0 snapshot. Historical S0–S5 artifacts remain unchanged. These corrections do not remediate any runtime surface or approve any wording.', '',
    'Controlled demo, external publication, tenant assurance and certification remain HOLD. V1-S0 and M18 are not started.', '',
    'The historical S2 register contains 61 OPEN assurance gaps, not 61 total known issues. Presentation/exposure gates form a separate population. L01–L05 and LX01–LX07 are inherited, LX08_AUDIT_TRAIL is appended, and dormant PDF generators are appended under LX09_DORMANT_PDF_GENERATORS. L04 package compatibility inputs expand its scope without changing L04. These populations may overlap in subject matter and must not be summed into a deduplicated issue count.', '',
    'All 42 claim records remain INELIGIBLE and accessible INTERNAL_ONLY. Affirmative use is PROHIBITED for all 42 at this cutoff; the three rejected positive proposals remain negative review examples only. Record access is not permission to assert the wording. The historical PROHIBITED: 0 count is not an affirmative-use count.', '',
    'S2 capability_ceilings.current_claim_ceiling controls publication/use gating for all 38 capabilities. The five S1 alignment candidates remain historical mapping metadata, never effective external ceilings. Missing or inconsistent controlling inputs must fail closed.', '',
    'V1-A1 (known_population denominator hazard) and V1-A2 (read-hop authorization classification) remain UNRESOLVED mandatory V1-S0 acceptance inputs. E1 records them without deciding the architecture.', '',
    '## Complete errata metadata', '',
    'JSON is the canonical errata metadata. This complete field projection preserves finding provenance, immutable input blobs, scope, corrected interpretations and unresolved acceptance gates.', '',
    fields(d).trimEnd(), '',
  ].join('\n');
}
