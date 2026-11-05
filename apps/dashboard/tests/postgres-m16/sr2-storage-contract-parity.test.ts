import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { operationalCluster, operationalFixture, operationalRpc, operationalSpace, scopedRead, lit, orgA } from '../helpers/sr2-a3-fixtures';
import { technicalFixture, technicalDto, technicalRpc, technicalSpace, projection, representation, inserts } from '../helpers/sr2-a2-fixtures';
import { fixture } from '../helpers/semantic-retrieval-fixtures';
import { storageTextCorpus, reservedTokenCorpus, canonicalUuidCorpus } from '../helpers/sr2-storage-parity-corpus';
import { assertManifest, collectManifest, historicalMigrations, readManifestFixture } from '../helpers/sr2-dependency-manifest';
import { assertFrameCatalog, frameCatalogSql } from '../helpers/sr2-frame-audit';
import { buildOperationalDocument, frameOperationalIdentity, operationalIdentity, isOperationalStorageText, operationalAgentTypes, OperationalTransportError,
  parseOperationalContextResult } from '../../lib/governance/operational-context-contract';
import { isTechnicalStorageText, parseTechnicalContextResult, TechnicalTransportError } from '../../lib/governance/technical-context-contract';
import { createTechnicalScopeSource } from '../../lib/governance/technical-context-scope';
import { createOperationalRetrievalAdapter } from '../../lib/governance/operational-context-retrieval';
import { createOperationalQueryEmbeddingSource, OPERATIONAL_DOCUMENT_RECIPE, OPERATIONAL_QUERY_RECIPE,
  OPERATIONAL_QUERY_SEMANTICS } from '../../lib/governance/operational-query-embedding';

