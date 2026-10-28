import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { operationalCluster, operationalFixture, operationalRpc, operationalSpace } from '../helpers/sr2-a3-fixtures';
import { technicalFixture, technicalRpc, scopedRead, technicalSpace } from '../helpers/sr2-a2-fixtures';
import { createTechnicalScopeSource } from '../../lib/governance/technical-context-scope';
import { parseTechnicalContextResult } from '../../lib/governance/technical-context-contract';
import { parseOperationalContextResult } from '../../lib/governance/operational-context-contract';
import { fixture, corruptBegin, rpc, lit, orgA, orgB, representation, support, bounded, space } from '../helpers/semantic-retrieval-fixtures';
import { applyM1 } from '../helpers/sr1-numeric-fixtures';
import { createSemanticRetrievalAdapter, createQueryEmbeddingSource, QUERY_RECIPE, SemanticTransportError } from '../../lib/governance/semantic-context-retrieval';

test('M1 reproduces the raw SR1 defect on the real A3-horizon RPC before replacement', { timeout: 900000 }, async t => {
  const pg = await operationalCluster(m => t.diagnostic(m)); t.after(() => pg.stop());
  await pg.bootstrapSql(`BEGIN; SET LOCAL session_replication_role=replica; ${fixture} COMMIT;`);
  const actor = await pg.actor(orgA);
  const otherActor = await pg.actor(orgB);
  const read = async (query: string, threshold = '-1', a = actor) => JSON.parse(await pg.svc(bounded(`SELECT ${rpc(a, { p_query: lit(query), p_threshold: threshold })}`)));
  const changed = async (stored: string, query: string, threshold: string) => JSON.parse(await pg.bootstrapSql(`${corruptBegin}
    UPDATE gov_repo.semantic_representations SET embedding=${lit(stored)} WHERE representation_id='a';
    SET LOCAL ROLE service_role; SELECT ${rpc(actor, { p_query: lit(query), p_threshold: threshold, p_limit: '20' })}; ROLLBACK;`));
  // Frozen F-2 corpus measured against both real RPC horizons before pinning:
  // raw norm underflow invents a match; raw norm overflow loses a match.
  const mixedScaleCases = [
    { stored: '[1e-45,1e-30,0]', query: '[1,0,0]', threshold: '0.5', raw: '1', beforeHit: true, afterHit: false },
    { stored: '[3e19,1,0]', query: '[1,0,0]', threshold: '0.9', raw: '0', beforeHit: false, afterHit: true },
  ] as const;
  let defects = 0;
  for (const vector of ['[1,0,0]', '[3e38,0,0]', '[1e-38,0,0]', '[1e-45,0,0]', '[3e38,-3e38,0]']) {
    const x = JSON.parse(await pg.bootstrapSql(`${corruptBegin}
      UPDATE gov_repo.semantic_representations SET embedding=${lit(vector)} WHERE representation_id='a';
      SET LOCAL ROLE service_role; SELECT ${rpc(actor, { p_query: lit(vector), p_threshold: '0.9' })}; ROLLBACK;`));
    t.diagnostic(`RAW_RPC identical ${vector}: ${x.status}; hits=${x.hits.length}`);
    assert.equal(x.hits.length, 1, 'frozen identical-vector control; DTO alone cannot reveal NaN');
  }
  // SR1 hides scores in its DTO. PostgreSQL orders NaN above finite numbers,
  // so an identical-vector threshold probe alone cannot reveal an invalid score.
  for (const magnitude of ['3e38', '1e-38', '1e-45']) {
    const stored = `[${magnitude},0,0]`, query = `[-${magnitude},0,0]`;
    const raw = await pg.owner(`SELECT (1-(${lit(stored)}::public.vector <=> ${lit(query)}::public.vector))::text`);
    const x = JSON.parse(await pg.bootstrapSql(`${corruptBegin}
      UPDATE gov_repo.semantic_representations SET embedding=${lit(stored)} WHERE representation_id='a';
      SET LOCAL ROLE service_role; SELECT ${rpc(actor, { p_query: lit(query), p_threshold: '0.9' })}; ROLLBACK;`));
    t.diagnostic(`RAW_RPC opposite ${stored}: raw=${raw}; ${x.status}; hits=${x.hits.length}`);
    assert.equal(raw, 'NaN'); assert.equal(x.hits.length, 1);
    if (x.hits.length === 1 && raw === 'NaN') defects++;
  }
  for (const c of mixedScaleCases) {
    const raw = await pg.owner(`SELECT (1-(${lit(c.stored)}::public.vector <=> ${lit(c.query)}::public.vector))::text`);
    const x = await changed(c.stored, c.query, c.threshold);
    const hit = x.hits.some((h: any) => h.representation_id === 'a');
    assert.equal(raw, c.raw); assert.equal(hit, c.beforeHit);
    if (hit !== c.afterHit) defects++;
    t.diagnostic(`RAW_RPC mixed-scale ${c.stored}: raw=${raw}; hit=${hit}; intended=${c.afterHit}`);
  }
  assert.equal(defects, 5, 'frozen observed corpus: three NaN false positives + one finite false positive + one finite false negative');

  // Preserve complete old-RPC outputs before replacing the function. Only fixture
  // DDL/DML uses bootstrap, with production immutability restored by rollback.
  const ordinary = ['[1,0,0]', '[0.8,0.6,0]', '[0,1,0]', '[-1,0,0]', '[0.2,-0.7,0.3]', '[0.8,0.6,0]'];
  const population = ordinary.slice(1).map((vector, i) => {
    const id = `ordinary-${i}`;
    return `INSERT INTO gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id)
      VALUES('${id}','${orgA}','AGENT','fixture-decision');` + representation(id, id, { vector }) + support(id);
  }).join('');
  await pg.bootstrapSql(`BEGIN; SET LOCAL session_replication_role=replica; ${population} COMMIT;`);
  const queries = ['[1,0,0]', '[0.2,0.7,-0.1]', '[-1,0,0]', '[0,1,0]', '[1,1,1]'];
  const thresholds = ['-1', '0', '0.25', '0.5', '0.9', '1'];
  const old: unknown[] = [];
  for (const q of queries) for (const threshold of thresholds) old.push(await read(q, threshold));
  const oldForeign = await read('[1,0,0]', '-1', otherActor);
  await assert.rejects(read('[1,0,0]', '-1', { ...actor, org: orgB }), /GV003/);
  const capacityVector = '[' + ['1', ...Array(767).fill('0')].join(',') + ']';
  await pg.bootstrapSql(`BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO gov_repo.canonical_objects(canonical_object_id,organisation_id,kind,created_by_decision_id)
      SELECT 'capacity-'||n,'${orgA}','AGENT','fixture-decision' FROM generate_series(1,1000) n;
    INSERT INTO gov_repo.semantic_representations SELECT r.organisation_id,'capacity-'||n,r.subject_kind,'capacity-'||n,r.subject_canonical_object_kind,
      r.subject_candidate_id,r.subject_candidate_kind,r.projection_schema_version,r.content_fingerprint_algorithm,r.content_fingerprint_schema_version,
      r.content_fingerprint_value,r.embedding_provider_id,'capacity-fixture',r.embedding_model_version,768,${lit(capacityVector)}::public.vector,r.generated_at,r.created_at
      FROM gov_repo.semantic_representations r CROSS JOIN generate_series(1,1000) n WHERE r.representation_id='a';
    INSERT INTO gov_repo.semantic_representation_evidence SELECT '${orgA}','capacity-'||n,'evidence' FROM generate_series(1,1000) n; COMMIT;`);
  const capacityRead = () => pg.svc(bounded(`SELECT ${rpc(actor, { p_query: lit(capacityVector), p_dimension: '768', p_model: "'capacity-fixture'" })}`));
  const timedCapacityRead = async () => { const start = performance.now(); const output = await capacityRead(); return { output: JSON.parse(output), ms: performance.now()-start }; };
  const beforeCapacity = await timedCapacityRead();
  await applyM1(pg);
  t.diagnostic('107-file empty-origin replay through M1; only SR1 routine body changed; V1 manifest unchanged; reapplication exact');

  await t.test('F-2 mixed-scale finite false positive and false negative discriminate pre-M1 from M1', async () => {
    for (const c of mixedScaleCases) {
      const score = Number(await pg.owner(`SELECT 1-(public.l2_normalize(${lit(c.stored)}::public.vector) <=> public.l2_normalize(${lit(c.query)}::public.vector))`));
      assert.ok(Number.isFinite(score) && score >= -1 && score <= 1);
      assert.ok(Math.abs(score - (c.afterHit ? 1 : 0)) < 2e-6);
      const x = await changed(c.stored, c.query, c.threshold);
      assert.equal(x.hits.some((h: any) => h.representation_id === 'a'), c.afterHit);
      assert.notEqual(c.beforeHit, c.afterHit, 'each frozen case must distinguish the actual RPC horizons');
      t.diagnostic(`M1_RPC mixed-scale ${c.stored}: score=${score}; hit=${c.afterHit}; pre-M1 hit=${c.beforeHit}`);
    }
  });
  await t.test('ordinary differential RPC candidates, thresholds, authorization and deterministic ties', async () => {
    let index = 0;
    for (const q of queries) for (const threshold of thresholds) assert.deepEqual(await read(q, threshold), old[index++]);
    assert.deepEqual(await read('[1,0,0]', '-1', otherActor), oldForeign);
    await assert.rejects(read('[1,0,0]', '-1', { ...actor, org: orgB }), /GV003/);
    const scores = JSON.parse(await pg.owner(`SELECT jsonb_agg(jsonb_build_array(
      1-(a::public.vector <=> b::public.vector),
      1-(public.l2_normalize(a::public.vector) <=> public.l2_normalize(b::public.vector))))
      FROM unnest(ARRAY[${ordinary.map(lit).join(',')}]) a CROSS JOIN unnest(ARRAY[${queries.map(lit).join(',')}]) b`));
    // 3-D float32 normalization plus dot/norm sums: 2e-6 is <17 float32 eps,
    // conservative for these 3-D operations; not a tolerance on ranking/threshold.
    let maxDelta = 0;
    for (const [before, after] of scores) { const delta = Math.abs(before - after); maxDelta = Math.max(maxDelta, delta); assert.ok(delta <= 2e-6); }
    t.diagnostic(`30 exact RPC output comparisons; 30 ordinary scores; max delta=${maxDelta}; tolerance=2e-6`);
  });
  await t.test('real normalized pgvector scores and RPC hits across adversarial scales and directions', async () => {
    const pairs: [string, string, number][] = [
      ['[1,0,0]', '[1,0,0]', 1], ['[0.6,0.8,0]', '[0.6,0.8,0]', 1],
      ['[1,0,0]', '[0,1,0]', 0], ['[1,0,0]', '[-1,0,0]', -1],
      ['[1,-2,3]', '[-1,2,-3]', -1], ['[1,-2,3]', '[1,-2,3]', 1],
    ];
    for (const n of ['3e38', '1e-38', '1e-45']) pairs.push(
      [`[${n},0,0]`, `[${n},0,0]`, 1], [`[${n},0,0]`, `[-${n},0,0]`, -1],
      [`[${n},-${n},0]`, `[${n},-${n},0]`, 1], [`[${n},0,0]`, `[0,${n},0]`, 0]);
    for (const [stored, query, expected] of pairs) {
      const score = Number(await pg.owner(`SELECT 1-(public.l2_normalize(${lit(stored)}::public.vector) <=> public.l2_normalize(${lit(query)}::public.vector))`));
      assert.ok(Number.isFinite(score) && score >= -1 && score <= 1, `${stored} / ${query}: ${score}`);
      assert.ok(Math.abs(score - expected) < 2e-6);
      // Extra ordinary fixture subjects exist: check this representation, not total hits.
      const result = await changed(stored, query, expected > 0 ? '0.99999' : expected === 0 ? '0' : '-1');
      assert.ok(result.hits.some((h: any) => h.representation_id === 'a'));
      if (expected < 1) assert.ok(!(await changed(stored, query, '0.9')).hits.some((h: any) => h.representation_id === 'a'));
    }
    t.diagnostic(`18 real pgvector/RPC numeric cases; large, tiny and subnormal counterexamples repaired`);
  });
  await t.test('invalid query boundary and stored zero preserve established SR1 rejection', async () => {
    for (const q of ['[0,0,0]', '[1,0]', '[NaN,0,0]', '[Infinity,0,0]', '[-Infinity,0,0]', '[3e39,0,0]', '[broken]'])
      await assert.rejects(read(q), /22023|22P02|22000|22003/);
    assert.equal((await changed('[0,0,0]', '[1,0,0]', '-1')).reason, 'INVALID_REPRESENTATION_SUPPORT');
  });
  await t.test('all invalid computed scores fail closed before threshold or LIMIT', async () => {
    for (const distance of ['NaN', 'Infinity', '-Infinity', '-0.001', '2.001']) {
      await assert.rejects(pg.bootstrapSql(`BEGIN; SET LOCAL statement_timeout='5s';
        CREATE FUNCTION public.m1_bad_cosine(public.vector,public.vector) RETURNS float8 LANGUAGE sql IMMUTABLE AS ${lit(`SELECT '${distance}'::float8`)};
        UPDATE pg_catalog.pg_operator SET oprcode='public.m1_bad_cosine(public.vector,public.vector)'::regprocedure
          WHERE oid='public.<=>(public.vector,public.vector)'::regoperator;
        SET LOCAL ROLE service_role; SELECT ${rpc(actor, { p_threshold: '1', p_limit: '1' })}; ROLLBACK;`), /XX000[\s\S]*SR1_NUMERIC_INVARIANT/);
    }
  });
  await t.test('provider -> existing Node adapter -> real RPC XX000 maps to INTERNAL_ERROR', async () => {
    const port = Number(await pg.owner('SELECT inet_server_port()'));
    const pool = new Pool({ host: '127.0.0.1', port, database: 'postgres', user: 'm16_bootstrap', password: '', ssl: false, max: 1 });
    const client = await pool.connect();
    try {
      // Inject the operator fault inside the adapter's own transaction. It rolls
      // back the fault together with the failed request; no product TS is changed.
      let released = false;
      const adapter = createSemanticRetrievalAdapter({ connect: async () => ({
        query: async (sql: string, values?: unknown[]) => {
          if (sql.startsWith('SELECT gov_repo.semantic_context_search_v1')) {
            await client.query(`CREATE FUNCTION public.m1_bad_cosine(public.vector,public.vector) RETURNS float8 LANGUAGE sql IMMUTABLE AS 'SELECT ''NaN''::float8';
              UPDATE pg_catalog.pg_operator SET oprcode='public.m1_bad_cosine(public.vector,public.vector)'::regprocedure WHERE oid='public.<=>(public.vector,public.vector)'::regoperator;
              SET LOCAL ROLE service_role;`);
          }
          return client.query(sql, values);
        }, release: () => { released = true; },
      }) });
      const output = await createQueryEmbeddingSource({ space, query_recipe: QUERY_RECIPE, model_version_verified: true },
        { embedQuestion: async () => ({ space, query_recipe: QUERY_RECIPE, vector: [1,0,0] }) })('question');
      assert.ok('query' in output);
      const now = Math.floor(Date.now()/1000);
      await assert.rejects(adapter.retrieveSemanticContext({ organisationId: actor.org, userId: actor.id, credentialEpoch: actor.epoch,
        issuedAtSeconds: now-10, expiresAtSeconds: now+3600, informational: {} }, output.query,
        { limit: 5, threshold: 0, policy_version: 'EXACT_COSINE_V1' }), e => e instanceof SemanticTransportError && e.reason === 'INTERNAL_ERROR');
      assert.equal(released, true);
      assert.equal((await client.query("SELECT to_regprocedure('public.m1_bad_cosine(public.vector,public.vector)') IS NULL AS clean")).rows[0].clean, true);
    } finally { client.release(); await pool.end(); }
  });
  await t.test('representative local 1000-row scan has no pathological normalization overhead', async () => {
    const after = await timedCapacityRead();
    assert.deepEqual(after.output, beforeCapacity.output);
    assert.equal(after.output.status, 'SEMANTIC_CONTEXT_AVAILABLE'); assert.equal(after.output.hits.length, 5); assert.ok(after.ms < 5000);
    assert.ok(after.ms < Math.max(1000, beforeCapacity.ms*10), 'bounded sanity check, not a capacity acceptance benchmark');
    t.diagnostic(`1000 selected rows, dimension 768, full support + RPC before=${beforeCapacity.ms.toFixed(1)} ms / after=${after.ms.toFixed(1)} ms (including psql startup); request deadline 5s`);
  });
  await t.test('M1 horizon A1/A2/A3 smoke: real typed writes, both RPCs and strict parsers', async () => {
    const technical = technicalFixture({ facets: true, count: 2 }); await pg.owner(technical.sql);
    const principal = { organisationId: actor.org, userId: actor.id, credentialEpoch: actor.epoch, issuedAtSeconds: 1, expiresAtSeconds: 2, informational: {} };
    const binding = createTechnicalScopeSource({ bindings: [{ selection_key: 'm1', organisation_id: actor.org,
      repository_id: technical.root.row.repository_id, snapshot_id: technical.s.snap.snapshot_id }] })(principal, 'm1');
    assert.ok('scope' in binding);
    const technicalResult = JSON.parse(await pg.svc(scopedRead(technicalRpc(actor, technical))));
    assert.equal(parseTechnicalContextResult(technicalResult, orgA, binding.scope, technicalSpace, 20).hits.length, 1);
    const operational = operationalFixture(actor); await pg.owner(operational.sql);
    const operationalResult = JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));
    assert.equal(parseOperationalContextResult(operationalResult, orgA, operationalSpace, 20).hits.length, 1);
  });
});
