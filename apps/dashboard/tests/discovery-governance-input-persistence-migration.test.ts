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
  "20260907120000_discovery_governance_input_persistence_v1.sql"
);
const PRIOR_MIGRATION_PATHS = [
  "20260905060000_governance_persistence_v1.sql",
  "20260906120000_canonical_materialization_v1.sql",
  "20260906180000_discovery_intake_v1.sql",
  "20260906190000_governance_workspace_queue_v1.sql",
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
  "discovery_findings",
  "discovery_finding_assertions",
  "discovery_finding_evidence",
  "discovery_candidates",
  "discovery_candidate_assertions",
  "discovery_candidate_evidence",
];
const IMMUTABLE_TABLES = NEW_TABLES;
const NEW_FUNCTIONS = ["record_discovery_finding", "record_discovery_candidate"];

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema, prerequisite tables are missing, or any target table already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subjects'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.acquisition_runs'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.source_assertions'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.discovery_evidence'\) is null/);
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`to_regclass\\('gov_repo\\.${table}'\\) is not null`));
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
    const tableBlock = code.match(new RegExp(`create table gov_repo\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`))?.[1];
    assert.ok(tableBlock, `expected to find CREATE TABLE body for ${table}`);
    assert.match(tableBlock!, /organisation_id\s+uuid\s+not null/, `${table} must declare organisation_id uuid not null`);
  }
});

test("SQL: discovery_findings/discovery_candidates use composite tenant-aware primary keys, never a bare id", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_findings_pkey primary key \(organisation_id, finding_id\)/);
  assert.match(code, /constraint discovery_candidates_pkey primary key \(organisation_id, candidate_id\)/);
});

test("SQL: discovery_candidates carries UNIQUE (organisation_id, finding_id) — the real current 0-or-1 candidate-per-finding cardinality, never assumed 1:1", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_candidates_finding_unique unique \(organisation_id, finding_id\)/);
});

test("SQL: discovery_candidates family/kind/field-shape checks keep OBJECT and RELATIONSHIP candidates structurally distinct", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_candidates_family_check check \(candidate_family in \('OBJECT','RELATIONSHIP'\)\)/);
  assert.match(
    code,
    /constraint discovery_candidates_family_kind_check\s*\n\s*check \(\(candidate_family = 'RELATIONSHIP'\) = \(candidate_kind = 'RELATIONSHIP'\)\)/
  );
  assert.match(code, /constraint discovery_candidates_family_fields_check check \(/);
});

test("SQL: every candidate_kind/finding candidate_kind CHECK enumerates all 11 CanonicalObjectKind values plus RELATIONSHIP", () => {
  const code = stripSqlComments(readMigration());
  const expected = [
    "AGENT",
    "AGENT_VERSION",
    "MODEL",
    "TOOL",
    "MCP_SERVER",
    "API",
    "PROMPT",
    "KNOWLEDGE_BASE",
    "DATA_ASSET",
    "DATA_ELEMENT",
    "SKILL",
    "RELATIONSHIP",
  ];
  const checkBlocks = [...code.matchAll(/candidate_kind in \(([\s\S]*?)\)/g)];
  assert.ok(checkBlocks.length >= 2, "expected candidate_kind CHECK constraints on both discovery_findings and discovery_candidates");
  for (const match of checkBlocks) {
    for (const kind of expected) {
      assert.match(match[1]!, new RegExp(`'${kind}'`), `candidate_kind CHECK must include '${kind}'`);
    }
  }
});

test("SQL: composite tenant-aware FKs are used for every child table referencing a tenant-owned parent", () => {
  const code = stripSqlComments(readMigration());
  const compositeFkPattern = /foreign key \(organisation_id, \w+\)\s*\n?\s*references gov_repo\.\w+ \(organisation_id, \w+\)/g;
  const matches = code.match(compositeFkPattern) ?? [];
  assert.ok(matches.length >= 8, `expected at least 8 composite (organisation_id, id) FKs, found ${matches.length}`);
});

