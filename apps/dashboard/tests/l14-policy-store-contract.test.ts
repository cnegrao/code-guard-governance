import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * M16-S1B.2 — migration-text and TypeScript-surface invariants for the reused policy-store hardening,
 * without a database. The PG17 suites (tests/postgres-m16/l14-policy-store-*.test.ts) prove the behaviour.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const migration = readFileSync(join(root, "supabase/migrations/20260930150000_m16_s1b2_policy_store_hardening_v1.sql"), "utf8");
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");

test("single forward-only transaction; only raising guards; no RPC, no grant, no definer, no replaced routine", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.ok(code.trimEnd().endsWith("COMMIT;"));
  assert.ok(!/\bGRANT\b/i.test(noStrings), "no GRANT: nothing becomes application-accessible");
  assert.ok(!/SECURITY DEFINER/i.test(code), "no definer routine");
  assert.ok(!/CREATE OR REPLACE/i.test(code), "no existing routine replaced");
  assert.ok(!/DO INSTEAD|CREATE RULE/i.test(code), "raising guards only, never silent rules");
  assert.deepEqual(code.match(/CREATE FUNCTION gov_repo\.\w+/g), [
    "CREATE FUNCTION gov_repo.policy_store_history_immutable_v1",
    "CREATE FUNCTION gov_repo.policy_store_version_content_hash_guard_v1",
    "CREATE FUNCTION gov_repo.policy_store_policy_identity_guard_v1",
  ]);
  assert.equal((code.match(/RETURNS trigger/g) ?? []).length, 3, "every new routine is a trigger function");
  assert.ok(!/CREATE (TABLE|VIEW|MATERIALIZED VIEW|SEQUENCE)/i.test(code), "no third policy store / no new relation");
  assert.ok(!/\bl14_\w+\s*\(/.test(noStrings.replace(/'l14[^']*'/g, "")), "no L14 routine created or called");
  assert.ok(!/CREATE[^;]*\bl14_/i.test(code), "no L14 object");
  assert.equal((code.match(/ENABLE ALWAYS TRIGGER/g) ?? []).length, 6);
  assert.match(code, /ERRCODE = '55000'/);
});

test("D-3 hash is exact UTF-8 SHA-256 with no normalization; D-5 immutability covers UPDATE/DELETE/TRUNCATE", () => {
  assert.equal((code.match(/pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\((NEW\.)?content_markdown, 'UTF8'\)\), 'hex'\)/g) ?? []).length, 2,
    "the guard and the NOT VALID backstop use the identical expression");
  assert.ok(!/\b(trim|btrim|rtrim|ltrim|normalize|lower|upper|regexp_replace|replace|translate|unaccent)\s*\(/i.test(code.replace(/DO \$postflight\$[\s\S]*\$postflight\$;/, "")),
    "no normalization primitive outside the postflight");
  assert.match(code, /CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON gov_repo\.policy_versions\s+FOR EACH ROW/);
  assert.match(code, /CREATE TRIGGER policy_versions_no_truncate BEFORE TRUNCATE ON gov_repo\.policy_versions/);
  assert.match(code, /CREATE TRIGGER governance_policies_no_delete BEFORE DELETE ON gov_repo\.governance_policies/);
  assert.match(code, /CREATE TRIGGER governance_policies_no_truncate BEFORE TRUNCATE ON gov_repo\.governance_policies/);
  assert.match(code, /ON UPDATE RESTRICT ON DELETE RESTRICT/);
  assert.ok(!/ON DELETE (CASCADE|SET NULL|SET DEFAULT)/i.test(code), "no cascading/detaching action is introduced");
  assert.match(code, /DROP CONSTRAINT policy_versions_policy_id_fkey/);
});

test("the only data change is the parent-derived tenant backfill; owner_user_id / current_version_id / legacy status untouched", () => {
  const updates = code.match(/^UPDATE[\s\S]*?;/gm) ?? [];
  assert.deepEqual(updates, [
    "UPDATE gov_repo.policy_versions AS v\nSET organisation_id = p.organisation_id\nFROM gov_repo.governance_policies AS p\nWHERE p.policy_id = v.policy_id;"]);
  assert.ok(!/^\s*(INSERT|DELETE)\b/im.test(noStrings), "no row inserted or deleted");
  assert.ok(!/owner_user_id\s+(DROP|SET)\s+NOT NULL|ALTER COLUMN owner_user_id/i.test(code), "D-4 deferred");
  const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "");
  assert.ok(!/current_version_id/.test(executable), "current_version_id is never read or written");
  assert.ok(!/\bstatus\b|approved_by|approval_date/.test(executable.replace(/DO \$postflight\$[\s\S]*\$postflight\$;/, "")), "legacy status/approval never consulted");
  assert.ok(!/canonical_relationships\s+(SET|ADD|DROP)|UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code), "F2");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON/EAV");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com)/i.test(migration), "no hosted database / OpenAI reference");
});

// S1B.2 introduced no Policy TypeScript. The only Policy TS since is the S1B.3 admission contract / mirror / RPC-only
// adapter (l14-policy-admission*) and the S1B.4 POLICY_VERSION governance contract / mirror / RPC-only adapter
// (l14-policy-version-validation*); both reach the reused stores exclusively through their RPCs. The S1B.5 domain
// registry contract / mirror / adapter (l14-domain-registry*) is not Policy TypeScript and never names a policy store.
test("no Policy lifecycle TypeScript beyond the S1B.3 admission and S1B.4 validation contracts/adapters, and no TS touches the reused stores or current_version_id", () => {
  const list = (dir: string) => readdirSync(join(root, dir)).filter(name => /^l14-/.test(name)).sort();
  assert.deepEqual(list("packages/canonical-contracts/src"), ["l14-authority-policy.ts", "l14-domain-registry.ts", "l14-governance-party.ts",
    "l14-policy-admission.ts", "l14-policy-version-validation.ts", "l14-registries.ts"]);
  assert.deepEqual(list("packages/governance-review/src"), ["l14-authority-policy.ts", "l14-domain-registry.ts", "l14-governance-party.ts",
    "l14-policy-admission.ts", "l14-policy-version-validation.ts", "l14-registries.ts"]);
  assert.deepEqual(list("apps/dashboard/lib/governance"), ["l14-authority-policy-persistence.ts", "l14-domain-registry-persistence.ts",
    "l14-governance-party-persistence.ts", "l14-policy-admission-persistence.ts", "l14-policy-version-validation-persistence.ts"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  for (const dir of ["packages/canonical-contracts/src", "packages/governance-review/src", "apps/dashboard/lib"]) walk(join(root, dir));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.ok(!/(governance_policies|policy_versions|current_version_id)/.test(text), `${file} does not touch the reused policy stores`);
  }
});
