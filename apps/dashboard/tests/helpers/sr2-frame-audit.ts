import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readManifestFixture } from './sr2-dependency-manifest';

// Closed-world admission audit: new recipes require a new semantic review, not an
// automatic update of a snapshot. Read catalog expressions, never migration lines.
export const nullableSlots: Record<string, string[]> = {
  sr2_chunk_locators_v1: ['byte_start', 'byte_end', 'line_start', 'line_end'],
  sr2_subjects_v1: ['entry_id', 'snapshot_manifest_fingerprint', 'chunk_locator_id', 'symbol_locator_id'],
  sr2_source_admissions_v1: ['content_class'],
  sr2_dependency_facets_v1: ['observed_specification', 'resolved_version'],
  sr2_entrypoint_facets_v1: ['safe_signature'],
  sr2_operational_agent_observations_v1: ['business_domain_label', 'description_text',
    'related_system_record_id', 'related_system_code_label', 'related_system_name_label'],
};
export const legacyRequired = {
  agents: ['agent_code', 'name', 'description', 'agent_type'],
  ai_systems: ['system_code', 'name'],
};
export interface AuditCatalog {
  vector_schema: string;
  columns: { table: string; name: string; not_null: boolean; type: string }[];
  checks: { table: string; name: string; expression: string; definition: string }[];
  routines: { name: string; body: string; hash: string }[];
  triggers: { table: string; name: string; routine: string; enabled: string }[];
}
export const frameCatalogSql = `
SET search_path=pg_catalog,pg_temp;
SELECT jsonb_build_object(
 'vector_schema',(SELECT quote_ident(n.nspname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'not_null',a.attnotnull,
   'type',format_type(a.atttypid,a.atttypmod)) ORDER BY c.relname,a.attname)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  WHERE c.relnamespace='gov_repo'::regnamespace AND (starts_with(c.relname,'sr2_') OR c.relname IN ('agents','ai_systems'))
   AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'checks',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,
   'expression',pg_get_expr(c.conbin,c.conrelid),'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname)
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
  WHERE r.relnamespace='gov_repo'::regnamespace AND starts_with(r.relname,'sr2_') AND c.contype='c'),
 'routines',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'body',p.prosrc,
   'hash',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')) ORDER BY p.proname)
  FROM pg_proc p WHERE p.pronamespace='gov_repo'::regnamespace AND p.prosrc LIKE '%frame_identity%'
   AND (starts_with(p.proname,'sr2_') OR p.proname IN ('technical_semantic_context_search_v1','operational_agent_semantic_context_search_v1')
    OR EXISTS(SELECT FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
      WHERE t.tgfoid=p.oid AND r.relnamespace='gov_repo'::regnamespace AND starts_with(r.relname,'sr2_')))),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',t.tgname,'routine',p.proname,'enabled',t.tgenabled) ORDER BY t.tgname)
  FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE r.relnamespace='gov_repo'::regnamespace AND starts_with(r.relname,'sr2_') AND NOT t.tgisinternal)
)::text`;

/** Balanced call extraction handles nested ARRAYs, casts, CASE and quoted bytes. */
export function frameArguments(sql: string): string[] {
  const result: string[] = [];
  const call = /\b(?:gov_repo\.)?frame_identity\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = call.exec(sql))) {
    const start = call.lastIndex;
    let depth = 1, quoted = false, end = start;
    for (; end < sql.length; end++) {
      const c = sql[end];
      if (c === "'") {
        if (quoted && sql[end + 1] === "'") { end++; continue; }
        quoted = !quoted;
      } else if (!quoted) {
        if (c === '(') depth++;
        if (c === ')' && --depth === 0) break;
      }
    }
    assert.equal(depth, 0, 'balanced frame_identity catalog expression');
    result.push(sql.slice(start, end));
    call.lastIndex = end + 1;
  }
  return result;
}
const compact = (s: string) => s.replace(/::(?:text|uuid|bigint|integer)(?:\[\])?/g, '')
  .replace(/[()\s]/g, '').toLowerCase();

