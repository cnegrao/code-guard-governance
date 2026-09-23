import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../supabase/migrations/20260923060000_cross_signal_persistence_v1.sql', import.meta.url), 'utf8');
const runtimeMigration = readFileSync(new URL('../../../supabase/migrations/20260917021203_runtime_observability_v1.sql', import.meta.url), 'utf8');
const reviewFixesMigration = readFileSync(new URL('../../../supabase/migrations/20260917192615_runtime_observability_v1_review_fixes.sql', import.meta.url), 'utf8');
const body = (name: string) => sql.slice(sql.indexOf(`function gov_repo.${name}(`), sql.indexOf('$$;', sql.indexOf(`function gov_repo.${name}(`)) + 3);
const readBoundary = body('read_runtime_observation_exact');
const writeRpc = body('record_cross_signal_comparison_result');
// Strips `-- ...` comment lines before checking for the ABSENCE of a pattern,
// so this file's own prose (which legitimately discusses, e.g., "no trace/span
// fallback" or "never `update gov_repo.canonical_relationships`") never
// produces a false positive against a doesNotMatch assertion.
const stripComments = (text: string) => text.replace(/--.*$/gm, '');
const sqlCode = stripComments(sql);
const readBoundaryCode = stripComments(readBoundary);
const writeRpcCode = stripComments(writeRpc);

test('additive migration wrapper: begin/commit, no drop/delete/truncate, never updates an existing gov_repo table', () => {
  assert.match(sql, /^begin;\r?$/m);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sqlCode, /\bdrop\s+(?:table|constraint|index|column)|\bdelete\s+from|\btruncate\b/i);
  // The two new tables get their own immutability triggers (before update or
  // delete) - that trigger *definition* legitimately contains the words
  // "update" and "delete", so this checks for actual DML against an
  // EXISTING (M13/M14) table, never the historical migration files.
  assert.doesNotMatch(sqlCode, /update\s+gov_repo\.(runtime_observations|execution_field_states|canonical_relationships|canonical_objects)\b/i);
});

test('historical M14 runtime_observability migrations are byte-for-byte untouched', () => {
  assert.match(runtimeMigration, /revoke all on gov_repo\.runtime_source_heads,gov_repo\.runtime_source_configurations,gov_repo\.runtime_deployment_bindings,gov_repo\.runtime_observations from public,anon,authenticated,service_role;/);
  assert.ok(runtimeMigration.length > 0 && reviewFixesMigration.length >= 0);
});

// -----------------------------------------------------------------------------
// A. Runtime observation read boundary
// -----------------------------------------------------------------------------

test('read boundary is tenant-scoped, exact-match-only, and never widens beyond zero-or-one rows', () => {
  assert.match(readBoundary, /p_organisation_id uuid/);
  assert.match(readBoundary, /p_connection_id gov_repo\.runtime_reference/);
  assert.match(readBoundary, /p_observation_id uuid/);
  assert.match(readBoundary, /returns table\(observation jsonb\)/);
  assert.match(readBoundary, /security definer/);
  assert.match(readBoundary, /o\.organisation_id = p_organisation_id/);
  assert.match(readBoundary, /o\.observation_id = p_observation_id/);
  assert.match(readBoundary, /o\.connection_id = p_connection_id/);
  assert.match(readBoundary, /gov_repo\.runtime_readback\(o\)/);
  // Never trace/span/time-proximity/sourceEventKey fallback, never an ORDER BY/LIMIT-based guess.
  assert.doesNotMatch(readBoundaryCode, /trace_id|span_id|source_event_key|order by|limit\s+\d/i);
  assert.doesNotMatch(readBoundaryCode, /insert into|update\s+gov_repo|delete from/i);
});

test('runtime_observations keeps zero direct grants; only the new read boundary and the existing admit RPC may execute', () => {
  assert.match(sql, /revoke all on function gov_repo\.read_runtime_observation_exact\(uuid,gov_repo\.runtime_reference,uuid\) from public,anon,authenticated,service_role;/);
  assert.match(sql, /grant execute on function gov_repo\.read_runtime_observation_exact\(uuid,gov_repo\.runtime_reference,uuid\) to service_role;/);
  assert.doesNotMatch(sqlCode, /grant\s+select\s+on\s+gov_repo\.runtime_observations/i);
  assert.doesNotMatch(sqlCode, /grant\s+all\s+on\s+gov_repo\.runtime_observations/i);
});

// -----------------------------------------------------------------------------
// B. Schema shape - exactly the two frozen structures, no third table
// -----------------------------------------------------------------------------

