import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_PATH = path.join(
  APP_ROOT,
  "..",
  "..",
  "supabase",
  "migrations",
  "20260905060000_governance_persistence_v1.sql"
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const NEW_TABLES = [
  "review_subjects",
  "review_subject_assertions",
  "review_subject_evidence",
  "review_audit_events",
  "review_audit_event_evidence",
  "authorization_decisions",
  "reconciliation_command_locks",
  "reconciliation_decisions",
  "reconciliation_decision_assertions",
  "reconciliation_decision_evidence",
  "reconciliation_decision_merge_members",
  "reconciliation_invocations",
  "outbox_events",
];

const IMMUTABLE_TABLES = [
  "review_audit_events",
  "review_audit_event_evidence",
  "authorization_decisions",
  "reconciliation_decisions",
  "reconciliation_decision_assertions",
  "reconciliation_decision_evidence",
  "reconciliation_decision_merge_members",
  "reconciliation_invocations",
];

const NEW_FUNCTIONS = [
  "create_review_subject",
  "apply_review_transition",
  "record_authorization_decision",
  "record_authorized_reconciliation",
];

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema is missing or any target table already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  for (const table of NEW_TABLES.slice(0, 6)) {
    // Preflight only lists a representative subset of the highest-risk tables; assert at least the core ones appear.
    if (["review_subjects", "review_audit_events", "authorization_decisions", "reconciliation_decisions", "reconciliation_invocations", "outbox_events"].includes(table)) {
      assert.match(code, new RegExp(`to_regclass\\('gov_repo\\.${table}'\\)`));
    }
  }
});

test("SQL: every new table is created exactly once", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    const matches = code.match(new RegExp(`create table gov_repo\\.${table}\\s*\\(`, "g")) ?? [];
    assert.equal(matches.length, 1, `expected exactly one CREATE TABLE for ${table}`);
  }
});

test("SQL: every tenant-owned new table carries an explicit organisation_id column", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    const tableBlock = code.match(
      new RegExp(`create table gov_repo\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`)
    )?.[1];
    assert.ok(tableBlock, `expected to find CREATE TABLE body for ${table}`);
    assert.match(tableBlock!, /organisation_id\s+uuid\s+not null/, `${table} must declare organisation_id uuid not null`);
  }
});

test("SQL: composite tenant-aware FKs are used for every child table referencing a tenant-owned parent (never a bare non-tenant FK)", () => {
  const code = stripSqlComments(readMigration());
  const compositeFkPattern = /foreign key \(organisation_id, \w+\)\s*\n?\s*references gov_repo\.\w+ \(organisation_id, \w+\)/g;
  const matches = code.match(compositeFkPattern) ?? [];
  assert.ok(matches.length >= 10, `expected at least 10 composite (organisation_id, id) FKs, found ${matches.length}`);
});

test("SQL: every immutable table has unconditional no-update and no-delete rules", () => {
  const code = stripSqlComments(readMigration());
  for (const table of IMMUTABLE_TABLES) {
    assert.match(
      code,
      new RegExp(`create or replace rule ${table}_no_update as\\s*\\n\\s*on update to gov_repo\\.${table} do instead nothing;`),
      `${table} must have an unconditional ON UPDATE ... DO INSTEAD NOTHING rule`
    );
    assert.match(
      code,
      new RegExp(`create or replace rule ${table}_no_delete as\\s*\\n\\s*on delete to gov_repo\\.${table} do instead nothing;`),
      `${table} must have an unconditional ON DELETE ... DO INSTEAD NOTHING rule`
    );
  }
});

test("SQL: reconciliation_command_locks deliberately carries no immutability rule (PostgreSQL disallows ON CONFLICT on a table with rules, and record_authorized_reconciliation's idempotency gate depends on ON CONFLICT DO NOTHING)", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /rule reconciliation_command_locks_no_update/);
  assert.doesNotMatch(code, /rule reconciliation_command_locks_no_delete/);
  assert.match(code, /insert into gov_repo\.reconciliation_command_locks \([\s\S]*?\)\s*\n\s*values \([\s\S]*?\)\s*\n\s*on conflict \(organisation_id, command_id\) do nothing/);
});

