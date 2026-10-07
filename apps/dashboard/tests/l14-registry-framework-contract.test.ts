import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  L14_EXPECTATION_KINDS, L14_GOVERNANCE_OUTCOMES, L14_PERMISSIONS, L14_PROPOSAL_SUBJECT_KINDS, L14_REGISTRY_ADMIT_COMMAND_SUBJECTS,
  L14_REGISTRY_PERMISSIONS, L14_REGISTRY_REASON_CODES, L14_REGISTRY_STATE_KINDS, L14_REGISTRY_SUBJECT_KINDS, L14_REQUEST_TARGET_TAGS,
  L14_SCOPE_TAGS, L14_SUPPORT_LINK_OWNER_KINDS, type L14AuthorityPolicyRule,
} from "@council/canonical-contracts";
import { L14ContractError, assertRegistryRuleScope, authorityPolicyRuleFrame, registryReasonCode } from "@council/governance-review";

/**
 * M16-S1B.0 — closed registry-framework contract + migration text invariants, without a database.
 * The PG17 suites (tests/postgres-m16/l14-registry-framework*.test.ts) prove the database behaviour.
 */
const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260930120000_m16_s1b0_l14_registry_framework_v1.sql", import.meta.url)), "utf8");
const code = migration.replace(/--.*$/gm, "");
const ROLE = "44444444-4444-4444-8444-444444444444";
const rule = (overrides: Partial<L14AuthorityPolicyRule>): L14AuthorityPolicyRule => ({
  roleId: ROLE, permission: "L14_PARTY_VALIDATE", requestedAction: "VALIDATE", sourceClass: "LOCAL_HUMAN", sourceDisposition: "AUTHORITATIVE",
  scopeTag: "ALL_ALLOWED_TARGETS", scopeCanonicalKind: null, scopeCanonicalObjectId: null, scopeRelationshipType: null,
  scopeRelationshipId: null, scopeRelationshipStateId: null, allowSelfValidation: false, allowFutureDating: false, allowBackdating: false, ...overrides,
});
const NON_ALL: Array<Partial<L14AuthorityPolicyRule>> = [
  { scopeTag: "CANONICAL_KIND", scopeCanonicalKind: "AGENT" },
  { scopeTag: "CANONICAL_OBJECT", scopeCanonicalKind: "AGENT", scopeCanonicalObjectId: "canonical-object:a" },
  { scopeTag: "RELATIONSHIP_TYPE", scopeRelationshipType: "USES_MODEL" },
  { scopeTag: "RELATIONSHIP_STATE", scopeRelationshipId: "rel", scopeRelationshipStateId: "rel:state" },
];

