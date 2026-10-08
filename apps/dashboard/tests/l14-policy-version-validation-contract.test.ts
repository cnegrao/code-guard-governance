import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_POLICY_VALIDATION_STATES, L14_REGISTRY_REASON_CODES,
  type L14PolicyVersionProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, decidePolicyVersionProposalFingerprint, policyVersionReasonCode, submitPolicyVersionProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1B.4 — closed POLICY_VERSION governance contract + TypeScript mirror + server-only persistence adapter +
 * migration-text invariants, without a database. The PG17 suites (tests/postgres-m16/l14-policy-version-validation*.test.ts)
 * prove PostgreSQL computes identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261008120000_m16_s1b4_policy_version_validation_v1.sql";
const migration = readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url)), "utf8");
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const HASH = "a".repeat(64);
const NONE = { status: "NONE", evidenceIds: [] } as const;
const VALIDATE: L14PolicyVersionProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", policyId: POLICY, versionId: VERSION,
  contentHash: HASH, requestedEffectiveFrom: null, targetStateId: null };
const REVOKE: L14PolicyVersionProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
const rpcBody = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};

test("closed vocabularies: three descriptor validation states; one POLICY_VERSION reason code per outcome; frozen enumerations", () => {
  assert.deepEqual([...L14_POLICY_VALIDATION_STATES], ["NOT_VALIDATED", "VALIDATED", "REVOKED"]);
  for (const state of L14_POLICY_VALIDATION_STATES) assert.ok(code.includes(`'${state}'`), state);
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(policyVersionReasonCode(outcome), L14_REGISTRY_REASON_CODES.POLICY_VERSION[outcome]);
    assert.ok(rpcBody("decide_version").includes(`'${L14_REGISTRY_REASON_CODES.POLICY_VERSION[outcome]}'`));
  }
  assert.throws(() => policyVersionReasonCode("APPROVE" as never), L14ContractError);
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).includes("POLICY"));
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).includes("APPLIES_POLICY"));
});

test("mirror framing: the exact tuple, intent, source, temporal intent, target, prior, expectation and support all bind the fingerprint", () => {
  const submit = (p: L14PolicyVersionProposalContent, prior: string | null = null) =>
    submitPolicyVersionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  assert.match(base, /^[0-9a-f]{64}$/);
  const variants = [
    submit({ ...VALIDATE, policyId: PROPOSAL }), submit({ ...VALIDATE, versionId: PROPOSAL }), submit({ ...VALIDATE, contentHash: "b".repeat(64) }),
    submit({ ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-08T00:00:00.000000Z" }),
    submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitPolicyVersionProposalFingerprint({ organisationId: ACTOR, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null, support: NONE }),
    submitPolicyVersionProposalFingerprint({ organisationId: ORG, actorUserId: ORG, proposal: VALIDATE, priorProposalId: null, support: NONE }),
    submitPolicyVersionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } }),
  ];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every bound field changes the fingerprint");
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null) => decidePolicyVersionProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal: VALIDATE, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE)]).size, 3);
  // Shape mirror: fails BEFORE any network call with the same closed reasons as PostgreSQL.
  for (const [bad, reason] of [[{ ...VALIDATE, contentHash: "ABC" }, "CONTENT_HASH_MALFORMED"], [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"],
    [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"], [{ ...VALIDATE, intent: "APPROVE" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-08" }, "EFFECTIVE_FROM_NOT_CANONICAL"]] as const) {
    assert.throws(() => submit(bad as L14PolicyVersionProposalContent), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  // The SQL frames the same parts in the same order.
  assert.ok(rpcBody("submit_version").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'POLICY_VERSION', p_intent,\n          p_source_class, p_policy_id::text, p_version_id::text, p_content_hash]"));
  assert.ok(rpcBody("decide_version").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'POLICY_VERSION', v_proposal.intent, v_proposal.source_class,\n          v_proposal.policy_id::text, v_proposal.version_id::text, v_proposal.content_hash]"));
});

