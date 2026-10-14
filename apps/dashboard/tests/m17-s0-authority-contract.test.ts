import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  AUTHORITY_POLICY_PERMISSIONS, GOVERNANCE_ENVELOPE_SUBJECT_KINDS, L14_PERMISSIONS, L14_PROPOSAL_SUBJECT_KINDS, L15_PERMISSIONS,
  type L14AuthorityPolicyRule,
} from "@council/canonical-contracts";
import { L14ContractError, authorityPolicyContentHash, authorityPolicyRuleFrame } from "@council/governance-review";
import { PASSPORT_FAMILIES } from "../lib/governance/agent-passport";

/**
 * M17-S0 — D-01 contract mirror and static migration acceptance without a database (the PG17 suite
 * tests/postgres-m16/m17-s0-authority-extension.test.ts proves the database side).
 */
const ROLE = "aaaaaaaa-1111-4111-8111-11111111abcd";
const rule = (overrides: Partial<L14AuthorityPolicyRule> = {}): L14AuthorityPolicyRule => ({
  roleId: ROLE, permission: "L15_GOVERNED_RISK_VALIDATE", requestedAction: "VALIDATE", sourceClass: "LOCAL_HUMAN",
  sourceDisposition: "AUTHORITATIVE", scopeTag: "ALL_ALLOWED_TARGETS", scopeCanonicalKind: null, scopeCanonicalObjectId: null,
  scopeRelationshipType: null, scopeRelationshipId: null, scopeRelationshipStateId: null, allowSelfValidation: false,
  allowFutureDating: false, allowBackdating: false, ...overrides,
});
const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const S0 = "20261012200000_m17_s0_authority_policy_l15_extension_v1.sql";
const sql = readFileSync(MIGRATIONS + S0, "utf8");
const code = sql.replace(/--[^\n]*/g, "");

test("D-01 mirror: the single Authority Policy rule vocabulary is the 23 tags; L15 rules frame and hash like any rule", () => {
  assert.equal(L14_PERMISSIONS.length, 15);
  assert.equal(AUTHORITY_POLICY_PERMISSIONS.length, 23);
  assert.equal(GOVERNANCE_ENVELOPE_SUBJECT_KINDS.length, 17);
  assert.equal(L14_PROPOSAL_SUBJECT_KINDS.length, 11, "the frozen M16 proposal vocabulary constant is unchanged");
  for (const permission of L15_PERMISSIONS) {
    const action = permission.endsWith("_ADMIT") ? "ADMIT" : "VALIDATE";
    assert.match(authorityPolicyRuleFrame(rule({ permission, requestedAction: action })), new RegExp(permission));
  }
  assert.match(authorityPolicyContentHash([rule(), rule({ permission: "L14_AUTHORITY_POLICY_ADMIN" })]), /^[0-9a-f]{64}$/);
  assert.match(authorityPolicyRuleFrame(rule({ scopeTag: "CANONICAL_KIND", scopeCanonicalKind: "AGENT_VERSION" })), /AGENT_VERSION/);
});

test("D-01 mirror: unknown / non-governance permissions, wrong action and non-local L15 registry scope fail closed", () => {
  const reason = (r: L14AuthorityPolicyRule) => {
    try { authorityPolicyRuleFrame(r); return "OK"; } catch (error) { return (error as L14ContractError).reason; }
  };
  for (const permission of ["L15_RISK_SIGNAL_VALIDATE", "L15_RISK_HYPOTHESIS_VALIDATE", "L15_GOVERNED_RISK_ADMIT", "L16_ANYTHING"]) {
    assert.equal(reason(rule({ permission: permission as never })), "RULE_VOCABULARY_UNKNOWN", permission);
  }
  assert.equal(reason(rule({ requestedAction: "ADMIT" })), "RULE_PERMISSION_ACTION_INCOMPATIBLE");
  assert.equal(reason(rule({ permission: "L15_RISK_SCENARIO_ADMIT", requestedAction: "VALIDATE" })), "RULE_PERMISSION_ACTION_INCOMPATIBLE");
  for (const permission of ["L15_RISK_SCENARIO_ADMIT", "L15_RISK_SCENARIO_VALIDATE", "L15_RISK_METHODOLOGY_ADMIT", "L15_RISK_METHODOLOGY_VALIDATE"] as const) {
    assert.equal(reason(rule({ permission, requestedAction: permission.endsWith("_ADMIT") ? "ADMIT" : "VALIDATE",
      scopeTag: "CANONICAL_KIND", scopeCanonicalKind: "AGENT" })), "RULE_REGISTRY_SCOPE_INVALID", permission);
  }
  assert.equal(reason(rule({ scopeTag: "CANONICAL_KIND", scopeCanonicalKind: "AGENT_VERSION" })), "OK", "L15 fact permissions keep all five scopes");
});

