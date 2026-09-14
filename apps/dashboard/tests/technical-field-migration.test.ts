import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const sql=readFileSync(new URL('../../../supabase/migrations/20260911184613_technical_field_governance_v1.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
test('one additive migration uses closed typed value columns and immutable proposal/state history',()=>{
  assert.match(sql.trim(),/^begin;/);assert.match(sql.trim(),/commit;$/);
  assert.match(sql,/structural_kind text check/);assert.match(sql,/native_type text/);assert.match(sql,/num_nonnulls\(structural_kind,technical_name,qualified_technical_locator,technical_description,native_type\) = 1/);
  assert.doesNotMatch(sql,/create table[^;]*\bjsonb?\b/i);assert.doesNotMatch(sql,/\b(?:fact_name|value_json|field_path)\b/);
  assert.match(sql,/technical_fact_proposals_no_update/);assert.match(sql,/technical_field_states_no_update/);assert.match(sql,/technical_field_states_no_delete/);
});
test('all new tables enable RLS, revoke public clients and explicitly scope service permissions',()=>{
  const tables=[...sql.matchAll(/create table gov_repo\.(\w+)/g)].map(m=>m[1]);
  assert.equal(tables.length,13);
  for(const table of tables){assert.ok(sql.includes(`alter table gov_repo.${table} enable row level security`));assert.ok(sql.includes(`revoke all on gov_repo.${table} from public, anon, authenticated`));}
  assert.doesNotMatch(sql,/security definer/i);assert.match(sql,/security invoker set search_path = 'gov_repo', 'pg_catalog'/);
  assert.match(sql,/revoke all on function gov_repo.technical_field_valid, gov_repo.record_technical_fact, gov_repo.record_technical_field_decision from public, anon, authenticated/);
});
test('canonical identity and M7/M8/M9 tables/RPCs are not changed',()=>{
  assert.doesNotMatch(sql,/(?:insert into|update|delete from|alter table) gov_repo\.(?:canonical_|review_|discovery_|source_assertions|lineage_)/i);
  assert.match(sql,/gov_repo.resolve_canonical_endpoint\(p_organisation_id/);assert.match(sql,/gov_repo.normalized_object_identity\(p_organisation_id,c.envelope\)/);
  assert.match(sql,/foreign key \(organisation_id, canonical_object_id, object_kind\) references gov_repo.canonical_objects/);
});
test('source/candidate/evidence substitution fails closed before proposal insert',()=>{
  for(const reason of ['FACT_CONTEXT_MISMATCH','FACT_SOURCE_MISMATCH','FACT_CANDIDATE_SUBSTITUTION','FACT_ASSERTION_SUBSTITUTION','FACT_ACQUISITION_MISMATCH','FACT_EVIDENCE_UNSUPPORTED'])assert.ok(sql.indexOf(reason)<sql.indexOf('else insert into gov_repo.technical_fact_proposals'));
  assert.match(sql,/sa.trust_state <> p.trust_state/);assert.match(sql,/c.envelope->'assertionIds' \? aid/);
});
test('source and canonical stale guards are inside the atomic decision transaction',()=>{
  const d=sql.slice(sql.indexOf('create function gov_repo.record_technical_field_decision'));
  const write=d.indexOf('insert into gov_repo.technical_field_decisions');
  assert.ok(d.indexOf('pg_advisory_xact_lock')<write);for(const guard of ['FIELD_STALE_SOURCE','FIELD_STALE_STATE','FIELD_SUBJECT_SUBSTITUTION','FIELD_STALE_POLICY','FIELD_OBSERVATION_SUBSTITUTION'])assert.ok(d.indexOf(guard)<write);
  assert.match(d,/h.snapshot_id = d.expected_source_snapshot_id/);assert.match(d,/sa.snapshot_id = d.expected_source_snapshot_id/);
  assert.match(d,/current_state.state_id is distinct from d.expected_current_state_id/);
});
test('exact old snapshot/observation replay does not advance source heads or duplicate decisions',()=>{
  assert.match(sql,/if not exists \(select 1 from gov_repo.technical_source_snapshots/);
  const obs=sql.indexOf("raise exception 'FACT_OBSERVATION_CONFLICT'");assert.ok(sql.indexOf('return;',obs)<sql.indexOf('insert into gov_repo.technical_fact_source_heads'));
  const d=sql.slice(sql.indexOf('create function gov_repo.record_technical_field_decision'));assert.ok(d.indexOf('FIELD_DECISION_REPLAY_CONFLICT')<d.indexOf('FIELD_STALE_SOURCE'));
  assert.match(sql,/h.snapshot_id=snapshot\) then\s+insert into gov_repo.technical_fact_source_heads/);
  assert.match(sql,/coalesce\(original.started_at,\(p_run->>'startedAt'\)::timestamptz\)/);
  assert.match(sql,/return query select \* from gov_repo.start_acquisition_run/);
});
test('rule must be explicitly versioned and real conflicts require human governance',()=>{
  assert.match(sql,/rule_code is not null and rule_version is not null/);assert.match(sql,/policy.rule_code is distinct from d.actor_reference/);assert.match(sql,/FIELD_CONFLICT_REQUIRES_HUMAN/);
  assert.match(sql,/FIELD_AUTHORITY_DENIED/);assert.match(sql,/FIELD_POLICY_AMBIGUOUS/);
});
test('accepted state is append-only, previous state unique, all other decisions materialize nothing',()=>{
  assert.match(sql,/unique \(organisation_id, previous_state_id\)/);assert.match(sql,/where previous_state_id is null/);
  assert.match(sql,/if d.outcome = 'ACCEPT_PROPOSED' then[\s\S]*insert into gov_repo.technical_field_states/);
  assert.match(sql,/foreign key \(organisation_id, previous_state_id\) references gov_repo.technical_field_states/);
  assert.doesNotMatch(sql,/update gov_repo.technical_field_states/);
});

test('one logical policy durably supports multiple immutable versions and exact historical decision FKs',()=>{
  const table=sql.slice(sql.indexOf('create table gov_repo.technical_field_policies'),sql.indexOf('create table gov_repo.technical_field_policy_heads'));
  assert.match(table,/primary key \(organisation_id, policy_id, version\)/);
  assert.doesNotMatch(table,/(?:primary key|unique) \(organisation_id, policy_id\)/);
  assert.match(sql,/grant select, insert on gov_repo.technical_field_policies to service_role/);
  assert.match(sql,/technical_field_policies_no_update as on update[^;]*do instead nothing/);
  assert.match(sql,/technical_field_policies_no_delete as on delete[^;]*do instead nothing/);
  assert.match(sql,/foreign key \(organisation_id, policy_id, policy_version\) references gov_repo.technical_field_policies\(organisation_id, policy_id, version\)/);
});

test('explicit tenant-scoped head references an exact version and never infers version order',()=>{
  const head=sql.slice(sql.indexOf('create table gov_repo.technical_field_policy_heads'),sql.indexOf('create function gov_repo.lock_technical_field_policy_head'));
  assert.match(head,/primary key \(organisation_id, policy_id\)/);
  assert.match(head,/foreign key \(organisation_id, policy_id, version\)\s+references gov_repo.technical_field_policies\(organisation_id, policy_id, version\)/);
  const d=sql.slice(sql.indexOf('create function gov_repo.record_technical_field_decision'));
  assert.equal([...d.matchAll(/join gov_repo.technical_field_policy_heads ph on ph.organisation_id = pol.organisation_id and ph.policy_id = pol.policy_id and ph.version = pol.version/g)].length,2);
  assert.doesNotMatch(d,/max\(.*version|order by.*version/i);
});

test('activation, deactivation and first head insertion serialize with new decisions, including missing-policy races',()=>{
  assert.match(sql,/before insert or update or delete\s+on gov_repo.technical_field_policy_heads/);
  assert.match(sql,/new.organisation_id is distinct from old.organisation_id[\s\S]*FIELD_POLICY_HEAD_IDENTITY_IMMUTABLE/);
  assert.match(sql,/array\[tenant::text,'technical-field-policy-heads'\]/);
  const d=sql.slice(sql.indexOf('create function gov_repo.record_technical_field_decision'));
  const lock=d.indexOf("array[p_organisation_id::text,'technical-field-policy-heads']");
  assert.ok(lock>0&&lock<d.indexOf('select count(*) into policy_count'));
  assert.ok(d.indexOf('FIELD_STALE_POLICY')<d.indexOf('insert into gov_repo.technical_field_decisions'));
});

test('completed replay precedes current-policy lookup and acceptance uses only the exact current rule',()=>{
  const d=sql.slice(sql.indexOf('create function gov_repo.record_technical_field_decision'));
  assert.ok(d.indexOf('return;',d.indexOf('FIELD_DECISION_REPLAY_CONFLICT'))<d.indexOf('select count(*) into policy_count'));
  assert.match(d,/policy.policy_id is distinct from d.policy_id or policy.version is distinct from d.policy_version then raise exception 'FIELD_STALE_POLICY'/);
  assert.match(d,/policy.rule_code is distinct from d.actor_reference or policy.rule_version is distinct from d.rule_version/);
  assert.match(d,/if policy_count > 1 then raise exception 'FIELD_POLICY_AMBIGUOUS'/);
  assert.match(d,/pol.connection_id is null or pol.connection_id = p.connection_id/);
});
