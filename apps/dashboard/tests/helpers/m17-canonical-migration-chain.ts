import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Migration = { name: string; contents: string };
export type MigrationEntry = { name: string; kind: 'file' | 'directory' | 'symlink' | 'other'; contents?: string };
export type FrozenDependencyManifest = {
  document: { horizon: { through: string } };
  migrations: { name: string; sha256_lf: string }[];
};

// Owner-supplied PASS checkpoint for GOVIA_M17_5_CI_HARDENING_S1, never a moving ref.
// CI explicitly fetches this SHA; local/historical runs require this commit and its blobs.
// An unavailable object fails closed. Tests never fetch or regenerate an authority fixture.
export const APPROVED_MIGRATION_CHECKPOINT = '5cb86faa9130ec5df3429b69c8d87652b59000a6';
const root = new URL('../../../../', import.meta.url);
const migrationsRoot = new URL('supabase/migrations/', root);
const migrationName = /^\d{14}_[a-z0-9_]+\.sql$/;
const sha256Lf = (contents: string) => createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex');

/** Load identities and actual contents from immutable Git objects, independently of the live fixture. */
export const readApprovedMigrationBaseline = (): Migration[] => {
  const git = (args: string[], input?: string) => execFileSync('git', args, {
    cwd: fileURLToPath(root), input, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
  });
  try {
    const tree = git(['ls-tree', '-z', `${APPROVED_MIGRATION_CHECKPOINT}:supabase/migrations`])
      .toString('utf8').split('\0').filter(Boolean).map(entry => {
        const match = entry.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/);
        assert.ok(match, `approved migration tree: unexpected entry ${entry}`);
        return { oid: match[1]!, name: match[2]! };
      });
    assert.ok(tree.length > 0, 'approved migration tree must not be empty');
    const blobs = git(['cat-file', '--batch'], tree.map(entry => entry.oid).join('\n') + '\n');
    let offset = 0;
    const baseline = tree.map(({ oid, name }) => {
      const end = blobs.indexOf(10, offset);
      assert.ok(end >= offset, `${name}: missing Git blob header`);
      const header = blobs.subarray(offset, end).toString('utf8').match(/^([a-f0-9]{40}) blob (\d+)$/);
      assert.ok(header && header[1] === oid, `${name}: approved Git blob unavailable`);
      const size = Number(header[2]);
      offset = end + 1;
      const contents = blobs.subarray(offset, offset + size).toString('utf8');
      offset += size;
      assert.equal(blobs[offset++], 10, `${name}: truncated Git blob`);
      return { name, contents };
    });
    assert.equal(offset, blobs.length, 'approved Git blob stream must be exact');
    return baseline;
  } catch (cause) {
    throw new Error(`Approved migration checkpoint ${APPROVED_MIGRATION_CHECKPOINT} unavailable or invalid; fetch this exact commit and its blobs before running tests`, { cause });
  }
};

/** Pure validation: every direct entry is explicit; callers supply canonical lexical order. */
export const validateCanonicalMigrationChain = (
  actual: readonly MigrationEntry[], frozen: FrozenDependencyManifest,
  approved: readonly Migration[], anchor: string,
) => {
  const approvedNames = approved.map(migration => migration.name);
  assert.ok(approvedNames.length > 0 && approvedNames.every(name => migrationName.test(name)), 'approved migration names');
  assert.deepEqual(approvedNames, [...new Set(approvedNames)].sort(), 'approved migration order and uniqueness');
  for (const entry of actual) {
    assert.equal(entry.kind, 'file', `${entry.name}: canonical migration entry must be a regular file`);
    assert.match(entry.name, migrationName, `${entry.name}: invalid canonical migration filename`);
  }
  assert.deepEqual(actual.map(entry => entry.name), approvedNames, 'canonical migration inventory and order must match the approved Git checkpoint');
  actual.forEach((entry, index) => {
    assert.equal(typeof entry.contents, 'string', `${entry.name}: migration content required`);
    assert.equal(sha256Lf(entry.contents!), sha256Lf(approved[index]!.contents), `${entry.name}: unauthorized historical migration mutation`);
  });
  assert.deepEqual(frozen.migrations, approved.map(({ name, contents }) => ({ name, sha256_lf: sha256Lf(contents) })),
    'fixture mismatch against the approved Git migration checkpoint');
  assert.equal(frozen.document.horizon.through, approvedNames.at(-1), 'fixture horizon must name the approved final migration');
  const anchorIndex = approvedNames.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `${anchor}: anchor must exist in the approved canonical chain`);
  assert.deepEqual(actual.slice(anchorIndex).map(entry => entry.name), approvedNames.slice(anchorIndex), `${anchor}: exact ordered successors`);
};

export const assertCanonicalMigrationSuffix = (anchor: string) => {
  const actual: MigrationEntry[] = readdirSync(migrationsRoot, { withFileTypes: true }).map(entry => ({
    name: entry.name,
    kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'other',
    contents: entry.isFile() && migrationName.test(entry.name) ? readFileSync(new URL(entry.name, migrationsRoot), 'utf8') : undefined,
  }));
  actual.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const frozen = JSON.parse(readFileSync(new URL('../fixtures/sr2-dependency-manifest-v4.json', import.meta.url), 'utf8')) as FrozenDependencyManifest;
  validateCanonicalMigrationChain(actual, frozen, readApprovedMigrationBaseline(), anchor);
};
