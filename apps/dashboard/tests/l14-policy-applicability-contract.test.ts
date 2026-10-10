import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_FACT_STATE_SUPPORT_OWNER_KIND,
  L14_POLICY_APPLICABILITY_OBJECT_KINDS, L14_POLICY_APPLICABILITY_OUTCOMES, L14_POLICY_APPLICABILITY_REASON_CODES,
  L14_POLICY_APPLICABILITY_SUBJECT_KIND, L14_POLICY_APPLICABILITY_TARGET_TYPES, L14_PROPOSAL_SUBJECT_KINDS, L14_REGISTRY_SUBJECT_KINDS,
  type L14PolicyApplicabilityProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, decidePolicyApplicabilityProposalFingerprint, l14PolicyApplicabilityOutcome, policyApplicabilityReasonCode,
  policyApplicabilityTargetParts, submitPolicyApplicabilityProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1C.3 — closed POLICY_APPLICABILITY contract + TypeScript mirror + server-only persistence adapter + migration-text
 * invariants, without a database. The PG17 suites (tests/postgres-m16/l14-policy-applicability*.test.ts) prove PostgreSQL computes
 * identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261009130000_m16_s1c3_policy_applicability_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const VERSION2 = "88888888-8888-4888-8888-888888888888";
const PV_STATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PV_STATE2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const HASH = "c".repeat(64);
const AGENT = "canonical-object:agent-1";
const REL = "canonical-relationship:r1";
const REL_STATE = "canonical-relationship:r1:initial";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const DEP = { policyId: POLICY, versionId: VERSION, contentHash: HASH, policyVersionValidatedStateId: PV_STATE };
const VALIDATE: L14PolicyApplicabilityProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN",
  target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: AGENT }, dependency: DEP, applicability: "APPLIES",
  requestedEffectiveFrom: null, requestedEffectiveTo: null, targetStateId: null };
const REL_VALIDATE: L14PolicyApplicabilityProposalContent = { ...VALIDATE,
  target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: REL_STATE } };
const REVOKE: L14PolicyApplicabilityProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
const rpcBody = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  assert.ok(start > 0, tag);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};
const fnBody = (name: string) => {
  const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
  assert.ok(start > 0, name);
  const tag = /AS (\$[a-z_]*\$)/.exec(migration.slice(start))![1]!;
  const bodyStart = migration.indexOf(tag, start) + tag.length;
  return migration.slice(bodyStart, migration.indexOf(tag, bodyStart));
};