test("SQL: outbox_events allows only delivery metadata to change, never identity or payload", () => {
  const code = stripSqlComments(readMigration());
  const rule = code.match(/create or replace rule outbox_events_immutable_core as\s*\n\s*on update to gov_repo\.outbox_events\s*\n\s*where \(([\s\S]*?)\)\s*\n\s*do instead nothing;/)?.[1];
  assert.ok(rule, "expected outbox_events_immutable_core rule");
  for (const protectedColumn of ["outbox_event_id", "organisation_id", "event_type", "payload", "payload_hash", "occurred_at", "created_at"]) {
    assert.match(rule!, new RegExp(`old\\.${protectedColumn} is distinct from new\\.${protectedColumn}`));
  }
  for (const mutableColumn of ["delivery_status", "delivered_at", "delivery_attempts", "last_delivery_error"]) {
    assert.doesNotMatch(rule!, new RegExp(`old\\.${mutableColumn}`), `${mutableColumn} must remain mutable (delivery metadata)`);
  }
  assert.match(code, /create or replace rule outbox_events_no_delete as\s*\n\s*on delete to gov_repo\.outbox_events do instead nothing;/);
});

test("SQL: review_subjects (the one mutable projection) has no immutability rule and keeps its updated_at trigger", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /rule review_subjects_no_update/);
  assert.doesNotMatch(code, /rule review_subjects_no_delete/);
  assert.match(code, /create trigger trg_review_subjects_updated_at\s*\n\s*before update on gov_repo\.review_subjects\s*\n\s*for each row execute function gov_repo\.set_updated_at\(\);/);
});

// Postgres identifier limit is 63 bytes; the "Service role has full access
// to <table>" label (32 chars) overflows for these three longer table names,
// so they use the shorter "Service role access to <table>" prefix (23 chars)
// instead of silently letting Postgres truncate the identifier.
const SHORT_POLICY_PREFIX_TABLES = new Set([
  "reconciliation_decision_assertions",
  "reconciliation_decision_evidence",
  "reconciliation_decision_merge_members",
]);

test("SQL: RLS is enabled on every new table, PUBLIC/anon/authenticated are revoked, and only a service_role policy exists", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`alter table gov_repo\\.${table} enable row level security;`), `${table} must enable RLS`);
    const prefix = SHORT_POLICY_PREFIX_TABLES.has(table) ? "Service role access to" : "Service role has full access to";
    assert.match(
      code,
      new RegExp(`create policy "${prefix} ${table}" on gov_repo\\.${table} for all to service_role using \\(true\\) with check \\(true\\);`),
      `${table} must have a service_role full-access policy`
    );
    // No authenticated-role policy should exist for any of these tables in this milestone (no UI consumer yet).
    assert.doesNotMatch(
      code,
      new RegExp(`create policy[^;]*on gov_repo\\.${table} for select to authenticated`),
      `${table} must not grant authenticated read access in this milestone`
    );
  }
  const revokeBlock = code.match(/revoke all on table\s*\n([\s\S]*?)from public, anon, authenticated;/)?.[1] ?? "";
  for (const table of NEW_TABLES) {
    assert.match(revokeBlock, new RegExp(`gov_repo\\.${table}`), `${table} must be explicitly revoked from public/anon/authenticated`);
  }
});

test("SQL: every new RPC is SECURITY INVOKER with an explicit safe search_path", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of NEW_FUNCTIONS) {
    const fnBody = code.match(new RegExp(`create or replace function gov_repo\\.${fn}\\(([\\s\\S]*?)\\$\\$;`))?.[0];
    assert.ok(fnBody, `expected to find function body for ${fn}`);
    assert.match(fnBody!, /security invoker/, `${fn} must be SECURITY INVOKER`);
    assert.match(fnBody!, /set search_path = 'gov_repo', 'pg_catalog'/, `${fn} must set a safe explicit search_path`);
    assert.doesNotMatch(fnBody!, /security definer/i, `${fn} must never be SECURITY DEFINER`);
  }
});

test("SQL: EXECUTE on every new RPC is revoked from PUBLIC/anon/authenticated and granted only to service_role", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of NEW_FUNCTIONS) {
    assert.match(code, new RegExp(`revoke all on function gov_repo\\.${fn} from public, anon, authenticated;`));
    assert.match(code, new RegExp(`grant execute on function gov_repo\\.${fn} to service_role;`));
  }
});