test("static: the S0 migration is additive, hosted-free and creates no L15 store, bootstrap or definer", () => {
  const names = readdirSync(MIGRATIONS).filter(n => /^\d{14}_.*\.sql$/.test(n)).sort();
  // Horizon: S0 is followed by exactly the M17-S1 / S1R1 / S2 / S2R1 / S3 / S3R1 migrations (each later slice extends this exact list; never a
  // wildcard).
  assert.deepEqual(names.slice(names.indexOf(S0)), [S0, "20261012210000_m17_s1_signals_hypotheses_support_v1.sql",
    "20261012220000_m17_s1r1_machine_intake_login_closure_v1.sql", "20261013120000_m17_s2_scenario_methodology_registries_v1.sql",
    "20261013130000_m17_s2r1_l15_allow_guard_execution_context_v1.sql", "20261013140000_m17_s3_governed_risk_v1.sql",
    "20261013150000_m17_s3r1_governed_risk_support_currency_lineage_v1.sql"],
    "the S0 migration is followed only by the M17-S1 / S1R1 / S2 / S2R1 / S3 / S3R1 migrations");
  assert.ok(names.indexOf(S0) > names.indexOf("20261012120000_m16_read_projection_closure_v1.sql"));
  assert.match(sql, /^-- M17-S0/);
  assert.doesNotMatch(code, /CREATE\s+(TABLE|VIEW|MATERIALIZED VIEW|SEQUENCE)\b/i, "no L15 store / relation is created in S0");
  assert.doesNotMatch(code, /^\s*SECURITY\s+DEFINER\s*$/im, "no routine is declared SECURITY DEFINER");
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|VIEW)\b/i);
  assert.doesNotMatch(code, /^\s*(DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?gov_repo|UPDATE\s+gov_repo\.|INSERT\s+INTO\s+gov_repo\.)/im, "no row is written, rewritten or erased");
  assert.doesNotMatch(code, /ALTER\s+TABLE\s+gov_repo\.(agents|risk_entries|risk_treatments|canonical_objects|canonical_relationships|l14_fact_states|l14_registry_states|l14_support_links)\b/i);
  assert.doesNotMatch(code, /bootstrap[a-z_]*\s*\(/i, "no L15 bootstrap routine");
  assert.doesNotMatch(code, /supabase\.co|vercel|hosted_/i);
  // Every dropped constraint is re-added under the same name (widening only).
  const dropped = [...code.matchAll(/DROP CONSTRAINT (\w+)/g)].map(m => m[1]).sort();
  const added = new Set([...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map(m => m[1]));
  assert.equal(dropped.length, 10);
  for (const name of dropped) assert.ok(added.has(name), name);
  // D-05: the legacy register loses exactly the four DML privileges for the application roles.
  assert.match(code, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gov_repo\.risk_entries FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(code, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gov_repo\.risk_treatments FROM PUBLIC, anon, authenticated, service_role;/);
});

test("O03: Passport keeps exactly the 16 baseline families; no family is a risk family", () => {
  assert.equal(PASSPORT_FAMILIES.length, 16);
  assert.ok(PASSPORT_FAMILIES.every(([id, label]) => !/risk/i.test(id) && !/risk/i.test(label)));
});