test("the additive S1B.4 migration: one transaction, two new definers + the replaced read, one GRANT, no store mutation, no legacy authority, no JSON / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no historical routine is silently replaced");
  assert.deepEqual(code.match(/^DROP FUNCTION [^;]*;/gm), ["DROP FUNCTION gov_repo.l14_read_policy_descriptors_v1(uuid, uuid, bigint, bigint, timestamptz, uuid);"],
    "the descriptor read is the ONLY replaced routine (in place, same transaction)");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 3, "submit, decide and the replaced read");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_policy_version_proposal_v1(", "gov_repo.l14_decide_policy_version_proposal_v1(", "gov_repo.l14_read_policy_descriptors_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code), "F2");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_policy_version_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; nothing is ever deleted");
  assert.ok(!/(INSERT\s+INTO|UPDATE)\s+gov_repo\.(governance_policies|policy_versions|l14_policy_admissions|l14_policy_version_admissions)\b/i.test(executable),
    "VALIDATE never writes a policy store or the S1B.3 admission lineage");
  assert.ok(!/current_version_id/.test(executable), "current_version_id is never read or written");
  assert.ok(!/approved_by|approval_date|reviewed_by|qes_signature_id|ledger_entry_seq|\bstatus\b|content_markdown|change_summary/.test(executable),
    "legacy status / approval / QES / content body never consulted");
  assert.ok(!/POLICY_APPLICABILITY|policy_mandate_mappings/.test(code.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "")),
    "no applicability is created (literals included; only the postflight's own guard names it)");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // Authority = ONLY the evaluator over the CURRENT effective Authority Policy, exact permission, action = outcome.
  assert.ok(rpcBody("decide_version").includes("'L14_POLICY_VERSION_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal"));
  assert.ok(rpcBody("decide_version").includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"));
  assert.ok(!/l14_evaluate_authority_rules_v1|l14_effective_authority_basis_v1/.test(rpcBody("submit_version")), "SUBMIT is not validation authority");
  // The descriptor read never selects a body or a legacy authority field.
  assert.ok(!/content_markdown|status|approved|qes|current_version/.test(rpcBody("read_descriptors").replace(/--.*$/gm, "").replace(/validation_state/g, "")));
  // Effective surface pinned by the postflight.
  assert.ok(code.includes("<> 27 OR pg_catalog.cardinality(v_frozen) <> 17"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_submit_policy_version_proposal_v1", "l14_decide_policy_version_proposal_v1", "l14_read_policy_descriptors_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role|p_email|p_version_number|p_version_label|p_content_markdown|p_rationale|p_status|p_current_version/
      .test(signature(name)), `${name}: no caller-chosen tenant / actor / role / label / content / rationale / legacy field`);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-policy-version-validation-persistence");
let admission: typeof import("@/lib/governance/l14-policy-admission-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "SUBMIT_PROPOSAL", subject_kind: "POLICY_VERSION", outcome: "SUBMITTED",
  command_fingerprint: "f".repeat(64), authorization_decision_id: null, authorization_result: null, deny_reason: null, proposal_id: PROPOSAL,
  governance_decision_id: null, policy_id: POLICY, version_id: VERSION, content_hash: HASH, registry_state_id: null, state_kind: null,
  effective_from: null, recorded_at: "2026-10-08T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-policy-version-validation-persistence");
  admission = await import("@/lib/governance/l14-policy-admission-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; exact tuple; reason code from the outcome; no role / email / tenant input", async () => {
  calls = []; nextError = null; nextBody = null;
  const submitted = await adapter.submitPolicyVersionProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  assert.deepEqual([submitted.outcome, submitted.proposalId, submitted.policyId, submitted.versionId, submitted.contentHash],
    ["SUBMITTED", PROPOSAL, POLICY, VERSION, HASH]);
  await adapter.decidePolicyVersionProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE, outcome: "REVOKE",
    expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_policy_version_proposal_v1", "l14_decide_policy_version_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).some(key => /role|email|owner|^p_status$|label|number|content_markdown|^p_organisation|^p_actor|rationale/i.test(key)),
      JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_policy_id", "p_version_id", "p_content_hash",
    "p_requested_effective_from", "p_target_state_id", "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, submitPolicyVersionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE,
    priorProposalId: null, support: NONE }));
  assert.deepEqual(Object.keys(calls[1]!.args).slice(5), ["p_command_id", "p_proposal_id", "p_outcome", "p_reason_code", "p_expected_current_state_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[1]!.args.p_outcome, calls[1]!.args.p_reason_code, calls[1]!.args.p_expected_current_state_id],
    ["REVOKE", "POLICY_VERSION_REVOKED", STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, decidePolicyVersionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome: "REVOKE",
    proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) preserved; the mirror refuses bad shapes before the network; descriptor maps validation", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, command_kind: "DECIDE_PROPOSAL", outcome: "DENIED", authorization_decision_id: "a", authorization_result: "DENY",
    deny_reason: "SELF_VALIDATION_NOT_PERMITTED" }];
  const denied = await adapter.decidePolicyVersionProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE, outcome: "VALIDATE",
    expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.registryStateId], ["DENIED", "SELF_VALIDATION_NOT_PERMITTED", null]);
  for (const sqlstate of ["GV001", "GV002", "GV003", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitPolicyVersionProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => {
        assert.ok(error instanceof GovernedWriteError);
        assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
        return true;
      });
  }
  nextError = null;
  calls = [];
  await assert.rejects(adapter.submitPolicyVersionProposal(PRINCIPAL, { commandId: "x", proposal: { ...VALIDATE, contentHash: "nope" }, priorProposalId: null,
    support: NONE }), L14ContractError);
  assert.equal(calls.length, 0);
  nextBody = [{ policy_id: POLICY, policy_code: "POL-1", title: "T", policy_type: "risk", policy_admission_authorization_decision_id: "a",
    policy_recorded_at: "t", version_id: VERSION, version_number: 1, version_label: "v1", content_hash: HASH,
    version_admission_authorization_decision_id: "b", version_recorded_at: "t2", validation_state: "VALIDATED", validation_state_id: STATE,
    validation_effective_from: "t3", latest_validation_state_id: STATE }];
  const [descriptor] = await admission.readPolicyDescriptors(PRINCIPAL, { policyId: POLICY });
  assert.deepEqual([descriptor!.validationState, descriptor!.validationStateId, descriptor!.validationEffectiveFrom, descriptor!.latestValidationStateId],
    ["VALIDATED", STATE, "t3", STATE]);
  assert.ok(!Object.keys(descriptor!).some(key => /content(Markdown|Body)|status$|approv|qes|currentVersion/i.test(key)));
  nextBody = null;
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1B.4", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-policy-version-validation-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-policy-version-validation-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-policy-version-validation-persistence|l14_(submit|decide)_policy_version_proposal_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