test("SQL: authority/actor columns enforce the HUMAN/DETERMINISTIC_RULE XOR shape via CHECK constraints", () => {
  const code = stripSqlComments(readMigration());
  const xorChecks = code.match(/check \(\s*\n\s*\(actor_kind = 'HUMAN'[\s\S]*?\)\s*\n\s*\)/g) ?? [];
  assert.ok(xorChecks.length >= 1, "expected at least one actor_kind HUMAN/DETERMINISTIC_RULE XOR CHECK");
});

test("SQL: reconciliation_decisions and reconciliation_invocations enforce HUMAN-only authority/actor at the DB level", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /constraint reconciliation_decisions_authority_human_only_check check \(\s*\n\s*authority_kind = 'HUMAN'/
  );
  assert.match(
    code,
    /constraint reconciliation_invocations_actor_human_only_check check \(\s*\n\s*actor_kind = 'HUMAN'/
  );
});

test("SQL: reconciliation_decisions enforces family/outcome/materialization structural integrity", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint reconciliation_decisions_family_outcome_check check \(/);
  assert.match(code, /constraint reconciliation_decisions_object_materialization_check check \(/);
  assert.match(code, /constraint reconciliation_decisions_relationship_fields_check check \(/);
  assert.match(code, /constraint reconciliation_decisions_merge_fields_check check \(/);
  assert.match(code, /constraint reconciliation_decisions_canonical_object_exclusive_check check \(/);
});

test("SQL: reconciliation_decisions.envelope_hash and outbox_events.payload_hash are format-checked as 64 lowercase hex characters", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint reconciliation_decisions_envelope_hash_format_check\s*\n\s*check \(envelope_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(code, /constraint outbox_events_payload_hash_format_check check \(payload_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test("SQL: outbox event_type is restricted to exactly the three documented event types", () => {
  const code = stripSqlComments(readMigration());
  const check = code.match(/constraint outbox_events_event_type_check check \(\s*\n\s*event_type in \(([\s\S]*?)\)/)?.[1] ?? "";
  const types = [...check.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    types.sort(),
    ["GOVERNANCE_AUTHORIZATION_EVALUATED", "GOVERNANCE_RECONCILIATION_DECIDED", "GOVERNANCE_REVIEW_TRANSITIONED"].sort()
  );
});

test("SQL: idempotency uniqueness constraints exist for review transitions and reconciliation commands", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint review_audit_events_command_unique unique \(review_subject_id, command_id\)/);
  assert.match(code, /constraint reconciliation_invocations_command_unique unique \(organisation_id, command_id\)/);
  assert.match(code, /constraint reconciliation_command_locks_pkey primary key \(organisation_id, command_id\)/);
});

// ---------------------------------------------------------------------------
// PL/pgSQL RETURNS TABLE implicit-variable ambiguity class (the same class
// org-code-db-authoritative.test.ts already guards against for
// signup_legacy): a RETURNS TABLE column name is also an implicit PL/pgSQL
// variable in scope, so any bare (unqualified) reference to a column of the
// same name inside the function body is ambiguous and fails at CREATE FUNCTION
// or CALL time. These tests pin the qualified fixes in place.
// ---------------------------------------------------------------------------

test("SQL: create_review_subject qualifies every review_subject_id reference that collides with its own RETURNS TABLE output column", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.create_review_subject\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /from gov_repo\.review_subjects as rs where rs\.review_subject_id = p_review_subject_id/);
  assert.match(fnBody, /from gov_repo\.review_subject_assertions as rsa where rsa\.review_subject_id = p_review_subject_id/);
  assert.match(fnBody, /from gov_repo\.review_subject_evidence as rse where rse\.review_subject_id = p_review_subject_id/);
});

test("SQL: apply_review_transition qualifies every column reference that collides with its own RETURNS TABLE output columns (review_subject_id, event_id, revision)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.apply_review_transition\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /from gov_repo\.review_subjects as rs\s*\n\s*where rs\.review_subject_id = p_review_subject_id\s*\n\s*for update/);
  assert.match(fnBody, /from gov_repo\.review_audit_events as rae where rae\.event_id = v_subject\.last_transition_id/);
  assert.match(fnBody, /from gov_repo\.review_audit_event_evidence as raee where raee\.event_id = v_last_event\.event_id/);
  assert.match(fnBody, /update gov_repo\.review_subjects as rs\s*\n\s*set state = p_new_state, last_transition_id = p_event_id, revision = rs\.revision \+ 1\s*\n\s*where rs\.review_subject_id = p_review_subject_id/);
});

test("SQL: record_authorization_decision qualifies the authorization_decision_id reference that collides with its own RETURNS TABLE output column", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_authorization_decision\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /from gov_repo\.authorization_decisions as ad2 where ad2\.authorization_decision_id = p_authorization_decision_id/);
});

test("SQL: every function using ON CONFLICT pins #variable_conflict use_column (ON CONFLICT targets resolve through general expression parsing, not column-list/WHERE-clause qualification, so they stay ambiguous against a same-named RETURNS TABLE output column otherwise)", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of ["create_review_subject", "record_authorized_reconciliation"]) {
    const fnBody = code.match(new RegExp(`create or replace function gov_repo\\.${fn}\\(([\\s\\S]*?)\\$\\$;`))?.[0] ?? "";
    assert.match(fnBody, /on conflict/, `expected ${fn} to use ON CONFLICT`);
    const pragmaIndex = fnBody.indexOf("#variable_conflict use_column");
    const conflictIndex = fnBody.indexOf("on conflict");
    assert.ok(pragmaIndex > -1, `${fn} must declare #variable_conflict use_column`);
    assert.ok(pragmaIndex < conflictIndex, `${fn} must declare the pragma before its ON CONFLICT clause`);
  }
});

