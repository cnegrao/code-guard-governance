import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_FACT_STATE_SUPPORT_OWNER_KIND,
  L14_MULTI_PARTY_RESPONSIBILITY_ROLES, L14_PROPOSAL_SUBJECT_KINDS, L14_REGISTRY_SUBJECT_KINDS, L14_RESPONSIBILITY_ASSIGNMENT_SUBJECT_KIND,
  L14_RESPONSIBILITY_REASON_CODES, L14_RESPONSIBILITY_ROLES, L14_RESPONSIBILITY_ROLE_MATRIX, L14_RESPONSIBILITY_TARGET_KINDS,
  L14_SINGLE_OWNER_RESPONSIBILITY_ROLES, type L14ResponsibilityAssignmentProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, decideResponsibilityAssignmentProposalFingerprint, isLegalResponsibilityPairing, isSingleOwnerResponsibilityRole,
  l14ResponsibilityRole, l14ResponsibilityTargetKind, l14ResponsibilityTargetObjectId, responsibilityReasonCode,
  submitResponsibilityAssignmentProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1C.1 — closed RESPONSIBILITY_ASSIGNMENT contract + TypeScript mirror + server-only persistence adapter + migration-text
 * invariants + the legacy-owner boundary, without a database. The PG17 suites (tests/postgres-m16/l14-responsibility-assignment*.test.ts)
 * prove PostgreSQL computes identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261008220000_m16_s1c1_responsibility_assignment_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const PARTY = "44444444-4444-4444-8444-444444444444";
const PARTY_STATE = "55555555-5555-4555-8555-555555555555";
const PARTY2 = "88888888-8888-4888-8888-888888888888";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const AGENT = "canonical-object:agent-1";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const VALIDATE: L14ResponsibilityAssignmentProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", targetKind: "AGENT",
  targetCanonicalObjectId: AGENT, responsibilityRole: "BUSINESS_OWNER", governancePartyId: PARTY, partyValidatedStateId: PARTY_STATE,
  requestedEffectiveFrom: null, requestedEffectiveTo: null, targetStateId: null };
const REVOKE: L14ResponsibilityAssignmentProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
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