test("SQL: hard gate — review_subjects gains a composite FK into discovery_findings, added NOT VALID, never editing any historical migration file", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /alter table gov_repo\.review_subjects\s*\n\s*add constraint review_subjects_finding_fkey\s*\n\s*foreign key \(organisation_id, finding_id\)\s*\n\s*references gov_repo\.discovery_findings \(organisation_id, finding_id\)\s*\n\s*not valid;/
  );
  for (const priorPath of PRIOR_MIGRATION_PATHS) {
    const priorCode = readFileSync(priorPath, "utf8");
    assert.doesNotMatch(priorCode, /discovery_governance_input_persistence|discovery_findings|discovery_candidates/);
  }
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

test("SQL: RLS is enabled on every new table, PUBLIC/anon/authenticated are revoked, and only a service_role policy exists (never USING(true) for an authenticated policy)", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`alter table gov_repo\\.${table} enable row level security;`), `${table} must enable RLS`);
    assert.match(
      code,
      new RegExp(`create policy "Service role (?:has full access to|access to) ${table}" on gov_repo\\.${table} for all to service_role using \\(true\\) with check \\(true\\);`),
      `${table} must have a service_role full-access policy`
    );
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

test("SQL: record_discovery_finding/record_discovery_candidate do NOT use ON CONFLICT — both tables are immutable via a rewrite RULE, and PostgreSQL disallows ON CONFLICT on such a table. Both use a check-then-insert-with-exception-handler instead.", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of NEW_FUNCTIONS) {
    const fnBody = code.match(new RegExp(`create or replace function gov_repo\\.${fn}\\(([\\s\\S]*?)\\$\\$;`))?.[0] ?? "";
    assert.ok(fnBody, `expected to find function body for ${fn}`);
    assert.doesNotMatch(fnBody, /on conflict/, `${fn} must not use ON CONFLICT`);
    assert.match(fnBody, /exception\s*\n\s*when unique_violation then/, `${fn} must catch unique_violation`);
    const insertIndex = fnBody.indexOf("insert into");
    const exceptionIndex = fnBody.indexOf("when unique_violation");
    assert.ok(insertIndex > -1 && insertIndex < exceptionIndex, `${fn}'s insert must precede its exception handler`);
  }
});

test("SQL: record_discovery_finding treats any reused finding_id as a pure replay (no content comparison) — findingId already excludes detectedAt from its own identity, exactly like record_discovery_evidence/record_discovery_source_assertion", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_discovery_finding\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(fnBody, /DISCOVERY_FINDING_CONFLICT/, "record_discovery_finding must never compare content on conflict — a rescan's differing detectedAt must always replay");
});

test("SQL: record_discovery_candidate validates candidate/finding association (kind + source object) against the already-durable parent finding before ever attempting to insert", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_discovery_candidate\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /DISCOVERY_CANDIDATE_FINDING_NOT_FOUND/);
  assert.match(fnBody, /DISCOVERY_CANDIDATE_KIND_MISMATCH/);
  assert.match(fnBody, /DISCOVERY_CANDIDATE_SOURCE_MISMATCH/);

  const findingLookupIndex = fnBody.indexOf("select * into v_finding");
  const insertIndex = fnBody.indexOf("insert into gov_repo.discovery_candidates");
  assert.ok(findingLookupIndex > -1 && insertIndex > -1 && findingLookupIndex < insertIndex, "the association check must run before the insert is attempted");
});

test("SQL: record_discovery_candidate fails closed on a genuinely different envelope_hash for a reused candidate_id, and distinguishes that from a second distinct candidate claiming the same finding", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_discovery_candidate\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /DISCOVERY_CANDIDATE_CONFLICT/);
  assert.match(fnBody, /DISCOVERY_CANDIDATE_FINDING_ALREADY_HAS_CANDIDATE/);
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

test("SQL: no policy or constraint identifier exceeds PostgreSQL's 63-byte NAMEDATALEN limit", () => {
  const code = stripSqlComments(readMigration());
  const policyNames = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(policyNames.length > 0, "expected to find policy declarations");
  for (const name of policyNames) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, `policy name "${name}" is too long`);
  }
  const constraintNames = [...code.matchAll(/constraint (\w+)/g)].map((m) => m[1]);
  for (const name of constraintNames) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, `constraint name "${name}" is too long`);
  }
});

test("SQL: envelope_hash format is checked as 64 lowercase hex characters on both new tables", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_findings_envelope_hash_format_check check \(envelope_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(code, /constraint discovery_candidates_envelope_hash_format_check check \(envelope_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});
