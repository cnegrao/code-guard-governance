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
const S2R1 = '20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql';
const S3 = '20261013140000_m17_s3_governed_risk_v1.sql';
const S3R1 = '20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql';
const S4 = '20261013160000_m17_s4_inherent_risk_assessment_v1.sql';
const migration = read(`supabase/migrations/${S2}`);
const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
const sources = [
  'packages/canonical-contracts/src/l15-registries.ts',
  'packages/governance-review/src/l15-registries.ts',
  'apps/dashboard/lib/governance/l15-registry-persistence.ts',
];

test('static: S2 has exact ordered successors through S7D; additive, hosted-free; edits no historical migration; seeds nothing', () => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => /^\d{14}_.*\.sql$/.test(n)).sort();
  // Horizon: each later slice extends this exact list (never a wildcard).
  // Frozen M17-S7D baseline plus exactly the four authorized M17.5 successors.
  const expectedSuccessors = [S2, S2R1, S3, S3R1, S4, '20261015122639_m17_s5_risk_treatment_v1.sql', '20261016021012_m17_s6_residual_risk_acceptance_v1.sql', '20261017020733_m17_s7a_read_projections_v1.sql', '20261019130000_m17_s7b_passport_risk_overlay_v1.sql', '20261019140000_m17_s7c_final_security_closure_v1.sql', '20261020031523_m17_s7d_adversarial_corrective_v1.sql',
    '20261021030240_m175_v1_s1a1_1_tenant_ledger_v2_inactive.sql',
    '20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql',
    '20261021201316_m175_v1_s1a1_2b_ledger_v2_tenant_read.sql',
    '20261022142630_m175_c3_sr1_principal_bound_semantic_retrieval_v1.sql'];
  const assertSuccessors = (actual: string[]) => assert.deepEqual(actual, expectedSuccessors);
  assertSuccessors(names.slice(names.indexOf(S2)));
  assert.throws(() => assertSuccessors([...expectedSuccessors, '99991231235959_unapproved.sql']), assert.AssertionError);
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

test('static: S2R1 only re-declares the S0 ALLOW guard as an owner-only SECURITY DEFINER with the byte-identical S0 body', () => {
  const r1 = read(`supabase/migrations/${S2R1}`);
  const r1code = r1.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
  assert.match(r1, /^-- M17-S2R1/);
  const replaced = [...r1code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi)].map(m => m[1]);
  assert.deepEqual(replaced, ['gov_repo.l15_authorization_allow_guard_v1'], 'the only routine touched is the root guard');
  assert.match(r1code, /CREATE OR REPLACE FUNCTION gov_repo\.l15_authorization_allow_guard_v1\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp\s+AS \$guard\$/);
  assert.match(r1code, /ALTER FUNCTION gov_repo\.l15_authorization_allow_guard_v1\(\) OWNER TO postgres;/);
  assert.match(r1code, /REVOKE ALL ON FUNCTION gov_repo\.l15_authorization_allow_guard_v1\(\)\s+FROM PUBLIC, anon, authenticated, service_role, govia_l15_machine_intake_caller;/);
  assert.doesNotMatch(r1code, /\bGRANT\b/i, 'no privilege granted');
  // The only temporary objects are the preflight snapshots (CREATE TEMPORARY TABLE ... ON COMMIT DROP), compared in the postflight.
  assert.doesNotMatch(r1code.replace(/CREATE TEMPORARY TABLE m17_s2r1_\w+_snapshot ON COMMIT DROP AS/g, ''), /CREATE\s+(TABLE|VIEW|SEQUENCE|ROLE|TRIGGER|CONSTRAINT\s+TRIGGER)|ALTER\s+(TABLE|TRIGGER|ROLE)|DROP\s+|\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\./i,
    'no store, trigger, role or row touched');
  assert.doesNotMatch(r1code, /SET\s+CONSTRAINTS/i);
  assert.doesNotMatch(r1code, /supabase\.co|vercel|hosted_/i);
  // The guard body is the S0 body byte for byte (the semantic checks are unchanged; only the execution context moves).
  const s0 = read('supabase/migrations/20261012200000_m17_s0_authority_policy_l15_extension_v1.sql');
  const body = (sql: string, tag: string) => {
    const at = sql.indexOf('FUNCTION gov_repo.l15_authorization_allow_guard_v1()');
    const m = sql.slice(at).match(new RegExp(`AS \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
    assert.ok(m, `guard body (${tag})`);
    return m![1]!;
  };
  const s0Tag = s0.slice(s0.indexOf('FUNCTION gov_repo.l15_authorization_allow_guard_v1()')).match(/AS \$(\w*)\$/)![1]!;
  assert.equal(body(r1, 'guard'), body(s0, s0Tag));
});
