import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { operationalCluster } from '../helpers/sr2-a3-fixtures';
import { applyM1, collectV2, m1Migration, m1Migrations, v2FixtureUrl } from '../helpers/sr1-numeric-fixtures';
import { collectManifest, assertManifest, readManifestFixture, rehashDocumentSql, type DependencyManifest } from '../helpers/sr2-dependency-manifest';

test('H1 V2 first successor horizon: independent complete manifests, F2-F5 and immutable V1', { timeout: 900000 }, async t => {
  const migrations = m1Migrations(); assert.equal(migrations.length, 107); assert.equal(migrations.at(-1)!.name, m1Migration);
  let first: DependencyManifest | undefined, second: DependencyManifest | undefined, firstDirectory = '';
  for (const label of ['A', 'B']) {
    const started = performance.now();
    const pg = await operationalCluster(m => t.diagnostic(`${label}: ${m}`));
    try {
      const directory = await pg.bootstrapSql('SHOW data_directory');
      if (label === 'A') firstDirectory = directory; else assert.notEqual(directory, firstDirectory);
      await applyM1(pg);
      const actual = await collectV2(pg.owner);
      assert.deepEqual((actual.document as any).horizon, { canonical_migrations: 107, through: m1Migration });
      assert.equal(actual.document.routines.length, 23);
      assert.equal(actual.document.relations.length, 43);
      assert.ok(actual.document.routines.some(r => r.identity.startsWith('gov_repo.semantic_context_search_v1(')));
      assert.equal(await pg.owner(rehashDocumentSql(actual.document)), actual.sha256);
      if (label === 'A') first = actual; else { second = actual; assert.deepEqual(actual, first); }
      t.diagnostic(`H1_V2_REPLAY_${label}: 107 files; ${actual.sha256}; ${(performance.now()-started).toFixed(1)} ms`);
      if (label !== 'B') continue;
      await t.test('F2 sequence fallback is acldefault(s), separate from pg_default_acl object type S', async () => {
        const global = actual.document.default_acls.find(d => d.schema === '__global__' && d.kind === 'S')!;
        assert.equal(global.explicit, false);
        assert.deepEqual(global.acl.map((a: any) => a.privilege).sort(), ['SELECT', 'UPDATE', 'USAGE']);
        assert.ok(global.acl.every((a: any) => a.grantee === 'postgres'));
        const foreignServer = await pg.owner("SELECT acldefault('S','postgres'::regrole)::text");
        assert.doesNotMatch(foreignServer, /=rwU\//);
        const changed = await collectV2(pg.owner, 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON SEQUENCES TO anon;', true);
        assert.notEqual(changed.sha256, actual.sha256);
      });
      await t.test('F3 persistence, rules, inheritance and child relations detect real structural DDL', async () => {
        for (const relation of actual.document.relations) {
          assert.equal(relation.persistence, 'p');
          assert.ok(Array.isArray(relation.rewrite_rules)); assert.deepEqual(relation.parents, []); assert.deepEqual(relation.children, []);
        }
        const mutations = [
          'ALTER TABLE gov_repo.semantic_representation_evidence SET UNLOGGED;',
          'CREATE RULE m1_delete_probe AS ON DELETE TO gov_repo.agents DO INSTEAD NOTHING;',
          'CREATE TABLE public.m1_child () INHERITS (gov_repo.agents);',
          'CREATE TABLE public.m1_parent (); ALTER TABLE gov_repo.semantic_representation_evidence INHERIT public.m1_parent;',
        ];
        for (const ddl of mutations) {
          const changed = await collectV2(pg.owner, ddl, true);
          assert.notDeepEqual(changed.document, actual.document, ddl); assert.notEqual(changed.sha256, actual.sha256, ddl);
        }
      });
      await t.test('F4 database encoding, collation, ctype, provider/locale and PostgreSQL major are pinned', async () => {
        const runtime = (actual.document as any).runtime;
        assert.equal(runtime.encoding, 'UTF8'); assert.equal(runtime.collation, 'C'); assert.equal(runtime.ctype, 'C'); assert.equal(runtime.postgres_major, 17);
        for (const key of ['locale_provider', 'locale', 'icu_locale', 'icu_rules', 'collation_version', 'actual_collation_version']) assert.ok(Object.hasOwn(runtime, key));
        assert.equal(runtime.locale_provider, 'c');
        for (const field of ['datcollate', 'datctype', 'datcollversion']) {
          const changed = await collectV2(pg.bootstrapSql, `UPDATE pg_database SET ${field}='M1_RUNTIME_DRIFT' WHERE datname=current_database();`, true);
          assert.notEqual(changed.sha256, actual.sha256, field);
        }
        for (const key of Object.keys(runtime)) {
          const changed = structuredClone(actual.document) as any; changed.runtime[key] = 'changed';
          assert.notEqual(await pg.owner(rehashDocumentSql(changed)), actual.sha256, key);
        }
      });
      await t.test('canonical transaction sets its settings and restores adverse caller values', async () => {
        const adverse = async (sql: string) => pg.owner(`SET quote_all_identifiers=on; SET standard_conforming_strings=off;
          SET TimeZone='America/Sao_Paulo'; SET DateStyle='SQL, DMY'; SET extra_float_digits=-1;
          ${sql}
          DO $restore$ BEGIN
            IF current_setting('quote_all_identifiers')<>'on' OR current_setting('standard_conforming_strings')<>'off'
              OR current_setting('TimeZone')<>'America/Sao_Paulo' OR current_setting('DateStyle')<>'SQL, DMY'
              OR current_setting('extra_float_digits')<>'-1' THEN RAISE EXCEPTION 'M1_SESSION_NOT_RESTORED'; END IF;
          END $restore$;`);
        assert.deepEqual(await collectV2(adverse), actual);
      });
      await t.test('SR1 body/security dependencies are pinned and unrelated catalog noise is excluded', async () => {
        for (const ddl of [
          "ALTER FUNCTION gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,public.vector,text,text,text,integer,text,integer,float8) SET search_path=public;",
          "GRANT EXECUTE ON FUNCTION gov_repo.semantic_context_search_v1(uuid,uuid,bigint,bigint,timestamptz,public.vector,text,text,text,integer,text,integer,float8) TO anon;",
          'ALTER TABLE gov_repo.semantic_representations ALTER COLUMN embedding DROP NOT NULL;',
          'ALTER FUNCTION public.l2_normalize(public.vector) PARALLEL RESTRICTED;',
        ]) assert.notEqual((await collectV2(pg.bootstrapSql, ddl, true)).sha256, actual.sha256, ddl);
        assert.deepEqual(await collectV2(pg.owner, 'CREATE TABLE public.m1_unrelated(noise text);', true), actual);
        assert.deepEqual(await collectV2(pg.owner), actual);
        assertManifest(await collectManifest(pg.owner), readManifestFixture());
      });
    } finally { pg.stop(); }
  }
  assert.deepEqual(second, first, 'independent fresh successor-horizon manifests match in full');
  if (process.env.GOVIA_SR2_WRITE_MANIFEST_V2_FIXTURE === '1') writeFileSync(v2FixtureUrl, JSON.stringify({ ...first!, migrations }, null, 2)+'\n');
  const fixture = JSON.parse(readFileSync(v2FixtureUrl, 'utf8'));
  assert.deepEqual(fixture.migrations, migrations); assert.deepEqual(fixture.document, first!.document); assert.equal(fixture.sha256, first!.sha256);
});
