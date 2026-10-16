import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * M17-S3 static acceptance over the GOVERNED_RISK migration and every new S3 source (ADR §24 "additive only"; O22-O30 / O44
 * static portions; no seed; no machine grant; no SET CONSTRAINTS; no score / free text / JSON; no route / UI). The PG17 suites
 * (tests/postgres-m16/m17-s3-*.test.ts) prove the same properties on the real catalog.
 */
const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const S3 = '20261013140000_m17_s3_governed_risk_v1.sql';
const S3R1 = '20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql';
// Horizon: each later slice extends this exact list (never a wildcard).
const S4 = '20261013160000_m17_s4_inherent_risk_assessment_v1.sql';
const migration = read(`supabase/migrations/${S3}`);
const code = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
const sources = [
  'packages/canonical-contracts/src/l15-governed-risk.ts',
  'packages/governance-review/src/l15-governed-risk.ts',
  'apps/dashboard/lib/governance/l15-governed-risk-persistence.ts',
];

test('static: S3 is followed only by S3R1, S4 and S5; additive, hosted-free; edits no historical migration; seeds nothing', () => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => /^\d{14}_.*\.sql$/.test(n)).sort();
  assert.deepEqual(names.slice(names.indexOf(S3) - 1), ['20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql', S3, S3R1, S4, '20261015122639_m17_s5_risk_treatment_v1.sql', '20261016021012_m17_s6_residual_risk_acceptance_v1.sql']);
  assert.match(migration, /^-- M17-S3/);
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW|INDEX|ROLE)\b/i);
  // The only replaced routines are the owner-only S1 / S2 link guard and the S2 command-result state guard (S1 / S2 branches
  // restated verbatim; the S3 branch added).
  const replaced = [...code.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+gov_repo\.(\w+)/gi)].map(m => m[1]).sort();
  assert.deepEqual(replaced, ['l15_command_result_state_guard_v1', 'l15_support_link_insert_guard_v1']);
  const outsideBodies = code.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '');
  assert.doesNotMatch(outsideBodies, /^\s*(DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?gov_repo|UPDATE\s+gov_repo\.)/im, 'no row rewritten or erased');
  assert.doesNotMatch(outsideBodies, /INSERT\s+INTO\s+gov_repo\./i, 'no seeded risk / scenario / rule / role row');
  assert.doesNotMatch(code, /supabase\.co|vercel|hosted_/i);
  // Every dropped constraint is re-added under the same name (widening only).
  const dropped = [...code.matchAll(/DROP CONSTRAINT (\w+)/g)].map(m => m[1]!).sort();
  const added = new Set([...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map(m => m[1]));
  assert.deepEqual(dropped, ['l14_command_results_l15_state_check', 'l14_command_results_shape_check', 'l15_support_links_owner_kind_check',
    'l15_support_links_owner_shape_check', 'l15_support_links_owner_target_matrix_check']);
  for (const name of dropped) assert.ok(added.has(name), name);
  // M16 / F2 stores are never altered; the only shared-envelope table touched is l14_command_results (result-shape widening).
  assert.doesNotMatch(code, /ALTER\s+TABLE\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|l14_authority_\w+|canonical_\w+|agents)\b/i);
  assert.equal([...code.matchAll(/ALTER TABLE gov_repo\.l14_\w+/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).join(','),
    'ALTER TABLE gov_repo.l14_command_results');
  assert.doesNotMatch(code, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+gov_repo\.(l14_fact_states|l14_registry_states|l14_support_links|canonical_\w+)\b/i,
    'no M16 / F2 write anywhere (incl. routine bodies)');
});