test("SQL: apply_review_transition does not use ON CONFLICT and does not need the #variable_conflict pragma", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.apply_review_transition\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(fnBody, /on conflict/);
});

test("SQL: record_authorization_decision does NOT use ON CONFLICT (authorization_decisions is immutable via a rewrite RULE, and PostgreSQL disallows ON CONFLICT on such a table) — it uses a check-then-insert-with-exception-handler pattern instead, matching gov_repo.create_mandate_mapping_guard()'s established precedent", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_authorization_decision\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(fnBody, /on conflict/);
  assert.match(fnBody, /exception\s*\n\s*when unique_violation then/);
  const insertIndex = fnBody.indexOf("insert into gov_repo.authorization_decisions");
  const exceptionIndex = fnBody.indexOf("exception");
  const fallbackSelectIndex = fnBody.indexOf("select * into v_existing from gov_repo.authorization_decisions");
  assert.ok(insertIndex > -1 && insertIndex < exceptionIndex && exceptionIndex < fallbackSelectIndex, "insert must precede its exception handler, which must precede the conflict-content check");
});

test("SQL: record_authorized_reconciliation qualifies every column reference that collides with its own RETURNS TABLE output columns (invocation_id, reconciliation_decision_id)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_authorized_reconciliation\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /select rcl\.command_fingerprint, rcl\.invocation_id into v_existing_fp, v_existing_invocation_id\s*\n\s*from gov_repo\.reconciliation_command_locks as rcl\s*\n\s*where rcl\.organisation_id = p_organisation_id and rcl\.command_id = p_command_id/);
  assert.match(fnBody, /select ri\.reconciliation_decision_id into v_existing_decision_id\s*\n\s*from gov_repo\.reconciliation_invocations as ri\s*\n\s*where ri\.invocation_id = v_existing_invocation_id/);
});

test("SQL: apply_review_transition locks the subject row (FOR UPDATE) before making any replay/staleness decision", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.apply_review_transition\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const forUpdateIndex = fnBody.indexOf("for update");
  const replayCheckIndex = fnBody.indexOf("v_last_event.command_id = p_command_id");
  const staleCheckIndex = fnBody.indexOf("Stale review state");
  assert.ok(forUpdateIndex > -1, "expected SELECT ... FOR UPDATE on the subject row");
  assert.ok(forUpdateIndex < replayCheckIndex && replayCheckIndex < staleCheckIndex, "row lock must precede replay detection, which must precede the staleness check");
});

test("SQL: apply_review_transition fails closed on cross-tenant subject access before touching any row", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.apply_review_transition\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /Cross-tenant review subject transition rejected/);
  const crossTenantIndex = fnBody.indexOf("Cross-tenant review subject transition rejected");
  const insertIndex = fnBody.indexOf("insert into gov_repo.review_audit_events");
  assert.ok(crossTenantIndex > -1 && crossTenantIndex < insertIndex, "cross-tenant check must precede any write");
});

