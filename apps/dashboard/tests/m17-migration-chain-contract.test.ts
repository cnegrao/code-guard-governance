import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  assertCanonicalMigrationSuffix, readApprovedMigrationBaseline, validateCanonicalMigrationChain,
  type FrozenDependencyManifest, type MigrationEntry,
} from './helpers/m17-canonical-migration-chain';

// All attacks are in memory. No test edits a repository migration or fixture.
const approved = [
  { name: '20261012200000_m17_s0_authority_policy_l15_extension_v1.sql', contents: '-- original\nSELECT 1;\n' },
  { name: '20261013120000_m17_s2_scenario_methodology_registries_v1.sql', contents: '-- additive successor\nSELECT 2;\n' },
];
const digest = (contents: string) => createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex');
const fixture = (): FrozenDependencyManifest => ({
  document: { horizon: { through: approved[1]!.name } },
  migrations: approved.map(({ name, contents }) => ({ name, sha256_lf: digest(contents) })),
});
const entries = (): MigrationEntry[] => approved.map(migration => ({ ...migration, kind: 'file' }));
const check = (actual = entries(), frozen = fixture(), anchor = approved[0]!.name) =>
  validateCanonicalMigrationChain(actual, frozen, approved, anchor);
const rejects = (run: () => void, message: RegExp) => assert.throws(run, error =>
  error instanceof assert.AssertionError && message.test(error.message));

test('migration chain: approved additive chain and every suffix pass, including CRLF worktrees', () => {
  for (const migration of approved) check(entries(), fixture(), migration.name);
  check(entries().map(entry => ({ ...entry, contents: entry.contents!.replace(/\n/g, '\r\n') })));
});

test('migration chain: unauthorized append fails the exact inventory control', () => {
  rejects(() => check([...entries(), { name: '99991231235959_unapproved.sql', kind: 'file', contents: 'SELECT 3;' }]), /inventory and order/);
});

test('migration chain: removal fails the exact inventory control', () => {
  rejects(() => check(entries().slice(1)), /inventory and order/);
});

test('migration chain: modified content fails historical immutability', () => {
  const altered = entries();
  altered[0]!.contents += '\n-- unauthorized rewrite';
  rejects(() => check(altered), /unauthorized historical migration mutation/);
});

test('migration chain: reorder fails the exact order control', () => {
  rejects(() => check(entries().reverse()), /inventory and order/);
});

test('migration chain: invalid suffix anchor fails for anchor absence', () => {
  rejects(() => check(entries(), fixture(), '20261012200001_missing.sql'), /anchor must exist/);
});

test('migration chain: fixture digest, inventory, order and horizon mismatches fail independently', () => {
  const wrongHash = fixture();
  wrongHash.migrations[0]!.sha256_lf = '0'.repeat(64);
  rejects(() => check(entries(), wrongHash), /fixture mismatch/);
  const missing = fixture();
  missing.migrations.pop();
  rejects(() => check(entries(), missing), /fixture mismatch/);
  const reordered = fixture();
  reordered.migrations.reverse();
  rejects(() => check(entries(), reordered), /fixture mismatch/);
  const horizon = fixture();
  horizon.document.horizon.through = approved[0]!.name;
  rejects(() => check(entries(), horizon), /fixture horizon/);
});

test('migration chain: coordinated historical rewrite and fixture regeneration cannot self-authorize', () => {
  const altered = entries();
  altered[0]!.contents += '\nGRANT ALL ON SCHEMA gov_repo TO PUBLIC;';
  const regenerated = fixture();
  regenerated.migrations[0]!.sha256_lf = digest(altered[0]!.contents!);
  rejects(() => check(altered, regenerated), /unauthorized historical migration mutation/);
});

test('migration chain: coordinated append and fixture extension cannot authorize a successor', () => {
  const extra = { name: '99991231235959_unapproved.sql', kind: 'file' as const, contents: 'SELECT 3;' };
  const extended = fixture();
  extended.migrations.push({ name: extra.name, sha256_lf: digest(extra.contents) });
  extended.document.horizon.through = extra.name;
  rejects(() => check([...entries(), extra], extended), /inventory and order/);
});

for (const name of ['.hidden.sql', '20261012200000.sql', '20261012200000_.sql', '20261012200000_UPPER.sql',
  '20261012200000_hidden.sql.bak', '2026101220000_short.sql', '20261012200000_bad-name.sql', 'README.md']) {
  test(`migration directory: rejects unexpected filename ${name}`, () => {
    rejects(() => check([...entries(), { name, kind: 'file', contents: '-- hidden or unexpected' }]), /invalid canonical migration filename/);
  });
}

for (const kind of ['directory', 'symlink', 'other'] as const) {
  test(`migration directory: rejects ${kind}, even with an approved SQL name`, () => {
    const actual = entries();
    actual[0]!.kind = kind;
    rejects(() => check(actual), /must be a regular file/);
  });
}

test('migration chain: immutable checkpoint objects are available and the real canonical chain passes', () => {
  const baseline = readApprovedMigrationBaseline();
  assert.equal(baseline.length, 109, 'approved M3 checkpoint inventory');
  assertCanonicalMigrationSuffix(baseline[0]!.name);
});
