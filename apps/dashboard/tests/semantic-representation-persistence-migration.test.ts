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
  "20260909120000_semantic_representation_persistence_v1.sql",
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
  "semantic_representations",
  "semantic_representation_assertions",
  "semantic_representation_evidence",
];

const NEW_FUNCTIONS = ["record_semantic_representation"];

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema, prerequisite tables are missing, or any target table already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.canonical_objects'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.discovery_candidates'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.source_assertions'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.discovery_evidence'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.semantic_representations'\) is not null/);
});

test("SQL: pgvector extension is declared idempotently, not assumed", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /create extension if not exists "vector";/);
});

test("SQL: every new table is created exactly once", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    const matches = code.match(new RegExp(`create table gov_repo\\.${table}\\s*\\(`, "g")) ?? [];
    assert.equal(matches.length, 1, `expected exactly one CREATE TABLE for ${table}`);
  }
});

test("SQL: every new table carries an explicit organisation_id column and no jsonb semantic-value column", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    const tableMatch = code.match(new RegExp(`create table gov_repo\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
    assert.ok(tableMatch, `could not locate CREATE TABLE body for ${table}`);
    const body = tableMatch[1];
    assert.match(body, /organisation_id\s+uuid\s+not null/, `${table} must have organisation_id uuid not null`);
    assert.doesNotMatch(body, /\bjsonb\b/, `${table} must not carry a jsonb column (no generic JSON/EAV value store)`);
  }
});

test("SQL: semantic_representations has no fixed-dimension vector column and no ANN index", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /embedding\s+vector\s+not null/);
  assert.doesNotMatch(code, /vector\(\d+\)/, "must not declare a fixed-dimension vector column");
  assert.doesNotMatch(code, /using\s+hnsw/i, "must not create an HNSW index (L8 similarity is out of scope)");
  assert.doesNotMatch(code, /using\s+ivfflat/i, "must not create an IVFFlat index (L8 similarity is out of scope)");
});

test("SQL: embedding dimension is CHECK-verified against the actual vector length", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint semantic_representations_dimension_matches_vector check \(vector_dims\(embedding\) = embedding_dimension\)/);
  assert.match(code, /constraint semantic_representations_dimension_positive check \(embedding_dimension > 0\)/);
});

test("SQL: subject shape CHECK enforces CANONICAL_OBJECT and NORMALIZED_CANDIDATE are mutually exclusive", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint semantic_representations_subject_shape_check check \(/);
  assert.match(code, /subject_kind = 'CANONICAL_OBJECT'/);
  assert.match(code, /subject_kind = 'NORMALIZED_CANDIDATE'/);
});

test("SQL: subject foreign keys reference canonical_objects and discovery_candidates by (organisation_id, id)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /foreign key \(organisation_id, subject_canonical_object_id\)\s*\n\s*references gov_repo\.canonical_objects \(organisation_id, canonical_object_id\)/,
  );
  assert.match(
    code,
    /foreign key \(organisation_id, subject_candidate_id\)\s*\n\s*references gov_repo\.discovery_candidates \(organisation_id, candidate_id\)/,
  );
});

test("SQL: support tables reference source_assertions and discovery_evidence by (organisation_id, id)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /foreign key \(organisation_id, assertion_id\)\s*\n\s*references gov_repo\.source_assertions \(organisation_id, assertion_id\)/,
  );
  assert.match(
    code,
    /foreign key \(organisation_id, evidence_id\)\s*\n\s*references gov_repo\.discovery_evidence \(organisation_id, evidence_id\)/,
  );
});

test("SQL: every new table is immutable (no UPDATE/DELETE rule pair missing)", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.match(
      code,
      new RegExp(`create or replace rule ${table}_no_update as\\s*\\n\\s*on update to gov_repo\\.${table} do instead nothing;`),
      `${table} must forbid UPDATE`,
    );
    assert.match(
      code,
      new RegExp(`create or replace rule ${table}_no_delete as\\s*\\n\\s*on delete to gov_repo\\.${table} do instead nothing;`),
      `${table} must forbid DELETE`,
    );
  }
});

test("SQL: RLS is enabled on every new table with only a service_role policy (no authenticated-role policy)", () => {
  const code = stripSqlComments(readMigration());
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`alter table gov_repo\\.${table} enable row level security;`));
  }
  assert.match(code, /revoke all on table\s*\n\s*gov_repo\.semantic_representations,\s*\n\s*gov_repo\.semantic_representation_assertions,\s*\n\s*gov_repo\.semantic_representation_evidence\s*\nfrom public, anon, authenticated;/);
  const policyMatches = code.match(/create policy "[^"]+" on gov_repo\.semantic_representation\w* for all to service_role using \(true\) with check \(true\);/g) ?? [];
  assert.equal(policyMatches.length, NEW_TABLES.length, "expected exactly one service_role policy per new table");
  assert.doesNotMatch(code, /for (select|all) to authenticated/, "must not grant authenticated-role access on this table family");
});

for (const table of NEW_TABLES) {
  test(`SQL: policy name for ${table} does not exceed PostgreSQL's 63-byte identifier limit`, () => {
    const code = stripSqlComments(readMigration());
    const match = code.match(new RegExp(`create policy "([^"]+)" on gov_repo\\.${table} `));
    assert.ok(match, `expected a policy for ${table}`);
    assert.ok(Buffer.byteLength(match![1], "utf8") <= 63, `policy name "${match![1]}" exceeds 63 bytes`);
  });
}

