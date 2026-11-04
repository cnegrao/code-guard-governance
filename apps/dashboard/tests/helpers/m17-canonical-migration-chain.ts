import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

type FrozenMigration = {
  name: string;
  sha256_lf: string;
};

type FrozenDependencyManifest = {
  document: {
    horizon: {
      through: string;
    };
  };
  migrations: FrozenMigration[];
};

const root = new URL('../../../../', import.meta.url);
const migrationsRoot = new URL('supabase/migrations/', root);
const frozen = JSON.parse(readFileSync(new URL('../fixtures/sr2-dependency-manifest-v4.json', import.meta.url), 'utf8')) as FrozenDependencyManifest;
const expectedNames = frozen.migrations.map(migration => migration.name);
const actualNames = readdirSync(migrationsRoot).filter(name => /^\d{14}_.*\.sql$/.test(name)).sort();

let catalogVerified = false;

const sha256Lf = (contents: string) => createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex');

/**
 * Pins every canonical migration identity and byte-normalized digest to the independently replayed
 * M17.5 M3 dependency manifest. Individual M17 tests select an exact suffix from that frozen chain;
 * an appended, removed, reordered, or modified migration therefore fails closed.
 */
export const assertCanonicalMigrationSuffix = (anchor: string) => {
  if (!catalogVerified) {
    assert.equal(frozen.document.horizon.through, expectedNames.at(-1), 'the frozen horizon must name the final migration');
    assert.deepEqual(actualNames, expectedNames, 'the canonical migration chain must match the frozen M17.5 M3 catalog');
    for (const migration of frozen.migrations) {
      assert.equal(
        sha256Lf(readFileSync(new URL(migration.name, migrationsRoot), 'utf8')),
        migration.sha256_lf,
        `${migration.name}: canonical LF-normalized identity changed`,
      );
    }
    catalogVerified = true;
  }

  const anchorIndex = expectedNames.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `${anchor}: anchor must exist in the frozen canonical chain`);
  assert.deepEqual(actualNames.slice(anchorIndex), expectedNames.slice(anchorIndex), `${anchor}: exact ordered successors`);
};
