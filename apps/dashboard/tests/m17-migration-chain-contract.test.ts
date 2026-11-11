import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  APPROVED_OPERATOR_INVITATION, APPROVED_E1_TECHNICAL_PROFILE, APPROVED_SEC01_TRANSACTIONAL_WORKSPACE,
  assertCanonicalMigrationSuffix, readApprovedMigrationBaseline,
  validateCanonicalChainWithE1Successors, validateCanonicalChainWithSec01Successor,
  validateCanonicalChainWithOperatorInvitation, validateCanonicalMigrationChain,
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

const invitationEntry = (): MigrationEntry => ({
  name: APPROVED_OPERATOR_INVITATION.name, kind: 'file',
  contents: readFileSync(new URL('../../../supabase/migrations/' + APPROVED_OPERATOR_INVITATION.name, import.meta.url), 'utf8'),
});

test('operational successor: exact approved invitation preserves the frozen checkpoint', () => {
  validateCanonicalChainWithOperatorInvitation([...entries(), invitationEntry()], fixture(), approved, approved[0]!.name);
});

test('operational successor: changed bytes, renamed entry and extra append remain rejected', () => {
  const valid = invitationEntry();
  rejects(() => validateCanonicalChainWithOperatorInvitation([...entries(), { ...valid, contents: valid.contents + '\nSELECT 1;' }], fixture(), approved, approved[0]!.name), /immutable receipt/);
  rejects(() => validateCanonicalChainWithOperatorInvitation([...entries(), { ...valid, name: '99991231235959_unapproved.sql' }], fixture(), approved, approved[0]!.name), /successor inventory/);
  rejects(() => validateCanonicalChainWithOperatorInvitation([...entries(), valid, valid], fixture(), approved, approved[0]!.name), /successor inventory/);
});

test('operational successor: missing invitation, non-file entry and historical mutation remain rejected', () => {
  rejects(() => validateCanonicalChainWithOperatorInvitation(entries(), fixture(), approved, approved[0]!.name), /successor inventory/);
  rejects(() => validateCanonicalChainWithOperatorInvitation([...entries(), { ...invitationEntry(), kind: 'symlink' }], fixture(), approved, approved[0]!.name), /regular file/);
  const historical = entries(); historical[0]!.contents += '\nSELECT 1;';
  rejects(() => validateCanonicalChainWithOperatorInvitation([...historical, invitationEntry()], fixture(), approved, approved[0]!.name), /historical migration mutation/);
});

const technicalEntry = (): MigrationEntry => ({ name: APPROVED_E1_TECHNICAL_PROFILE.name, kind: 'file',
  contents: readFileSync(new URL('../../../supabase/migrations/' + APPROVED_E1_TECHNICAL_PROFILE.name, import.meta.url), 'utf8') });
const e1Entries = () => [...entries(), invitationEntry(), technicalEntry()];
test('E1 successors: exact invitation and applied technical profile preserve the frozen checkpoint',()=>{
  validateCanonicalChainWithE1Successors(e1Entries(),fixture(),approved,approved[0]!.name);
});
test('E1 successors: missing, reordered, duplicate and unapproved entries are rejected',()=>{
  for(const actual of [[...entries(),invitationEntry()],[...entries(),technicalEntry(),invitationEntry()],
    [...e1Entries(),technicalEntry()],[...e1Entries(),{...technicalEntry(),name:'99991231235959_unapproved.sql'}]])
    rejects(()=>validateCanonicalChainWithE1Successors(actual,fixture(),approved,approved[0]!.name),/successor inventory/);
});
test('E1 successors: changed SQL and historical mutation cannot be self-authorized',()=>{
  const changed=e1Entries();changed.at(-1)!.contents+='\nSELECT 1;';
  rejects(()=>validateCanonicalChainWithE1Successors(changed,fixture(),approved,approved[0]!.name),/immutable receipt/);
  const historical=e1Entries();historical[0]!.contents+='\nSELECT 1;';
  rejects(()=>validateCanonicalChainWithE1Successors(historical,fixture(),approved,approved[0]!.name),/historical migration mutation/);
});
test('E1 successors: the technical SQL must be a regular file',()=>{
  for(const kind of ['directory','symlink','other'] as const){const actual=e1Entries();actual.at(-1)!.kind=kind;
    rejects(()=>validateCanonicalChainWithE1Successors(actual,fixture(),approved,approved[0]!.name),/regular file/);}
});
test('E1 successors: canonical SQL is byte-exact with the audited artifact and hosted application receipt',()=>{
  const name=APPROVED_E1_TECHNICAL_PROFILE.name;
  const canonical=readFileSync(new URL('../../../supabase/migrations/'+name,import.meta.url));
  const artifact=readFileSync(new URL('../../../ops/agent-version-profile-v1/'+name,import.meta.url));
  assert.deepEqual(canonical,artifact);
  assert.equal(createHash('sha256').update(canonical).digest('hex'),APPROVED_E1_TECHNICAL_PROFILE.sha256_lf);
  const receipt=JSON.parse(readFileSync(new URL('../../../docs/codex/evidence/2026-11-09-technical-profile-applied.json',import.meta.url),'utf8'));
  assert.equal(receipt.migration.version,name.slice(0,14));assert.equal(receipt.migration.sqlSha256,APPROVED_E1_TECHNICAL_PROFILE.sha256_lf);
  assert.equal(receipt.migration.historyAfter,101);assert.equal(receipt.migration.exactHistorySqlVerified,true);
});

