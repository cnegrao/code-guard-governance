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
  "20260903200100_atomic_signup_legacy_rpc.sql"
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

// Strips SQL line comments (`-- ...`) so structural checks below can't be
// fooled by prose mentioning words like "loop" or "rollback" in documentation.
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Static invariant: the application must send business signup data only.
// No generator lives in the app any more, and no p_org_code key may be sent.
// Proven at the source-text level — actual runtime call behavior against a
// live Supabase client is proven in the separate local-DB runtime gate.
// ---------------------------------------------------------------------------

test("persistence source: no generateOrgCode / org-code module import remains", () => {
  const source = readFileSync(path.join(APP_ROOT, "lib/auth/persistence.ts"), "utf8");
  assert.doesNotMatch(source, /generateOrgCode/);
  assert.doesNotMatch(source, /["']\.\/org-code["']/);
});

test("persistence source: the signup_legacy RPC call sends exactly the 4 canonical parameters — no p_org_code, no p_industry_profile", () => {
  const source = readFileSync(path.join(APP_ROOT, "lib/auth/persistence.ts"), "utf8");
  const rpcCall = source.match(/privilegedDb\.rpc\(\s*"signup_legacy",\s*\{([\s\S]*?)\}\s*\)/)?.[1] ?? "";

  assert.notEqual(rpcCall, "", "expected to find the signup_legacy rpc() call arguments object");
  assert.doesNotMatch(rpcCall, /p_org_code/, "the application must never send p_org_code — org_code is DB-authoritative");
  assert.doesNotMatch(rpcCall, /p_industry_profile/, "the application must never send p_industry_profile — canonical organisations has no column for it");

  const sentKeys = [...rpcCall.matchAll(/^\s*(p_\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    sentKeys,
    ["p_email", "p_full_name", "p_org_name", "p_password_hash"].sort(),
    "signupLegacyAtomic must send exactly the 4 canonical business signup parameters"
  );
});

test("persistence source: signupLegacyAtomic's own input type carries no industry field", () => {
  const source = readFileSync(path.join(APP_ROOT, "lib/auth/persistence.ts"), "utf8");
  const inputType = source.match(/export async function signupLegacyAtomic\(input:\s*\{([\s\S]*?)\}\)/)?.[1] ?? "";
  assert.notEqual(inputType, "", "expected to find signupLegacyAtomic's input type");
  assert.doesNotMatch(inputType, /industry/i);
  assert.match(inputType, /email:\s*string/);
  assert.match(inputType, /orgName:\s*string/);
});

test("services/auth source: signup() may still accept industry for the application session, but never forwards it to signupLegacyAtomic", () => {
  const source = readFileSync(path.join(APP_ROOT, "services/auth.ts"), "utf8");
  const signupFn = source.match(/export async function signup\(input:\s*\{([\s\S]*?)\}\): Promise<SignupResult> \{([\s\S]*?)\n\}/)?.[0] ?? "";
  assert.notEqual(signupFn, "", "expected to find the signup() function");

  const signupInputType = signupFn.match(/input:\s*\{([\s\S]*?)\}\): Promise<SignupResult>/)?.[1] ?? "";
  assert.match(signupInputType, /industry:\s*string/, "the application-level signup input may still accept industry");

  const persistenceCall = signupFn.match(/signupLegacyAtomic\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
  assert.notEqual(persistenceCall, "", "expected to find the signupLegacyAtomic(...) call inside signup()");
  assert.doesNotMatch(persistenceCall, /industry/i, "industry must not be forwarded to the Auth persistence RPC boundary");
});

test("lib/auth/org-code.ts has been removed (no remaining valid consumer)", () => {
  assert.throws(() => readFileSync(path.join(APP_ROOT, "lib/auth/org-code.ts"), "utf8"));
});

// ---------------------------------------------------------------------------
// Static SQL invariants — actual DB execution is proven in the separate
// local-DB runtime gate, not here. These are deterministic text-level checks.
// ---------------------------------------------------------------------------

test("SQL: signup_legacy's canonical signature is exactly the 4 business parameters — no p_org_code, no p_industry_profile", () => {
  const sql = readMigration();
  const createSignature = sql.match(/CREATE OR REPLACE FUNCTION gov_repo\.signup_legacy\(([\s\S]*?)\)\s*RETURNS/)?.[1] ?? "";
  assert.doesNotMatch(createSignature, /p_org_code/);
  assert.doesNotMatch(createSignature, /p_industry_profile/);

  const paramNames = [...createSignature.matchAll(/(p_\w+)\s+varchar/g)].map((m) => m[1]);
  assert.deepEqual(paramNames, ["p_email", "p_password_hash", "p_full_name", "p_org_name"]);
});

test("SQL: no stale signup_legacy overload can remain executable (6-param, 5-param, and final 4-param signatures are all explicitly dropped)", () => {
  const sql = readMigration();
  const dropStatements = [...sql.matchAll(/DROP FUNCTION IF EXISTS gov_repo\.signup_legacy\(([\s\S]*?)\);/g)].map(
    (m) => m[1]
  );
  assert.equal(dropStatements.length, 3, "expected one DROP each for the old 6-param, prior 5-param, and final 4-param signatures");

  assert.ok(
    dropStatements.some((sig) => /p_org_code/.test(sig) && /p_industry_profile/.test(sig)),
    "the old 6-param signature (org_code + industry_profile) must be explicitly dropped"
  );
  assert.ok(
    dropStatements.some((sig) => !/p_org_code/.test(sig) && /p_industry_profile/.test(sig)),
    "the prior 5-param signature (industry_profile, no org_code) must be explicitly dropped"
  );
  assert.ok(
    dropStatements.some((sig) => !/p_org_code/.test(sig) && !/p_industry_profile/.test(sig)),
    "the final 4-param canonical signature must also be covered for idempotent re-execution"
  );

  const createCount = (sql.match(/CREATE OR REPLACE FUNCTION gov_repo\.signup_legacy\(/g) ?? []).length;
  assert.equal(createCount, 1, "exactly one canonical signup_legacy definition must exist");
});

test("SQL: organisation INSERT never references external_refs, and no jsonb_build_object industry persistence path remains", () => {
  const sql = readMigration();
  const code = stripSqlComments(sql);
  assert.doesNotMatch(code, /external_refs/, "canonical gov_repo.organisations has no external_refs column");
  assert.doesNotMatch(code, /jsonb_build_object/, "no jsonb industry-persistence construction should remain");
  assert.doesNotMatch(code, /v_external_refs/);

  const insertColumns = sql.match(/INSERT INTO gov_repo\.organisations(?:\s+AS\s+\w+)?\s*\(([\s\S]*?)\)/)?.[1] ?? "";
  const columns = insertColumns.split(",").map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(
    columns,
    ["organisation_id", "org_code", "legal_name", "display_name", "country_code", "is_active"],
    "organisation INSERT must use only columns that actually exist on the canonical table"
  );
});

test("SQL: org_code is generated from the function's own freshly generated organisation_id, via pg_catalog.gen_random_uuid()", () => {
  const sql = readMigration();
  const orgIdAssignIndex = sql.indexOf("v_org_id := pg_catalog.gen_random_uuid();");
  const suffixAssignIndex = sql.indexOf("v_org_code_suffix := upper(substr(replace(v_org_id::text");
  const insertIndex = sql.indexOf("INSERT INTO gov_repo.organisations");

  assert.notEqual(orgIdAssignIndex, -1, "organisation_id must be generated explicitly via pg_catalog.gen_random_uuid() before use");
  assert.notEqual(suffixAssignIndex, -1, "org_code suffix must be derived from v_org_id");
  assert.ok(
    orgIdAssignIndex < suffixAssignIndex && suffixAssignIndex < insertIndex,
    "organisation_id must be generated, then used to derive the org_code suffix, before the organisation INSERT"
  );
});

test("SQL: signup_legacy does not depend on extensions.uuid_generate_v4() — only pg_catalog.gen_random_uuid() is called", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(
    code,
    /uuid_generate_v4/,
    "the function body must not call uuid_generate_v4() — it lives in the uuid-ossp extension's schema, which is deliberately excluded from this function's search_path"
  );
  assert.match(
    code,
    /v_org_id\s*:=\s*pg_catalog\.gen_random_uuid\(\);/,
    "v_org_id must be generated via the schema-qualified, pg_catalog-native gen_random_uuid()"
  );
});

test("SQL: org_code retains a human-recognisable prefix derived from p_org_name", () => {
  const sql = readMigration();
  assert.match(sql, /v_org_code_prefix\s*:=\s*NULLIF\(\s*substr\(regexp_replace\(upper\(p_org_name\)/);
  assert.match(sql, /v_org_code_prefix\s*:=\s*'ORG';/, "must fall back to a safe prefix when the name has no alphanumeric characters");
});

test("SQL: generated org_code expression cannot exceed the varchar(20) column limit", () => {
  const sql = readMigration();

  const prefixWidth = Number(sql.match(/v_org_code_prefix\s+varchar\((\d+)\)/)?.[1]);
  const suffixWidth = Number(sql.match(/v_org_code_suffix\s+varchar\((\d+)\)/)?.[1]);
  const codeWidth = Number(sql.match(/v_org_code\s+varchar\((\d+)\);/)?.[1]);

  assert.ok(prefixWidth > 0 && suffixWidth > 0 && codeWidth > 0, "expected declared varchar widths for prefix/suffix/code");
  assert.equal(codeWidth, 20, "org_code variable must be declared at exactly the column limit");

  const separatorWidth = 1; // '_'
  assert.ok(
    prefixWidth + separatorWidth + suffixWidth <= codeWidth,
    `prefix(${prefixWidth}) + separator(${separatorWidth}) + suffix(${suffixWidth}) must not exceed varchar(${codeWidth})`
  );
});

test("SQL: suffix entropy is materially stronger than the previous 32-bit/8-hex-character design", () => {
  const sql = readMigration();
  const suffixLenArg = Number(
    sql.match(/v_org_code_suffix\s*:=\s*upper\(substr\(replace\(v_org_id::text,\s*'-',\s*''\),\s*1,\s*(\d+)\)\)/)?.[1]
  );

  assert.ok(suffixLenArg > 0, "expected to find the suffix substr length");
  const PREVIOUS_APP_SIDE_SUFFIX_HEX_CHARS = 8; // 32 bits — the design this gate replaces
  assert.ok(
    suffixLenArg > PREVIOUS_APP_SIDE_SUFFIX_HEX_CHARS,
    `suffix must use more hex characters (${suffixLenArg}) than the previous 32-bit design (${PREVIOUS_APP_SIDE_SUFFIX_HEX_CHARS})`
  );
  // Each hex character contributes 4 bits; document, do not claim probabilistic uniqueness.
  const bitsOfEntropy = suffixLenArg * 4;
  assert.ok(bitsOfEntropy >= 44, `expected >= 44 bits of suffix entropy, got ${bitsOfEntropy}`);
});

test("SQL: no retry loop around org_code generation, and no ON CONFLICT bypass of the UNIQUE invariant", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /ON CONFLICT/i);
  assert.doesNotMatch(code, /\bLOOP\b/i);
});

test("SQL: organisations_org_code_unique remains the final uniqueness invariant in the base schema", () => {
  const baseSchema = readFileSync(
    path.join(APP_ROOT, "..", "..", "supabase", "migrations", "20260818003539_gov_repo_types_and_organisations.sql"),
    "utf8"
  );
  assert.match(baseSchema, /constraint organisations_org_code_unique unique \(org_code\)/);
});

test("SQL: signup_legacy remains atomic — single function body, org insert before user insert, no explicit sub-transaction control", () => {
  const code = stripSqlComments(readMigration());
  assert.doesNotMatch(code, /\bCOMMIT\b|\bROLLBACK\b|\bSAVEPOINT\b/i);

  const orgInsertIndex = code.indexOf("INSERT INTO gov_repo.organisations");
  const userInsertIndex = code.indexOf("INSERT INTO gov_repo.governance_users");
  assert.ok(orgInsertIndex > 0 && userInsertIndex > orgInsertIndex, "organisation must be created before the user, in the same function body");
});

test("SQL: organisation INSERT uses an explicit table alias, and RETURNING qualifies organisation_id through it", () => {
  const code = stripSqlComments(readMigration());

  const orgInsertMatch = code.match(/INSERT INTO gov_repo\.organisations\s+AS\s+(\w+)\s*\(/);
  assert.ok(orgInsertMatch, "organisation INSERT must declare an explicit table alias (e.g. AS inserted_org)");
  const orgAlias = orgInsertMatch![1];

  const returningMatch = code.match(/RETURNING\s+([\w.]+)\s+INTO\s+v_org_id;/);
  assert.ok(returningMatch, "expected a RETURNING ... INTO v_org_id; clause");
  assert.equal(
    returningMatch![1],
    `${orgAlias}.organisation_id`,
    "RETURNING must qualify organisation_id through the organisation INSERT's own alias, not leave it bare"
  );
});

test("SQL: governance_users INSERT uses an explicit table alias, and RETURNING qualifies user_id through it", () => {
  const code = stripSqlComments(readMigration());

  const userInsertMatch = code.match(/INSERT INTO gov_repo\.governance_users\s+AS\s+(\w+)\s*\(/);
  assert.ok(userInsertMatch, "governance_users INSERT must declare an explicit table alias (e.g. AS inserted_user)");
  const userAlias = userInsertMatch![1];

  const returningMatch = code.match(/RETURNING\s+([\w.]+)\s+INTO\s+v_user_id;/);
  assert.ok(returningMatch, "expected a RETURNING ... INTO v_user_id; clause");
  assert.equal(
    returningMatch![1],
    `${userAlias}.user_id`,
    "RETURNING must qualify user_id through the governance_users INSERT's own alias, not leave it bare"
  );
});

test("SQL: no RETURNS TABLE output name is ever returned bare via RETURNING (PL/pgSQL implicit-variable ambiguity class)", () => {
  const code = stripSqlComments(readMigration());

  const returnsTableBlock = code.match(/RETURNS TABLE \(([\s\S]*?)\)/)?.[1] ?? "";
  const outputNames = [...returnsTableBlock.matchAll(/(\w+)\s+(?:uuid|varchar)/g)].map((m) => m[1]);
  assert.deepEqual(
    outputNames,
    ["user_id", "email", "full_name", "organisation_id", "organisation_name", "role_id", "role_code"],
    "expected the known RETURNS TABLE output column list"
  );

  for (const returningClause of code.matchAll(/RETURNING\s+([\w.]+)\s+INTO/g)) {
    const returnedIdentifier = returningClause[1];
    const isBareOutputName = outputNames.includes(returnedIdentifier);
    assert.equal(
      isBareOutputName,
      false,
      `RETURNING "${returnedIdentifier}" is bare and collides with an implicit RETURNS TABLE variable of the same name — it must be table-qualified`
    );
  }
});

test("SQL: privileges unchanged — SECURITY INVOKER, safe search_path, service_role-only execute", () => {
  const sql = readMigration();
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /SET search_path = 'gov_repo', 'pg_catalog'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION gov_repo\.signup_legacy FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION gov_repo\.signup_legacy FROM anon;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION gov_repo\.signup_legacy FROM authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION gov_repo\.signup_legacy TO service_role;/);
});

test("SQL: exact GOVERNANCE_ADMIN + is_system_role=true lookup and role_id return are preserved", () => {
  const sql = readMigration();
  assert.match(sql, /WHERE gr\.role_code = v_admin_role_code\s*\n\s*AND gr\.is_system_role = true/);
  assert.match(sql, /role_id\s+uuid,/, "RETURNS TABLE must still expose role_id");
  assert.match(sql, /v_admin_role_id as role_id/);
});

test("SQL: password hash is write-only input, never returned, external_id never selected in the return query", () => {
  const sql = readMigration();
  const returnQuery = sql.match(/RETURN QUERY[\s\S]*?FROM/)?.[0] ?? "";
  assert.doesNotMatch(returnQuery, /external_id/);
  assert.doesNotMatch(returnQuery.toLowerCase(), /password/);
  assert.match(sql, /p_password_hash varchar/, "password hash is still accepted as an already-hashed credential input");
});