test("closed vocabularies: the first fact family; exact role matrix; single-owner vs steward; reason codes; never a canonical kind / relationship", () => {
  assert.equal(L14_RESPONSIBILITY_ASSIGNMENT_SUBJECT_KIND, "RESPONSIBILITY_ASSIGNMENT");
  assert.ok((L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes("RESPONSIBILITY_ASSIGNMENT"));
  assert.ok(!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("RESPONSIBILITY_ASSIGNMENT"), "a fact family, not a registry subject");
  // S1C.2 adds BUSINESS_CONTEXT_ASSIGNMENT and S1C.3 POLICY_APPLICABILITY; the remaining two fact families stay unimplemented.
  assert.deepEqual([...L14_EXECUTABLE_FACT_SUBJECT_KINDS], ["RESPONSIBILITY_ASSIGNMENT", "BUSINESS_CONTEXT_ASSIGNMENT", "POLICY_APPLICABILITY"],
    "future fact families stay unimplemented");
  assert.equal(L14_FACT_STATE_SUPPORT_OWNER_KIND, "FACT_STATE");
  assert.deepEqual([...L14_RESPONSIBILITY_ROLES], ["BUSINESS_OWNER", "TECHNICAL_OWNER", "DATA_OWNER", "DATA_STEWARD"]);
  assert.deepEqual([...L14_RESPONSIBILITY_TARGET_KINDS], ["AGENT", "DATA_ASSET", "DATA_ELEMENT"]);
  assert.deepEqual(JSON.parse(JSON.stringify(L14_RESPONSIBILITY_ROLE_MATRIX)), { AGENT: ["BUSINESS_OWNER", "TECHNICAL_OWNER"],
    DATA_ASSET: ["DATA_OWNER", "DATA_STEWARD"], DATA_ELEMENT: ["DATA_OWNER", "DATA_STEWARD"] });
  assert.deepEqual([...L14_SINGLE_OWNER_RESPONSIBILITY_ROLES], ["BUSINESS_OWNER", "TECHNICAL_OWNER", "DATA_OWNER"]);
  assert.deepEqual([...L14_MULTI_PARTY_RESPONSIBILITY_ROLES], ["DATA_STEWARD"]);
  for (const role of L14_RESPONSIBILITY_ROLES) assert.equal(isSingleOwnerResponsibilityRole(role), role !== "DATA_STEWARD");
  const legal: string[] = [];
  for (const kind of [...Object.values(CANONICAL_OBJECT_KIND), "OWNER"]) {
    for (const role of [...L14_RESPONSIBILITY_ROLES, "OWNER", "business_owner"]) if (isLegalResponsibilityPairing(kind, role)) legal.push(`${kind}:${role}`);
  }
  assert.deepEqual(legal, ["AGENT:BUSINESS_OWNER", "AGENT:TECHNICAL_OWNER", "DATA_ASSET:DATA_OWNER", "DATA_ASSET:DATA_STEWARD",
    "DATA_ELEMENT:DATA_OWNER", "DATA_ELEMENT:DATA_STEWARD"], "exactly the six legal pairings; AGENT_VERSION and every other kind excluded");
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(responsibilityReasonCode(outcome), L14_RESPONSIBILITY_REASON_CODES[outcome]);
    assert.equal(L14_RESPONSIBILITY_REASON_CODES[outcome], `RESPONSIBILITY_ASSIGNMENT_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    assert.ok(rpcBody("decide_responsibility").includes(`'${L14_RESPONSIBILITY_REASON_CODES[outcome]}'`));
  }
  assert.throws(() => responsibilityReasonCode("APPROVE" as never), L14ContractError);
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /PARTY|RESPONSIB|OWNER|STEWARD/.test(kind)));
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /OWN|STEWARD|RESPONSIB/.test(type)), "no OWNS / STEWARD_OF / HAS_OWNER");
  // The SQL closes the same vocabularies.
  for (const fragment of ["CHECK (target_kind IN ('AGENT','DATA_ASSET','DATA_ELEMENT'))",
    "CHECK (responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER','DATA_STEWARD'))",
    "(target_kind = 'AGENT' AND responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER'))\n    OR (target_kind IN ('DATA_ASSET','DATA_ELEMENT') AND responsibility_role IN ('DATA_OWNER','DATA_STEWARD'))",
    "v_single_owner := v_proposal.responsibility_role IN ('BUSINESS_OWNER','TECHNICAL_OWNER','DATA_OWNER');"]) {
    assert.ok(code.includes(fragment), fragment);
  }
});

test("mirror framing: key, dependency, intent, temporal intent, explicit end, target, prior and support all bind the fingerprint; the mirror refuses illegal shapes", () => {
  const submit = (p: L14ResponsibilityAssignmentProposalContent, prior: string | null = null) =>
    submitResponsibilityAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit({ ...VALIDATE, targetCanonicalObjectId: "canonical-object:agent-2" }), submit({ ...VALIDATE, responsibilityRole: "TECHNICAL_OWNER" }),
    submit({ ...VALIDATE, targetKind: "DATA_ASSET", responsibilityRole: "DATA_OWNER" }), submit({ ...VALIDATE, governancePartyId: PARTY2 }),
    submit({ ...VALIDATE, partyValidatedStateId: PARTY2 }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }),
    submit({ ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }), submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitResponsibilityAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } }),
    submitResponsibilityAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: PARTY, proposal: VALIDATE, priorProposalId: null, support: NONE })];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every semantic field changes the fingerprint");
  assert.equal(submit({ ...VALIDATE, governancePartyId: PARTY.toUpperCase() }), base, "UUIDs are canonicalized to lowercase text exactly like PostgreSQL");
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideResponsibilityAssignmentProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE), decide("VALIDATE", null, { ...VALIDATE, governancePartyId: PARTY2 }),
    decide("VALIDATE", null, { ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" })]).size, 5);
  for (const [bad, reason] of [
    [{ ...VALIDATE, targetKind: "AGENT_VERSION" }, "RESPONSIBILITY_TARGET_KIND_ILLEGAL"], [{ ...VALIDATE, targetKind: "MODEL" }, "RESPONSIBILITY_TARGET_KIND_ILLEGAL"],
    [{ ...VALIDATE, responsibilityRole: "OWNER" }, "RESPONSIBILITY_ROLE_UNKNOWN"], [{ ...VALIDATE, responsibilityRole: "DATA_OWNER" }, "RESPONSIBILITY_ROLE_TARGET_ILLEGAL"],
    [{ ...VALIDATE, targetKind: "DATA_ELEMENT", responsibilityRole: "TECHNICAL_OWNER" }, "RESPONSIBILITY_ROLE_TARGET_ILLEGAL"],
    [{ ...VALIDATE, targetCanonicalObjectId: " x" }, "TARGET_OBJECT_ID_MALFORMED"], [{ ...VALIDATE, targetCanonicalObjectId: "" }, "TARGET_OBJECT_ID_MALFORMED"],
    [{ ...VALIDATE, governancePartyId: "ana@example.invalid" }, "PARTY_DEPENDENCY_REQUIRED"], [{ ...VALIDATE, partyValidatedStateId: "latest" }, "PARTY_DEPENDENCY_REQUIRED"],
    [{ ...VALIDATE, sourceClass: "SYSTEM_SEED" }, "SOURCE_CLASS_NOT_EXECUTABLE"], [{ ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }, "SOURCE_CLASS_NOT_EXECUTABLE"],
    [{ ...VALIDATE, sourceClass: "SCANNER" }, "PROPOSAL_VOCABULARY_UNKNOWN"], [{ ...VALIDATE, intent: "ASSIGN" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...REVOKE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_TO_NOT_PERMITTED"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09" }, "EFFECTIVE_FROM_NOT_CANONICAL"], [{ ...VALIDATE, requestedEffectiveTo: "tomorrow" }, "EFFECTIVE_TO_NOT_CANONICAL"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000001Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
  ] as const) {
    assert.throws(() => submit(bad as L14ResponsibilityAssignmentProposalContent), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  assert.equal(l14ResponsibilityTargetObjectId("é".repeat(500)), "é".repeat(500), "PostgreSQL counts characters");
  assert.throws(() => l14ResponsibilityTargetObjectId("x".repeat(501)), L14ContractError);
  assert.throws(() => l14ResponsibilityTargetKind("AGENT_VERSION"), L14ContractError);
  assert.throws(() => l14ResponsibilityRole("STEWARD"), L14ContractError);
  // The SQL frames the same parts in the same order.
  assert.ok(rpcBody("submit_responsibility").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'RESPONSIBILITY_ASSIGNMENT', p_intent,\n          p_source_class, p_target_kind, p_target_canonical_object_id, p_responsibility_role, p_governance_party_id::text,\n          p_party_validated_state_id::text]"));
  assert.ok(rpcBody("decide_responsibility").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'RESPONSIBILITY_ASSIGNMENT', v_proposal.intent, v_proposal.source_class,\n          v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.responsibility_role,\n          v_proposal.governance_party_id::text, v_proposal.party_validated_state_id::text]"));
  for (const tag of ["submit_responsibility", "decide_responsibility"]) {
    const body = rpcBody(tag);
    const order = ["'IMMEDIATE'", "'NO_EFFECTIVE_TO'", "'NO_TARGET_STATE'"].map(s => body.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `${tag}: temporal → end → target order`);
  }
});

test("the additive S1C.1 migration: one transaction, two new definers, one GRANT, nothing replaced, closed framework widening only, no JSON / PII / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no historical routine is replaced (the S1A.2 evaluator stays unchanged)");
  assert.deepEqual([...new Set(executable.match(/^ALTER TABLE gov_repo\.(?!l14_fact_states|l14_responsibility_assignment)\w+/gm) ?? [])].sort(),
    ["ALTER TABLE gov_repo.l14_authorization_decisions", "ALTER TABLE gov_repo.l14_command_results", "ALTER TABLE gov_repo.l14_governance_decisions",
      "ALTER TABLE gov_repo.l14_support_links"], "only the four closed framework tables are widened");
  assert.deepEqual(executable.match(/DROP CONSTRAINT \w+/g)?.sort(), ["DROP CONSTRAINT l14_command_results_shape_check",
    "DROP CONSTRAINT l14_command_results_subject_kind_check", "DROP CONSTRAINT l14_governance_decisions_reason_code_check",
    "DROP CONSTRAINT l14_governance_decisions_subject_kind_check", "DROP CONSTRAINT l14_support_links_owner_check",
    "DROP CONSTRAINT l14_support_links_owner_kind_check"], "only closed CHECKs are re-stated (wider, same names)");
  assert.deepEqual(executable.match(/ADD COLUMN \w+ \w+/g), ["ADD COLUMN fact_state_id uuid", "ADD COLUMN fact_state_id uuid"],
    "one nullable, default-free fact column each on command results and support links (catalog-only, no row rewrite)");
  assert.ok(!/\bUPDATE\s+gov_repo\.l14_(command_results|support_links|governance_decisions|authorization_decisions)\b/i.test(executable), "no historical row is rewritten");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 2, "submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_responsibility_assignment_proposal_v1(", "gov_repo.l14_decide_responsibility_assignment_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/canonical_relationships/.test(executable), "F2: the executable SQL never names canonical_relationships");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_responsibility_assignment_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; nothing is ever deleted");
  assert.ok(!/\b(display_name|email|phone|profile_text|directory_profiles|external_identity_ref|full_name|governance_users)\b/i.test(executable),
    "no Party PII / directory / governance-user identity is read or stored");
  assert.ok(!/\b(owner_user_id|owner_email|owner_id|business_owner|technical_owner|data_owner|data_steward)\b/.test(executable.replace(/'[A-Z_]+'/g, "")),
    "no legacy owner column is read, promoted or migrated");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|risk|confidence|rationale|metadata|cg_\w+)\b/i.test(executable),
    "no score / risk / confidence / rationale / metadata / cg_* surface");
  assert.ok(!/\bgovernance_policies\b|\bpolicy_versions\b|l14_policy_|current_version_id|l14_control_definition|l14_domain_|semantic_representation/.test(executable),
    "no policy store, control-definition or domain registry, or L6 representation is touched");
  assert.ok(!/APPLICABILITY|BUSINESS_CONTEXT|ASSESSMENT/.test(executable), "no other fact family is implemented");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // Authority = ONLY the typed-target evaluator over the CURRENT effective Authority Policy, exact permission, action = outcome.
  assert.ok(rpcBody("decide_responsibility").includes("gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_RESPONSIBILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,\n      v_proposal.target_kind, v_proposal.target_canonical_object_id)"));
  assert.ok(rpcBody("decide_responsibility").includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"));
  assert.ok(!/l14_evaluate_|l14_effective_authority_basis_v1|l14_authorization_decisions|l14_governance_decisions|l14_fact_states \(|l14_responsibility_assignment_heads/
    .test(rpcBody("submit_responsibility").replace(/FROM gov_repo\.l14_fact_states AS r[\s\S]*?revokes_state_id = p_target_state_id;/, "")
      .replace(/FROM gov_repo\.l14_responsibility_assignment_heads AS h[\s\S]*?p_governance_party_id;/, "")),
  "SUBMIT is never authority: no evaluation, authorization, decision, fact or head write");
  // Replay-first order in every RPC: guards → replay arbitration → resolution → authority.
  for (const tag of ["submit_responsibility", "decide_responsibility"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_fact_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  // Guard order in DECIDE: CARDINALITY (single-owner only) before the exact KEY guard.
  const decide = rpcBody("decide_responsibility");
  assert.ok(decide.indexOf("ARRAY['CARDINALITY'") > 0 && decide.indexOf("ARRAY['CARDINALITY'") < decide.indexOf("ARRAY['KEY'"));
  assert.ok(decide.indexOf("RESPONSIBILITY_SINGLE_OWNER_CONFLICT") > decide.indexOf("v_deny IS NOT NULL"), "cardinality is checked under the guard, after authorization");
  assert.ok(code.includes("<> 35 OR pg_catalog.cardinality(v_frozen) <> 25"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_submit_responsibility_assignment_proposal_v1", "l14_decide_responsibility_assignment_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role\b|p_email|p_label|p_name|p_rationale|p_comment|p_status|p_owner|p_user|p_profile|p_score|p_confidence|p_metadata|p_cg/
      .test(signature(name)), `${name}: no caller-chosen tenant / actor / role / PII / rationale / score`);
  }
  // The resolver pins own state + exact target + exact Party dependency at the SAME coordinates; no profile / substitute.
  const resolver = fnBody("l14_responsibility_assignment_valid_state_v1");
  assert.ok(resolver.includes("gov_repo.l14_governance_party_valid_state_v1(p_organisation_id, p_governance_party_id,\n                  p_effective_at, p_recorded_cutoff)"));
  assert.ok(resolver.includes("WHERE ps.state_id = c.party_validated_state_id"));
  assert.ok(resolver.includes("s.recorded_at <= p_recorded_cutoff") && resolver.includes("(v.effective_to IS NULL OR p_effective_at < v.effective_to)"));
  assert.ok(!/directory|profile|governance_users/.test(resolver));
});

test("legacy owner boundary: legacy owner fields exist only as non-authoritative legacy columns; nothing in S1C.1 reads, maps or promotes them", () => {
  const legacy = repo("supabase/migrations/20260818004009_agent_registry_graph_part_1.sql");
  assert.match(legacy, /owner_user_id/, "the legacy agent registry carries an owner_user_id column");
  const s1c1 = [repo("packages/canonical-contracts/src/l14-responsibility-assignment.ts"), repo("packages/governance-review/src/l14-responsibility-assignment.ts"),
    repo("apps/dashboard/lib/governance/l14-responsibility-assignment-persistence.ts")];
  for (const text of s1c1) {
    assert.ok(!/owner_user_id|owner_email|ownerUserId|ownerEmail|gov_repo\.agents|ai_systems|@council\/scanner|directory_profiles|displayName|\bemail\b/.test(
      text.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no S1C.1 TypeScript reads a legacy owner field, the scanner or a Party profile");
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-responsibility-assignment-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "DECIDE_PROPOSAL", subject_kind: "RESPONSIBILITY_ASSIGNMENT",
  outcome: "VALIDATED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  expectation_kind: "EXPECTED_NONE", expected_current_state_id: null, proposal_id: PROPOSAL, governance_decision_id: "g", target_kind: "AGENT",
  target_canonical_object_id: AGENT, responsibility_role: "BUSINESS_OWNER", governance_party_id: PARTY, party_validated_state_id: PARTY_STATE,
  fact_state_id: STATE, state_kind: "VALIDATED", effective_from: "2026-10-09T00:00:00.000001+00:00", effective_to: null,
  recorded_at: "2026-10-09T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-responsibility-assignment-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; key / dependency verbatim; reason code + fingerprint from the mirror", async () => {
  calls = []; nextError = null; nextBody = null;
  const withEnd = { ...VALIDATE, requestedEffectiveTo: "2026-12-31T00:00:00.000000Z" };
  await adapter.submitResponsibilityAssignmentProposal(PRINCIPAL, { commandId: "s", proposal: withEnd, priorProposalId: null, support: NONE });
  const decided = await adapter.decideResponsibilityAssignmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE,
    outcome: "REVOKE", expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual([decided.outcome, decided.factStateId, decided.governancePartyId, decided.partyValidatedStateId, decided.effectiveTo],
    ["VALIDATED", STATE, PARTY, PARTY_STATE, null]);
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_responsibility_assignment_proposal_v1", "l14_decide_responsibility_assignment_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).slice(5).some(key => /role_id|email|^p_owner|^p_status$|label|name|score|risk|rationale|comment|^p_organisation|^p_actor|profile|user/i
      .test(key)), JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_target_kind", "p_target_canonical_object_id",
    "p_responsibility_role", "p_governance_party_id", "p_party_validated_state_id", "p_requested_effective_from", "p_requested_effective_to",
    "p_target_state_id", "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[0]!.args.p_target_kind, calls[0]!.args.p_target_canonical_object_id, calls[0]!.args.p_responsibility_role,
    calls[0]!.args.p_governance_party_id, calls[0]!.args.p_party_validated_state_id, calls[0]!.args.p_requested_effective_to],
  ["AGENT", AGENT, "BUSINESS_OWNER", PARTY, PARTY_STATE, "2026-12-31T00:00:00.000000Z"]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, submitResponsibilityAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: withEnd, priorProposalId: null, support: NONE }));
  assert.deepEqual(Object.keys(calls[1]!.args).slice(5), ["p_command_id", "p_proposal_id", "p_outcome", "p_reason_code", "p_expected_current_state_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[1]!.args.p_outcome, calls[1]!.args.p_reason_code, calls[1]!.args.p_expected_current_state_id],
    ["REVOKE", "RESPONSIBILITY_ASSIGNMENT_REVOKED", STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, decideResponsibilityAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    outcome: "REVOKE", proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "SCOPE_NOT_AUTHORIZED", governance_decision_id: null,
    fact_state_id: null, state_kind: null, effective_from: null }];
  const denied = await adapter.decideResponsibilityAssignmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE,
    outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.factStateId, denied.governanceDecisionId], ["DENIED", "SCOPE_NOT_AUTHORIZED", null, null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV002", "GV003", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitResponsibilityAssignmentProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => {
        assert.ok(error instanceof GovernedWriteError);
        assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
        return true;
      });
  }
  nextError = null;
  calls = [];
  for (const proposal of [{ ...VALIDATE, targetKind: "AGENT_VERSION" }, { ...VALIDATE, responsibilityRole: "DATA_STEWARD" },
    { ...VALIDATE, sourceClass: "SYSTEM_SEED" }, { ...VALIDATE, governancePartyId: "Ana Example" }]) {
    await assert.rejects(adapter.submitResponsibilityAssignmentProposal(PRINCIPAL, { commandId: "x", proposal: proposal as L14ResponsibilityAssignmentProposalContent,
      priorProposalId: null, support: NONE }), L14ContractError);
  }
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1C.1", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-responsibility-assignment-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-responsibility-assignment-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-responsibility-assignment-persistence|l14_(submit_responsibility_assignment_proposal|decide_responsibility_assignment_proposal)_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
