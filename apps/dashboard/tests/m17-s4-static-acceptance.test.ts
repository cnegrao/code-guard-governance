import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * M17-S4 static acceptance over the INHERENT RISK_ASSESSMENT migration and every new S4 source (ADR §24 "additive only";
 * O31-O37 static portions; no seed; no machine grant; no SET CONSTRAINTS; no score / band parameter / free text / JSON; no
 * legacy risk source; no LLM / scanner / graph / vector path; no route / UI). The PG17 suites
 * (tests/postgres-m16/m17-s4-*.test.ts) prove the same properties on the real catalog.
 */
const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const S3R1 = '20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql';
const S4 = '20261013160000_m17_s4_inherent_risk_assessment_v1.sql';
const migration = read(`supabase/migrations/${S4}`);
const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
const sources = [
  'packages/canonical-contracts/src/l15-risk-assessment.ts',
  'packages/governance-review/src/l15-risk-assessment.ts',
  'apps/dashboard/lib/governance/l15-risk-assessment-persistence.ts',
];
const LEGACY = /risk_entries|risk_treatments|risk_status|risk_category|risk_level|ai_act_risk_class|inherent_risk_score|residual_risk_score|risk_appetite|agent_risk_propagation|compute_governance_score|getCGAGScore|CG_AG_CONTROLS|heatmap/i;

test('static: S4 directly follows S3R1, followed only by S5; additive, hosted-free; edits no historical migration; seeds nothing', () => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => /^\d{14}_.*\.sql$/.test(n)).sort();
  assert.deepEqual(names.slice(names.indexOf(S3R1)), [S3R1, S4, '20261015122639_m17_s5_risk_treatment_v1.sql', '20261016021012_m17_s6_residual_risk_acceptance_v1.sql', '20261017020733_m17_s7a_read_projections_v1.sql', '20261019130000_m17_s7b_passport_risk_overlay_v1.sql', '20261019140000_m17_s7c_final_security_closure_v1.sql', '20261020031523_m17_s7d_adversarial_corrective_v1.sql']);
  assert.match(migration, /^-- M17-S4/);
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW|INDEX|ROLE)\b/i);
  // The only replaced routines are the owner-only S1 / S2 / S3 link guard and the S2 / S3 command-result state guard.
  const replaced = [...code.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+gov_repo\.(\w+)/gi)].map(m => m[1]).sort();
  assert.deepEqual(replaced, ['l15_command_result_state_guard_v1', 'l15_support_link_insert_guard_v1']);
  const outsideBodies = code.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '');
  assert.doesNotMatch(outsideBodies, /^\s*(DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?gov_repo|UPDATE\s+gov_repo\.)/im, 'no row rewritten or erased');
  assert.doesNotMatch(outsideBodies, /INSERT\s+INTO\s+gov_repo\./i, 'no seeded methodology / assessment / rule / role row');
  assert.doesNotMatch(code, /supabase\.co|vercel|hosted_/i);
  const dropped = [...code.matchAll(/DROP CONSTRAINT (\w+)/g)].map(m => m[1]!).sort();
  const added = new Set([...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map(m => m[1]));
  assert.deepEqual(dropped, ['l14_command_results_l15_state_check', 'l14_command_results_shape_check', 'l15_support_links_owner_kind_check',
    'l15_support_links_owner_shape_check', 'l15_support_links_owner_target_matrix_check']);
  for (const name of dropped) assert.ok(added.has(name), name);
  // M16 / F2 / S2 / S3 stores are never altered; the only shared-envelope table touched is l14_command_results.
  assert.doesNotMatch(code, /ALTER\s+TABLE\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|l14_authority_\w+|canonical_\w+|agents|l15_governed_risk_\w+|l15_risk_methodolog\w+|l15_risk_scenario\w+|l15_risk_signals|l15_risk_hypotheses)\b/i);
  assert.equal([...code.matchAll(/ALTER TABLE gov_repo\.l14_\w+/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).join(','),
    'ALTER TABLE gov_repo.l14_command_results');
  assert.doesNotMatch(code, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|canonical_\w+|l15_governed_risk_\w+|l15_risk_methodolog\w+|l15_risk_scenario\w+)\b/i,
    'no M16 / F2 / S2 / S3 write anywhere (incl. routine bodies)');
  // F2 hard boundary: canonical_relationships is never named as a DDL / DML target.
  assert.doesNotMatch(code, /(ALTER|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(TABLE\s+)?gov_repo\.canonical_relationships/i);
});

