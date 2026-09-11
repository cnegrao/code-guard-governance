import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL('../../../supabase/migrations/20260911120904_lineage_support_observations_v1.sql', import.meta.url), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
test('SQL: additive observation junction preserves original tables and envelopes', () => {
  assert.equal((code.match(/create table /gi) ?? []).length, 1);
  assert.match(code, /primary key \(organisation_id, candidate_id, observation_finding_id\)/);
  assert.match(code, /unique \(organisation_id, observation_finding_id\)/);
  assert.equal((code.match(/foreign key \(organisation_id,/g) ?? []).length, 4);
  assert.doesNotMatch(code, /(?:update|delete from|alter table) gov_repo\.(?:discovery_candidates|discovery_findings|source_assertions|discovery_evidence|review_subjects)/i);
  assert.match(code, /lineage_observations_no_update/);
  assert.match(code, /lineage_observations_no_delete/);
});
test('SQL: RLS, service-only access, invoker and fixed search path preserve tenant boundary', () => {
  assert.match(code, /enable row level security/);
  assert.match(code, /revoke all on gov_repo.lineage_candidate_observations from public, anon, authenticated/);
  assert.match(code, /grant select, insert on gov_repo.lineage_candidate_observations to service_role/);
  assert.match(code, /security invoker set search_path = 'gov_repo', 'pg_catalog'/);
  assert.doesNotMatch(code, /security definer/i);
  assert.match(code, /revoke all on function gov_repo.record_lineage_observation from public, anon, authenticated/);
  for (const alias of ['dc', 'df', 'ar', 'sa', 'se', 'de', 'o']) assert.match(code, new RegExp(`${alias}\\.organisation_id = p_organisation_id`));
});
test('SQL: initial candidate and observation attachments serialize and commit atomically with exact replay', () => {
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;$/);
  assert.ok(code.indexOf('pg_advisory_xact_lock') < code.indexOf('select * into v_origin'));
  assert.match(code, /if v_origin.candidate_id is null then[\s\S]*record_discovery_candidate/);
  assert.match(code, /record_discovery_finding\(v_observation_id/);
  assert.match(code, /exception when unique_violation then[\s\S]*o.candidate_id = v_candidate_id/);
  assert.match(code, /v_existing_observation.envelope - 'detectedAt'/);
  assert.match(code, /return query select v_origin.envelope, v_origin.envelope_hash, v_origin_finding.envelope/);
});
test('SQL: same directed endpoint semantics, exact rows and transformation support are mandatory', () => {
  assert.match(code, /array\['sourceEndpoint', 'targetEndpoint'\]/);
  assert.match(code, /candidateKind' is distinct from 'DATA_ELEMENT'/);
  assert.match(code, /normalized_object_identity\(p_organisation_id, v_endpoint.envelope\)/);
  assert.match(code, /normalized_object_identity\(p_organisation_id, v_original_endpoint.envelope\)/);
  assert.match(code, /v_endpoint.source_external_id/);
  assert.match(code, /LINEAGE_OBSERVATION_SEMANTIC_CONFLICT/);
  assert.match(code, /p_candidate->'assertionIds' @> v_endpoint.envelope->'assertionIds'/);
  assert.match(code, /sa.method_code = 'sql-insert-select-column-lineage'/);
  assert.match(code, /sa.trust_state = 'DECLARED'/);
  assert.match(code, /se.evidence_id = any\(v_evidence\)/);
});
test('SQL: support sets are deterministic; historical candidate/review/canonical authority never change', () => {
  assert.equal((code.match(/array_agg\(distinct value order by value\)/g) ?? []).length, 2);
  assert.doesNotMatch(code, /(?:insert into|update|delete from) gov_repo\.(?:canonical_|review_|reconciliation_)/i);
  assert.doesNotMatch(code, /(?:perform|select) gov_repo\.(?:materialize_|record_authorized_|certify)/i);
  assert.doesNotMatch(code, /DISCOVERY_CANDIDATE_CONFLICT/);
  assert.match(code, /relationshipTypeCode' is distinct from 'DERIVED_FROM'/);
});
