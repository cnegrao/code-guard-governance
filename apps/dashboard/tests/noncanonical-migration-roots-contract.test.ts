import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * M16-S1B.2R1 noncanonical-root quarantine contract. supabase/migrations is the ONLY Governance Core
 * migration authority; every other tracked SQL artifact that touches gov_repo, defines a SECURITY DEFINER
 * routine, or lives under a noncanonical migration root is hash-pinned and classified in
 * docs/architecture/m16-noncanonical-migration-roots.manifest.json. Nothing here edits those artifacts.
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(`${repo}${path}`, 'utf8');
const sha = (path: string) => createHash('sha256').update(readFileSync(`${repo}${path}`).toString('latin1').replace(/\r\n/g, '\n'), 'latin1').digest('hex');
interface Manifest {
  canonicalMigrationAuthority: string; noncanonicalRoots: string[]; quarantinedRoutines: string[];
  holds: Record<string, string>; files: Record<string, { sha256: string; root: string; conflicts: string[] }>;
}
const manifest: Manifest = JSON.parse(read('docs/architecture/m16-noncanonical-migration-roots.manifest.json'));
const R1 = 'supabase/migrations/20260930160000_m16_s1b2r1_definer_capability_surface_v1.sql';
const APPROVED = [
  'agent_compliance_gaps', 'agent_graph_traverse', 'agent_semantic_search', 'admit_runtime_observation', 'apply_review_transition_governed_v1',
  'l14_admit_authority_policy_version_v1', 'l14_admit_governance_party_v1', 'l14_decide_authority_policy_proposal_v1',
  'l14_decide_governance_party_proposal_v1', 'l14_submit_governance_party_proposal_v1', 'l14_submit_proposal_v1', 'ledger_append', 'ledger_verify',
  'materialize_object_reconciliation_governed_v1', 'materialize_relationship_reconciliation_governed_v1', 'read_runtime_observation_exact',
  'recompute_risk_propagation', 'record_authorized_reconciliation_governed_v1', 'record_cross_signal_comparison_result',
  'record_execution_field_decision_governed_v1', 'record_execution_snapshot', 'record_technical_field_decision_governed_v1',
].sort();

test('canonical migration authority: supabase/migrations holds only timestamped canonical files; no noncanonical root inside it', () => {
  assert.equal(manifest.canonicalMigrationAuthority, 'supabase/migrations');
  const canonical = readdirSync(`${repo}supabase/migrations`);
  assert.ok(canonical.length >= 69 && canonical.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)), 'only timestamped migrations');
  assert.ok(manifest.noncanonicalRoots.every(root => !root.startsWith('supabase/migrations')));
  for (const hold of ['S1B2-I1', 'S1B2-I2', 'S1B2-I3', 'S1B2-I4', 'S1B2-I5']) assert.ok(manifest.holds[hold], hold);
});