test("closed vocabularies: the third fact family; closed target union over all 11 kinds; APPLIES | DOES_NOT_APPLY; reason codes; never canonical", () => {
  assert.equal(L14_POLICY_APPLICABILITY_SUBJECT_KIND, "POLICY_APPLICABILITY");
  assert.ok((L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes("POLICY_APPLICABILITY"));
  assert.ok(!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("POLICY_APPLICABILITY"), "a fact family, not a registry subject");
  assert.deepEqual([...L14_EXECUTABLE_FACT_SUBJECT_KINDS],
    ["RESPONSIBILITY_ASSIGNMENT", "BUSINESS_CONTEXT_ASSIGNMENT", "POLICY_APPLICABILITY", "CONTROL_APPLICABILITY"],
    "exactly four implemented families (S1C.4 adds CONTROL_APPLICABILITY); CONTROL_ASSESSMENT stays unimplemented");
  assert.equal(L14_FACT_STATE_SUPPORT_OWNER_KIND, "FACT_STATE");
  assert.deepEqual([...L14_POLICY_APPLICABILITY_TARGET_TYPES], ["CANONICAL_OBJECT", "RELATIONSHIP_STATE"]);
  assert.deepEqual([...L14_POLICY_APPLICABILITY_OBJECT_KINDS].sort(), Object.values(CANONICAL_OBJECT_KIND).sort(), "every existing kind, nothing else");
  assert.deepEqual([...L14_POLICY_APPLICABILITY_OUTCOMES], ["APPLIES", "DOES_NOT_APPLY"], "UNKNOWN is a read outcome, never stored");
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(policyApplicabilityReasonCode(outcome), L14_POLICY_APPLICABILITY_REASON_CODES[outcome]);
    assert.equal(L14_POLICY_APPLICABILITY_REASON_CODES[outcome],
      `POLICY_APPLICABILITY_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    assert.ok(rpcBody("decide_policy_applicability").includes(`'${L14_POLICY_APPLICABILITY_REASON_CODES[outcome]}'`));
  }
  assert.throws(() => policyApplicabilityReasonCode("WAIVE" as never), L14ContractError);
  for (const bad of ["UNKNOWN", "PARTIAL", "CONDITIONAL", "WAIVED", "EXEMPT", "NOT_APPLICABLE", "DEFAULT", "INHERITED"]) {
    assert.throws(() => l14PolicyApplicabilityOutcome(bad), L14ContractError, bad);
  }
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /POLICY|APPLIES|GOVERNED/.test(type)), "no APPLIES_POLICY type");
  for (const fragment of ["CHECK (applicability IN ('APPLIES','DOES_NOT_APPLY'))",
    "CHECK (target_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE'))",
    "CHECK (subject_kind IN (\n    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY'))",
    "PRIMARY KEY (organisation_id, target_key, policy_id)"]) {
    assert.ok(code.includes(fragment), fragment);
  }
});

test("mirror framing: target union, policy tuple, dependency, outcome, temporal intent, target, prior and support all bind the fingerprint; illegal shapes refused", () => {
  const submit = (p: L14PolicyApplicabilityProposalContent, prior: string | null = null) =>
    submitPolicyApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit(REL_VALIDATE), submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "MODEL", targetCanonicalObjectId: AGENT } }),
    submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "canonical-object:agent-2" } }),
    submit({ ...REL_VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: `${REL}:v2` } }),
    submit({ ...VALIDATE, dependency: { ...DEP, versionId: VERSION2 } }), submit({ ...VALIDATE, dependency: { ...DEP, contentHash: "d".repeat(64) } }),
    submit({ ...VALIDATE, dependency: { ...DEP, policyVersionValidatedStateId: PV_STATE2 } }), submit({ ...VALIDATE, dependency: { ...DEP, policyId: STATE } }),
    submit({ ...VALIDATE, applicability: "DOES_NOT_APPLY" }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }),
    submit({ ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }), submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitPolicyApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } })];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every semantic field changes the fingerprint");
  assert.equal(submit({ ...VALIDATE, dependency: { ...DEP, policyVersionValidatedStateId: PV_STATE.toUpperCase() } }), base, "UUIDs canonicalized like PostgreSQL");
  // The two branches are framed distinctly even when operand strings coincide (branch tag + positions).
  assert.notEqual(submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "x" } }),
    submit({ ...VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: "AGENT", relationshipStateId: "x" } }));
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decidePolicyApplicabilityProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE), decide("VALIDATE", null, REL_VALIDATE),
    decide("VALIDATE", null, { ...VALIDATE, applicability: "DOES_NOT_APPLY" })]).size, 5);
  const objT = (o: Record<string, unknown>) => ({ ...VALIDATE, target: { ...VALIDATE.target, ...o } });
  const relT = (o: Record<string, unknown>) => ({ ...REL_VALIDATE, target: { ...REL_VALIDATE.target, ...o } });
  for (const [bad, reason] of [
    [objT({ targetType: "RELATIONSHIP" }), "POLICY_APPLICABILITY_TARGET_TYPE_UNKNOWN"], [objT({ targetType: "POLICY" }), "POLICY_APPLICABILITY_TARGET_TYPE_UNKNOWN"],
    [objT({ targetCanonicalKind: "BUSINESS_DOMAIN" }), "TARGET_CANONICAL_KIND_UNKNOWN"], [objT({ targetCanonicalObjectId: " x" }), "TARGET_OBJECT_ID_MALFORMED"],
    [objT({ relationshipId: REL }), "POLICY_APPLICABILITY_TARGET_UNION_INVALID"],
    [relT({ targetCanonicalKind: "TOOL" }), "POLICY_APPLICABILITY_TARGET_UNION_INVALID"],
    [relT({ relationshipId: null }), "TARGET_RELATIONSHIP_ID_MALFORMED"], [relT({ relationshipStateId: undefined }), "TARGET_RELATIONSHIP_STATE_ID_MALFORMED"],
    [relT({ relationshipStateId: "" }), "TARGET_RELATIONSHIP_STATE_ID_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, contentHash: HASH.toUpperCase() } }, "CONTENT_HASH_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, contentHash: "c".repeat(63) } }, "CONTENT_HASH_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, versionId: "latest" } }, "POLICY_VERSION_REQUIRED"],
    [{ ...VALIDATE, dependency: { ...DEP, policyVersionValidatedStateId: "current" } }, "POLICY_VERSION_DEPENDENCY_REQUIRED"],
    [{ ...VALIDATE, applicability: "UNKNOWN" }, "POLICY_APPLICABILITY_OUTCOME_UNKNOWN"],
    [{ ...VALIDATE, sourceClass: "SYSTEM_SEED" }, "SOURCE_CLASS_NOT_EXECUTABLE"], [{ ...VALIDATE, sourceClass: "SCANNER" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...REVOKE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_TO_NOT_PERMITTED"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
  ] as const) {
    assert.throws(() => submit(bad as unknown as L14PolicyApplicabilityProposalContent),
      (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  assert.deepEqual(policyApplicabilityTargetParts(REL_VALIDATE.target), ["RELATIONSHIP_STATE", REL, REL_STATE]);
  // The SQL frames the same parts in the same order.
  for (const [tag, head] of [["submit_policy_applicability", "'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'POLICY_APPLICABILITY', p_intent,\n          p_source_class, p_target_type]"],
    ["decide_policy_applicability", "'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'POLICY_APPLICABILITY', v_proposal.intent, v_proposal.source_class,\n          v_proposal.target_type]"]] as const) {
    const body = rpcBody(tag);
    assert.ok(body.includes(head), tag);
    const order = ["'IMMEDIATE'", "'NO_EFFECTIVE_TO'", "'NO_TARGET_STATE'"].map(s => body.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `${tag}: temporal → end → target order`);
  }
});

test("the additive S1C.3 migration: one transaction, two new definers, one GRANT, one widened guard, closed framework widening, no JSON / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(code.match(/CREATE OR REPLACE FUNCTION gov_repo\.\w+/g), ["CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1"],
    "the only replaced routine is the fact guard (closed vocabulary widened); every S1C.1 / S1C.1R1 / S1C.2 routine stays unchanged");
  assert.deepEqual([...new Set(executable.match(/^ALTER TABLE gov_repo\.(?!l14_policy_applicability)\w+/gm) ?? [])].sort(),
    ["ALTER TABLE gov_repo.l14_authorization_decisions", "ALTER TABLE gov_repo.l14_command_results", "ALTER TABLE gov_repo.l14_fact_states",
      "ALTER TABLE gov_repo.l14_governance_decisions"], "only the four closed framework / envelope tables are widened");
  assert.equal(executable.match(/ADD COLUMN/g), null, "no column is added to any historical table");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 2, "submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_policy_applicability_proposal_v1(", "gov_repo.l14_decide_policy_applicability_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_policy_applicability_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; a supersession never UPDATEs its predecessor");
  // F2: canonical_relationships is named only inside the owner-only exact-triple resolver (read-only).
  assert.equal((executable.match(/canonical_relationships/g) ?? []).length, 1);
  assert.ok(fnBody("l14_resolve_relationship_state_target_v1").includes("FROM gov_repo.canonical_relationships AS cr"));
  assert.ok(!/(ALTER|CREATE (UNIQUE )?INDEX|CREATE TRIGGER|REFERENCES)\s[^;]*canonical_relationships/i.test(code), "no F2 DDL / FK / index / trigger");
  assert.ok(!/(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)|current_version_id|content_markdown|policy_mandate_mappings/.test(executable),
    "no policy content store, legacy pointer or mapping table is touched (only the S1B.3 / S1B.4 lineage)");
  assert.ok(!/CONTROL_APPLICABILITY|CONTROL_ASSESSMENT|l14_responsibility_|l14_business_context_|l14_domain_|l14_control_definition/.test(executable),
    "no other fact family / registry is implemented or reached");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|risk|confidence|rationale|metadata|similarity|scanner|llm|cg_\w+)\b/i.test(executable));
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|auth\.email|auth\.jwt|current_setting\('request/.test(code));
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|vercel)/i.test(migration), "no hosted database / deployment reference");
  const decide = rpcBody("decide_policy_applicability");
  // Authority: the S1C.1 object evaluator (reused unchanged) for objects, the bounded relationship-state evaluator for relationship states.
  assert.ok(decide.includes("gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_POLICY_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,"));
  assert.ok(decide.includes("gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_POLICY_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,\n      v_relationship_type,"));
  const evaluator = fnBody("l14_evaluate_relationship_state_authority_rules_v1");
  assert.ok(evaluator.includes("(r.scope_tag = 'RELATIONSHIP_TYPE' AND r.scope_relationship_type = p_relationship_type)"));
  assert.ok(evaluator.includes("(r.scope_tag = 'RELATIONSHIP_STATE' AND r.scope_relationship_id = p_relationship_id\n             AND r.scope_relationship_state_id = p_relationship_state_id)"));
  assert.ok(!/CANONICAL_KIND|CANONICAL_OBJECT/.test(evaluator), "object scopes never authorize a relationship-state target");
  assert.ok(!/l14_evaluate_|l14_authorization_decisions|l14_governance_decisions|l14_fact_states \(|l14_policy_applicability_heads \(|l14_policy_version_valid_state_v1/
    .test(rpcBody("submit_policy_applicability")), "SUBMIT is never authority: no evaluation, authorization, decision, fact or head write");
  for (const tag of ["submit_policy_applicability", "decide_policy_applicability"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_fact_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  // Lock order of DECIDE VALIDATE: AP SHARED → exact POLICY_VERSION dependency SHARED → exact fact KEY → command.
  const locks = ["l14_lock_authority_policy_guard_shared_v1(v_org)", "IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_policy_version_dependency_guard_shared_v1(v_org, v_proposal.policy_id, v_proposal.version_id,",
    "l14_lock_fact_subject_guard_v1(v_org, 'POLICY_APPLICABILITY',\n    ARRAY['KEY', v_proposal.target_key, v_proposal.policy_id::text])",
    "l14_lock_command_guard_v1(v_org, p_command_id)"].map(s => decide.indexOf(s));
  assert.ok(locks.every((i, n) => i > 0 && (n === 0 || i > locks[n - 1]!)), `decide lock order ${locks}`);
  assert.ok(decide.indexOf("POLICY_VERSION_DEPENDENCY_NOT_VALID") > decide.indexOf("v_deny IS NOT NULL"), "dependency checked under the guards");
  const shared = fnBody("l14_lock_policy_version_dependency_guard_shared_v1");
  assert.ok(shared.includes("pg_advisory_xact_lock_shared(") && !shared.includes("pg_advisory_xact_lock("));
  assert.ok(shared.includes("ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'POLICY_VERSION',\n      'POLICY_VERSION_VALIDATION:' || p_policy_id::text || ':' || p_version_id::text || ':' || p_content_hash]"),
    "the shared guard uses the exact S1B.4 registry subject key (no new namespace)");
  assert.ok(repo("supabase/migrations/20261008120000_m16_s1b4_policy_version_validation_v1.sql")
    .includes("'POLICY_VERSION_VALIDATION:' || v_proposal.policy_id::text || ':' || v_proposal.version_id::text || ':'\n    || v_proposal.content_hash);"));
  assert.ok(code.includes("<> 39 OR pg_catalog.cardinality(v_frozen) <> 29"));
  // The resolver: own state (closure from a VISIBLE successor) + exact target + exact POLICY_VERSION dependency at the SAME coordinates.
  const resolver = fnBody("l14_policy_applicability_valid_state_v1");
  assert.ok(resolver.includes("gov_repo.l14_policy_version_valid_state_v1(p_organisation_id, c.policy_id, c.version_id,\n                  c.content_hash::text, p_effective_at, p_recorded_cutoff)"));
  assert.ok(resolver.includes("WHERE pv.state_id = c.policy_version_validated_state_id"));
  assert.ok(resolver.includes("WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at"));
  assert.ok(resolver.includes("WHERE r.match_count = 1"), "an ambiguous relationship-state target resolves nothing");
  assert.ok(!/version_id = |latest|current_version|inherit|parent/i.test(resolver.replace(/c\.version_id|d\.version_id|version_id,|pv\./g, "")), "never selects a version");
  const signature = (name: string) => migration.slice(migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`), migration.indexOf("RETURNS TABLE", migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`)));
  for (const name of ["l14_submit_policy_applicability_proposal_v1", "l14_decide_policy_applicability_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role\b|p_email|p_label|p_name|p_description|p_rationale|p_comment|p_status|p_score|p_metadata|p_relationship_type|p_target_relationship_type/
      .test(signature(name)), `${name}: no caller-chosen tenant / actor / role / label / rationale / relationship type`);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-policy-applicability-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "DECIDE_PROPOSAL", subject_kind: "POLICY_APPLICABILITY",
  outcome: "VALIDATED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  expectation_kind: "EXPECTED_CURRENT", expected_current_state_id: STATE, proposal_id: PROPOSAL, governance_decision_id: "g",
  target_type: "RELATIONSHIP_STATE", target_canonical_kind: null, target_canonical_object_id: null, target_relationship_id: REL,
  target_relationship_state_id: REL_STATE, policy_id: POLICY, version_id: VERSION, content_hash: HASH, policy_version_validated_state_id: PV_STATE,
  applicability: "DOES_NOT_APPLY", fact_state_id: "99999999-9999-4999-8999-999999999999", state_kind: "VALIDATED", predecessor_state_id: STATE,
  effective_from: "2026-10-09T00:00:00.000001+00:00", effective_to: null, recorded_at: "2026-10-09T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-policy-applicability-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; closed target union + dependency verbatim; mirror fingerprints", async () => {
  calls = []; nextError = null; nextBody = null;
  await adapter.submitPolicyApplicabilityProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  await adapter.submitPolicyApplicabilityProposal(PRINCIPAL, { commandId: "s2", proposal: REL_VALIDATE, priorProposalId: null, support: NONE });
  const decided = await adapter.decidePolicyApplicabilityProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE,
    outcome: "REVOKE", expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual([decided.outcome, decided.target, decided.dependency, decided.applicability, decided.predecessorStateId],
    ["VALIDATED", { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: REL_STATE }, DEP, "DOES_NOT_APPLY", STATE]);
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_policy_applicability_proposal_v1", "l14_submit_policy_applicability_proposal_v1",
    "l14_decide_policy_applicability_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).slice(5).some(key => /role_id|email|label|description|name|score|rationale|metadata|relationship_type|^p_organisation|^p_actor/i
      .test(key)), JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_target_type", "p_target_canonical_kind",
    "p_target_canonical_object_id", "p_target_relationship_id", "p_target_relationship_state_id", "p_policy_id", "p_version_id", "p_content_hash",
    "p_policy_version_validated_state_id", "p_applicability", "p_requested_effective_from", "p_requested_effective_to", "p_target_state_id",
    "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual(["p_target_type", "p_target_canonical_kind", "p_target_canonical_object_id", "p_target_relationship_id", "p_target_relationship_state_id"]
    .map(k => [calls[0]!.args[k], calls[1]!.args[k]]), [["CANONICAL_OBJECT", "RELATIONSHIP_STATE"], ["AGENT", null], [AGENT, null], [null, REL], [null, REL_STATE]]);
  assert.deepEqual([calls[0]!.args.p_policy_id, calls[0]!.args.p_version_id, calls[0]!.args.p_content_hash, calls[0]!.args.p_policy_version_validated_state_id],
    [POLICY, VERSION, HASH, PV_STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, submitPolicyApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: REL_VALIDATE, priorProposalId: null, support: NONE }));
  assert.deepEqual([calls[2]!.args.p_outcome, calls[2]!.args.p_reason_code, calls[2]!.args.p_expected_current_state_id],
    ["REVOKE", "POLICY_APPLICABILITY_REVOKED", STATE]);
  assert.equal(calls[2]!.args.p_caller_fingerprint, decidePolicyApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    outcome: "REVOKE", proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "SCOPE_NOT_AUTHORIZED", governance_decision_id: null,
    fact_state_id: null, state_kind: null, predecessor_state_id: null, effective_from: null }];
  const denied = await adapter.decidePolicyApplicabilityProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE,
    outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.factStateId, denied.governanceDecisionId], ["DENIED", "SCOPE_NOT_AUTHORIZED", null, null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitPolicyApplicabilityProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => error instanceof GovernedWriteError && (error as InstanceType<typeof GovernedWriteError>).code === sqlstate);
  }
  nextError = null;
  calls = [];
  for (const proposal of [{ ...VALIDATE, applicability: "UNKNOWN" }, { ...VALIDATE, sourceClass: "SOURCE_CONNECTION" },
    { ...VALIDATE, dependency: { ...DEP, contentHash: "not-a-hash" } }, { ...REL_VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL } }]) {
    await assert.rejects(adapter.submitPolicyApplicabilityProposal(PRINCIPAL, { commandId: "x", proposal: proposal as unknown as L14PolicyApplicabilityProposalContent,
      priorProposalId: null, support: NONE }), L14ContractError);
  }
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1C.3", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-policy-applicability-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-policy-applicability-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-policy-applicability-persistence|l14_(submit|decide)_policy_applicability_proposal_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