export function assertFrameCatalog(catalog: AuditCatalog) {
  const frozen = readManifestFixture();
  assert.equal(frozen.sha256, '1ffe97a7b69ae27909459433b4c44de5125dcc567d9758486e0896f5b0516880');
  const native = frozen.document.relations.filter(r => r.identity.startsWith('gov_repo.sr2_'));
  // Match H1's namespace-independent vector identifiers, without changing any
  // framed payload bytes. Actual expressions retain executable schema names.
  const normalize = (value: string) => ['vector','l2_normalize','cosine_distance','<=>'].reduce(
    (s, name) => s.replaceAll(`${catalog.vector_schema}.${name}`, `__vector__.${name}`), value);
  // All non-null inputs to dynamic trigger arrays/aggregates are covered too,
  // including columns without direct pg_depend edges from PL/pgSQL bodies.
  assert.deepEqual(catalog.columns.filter(c => c.table.startsWith('sr2_')).map(c => ({...c,type:normalize(c.type)})),
    native.flatMap(r => r.columns.map((c: any) => ({ table: r.identity.slice(9), name: c.name,
      not_null: c.not_null, type: c.type }))).sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)),
    'native identity input catalog/nullability admission');
  for (const [table, names] of Object.entries(legacyRequired)) for (const name of names)
    assert.equal(catalog.columns.find(c => c.table === table && c.name === name)?.not_null, true, `${table}.${name} NOT NULL`);
  for (const name of ['business_domain', 'ai_system_id'])
    assert.equal(catalog.columns.find(c => c.table === 'agents' && c.name === name)?.not_null, false, `agents.${name} requires marker`);

  const expectedChecks = native.flatMap(r => r.constraints.filter((c: any) => c.type === 'c')
    .map((c: any) => ({ table: r.identity.slice(9), name: c.name, definition: c.definition })));
  assert.deepEqual(catalog.checks.map(({ expression, ...c }) => ({...c,definition:normalize(c.definition)})).sort((a,b) => a.name.localeCompare(b.name)),
    expectedChecks.sort((a,b) => a.name.localeCompare(b.name)),
    'recipe inventory AND state/list validation CHECKs require semantic admission');
  for (const [table, fields] of Object.entries(nullableSlots)) {
    const nullable = catalog.columns.filter(c => c.table === table && !c.not_null).map(c => c.name).sort();
    assert.deepEqual(nullable, [...fields].sort(), `${table}: every nullable semantic slot classified`);
    const recipes = catalog.checks.filter(c => c.table === table).flatMap(c => frameArguments(c.expression));
    const recipe = compact(recipes.join('\n'));
    for (const field of fields) {
      assert.ok(recipe.includes(`coalesce${field},''`), `${table}.${field}: deterministic paired value`);
      if (table !== 'sr2_operational_agent_observations_v1') {
        assert.ok(recipe.includes(`casewhen${field}isnullthen'0'else'1'end`), `${table}.${field}: presence marker`);
      }
    }
    if (table === 'sr2_operational_agent_observations_v1') {
      assert.ok(recipe.includes("casewhenbusiness_domain_labelisnullthen'business_domain_absent'else'business_domain_present'end"));
      assert.ok(recipe.includes("description_disposition,coalescedescription_text,''"));
      assert.ok(recipe.includes("related_system_state,coalescerelated_system_record_id,''"));
      // c7/c8 are also pinned above: WITHHELD/ABSENT require NULL;
      // PROJECTED/PRESENT require a nonempty value, for all three system slots.
      assert.ok(catalog.checks.some(c => c.name === `${table}_c7`));
      assert.ok(catalog.checks.some(c => c.name === `${table}_c8`));
    }
  }
  const routineNames = ['sr2_manifest_lock_v1','sr2_source_set_lock_v1','sr2_projection_lock_v1',
    'sr2_manifest_integrity_v1','sr2_source_set_integrity_v1','sr2_projection_integrity_v1',
    'technical_semantic_context_search_v1','operational_agent_semantic_context_search_v1'].sort();
  assert.deepEqual(catalog.routines.map(r => r.name).sort(), routineNames, 'every trigger/read frame caller admitted');
  for (const routine of catalog.routines) {
    const expected = frozen.document.routines.find(r => r.identity.startsWith(`gov_repo.${routine.name}(`));
    assert.equal(createHash('sha256').update(normalize(routine.body.replaceAll('\r',''))).digest('hex'),
      expected?.body_sha256, `${routine.name}: reviewed array assembly/control flow`);
    assert.ok(frameArguments(routine.body).length, `${routine.name}: actual frame calls inspected`);
    if (routine.name.startsWith('sr2_')) {
      const triggers = catalog.triggers.filter(t => t.routine === routine.name);
      assert.ok(triggers.length, `${routine.name}: attached`);
      assert.ok(triggers.every(t => t.enabled === 'A'), `${routine.name}: ALWAYS enforcement`);
    }
  }
  const body = (name: string) => catalog.routines.find(r => r.name === name)!.body;
  // The dynamic recipes frame only NOT NULL row columns, count(*) and literal
  // markers. These pins preserve the guarded optional-row/collection branches.
  const projection = compact(body('sr2_projection_integrity_v1'));
  assert.ok(projection.includes("ifv_root.content_class='protected_context_v1'then"));
  assert.ok(projection.includes("elsev_parts:=v_parts||array['0'];endif"));
  assert.ok(projection.includes("ifnotfoundthenv_parts:=v_parts||array['0'];continue;endif"));
  assert.ok(projection.includes("v_parts:=v_parts||array['1',v_count,v_collection.collection_fingerprint]"));
  const operational = compact(body('operational_agent_semantic_context_search_v1'));
  for (const input of ['a.business_domain', 'a.ai_system_id'])
    assert.ok(operational.includes(`casewhen${input}isnullthen`), `live descriptor ${input} marker`);
  assert.ok(operational.includes("casewhena.ai_system_idisnullthen''elses.organisation_idend"));
  for (const input of ['s.system_code','s.name'])
    assert.ok(operational.includes(`coalesce${input},''`), `LEFT JOIN ${input}: paired related-system state`);
  // A missing/foreign related row is rejected before its descriptor is admitted.
  assert.match(body('operational_agent_semantic_context_search_v1'), /s\.system_id IS NULL/);
}