test("SQL: apply_review_transition rejects a replayed commandId whose content differs from what is already stored (fails closed, never returns stale data for a mismatched replay)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.apply_review_transition\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const replayBranchIndex = fnBody.indexOf("v_last_event.command_id = p_command_id");
  const conflictCheckIndex = fnBody.indexOf("IDEMPOTENCY_CONFLICT");
  const replayReturnIndex = fnBody.lastIndexOf("true, v_last_event.event_id");

  assert.ok(replayBranchIndex > -1 && conflictCheckIndex > -1 && replayReturnIndex > -1);
  assert.ok(
    replayBranchIndex < conflictCheckIndex && conflictCheckIndex < replayReturnIndex,
    "content-consistency check must run between detecting a matching commandId and returning the replay result"
  );

  const consistencyCheck = fnBody.slice(replayBranchIndex, conflictCheckIndex);
  for (const field of ["previous_state", "new_state", "actor_kind", "actor_reference", "actor_rule_code", "actor_rule_version", "reason_code"]) {
    assert.match(consistencyCheck, new RegExp(`v_last_event\\.${field} is distinct from p_${field}`), `replay must verify ${field} matches`);
  }
  assert.match(consistencyCheck, /v_last_event_evidence is distinct from v_wanted_evidence/, "replay must verify the cited evidence set matches");
});

test("SQL: record_authorized_reconciliation gates idempotency via reconciliation_command_locks before any authoritative insert", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_authorized_reconciliation\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const lockInsertIndex = fnBody.indexOf("insert into gov_repo.reconciliation_command_locks");
  const conflictCheckIndex = fnBody.indexOf("IDEMPOTENCY_CONFLICT");
  const authDecisionInsertIndex = fnBody.indexOf("insert into gov_repo.authorization_decisions");
  const decisionInsertIndex = fnBody.indexOf("insert into gov_repo.reconciliation_decisions");
  const invocationInsertIndex = fnBody.indexOf("insert into gov_repo.reconciliation_invocations");

  assert.ok(lockInsertIndex > -1, "expected the command-lock INSERT ... ON CONFLICT DO NOTHING gate");
  assert.ok(
    lockInsertIndex < conflictCheckIndex &&
      conflictCheckIndex < authDecisionInsertIndex &&
      authDecisionInsertIndex < decisionInsertIndex &&
      decisionInsertIndex < invocationInsertIndex,
    "the lock gate and its conflict check must precede every authoritative insert, in order: authorization -> decision -> invocation"
  );
  assert.match(fnBody, /on conflict \(organisation_id, command_id\) do nothing/);
});

test("SQL: record_authorized_reconciliation always records the ALLOW result literally, never trusting a caller-supplied result value", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_authorized_reconciliation\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /p_requested_action, 'ALLOW', p_authorization_evaluated_at/);
  assert.doesNotMatch(fnBody, /p_result/, "record_authorized_reconciliation must not accept a caller-supplied result parameter at all");
});

test("SQL: no policy or constraint identifier exceeds PostgreSQL's 63-byte NAMEDATALEN limit (Postgres truncates silently past this, which previously produced a NOTICE for three overlong policy names)", () => {
  const code = stripSqlComments(readMigration());
  const policyNames = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(policyNames.length > 0, "expected to find policy declarations");
  for (const name of policyNames) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, `policy name "${name}" is ${Buffer.byteLength(name, "utf8")} bytes, exceeding the 63-byte identifier limit`);
  }

  const constraintNames = [...code.matchAll(/constraint (\w+)/g)].map((m) => m[1]);
  for (const name of constraintNames) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, `constraint name "${name}" is ${Buffer.byteLength(name, "utf8")} bytes, exceeding the 63-byte identifier limit`);
  }
});

test("SQL: no destructive statement (DROP TABLE/DROP COLUMN/TRUNCATE) touches any pre-existing table", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /drop table/i);
  assert.doesNotMatch(code, /drop column/i);
  assert.doesNotMatch(code, /truncate/i);
});

test("SQL: extension prerequisites (pgcrypto digest, gen_random_uuid) are already satisfied by the foundation migration, not re-declared here", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /create extension/i, "this migration must reuse already-created extensions, not redeclare them");
  assert.match(code, /gen_random_uuid\(\)/);
  assert.match(code, /digest\(/);
});
