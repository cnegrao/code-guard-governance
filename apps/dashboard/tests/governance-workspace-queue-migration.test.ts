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
  "20260906190000_governance_workspace_queue_v1.sql",
);
const PRIOR_MIGRATION_PATHS = [
  "20260905060000_governance_persistence_v1.sql",
  "20260906120000_canonical_materialization_v1.sql",
  "20260906180000_discovery_intake_v1.sql",
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

test("SQL: migration wraps everything in a single begin/commit transaction", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code.trim(), /^begin;/);
  assert.match(code.trim(), /commit;\s*$/);
});

test("SQL: preflight fails closed if gov_repo schema or Governance Persistence V1 tables are missing, or the view already exists", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /to_regnamespace\('gov_repo'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subjects'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subject_evidence'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subject_assertions'\) is null/);
  assert.match(code, /to_regclass\('gov_repo\.review_subject_queue'\) is not null/);
});

test("SQL: exactly one view is created, exactly once", () => {
  const code = stripSqlComments(readMigration());
  const matches = code.match(/create view gov_repo\.review_subject_queue/g) ?? [];
  assert.equal(matches.length, 1);
});

test("SQL: the view is security_invoker so it never becomes a privilege-escalation path around RLS", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /create view gov_repo\.review_subject_queue\s*\nwith \(security_invoker = true\) as/);
});

test("SQL: the view composes review_subjects with grouped counts from review_subject_evidence and review_subject_assertions, never a per-row correlated subquery", () => {
  const code = stripSqlComments(readMigration());
  const viewBody = code.match(/create view gov_repo\.review_subject_queue[\s\S]*?;\n\n/)?.[0] ?? "";
  assert.match(viewBody, /from gov_repo\.review_subjects rs/);
  assert.match(viewBody, /left join \(\s*\n\s*select review_subject_id, count\(\*\) as evidence_count\s*\n\s*from gov_repo\.review_subject_evidence\s*\n\s*group by review_subject_id\s*\n\s*\) ev on ev\.review_subject_id = rs\.review_subject_id/);
  assert.match(viewBody, /left join \(\s*\n\s*select review_subject_id, count\(\*\) as assertion_count\s*\n\s*from gov_repo\.review_subject_assertions\s*\n\s*group by review_subject_id\s*\n\s*\) asrt on asrt\.review_subject_id = rs\.review_subject_id/);
});

test("SQL: triage_rank ranks DETECTED/PROPOSED/CONFIRMED ahead of terminal states", () => {
  const code = stripSqlComments(readMigration());
  assert.match(
    code,
    /case when rs\.state in \('DETECTED', 'PROPOSED', 'CONFIRMED'\) then 0 else 1 end as triage_rank/,
  );
});

test("SQL: PUBLIC/anon/authenticated are revoked from the view and only service_role may select from it", () => {
  const code = stripSqlComments(readMigration());
  assert.match(code, /revoke all on gov_repo\.review_subject_queue from public, anon, authenticated;/);
  assert.match(code, /grant select on gov_repo\.review_subject_queue to service_role;/);
  assert.doesNotMatch(code, /grant select on gov_repo\.review_subject_queue to authenticated/);
});

test("SQL: this migration is purely additive — no DROP/ALTER/TRUNCATE of any existing table, and no write path (INSERT/UPDATE/DELETE) is introduced", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /drop table/i);
  assert.doesNotMatch(code, /drop column/i);
  assert.doesNotMatch(code, /truncate/i);
  assert.doesNotMatch(code, /alter table/i);
  assert.doesNotMatch(code, /\binsert into\b/i);
  assert.doesNotMatch(code, /\bupdate gov_repo\./i);
  assert.doesNotMatch(code, /\bdelete from\b/i);
});

test("SQL: no historical migration file is modified by this change", () => {
  for (const priorPath of PRIOR_MIGRATION_PATHS) {
    const priorCode = readFileSync(priorPath, "utf8");
    assert.doesNotMatch(priorCode, /review_subject_queue/);
  }
});

test("SQL: no new function/RPC is introduced — this is a read-only view addition only", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /create (or replace )?function/i);
});
