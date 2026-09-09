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
  "20260908120000_agent_version_technical_profile_persistence_v1.sql"
);
const PRIOR_MIGRATION_PATHS = [
  "20260905060000_governance_persistence_v1.sql",
  "20260906120000_canonical_materialization_v1.sql",
  "20260906180000_discovery_intake_v1.sql",
  "20260906190000_governance_workspace_queue_v1.sql",
  "20260907120000_discovery_governance_input_persistence_v1.sql",
].map((name) => path.join(APP_ROOT, "..", "..", "supabase", "migrations", name));

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
  "agent_version_technical_profile_proposals",
  "agent_version_technical_profile_proposal_field_assertions",
  "agent_version_technical_profile_proposal_field_evidence",
  "agent_version_technical_profiles",
  "agent_version_technical_profile_field_assertions",
  "agent_version_technical_profile_field_evidence",
  "agent_version_technical_profile_materializations",
];

const IMMUTABLE_TABLES = [
  "agent_version_technical_profile_proposals",
  "agent_version_technical_profile_materializations",
];

const NEW_FUNCTIONS = [
  "record_agent_version_technical_profile_proposal",
  "materialize_agent_version_technical_profile",
];

const FROZEN_SUPPORT_FIELDS = [
  "behaviorFingerprint",
  "buildReference",
  "runtimeFrameworkReference",
  "entrypointReference",
  "configurationReference",
];

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema, prerequisite tables are missing, or any target table already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.canonical_objects'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.canonical_object_source_mappings'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.discovery_candidates'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.agent_version_technical_profile_proposals'\) is not null/);
  assert.match(code, /to_regclass\('gov_repo\.agent_version_technical_profiles'\) is not null/);
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
    const tableBlock = code.match(new RegExp(`create table gov_repo\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`))?.[1];
    assert.ok(tableBlock, `expected to find CREATE TABLE body for ${table}`);
    assert.match(tableBlock!, /organisation_id\s+uuid\s+not null/, `${table} must declare organisation_id uuid not null`);
  }
});

test("SQL: 1 — typed pre-canonical proposal table declares every frozen AgentVersionTechnicalProfile column, never a generic value column", () => {
  const code = stripSqlComments(readMigration());
  const tableBlock = code.match(/create table gov_repo\.agent_version_technical_profile_proposals\s*\(([\s\S]*?)\n\);/)?.[1];
  assert.ok(tableBlock, "expected to find agent_version_technical_profile_proposals table body");
  for (const column of [
    "behavior_fingerprint_algorithm",
    "behavior_fingerprint_schema_version",
    "behavior_fingerprint_value",
    "build_reference",
    "runtime_framework_reference",
    "entrypoint_reference",
    "configuration_reference",
  ]) {
    assert.match(tableBlock!, new RegExp(`${column}\\s+text`), `proposals table must declare typed column ${column}`);
  }
});

test("SQL: 2 — typed canonical profile table declares every frozen AgentVersionTechnicalProfile column plus revision", () => {
  const code = stripSqlComments(readMigration());
  const tableBlock = code.match(/create table gov_repo\.agent_version_technical_profiles\s*\(([\s\S]*?)\n\);/)?.[1];
  assert.ok(tableBlock, "expected to find agent_version_technical_profiles table body");
  for (const column of [
    "behavior_fingerprint_algorithm",
    "behavior_fingerprint_schema_version",
    "behavior_fingerprint_value",
    "build_reference",
    "runtime_framework_reference",
    "entrypoint_reference",
    "configuration_reference",
    "revision",
  ]) {
    assert.match(tableBlock!, new RegExp(`${column}\\s+`), `canonical profile table must declare typed column ${column}`);
  }
});

test("SQL: 3 — no generic JSONB/EAV semantic profile column exists anywhere in this migration", () => {
  const code = stripSqlComments(readMigration());
  // jsonb is used only for outbox payload construction (a local plpgsql variable, never a stored column).
  const columnDeclarations = [...code.matchAll(/create table gov_repo\.\w+\s*\(([\s\S]*?)\n\);/g)].map((m) => m[1]);
  assert.ok(columnDeclarations.length === NEW_TABLES.length, "expected one CREATE TABLE column block per new table");
  for (const block of columnDeclarations) {
    assert.doesNotMatch(block!, /\bjsonb\b/i, "no table column in this migration may be typed jsonb");
  }
});

