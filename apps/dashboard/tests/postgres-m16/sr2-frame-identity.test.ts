import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operationalCluster, operationalFixture, operationalInsert, hash as operationalHash } from '../helpers/sr2-a3-fixtures';
import { repository, snapshot, chunk, subject, symbol, admission, sourceSet, facet, projection, inserts,
  keys, optional, list, frame, hash, lit, orgA, type Row } from '../helpers/sr2-a1-fixtures';
import { fixture } from '../helpers/semantic-retrieval-fixtures';
import { assertFrameCatalog, frameArguments, frameCatalogSql, nullableSlots, legacyRequired, type AuditCatalog } from '../helpers/sr2-frame-audit';
import { assertManifest, collectManifest, readManifestFixture } from '../helpers/sr2-dependency-manifest';

const arraySql = (values: (string | null)[]) => `ARRAY[${values.map(v => v === null ? 'NULL' : lit(v)).join(',')}]::text[]`;
// Decode by UTF-8 byte count, never JS code units or delimiter splitting.
function decode(value: string) {
  const bytes = Buffer.from(value), parts: string[] = [];
  let position = 0;
  while (position < bytes.length) {
    const colon = bytes.indexOf(58, position);
    assert.ok(colon > position);
    const length = Number(bytes.subarray(position, colon).toString('ascii'));
    assert.ok(Number.isSafeInteger(length) && length >= 0 && colon + 1 + length <= bytes.length);
    parts.push(bytes.subarray(colon + 1, colon + 1 + length).toString('utf8'));
    position = colon + 1 + length;
  }
  return parts;
}

