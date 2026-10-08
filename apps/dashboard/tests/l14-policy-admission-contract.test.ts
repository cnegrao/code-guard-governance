import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_POLICY_TYPES, L14_POLICY_VALIDATION_STATES, L14_POLICY_VERSION_CHANGE_SUMMARY,
  L14_REGISTRY_ADMIT_COMMAND_SUBJECTS, type L14GovernancePolicyDescriptor,
} from "@council/canonical-contracts";
import {
  L14ContractError, admitGovernancePolicyFingerprint, admitPolicyVersionFingerprint, assertGovernancePolicyDescriptor,
  governancePolicyContentHash, policyVersionContentHash,
} from "@council/governance-review";

/**
 * M16-S1B.3 — closed policy content admission contract + TypeScript mirror + server-only persistence adapter +
 * migration-text invariants, without a database. The PG17 suites (tests/postgres-m16/l14-policy-admission*.test.ts)
 * prove PostgreSQL computes identical values and enforces the same rules.
 */
const MIGRATION = "20261007120000_m16_s1b3_policy_admission_v1.sql";
const migration = readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url)), "utf8");
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const DESCRIPTOR: L14GovernancePolicyDescriptor = { policyCode: "POL-1", title: "Acceptable Use", policyType: "security" };
const rpcBody = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};

test("closed vocabularies are exactly the frozen sets and match the migration", () => {
  assert.deepEqual([...L14_POLICY_TYPES], ["operational", "risk", "security", "data", "ethics", "compliance"]);
  assert.ok(code.includes("p_policy_type NOT IN ('operational','risk','security','data','ethics','compliance')"));
  assert.equal(L14_POLICY_VERSION_CHANGE_SUMMARY, "M16_POLICY_VERSION_ADMISSION");
  // S1B.3 could only ever report NOT_VALIDATED; the frozen S1B.4 contract supersedes the shared vocabulary (still exact).
  assert.deepEqual([...L14_POLICY_VALIDATION_STATES], ["NOT_VALIDATED", "VALIDATED", "REVOKED"], "exact closed descriptor vocabulary");
  assert.deepEqual([L14_REGISTRY_ADMIT_COMMAND_SUBJECTS.ADMIT_GOVERNANCE_POLICY, L14_REGISTRY_ADMIT_COMMAND_SUBJECTS.ADMIT_POLICY_VERSION],
    ["POLICY_VERSION", "POLICY_VERSION"]);
  for (const value of ["L14_POLICY_CONTENT_ADMIT", "ADMIT_GOVERNANCE_POLICY", "ADMIT_POLICY_VERSION", "L14_GOVERNANCE_POLICY_CONTENT_V1",
    "M16_POLICY_VERSION_ADMISSION", "NOT_VALIDATED", "POLICY_NOT_ADMITTED", "POLICY_CODE_EXISTS", "CONTENT_HASH_MISMATCH",
    "POLICY_VERSION_EXISTS", "POLICY_VERSION_EXPECTATION_MISMATCH", "SOURCE_CLASS_NOT_EXECUTABLE"]) {
    assert.ok(code.includes(`'${value}'`), `migration lacks ${value}`);
  }
  // Frozen canonical enumerations: 11 kinds, 12 governed relationships; no POLICY/PARTY/DOMAIN/CONTROL kind, no OWNS/APPLIES_POLICY/CONTROLLED_BY.
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  for (const kind of ["POLICY", "PARTY", "DOMAIN", "CONTROL"]) assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).includes(kind));
  for (const type of ["OWNS", "APPLIES_POLICY", "CONTROLLED_BY"]) assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).includes(type));
});