test("SQL: 4 — field_name CHECK on every field-support junction table is restricted to the five frozen AgentVersionTechnicalProfileSupport field names, nothing else", () => {
  const code = stripSqlComments(readMigration());
  const checkBlocks = [...code.matchAll(/field_name in \(([\s\S]*?)\)\)/g)];
  assert.ok(checkBlocks.length >= 4, "expected a field_name CHECK on each of the 4 field-support junction tables");
  for (const match of checkBlocks) {
    for (const field of FROZEN_SUPPORT_FIELDS) {
      assert.match(match[1]!, new RegExp(`'${field}'`), `field_name CHECK must include '${field}'`);
    }
    // exactly 5 quoted literals, never a 6th arbitrary field name
    const literals = match[1]!.match(/'[^']+'/g) ?? [];
    assert.equal(literals.length, 5, `field_name CHECK must enumerate exactly the 5 frozen field names, found ${literals.length}`);
  }
});

test("SQL: 5 — RLS is enabled on every new tenant-owned table", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`alter table gov_repo\\.${table} enable row level security;`), `${table} must enable RLS`);
  }
  const revokeBlock = code.match(/revoke all on table\s*\n([\s\S]*?)from public, anon, authenticated;/)?.[1] ?? "";
  for (const table of NEW_TABLES) {
    assert.match(revokeBlock, new RegExp(`gov_repo\\.${table}`), `${table} must be explicitly revoked from public/anon/authenticated`);
  }
});

test("SQL: 6 — no authenticated-role policy is granted on any new table (service_role only)", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.doesNotMatch(
      code,
      new RegExp(`create policy[^;]*on gov_repo\\.${table} for select to authenticated`),
      `${table} must not grant authenticated read access`
    );
    assert.match(
      code,
      new RegExp(`create policy "[^"]+" on gov_repo\\.${table} for all to service_role using \\(true\\) with check \\(true\\);`),
      `${table} must have a service_role full-access policy`
    );
  }
});

test("SQL: 7 — materialize_agent_version_technical_profile gates on canonical target existing and being kind AGENT_VERSION", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /CANONICAL_OBJECT_NOT_FOUND/);
  assert.match(fnBody, /CANONICAL_TARGET_KIND_MISMATCH/);
  assert.match(fnBody, /v_object\.kind\s*<>\s*'AGENT_VERSION'/);
});

test("SQL: 8 — materialize_agent_version_technical_profile gates on an active canonical_object_source_mappings row binding the proposal's own source candidate to the exact canonical target", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /canonical_object_source_mappings/);
  assert.match(fnBody, /csm\.valid_to is null/);
  assert.match(fnBody, /PROPOSAL_NOT_MAPPED_TO_TARGET/);
});

test("SQL: 9 — a replay of the identical (canonical_object_id, proposal_id) pair is detected and returned before any write", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const replayCheckIndex = fnBody.indexOf("agent_version_technical_profile_materializations as m");
  const firstWriteIndex = fnBody.indexOf("insert into gov_repo.agent_version_technical_profile_field_assertions");
  assert.ok(replayCheckIndex > -1 && firstWriteIndex > -1, "expected both the replay check and the first write to be present");
  assert.ok(replayCheckIndex < firstWriteIndex, "the materializations replay check must run before any write");
  assert.match(fnBody, /if v_existing\.materialization_id is not null then\s*\n\s*return query select true,/);
});

test("SQL: 10 — behaviorFingerprint mismatch against an already-governed canonical profile fails closed (AGENT_VERSION_TECHNICAL_REVISION_MISMATCH), never overwritten", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /AGENT_VERSION_TECHNICAL_REVISION_MISMATCH/);
  assert.match(
    fnBody,
    /v_existing_profile\.behavior_fingerprint_algorithm is distinct from v_proposal\.behavior_fingerprint_algorithm/
  );
  assert.match(
    fnBody,
    /v_existing_profile\.behavior_fingerprint_value is distinct from v_proposal\.behavior_fingerprint_value/
  );
  // Fingerprint columns must never appear in the ON CONFLICT DO UPDATE SET clause (structural immutability).
  const upsertSetClause = fnBody.match(/on conflict \(organisation_id, canonical_object_id\) do update set([\s\S]*?);/)?.[1] ?? "";
  assert.doesNotMatch(upsertSetClause, /behavior_fingerprint_algorithm\s*=/, "fingerprint must never be written by the UPDATE branch");
  assert.doesNotMatch(upsertSetClause, /behavior_fingerprint_value\s*=/, "fingerprint must never be written by the UPDATE branch");
});