test('P1-FRAME: primitive, catalog and exact nullable SQL/TS recipes', { timeout: 900000 }, async t => {
  const pg = await operationalCluster(message => t.diagnostic(message));
  t.after(() => pg.stop());
  const catalog = JSON.parse(await pg.owner(frameCatalogSql)) as AuditCatalog;
  const check = async (name: string, run: () => Promise<void>) => {
    let failure: unknown;
    await t.test(name, async () => { try { await run(); } catch (error) { failure = error; throw error; } });
    if (failure) throw failure;
  };
  const sqlFrame = async (parts: (string | null)[]) => JSON.parse(await pg.owner(
    `SELECT json_build_object('frame',gov_repo.frame_identity(${arraySql(parts)}))::text`)).frame as string | null;
  const recipe = (table: string, tag: string) => {
    const args = catalog.checks.filter(c => c.table === table).flatMap(c => frameArguments(c.expression))
      .filter(arg => arg.includes(`'${tag}'`));
    assert.equal(args.length, 1, `${table}/${tag}: exactly one actual catalog recipe`);
    return args[0];
  };
  const rowSource = (table: string, row: Row) =>
    `jsonb_populate_record(NULL::gov_repo.${table},${lit(JSON.stringify(row))}::jsonb)`;
  const parity = async (table: string, tag: string, row: Row, parts: unknown[]) => {
    const actual = JSON.parse(await pg.owner(`SELECT json_build_object('frame',gov_repo.frame_identity(${recipe(table, tag)}),
      'hash',encode(sha256(convert_to(gov_repo.frame_identity(${recipe(table, tag)}),'UTF8')),'hex'))::text
      FROM ${rowSource(table, row)}`));
    assert.equal(actual.frame, frame(parts), `${table}: exact framed bytes`);
    assert.equal(actual.hash, hash(parts), `${table}: SQL/TS SHA-256`);
    return actual.hash as string;
  };
  const validChecks = async (table: string, row: Row, semanticOnly = false) => {
    const predicates = catalog.checks.filter(c => c.table === table && (!semanticOnly || !frameArguments(c.expression).length))
      .map(c => `(${c.expression}) IS TRUE`);
    return await pg.owner(`SELECT (${predicates.join(' AND ')})::text FROM ${rowSource(table, row)}`) === 'true';
  };

  await check('primitive: dropped NULL positions, all-NULL, empty and byte-prefix decoding', async () => {
    const ordinary = await sqlFrame(['a', 'b']);
    assert.equal(await sqlFrame(['a', null, 'b']), ordinary);
    assert.equal(await sqlFrame(['a', 'b', null]), ordinary);
    assert.equal(await sqlFrame([null, null]), null);
    assert.equal(await sqlFrame([]), null);
    assert.equal(await sqlFrame(['']), '0:');
    assert.notEqual(await sqlFrame(['']), await sqlFrame([null]));
    assert.notEqual(await sqlFrame(['a|b','c']), await sqlFrame(['a','b|c']));
    const corpus = ['', ':', '0:', '12:abc', "a'b", 'a|b', 'é', 'e\u0301', '😀', '\n', '\\', ' trailing '];
    const sequences = [...corpus.map(s => [s]), ...corpus.flatMap(a => corpus.map(b => [a,b]))];
    const framed = JSON.parse(await pg.owner(`SELECT json_agg(gov_repo.frame_identity(ARRAY(
      SELECT jsonb_array_elements_text(value))))::text FROM jsonb_array_elements(${lit(JSON.stringify(sequences))}::jsonb)`));
    assert.equal(new Set(framed).size, sequences.length);
    framed.forEach((value: string, i: number) => { assert.equal(value, frame(sequences[i])); assert.deepEqual(decode(value), sequences[i]); });
    assert.notEqual(await sqlFrame(['é']), await sqlFrame(['e\u0301']), 'no Unicode normalization');
  });

  await check('catalog: exhaustive CHECK/trigger/read admission and all 12 A1 + 5 A3 nullable slots', async () => {
    assertFrameCatalog(catalog);
    assert.equal(Object.entries(nullableSlots).filter(([table]) => !table.includes('operational')).reduce((n,[,v]) => n+v.length,0), 12);
    assert.equal(nullableSlots.sr2_operational_agent_observations_v1.length, 5);
    t.diagnostic(`CATALOG: ${catalog.checks.filter(c => frameArguments(c.expression).length).length} frame CHECKs; ${catalog.routines.length} trigger/read callers`);
  });
  await check('legacy source: six NOT NULL inputs and two marker-protected nullable inputs', async () => {
    for (const [table, fields] of Object.entries(legacyRequired)) for (const field of fields) {
      const altered = JSON.parse(await pg.owner(`BEGIN; ALTER TABLE gov_repo.${table} ALTER COLUMN ${field} DROP NOT NULL;
        ${frameCatalogSql}; ROLLBACK;`));
      assert.throws(() => assertFrameCatalog(altered), new RegExp(`${table}.${field} NOT NULL`));
    }
    assertFrameCatalog(JSON.parse(await pg.owner(frameCatalogSql)));
  });
  await check('negative controls: new unmarked slot, removed marker and disabled trigger are refused', async () => {
    const altered = JSON.parse(await pg.owner(`BEGIN;
      ALTER TABLE gov_repo.sr2_projections_v1 ADD COLUMN future_nullable text;
      ALTER TABLE gov_repo.sr2_projections_v1 ADD CONSTRAINT future_unmarked CHECK
        (gov_repo.frame_identity(ARRAY[safe_label,future_nullable,safe_description]) IS NOT NULL);
      ${frameCatalogSql}; ROLLBACK;`));
    assert.throws(() => assertFrameCatalog(altered), /catalog\/nullability admission/);
    const original = catalog.checks.find(c => c.name === 'sr2_subjects_v1_c3')!;
    const changed = original.expression.replace(/CASE\s+WHEN \(entry_id IS NULL\) THEN '0'::text\s+ELSE '1'::text\s+END/, "'0'::text");
    assert.notEqual(changed, original.expression, 'negative control actually removes the presence marker');
    const unmarked = JSON.parse(await pg.owner(`BEGIN; ALTER TABLE gov_repo.sr2_subjects_v1 DROP CONSTRAINT ${original.name};
      ALTER TABLE gov_repo.sr2_subjects_v1 ADD CONSTRAINT ${original.name} CHECK (${changed}); ${frameCatalogSql}; ROLLBACK;`));
    assert.throws(() => assertFrameCatalog(unmarked), /semantic admission/);
    const disabled = JSON.parse(await pg.owner(`BEGIN; ALTER TABLE gov_repo.sr2_snapshots_v1 DISABLE TRIGGER USER;
      ${frameCatalogSql}; ROLLBACK;`));
    assert.throws(() => assertFrameCatalog(disabled), /ALWAYS enforcement/);
  });

  const root = repository(orgA, 'frame-repo', 'frame-connection');
  const s = snapshot(root.row, 2, '1'.repeat(40), 'GIT_SHA1_V1');
  const ground = sourceSet(s, [s.subjects[0]], 'ITEM_GROUNDING_V1', s.subjects[0]);
  const chunkParts = (r: Row) => ['GOVIA_SR2_CHUNK_LOCATOR_V1',...keys(r),r.entry_id,r.source_fingerprint,r.locator_class,
    ...['byte_start','byte_end','line_start','line_end'].flatMap(k => optional(r[k])),r.decoding_id,r.chunker_id,r.chunker_version];
  const subjectParts = (r: Row) => ['GOVIA_SR2_SUBJECT_V1',...keys(r),r.subject_family,r.source_fingerprint,
    ...['entry_id','snapshot_manifest_fingerprint','chunk_locator_id','symbol_locator_id'].flatMap(k => optional(r[k]))];
  const admissionParts = (r: Row) => ['GOVIA_SR2_ADMISSION_BASIS_V1',...keys(r),r.entry_id,
    r.admission_recipe_id,r.admission_recipe_version,r.policy_profile_id,r.policy_profile_version,r.outcome,
    ...optional(r.content_class),r.reason_code,r.protected_eligible?'1':'0'];
  const facetParts = (r: Row, fields: string[]) => ['GOVIA_SR2_FACET_PAYLOAD_V1',r.facet_kind,r.item_key,r.grounding_set_id,
    r.scope_kind,r.anchor_subject_id,r.method_code,r.method_version,...list(r.limitations),
    ...fields.flatMap(k => ['observed_specification','resolved_version','safe_signature'].includes(k)?optional(r[k]):Array.isArray(r[k])?list(r[k]):[r[k]])];
  const pair = async (table: string, tag: string, field: string, absent: Row, present: Row, parts: (r: Row) => unknown[], id: string) => {
    assert.equal(absent[field], null, `${table}.${field}: NULL case`);
    assert.notEqual(present[field], null, `${table}.${field}: PRESENT case`);
    assert.ok(await validChecks(table, absent), `${table}.${field}: valid NULL state`);
    assert.ok(await validChecks(table, present), `${table}.${field}: valid PRESENT state`);
    const a = await parity(table, tag, absent, parts(absent)), b = await parity(table, tag, present, parts(present));
    assert.notEqual(a,b, `${table}.${field}: NULL and PRESENT identities`);
    // Isolate the marker's contribution with every other encoded byte fixed.
    // Some isolated rows are outside the admitted union; valid union rows above
    // prove representability separately. Empty references are checked by their
    // FK targets below; descriptive empties are rejected by local CHECKs.
    const isolated = {...present, [field]:null};
    assert.notEqual(await parity(table, tag, isolated, parts(isolated)), b);
    if (table==='sr2_operational_agent_observations_v1' && field!=='business_domain_label')
      assert.equal(await validChecks(table,isolated,true),false,`${field}: PRESENT marker cannot admit NULL`);
    const type = catalog.columns.find(c => c.table===table && c.name===field)!.type;
    if (type === 'text') {
      const empty = {...present,[field]:''};
      const nullOnly = {...empty,[field]:null};
      // A3 uses a semantic state marker for description/system fields, rather
      // than a per-field CASE. NULL must travel with its admitted absent state.
      if (table==='sr2_operational_agent_observations_v1') {
        if (field==='description_text') nullOnly.description_disposition='WITHHELD';
        if (field.startsWith('related_system_')) nullOnly.related_system_state='ABSENT';
      }
      assert.notEqual(await parity(table,tag,empty,parts(empty)), await parity(table,tag,nullOnly,parts(nullOnly)), 'marker distinguishes NULL from empty bytes');
      empty[id] = hash(parts(empty));
      const fkReference = table==='sr2_subjects_v1' && ['entry_id','chunk_locator_id','symbol_locator_id'].includes(field);
      assert.equal(await validChecks(table,empty,true),fkReference, `${table}.${field}: empty ${fkReference?'requires FK rejection':'is CHECK-prohibited'}`);
    }
  };
  await check('SQL/TS A1 golden vectors: each of 12 nullable positions, valid unions and marker isolation', async () => {
    for (const field of nullableSlots.sr2_chunk_locators_v1)
      await pair('sr2_chunk_locators_v1','GOVIA_SR2_CHUNK_LOCATOR_V1',field,chunk(s.entries[0]),chunk(s.entries[0],'CODE_REGION'),chunkParts,'locator_id');
    const sym = symbol(s.entries[0]);
    const codeSubject = subject(s.k,'CODE_SYMBOL',s.entries[0].source_fingerprint,s.entries[0].entry_id,null,null,sym.locator_id);
    for (const field of nullableSlots.sr2_subjects_v1) {
      const variants = [s.rootSubject,s.subjects[0],codeSubject];
      await pair('sr2_subjects_v1','GOVIA_SR2_SUBJECT_V1',field,variants.find(r=>r[field]===null)!,variants.find(r=>r[field]!==null)!,subjectParts,'subject_id');
    }
    await pair('sr2_source_admissions_v1','GOVIA_SR2_ADMISSION_BASIS_V1','content_class',
      admission(s.entries[0],s.capture,'REJECTED'),admission(s.entries[0],s.capture),admissionParts,'admission_basis_fingerprint');
    const fields = ['ecosystem','dependency_name','resolution_key','dependency_role','observed_specification','resolved_version'];
    for (const field of ['observed_specification','resolved_version']) {
      const absent = facet(s.k,s.rootSubject,ground.row,2,'a',{method_code:'FILENAME_HEURISTIC',resolution_key:'UNRESOLVED',observed_specification:null,resolved_version:null}).row;
      const present = facet(s.k,s.rootSubject,ground.row,2,'a',{method_code:'LOCKFILE_OBSERVED',observed_specification:' ^1:é ',resolved_version:'1.0.0'}).row;
      await pair('sr2_dependency_facets_v1','GOVIA_SR2_FACET_PAYLOAD_V1',field,absent,present,r=>facetParts(r,fields),'payload_fingerprint');
    }
    await pair('sr2_entrypoint_facets_v1','GOVIA_SR2_FACET_PAYLOAD_V1','safe_signature',
      facet(s.k,s.rootSubject,ground.row,7,'a',{safe_signature:null}).row,
      facet(s.k,s.rootSubject,ground.row,7,'a',{safe_signature:' call(é:😀) '}).row,
      r=>facetParts(r,['entrypoint_key','entrypoint_kind','safe_signature','invocation_shape']),'payload_fingerprint');
  });

  await pg.bootstrapSql(`BEGIN;SET LOCAL session_replication_role=replica;${fixture}COMMIT;`);
  const actor = await pg.actor(orgA);
  const operationalParts = (r: Row) => ['GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1','1',r.organisation_id,r.source_record_id,r.subject_id,
    r.projection_schema_version,r.handling_recipe_id,r.handling_recipe_version,r.document_recipe,r.agent_code_label,r.agent_name_label,r.agent_type,
    r.business_domain_label===null?'BUSINESS_DOMAIN_ABSENT':'BUSINESS_DOMAIN_PRESENT',r.business_domain_label??'',
    r.description_disposition,r.description_text??'',r.related_system_state,r.related_system_record_id??'',r.related_system_code_label??'',r.related_system_name_label??''];
  await check('SQL/TS A3 golden vectors: all five nullable positions and correlated related-system state', async () => {
    const absent = operationalFixture(actor,{related:false,business_domain:null,description_disposition:'WITHHELD',description_text:null}).observation;
    const present = operationalFixture(actor,{business_domain:' Ops:é ',description_text:' Exact 😀 bytes ',system_code:'SYS:é',system_name:' Name 😀 '}).observation;
    for (const field of nullableSlots.sr2_operational_agent_observations_v1)
      await pair('sr2_operational_agent_observations_v1','GOVIA_SR2_OPERATIONAL_AGENT_PROJECTION_V1',field,absent,present,operationalParts,'projection_id');
    // Full real CHECK/FK/trigger admission also accepts both nullable union shapes.
    await pg.owner(operationalFixture(actor,{related:false,business_domain:null,description_disposition:'WITHHELD',description_text:null}).sql);
    await pg.owner(operationalFixture(actor,{business_domain:' Ops:é ',description_text:' Exact 😀 bytes '}).sql);
    assert.equal(operationalHash(operationalParts(present)),present.projection_id);
  });
  await check('legacy descriptor SQL/TS: nullable domain permits present-empty; related LEFT JOIN is state-framed', async () => {
    const body = catalog.routines.find(r=>r.name==='operational_agent_semantic_context_search_v1')!.body;
    const args = frameArguments(body).find(a=>a.includes("'GOVIA_SR2_OPERATIONAL_AGENT_SOURCE_DESCRIPTOR_V1'"))!;
    const results: string[] = [];
    const source = operationalFixture(actor,{business_domain:null,related:false,agent_code:'FRAME-DOMAIN'});
    await pg.owner(operationalInsert('agents',{...source.agent,owner_user_id:actor.id,created_by:actor.id}));
    for (const domain of [null,'',' Ops:é ']) {
      const f = operationalFixture(actor,{source_record_id:source.agent.agent_id,agent_code:'FRAME-DOMAIN',business_domain:domain,related:false});
      // Empty is representable in the legacy source, while the projected A3
      // business-domain label deliberately requires a nonempty value.
      await pg.owner(`UPDATE gov_repo.agents SET business_domain=${domain===null?'NULL':lit(domain)} WHERE agent_id=${lit(source.agent.agent_id)}`);
      const sql = await pg.owner(`SELECT encode(sha256(convert_to(gov_repo.frame_identity(${args}),'UTF8')),'hex')
        FROM gov_repo.agents a LEFT JOIN gov_repo.ai_systems s ON s.system_id=a.ai_system_id
        CROSS JOIN (SELECT ${lit(orgA)}::uuid AS v_org) binding WHERE a.agent_id=${lit(f.agent.agent_id)}`);
      assert.equal(sql,f.observation.source_descriptor_fingerprint);
      results.push(sql); // Same source identity; only the nullable domain changes.
    }
    assert.equal(new Set(results).size,3);
  });

  await check('lists: required container/count, NULL elements rejected, exact ordered payloads', async () => {
    for (const value of ['NULL::text[]',"ARRAY['a',NULL,'b']::text[]", "ARRAY[NULL]::text[]", "ARRAY['']::text[]", "ARRAY['  ']::text[]", "'[0:1]={a,b}'::text[]", "ARRAY[['a','b']]::text[]"])
      assert.equal(await pg.owner(`SELECT gov_repo.sr2_list_valid_v1(${value},20)::text`),'false',value);
    for (const value of ["ARRAY[]::text[]","ARRAY['a','b']::text[]"])
      assert.equal(await pg.owner(`SELECT gov_repo.sr2_list_valid_v1(${value},20)::text`),'true',value);
    const cases = [
      {table:'sr2_source_sets_v1',field:'limitations',row:sourceSet(s).row},
      ...[0,1,6,7].map(i=>({table:`sr2_${['module','service','','','','','agent','entrypoint'][i]}_facets_v1`,field:'limitations',row:facet(s.k,s.rootSubject,ground.row,i).row})),
      ...[[1,'capabilities','service'],[6,'behaviors','agent'],[7,'invocation_shape','entrypoint']].map(([i,field,name])=>
        ({table:`sr2_${name}_facets_v1`,field:String(field),row:facet(s.k,s.rootSubject,ground.row,Number(i)).row})),
    ];
    for (const {table,field,row} of cases) {
      assert.equal(catalog.columns.find(c=>c.table===table && c.name===field)?.not_null,true,`${table}.${field} container`);
      const args = catalog.checks.filter(c=>c.table===table).flatMap(c=>frameArguments(c.expression)).find(a=>a.includes(`cardinality(${field})`))!;
      assert.ok(args,`${table}.${field}: length framed`);
      const values = [[],['a:é',' b😀 '],[' b😀 ','a:é']];
      const frames: string[] = [];
      for (const xs of values) {
        const actual = JSON.parse(await pg.owner(`SELECT json_build_object('frame',gov_repo.frame_identity(${args}))::text
          FROM ${rowSource(table,{...row,[field]:xs})}`)).frame as string;
        assert.ok(actual.includes(frame(list(xs))),`${table}.${field}: exact counted list bytes`); frames.push(actual);
      }
      assert.equal(new Set(frames).size,3,`${table}.${field}: empty/count/order are significant`);
      const validator = catalog.checks.filter(c=>c.table===table).find(c=>c.expression.includes(`sr2_list_valid_v1(${field},`))!;
      assert.ok(validator);
      for (const xs of [null,['a',null,'b']])
        assert.equal(await pg.owner(`SELECT ((${validator.expression}) IS TRUE)::text FROM ${rowSource(table,{...row,[field]:xs})}`),'false',`${table}.${field} validation`);
    }
    // Representative durable A1 assembly, including list-bearing facets.
    const primary = sourceSet(s), admits = s.entries.map(e=>admission(e,s.capture));
    const items = [1,6,7].map(i=>facet(s.k,s.rootSubject,ground.row,i,'lists',
      {limitations:['first','second'],...i===1?{capabilities:['read','write']}:i===6?{behaviors:['observe','report']}:{invocation_shape:['input','output']}}));
    const p = projection(s,primary.row,admits,items);
    await pg.owner('BEGIN;'+root.sql+inserts([...s.rows,...admits.map(row=>({table:'source_admissions',row})),...primary.rows,...ground.rows,...p.rows])+'COMMIT;');
    const sym=symbol(s.entries[0]);
    const code=subject(s.k,'CODE_SYMBOL',s.entries[0].source_fingerprint,s.entries[0].entry_id,null,null,sym.locator_id);
    await pg.owner(inserts([{table:'symbol_locators',row:sym},{table:'subjects',row:code}]));
    for (const field of ['entry_id','chunk_locator_id','symbol_locator_id']) {
      const original=field==='symbol_locator_id'?code:s.subjects[0];
      const empty={...original,[field]:''}; empty.subject_id=hash(subjectParts(empty));
      await assert.rejects(pg.owner(inserts([{table:'subjects',row:empty}])),/23503/,`${field}: otherwise-valid empty reference rejected by FK`);
    }
  });
  await check('H1 V1 complete document/hash and A3 catalog remain unchanged after all local probes', async () => {
    assertManifest(await collectManifest(pg.owner),readManifestFixture());
    assertFrameCatalog(JSON.parse(await pg.owner(frameCatalogSql)));
  });
});