const sec01Entry = (): MigrationEntry => ({
  name: APPROVED_SEC01_TRANSACTIONAL_WORKSPACE.name, kind: 'file',
  contents: readFileSync(new URL('../../../supabase/migrations/' + APPROVED_SEC01_TRANSACTIONAL_WORKSPACE.name, import.meta.url), 'utf8'),
});
const sec01Entries = () => [...e1Entries(), sec01Entry()];
const checkSec01 = (actual = sec01Entries(), frozen = fixture()) =>
  validateCanonicalChainWithSec01Successor(actual, frozen, approved, approved[0]!.name);

test('SEC-01 successor: exact SQL follows both E1 receipts without extending the frozen fixture', () => {
  const actual = sec01Entries();
  assert.deepEqual(actual.map(entry => entry.name), actual.map(entry => entry.name).sort());
  checkSec01(actual);
  checkSec01(actual.map(entry => ({ ...entry, contents: entry.contents!.replace(/\n/g, '\r\n') })));
});

test('SEC-01 successor: receipt matches the implemented SQL hash', () => {
  assert.equal(digest(sec01Entry().contents!), APPROVED_SEC01_TRANSACTIONAL_WORKSPACE.sha256_lf);
});

test('SEC-01 successor: changed SQL and either changed E1 receipt remain rejected', () => {
  for (let index = approved.length; index < sec01Entries().length; index++) {
    const actual = sec01Entries();
    actual[index]!.contents += '\nSELECT 1;';
    rejects(() => checkSec01(actual), /immutable receipt/);
  }
});

test('SEC-01 successor: omission or duplication of any successor remains rejected', () => {
  for (let index = approved.length; index < sec01Entries().length; index++) {
    const missing = sec01Entries(); missing.splice(index, 1);
    rejects(() => checkSec01(missing), /successor inventory/);
    const duplicate = sec01Entries(); duplicate.splice(index, 0, duplicate[index]!);
    rejects(() => checkSec01(duplicate), /successor inventory/);
  }
});

test('SEC-01 successor: every reordered successor permutation remains rejected', () => {
  const [invitation, technical, workspace] = sec01Entries().slice(approved.length);
  for (const reordered of [
    [invitation!, workspace!, technical!], [technical!, invitation!, workspace!],
    [technical!, workspace!, invitation!], [workspace!, invitation!, technical!],
    [workspace!, technical!, invitation!],
  ]) rejects(() => checkSec01([...entries(), ...reordered]), /successor inventory/);
});

test('SEC-01 successor: renamed SQL and unknown later successors remain rejected', () => {
  const unknown: MigrationEntry = { ...sec01Entry(), name: '99991231235959_unapproved.sql' };
  rejects(() => checkSec01([...e1Entries(), unknown]), /successor inventory/);
  rejects(() => checkSec01([...sec01Entries(), unknown]), /successor inventory/);
});

test('SEC-01 successor: non-file entries and missing contents remain rejected', () => {
  for (const kind of ['directory', 'symlink', 'other'] as const)
    rejects(() => checkSec01([...e1Entries(), { ...sec01Entry(), kind }]), /regular file/);
  rejects(() => checkSec01([...e1Entries(), { ...sec01Entry(), contents: undefined }]), /content required/);
});

test('SEC-01 successor: historical rewrite and frozen-manifest changes cannot self-authorize', () => {
  const actual = sec01Entries(); actual[0]!.contents += '\nSELECT 1;';
  rejects(() => checkSec01(actual), /historical migration mutation/);
  const regenerated = fixture(); regenerated.migrations[0]!.sha256_lf = digest(actual[0]!.contents!);
  rejects(() => checkSec01(actual, regenerated), /historical migration mutation/);
  const extended = fixture();
  extended.migrations.push({ name: sec01Entry().name, sha256_lf: APPROVED_SEC01_TRANSACTIONAL_WORKSPACE.sha256_lf });
  extended.document.horizon.through = sec01Entry().name;
  rejects(() => checkSec01(sec01Entries(), extended), /fixture mismatch/);
});