test("SQL: 11 — a conflicting non-null optional field (existing value differs from a different incoming value) fails closed (AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT), never last-write-wins", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const conflictCount = (fnBody.match(/AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT/g) ?? []).length;
  assert.equal(conflictCount, 4, "expected one AGENT_VERSION_PROFILE_SEMANTIC_CONFLICT raise per optional field (build/runtimeFramework/entrypoint/configuration)");
  for (const column of ["build_reference", "runtime_framework_reference", "entrypoint_reference", "configuration_reference"]) {
    assert.match(
      fnBody,
      new RegExp(
        `v_existing_profile\\.${column} is not null[\\s\\S]{0,40}v_proposal\\.${column} is not null[\\s\\S]{0,60}v_existing_profile\\.${column} is distinct from v_proposal\\.${column}`
      ),
      `${column} must be guarded by a non-null-vs-non-null distinct check before any write`
    );
  }
});

test("SQL: 12 — optional field enrichment is monotonic coalesce(existing, incoming): existing non-null always wins, never erased by an incoming NULL", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  for (const [finalVar, column] of [
    ["v_final_build_reference", "build_reference"],
    ["v_final_runtime_framework_reference", "runtime_framework_reference"],
    ["v_final_entrypoint_reference", "entrypoint_reference"],
    ["v_final_configuration_reference", "configuration_reference"],
  ]) {
    assert.match(
      fnBody,
      new RegExp(`${finalVar}\\s*:=\\s*coalesce\\(v_existing_profile\\.${column}, v_proposal\\.${column}\\)`),
      `${column} enrichment must be coalesce(existing, incoming), never last-write-wins`
    );
  }
});

test("SQL: 13 — field-level assertion/evidence support is a monotonic UNION (INSERT ... ON CONFLICT DO NOTHING), never delete-then-replace", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(fnBody, /delete from gov_repo\.agent_version_technical_profile_field_assertions/, "enrichment must never delete existing field-assertion support");
  assert.doesNotMatch(fnBody, /delete from gov_repo\.agent_version_technical_profile_field_evidence/, "enrichment must never delete existing field-evidence support");
  assert.match(
    fnBody,
    /insert into gov_repo\.agent_version_technical_profile_field_assertions[\s\S]*?on conflict do nothing;/,
    "field-assertion support insert must be idempotent via ON CONFLICT DO NOTHING"
  );
  assert.match(
    fnBody,
    /insert into gov_repo\.agent_version_technical_profile_field_evidence[\s\S]*?on conflict do nothing;/,
    "field-evidence support insert must be idempotent via ON CONFLICT DO NOTHING"
  );
});

test("SQL: 14 — revision only advances for an actual governed change (v_changed-gated), never merely because proposal_id differs", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(
    fnBody,
    /revision = case when v_changed then gov_repo\.agent_version_technical_profiles\.revision \+ 1 else gov_repo\.agent_version_technical_profiles\.revision end/
  );
  // v_changed must be derived from real field/support deltas, not merely set unconditionally to true outside the "first-ever profile" branch.
  assert.match(fnBody, /v_changed :=\s*\n\s*v_final_build_reference is distinct from v_existing_profile\.build_reference/);
  assert.match(fnBody, /if v_assertions_inserted > 0 or v_evidence_inserted > 0 then\s*\n\s*v_changed := true;/);
});

test("SQL: 15 — a pure replay of the identical (canonical_object_id, proposal_id) pair emits no duplicate outbox event", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const replayReturnIndex = fnBody.indexOf("if v_existing.materialization_id is not null then");
  const outboxInsertIndex = fnBody.indexOf("insert into gov_repo.outbox_events");
  assert.ok(replayReturnIndex > -1 && outboxInsertIndex > -1);
  assert.ok(replayReturnIndex < outboxInsertIndex, "the replay early-return must precede the outbox insert");
});