test('P1-H2: live SQL/TypeScript storage parity, complete reads and frozen identities', { timeout: 900000 }, async t => {
  const pg = await operationalCluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const frozen = readManifestFixture();
  assert.deepEqual(historicalMigrations(), frozen.migrations);
  assertManifest(await collectManifest(pg.owner), frozen);
  const check = async (name: string, body: () => Promise<void>) => {
    let failure: unknown;
    await t.test(name, async () => { try { await body(); } catch (error) { failure = error; throw error; } });
    if (failure) throw failure;
  };
  const expression = (table: string, name: string) => pg.owner(`SELECT pg_get_expr(conbin,conrelid)
    FROM pg_constraint WHERE conrelid=${lit(`gov_repo.${table}`)}::regclass AND conname=${lit(name)}`);
  // Execute the real deparsed CHECK, retaining the columns' C collation. Never copy its predicate into the test.
  const evaluate = async (checkSql: string, columns: string[], values: string[], fixed: Record<string, string> = {}) => {
    const rows = values.map((value, id) => `(${id},'${Buffer.from(value, 'utf8').toString('hex')}')`).join(',');
    return JSON.parse(await pg.owner(`SELECT jsonb_agg(jsonb_build_object('id',id,'accepted',${checkSql}) ORDER BY id)
      FROM (SELECT id,${[...columns.map(c => `convert_from(decode(hex,'hex'),'UTF8') COLLATE "C" AS ${c}`),
        ...Object.entries(fixed).map(([c, value]) => `${lit(value)} COLLATE "C" AS ${c}`)].join(',')}
        FROM (VALUES ${rows}) raw(id,hex)) stored`)) as { id: number; accepted: boolean }[];
  };
  await check('permanent Unicode corpus equals actual A3 and A1/A2 CHECK acceptance', async () => {
    for (const [table, column] of [['sr2_operational_agent_observations_v1', 'agent_name_label'], ['sr2_projections_v1', 'safe_label']])
      assert.equal(await pg.owner(`SELECT attcollation::regcollation::text FROM pg_attribute
        WHERE attrelid=${lit(`gov_repo.${table}`)}::regclass AND attname=${lit(column)}`), '"C"');
    const a3 = await expression('sr2_operational_agent_observations_v1', 'sr2_operational_agent_observations_v1_c5');
    const a2 = await expression('sr2_projections_v1', 'sr2_projections_v1_c3');
    const representable = storageTextCorpus.filter(item => !item.value.includes('\u0000'));
    const sqlA3 = await evaluate(a3, ['agent_code_label', 'agent_name_label'], representable.map(c => c.value));
    const sqlA2 = await evaluate(a2, ['safe_label', 'safe_description'], representable.map(c => c.value));
    for (const [id, item] of representable.entries()) {
      assert.equal(sqlA3[id].accepted, item.a3, `SQL A3: ${item.name}`);
      assert.equal(sqlA2[id].accepted, item.a2, `SQL A2: ${item.name}`);
      assert.equal(isOperationalStorageText(item.value), sqlA3[id].accepted, `SQL↔TS A3: ${item.name}`);
      assert.equal(isTechnicalStorageText(item.value), sqlA2[id].accepted, `SQL↔TS A2: ${item.name}`);
    }
    // PostgreSQL text cannot represent NUL: rejection occurs at UTF-8 decoding, before the CHECK can run.
    for (const item of storageTextCorpus.filter(item => item.value.includes('\u0000'))) {
      await assert.rejects(pg.owner(`SELECT convert_from(decode('${Buffer.from(item.value).toString('hex')}','hex'),'UTF8')`), /22021|invalid byte sequence/);
      assert.equal(isOperationalStorageText(item.value), false); assert.equal(isTechnicalStorageText(item.value), false);
    }
    t.diagnostic(`${storageTextCorpus.length} permanent corpus entries; NUL representation boundary explicitly tested`);
  });
  await check('actual SQL field-specific path controls and 1024-byte description bounds', async () => {
    const pathCheck = await expression('sr2_manifest_entries_v1', 'sr2_manifest_entries_v1_c1');
    const paths = storageTextCorpus.filter(item => !item.value.includes('\u0000'));
    const accepted = await evaluate(pathCheck, ['relative_path'], paths.map(item => item.value));
    const principal = { organisationId: orgA, userId: orgA, credentialEpoch: '2026-01-01T00:00:00Z', issuedAtSeconds: 1, expiresAtSeconds: 2, informational: {} };
    for (const [id, item] of paths.entries()) {
      const f = technicalFixture({ entryOverrides: { relative_path: item.value } });
      const binding = createTechnicalScopeSource({ bindings: [{ selection_key: 'path', organisation_id: orgA,
        repository_id: f.root.row.repository_id, snapshot_id: f.s.snap.snapshot_id }] })(principal, 'path');
      assert.ok('scope' in binding);
      // Complete parser verification is in the Node corpus; here exercise each actual path CHECK alongside it.
      let parsed = true;
      try { parseTechnicalContextResult(technicalDto(f), orgA, binding.scope, technicalSpace, 20); } catch { parsed = false; }
      assert.equal(parsed, accepted[id].accepted, `path SQL↔TS: ${item.name}`);
    }
    const descriptions = ['x'.repeat(512), 'x'.repeat(513), 'é'.repeat(512), 'x'.repeat(1025)];
    const a2 = await evaluate(await expression('sr2_projections_v1', 'sr2_projections_v1_c3'), ['safe_description'], descriptions, { safe_label: 'valid' });
    const a3 = await evaluate(await expression('sr2_operational_agent_observations_v1', 'sr2_operational_agent_observations_v1_c7'), ['description_text'], descriptions, { description_disposition: 'PROJECTED' });
    for (const [id, value] of descriptions.entries()) {
      assert.equal(a2[id].accepted, isTechnicalStorageText(value, 1024));
      assert.equal(a3[id].accepted, isOperationalStorageText(value, 1024));
    }
  });
  await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;${fixture}COMMIT;`);
  const actor = await pg.actor(orgA);
  await check('production agent_type accepted set equals the complete live PostgreSQL enum', async () => {
    const labels = JSON.parse(await pg.owner(`SELECT jsonb_agg(enumlabel ORDER BY enumsortorder)
      FROM pg_enum WHERE enumtypid='gov_repo.agent_type'::regtype`));
    assert.deepEqual(operationalAgentTypes, labels, 'ADD VALUE requires deliberate production TypeScript admission');
    assert.equal(new Set(operationalAgentTypes).size, operationalAgentTypes.length);
    for (const agent_type of operationalAgentTypes) {
      const f = operationalFixture(actor, { agent_type });
      assert.ok(buildOperationalDocument(f.observation as any).includes(`Type: ${agent_type}`));
    }
  });
  await check('reserved tokens: actual A3 c3 and A1/A2 representations_c4 equal complete TypeScript parser acceptance', async () => {
    const accepts = (parse: () => unknown, kind: typeof OperationalTransportError | typeof TechnicalTransportError) => {
      try { parse(); return true; } catch (error) {
        assert.ok(error instanceof kind && error.reason === 'MALFORMED_RESULT'); return false;
      }
    };
    const f = operationalFixture(actor); await pg.owner(f.sql);
    const operationalBase = JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));
    assert.equal(operationalBase.status, 'SEMANTIC_CONTEXT_AVAILABLE');
    assert.doesNotThrow(() => parseOperationalContextResult(structuredClone(operationalBase), orgA, operationalSpace, 20));
    const c3 = await expression('sr2_operational_agent_observations_v1', 'sr2_operational_agent_observations_v1_c3');
    for (const field of ['acquisition_method_code', 'acquisition_method_version'] as const) {
      const fixed: Record<string, string> = field === 'acquisition_method_code' ? { acquisition_method_version: '1' } : { acquisition_method_code: 'FIXTURE_ACQUISITION' };
      const sql = await evaluate(c3, [field], [...reservedTokenCorpus], fixed);
      for (const [id, value] of reservedTokenCorpus.entries()) {
        const dto = structuredClone(operationalBase), hit = dto.hits[0], observation = hit.observation;
        observation.acquisition_method[field === 'acquisition_method_code' ? 'code' : 'version'] = value;
        observation.observation_id = operationalIdentity(['GOVIA_SR2_OPERATIONAL_AGENT_OBSERVATION_V1', orgA, hit.source_record_id, hit.subject_id,
          observation.source_descriptor_recipe, observation.source_descriptor_fingerprint, observation.acquisition_method.code,
          observation.acquisition_method.version, 'GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1', '1', operationalSpace.projection_schema_version,
          hit.projection.projection_id, 'GOVIA_SR2_OPERATIONAL_HANDLING_V1', '1', 'GOVIA_OPERATIONAL_CONTEXT_V1']);
        hit.representation_id = operationalIdentity(['GOVIA_SR2_OPERATIONAL_AGENT_REPRESENTATION_V1', orgA, hit.source_record_id,
          observation.observation_id, operationalSpace.projection_schema_version, operationalSpace.provider_id, operationalSpace.model_id,
          operationalSpace.model_version, operationalSpace.dimension]);
        assert.equal(accepts(() => parseOperationalContextResult(dto, orgA, operationalSpace, 20), OperationalTransportError),
          sql[id].accepted, `A3 c3 ${field}: ${JSON.stringify(value)}`);
      }
    }
    const technical = technicalFixture(), principal = { organisationId: orgA, userId: actor.id, credentialEpoch: actor.epoch,
      issuedAtSeconds: 1, expiresAtSeconds: 2, informational: {} };
    const binding = createTechnicalScopeSource({ bindings: [{ selection_key: 'reserved', organisation_id: orgA,
      repository_id: technical.root.row.repository_id, snapshot_id: technical.s.snap.snapshot_id }] })(principal, 'reserved');
    assert.ok('scope' in binding);
    const c4 = await expression('sr2_representations_v1', 'sr2_representations_v1_c4');
    for (const field of ['projection_schema_version', 'provider_id', 'model_id', 'model_version'] as const) {
      const fixed = { projection_schema_version: technicalSpace.projection_schema_version, provider_id: technicalSpace.provider_id,
        model_id: technicalSpace.model_id, model_version: technicalSpace.model_version, content_class: 'PROTECTED_CONTEXT_V1' };
      const { [field]: _variable, ...other } = fixed;
      const sql = await evaluate(c4, [field], [...reservedTokenCorpus], other);
      for (const [id, value] of reservedTokenCorpus.entries()) {
        const space = { ...technicalSpace, [field]: value }, dto = { ...technicalDto(technical), embedding_space: space,
          status: 'NO_MATCHES_IN_QUERIED_SEMANTIC_SPACE', hits: [] };
        assert.equal(accepts(() => parseTechnicalContextResult(dto, orgA, binding.scope, space, 20), TechnicalTransportError),
          sql[id].accepted, `A1/A2 representations_c4 ${field}: ${JSON.stringify(value)}`);
      }
    }
    t.diagnostic(`${reservedTokenCorpus.length} reserved-token cases across both A3 c3 columns and all four representation identity fields`);
  });
  await check('NBSP/BOM/U+3000 rows pass SQL AVAILABLE then the real operational adapter/parser', async () => {
    const pool = new Pool({ host: '127.0.0.1', port: Number(await pg.owner('SHOW port')), database: 'postgres', user: 'service_role', max: 1 });
    try {
      const epoch = await pg.owner(`SELECT to_char(password_changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM gov_repo.governance_users WHERE user_id=${lit(actor.id)}`);
      const now = Math.floor(Date.now() / 1000), principal = { organisationId: orgA, userId: actor.id, credentialEpoch: epoch,
        issuedAtSeconds: now - 10, expiresAtSeconds: now + 3600, informational: {} };
      const source = createOperationalQueryEmbeddingSource({ space: operationalSpace, document_recipe: OPERATIONAL_DOCUMENT_RECIPE,
        query_recipe: OPERATIONAL_QUERY_RECIPE, query_semantics: OPERATIONAL_QUERY_SEMANTICS, model_version_verified: true },
        { async embedQuestion() { return { space: operationalSpace, query_recipe: OPERATIONAL_QUERY_RECIPE, vector: [1, 0, 0] }; } });
      const query = await source('local parity fixture'); assert.ok('query' in query);
      for (const label of ['\u00a0', '\ufeff', '\u3000']) {
        const f = operationalFixture(actor, { name: label, system_name: label, business_domain: label, description: label });
        await pg.owner(f.sql);
        const raw = JSON.parse(await pg.svc(scopedRead(operationalRpc(actor))));
        assert.equal(raw.status, 'SEMANTIC_CONTEXT_AVAILABLE');
        const result = await createOperationalRetrievalAdapter(pool).retrieveOperationalContext(principal, query.query,
          { limit: 20, threshold: -1, policy_version: 'EXACT_COSINE_V1' });
        const hit = result.hits.find(h => h.source_record_id === f.agent.agent_id) as any;
        assert.ok(hit); assert.equal(hit.projection.agent_name_label, label); assert.equal(hit.projection.related_system_name_label, label);
        assert.equal(hit.observation.observation_id, f.observation.observation_id); assert.equal(hit.representation_id, f.representation.representation_id);
        const document = buildOperationalDocument(hit.projection as any);
        assert.ok(document.startsWith(`Agent: ${label}\n`)); assert.ok(document.endsWith(`Description: ${label}`));
      }
    } finally { await pool.end(); }
  });
  await check('canonical UUIDv7 organisation/actor/source/system traverse live authorization and adapter', async () => {
    const org = '0192c510-7f40-7abc-8def-0123456789ab', user = '0192c510-7f40-7abc-8def-0123456789ac';
    await pg.owner(`INSERT INTO gov_repo.organisations(organisation_id,org_code,legal_name,display_name,country_code) VALUES(${lit(org)},'H2_V7','H2 V7','H2 V7','BR');
      INSERT INTO gov_repo.governance_users(user_id,email,full_name,organisation_id,status,role_ids)
      SELECT ${lit(user)},'h2-v7@example.invalid','H2 V7',${lit(org)},'active',ARRAY[role_id] FROM gov_repo.governance_roles WHERE role_code='POLICY_OWNER';`);
    // Existing harness technique for a valid older credential epoch, confined to disposable fixture data.
    await pg.bootstrapSql(`BEGIN;ALTER TABLE gov_repo.governance_users DISABLE TRIGGER trg_governance_users_credential_epoch_v1;
      UPDATE gov_repo.governance_users SET password_changed_at=clock_timestamp()-interval '12 hours' WHERE user_id=${lit(user)};
      ALTER TABLE gov_repo.governance_users ENABLE ALWAYS TRIGGER trg_governance_users_credential_epoch_v1;COMMIT;`);
    const epoch = await pg.owner(`SELECT to_char(password_changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM gov_repo.governance_users WHERE user_id=${lit(user)}`);
    const v7Actor = { id: user, org, epoch }, sourceId = '0192c510-7f40-7abc-8def-0123456789ad', systemId = '0192c510-7f40-7abc-8def-0123456789ae';
    const f = operationalFixture(v7Actor, { source_record_id: sourceId, system_id: systemId }); await pg.owner(f.sql);
    const raw = JSON.parse(await pg.svc(scopedRead(operationalRpc(v7Actor)))); assert.equal(raw.status, 'SEMANTIC_CONTEXT_AVAILABLE');
    assert.equal(parseOperationalContextResult(raw, org, operationalSpace, 20).hits[0].source_record_id, sourceId);
    const pool = new Pool({ host: '127.0.0.1', port: Number(await pg.owner('SHOW port')), database: 'postgres', user: 'service_role', max: 1 });
    try {
      const now = Math.floor(Date.now() / 1000), query = await createOperationalQueryEmbeddingSource({ space: operationalSpace,
        document_recipe: OPERATIONAL_DOCUMENT_RECIPE, query_recipe: OPERATIONAL_QUERY_RECIPE, query_semantics: OPERATIONAL_QUERY_SEMANTICS,
        model_version_verified: true }, { async embedQuestion() { return { space: operationalSpace, query_recipe: OPERATIONAL_QUERY_RECIPE, vector: [1, 0, 0] }; } })('UUIDv7 fixture');
      assert.ok('query' in query);
      const result = await createOperationalRetrievalAdapter(pool).retrieveOperationalContext({ organisationId: org, userId: user,
        credentialEpoch: epoch, issuedAtSeconds: now - 10, expiresAtSeconds: now + 3600, informational: {} }, query.query,
        { limit: 20, threshold: -1, policy_version: 'EXACT_COSINE_V1' });
      assert.equal(result.status, 'SEMANTIC_CONTEXT_AVAILABLE'); assert.equal(result.hits[0].source_record_id, sourceId);
      assert.equal((result.hits[0].projection as any).related_system_record_id, systemId);
    } finally { await pool.end(); }
    for (const id of canonicalUuidCorpus) assert.equal(await pg.owner(`SELECT ${lit(id)}::uuid::text`), id);
  });
  await check('A2 Unicode labels survive the live read while its existing 512-byte disclosure bound remains unchanged', async () => {
    for (const label of ['\u00a0', '\ufeff', '\u3000']) for (const descriptionBytes of [512, 513, 1024]) {
      const f = technicalFixture({ label });
      const previousProjection = f.p, previousRepresentation = f.rep;
      const description = 'é'.repeat(Math.floor(descriptionBytes / 2)) + (descriptionBytes % 2 ? 'x' : '');
      f.p = projection(f.s, f.primary.row, f.admissions, [], { label, description, fragments: [{}] });
      f.rep = representation(f.p.row, f.s.capture);
      // Replace the original projection and representation fixture rows before inserting, without rewriting a stored row.
      const rows = f.rows.flatMap(row => row === previousProjection.rows[0] ? f.p.rows :
        previousProjection.rows.includes(row) ? [] : [row === previousRepresentation ? f.rep : row]);
      await pg.owner(`BEGIN;${f.root.sql}${inserts(rows)}COMMIT;`);
      assert.equal(Number(await pg.owner(`SELECT octet_length(safe_description) FROM gov_repo.sr2_projections_v1
        WHERE organisation_id=${lit(orgA)} AND projection_id=${lit(f.p.row.projection_id)}`)), descriptionBytes);
      assert.equal(isTechnicalStorageText(description, 1024), true);
      const raw = JSON.parse(await pg.svc(scopedRead(technicalRpc(actor, f))));
      assert.equal(raw.status, descriptionBytes === 512 ? 'SEMANTIC_CONTEXT_AVAILABLE' : 'SEMANTIC_CONTEXT_UNAVAILABLE', JSON.stringify(raw));
      const principal = { organisationId: orgA, userId: actor.id, credentialEpoch: actor.epoch, issuedAtSeconds: 1, expiresAtSeconds: 2, informational: {} };
      const binding = createTechnicalScopeSource({ bindings: [{ selection_key: 'a2', organisation_id: orgA, repository_id: f.root.row.repository_id,
        snapshot_id: f.s.snap.snapshot_id }] })(principal, 'a2'); assert.ok('scope' in binding);
      const parsed = parseTechnicalContextResult(raw, orgA, binding.scope, technicalSpace, 20);
      if (descriptionBytes === 512) {
        assert.equal(parsed.hits[0].projection.safe_label, label); assert.equal(parsed.hits[0].projection.safe_description, description);
      } else {
        assert.equal(parsed.reason, 'CONTENT_BOUND'); assert.equal(parsed.hits.length, 0);
        // The fabricated AVAILABLE graph has correctly resealed identities: rejection must enforce disclosure bounds.
        assert.throws(() => parseTechnicalContextResult(technicalDto(f), orgA, binding.scope, technicalSpace, 20),
          (error: unknown) => error instanceof TechnicalTransportError && error.reason === 'MALFORMED_RESULT');
      }
    }
  });
  await check('representative P1-FRAME catalog/production vectors and H1 V1 remain frozen', async () => {
    assertFrameCatalog(JSON.parse(await pg.owner(frameCatalogSql)));
    for (const parts of [['RECIPE', 'a:b', 'é', '😀', '\u00a0', '\ufeff', '\u3000'], ['RECIPE', 'e\u0301'],
      ['RECIPE', 'BUSINESS_DOMAIN_ABSENT', '', 'WITHHELD', '', 'ABSENT', '', '', ''],
      ['RECIPE', 'BUSINESS_DOMAIN_PRESENT', 'WITHHELD', '', '', 'ABSENT', '', '', '']]) {
      const framed = await pg.owner(`SELECT encode(convert_to(gov_repo.frame_identity(ARRAY[${parts.map(lit).join(',')}]),'UTF8'),'hex')`);
      assert.equal(framed, Buffer.from(frameOperationalIdentity(parts)).toString('hex'));
      const sealed = await pg.owner(`SELECT encode(sha256(convert_to(gov_repo.frame_identity(ARRAY[${parts.map(lit).join(',')}]),'UTF8')),'hex')`);
      assert.equal(sealed, operationalIdentity(parts));
    }
    assert.notEqual(operationalIdentity(['RECIPE', 'é']), operationalIdentity(['RECIPE', 'e\u0301']));
    assertManifest(await collectManifest(pg.owner), frozen);
    assert.deepEqual(historicalMigrations(), frozen.migrations);
    t.diagnostic(`H1 V1 unchanged: ${frozen.sha256}; FRAME catalog and exact production UTF-8 vectors PASS`);
  });
});
