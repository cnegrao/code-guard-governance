import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerRepo } from './helpers/ledger-v2-foundation-fixtures';
import { a3Horizon, assertA3Horizon, assertManifest, historicalMigrations, manifestQuery, readManifestFixture } from './helpers/sr2-dependency-manifest';

test('H1 fixture compares both the complete document and the hash', () => {
  const fixture = readManifestFixture();
  assertManifest(fixture, fixture);
  const altered = structuredClone(fixture);
  altered.document.relations[0].owner = 'different_owner';
  assert.throws(() => assertManifest(altered, fixture), /complete canonical manifest document/);
  assert.throws(() => assertManifest({ ...fixture, sha256: '0'.repeat(64) }, fixture), /PostgreSQL JSONB text SHA-256/);
});
test('A3 exact historical horizon allows additive successors and rejects historical loss', () => {
  const names = readdirSync(join(ledgerRepo, 'supabase/migrations')).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort();
  const historical = assertA3Horizon(names);
  assert.equal(historical.at(-1), a3Horizon);
  assert.deepEqual(assertA3Horizon([...names, '20990101000000_hypothetical_successor.sql']), historical);
  assert.throws(() => assertA3Horizon(names.slice(1)), /horizon/);
  assert.throws(() => assertA3Horizon([...names.slice(1), '20990101000000_hypothetical_successor.sql']), /exactly 106/);
  assert.deepEqual(historicalMigrations(), readManifestFixture().migrations);
});
test('required legacy nullability, eligibility enums, vector implementation and default ACLs are explicit', () => {
  const { document } = readManifestFixture();
  const relation = (name: string) => document.relations.find(r => r.identity === `gov_repo.${name}`)!;
  assert.equal(relation('agents').columns.find((c: any) => c.name === 'description').not_null, true);
  assert.equal(relation('agents').columns.find((c: any) => c.name === 'business_domain').not_null, false);
  for (const name of ['agent_type', 'agent_status', 'system_status', 'ai_system_lifecycle', 'user_status'])
    assert.ok(document.enums.find(e => e.identity === `gov_repo.${name}`)?.labels.length, name);
  assert.equal(document.vector.schema, '__vector__');
  assert.equal(document.vector.version, '0.8.7');
  assert.equal(document.vector.cosine_operator.implementation, '__vector__.cosine_distance(__vector__.vector,__vector__.vector)');
  assert.ok(document.default_acls.some(d => d.schema === '__global__' && d.kind === 'f'));
  assert.ok(document.default_acls.some(d => d.schema === 'gov_repo' && d.kind === 'f'));
});
test('query controls deparsing and uses explicit bytewise aggregate ordering', () => {
  assert.match(manifestQuery, /SET LOCAL search_path = pg_catalog, pg_temp/);
  assert.match(manifestQuery, /SET LOCAL quote_all_identifiers = off/);
  assert.match(manifestQuery, /SET LOCAL standard_conforming_strings = on/);
  assert.match(manifestQuery, /sha256\(convert_to\(document::text,'UTF8'\)\)/);
  assert.doesNotMatch(manifestQuery, /ORDER BY 1\b/);
  assert.doesNotMatch(manifestQuery, /to_jsonb\([a-z]+\)/i);
});
