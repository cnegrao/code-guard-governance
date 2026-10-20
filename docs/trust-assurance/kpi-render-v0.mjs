// Offline metadata-to-Markdown rendering only. No KPI evaluation or data acquisition.
const scalar = value => value === null ? 'null' : String(value).replace(/\|/g, '\\|');
function fields(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}- (empty)\n`;
    return value.map(item => typeof item === 'object' && item !== null
      ? `${pad}- Record\n${fields(item, depth + 1)}` : `${pad}- ${scalar(item)}\n`).join('');
  }
  return Object.entries(value).map(([key, item]) => typeof item === 'object' && item !== null
    ? `${pad}- **${key}**\n${fields(item, depth + 1)}`
    : `${pad}- **${key}:** ${scalar(item)}\n`).join('');
}
export function renderFramework(doc) {
  const {definitions, ...contract} = doc;
  return '# Product / Customer KPI Framework V0\n\n'
    + 'M17.5-S4 defines what may be counted and how uncertainty must be retained. '
    + 'It supplies no evaluator and no KPI execution results. PRODUCT describes repository metadata; '
    + 'TENANT describes one future authorized customer scope. All six tenant definitions are DEFINITION_ONLY.\n\n'
    + 'Requirement with evidence != requirement satisfied != compliant. Governed decision count != '
    + 'decision quality or sufficiency. UNKNOWN != 0, false or NOT_APPLICABLE. Unknown currency is never STALE.\n\n'
    + 'PRODUCT_DOCUMENTARY_ONLY means an offline documentary predicate is specified; it is not an operationally executable service. '
    + 'Every definition below carries its population, grain, sources, predicate, temporal coordinates, uncertainty and lineage. '
    + 'The shared named rules are normative components of each referencing definition. '
    + 'The JSON is the canonical metadata; this complete rendering is parity-checked.\n\n'
    + '## Registry overview\n\n| KPI ID | Version | Scope | Type | Unit | Execution status |\n|---|---|---|---|---|---|\n'
    + definitions.map(k=>`| ${k.kpi_id} | ${k.kpi_version} | ${k.scope} | ${k.kpi_type} | ${k.unit} | ${k.execution_status} |`).join('\n')
    + '\n\n## Shared contracts, source pins and completeness\n\n' + fields(contract)
    + '\n## Exact versioned definitions\n\n'
    + definitions.map(k=>`### ${k.kpi_id} / ${k.kpi_version}\n\n${fields(k)}\n`).join('').trimEnd() + '\n';
}