test("S1B.0 closed vocabularies are exactly the frozen sets and subsets of the S1A vocabularies", () => {
  assert.deepEqual([...L14_REGISTRY_SUBJECT_KINDS], ["GOVERNANCE_PARTY", "BUSINESS_DOMAIN", "INFORMATION_DOMAIN", "CONTROL_DEFINITION", "POLICY_VERSION"]);
  assert.ok(L14_REGISTRY_SUBJECT_KINDS.every(kind => (L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes(kind)));
  assert.equal(L14_PROPOSAL_SUBJECT_KINDS.length, 11, "the frozen proposal vocabulary is unchanged");
  assert.deepEqual([...L14_REGISTRY_PERMISSIONS].sort(), ["L14_CONTROL_DEFINITION_ADMIT", "L14_CONTROL_DEFINITION_VALIDATE", "L14_DOMAIN_ADMIT",
    "L14_DOMAIN_VALIDATE", "L14_PARTY_ADMIT", "L14_PARTY_VALIDATE", "L14_POLICY_CONTENT_ADMIT", "L14_POLICY_VERSION_VALIDATE"]);
  assert.ok(L14_REGISTRY_PERMISSIONS.every(p => (L14_PERMISSIONS as readonly string[]).includes(p)));
  assert.deepEqual([...L14_REQUEST_TARGET_TAGS], ["ALL_ALLOWED_TARGETS", "CANONICAL_OBJECT", "RELATIONSHIP_STATE"]);
  assert.deepEqual([...L14_SCOPE_TAGS], ["ALL_ALLOWED_TARGETS", "CANONICAL_KIND", "CANONICAL_OBJECT", "RELATIONSHIP_TYPE", "RELATIONSHIP_STATE"],
    "the frozen five rule scopes are unchanged");
  assert.deepEqual([...L14_EXPECTATION_KINDS], ["EXPECTED_NONE", "EXPECTED_CURRENT", "NOT_APPLICABLE"]);
  assert.deepEqual([...L14_REGISTRY_STATE_KINDS], ["VALIDATED", "REVOKED"]);
  const reasons = Object.values(L14_REGISTRY_REASON_CODES).flatMap(byOutcome => Object.values(byOutcome));
  assert.equal(new Set(reasons).size, 20);
  for (const subject of L14_REGISTRY_SUBJECT_KINDS) {
    for (const outcome of L14_GOVERNANCE_OUTCOMES) {
      assert.equal(registryReasonCode(subject, outcome), `${subject}_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    }
  }
  assert.throws(() => registryReasonCode("AUTHORITY_POLICY_VERSION" as never, "VALIDATE"), L14ContractError);
});

test("the S1B.0 migration CHECK vocabularies match the TypeScript contract", () => {
  const reasons = Object.values(L14_REGISTRY_REASON_CODES).flatMap(byOutcome => Object.values(byOutcome));
  for (const value of [...L14_REGISTRY_SUBJECT_KINDS, ...L14_REGISTRY_PERMISSIONS, ...L14_EXPECTATION_KINDS, ...reasons,
    ...Object.keys(L14_REGISTRY_ADMIT_COMMAND_SUBJECTS), ...L14_SUPPORT_LINK_OWNER_KINDS, "RULE_REGISTRY_SCOPE_INVALID", "RULE_SNAPSHOT_MISMATCH"]) {
    assert.ok(code.includes(`'${value}'`), `migration lacks ${value}`);
  }
  for (const [command, subject] of Object.entries(L14_REGISTRY_ADMIT_COMMAND_SUBJECTS)) {
    assert.ok(new RegExp(`command_kind (=|IN \\()[^)]*'${command}'[^)]*\\)? AND subject_kind = '${subject}'`).test(code), `${command} -> ${subject}`);
  }
});

test("D-14 TypeScript mirror: registry permissions are organisation-local only; fact permissions keep every legal scope", () => {
  for (const permission of L14_REGISTRY_PERMISSIONS) {
    const action = permission.endsWith("_ADMIT") ? "ADMIT" : "VALIDATE";
    assertRegistryRuleScope(rule({ permission, requestedAction: action }));
    for (const scope of NON_ALL) {
      assert.throws(() => assertRegistryRuleScope(rule({ permission, requestedAction: action, ...scope })),
        (error: unknown) => error instanceof L14ContractError && error.reason === "RULE_REGISTRY_SCOPE_INVALID");
    }
  }
  for (const permission of ["L14_RESPONSIBILITY_VALIDATE", "L14_BUSINESS_CONTEXT_VALIDATE", "L14_POLICY_APPLICABILITY_VALIDATE",
    "L14_CONTROL_APPLICABILITY_VALIDATE", "L14_CONTROL_ASSESSMENT_VALIDATE"] as const) {
    for (const scope of [{}, ...NON_ALL]) assertRegistryRuleScope(rule({ permission, ...scope }));
  }
  // The audited S1A frame mirror still accepts a historical registry rule with a non-ALL scope, so
  // pre-S1B.0 commands keep computing their ORIGINAL fingerprint for exact replay.
  assert.doesNotThrow(() => authorityPolicyRuleFrame(rule(NON_ALL[0]!)));
});

test("the additive S1B.0 migration: one transaction, no S1A RPC or parser replacement, no new grant, no silent immutability, no F2", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(code.match(/CREATE OR REPLACE FUNCTION gov_repo\.\w+/g), ["CREATE OR REPLACE FUNCTION gov_repo.l14_snapshot_policy_rules_v1"],
    "only the internal snapshot helper is replaced (same signature); the AP RPCs and the parser are untouched");
  assert.ok(!/l14_(admit_authority_policy_version|submit_proposal|decide_authority_policy_proposal|parse_authority_policy_rules|evaluate_authority_rules)_v1\(/.test(
    code.replace(/'[^']*'/g, "")), "no public AP RPC / parser / evaluator is redefined or called");
  assert.ok(!/\bGRANT\b/i.test(code.replace(/'[^']*'/g, "")), "no GRANT statement at all: no new service_role or public surface");
  assert.ok(!/SECURITY DEFINER/i.test(code), "no new definer routine");
  assert.ok(!/DO INSTEAD NOTHING/i.test(code), "raising immutability only");
  assert.ok(!/canonical_relationships\s+(SET|ADD|DROP)|UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code),
    "F2: no canonical_relationships DDL/DML/FK");
  assert.ok(!/gov_repo\.evidence\b/.test(code), "no legacy gov_repo.evidence reference");
  assert.ok(!/require_governed_write_eligibility_v1/.test(code), "legacy GV006 guard is not reused");
  assert.ok(!/\bjsonb?\b/i.test(code.replace(/'[^']*'/g, "")), "no JSON column / JSON authority storage");
  for (const table of ["governance_policies", "policy_versions", "policy_mandate_mappings"]) {
    assert.ok(!new RegExp(`gov_repo\\.${table}\\b`).test(code), `S1B.0 does not touch ${table}`);
  }
});