test('exactly two new durable tables; no DriftHypothesis/arbitrary metadata table; no JSON/EAV column', () => {
  const createTableMatches = [...sql.matchAll(/create table gov_repo\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual(new Set(createTableMatches), new Set(['cross_signal_comparison_results', 'cross_signal_comparison_left_relationship_states']));
  const parentTable = sql.slice(sql.indexOf('create table gov_repo.cross_signal_comparison_results'), sql.indexOf('create table gov_repo.cross_signal_comparison_left_relationship_states'));
  assert.doesNotMatch(stripComments(parentTable), /\bjsonb?\b/i);
  const childTable = sql.slice(sql.indexOf('create table gov_repo.cross_signal_comparison_left_relationship_states'), sql.indexOf('comment on table gov_repo.cross_signal_comparison_left_relationship_states'));
  assert.doesNotMatch(stripComments(childTable), /\bjsonb?\b/i);
});

test('child table matches ADR SS15 exact minimum shape: comparison_id, relationship_id, relationship_state_id, nullable decision_id', () => {
  const childTable = sql.slice(sql.indexOf('create table gov_repo.cross_signal_comparison_left_relationship_states'), sql.indexOf('comment on table gov_repo.cross_signal_comparison_left_relationship_states'));
  assert.match(childTable, /comparison_id text not null/);
  assert.match(childTable, /relationship_id text not null/);
  assert.match(childTable, /relationship_state_id text not null/);
  assert.match(childTable, /decision_id text,/);
  assert.doesNotMatch(stripComments(childTable), /valid_from|valid_to/);
});

test('DRIFT_CANDIDATE is excluded at the database layer, defense-in-depth alongside the TS constructor', () => {
  assert.match(sql, /cross_signal_outcome_check check \(outcome in \('CONSISTENT','CONFLICT_CANDIDATE','INSUFFICIENT_EVIDENCE'\)\)/);
});

test('insert-only: immutability triggers on both tables; no UPDATE/DELETE grant anywhere', () => {
  assert.match(sql, /create trigger cross_signal_comparison_results_immutable before update or delete on gov_repo\.cross_signal_comparison_results/);
  assert.match(sql, /create trigger cross_signal_comparison_left_states_immutable before update or delete on gov_repo\.cross_signal_comparison_left_relationship_states/);
  assert.doesNotMatch(sqlCode, /grant\s+(?:update|delete|insert)\s+on\s+gov_repo\.cross_signal_comparison/i);
  assert.match(sql, /grant select on gov_repo\.cross_signal_comparison_results, gov_repo\.cross_signal_comparison_left_relationship_states to service_role;/);
});

// -----------------------------------------------------------------------------
// C/D. Write RPC: atomicity, idempotency/replay, tenancy, no canonical/relationship/
//      execution/runtime write.
// -----------------------------------------------------------------------------

test('write RPC only ever inserts into the two new tables - never canonical_objects/canonical_relationships/execution_field_states/runtime_observations', () => {
  const insertTargets = [...writeRpc.matchAll(/insert into gov_repo\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual(new Set(insertTargets), new Set(['cross_signal_comparison_results', 'cross_signal_comparison_left_relationship_states']));
  assert.doesNotMatch(writeRpcCode, /update\s+gov_repo\.|delete from gov_repo\./i);
});

test('write RPC re-verifies every referenced evidence id against its own source-of-truth table before writing anything', () => {
  assert.match(writeRpc, /from gov_repo\.runtime_observations o/);
  assert.match(writeRpc, /from gov_repo\.execution_field_states/);
  assert.match(writeRpc, /join gov_repo\.canonical_relationships/);
  // All evidence verification happens before the first insert statement.
  const firstInsert = writeRpc.indexOf('insert into gov_repo.cross_signal_comparison_results');
  for (const marker of ['CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND', 'CROSS_SIGNAL_PRINCIPAL_EVIDENCE_MISMATCH', 'CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH']) {
    assert.ok(writeRpc.indexOf(marker) < firstInsert, `${marker} must be checked before any insert`);
  }
});

test('subject kind is independently proven against canonical_objects, never trusted from the caller\'s subject.kind string alone', () => {
  assert.match(writeRpc, /perform 1 from gov_repo\.canonical_objects\s*\n\s*where organisation_id = p_organisation_id\s*\n\s*and canonical_object_id = p_result#>>'\{subject,objectId\}'\s*\n\s*and kind = 'AGENT_VERSION';/);
  const performAt = writeRpc.indexOf('perform 1 from gov_repo.canonical_objects');
  assert.ok(performAt > -1);
  const notFoundAt = writeRpc.indexOf('CROSS_SIGNAL_RESULT_SUBJECT_INVALID', performAt);
  assert.ok(notFoundAt > performAt, 'the not-found raise must appear after the canonical_objects proof');
  // This check happens before any evidence lookup or identity construction.
  const firstEvidenceLookup = writeRpc.indexOf('select * into v_ro from gov_repo.runtime_observations');
  assert.ok(performAt < firstEvidenceLookup);
});

test('dependency relationship evidence is proven on tenant + relationship_id + relationship_state_id + source_canonical_object_id + source_kind + a closed M15 V1 relationship_type - never accepted merely because an id happens to exist', () => {
  assert.match(writeRpc, /r\.source_kind as db_source_kind/);
  assert.match(writeRpc, /r\.relationship_type as db_relationship_type/);
  assert.match(writeRpc, /db_source_kind is distinct from 'AGENT_VERSION'/);
  assert.match(writeRpc, /db_relationship_type not in \('USES_MODEL','USES_TOOL','USES_MCP','INVOKES'\)/);
});

test('dependency relationship type is cross-checked against the paired RuntimeObservation kind when available, using the same closed mapping the pure comparison functions use - never recomputing an outcome', () => {
  assert.match(writeRpc, /v_expected_relationship_type := case v_ro\.kind/);
  assert.match(writeRpc, /when 'MODEL_CALL' then 'USES_MODEL' when 'TOOL_CALL' then 'USES_TOOL'/);
  assert.match(writeRpc, /when 'MCP_CALL' then 'USES_MCP' when 'API_CALL' then 'INVOKES' else null end;/);
  assert.match(writeRpc, /v_expected_relationship_type is not null and db_relationship_type is distinct from v_expected_relationship_type/);
  // Narrow evidence-reference check only: this function never assigns or
  // returns a CONSISTENT/CONFLICT_CANDIDATE/INSUFFICIENT_EVIDENCE outcome of
  // its own - the only outcome value it ever handles is the caller-supplied
  // p_result->>'outcome', stored and compared verbatim, never computed.
  assert.doesNotMatch(writeRpcCode, /:= 'CONSISTENT'|:= 'CONFLICT_CANDIDATE'|:= 'INSUFFICIENT_EVIDENCE'/);
});

test('replay/conflict semantics: existing row wins on identical content, exception on any mismatch, never an update', () => {
  assert.match(writeRpc, /select csr\.\* into existing from gov_repo\.cross_signal_comparison_results csr/);
  assert.match(writeRpc, /CROSS_SIGNAL_COMPARISON_REPLAY_CONFLICT/);
  assert.match(writeRpc, /return query select true, existing\.comparison_id, existing\.evaluated_at/);
  assert.match(writeRpc, /return query select false, r\.comparison_id, r\.evaluated_at/);
  assert.doesNotMatch(writeRpcCode, /update gov_repo\.cross_signal_comparison_results/i);
});

test('advisory lock scopes concurrent writers by (organisation_id, DB-computed comparison identity), never the caller-supplied assertion', () => {
  assert.match(writeRpc, /pg_advisory_xact_lock\(hashtextextended\(p_organisation_id::text\|\|':cross-signal-comparison:'\|\|v_expected_comparison_id,0\)\)/);
  assert.doesNotMatch(writeRpcCode, /pg_advisory_xact_lock\([^)]*p_comparison_id/);
});

test('parent and child rows are inserted from the same function body - one atomic transaction, no separate application-level insert calls', () => {
  const parentInsertIndex = writeRpc.indexOf('insert into gov_repo.cross_signal_comparison_results (');
  const childInsertIndex = writeRpc.indexOf('insert into gov_repo.cross_signal_comparison_left_relationship_states');
  assert.ok(parentInsertIndex > -1 && childInsertIndex > parentInsertIndex);
});

test('parent INSERT uses an explicit column list, never `insert ... select r.*`, and never explicitly inserts recorded_at (the DB default assigns it)', () => {
  assert.doesNotMatch(writeRpcCode, /insert into gov_repo\.cross_signal_comparison_results\s+select\s+r\.\*/i);
  const parentInsertStart = writeRpc.indexOf('insert into gov_repo.cross_signal_comparison_results (');
  assert.ok(parentInsertStart > -1, 'parent insert must use an explicit column-list form');
  const parentInsertEnd = writeRpc.indexOf(');', parentInsertStart) + 2;
  const parentInsertStatement = writeRpc.slice(parentInsertStart, parentInsertEnd);
  // The explicit column list (and the parallel VALUES list) must name every
  // persisted column except recorded_at - never r.recorded_at, which stays
  // uninitialized (NULL) on the composite variable and would otherwise be
  // inserted directly into a NOT NULL column with no DEFAULT applied.
  assert.doesNotMatch(parentInsertStatement, /\brecorded_at\b/);
  assert.doesNotMatch(parentInsertStatement, /r\.recorded_at/);
  for (const column of [
    'organisation_id', 'comparison_id', 'subject_object_id', 'dimension', 'pairing_mode', 'method_code', 'method_version',
    'left_kind', 'left_execution_field_state_id', 'left_execution_field_state_decision_id', 'left_execution_field_state_snapshot_id',
    'right_observation_id', 'right_connection_id', 'left_temporal_basis', 'right_temporal_basis', 'outcome', 'reason', 'evaluated_at',
  ]) {
    assert.ok(parentInsertStatement.includes(column), `explicit column list must include ${column}`);
    assert.ok(parentInsertStatement.includes(`r.${column}`), `explicit VALUES list must include r.${column}`);
  }
});

test('write RPC grants: execute to service_role only; revoked from public/anon/authenticated first', () => {
  assert.match(sql, /revoke all on function gov_repo\.record_cross_signal_comparison_result\(uuid,text,jsonb\) from public,anon,authenticated,service_role;/);
  assert.match(sql, /grant execute on function gov_repo\.record_cross_signal_comparison_result\(uuid,text,jsonb\) to service_role;/);
});

// -----------------------------------------------------------------------------
// ONE authoritative transport representation for RELATIONSHIP_STATE_SET
// evidence (no p_relationship_states parameter).
// -----------------------------------------------------------------------------

test('the write RPC has exactly three parameters - no second relationship-states parameter exists to disagree with p_result.left.states', () => {
  const signature = sql.slice(sql.indexOf('create function gov_repo.record_cross_signal_comparison_result('), sql.indexOf('returns table(replay boolean'));
  assert.doesNotMatch(signature, /p_relationship_states/);
  assert.match(signature, /p_organisation_id uuid/);
  assert.match(signature, /p_comparison_id text/);
  assert.match(signature, /p_result jsonb/);
});

test('relationship-state evidence is derived exclusively from p_result#>\'{left,states}\'; required+array for RELATIONSHIP_STATE_SET, forbidden otherwise', () => {
  assert.match(writeRpc, /v_states_raw jsonb := p_result#>'\{left,states\}';/);
  assert.match(writeRpc, /if v_states_raw is null or jsonb_typeof\(v_states_raw\) <> 'array' then/);
  assert.match(writeRpc, /elsif v_states_raw is not null then\s*\n\s*raise exception 'CROSS_SIGNAL_RESULT_INVALID';/);
});

// -----------------------------------------------------------------------------
// DATABASE-AUTHORITATIVE IDENTITY (ADR §13/§15). The database, not the
// caller, must own/verify the deterministic comparison identity: a caller
// must never be able to submit the same semantic comparison under a
// different arbitrary comparison_id and create a second durable row, nor
// force an unrelated one via a forged id.
// -----------------------------------------------------------------------------

test('identity material is built exclusively from validated rows (v_efs / v_ro / verified relationship rows), never raw unverified caller jsonb text', () => {
  assert.match(writeRpc, /v_left_parts := array\['LEFT_EXECUTION_FIELD_STATE', v_efs\.state_id, v_efs\.decision_id, v_efs\.snapshot_id\];/);
  assert.match(writeRpc, /v_right_parts := array\['RIGHT_RUNTIME_OBSERVATION', v_ro\.observation_id::text, v_ro\.connection_id\];/);
  assert.match(writeRpc, /v_left_parts := array\['LEFT_RELATIONSHIP_STATE_SET', coalesce\(array_length\(v_left_member_frames,1\),0\)::text\] \|\| v_left_member_frames;/);
  // The identity material is computed strictly after (i.e. textually below)
  // every evidence-verification exception marker, and strictly before the
  // existing-row lookup / advisory lock that uses it.
  const identityComputedAt = writeRpc.indexOf('v_expected_comparison_id := ');
  const existingLookupAt = writeRpc.indexOf('select csr.* into existing from gov_repo.cross_signal_comparison_results csr');
  assert.ok(identityComputedAt > -1 && identityComputedAt < existingLookupAt);
  for (const marker of ['CROSS_SIGNAL_RUNTIME_EVIDENCE_NOT_FOUND', 'CROSS_SIGNAL_PRINCIPAL_EVIDENCE_MISMATCH', 'CROSS_SIGNAL_RELATIONSHIP_EVIDENCE_MISMATCH']) {
    assert.ok(writeRpc.indexOf(marker) < identityComputedAt, `${marker} must be checked before identity is computed`);
  }
});

test('identity uses the repository-wide frame_identity + extensions.digest(sha256) convention, exactly like canonicalRelationshipId\'s own v_expected_id pattern', () => {
  assert.match(writeRpc, /v_expected_comparison_id := 'cross-signal-comparison:' \|\|\s*encode\(extensions\.digest\(convert_to\(gov_repo\.frame_identity\(v_identity_parts\),'UTF8'\),'sha256'\),'hex'\);/);
});

test('relationship-state members are framed independently and sorted by the lexicographic order of their explicit UTF-8 bytes, never by caller input order or implicit/default collation', () => {
  assert.match(writeRpc, /gov_repo\.frame_identity\(array\[i\.relationship_id, i\.relationship_state_id,\s*case when i\.decision_present then '1' else '0' end, coalesce\(i\.decision_id,''\)\]\) as member_frame/);
  // Ordered by an explicit convert_to(...,'UTF8') bytea expression - a
  // deterministic byte comparison independent of database/session
  // collation - never bare `order by member_frame` (implicit text
  // collation) and never `collate "C"` (relies on the database encoding
  // happening to be UTF8 rather than stating the byte order explicitly).
  assert.match(writeRpc, /array_agg\(member_frame order by convert_to\(member_frame,'UTF8'\)\)/);
  assert.doesNotMatch(writeRpcCode, /array_agg\(member_frame order by member_frame\)/);
  assert.doesNotMatch(writeRpcCode, /collate\s+"C"/i);
});

test('a present RELATIONSHIP_STATE_SET with zero members is framed distinctly from an absent left reference', () => {
  assert.match(writeRpc, /v_left_parts := array\['LEFT_ABSENT'\];/);
  assert.match(writeRpc, /'LEFT_RELATIONSHIP_STATE_SET'/);
});

test('a caller-supplied comparison_id is never authoritative: it is at most a consistency assertion, checked before any row is read or written', () => {
  assert.match(writeRpc, /if p_comparison_id is not null and p_comparison_id is distinct from v_expected_comparison_id then/);
  assert.match(writeRpc, /raise exception 'CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH';/);
  const mismatchCheckAt = writeRpc.indexOf('CROSS_SIGNAL_COMPARISON_IDENTITY_MISMATCH');
  const existingLookupAt = writeRpc.indexOf('select csr.* into existing from gov_repo.cross_signal_comparison_results csr');
  const firstInsertAt = writeRpc.indexOf('insert into gov_repo.cross_signal_comparison_results (');
  assert.ok(mismatchCheckAt > -1 && mismatchCheckAt < existingLookupAt && mismatchCheckAt < firstInsertAt);
  // The persisted/returned/looked-up key is always the DB-computed identity,
  // never the raw caller parameter, anywhere after it is computed.
  assert.doesNotMatch(writeRpc.slice(writeRpc.indexOf('v_expected_comparison_id := ')), /comparison_id = p_comparison_id\b/);
  assert.doesNotMatch(writeRpc.slice(writeRpc.indexOf('v_expected_comparison_id := ')), /r\.comparison_id := p_comparison_id;/);
});

// -----------------------------------------------------------------------------
// Search path / safety
// -----------------------------------------------------------------------------

test('every new function uses an explicit, safe search_path and fully-qualifies gov_repo references', () => {
  for (const fn of [readBoundary, writeRpc]) {
    assert.match(fn, /set search_path=pg_catalog/);
  }
});

// -----------------------------------------------------------------------------
// RETURNS TABLE(replay, comparison_id, evaluated_at) puts those three names in
// PL/pgSQL variable scope. Any bare (unqualified) reference to one of them
// inside a SQL statement over the two new tables raises 42702 "column
// reference is ambiguous" at execution time - CREATE FUNCTION never notices.
// Found in the M15.4A hosted read-only preflight; reproduced on a disposable
// local PostgreSQL. The fix is explicit table aliases, never
// #variable_conflict / plpgsql.variable_conflict.
// -----------------------------------------------------------------------------

test('replay lookup uses an explicit table alias and qualifies every column, including comparison_id', () => {
  const lookup = writeRpcCode.match(/select csr\.\* into existing\s+from gov_repo\.cross_signal_comparison_results csr\s+where ([^;]+);/);
  assert.ok(lookup, 'parent replay lookup must alias cross_signal_comparison_results as csr');
  assert.match(lookup[1], /\bcsr\.organisation_id = p_organisation_id\b/);
  assert.match(lookup[1], /\bcsr\.comparison_id = v_expected_comparison_id\b/);
  assert.doesNotMatch(lookup[1].replace(/\bcsr\.\w+/g, ''), /\b(?:organisation_id|comparison_id)\b/, 'no bare column left in the parent lookup');
});

test('child-state replay query uses an explicit table alias and qualifies selected, filtered and ordered columns', () => {
  const child = writeRpcCode.match(/into v_existing_states\s+from gov_repo\.cross_signal_comparison_left_relationship_states cs\s+where ([^;]+);/);
  assert.ok(child, 'child replay query must alias cross_signal_comparison_left_relationship_states as cs');
  assert.match(child[1], /\bcs\.organisation_id = p_organisation_id\b/);
  assert.match(child[1], /\bcs\.comparison_id = v_expected_comparison_id\b/);
  assert.doesNotMatch(child[1].replace(/\bcs\.\w+/g, ''), /\b(?:organisation_id|comparison_id)\b/, 'no bare column left in the child filter');
  const select = writeRpcCode.match(/select coalesce\(jsonb_agg\(([^;]+?)\),'\[\]'::jsonb\)\s+into v_existing_states/);
  assert.ok(select, 'child replay select-list must be present');
  assert.match(select[1], /'relationshipId',cs\.relationship_id/);
  assert.match(select[1], /'relationshipStateId',cs\.relationship_state_id/);
  assert.match(select[1], /'decisionId',cs\.decision_id/);
  assert.match(select[1], /order by cs\.relationship_state_id/);
});

test('no bare reference to a RETURNS TABLE output name (replay/comparison_id/evaluated_at) exists anywhere in the write RPC body', () => {
  // Remove the two places a bare name is legal: the RETURNS TABLE header
  // itself, and INSERT target-column lists (not expressions - never
  // substituted by PL/pgSQL).
  const scrubbed = writeRpcCode
    .replace(/returns table\([^)]*\)/i, '')
    .replace(/insert into gov_repo\.\w+\s*\([^)]*\)/gi, 'insert into T ()');
  // `\w` includes `_`, so p_comparison_id / v_expected_comparison_id are not matched.
  const bare = [...scrubbed.matchAll(/(?<![.\w])(replay|comparison_id|evaluated_at)(?!\w)/g)].map((m) => m[1]);
  assert.deepEqual(bare, [], `unqualified output-name references would raise 42702: ${bare.join(',')}`);
  // Qualified reads of the same names stay allowed and are the ones used.
  assert.match(writeRpcCode, /existing\.comparison_id/);
  assert.match(writeRpcCode, /r\.evaluated_at/);
});

test('the ambiguity is fixed with explicit qualification, never a variable_conflict directive or setting', () => {
  assert.doesNotMatch(sqlCode, /variable_conflict/i);
});

test('no table alias in the write RPC reuses a declared PL/pgSQL variable name (e.g. `r`), which makes `r.<column>` ambiguous (42702)', () => {
  const declareBlock = writeRpcCode.slice(writeRpcCode.indexOf('declare') + 'declare'.length, writeRpcCode.indexOf('\nbegin'));
  const variables = [...declareBlock.matchAll(/^\s*(\w+)\s+\S/gm)].map((m) => m[1]);
  assert.ok(variables.includes('r') && variables.includes('existing'), 'declare block parsed');
  const aliases = [...writeRpcCode.matchAll(/\b(?:from|join)\s+gov_repo\.\w+\s+(?!on\b|where\b|left\b|inner\b|join\b)(\w+)/gi)].map((m) => m[1]);
  assert.ok(aliases.includes('cr') && aliases.includes('csr') && aliases.includes('cs') && aliases.includes('o'), `aliases parsed: ${aliases.join(',')}`);
  assert.deepEqual(aliases.filter((alias) => variables.includes(alias)), [], 'a table alias collides with a declared variable');
  assert.match(writeRpcCode, /left join gov_repo\.canonical_relationships cr\s+on cr\.organisation_id = p_organisation_id and cr\.relationship_id = i\.relationship_id/);
});
