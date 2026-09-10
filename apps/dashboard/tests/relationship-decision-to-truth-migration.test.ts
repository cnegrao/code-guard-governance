import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../../supabase/migrations/20260909210640_relationship_decision_to_truth_v1.sql", import.meta.url), "utf8");
const original = readFileSync(new URL("../../../supabase/migrations/20260906120000_canonical_materialization_v1.sql", import.meta.url), "utf8");
const body = (name: string) => sql.slice(sql.indexOf(`function gov_repo.${name}(`), sql.indexOf("$$;", sql.indexOf(`function gov_repo.${name}(`)) + 3);
const mapping = sql.slice(sql.indexOf("create table gov_repo.canonical_normalized_object_mappings"), sql.indexOf("comment on table"));
const object = body("materialize_object_reconciliation");
const relationship = body("materialize_relationship_reconciliation");
const resolver = body("resolve_canonical_endpoint");

test("additive migration preserves legacy rows and constraints; no guessed backfill", () => {
  assert.match(sql, /^begin;\r?$/m);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /\bdrop\s+(?:table|constraint|index|column)|\bdelete\s+from|\btruncate\b|\bupdate\s+gov_repo\./i);
  assert.doesNotMatch(mapping, /\bjsonb?\b/i);
});
test("mapping uniqueness distinguishes source scope, kind and semantic identity; compound tenant/kind endpoint FK", () => {
  assert.match(mapping, /normalized_mapping_identity_unique unique\s*\(organisation_id, source_connection_id, source_external_type, source_external_id, canonical_object_kind, normalized_object_identity\)/);
  assert.match(mapping, /foreign key \(organisation_id, canonical_object_id, canonical_object_kind\)/);
  for (const target of ["discovery_candidates", "reconciliation_decisions", "canonical_objects"]) assert.match(mapping, new RegExp(`references gov_repo\\.${target} \\(organisation_id,`));
});
test("new object writes use exact mappings and canonical parent proof; legacy operations can only replay", () => {
  assert.match(object, /v_decision\.subject_candidate_id/);
  assert.match(object, /rs\.review_subject_id = v_invocation\.review_subject_id/);
  assert.match(object, /rs\.state = 'CERTIFIED'/);
  assert.match(object, /gov_repo\.normalized_object_identity\(p_organisation_id, v_candidate\.envelope\)/);
  assert.match(object, /p_canonical_object_kind in \('AGENT_VERSION','DATA_ELEMENT'\)/);
  assert.match(object, /PARENT_NOT_CANONICAL/);
  assert.match(object, /on conflict on constraint normalized_mapping_identity_unique do nothing/);
  assert.match(object, /NORMALIZED_MAPPING_CONFLICT/);
  assert.doesNotMatch(object, /insert into gov_repo\.canonical_object_source_mappings/);
});
test("exact resolver counts semantic identities before lookup and never selects latest or legacy mappings", () => {
  assert.match(resolver, /count\(distinct gov_repo\.frame_identity/);
  assert.match(resolver, /v_count = 0.*ENDPOINT_NOT_CANONICAL/);
  assert.match(resolver, /v_count <> 1.*ENDPOINT_MAPPING_AMBIGUOUS/);
  assert.match(resolver, /select distinct[\s\S]+into strict v_candidate/);
  assert.match(resolver, /co\.kind = m\.canonical_object_kind/);
  assert.match(resolver, /m\.organisation_id = p_organisation_id/);
  assert.doesNotMatch(resolver, /canonical_object_source_mappings|order by|limit\s+1|insert into|\bexit\b/i);
});
test("normalized version discriminator is existing candidate revision hash; no versionCode or row UUID", () => {
  const identity = body("normalized_object_identity");
  assert.match(identity, /candidate:agent-version:\[a-f0-9\]\{32\}/);
  assert.doesNotMatch(identity, /versionCode|gen_random_uuid|created_at|review_subject_id|proposal_id/);
  assert.match(identity, /proposedIdentity,sourceReference/);
  assert.match(identity, /dc\.organisation_id = p_organisation_id/);
});
test("relationship transaction revalidates decision, candidate and both exact canonical bindings", () => {
  for (const marker of ["RELATIONSHIP_CANDIDATE_BINDING_MISMATCH", "RELATIONSHIP_DECISION_STATE_MISMATCH", "RELATIONSHIP_SUPPORT_MISMATCH", "RELATIONSHIP_ENDPOINT_MAPPING_MISMATCH", "RELATIONSHIP_ENDPOINT_KIND_MISMATCH", "RELATIONSHIP_SEMANTIC_IDENTITY_MISMATCH", "RELATIONSHIP_FINGERPRINT_SUPPORT_MISSING"]) {
    assert.ok(relationship.indexOf(marker) < relationship.indexOf("insert into gov_repo.canonical_relationships"));
  }
  assert.match(relationship, /resolve_canonical_endpoint\(p_organisation_id, v_candidate\.source_endpoint\)/);
  assert.match(relationship, /resolve_canonical_endpoint\(p_organisation_id, v_candidate\.target_endpoint\)/);
  assert.doesNotMatch(relationship, /insert into gov_repo\.canonical_objects/);
});
test("all twelve closed types keep direction, exact endpoint kinds and canonical semantic identity", () => {
  for (const type of ["USES_MODEL", "USES_TOOL", "USES_MCP", "INVOKES", "USES_PROMPT", "USES_KNOWLEDGE_BASE", "USES_SKILL", "EXPOSES", "HANDOFF_TO", "READS_FROM", "WRITES_TO", "DERIVED_FROM"]) {
    assert.match(relationship, new RegExp(`when '${type}' then`));
  }
  assert.match(relationship, /p_organisation_id::text, p_relationship_type, p_source_canonical_object_id, p_target_canonical_object_id/);
  for (const predicate of ["cr.organisation_id = p_organisation_id", "cr.relationship_type = p_relationship_type", "cr.source_canonical_object_id = p_source_canonical_object_id", "cr.target_canonical_object_id = p_target_canonical_object_id", "cr.source_kind = p_source_kind", "cr.target_kind = p_target_kind", "cr.relationship_state_id = p_relationship_state_id"]) assert.ok(relationship.includes(predicate));
});
test("atomic writes and database concurrency use original locks/edge constraint, never application-only check/insert", () => {
  for (const rpc of [object, relationship]) {
    assert.match(rpc, /on conflict \(organisation_id, reconciliation_decision_id\) do nothing/);
    assert.match(rpc, /for share/);
    assert.match(rpc, /MATERIALIZATION_IDEMPOTENCY_CONFLICT/);
    assert.match(rpc, /insert into gov_repo\.materialization_operations/);
    assert.match(rpc, /insert into gov_repo\.outbox_events/);
  }
  assert.match(original, /create unique index canonical_relationships_active_edge_uidx\s+on gov_repo\.canonical_relationships \(organisation_id, relationship_type, source_canonical_object_id, target_canonical_object_id\)\s+where valid_to is null/);
  assert.match(original, /canonical_relationships_decision_fkey\s+foreign key \(organisation_id, created_by_decision_id\)/);
  assert.match(original, /materialization_operations_relationship_result_fkey[\s\S]+references gov_repo\.canonical_relationships \(organisation_id, relationship_id\)/);
  assert.match(relationship, /exception when unique_violation then[\s\S]*DUPLICATE_GOVERNED_RELATIONSHIP_EDGE/);
  assert.match(body("guard_final_review_decision"), /pg_advisory_xact_lock[\s\S]+FINALIZED_REVIEW_DECISION_CONFLICT/);
  assert.match(body("guard_final_review_decision"), /rs\.finding_id = dc\.finding_id[\s\S]+FINALIZED_REVIEW_CANDIDATE_MISMATCH/);
});
test("RLS and RPC privileges remain private, service-role scoped and invoker based", () => {
  assert.match(sql, /canonical_normalized_object_mappings enable row level security/);
  assert.match(sql, /revoke all on gov_repo\.canonical_normalized_object_mappings from public, anon, authenticated/);
  assert.match(sql, /for all to service_role using \(true\) with check \(true\)/);
  assert.doesNotMatch(sql, /security definer/i);
  for (const name of ["resolve_canonical_endpoint", "materialize_object_reconciliation", "materialize_relationship_reconciliation"]) assert.match(body(name), /security invoker/);
  assert.match(sql, /grant execute on function gov_repo\.materialize_object_reconciliation, gov_repo\.materialize_relationship_reconciliation to service_role/);
});
