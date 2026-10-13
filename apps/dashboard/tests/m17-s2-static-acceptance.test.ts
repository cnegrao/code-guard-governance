import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * M17-S2 static acceptance over the registry migration and every new S2 source (ADR §24 "additive only"; O02, O19-O21, O31,
 * O74, O76, O84 static portions; no seed rows; no machine grant; no route / UI). The PG17 suites
 * (tests/postgres-m16/m17-s2-*.test.ts) prove the same properties on the real catalog.
 */
const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const S2 = '20261013120000_m17_s2_scenario_methodology_registries_v1.sql';
const migration = read(`supabase/migrations/${S2}`);
const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
const sources = [
  'packages/canonical-contracts/src/l15-registries.ts',
  'packages/governance-review/src/l15-registries.ts',
  'apps/dashboard/lib/governance/l15-registry-persistence.ts',
];

test('static: S2 is the newest migration, additive, hosted-free; edits no historical migration; seeds nothing', () => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => /^\d{14}_.*\.sql$/.test(n)).sort();
  assert.equal(names.at(-1), S2);
  assert.match(migration, /^-- M17-S2/);
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW|INDEX|ROLE)\b/i);
  assert.doesNotMatch(code, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+gov_repo\.(?!l15_support_link_insert_guard_v1\b)/i,
    'the only replaced routine is the owner-only S1 link guard (S1 branches restated verbatim)');
  // Outside routine bodies (the only places a migration statement itself writes rows).
  const outsideBodies = code.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '');
  assert.doesNotMatch(outsideBodies, /^\s*(DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?gov_repo|UPDATE\s+gov_repo\.)/im, 'no row rewritten or erased');
  // No seed: no INSERT into any registry store outside RPC bodies (the migration ships no scenario / methodology row).
  assert.doesNotMatch(outsideBodies, /INSERT\s+INTO\s+gov_repo\.l15_/i, 'no seeded scenario / methodology / default methodology');
  assert.doesNotMatch(code, /supabase\.co|vercel|hosted_/i);
  // Every dropped constraint is re-added under the same name (widening only).
  const dropped = [...code.matchAll(/DROP CONSTRAINT (\w+)/g)].map(m => m[1]!).sort();
  const added = new Set([...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map(m => m[1]));
  assert.deepEqual(dropped, ['l14_command_results_shape_check', 'l15_support_links_owner_kind_check', 'l15_support_links_owner_shape_check',
    'l15_support_links_owner_target_matrix_check']);
  for (const name of dropped) assert.ok(added.has(name), name);
  // l14_fact_states / l14_registry_states / l14_support_links and M16 typed tables are never altered.
  assert.doesNotMatch(code, /ALTER\s+TABLE\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|l14_control_definition\w*|canonical_\w+|agents)\b/i);
  assert.equal([...code.matchAll(/ALTER TABLE gov_repo\.l14_\w+/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).join(','),
    'ALTER TABLE gov_repo.l14_command_results');
});

test('static: nothing is granted to the machine intake capability; only the six registry RPCs reach service_role', () => {
  assert.doesNotMatch(code, /GRANT[^;]*TO[^;]*govia_l15_machine_intake_caller/i);
  const grants = [...code.matchAll(/GRANT EXECUTE ON FUNCTION([\s\S]*?)TO service_role;/g)].map(m => m[1]!);
  assert.equal(grants.length, 1);
  assert.deepEqual([...grants[0]!.matchAll(/gov_repo\.(l15_\w+)\(/g)].map(m => m[1]).sort(), ['l15_admit_methodology_version_v1',
    'l15_admit_scenario_version_v1', 'l15_decide_methodology_proposal_v1', 'l15_decide_scenario_proposal_v1',
    'l15_submit_methodology_proposal_v1', 'l15_submit_scenario_proposal_v1']);
  assert.doesNotMatch(code, /bootstrap[a-z_]*\s*\(/i, 'no L15 bootstrap');
});

test('static: no score / weight / percentage / free text / JSON in the S2 stores; no legacy risk source read', () => {
  const tables = [...code.matchAll(/CREATE TABLE gov_repo\.(l15_\w+) \(([\s\S]*?)\n\);/g)];
  assert.equal(tables.length, 15);
  for (const [, name, body] of tables) {
    assert.doesNotMatch(body!, /\b(score|weight|percent\w*|product|title|description|rationale|label)\b/i, name);
    assert.doesNotMatch(body!, /\b(jsonb?|numeric|real|double precision|bigint)\b/i, name);
    assert.doesNotMatch(body!, /\btext\[\]|uuid\[\]/i, `${name}: no array-of-labels storage`);
  }
  for (const src of [code, ...sources.map(read)]) {
    assert.doesNotMatch(src, /risk_entries|risk_treatments|risk_level|agent_risk_propagation|CG_AG_CONTROLS|getCGAGScore/);
  }
});

test('static: the persistence adapter is server-only and no route / UI consumes it in S2', () => {
  const adapter = read('apps/dashboard/lib/governance/l15-registry-persistence.ts');
  assert.match(adapter, /^import "server-only";/);
  const walk = (dir: string): string[] => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(`${dir}${entry.name}/`))
      : /\.(ts|tsx)$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
  const consumers = [...walk('apps/dashboard/app/'), ...walk('apps/dashboard/components/')].filter(f => /l15-registry-persistence/.test(read(f)));
  assert.deepEqual(consumers, []);
});