test('quarantined artifacts are exactly the manifest set and byte-identical (LF-normalized sha256)', () => {
  const tracked = execFileSync('git', ['ls-files', '*.sql'], { cwd: repo, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
    .filter(path => !path.startsWith('supabase/migrations/'));
  const inScope = tracked.filter(path => manifest.noncanonicalRoots.some(root => path === root || path.startsWith(root))
    || /gov_repo/i.test(read(path)) || /security\s+definer/i.test(read(path))).sort();
  assert.deepEqual(inScope, Object.keys(manifest.files).sort(), 'a new noncanonical gov_repo / definer SQL artifact needs an explicit manifest entry');
  for (const [path, entry] of Object.entries(manifest.files)) {
    assert.equal(sha(path), entry.sha256, `${path} changed without an explicit manifest update`);
    assert.ok(entry.root && Array.isArray(entry.conflicts), path);
  }
  for (const path of ['apps/dashboard/supabase-setup-8.2.sql', 'apps/extension/supabase/migrations/M008E_GOVERNANCE_LEDGER_ACTIVATION.sql',
    'graphos-complete/supabase/migrations/20260622_expose_gov_repo_bridge.sql', 'apps/extension/supabase/migrations/20240119020000_create_credits_table.sql']) {
    assert.ok(manifest.files[path]?.conflicts.length, `${path} carries its known Governance Core conflicts`);
  }
  assert.match(manifest.files['apps/dashboard/supabase-setup-8.2.sql'].conflicts.join(' '), /S1B2-I4/);
  assert.match(manifest.files['apps/extension/supabase/migrations/20240119020000_create_credits_table.sql'].conflicts.join(' '), /S1B2-I5/);
  assert.match(manifest.files['graphos-complete/supabase/migrations/20260622_expose_gov_repo_bridge.sql'].conflicts.join(' '), /S1B2-I3/);
  assert.match(manifest.files['apps/extension/supabase/migrations/M008E_GOVERNANCE_LEDGER_ACTIVATION.sql'].conflicts.join(' '), /NONCANONICAL_GOVERNANCE_ROOT_CONFLICT/);
});

test('the canonical R1 allowlist is exactly the 22 and never contains a quarantined routine', () => {
  const text = read(R1);
  for (const block of [text.slice(text.indexOf('DO $preflight$'), text.indexOf('$preflight$;')), text.slice(text.indexOf('DO $postflight$'), text.indexOf('$postflight$;'))]) {
    const approved = [...block.matchAll(/^\s+\('gov_repo\.([a-z0-9_]+)\(/gm)].map(match => match[1]).sort();
    assert.deepEqual(approved, APPROVED);
  }
  const quarantinedNames = manifest.quarantinedRoutines.map(name => name.replace(/^[a-z_]+\./, '').replace(/[ (].*$/, ''));
  for (const name of quarantinedNames.filter(name => name !== 'ledger_append')) assert.ok(!APPROVED.includes(name), name);
  assert.ok(manifest.quarantinedRoutines.includes('gov_repo.ledger_append(text,text,text,uuid,uuid,text,uuid,jsonb)'));
  assert.match(text, /DROP FUNCTION IF EXISTS gov_repo\.ledger_append\(text, text, text, uuid, uuid, text, uuid, jsonb\);/);
  assert.doesNotMatch(text.split(/\r?\n/).filter(line => !/^\s*--/.test(line)).join('\n'), /\bCASCADE\b/i);
});

test('the canonical ledger API is defined only by its canonical migration; redefinitions elsewhere are quarantined', () => {
  const definesLedger = (text: string) => /create\s+(or\s+replace\s+)?function\s+gov_repo\.ledger_append\s*\(/i.test(text);
  // ADR tenant-ledger-integrity-v2 permits this exact additive replacement only.
  // Whole-file LF hashes freeze the original definition and every successor statement,
  // including ACLs/config; the separate V2 PG suite proves actual behavior/catalog state.
  const original = '20260818003710_gov_repo_identity_and_ledger.sql';
  const successor = '20261021134359_m175_v1_s1a1_2a_ledger_v2_write_cutover.sql';
  const approved = [original, successor];
  const hashes = [
    '9b6ba4639abc6ff25d33792c904064f82bf90e8c0e3ea5ea67fca503b3631be0',
    'a29bc7d3d0fc81264ebddc177c0aaa9cc274a7bf605aab1f6d20a4f97833292d',
  ];
  const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  const definitions = readdirSync(`${repo}supabase/migrations`).sort()
    .map(name => ({ name, text: read(`supabase/migrations/${name}`) })).filter(entry => definesLedger(entry.text));
  const assertDefinitions = (actual: typeof definitions) => {
    assert.deepEqual(actual.map(entry => entry.name), approved, 'closed original/successor definition sources');
    actual.forEach((entry, index) => assert.equal(digest(entry.text), hashes[index], entry.name));
  };
  assertDefinitions(definitions);
  const sql = definitions[1].text.replace(/\r\n/g, '\n');
  const signature = 'gov_repo.ledger_append(character varying,text,character varying,uuid,uuid,inet,uuid,jsonb)';
  const expected = {
    acl: ['govia_ledger_executor=X/govia_ledger_executor', 'postgres=X/govia_ledger_executor'],
    kind: 'f', owner: 'govia_ledger_executor',
    config: ['search_path=pg_catalog, pg_temp', 'lock_timeout=5s'],
    sha256: 'cbbae64a240966fa61c4d182d7b56e49c1570ae4ba393642f053ffe9029e8252',
    signature, volatility: 'v', securityDefiner: true,
  };
  const receipt = JSON.parse(read('docs/codex/evidence/2026-10-21-m17.5-v1-s1a1-2a-catalog.json'));
  assert.deepEqual(receipt.migration, { path: `supabase/migrations/${successor}`, sha256LF: hashes[1] });
  assert.deepEqual(receipt.catalog.routines.find((routine: { signature: string }) => routine.signature === signature), expected);
  assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION gov_repo.ledger_append(
  p_event_type varchar,p_event_desc text,p_subject_type varchar,p_subject_id uuid,
  p_actor_user_id uuid,p_actor_ip inet,p_organisation_id uuid,p_payload jsonb)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='5s' AS $append$`));
  const body = sql.match(/AS \$append\$([\s\S]*?)\$append\$;/)?.[1];
  assert.ok(body, 'exact admitted append definition');
  assert.equal(digest(body), expected.sha256);
  // In-memory negatives never edit/apply a migration or weaken the legacy-root quarantine.
  assert.throws(() => assertDefinitions([...definitions, { name: '99991231235959_unapproved.sql', text: sql }]), assert.AssertionError);
  assert.throws(() => assertDefinitions([{ ...definitions[0], text: definitions[0].text + '\n-- rewrite' }, definitions[1]]), assert.AssertionError);
  for (const [label, altered] of Object.entries({
    identity: sql.replace('p_actor_ip inet', 'p_actor_ip text'),
    body: sql.replace('RETURN s;', 'RETURN NULL;'),
    owner: sql + `\nALTER FUNCTION ${signature} OWNER TO service_role;`,
    definer: sql.replace('VOLATILE SECURITY DEFINER', 'VOLATILE SECURITY INVOKER'),
    config: sql.replace('SET search_path=pg_catalog,pg_temp', 'SET search_path=public,pg_temp'),
    acl: sql + `\nGRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`,
  })) {
    assert.notEqual(altered, sql, label);
    assert.throws(() => assertDefinitions([definitions[0], { name: successor, text: altered }]), assert.AssertionError, label);
  }
  const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split(/\r?\n/)
    .filter(path => path && !path.startsWith('supabase/migrations/') && /\.(sql|ts|js|mjs|cjs|py)$/.test(path) && !path.startsWith('apps/dashboard/tests/'));
  const elsewhere = tracked.filter(path => definesLedger(read(path))).sort();
  assert.deepEqual(elsewhere, ['apps/dashboard/supabase-setup-8.2.sql', 'supabase/legacy-migrations/20260618-monolithic/20260618002000_gov_repo_identity_and_ledger.sql']);
  for (const path of elsewhere) assert.ok(manifest.files[path], path);
});