test('static: no SET CONSTRAINTS; nothing granted to the machine capability; only the three GOVERNED_RISK RPCs reach service_role', () => {
  assert.doesNotMatch(code, /SET\s+CONSTRAINTS/i, 'the S2R1 root ALLOW guard fires naturally at COMMIT');
  assert.doesNotMatch(code, /GRANT[^;]*TO[^;]*govia_l15_machine_intake_caller/i);
  assert.doesNotMatch(code, /CREATE\s+ROLE|ALTER\s+ROLE/i, 'no new machine role, no role widening');
  const grants = [...code.matchAll(/GRANT EXECUTE ON FUNCTION([\s\S]*?)TO service_role;/g)].map(m => m[1]!);
  assert.equal(grants.length, 1);
  assert.deepEqual([...grants[0]!.matchAll(/gov_repo\.(l15_\w+)\(/g)].map(m => m[1]).sort(), ['l15_decide_governed_risk_proposal_v1',
    'l15_read_governed_risk_v1', 'l15_submit_governed_risk_proposal_v1']);
  assert.doesNotMatch(code, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?gov_repo\./i, 'no table privilege');
  assert.doesNotMatch(code, /bootstrap[a-z_]*\s*\(/i, 'no L15 bootstrap');
  // Every SECURITY DEFINER is pinned to pg_catalog, pg_temp and owned by postgres.
  const definers = [...code.matchAll(/CREATE FUNCTION gov_repo\.(\w+)\(([\s\S]*?)\$\w*\$/g)].filter(m => /SECURITY DEFINER/.test(m[2]!));
  assert.deepEqual(definers.map(m => m[1]).sort(), ['l15_decide_governed_risk_proposal_v1', 'l15_governed_risk_commit_guard_v1',
    'l15_read_governed_risk_v1', 'l15_submit_governed_risk_proposal_v1']);
  for (const m of definers) {
    assert.match(m[2]!, /SET search_path = pg_catalog, pg_temp/, m[1]);
    assert.match(code, new RegExp(`ALTER FUNCTION gov_repo\\.${m[1]}\\([^)]*\\) OWNER TO postgres;`), `${m[1]} owned by postgres`);
  }
});

test('static: no score / likelihood / impact / rating / free text / JSON in the S3 stores; no legacy risk source read', () => {
  const tables = [...code.matchAll(/CREATE TABLE gov_repo\.(l15_\w+) \(([\s\S]*?)\n\);/g)];
  assert.deepEqual(tables.map(t => t[1]).sort(), ['l15_governed_risk_heads', 'l15_governed_risk_proposals', 'l15_governed_risk_states']);
  for (const [, name, body] of tables) {
    assert.doesNotMatch(body!, /\b(score|likelihood|impact|rating|weight|percent\w*|severity|title|description|rationale|label|owner_user\w*)\b/i, name);
    assert.doesNotMatch(body!, /\b(jsonb?|numeric|real|double precision)\b/i, name);
    assert.doesNotMatch(body!, /\btext\[\]|uuid\[\]/i, `${name}: no array-of-labels storage`);
  }
  // Support links gain only typed owner columns (no JSON / free text).
  const linkCols = [...code.matchAll(/ADD COLUMN (owner_governed_risk_\w+) (\w+)/g)].map(m => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(linkCols, ['owner_governed_risk_artifact:text', 'owner_governed_risk_proposal_id:uuid', 'owner_governed_risk_state_id:uuid']);
  // (The postflight's own legacy-surface regex is the only place those names may appear.)
  for (const src of [code.replace(/DO \$postflight\$[\s\S]*?\$postflight\$;/, ''), ...sources.map(read)]) {
    assert.doesNotMatch(src, /risk_entries|risk_treatments|risk_level|agent_risk_propagation|CG_AG_CONTROLS|getCGAGScore|compute_governance_score/);
  }
  // SOURCE_CONNECTION is dependency-deferred (M19): the executable source set is LOCAL_HUMAN only.
  assert.match(read(sources[0]!), /L15_GOVERNED_RISK_EXECUTABLE_SOURCE_CLASSES = \['LOCAL_HUMAN'\]/);
});

test('static: no LLM / scanner / graph / vector path; the persistence adapter is server-only and no route / UI consumes it in S3', () => {
  for (const src of sources) {
    assert.doesNotMatch(read(src), /anthropic|openai|llm|embedding|vector|neo4j|cypher|@council\/scanner/i, src);
  }
  const adapter = read('apps/dashboard/lib/governance/l15-governed-risk-persistence.ts');
  assert.match(adapter, /^import "server-only";/);
  const walk = (dir: string): string[] => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(`${dir}${entry.name}/`))
      : /\.(ts|tsx)$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
  const consumers = [...walk('apps/dashboard/app/'), ...walk('apps/dashboard/components/')].filter(f => /l15-governed-risk-persistence/.test(read(f)));
  assert.deepEqual(consumers, []);
});

test('static: S3R1 replaces only the two owner-only O44 projections (lineage union), touching no store, RPC, definer or grant', () => {
  const r1 = read(`supabase/migrations/${S3R1}`);
  const r1code = r1.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
    .replace(/COMMENT ON [^;]*?IS\s*'(?:[^']|'')*';/g, '');
  assert.match(r1, /^-- M17-S3R1/);
  assert.deepEqual([...r1code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi)].map(m => m[1]),
    ['gov_repo.l15_governed_risk_support_currency_v1', 'gov_repo.l15_governed_risk_support_summary_v1']);
  assert.doesNotMatch(r1code, /SECURITY\s+DEFINER|\bGRANT\b|\bREVOKE\b|SET\s+CONSTRAINTS|OWNER\s+TO/i);
  assert.doesNotMatch(r1code.replace(/CREATE TEMPORARY TABLE m17_s3r1_\w+ ON COMMIT DROP AS/g, ''),
    /CREATE\s+(TABLE|VIEW|SEQUENCE|ROLE|TRIGGER|INDEX)|ALTER\s+(TABLE|TRIGGER|ROLE|FUNCTION)|DROP\s+|\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gov_repo\./i,
    'no store, trigger, role, index, row or other routine touched');
  assert.doesNotMatch(r1code, /supabase\.co|vercel|hosted_/i);
  // The exact lineage membership: the three typed owners of the state's own proposal / decision / state.
  for (const owner of ["owner_governed_risk_artifact = 'PROPOSAL' AND l.owner_governed_risk_proposal_id = s.proposal_id",
    "owner_governed_risk_artifact = 'DECISION' AND l.owner_governance_decision_id = s.governance_decision_id",
    "owner_governed_risk_artifact = 'STATE' AND l.owner_governed_risk_state_id = s.state_id"]) {
    assert.ok(r1code.includes(owner), owner);
  }
  // The per-link target rules are reused verbatim (not replaced).
  assert.match(r1code, /gov_repo\.l15_support_link_target_failure_v1\(/);
  assert.doesNotMatch(r1code, /FUNCTION\s+gov_repo\.l15_support_link_target_failure_v1/);
});
