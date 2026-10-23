// Complete offline field projection; no assurance evaluator or publication authority.
const scalar = v => v === null ? 'null' : String(v).replaceAll('|', '\\|');
function fields(v, depth = 0) {
  const pad = '  '.repeat(depth);
  const entries = Array.isArray(v) ? v.map((x, i) => [i + 1, x]) : Object.entries(v);
  if (!entries.length) return pad + '- (empty)\n';
  return entries.map(([k, x]) => x !== null && typeof x === 'object'
    ? `${pad}- **${k}**\n${fields(x, depth + 1)}`
    : `${pad}- **${k}:** ${scalar(x)}\n`).join('');
}
const table = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.map(scalar).join(' | ') + ' |')].join('\n');
export function renderClosure(d) {
  return [
    '# M17.5 V0 Readiness Pack — closure and publication-boundary review', '',
    '**' + d.closure_statement + '** is bounded to documentary completeness at the pinned Git snapshot. Overall M17.5 remains open. V1 is not started.', '',
    'No claim, gap, award, KPI or legacy source record is amended. External publication, a live product demonstration, tenant assurance and certification remain HOLD. INTERNAL_ONLY permits review of drafts and rejected wording with their labels; it does not authorize their affirmative use.', '',
    '## Separate decisions', '', table(['Decision', 'State'], Object.entries(d.decisions)), '',
    '## Closure matrix', '', table(['Dimension', 'State', 'Basis'], d.closure_matrix.map(x => [x.dimension, x.state, x.basis])), '',
    '## Gap impact summary', '', table(['Primary impact bucket', 'OPEN gaps'], Object.entries(d.gap_bucket_counts)), '',
    'Primary buckets are mutually exclusive routing metadata. Blocking effects are scope-dependent and may overlap. NO never closes the gap. A documentary review of a gap is distinct from demonstrating its dependent capability.', '',
    '## Claim publication boundary', '',
    table(['Claim class', 'Drafts', 'Eligibility', 'Internal', 'Controlled demo', 'External'], d.claim_classes.map(x => [x.claim_class, x.count, x.current_eligibility, x.internal_use, x.controlled_demo_use, x.external_publication])), '',
    'All 42 draft use states remain INTERNAL_ONLY. Rejected proposals are retained solely as negative review examples. No draft gains CONTROLLED_DEMO_ONLY or EXTERNAL_PUBLICATION_ELIGIBLE. A separately selected document excerpt may be reviewed for a controlled demonstration; that is not a claim approval or present product-demo clearance.', '',
    '## Copy-ready wording guide', '',
    table(['Category', 'Wording', 'Boundary'], d.wording_guide.map(x => [x.category, x.copy, x.boundary])), '',
    '## Legacy exposure gates', '',
    table(['Surface', 'Classification', 'Blocks documentary closure', 'Demo / external effect'], d.legacy_gates.map(x => [x.surface_id + ': ' + x.surface, x.classification, x.blocks_documentary_closure, x.blocks_controlled_demo + ' / ' + x.blocks_external_presentation])), '',
    '## V1 handoff — not started', '', d.v1_boundary, '',
    table(['Capability', 'Projection-only content', 'Additive work / prerequisites'], d.v1_prerequisites.map(x => [x.capability, x.projection_only, x.additive_work])), '',
    d.next_slice, '',
    '## Complete review metadata', '',
    'The following complete JSON field projection supplies exact versions, dependencies, every gap/claim/ceiling decision, source and legacy boundaries, wording and V1 prerequisites. JSON is the canonical review metadata; Markdown parity is deterministic.', '',
    fields(d).trimEnd(), '',
  ].join('\n');
}
