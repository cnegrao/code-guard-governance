import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { operationalCluster, operationalCatalogQuery } from '../helpers/sr2-a3-fixtures';
import { assertManifest, collectManifest, historicalMigrations, manifestFixtureUrl, readManifestFixture,
  rehashDocumentSql, type DependencyManifest } from '../helpers/sr2-dependency-manifest';

test('H1 complete manifest reproduces across two fresh empty 106-migration replays', { timeout: 900000 }, async t => {
  const check = async (name: string, body: () => Promise<void>) => {
    let failure: unknown;
    await t.test(name, async () => { try { await body(); } catch (error) { failure = error; throw error; } });
    if (failure) throw failure;
  };
  const migrations = historicalMigrations();
  assert.equal(migrations.length, 106);
  let replayA: DependencyManifest | undefined;
  let directoryA = '';
  let replayB: DependencyManifest | undefined;
  for (const label of ['A', 'B']) {
    const started = performance.now();
    const pg = await operationalCluster(message => t.diagnostic(`REPLAY_${label}: ${message}`));
    try {
      const directory = await pg.bootstrapSql('SHOW data_directory');
      if (label === 'A') directoryA = directory;
      else assert.notEqual(directory, directoryA, 'independent initdb directory, not a reused/cloned database');
      assert.equal(await pg.owner('SHOW server_version_num'), '170011');
      assert.equal(await pg.owner("SELECT extversion FROM pg_extension WHERE extname='vector'"), '0.8.7');
      const actual = await collectManifest(pg.owner);
      assert.equal(actual.document.relations.length, 36);
      assert.equal(actual.document.routines.length, 22);
      assert.equal(await pg.owner(rehashDocumentSql(actual.document)), actual.sha256);
      // The affected historical A3 fixture remains exact, independently of H1's new fixture.
      assert.deepEqual(JSON.parse(await pg.owner(operationalCatalogQuery)),
        JSON.parse(readFileSync(new URL('../fixtures/sr2-a3-catalog-v1.json', import.meta.url), 'utf8')));
      if (label === 'A') replayA = actual;
      else {
        replayB = actual;
        assertManifest(actual, replayA!);
      }
      t.diagnostic(`MANIFEST_REPLAY_${label}: 106 files; document and SHA-256 PASS; ${actual.sha256}; ${(performance.now()-started).toFixed(1)} ms`);

      if (label === 'B') {
        for (const [setting, startingValue] of [
          ['quote_all_identifiers', 'on'], ['standard_conforming_strings', 'off'],
        ] as const) {
          await check(`F-1 session starting with ${setting}=${startingValue} preserves the complete document and SHA`, async () => {
            const fromAdverseSession = (sql: string) => pg.owner(`
              SET ${setting} = ${startingValue};
              DO $probe$ BEGIN
                IF current_setting('${setting}') <> '${startingValue}' THEN
                  RAISE EXCEPTION 'F1_SESSION_PRECONDITION_FAILED';
                END IF;
              END $probe$;
              ${sql}`);
            assertManifest(await collectManifest(fromAdverseSession), actual);
          });
        }
        await check('required properties detect catalog drift and roll back cleanly', async () => {
          const mutations = [
            'ALTER TABLE gov_repo.agents ALTER COLUMN description DROP NOT NULL;',
            'ALTER TABLE gov_repo.ai_systems ALTER COLUMN name DROP NOT NULL;',
            'ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 DISABLE ROW LEVEL SECURITY;',
            'GRANT SELECT ON gov_repo.sr2_operational_agent_heads_v1 TO service_role;',
            'ALTER TABLE gov_repo.sr2_operational_agent_heads_v1 DISABLE TRIGGER sr2_operational_agent_heads_v1_transition;',
            "ALTER TYPE gov_repo.agent_status RENAME VALUE 'active' TO 'h1_changed';",
            'ALTER FUNCTION gov_repo.frame_identity(text[]) STABLE;',
            'ALTER FUNCTION gov_repo.frame_identity(text[]) SECURITY DEFINER;',
            'ALTER FUNCTION gov_repo.frame_identity(text[]) SET search_path=public;',
            'GRANT EXECUTE ON FUNCTION gov_repo.sr2_immutable_v1() TO service_role;',
            'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA gov_repo GRANT EXECUTE ON FUNCTIONS TO anon;',
            'GRANT CREATE ON SCHEMA public TO anon;',
            "CREATE OR REPLACE FUNCTION gov_repo.frame_identity(p_parts text[]) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''changed''::text';",
          ];
          for (const mutation of mutations) {
            const changed = await collectManifest(pg.owner, mutation, true);
            assert.notDeepEqual(changed.document, actual.document, mutation);
            assert.notEqual(changed.sha256, actual.sha256, mutation);
          }
          assertManifest(await collectManifest(pg.owner), actual);
        });
        await check('operator implementation is pinned beyond its API signature', async () => {
          const flags = await collectManifest(pg.bootstrapSql,
            'ALTER FUNCTION public.cosine_distance(public.vector,public.vector) PARALLEL RESTRICTED;', true);
          assert.notEqual(flags.sha256, actual.sha256);
          const changed = await collectManifest(pg.bootstrapSql, `
            CREATE FUNCTION public.h1_cosine(public.vector,public.vector) RETURNS float8 LANGUAGE sql IMMUTABLE AS 'SELECT 0::float8';
            UPDATE pg_catalog.pg_operator SET oprcode='public.h1_cosine(public.vector,public.vector)'::regprocedure
            WHERE oid='public.<=>(public.vector,public.vector)'::regoperator;`, true);
          assert.equal(changed.document.vector.cosine_operator.implementation, 'public.h1_cosine(__vector__.vector,__vector__.vector)');
          assert.notEqual(changed.sha256, actual.sha256);
        });
        await check('pgvector relocation normalizes only vector identities', async () => {
          const changed = await collectManifest(pg.bootstrapSql, `
            CREATE SCHEMA h1_vector AUTHORIZATION pg_database_owner;
            UPDATE pg_catalog.pg_namespace SET nspacl=(SELECT nspacl FROM pg_catalog.pg_namespace WHERE nspname='public')
              WHERE nspname='h1_vector';
            ALTER EXTENSION vector SET SCHEMA h1_vector;
            DO $relocate$ DECLARE r record; BEGIN
              FOR r IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='gov_repo' AND (p.proname LIKE 'sr2_%' OR p.proname IN
                  ('technical_semantic_context_search_v1','operational_agent_semantic_context_search_v1'))
              LOOP EXECUTE replace(replace(replace(replace(pg_catalog.pg_get_functiondef(r.oid),
                'public.vector','h1_vector.vector'),'public.l2_normalize','h1_vector.l2_normalize'),
                'public.cosine_distance','h1_vector.cosine_distance'),'public.<=>','h1_vector.<=>'); END LOOP;
            END $relocate$;`, true);
          assertManifest(changed, actual);
          assert.ok(JSON.stringify(changed.document).includes('public.uuid_generate_v4'));
        });
        await check('search_path, routine CRLF and unrelated catalog noise are excluded', async () => {
          const body = await pg.owner("SELECT prosrc FROM pg_proc WHERE oid='gov_repo.frame_identity(text[])'::regprocedure");
          const definition = await pg.owner("SELECT pg_get_functiondef('gov_repo.frame_identity(text[])'::regprocedure)");
          const changed = await collectManifest(pg.owner, `
            SET LOCAL search_path=public,gov_repo;
            CREATE TABLE public.h1_unrelated(noise text);
            COMMENT ON FUNCTION gov_repo.frame_identity(text[]) IS 'ignored timestamp/environment noise';
            ALTER FUNCTION gov_repo.frame_identity(text[]) COST 999;
            ${definition.replace(body, body.replaceAll('\n', '\r\n'))}`, true);
          assertManifest(changed, actual);
        });
      }
    } finally { pg.stop(); }
  }
  assertManifest(replayB!, replayA!);
  if (process.env.GOVIA_SR2_WRITE_MANIFEST_FIXTURE === '1') {
    // Fixture generation is gated on independent equality, never on a single replay/hash.
    writeFileSync(manifestFixtureUrl, JSON.stringify({ ...replayA!, migrations }, null, 2) + '\n');
  }
  const fixture = readManifestFixture();
  assert.deepEqual(fixture.migrations, migrations, 'all 106 historical migration contents remain immutable (LF-normalized SHA-256)');
  assertManifest(replayA!, fixture);
  assertManifest(replayB!, fixture);
});
