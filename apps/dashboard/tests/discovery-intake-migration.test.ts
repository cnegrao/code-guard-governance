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
  "20260906180000_discovery_intake_v1.sql"
);
const PRIOR_MIGRATION_PATH = path.join(
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

const NEW_TABLES = ["acquisition_runs", "discovery_evidence", "source_assertions", "source_assertion_evidence"];
const IMMUTABLE_TABLES = ["discovery_evidence", "source_assertions", "source_assertion_evidence"];
const MUTABLE_TABLES = ["acquisition_runs"];
const NEW_FUNCTIONS = [
  "start_acquisition_run",
  "complete_acquisition_run",
  "record_discovery_evidence",
  "record_discovery_source_assertion",
];

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema, Governance Persistence V1 tables are missing, or any target table already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subjects'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subject_assertions'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subject_evidence'\) is null/);
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
    const tableBlock = code.match(
      new RegExp(`create table gov_repo\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`)
    )?.[1];
    assert.ok(tableBlock, `expected to find CREATE TABLE body for ${table}`);
    assert.match(tableBlock!, /organisation_id\s+uuid\s+not null/, `${table} must declare organisation_id uuid not null`);
  }
});

test("SQL: composite tenant-aware FKs are used for every child table referencing a tenant-owned parent", () => {
  const code = stripSqlComments(readMigration());
  const compositeFkPattern = /foreign key \(organisation_id, \w+\)\s*\n?\s*references gov_repo\.\w+ \(organisation_id, \w+\)/g;
  const matches = code.match(compositeFkPattern) ?? [];
  assert.ok(matches.length >= 5, `expected at least 5 composite (organisation_id, id) FKs, found ${matches.length}`);
});

test("SQL: hard gate — review_subject_assertions/review_subject_evidence gain composite FKs into the new durable tables, added NOT VALID (enforced for every future write; historical controlled-project test data predating this migration is never required to retroactively satisfy it), never editing the historical migration file", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /alter table gov_repo\.review_subject_assertions\s*\n\s*add constraint review_subject_assertions_assertion_fkey\s*\n\s*foreign key \(organisation_id, assertion_id\)\s*\n\s*references gov_repo\.source_assertions \(organisation_id, assertion_id\)\s*\n\s*not valid;/
  );
  assert.match(
    code,
    /alter table gov_repo\.review_subject_evidence\s*\n\s*add constraint review_subject_evidence_evidence_fkey\s*\n\s*foreign key \(organisation_id, evidence_id\)\s*\n\s*references gov_repo\.discovery_evidence \(organisation_id, evidence_id\)\s*\n\s*not valid;/
  );

  // And the historical migration itself is byte-for-byte untouched.
  const priorCode = readFileSync(PRIOR_MIGRATION_PATH, "utf8");
  assert.doesNotMatch(priorCode, /source_assertions|discovery_intake/);
});

test("SQL: every immutable table has unconditional no-update and no-delete rules; acquisition_runs (the one mutable projection) does not", () => {
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
  for (const table of MUTABLE_TABLES) {
    assert.doesNotMatch(code, new RegExp(`rule ${table}_no_update`));
    assert.doesNotMatch(code, new RegExp(`rule ${table}_no_delete`));
    assert.match(
      code,
      new RegExp(`create trigger trg_${table}_updated_at\\s*\\n\\s*before update on gov_repo\\.${table}\\s*\\n\\s*for each row execute function gov_repo\\.set_updated_at\\(\\);`)
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

test("SQL: start_acquisition_run always inserts status RUNNING regardless of caller input (no p_status parameter accepted)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.start_acquisition_run\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(fnBody, /p_status/, "start_acquisition_run must not accept a caller-supplied status at all");
  assert.match(fnBody, /'RUNNING'/);
});

test("SQL: complete_acquisition_run rejects a non-terminal status and locks the run row before deciding replay-vs-conflict", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.complete_acquisition_run\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /UNSUPPORTED_ACQUISITION_RUN_TERMINAL_STATUS/);
  assert.match(fnBody, /for update/);
  const forUpdateIndex = fnBody.indexOf("for update");
  const conflictCheckIndex = fnBody.indexOf("ACQUISITION_RUN_COMPLETION_CONFLICT");
  const updateIndex = fnBody.indexOf("update gov_repo.acquisition_runs");
  assert.ok(forUpdateIndex > -1 && forUpdateIndex < conflictCheckIndex && conflictCheckIndex < updateIndex);
});

test("SQL: complete_acquisition_run fails closed on cross-tenant completion before touching any row", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.complete_acquisition_run\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /Cross-tenant acquisition run completion rejected/);
  const crossTenantIndex = fnBody.indexOf("Cross-tenant acquisition run completion rejected");
  const updateIndex = fnBody.indexOf("update gov_repo.acquisition_runs");
  assert.ok(crossTenantIndex > -1 && crossTenantIndex < updateIndex);
});

