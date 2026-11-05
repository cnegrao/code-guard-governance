import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerRepo, lit } from './ledger-v2-foundation-fixtures';

export const manifestId = 'GOVIA_SR2_DEPENDENCY_MANIFEST_V1';
export const a3Horizon = '20261026124744_m175_c3_sr2_a3_operational_semantic_context_v1.sql';
export const manifestFixtureUrl = new URL('../fixtures/sr2-dependency-manifest-v1.json', import.meta.url);
export const manifestQuery = readFileSync(new URL('./sr2-dependency-manifest-v1.sql', import.meta.url), 'utf8');
export interface DependencyManifest {
  document: {
    manifest: string; missing: string[];
    routines: Record<string, any>[]; relations: Record<string, any>[]; enums: Record<string, any>[];
    schemas: Record<string, any>[]; vector: Record<string, any>; default_acls: Record<string, any>[];
  };
  sha256: string;
}
export interface ManifestFixture extends DependencyManifest {
  migrations: { name: string; sha256_lf: string }[];
}

/** Historical content is verified independently of how many additive successors exist. */
export function historicalMigrations() {
  const directory = join(ledgerRepo, 'supabase/migrations');
  return readdirSync(directory).filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n) && n <= a3Horizon).sort()
    .map(name => ({ name, sha256_lf: createHash('sha256').update(readFileSync(join(directory, name), 'utf8').replaceAll('\r', '')).digest('hex') }));
}
export function assertA3Horizon(names: readonly string[]) {
  assert.ok(names.length >= 106, 'current repository horizon must be >=106');
  const historical = names.filter(n => n <= a3Horizon);
  assert.equal(historical.length, 106, 'A3 canonical horizon is exactly 106');
  assert.equal(historical.at(-1), a3Horizon);
  return historical;
}
export function readManifestFixture(): ManifestFixture {
  return JSON.parse(readFileSync(manifestFixtureUrl, 'utf8'));
}
export function assertManifest(actual: DependencyManifest, expected: DependencyManifest) {
  assert.equal(actual.document.manifest, manifestId);
  assert.deepEqual(actual.document.missing, [], 'required dependencies must all resolve');
  assert.deepEqual(actual.document, expected.document, 'complete canonical manifest document');
  assert.equal(actual.sha256, expected.sha256, 'PostgreSQL JSONB text SHA-256');
}
export async function collectManifest(owner: (sql: string) => Promise<string>, prefix = '', rollback = false): Promise<DependencyManifest> {
  const result = JSON.parse(await owner(`BEGIN${prefix ? '' : ' READ ONLY'};${prefix}\n;\n${manifestQuery}\n${rollback ? 'ROLLBACK' : 'COMMIT'};`));
  assert.equal(result.document.manifest, manifestId);
  assert.deepEqual(result.document.missing, []);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  return result;
}
/** Rehash a fixture with PostgreSQL, never JSON.stringify's different serialization. */
export const rehashDocumentSql = (document: unknown) =>
  `SELECT encode(sha256(convert_to((${lit(JSON.stringify(document))}::jsonb)::text,'UTF8')),'hex')`;
