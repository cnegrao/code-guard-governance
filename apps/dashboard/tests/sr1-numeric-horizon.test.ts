import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { historicalMigrations, readManifestFixture } from './helpers/sr2-dependency-manifest';
import { m1Migration, m1Migrations, v2FixtureUrl } from './helpers/sr1-numeric-fixtures';

test('M1 H1 V2 fixture adds exactly one canonical migration to the frozen A3 horizon', () => {
  const v1 = readManifestFixture(); const v2 = JSON.parse(readFileSync(v2FixtureUrl, 'utf8'));
  assert.deepEqual(historicalMigrations(), v1.migrations);
  assert.deepEqual(v2.migrations.slice(0, -1), v1.migrations);
  assert.equal(v2.migrations.length, 107); assert.equal(v2.migrations.at(-1).name, m1Migration);
  assert.deepEqual(v2.migrations, m1Migrations(), 'V2 fixture binds exact historical and successor SQL contents');
  assert.equal(v2.document.manifest, 'GOVIA_SR2_DEPENDENCY_MANIFEST_V2');
  assert.deepEqual(v2.document.horizon, { canonical_migrations: 107, through: m1Migration });
});

test('H1 V2 preserves V1 dependencies and explicitly distinguishes its successor additions', () => {
  const v1 = readManifestFixture().document; const v2 = JSON.parse(readFileSync(v2FixtureUrl, 'utf8')).document;
  for (const routine of v1.routines) assert.deepEqual(v2.routines.find((r: any) => r.identity === routine.identity), routine);
  assert.equal(v2.routines.length, v1.routines.length + 1);
  assert.ok(v2.routines.find((r: any) => r.identity.startsWith('gov_repo.semantic_context_search_v1(')));
  for (const relation of v1.relations) {
    const successor = v2.relations.find((r: any) => r.identity === relation.identity);
    assert.ok(successor);
    const { persistence, rewrite_rules, parents, children, ...priorProperties } = successor;
    assert.deepEqual(priorProperties, relation);
    assert.equal(persistence, 'p'); assert.ok(Array.isArray(rewrite_rules)); assert.deepEqual(parents, []); assert.deepEqual(children, []);
  }
  assert.equal(v2.relations.length, v1.relations.length + 7);
  const defaults = (d: any) => d.schema === '__global__' && d.kind === 'S';
  assert.deepEqual(v1.default_acls.find(defaults)!.acl.map((a: any) => a.privilege), ['USAGE']);
  assert.deepEqual(v2.default_acls.find(defaults).acl.map((a: any) => a.privilege), ['SELECT', 'UPDATE', 'USAGE']);
  assert.equal(v2.runtime.postgres_major, 17); assert.equal(v2.runtime.encoding, 'UTF8');
  assert.equal(v2.runtime.collation, 'C'); assert.equal(v2.runtime.ctype, 'C');
});