test('static: no SET CONSTRAINTS; nothing granted to the machine capability; only the three RISK_ASSESSMENT RPCs reach service_role', () => {
  assert.doesNotMatch(code, /SET\s+CONSTRAINTS/i, 'the S2R1 root ALLOW guard fires naturally at COMMIT');
  assert.doesNotMatch(code, /GRANT[^;]*TO[^;]*govia_l15_machine_intake_caller/i);
  assert.doesNotMatch(code, /CREATE\s+ROLE|ALTER\s+ROLE/i, 'no new machine role, no role widening');
  const grants = [...code.matchAll(/GRANT EXECUTE ON FUNCTION([\s\S]*?)TO service_role;/g)].map(m => m[1]!);
  assert.equal(grants.length, 1);
  assert.deepEqual([...grants[0]!.matchAll(/gov_repo\.(l15_\w+)\(/g)].map(m => m[1]).sort(), ['l15_decide_risk_assessment_proposal_v1',
    'l15_read_risk_assessment_v1', 'l15_submit_risk_assessment_proposal_v1']);
  assert.doesNotMatch(code, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?gov_repo\./i, 'no table privilege');
  assert.doesNotMatch(code, /bootstrap[a-z_]*\s*\(/i, 'no L15 bootstrap');
  const definers = [...code.matchAll(/CREATE FUNCTION gov_repo\.(\w+)\(([\s\S]*?)\$\w*\$/g)].filter(m => /SECURITY DEFINER/.test(m[2]!));
  assert.deepEqual(definers.map(m => m[1]).sort(), ['l15_decide_risk_assessment_proposal_v1', 'l15_read_risk_assessment_v1',
    'l15_risk_assessment_commit_guard_v1', 'l15_submit_risk_assessment_proposal_v1']);
  for (const m of definers) {
    assert.match(m[2]!, /SET search_path = pg_catalog, pg_temp/, m[1]);
    assert.match(code, new RegExp(`ALTER FUNCTION gov_repo\\.${m[1]}\\([^)]*\\) OWNER TO postgres;`), `${m[1]} owned by postgres`);
  }
  // Dependency locks reuse the EXACT S3 / S2 advisory keys (no new namespace for dependencies) in SHARED mode.
  assert.match(code, /pg_advisory_xact_lock_shared\(pg_catalog\.hashtextextended\(\s*gov_repo\.frame_identity\(ARRAY\[p_organisation_id::text, 'l15-governed-risk-key-guard-v1'/);
  assert.match(code, /pg_advisory_xact_lock_shared\(pg_catalog\.hashtextextended\(\s*gov_repo\.frame_identity\(ARRAY\[p_organisation_id::text, 'l15-registry-subject-guard-v1', 'RISK_METHODOLOGY',\s*'VALIDATION:'/);
});

test('static: no score / band argument / free text / JSON / numeric in the S4 stores and RPCs; no legacy risk source read (O31, AH)', () => {
  const tables = [...code.matchAll(/CREATE TABLE gov_repo\.(l15_\w+) \(([\s\S]*?)\n\);/g)];
  assert.deepEqual(tables.map(t => t[1]).sort(), ['l15_risk_assessment_heads', 'l15_risk_assessment_proposals', 'l15_risk_assessment_states']);
  for (const [, name, body] of tables) {
    const columns = body!.split('\n').filter(l => !/^\s*CONSTRAINT\b/.test(l)).join('\n');
    assert.doesNotMatch(columns, /\b(score|weight|percent\w*|product|severity|confidence|title|description|rationale|label|owner_user\w*|domain)\b/i, name);
    assert.doesNotMatch(columns, /\b(jsonb?|numeric|real|double precision|integer|smallint|bigint|interval)\b/i, name);
    assert.doesNotMatch(columns, /\btext\[\]|uuid\[\]/i, `${name}: no array storage`);
  }
  // The RPCs take no band / score argument (the band is DB-derived from the pinned cell).
  const rpcs = [...code.matchAll(/CREATE FUNCTION gov_repo\.(l15_(?:submit|decide|read)_risk_assessment\w*)\(([\s\S]*?)\)\s*RETURNS/g)];
  assert.equal(rpcs.length, 3);
  for (const [, name, args] of rpcs) assert.doesNotMatch(args!, /p_\w*(band|score|weight|percent|rating|domain|subject|scenario)\w*/i, name);
  // The band is derived only through the exact cell lookup; no arithmetic over ordinals anywhere in S4.
  assert.doesNotMatch(code, /ordinal\s*[*+\/-]|[*+\/-]\s*\w*ordinal|\bavg\s*\(|percentile|\bsum\s*\(/i);
  assert.match(code, /FROM gov_repo\.l15_risk_methodology_rating_cells AS c\s*WHERE c\.organisation_id = p_organisation_id AND c\.methodology_version_id = p_methodology_version_id\s*AND c\.likelihood_level_code = p_likelihood_level_code AND c\.impact_level_code = p_impact_level_code/);
  const linkCols = [...code.matchAll(/ADD COLUMN (owner_risk_assessment_\w+) (\w+)/g)].map(m => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(linkCols, ['owner_risk_assessment_artifact:text', 'owner_risk_assessment_proposal_id:uuid', 'owner_risk_assessment_state_id:uuid']);
  // (The postflight's own legacy-surface regex is the only place those names may appear.)
  for (const src of [code.replace(/DO \$postflight\$[\s\S]*?\$postflight\$;/, ''), ...sources.map(read)]) {
    assert.doesNotMatch(src, LEGACY);
  }
  // Executable sets: LOCAL_HUMAN only; INHERENT only (RESIDUAL acknowledged as vocabulary, never executable in S4).
  assert.match(read(sources[0]!), /L15_RISK_ASSESSMENT_EXECUTABLE_SOURCE_CLASSES = \['LOCAL_HUMAN'\]/);
  assert.match(read(sources[0]!), /L15_RISK_ASSESSMENT_EXECUTABLE_BASES = \['INHERENT'\]/);
  assert.match(code, /CONSTRAINT l15_risk_assessment_states_basis_executable_check CHECK \(assessment_basis = 'INHERENT'\)/);
});

test('static: no LLM / scanner / graph / vector path; the persistence adapter is server-only and no route / UI consumes it in S4; S5 / S6 not started', () => {
  for (const src of sources) {
    assert.doesNotMatch(read(src), /anthropic|openai|llm|embedding|vector|neo4j|cypher|@council\/scanner/i, src);
  }
  const adapter = read('apps/dashboard/lib/governance/l15-risk-assessment-persistence.ts');
  assert.match(adapter, /^import "server-only";/);
  const walk = (dir: string): string[] => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(`${dir}${entry.name}/`))
      : /\.(ts|tsx)$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
  const consumers = [...walk('apps/dashboard/app/'), ...walk('apps/dashboard/components/')].filter(f => /l15-risk-assessment-persistence/.test(read(f)));
  assert.deepEqual(consumers, []);
  assert.doesNotMatch(code, /l15_risk_treatment|l15_risk_acceptance|RESIDUAL_ASSESSED|residual_eligibility/i, 'no S5 / S6 store or semantics');
});
