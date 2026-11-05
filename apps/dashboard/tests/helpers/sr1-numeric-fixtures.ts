import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerRepo } from './ledger-v2-foundation-fixtures';
import { operationalCluster } from './sr2-a3-fixtures';
import { collectManifest, assertManifest, readManifestFixture } from './sr2-dependency-manifest';
import type { DependencyManifest } from './sr2-dependency-manifest';

export const m1Migration = '20261028001756_m175_pre_a4_m1_sr1_numeric_cosine_safety_v1.sql';
export const m1Source = () => readFileSync(join(ledgerRepo, 'supabase/migrations', m1Migration), 'utf8');
export const v2FixtureUrl = new URL('../fixtures/sr2-dependency-manifest-v2.json', import.meta.url);
export const v2Query = readFileSync(new URL('./sr2-dependency-manifest-v2.sql', import.meta.url), 'utf8');
export const m1Migrations = () => readdirSync(join(ledgerRepo, 'supabase/migrations'))
  .filter(n => /^\d{14}_[a-z0-9_]+\.sql$/.test(n) && n <= m1Migration).sort()
  .map(name => ({ name, sha256_lf: createHash('sha256').update(readFileSync(join(ledgerRepo, 'supabase/migrations', name), 'utf8').replaceAll('\r', '')).digest('hex') }));
export async function collectV2(owner: (sql: string) => Promise<string>, prefix = '', rollback = false): Promise<DependencyManifest> {
  const result = JSON.parse(await owner(`BEGIN${prefix ? '' : ' READ ONLY'};${prefix}\n;\n${v2Query}\n${rollback ? 'ROLLBACK' : 'COMMIT'};`));
  assert.equal(result.document.manifest, 'GOVIA_SR2_DEPENDENCY_MANIFEST_V2');
  assert.deepEqual(result.document.missing, []);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  return result;
}
export const routineSnapshot = `SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p
 WHERE p.pronamespace='gov_repo'::regnamespace`;
export async function applyM1(pg: Awaited<ReturnType<typeof operationalCluster>>) {
  assertManifest(await collectManifest(pg.owner), readManifestFixture());
  const representationBytes = () => pg.owner(`SELECT jsonb_build_object(
    'representations',(SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('embedding_wire',encode(public.vector_send(r.embedding),'hex')) ORDER BY organisation_id,representation_id) FROM gov_repo.semantic_representations r),
    'assertions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY organisation_id,representation_id,assertion_id) FROM gov_repo.semantic_representation_assertions r),
    'evidence',(SELECT jsonb_agg(to_jsonb(r) ORDER BY organisation_id,representation_id,evidence_id) FROM gov_repo.semantic_representation_evidence r))::text`);
  const stored = await representationBytes();
  const before = JSON.parse(await pg.owner(routineSnapshot));
  await pg.owner(m1Source());
  const after = JSON.parse(await pg.owner(routineSnapshot));
  assert.equal(after.length, before.length);
  const target = before.find((p: any) => p.proname === 'semantic_context_search_v1');
  assert.ok(target);
  assert.notEqual(after.find((p: any) => p.oid === target.oid).prosrc, target.prosrc);
  assert.deepEqual(after.map((p: any) => p.oid === target.oid ? { ...p, prosrc: target.prosrc } : p), before,
    'only SR1 body changes; OID, arguments, security, config, ACL and every other routine are exact');
  assertManifest(await collectManifest(pg.owner), readManifestFixture());
  await pg.owner(m1Source());
  assert.deepEqual(JSON.parse(await pg.owner(routineSnapshot)), after, 'successor reapplication is replay-safe');
  assert.equal(await representationBytes(), stored, 'all stored representation fields, embedding wire bytes and provenance links unchanged');
}

/** Reuse the full original SR1 security regression at M1 without rewriting any
 * historical postflight. Only two approved hash pins move to the proven horizon. */
export async function m1Sr1Postflight(owner: (sql: string) => Promise<string>, historical: string) {
  const catalogHashSql = historical.match(/SELECT encode\(sha256[\s\S]*?INTO v_hash;/)![0].replace(' INTO v_hash;', ';');
  const catalogHash = await owner(catalogHashSql);
  assert.match(catalogHash, /^[0-9a-f]{64}$/);
  return historical.replace('829230366d53be537efe3ddabab78fbe9e5ea8f2282c3e34e17f1110b4fd6e33', catalogHash)
    .replace('f01c0e4aedf049fb5a8aac886553d6f3e6b3207da9fc0c5f2d130229b7f6ab24',
      '311e2ceaef5088e4dc61dc78d91f2e6643298701f22fc84f0a1bc5e630a1ac87');
}