test("SQL: no identifier (table, constraint, index, policy, function) exceeds 63 bytes", () => {
  const code = stripSqlComments(readMigration());
  const identifierPatterns = [
    /create table gov_repo\.(\w+)/g,
    /constraint (\w+)/g,
    /create index (\w+)/g,
    /create or replace function gov_repo\.(\w+)/g,
    /create or replace rule (\w+)/g,
  ];
  for (const pattern of identifierPatterns) {
    for (const match of code.matchAll(pattern)) {
      const identifier = match[1];
      assert.ok(
        Buffer.byteLength(identifier, "utf8") <= 63,
        `identifier "${identifier}" exceeds PostgreSQL's 63-byte NAMEDATALEN limit`,
      );
    }
  }
});

test("SQL: record_semantic_representation is created exactly once and validates subject existence before any write", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of NEW_FUNCTIONS) {
    const matches = code.match(new RegExp(`create or replace function gov_repo\\.${fn}\\(`, "g")) ?? [];
    assert.equal(matches.length, 1, `expected exactly one CREATE FUNCTION for ${fn}`);
  }
  assert.match(code, /SUBJECT_CANONICAL_OBJECT_NOT_FOUND/);
  assert.match(code, /SUBJECT_CANDIDATE_NOT_FOUND/);
  assert.match(code, /SUBJECT_KIND_MISMATCH/);
  assert.match(code, /EMBEDDING_DIMENSION_MISMATCH/);
});

test("SQL: the idempotency replay check runs before the first INSERT into semantic_representations", () => {
  const code = stripSqlComments(readMigration());
  const fnStart = code.indexOf("create or replace function gov_repo.record_semantic_representation(");
  assert.ok(fnStart >= 0);
  const fnBody = code.slice(fnStart);
  const replayCheckIndex = fnBody.indexOf("SEMANTIC_REPRESENTATION_IDEMPOTENCY_CONFLICT");
  const firstInsertIndex = fnBody.indexOf("insert into gov_repo.semantic_representations (");
  assert.ok(replayCheckIndex >= 0 && firstInsertIndex >= 0);
  assert.ok(replayCheckIndex < firstInsertIndex, "idempotency conflict check must run before the first write");
});

test("SQL: the function never creates, mutates, certifies, or reconciles a canonical object or relationship", () => {
  const code = stripSqlComments(readMigration());
  const fnStart = code.indexOf("create or replace function gov_repo.record_semantic_representation(");
  const fnEnd = code.indexOf("$$;", fnStart) + 3;
  const fnBody = code.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnBody, /insert into gov_repo\.canonical_objects/);
  assert.doesNotMatch(fnBody, /insert into gov_repo\.canonical_relationships/);
  assert.doesNotMatch(fnBody, /insert into gov_repo\.review_subjects/);
  assert.doesNotMatch(fnBody, /insert into gov_repo\.reconciliation_decisions/);
  assert.doesNotMatch(fnBody, /update gov_repo\.canonical_objects/);
});

test("SQL: this migration does not touch canonical_objects, canonical_relationships, or historical tables", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /alter table gov_repo\.canonical_objects/);
  assert.doesNotMatch(code, /alter table gov_repo\.canonical_relationships/);
  assert.doesNotMatch(code, /alter table gov_repo\.discovery_candidates/);
  assert.doesNotMatch(code, /alter table gov_repo\.outbox_events/);
});

test("SQL: EXECUTE is revoked from public/anon/authenticated and granted only to service_role", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of NEW_FUNCTIONS) {
    assert.match(code, new RegExp(`revoke all on function gov_repo\\.${fn} from public, anon, authenticated;`));
    assert.match(code, new RegExp(`grant execute on function gov_repo\\.${fn} to service_role;`));
  }
});
