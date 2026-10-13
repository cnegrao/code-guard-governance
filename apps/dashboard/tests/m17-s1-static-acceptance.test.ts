import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * M17-S1 static acceptance over the migration and every new L15 source (O02, O17, O84, O88 static portions; ADR §24 "additive
 * only"). The PG17 suites (tests/postgres-m16/m17-s1-*.test.ts) prove the same properties on the real catalog.
 */
const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20261012210000_m17_s1_signals_hypotheses_support_v1.sql');
const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, ''); // SQL comments and COMMENT ON text are prose, not DDL
const l15Sources = [
  'packages/canonical-contracts/src/l15-signals-hypotheses.ts',
  ...readdirSync(new URL('packages/scanner/src/l15/', root)).map(f => `packages/scanner/src/l15/${f}`),
];

test('the S1 migration is additive: no DDL / DML on any pre-existing table, F2 untouched, l14 stores not widened', () => {
  assert.doesNotMatch(code, /\bALTER\s+TABLE\s+(?!gov_repo\.l15_)/i, 'ALTER TABLE only on new l15 tables');
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|FUNCTION|CONSTRAINT|TRIGGER|INDEX|POLICY)\b/i);
  assert.doesNotMatch(code, /\b(UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\./i, 'no row change on any store');
  assert.doesNotMatch(code, /INSERT\s+INTO\s+gov_repo\.(?!l15_)/i, 'writes only into L15 stores');
  assert.doesNotMatch(code, /REFERENCES\s+gov_repo\.canonical_relationships/i, 'no FK onto canonical_relationships (F2)');
  assert.doesNotMatch(code, /ON\s+gov_repo\.canonical_relationships/i, 'no trigger / index / policy on canonical_relationships');
  assert.doesNotMatch(code, /CREATE\s+(UNIQUE\s+)?INDEX[^;]*relationship_state_id[^;]*ON\s+gov_repo\.(?!l15_)/i);
  assert.doesNotMatch(code, /(ALTER\s+TABLE|INSERT\s+INTO|REFERENCES|FROM|JOIN)\s+gov_repo\.l14_support_links\b/i,
    'gov_repo.l14_support_links is neither reused nor widened (only named in the L15 table comment)');
  assert.doesNotMatch(code, /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT)/i);
  for (const created of code.matchAll(/CREATE\s+TABLE\s+gov_repo\.(\w+)/gi)) assert.match(created[1], /^l15_(risk_signals|risk_hypotheses|support_links)$/);
  assert.doesNotMatch(code, /l15_(risk_scenario|risk_methodolog|governed_risk|risk_assessment|risk_treatment|risk_acceptance)/i, 'no S2+ store');
  assert.doesNotMatch(code, /GRANT\s+[^;]*\bON\s+(TABLE\s+)?gov_repo\.l15_/i, 'no table grant on an L15 store');
});

test('O84 / O17: the support union has no json / array / free-text reference; no L15 amount / estimate / domain / rating column', () => {
  const links = /CREATE TABLE gov_repo\.l15_support_links \(([\s\S]*?)\n\);/.exec(migration)?.[1] ?? '';
  assert.ok(links.length > 0);
  assert.doesNotMatch(links, /\bjsonb?\b|\[\]|\bhstore\b/i);
  const tables = [...migration.matchAll(/CREATE TABLE gov_repo\.l15_\w+ \(([\s\S]*?)\n\);/g)].map(m => m[1]).join('\n');
  const columns = [...tables.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|numeric|timestamptz)/gm)].map(m => m[1]);
  assert.ok(columns.length > 40);
  for (const column of columns) {
    assert.doesNotMatch(column, /cost|amount|estimate|monthly|domain|rating|score|status_|lifecycle|title|description|category|(?<!hint_)severity$/,
      `forbidden L15 column ${column}`);
  }
  assert.ok(columns.includes('hint_severity') && columns.includes('hint_confidence'), 'source labels exist only as hint_*');
});

test('O88 static: no L15 code (migration, contracts, adapters) reads a legacy risk surface or field', () => {
  const legacy = /\b(risk_entries|risk_treatments|risk_level|ai_act_risk_class|agent_risk_propagation|risk_refs|residual_risk_level|inherent_risk_score|residual_risk_score|riskLevel|suggestedRiskLevel|aiActRiskClass|compute_governance_score)\b/;
  assert.doesNotMatch(code, legacy);
  for (const source of l15Sources) {
    const body = read(source).replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(body, legacy, source);
    assert.doesNotMatch(body, /from\s+['"][^'"]*(legacy-risk|risk-propagation|repositories\/(risks|agents))['"]/, source);
  }
});

test('the scanner adapters can only emit DETECTED_PATTERN / DETECTED_ABSENCE and never map category -> domain', () => {
  const adapter = read('packages/scanner/src/l15/detected-risk-signal-adapter.ts').replace(/\/\*\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(adapter, /risk\.category/, 'category is never read');
  assert.doesNotMatch(adapter, /risk\.cgagControl/, 'cgagControl is informational only');
  assert.doesNotMatch(adapter, /L15_RISK_DOMAINS|riskDomain|domain:/);
  const kinds = new Set([...adapter.matchAll(/signalKind: '([A-Z_]+)'/g)].map(m => m[1]));
  assert.deepEqual([...kinds].sort(), ['DETECTED_ABSENCE', 'DETECTED_PATTERN']);
  const finops = read('packages/scanner/src/l15/finops-signal-adapter.ts').replace(/\/\*\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(finops, /monthlyCostEstimate|estimatedMonthly|costRisk|breakdown|costHotspots/, 'no estimate is read');
});

test('S1R1 corrective is additive and never touches the frozen Discovery Machine boundary or any store', () => {
  const r1 = read('supabase/migrations/20261012220000_m17_s1r1_machine_intake_login_closure_v1.sql')
    .split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(r1, /(?<!l15_)machine_role_safe_v1|govia_discovery_|machine_principals|machine_execution_bindings/, 'discovery boundary untouched');
  assert.doesNotMatch(r1, /CREATE\s+(TABLE|VIEW|SEQUENCE|ROLE)|ALTER\s+TABLE|DROP\s+|\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\./i);
  assert.doesNotMatch(r1, /SECURITY\s+DEFINER/i, 'no new definer');
  assert.doesNotMatch(r1, /GRANT\s+/i, 'no privilege granted');
  const replaced = [...r1.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(gov_repo\.\w+)/gi)].map(m => m[1]).sort();
  assert.deepEqual(replaced, ['gov_repo.l15_machine_role_safe_v1', 'gov_repo.l15_require_machine_intake_identity_v1']);
});