test("SQL: start_acquisition_run uses ON CONFLICT DO NOTHING with the #variable_conflict use_column pragma declared first (acquisition_runs carries no rewrite rule, so ON CONFLICT is legal there)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.start_acquisition_run\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.match(fnBody, /on conflict/, "expected start_acquisition_run to use ON CONFLICT");
  const pragmaIndex = fnBody.indexOf("#variable_conflict use_column");
  const conflictIndex = fnBody.indexOf("on conflict");
  assert.ok(pragmaIndex > -1 && pragmaIndex < conflictIndex, "start_acquisition_run must declare the pragma before its ON CONFLICT clause");
});

test("SQL: record_discovery_evidence / record_discovery_source_assertion do NOT use ON CONFLICT — gov_repo.discovery_evidence and gov_repo.source_assertions are immutable via a rewrite RULE, and PostgreSQL disallows ON CONFLICT on such a table (a real defect found and fixed via the controlled runtime gate: 'INSERT with ON CONFLICT clause cannot be used with table that has INSERT or UPDATE rules'). Both use a check-then-insert-with-exception-handler instead, matching gov_repo.record_authorization_decision's established precedent.", () => {
  const code = stripSqlComments(readMigration());
  for (const fn of ["record_discovery_evidence", "record_discovery_source_assertion"]) {
    const fnBody = code.match(new RegExp(`create or replace function gov_repo\\.${fn}\\(([\\s\\S]*?)\\$\\$;`))?.[0] ?? "";
    assert.ok(fnBody, `expected to find function body for ${fn}`);
    assert.doesNotMatch(fnBody, /on conflict/, `${fn} must not use ON CONFLICT`);
    assert.match(fnBody, /exception\s*\n\s*when unique_violation then/, `${fn} must catch unique_violation`);
    const insertIndex = fnBody.indexOf("insert into");
    const exceptionIndex = fnBody.indexOf("when unique_violation");
    assert.ok(insertIndex > -1 && insertIndex < exceptionIndex, `${fn}'s insert must precede its exception handler`);
  }
});

test("SQL: record_discovery_source_assertion inserts evidence membership inside the same winning-insert block (never reached on a replay, since the assertion insert itself raises unique_violation first)", () => {
  const code = stripSqlComments(readMigration());
  const fnBody = code.match(/create or replace function gov_repo\.record_discovery_source_assertion\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  const assertionInsertIndex = fnBody.indexOf("insert into gov_repo.source_assertions");
  const membershipInsertIndex = fnBody.indexOf("insert into gov_repo.source_assertion_evidence");
  const exceptionIndex = fnBody.indexOf("when unique_violation");
  assert.ok(assertionInsertIndex > -1 && membershipInsertIndex > -1 && exceptionIndex > -1);
  assert.ok(assertionInsertIndex < membershipInsertIndex && membershipInsertIndex < exceptionIndex);
});

test("SQL: evidence/source_assertions are tenant-scoped by a composite (organisation_id, id) primary key, and record_discovery_evidence/record_discovery_source_assertion treat any reused id for the same tenant as a pure replay (no content comparison, since evidenceId/assertionId already exclude the wall-clock capture moment from their own identity)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_evidence_pkey primary key \(organisation_id, evidence_id\)/);
  assert.match(code, /constraint source_assertions_pkey primary key \(organisation_id, assertion_id\)/);
  assert.match(code, /constraint source_assertion_evidence_pkey primary key \(organisation_id, assertion_id, evidence_id\)/);

  const evidenceFn = code.match(/create or replace function gov_repo\.record_discovery_evidence\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(evidenceFn, /EVIDENCE_ID_CONFLICT/);

  const assertionFn = code.match(/create or replace function gov_repo\.record_discovery_source_assertion\(([\s\S]*?)\$\$;/)?.[0] ?? "";
  assert.doesNotMatch(assertionFn, /SOURCE_ASSERTION_ID_CONFLICT/);
});

test("SQL: content-conflict still fails closed (23505) on start_acquisition_run / complete_acquisition_run for a reused run id with different content — run_id is a fresh random identity per scan, never a legitimate content-addressed replay target", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /message = 'ACQUISITION_RUN_ID_CONFLICT'/);
  assert.match(code, /message = 'ACQUISITION_RUN_COMPLETION_CONFLICT'/);
});

test("SQL: envelope_hash format is checked as 64 lowercase hex characters on discovery_evidence and source_assertions", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /constraint discovery_evidence_envelope_hash_format_check check \(envelope_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(code, /constraint source_assertions_envelope_hash_format_check check \(envelope_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test("SQL: source_assertions.run_id is tenant-FK'd to acquisition_runs (never a bare unchecked reference)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /constraint source_assertions_run_fkey\s*\n\s*foreign key \(organisation_id, run_id\)\s*\n\s*references gov_repo\.acquisition_runs \(organisation_id, run_id\)/
  );
});

test("SQL: source_assertion_evidence FKs both to its owning assertion and to the evidence it cites (the hard gate's own membership table)", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /constraint source_assertion_evidence_assertion_fkey\s*\n\s*foreign key \(organisation_id, assertion_id\)\s*\n\s*references gov_repo\.source_assertions \(organisation_id, assertion_id\)/
  );
  assert.match(
    code,
    /constraint source_assertion_evidence_evidence_fkey\s*\n\s*foreign key \(organisation_id, evidence_id\)\s*\n\s*references gov_repo\.discovery_evidence \(organisation_id, evidence_id\)/
  );
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