test("content hash = SHA-256 of the exact UTF-8 bytes (no normalization); descriptor shape mirrors the RPC checks", () => {
  for (const content of ["# a", "# a\r\n", "# a\n", "é", "é", "政策 🚀", "  padded  "]) {
    assert.equal(policyVersionContentHash(content), createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"), JSON.stringify(content));
  }
  assert.notEqual(policyVersionContentHash("é"), policyVersionContentHash("é"), "NFC/NFD never normalized");
  assert.notEqual(policyVersionContentHash("# a\r\n"), policyVersionContentHash("# a\n"), "line endings never normalized");
  for (const bad of ["", "\ud800", "x".repeat(1_048_577)]) assert.throws(() => policyVersionContentHash(bad), L14ContractError);
  assert.doesNotThrow(() => policyVersionContentHash("é".repeat(524_288)), "1 MiB of UTF-8 bytes is the bound");
  assert.throws(() => policyVersionContentHash("é".repeat(524_289)), L14ContractError);
  for (const bad of [{ policyCode: "bad code" }, { policyCode: "-LEAD" }, { policyCode: "X".repeat(21) }, { title: "" }, { title: " padded" },
    { title: "line\nbreak" }, { title: "x".repeat(256) }, { policyType: "ROBOT" }]) {
    assert.throws(() => assertGovernancePolicyDescriptor({ ...DESCRIPTOR, ...bad } as never), L14ContractError, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => assertGovernancePolicyDescriptor({ ...DESCRIPTOR, title: "政策".repeat(127) + "x" }), "255 characters, not bytes");
  assert.match(governancePolicyContentHash(DESCRIPTOR), /^[0-9a-f]{64}$/);
  assert.notEqual(governancePolicyContentHash(DESCRIPTOR), governancePolicyContentHash({ ...DESCRIPTOR, title: "Other" }));
});

test("fingerprints distinguish every semantic input, canonicalise UUID text and never collide across the two commands", () => {
  const admit = { organisationId: ORG, actorUserId: ACTOR, descriptor: DESCRIPTOR, sourceClass: "LOCAL_HUMAN" as const, support: NONE };
  const base = admitGovernancePolicyFingerprint(admit);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(admitGovernancePolicyFingerprint({ ...admit, actorUserId: ACTOR.toUpperCase() }), base);
  for (const variant of [{ organisationId: POLICY }, { actorUserId: POLICY }, { descriptor: { ...DESCRIPTOR, policyCode: "POL-2" } },
    { descriptor: { ...DESCRIPTOR, title: "Acceptable use" } }, { descriptor: { ...DESCRIPTOR, policyType: "risk" as const } },
    { sourceClass: "SYSTEM_SEED" as const }, { support: { status: "PRESENT" as const, evidenceIds: ["e"] } }]) {
    assert.notEqual(admitGovernancePolicyFingerprint({ ...admit, ...variant }), base, JSON.stringify(variant));
  }
  const hash = policyVersionContentHash("# v1");
  const version = { organisationId: ORG, actorUserId: ACTOR, policyId: POLICY, expectedLatestVersionId: null, contentHash: hash,
    sourceClass: "LOCAL_HUMAN" as const, support: NONE };
  const versionFp = admitPolicyVersionFingerprint(version);
  for (const variant of [{ policyId: VERSION }, { expectedLatestVersionId: VERSION }, { contentHash: policyVersionContentHash("# v2") },
    { sourceClass: "SOURCE_CONNECTION" as const }, { support: { status: "PRESENT" as const, evidenceIds: ["e"] } }]) {
    assert.notEqual(admitPolicyVersionFingerprint({ ...version, ...variant }), versionFp, JSON.stringify(variant));
  }
  assert.equal(admitPolicyVersionFingerprint({ ...version, policyId: POLICY.toUpperCase() }), versionFp);
  assert.notEqual(base, versionFp);
  assert.throws(() => admitPolicyVersionFingerprint({ ...version, contentHash: hash.toUpperCase() }), L14ContractError);
  assert.throws(() => admitGovernancePolicyFingerprint({ ...admit, sourceClass: "SCANNER" as never }), L14ContractError);
  // The fingerprint inputs are structurally owner/organisation-choice/change_summary free.
  assert.deepEqual(Object.keys(admit).sort(), ["actorUserId", "descriptor", "organisationId", "sourceClass", "support"]);
  assert.deepEqual(Object.keys(DESCRIPTOR).sort(), ["policyCode", "policyType", "title"]);
  // Byte-for-byte mirror of the SQL framing (same tags, same order).
  assert.ok(rpcBody("admit_policy").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_GOVERNANCE_POLICY', v_org::text, v_actor::text,\n          'ADMIT', 'POLICY_VERSION', v_content_hash, p_source_class, 'EXPECTED_NONE']"));
  assert.ok(rpcBody("admit_version").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_POLICY_VERSION', v_org::text, v_actor::text,\n          'ADMIT', 'POLICY_VERSION', p_policy_id::text, v_content_hash, p_source_class]"));
});

test("the additive S1B.3 migration: one transaction, no replaced routine, exactly three definers and one GRANT, D-4 once, no JSON / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no existing routine is replaced");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 3, "exactly the three S1B.3 RPCs are definers");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_admit_governance_policy_v1(", "gov_repo.l14_admit_policy_version_v1(", "gov_repo.l14_read_policy_descriptors_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.deepEqual(code.match(/ALTER TABLE gov_repo\.governance_policies ALTER COLUMN [^;]*;/g),
    ["ALTER TABLE gov_repo.governance_policies ALTER COLUMN owner_user_id DROP NOT NULL;"], "D-4 is the only column change");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/DO INSTEAD NOTHING/i.test(code));
  assert.ok(!/UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code), "F2");
  assert.ok(!/^\s*(UPDATE|DELETE)\b/im.test(executable), "no row of any existing table is updated or deleted");
  assert.ok(!/current_version_id/.test(executable), "current_version_id is never read or written");
  assert.ok(!/approved_by|approval_date|reviewed_by|qes_signature_id|ledger_entry_seq|\bstatus\b/.test(executable), "legacy status/approval never consulted");
  assert.ok(!/l14_governance_decisions|l14_registry_states|l14_proposals|trust_state/.test(executable), "ADMIT never writes decision/validation/trust state");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // change_summary: DB-written constant only; never a parameter.
  assert.ok(rpcBody("admit_version").includes("'M16_POLICY_VERSION_ADMISSION'"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_admit_governance_policy_v1", "l14_admit_policy_version_v1", "l14_read_policy_descriptors_v1"]) {
    assert.ok(!/p_change_summary|p_owner_user_id|p_version_id\b|p_version_number|p_version_label|p_organisation_id|p_actor_user_id|p_created_by|p_role|p_email/
      .test(signature(name)), `${name}: no caller-chosen identity / owner / tenant / actor / role / change_summary`);
  }
  assert.ok(!signature("l14_admit_governance_policy_v1").includes("p_policy_id"), "an identity ADMIT takes no caller policy id");
  // The descriptor read never selects a content body or a legacy authority field.
  assert.ok(!/content_markdown|status|approved|qes|current_version/.test(rpcBody("read_descriptors").replace(/--.*$/gm, "")));
  // The authorization is ONLY the evaluator over the effective Authority Policy with the exact permission/action.
  for (const tag of ["admit_policy", "admit_version"]) {
    assert.ok(rpcBody(tag).includes("'L14_POLICY_CONTENT_ADMIT', 'ADMIT', false, 'IMMEDIATE'"), tag);
    assert.ok(rpcBody(tag).includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"), tag);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-policy-admission-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "ADMIT_GOVERNANCE_POLICY", subject_kind: "POLICY_VERSION", outcome: "ADMITTED",
  command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null, attempted_content_hash: "e".repeat(64),
  expectation_kind: "EXPECTED_NONE", expected_latest_version_id: null, policy_id: POLICY, version_id: null, version_number: null, version_label: null,
  content_hash: null, recorded_at: "2026-10-07T00:00:00.000001+00:00" };

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const { mock } = await import("node:test");
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    assert.match(url.pathname, /^\/rest\/v1\/rpc\//);
    calls.push({ name: url.pathname.replace(/^\/rest\/v1\/rpc\//, ""), args: JSON.parse(await request.text()) });
    if (nextError) return Response.json(nextError, { status: 400 });
    return Response.json(nextBody ?? [RESULT_ROW], { status: 200 });
  });
  adapter = await import("@/lib/governance/l14-policy-admission-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; DB-minted identities; no owner / change_summary / role / email", async () => {
  calls = []; nextError = null; nextBody = null;
  const result = await adapter.admitGovernancePolicy(PRINCIPAL, { commandId: "cmd", descriptor: DESCRIPTOR, sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([result.outcome, result.policyId, result.subjectKind, result.commandKind], ["ADMITTED", POLICY, "POLICY_VERSION", "ADMIT_GOVERNANCE_POLICY"]);
  const content = "# Política\r\n";
  await adapter.admitPolicyVersion(PRINCIPAL, { commandId: "v", policyId: POLICY, expectedLatestVersionId: VERSION, contentMarkdown: content,
    sourceClass: "LOCAL_HUMAN", support: NONE });
  nextBody = [];
  assert.deepEqual(await adapter.readPolicyDescriptors(PRINCIPAL), []);
  assert.deepEqual(calls.map(call => call.name), ["l14_admit_governance_policy_v1", "l14_admit_policy_version_v1", "l14_read_policy_descriptors_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).some(key => /role|email|owner|change_summary|version_number|version_label|p_version_id|created_by|^p_organisation|^p_actor/i.test(key)),
      JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_expectation_kind", "p_policy_code", "p_title", "p_policy_type", "p_source_class",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"], "PostgreSQL mints the policy id");
  assert.equal(calls[0]!.args.p_caller_fingerprint, admitGovernancePolicyFingerprint({ organisationId: ORG, actorUserId: ACTOR, descriptor: DESCRIPTOR,
    sourceClass: "LOCAL_HUMAN", support: NONE }));
  assert.deepEqual(Object.keys(calls[1]!.args).slice(5), ["p_command_id", "p_policy_id", "p_expected_latest_version_id", "p_content_markdown", "p_content_hash",
    "p_source_class", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.equal(calls[1]!.args.p_content_markdown, content, "content sent byte-exact");
  assert.equal(calls[1]!.args.p_content_hash, createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"));
  assert.equal(calls[1]!.args.p_caller_fingerprint, admitPolicyVersionFingerprint({ organisationId: ORG, actorUserId: ACTOR, policyId: POLICY,
    expectedLatestVersionId: VERSION, contentHash: policyVersionContentHash(content), sourceClass: "LOCAL_HUMAN", support: NONE }));
  assert.deepEqual(Object.keys(calls[2]!.args).slice(5), ["p_policy_id"]);
  assert.equal(calls[2]!.args.p_policy_id, null);
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) are preserved; descriptors map without content bodies", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "NO_MATCHING_AUTHORITY_RULE", policy_id: null }];
  const denied = await adapter.admitGovernancePolicy(PRINCIPAL, { commandId: "d", descriptor: DESCRIPTOR, sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.policyId], ["DENIED", "NO_MATCHING_AUTHORITY_RULE", null]);
  for (const sqlstate of ["GV007", "GV008", "GV009", "GV010", "GV001", "GV002", "GV003", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.admitPolicyVersion(PRINCIPAL, { commandId: "e", policyId: POLICY, expectedLatestVersionId: null, contentMarkdown: "# x",
      sourceClass: "LOCAL_HUMAN", support: NONE }), (error: unknown) => {
      assert.ok(error instanceof GovernedWriteError);
      assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
      return true;
    });
  }
  nextError = null;
  nextBody = [{ policy_id: POLICY, policy_code: "POL-1", title: "T", policy_type: "risk", policy_admission_authorization_decision_id: "a",
    policy_recorded_at: "t", version_id: VERSION, version_number: 1, version_label: "v1", content_hash: "c".repeat(64),
    version_admission_authorization_decision_id: "b", version_recorded_at: "t2", validation_state: "NOT_VALIDATED",
    validation_state_id: null, validation_effective_from: null, latest_validation_state_id: null }];
  const [descriptor] = await adapter.readPolicyDescriptors(PRINCIPAL, { policyId: POLICY });
  assert.deepEqual(Object.keys(descriptor!).sort(), ["contentHash", "policyAdmissionAuthorizationDecisionId", "policyCode", "policyId", "policyRecordedAt",
    "policyType", "title", "validationEffectiveFrom", "validationState", "validationStateId", "versionAdmissionAuthorizationDecisionId", "versionId",
    "versionLabel", "versionNumber", "versionRecordedAt"].concat(["latestValidationStateId"]).sort(), "exact S1B.4 descriptor shape (S1B.3 keys + validation traceability)");
  assert.equal(descriptor!.validationState, "NOT_VALIDATED");
  // The TS mirror refuses to send a shape PostgreSQL would reject (fails before any network call).
  calls = [];
  await assert.rejects(adapter.admitGovernancePolicy(PRINCIPAL, { commandId: "x", descriptor: { ...DESCRIPTOR, policyType: "ROBOT" as never },
    sourceClass: "LOCAL_HUMAN", support: NONE }), L14ContractError);
  assert.equal(calls.length, 0);
  nextBody = null;
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1B.3", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-policy-admission-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-policy-admission-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-policy-admission-persistence|l14_(admit_governance_policy|admit_policy_version|read_policy_descriptors)_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