test("SQL: 16 — only the one new outbox event type is added; the prior five allowed event types remain preserved verbatim", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /alter table gov_repo\.outbox_events drop constraint outbox_events_event_type_check;/);
  const checkBlock = code.match(/add constraint outbox_events_event_type_check check \(\s*event_type in \(([\s\S]*?)\)\s*\);/)?.[1] ?? "";
  for (const eventType of [
    "GOVERNANCE_REVIEW_TRANSITIONED",
    "GOVERNANCE_AUTHORIZATION_EVALUATED",
    "GOVERNANCE_RECONCILIATION_DECIDED",
    "GOVERNANCE_CANONICAL_OBJECT_MATERIALIZED",
    "GOVERNANCE_CANONICAL_RELATIONSHIP_MATERIALIZED",
    "GOVERNANCE_AGENT_VERSION_TECHNICAL_PROFILE_MATERIALIZED",
  ]) {
    assert.match(checkBlock, new RegExp(`'${eventType}'`));
  }
  const literals = checkBlock.match(/'[^']+'/g) ?? [];
  assert.equal(literals.length, 6, "expected exactly 5 prior event types plus the 1 new one, never more");
});

test("SQL: source_proposal_id records only the ORIGIN proposal — never written in the UPDATE branch of the canonical profile upsert", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.materialize_agent_version_technical_profile\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const upsertSetClause = fnBody.match(/on conflict \(organisation_id, canonical_object_id\) do update set([\s\S]*?);/)?.[1] ?? "";
  assert.doesNotMatch(upsertSetClause, /source_proposal_id\s*=/, "source_proposal_id must never be overwritten by a later compatible enrichment");
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

test("SQL: agent_version_technical_profiles (the governed canonical profile) is NOT immutable — ADR-anticipated enrichment via UPDATE is intentional", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /agent_version_technical_profiles_no_update/);
});

test("SQL: every new RPC is SECURITY INVOKER with an explicit safe search_path, and never SECURITY DEFINER", () => {
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

test("SQL: this migration never touches any historical migration file's own domain (canonical_objects/canonical_relationships/materialization_operations/materialization_locks/discovery_findings/discovery_candidates untouched)", () => {
  for (const priorPath of PRIOR_MIGRATION_PATHS) {
    const priorCode = readFileSync(priorPath, "utf8");
    assert.doesNotMatch(priorCode, /agent_version_technical_profile/);
  }
});

test("SQL: no destructive statement (DROP TABLE/DROP COLUMN/TRUNCATE) touches any pre-existing table", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /drop table/i);
  assert.doesNotMatch(code, /drop column/i);
  assert.doesNotMatch(code, /truncate/i);
});

test("SQL: extension prerequisites are reused, not re-declared", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /create extension/i);
});

test("SQL: no policy, constraint, index, table, or function identifier exceeds PostgreSQL's 63-byte NAMEDATALEN limit", () => {
  const code = stripSqlComments(readMigration());
  const identifierPatterns: RegExp[] = [
    /constraint (\w+)/g,
    /create index (\w+)/g,
    /create policy "([^"]+)"/g,
    /create table gov_repo\.(\w+)/g,
    /create or replace function gov_repo\.(\w+)/g,
    /create or replace rule (\w+)/g,
  ];
  const offenders: string[] = [];
  for (const pattern of identifierPatterns) {
    for (const match of code.matchAll(pattern)) {
      const name = match[1]!;
      if (Buffer.byteLength(name, "utf8") > 63) {
        offenders.push(name);
      }
    }
  }
  assert.deepEqual(offenders, [], `identifiers exceeding 63 bytes: ${offenders.join(", ")}`);
});

test("SQL: composite tenant-aware FKs are used for every child table referencing a tenant-owned parent", () => {
  const code = stripSqlComments(readMigration());
  const compositeFkPattern = /foreign key \(organisation_id, \w+\)\s*\n?\s*references gov_repo\.\w+ \(organisation_id, \w+\)/g;
  const matches = code.match(compositeFkPattern) ?? [];
  assert.ok(matches.length >= 8, `expected at least 8 composite (organisation_id, id) FKs, found ${matches.length}`);
});

test("SQL: agent_version_technical_profiles carries a single-row-per-AgentVersion primary key (organisation_id, canonical_object_id), never appended per materialization call", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint agent_version_technical_profiles_pkey primary key \(organisation_id, canonical_object_id\)/);
});

test("SQL: agent_version_technical_profile_materializations carries the idempotency-anchor UNIQUE on (organisation_id, canonical_object_id, proposal_id)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /constraint agent_version_technical_profile_materializations_unique\s*\n\s*unique \(organisation_id, canonical_object_id, proposal_id\)/
  );
});
