import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const sql=readFileSync(new URL('../../../supabase/migrations/20260915230551_execution_context_v1.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
test('migration stores four typed facts without generic JSON or taxonomy writes',()=>{
  assert.match(sql,/^\s*begin;/);assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(sql,/create table[^;]*\bjsonb?\b/i);
  assert.doesNotMatch(sql,/(?:insert into|update|delete from|alter table) gov_repo\.(?:canonical_|discovery_|source_assertions|technical_field_)/i);
  assert.match(sql,/authorization_state = 'UNKNOWN'/);assert.match(sql,/num_nonnulls/);
  assert.match(sql,/execution_one_principal/);assert.match(sql,/protocol_value in/);
});
test('every table is tenant scoped, RLS protected and included in restricted grant loop',()=>{
  const tables=[...sql.matchAll(/create table gov_repo\.(\w+) \(/g)].map(m=>m[1]);assert.equal(tables.length,7);
  for(const table of tables)assert.ok(sql.includes(`'${table}'`));
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on gov_repo.%I from public,anon,authenticated/);
  assert.equal([...sql.matchAll(/security definer set search_path=pg_catalog/g)].length,2);
  assert.match(sql,/revoke insert,update,delete on gov_repo.execution_source_snapshots,gov_repo.execution_source_facts,[\s\S]*?gov_repo.execution_field_states from service_role/);
  assert.match(sql,/revoke all on function gov_repo.record_execution_snapshot[\s\S]*?from public,anon,authenticated/);
  assert.match(sql,/foreign key \(organisation_id,assertion_id\)/);
  assert.match(sql,/foreign key \(organisation_id,evidence_id\)/);
});
test('source acquisition, exact candidate, Tool and evidence are verified transactionally',()=>{
  for(const error of ['EXECUTION_BINDING_MISMATCH','EXECUTION_REVISION_MISMATCH','EXECUTION_SUPPORT_MISMATCH','EXECUTION_TOOL_MISMATCH'])assert.ok(sql.includes(error));
  assert.match(sql,/a\.snapshot_id is distinct from/);assert.match(sql,/a\.trust_state<>'DECLARED'/);
  assert.match(sql,/a\.method_code<>'DIRECT_AGENT_EXECUTION_V1'/);assert.match(sql,/e\.handling='HASH_ONLY'/);
});
test('decisions serialize source, policy and predecessor; exact replay precedes stale checks',()=>{
  const d=sql.slice(sql.indexOf('create function gov_repo.record_execution_field_decision'));
  assert.ok(d.indexOf('EXECUTION_REPLAY_CONFLICT')<d.indexOf('EXECUTION_STALE_SOURCE'));
  for(const error of ['EXECUTION_STALE_SOURCE','EXECUTION_STALE_STATE','EXECUTION_STALE_POLICY','EXECUTION_POLICY_AMBIGUOUS','EXECUTION_NO_FIELD_AUTHORITY'])assert.ok(d.includes(error));
  assert.match(d,/authorityKind}' is distinct from 'HUMAN'/);assert.match(sql,/EXECUTION_HISTORY_IMMUTABLE/);
  assert.match(sql,/execution_state_root/);assert.match(sql,/execution_state_successor/);
});
