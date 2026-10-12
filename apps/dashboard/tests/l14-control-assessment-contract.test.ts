import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  GOVERNED_RELATIONSHIP_TYPE, L14_CONTROL_ASSESSMENT_OUTCOMES, L14_CONTROL_ASSESSMENT_REASON_CODES, L14_CONTROL_ASSESSMENT_SUBJECT_KIND,
  L14_CONTROL_ASSESSMENT_UNSUPPORTED_OUTCOMES, L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_FACT_STATE_SUPPORT_OWNER_KIND, L14_PROPOSAL_SUBJECT_KINDS,
  L14_REGISTRY_SUBJECT_KINDS, type L14ControlAssessmentProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, controlAssessmentReasonCode, decideControlAssessmentProposalFingerprint, l14ControlAssessmentOutcome,
  submitControlApplicabilityProposalFingerprint, submitControlAssessmentProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1C.5 — closed CONTROL_ASSESSMENT contract + TypeScript mirror + server-only persistence adapter + migration-text
 * invariants, without a database. The PG17 suites (tests/postgres-m16/l14-control-assessment*.test.ts) prove PostgreSQL computes
 * identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261010120000_m16_s1c5_control_assessment_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const APPLICABILITY = "44444444-4444-4444-8444-444444444444";
const APPLICABILITY2 = "55555555-5555-4555-8555-555555555555";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const CONTROL = "88888888-8888-4888-8888-888888888888";
const VERSION = "99999999-9999-4999-8999-999999999999";
const HASH = "c".repeat(64);
const UNTIL = "2026-12-31T00:00:00.000000Z";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const VALIDATE: L14ControlAssessmentProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", controlApplicabilityStateId: APPLICABILITY,
  assessmentOutcome: "SATISFIED", requestedEffectiveFrom: null, requestedValidUntil: UNTIL, targetStateId: null };
const REVOKE: L14ControlAssessmentProposalContent = { ...VALIDATE, intent: "REVOKE", requestedValidUntil: null, targetStateId: STATE };
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

test("closed vocabularies: the fifth and final fact family; five outcomes; WAIVED unsupported; reason codes; CONTROL_FINDING never a family", () => {
  assert.equal(L14_CONTROL_ASSESSMENT_SUBJECT_KIND, "CONTROL_ASSESSMENT");
  assert.ok((L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes("CONTROL_ASSESSMENT"));
  assert.ok(!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("CONTROL_ASSESSMENT"), "a fact family, not a registry subject");
  assert.deepEqual([...L14_EXECUTABLE_FACT_SUBJECT_KINDS],
    ["RESPONSIBILITY_ASSIGNMENT", "BUSINESS_CONTEXT_ASSIGNMENT", "POLICY_APPLICABILITY", "CONTROL_APPLICABILITY", "CONTROL_ASSESSMENT"],
    "exactly the five M16 fact families");
  for (const list of [L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_PROPOSAL_SUBJECT_KINDS, L14_REGISTRY_SUBJECT_KINDS]) {
    assert.ok(!(list as readonly string[]).includes("CONTROL_FINDING"), "CONTROL_FINDING is never a subject");
  }
  assert.equal(L14_FACT_STATE_SUPPORT_OWNER_KIND, "FACT_STATE");
  assert.deepEqual([...L14_CONTROL_ASSESSMENT_OUTCOMES], ["SATISFIED", "PARTIALLY_SATISFIED", "NOT_SATISFIED", "NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"]);
  assert.deepEqual([...L14_CONTROL_ASSESSMENT_UNSUPPORTED_OUTCOMES], ["WAIVED"]);
  for (const outcome of L14_CONTROL_ASSESSMENT_OUTCOMES) assert.equal(l14ControlAssessmentOutcome(outcome), outcome);
  assert.throws(() => l14ControlAssessmentOutcome("WAIVED"), (e: Error) => e instanceof L14ContractError && /CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED/.test(e.message));
  for (const bad of ["waived", "UNKNOWN", "COMPLIANT", "PASS", "FAIL", "EXEMPT", "PARTIAL", "APPLIES", ""]) {
    assert.throws(() => l14ControlAssessmentOutcome(bad), (e: Error) => e instanceof L14ContractError && /CONTROL_ASSESSMENT_OUTCOME_UNKNOWN/.test(e.message), bad);
  }
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(controlAssessmentReasonCode(outcome), L14_CONTROL_ASSESSMENT_REASON_CODES[outcome]);
    assert.equal(L14_CONTROL_ASSESSMENT_REASON_CODES[outcome],
      `CONTROL_ASSESSMENT_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    assert.ok(rpcBody("decide_control_assessment").includes(`'${L14_CONTROL_ASSESSMENT_REASON_CODES[outcome]}'`));
  }
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL|ASSESS|SATISF/.test(type)));
  for (const fragment of [
    "CHECK (assessment_outcome IN (\n    'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','NOT_ASSESSED','INSUFFICIENT_EVIDENCE'))",
    "CHECK (subject_kind IN (\n    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY',\n    'CONTROL_ASSESSMENT'))",
    "PRIMARY KEY (organisation_id, control_applicability_state_id)",
    "applicability text NOT NULL DEFAULT 'APPLIES' CHECK (applicability = 'APPLIES')",
    "(intent = 'VALIDATE' AND target_state_id IS NULL AND requested_valid_until IS NOT NULL)",
    "REFERENCES gov_repo.l14_control_applicability_states (organisation_id, fact_state_id, target_key, control_definition_id,\n                 control_definition_version_id, content_hash, control_definition_validated_state_id, applicability, state_kind)"]) {
    assert.ok(code.includes(fragment), fragment);
  }
  assert.ok(!/WAIVED/.test(executable.replace(/IF p_assessment_outcome = 'WAIVED' THEN[\s\S]*?END IF;/, "")), "WAIVED appears only in the explicit refusal");
  assert.ok(!/CONTROL_FINDING|finding/i.test(executable), "no finding table / routine / vocabulary");
});

test("mirror framing: applicability pin, outcome, temporal intent, valid_until, target state, prior and support bind the fingerprint; illegal shapes refused", () => {
  const submit = (p: L14ControlAssessmentProposalContent, prior: string | null = null) =>
    submitControlAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit({ ...VALIDATE, controlApplicabilityStateId: APPLICABILITY2 }), submit({ ...VALIDATE, assessmentOutcome: "NOT_ASSESSED" }),
    submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }), submit({ ...VALIDATE, requestedValidUntil: "2027-01-01T00:00:00.000000Z" }),
    submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitControlAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } })];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every semantic field changes the fingerprint");
  assert.equal(submit({ ...VALIDATE, controlApplicabilityStateId: APPLICABILITY.toUpperCase() }), base, "UUIDs canonicalized like PostgreSQL");
  // Family-scoped framing: never collides with a CONTROL_APPLICABILITY framing.
  assert.notEqual(base, submitControlApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, priorProposalId: null, support: NONE,
    proposal: { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "x" },
      dependency: { controlDefinitionId: CONTROL, controlDefinitionVersionId: VERSION, contentHash: HASH, controlDefinitionValidatedStateId: APPLICABILITY },
      applicability: "APPLIES", requestedEffectiveFrom: null, requestedEffectiveTo: UNTIL, targetStateId: null } }));
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideControlAssessmentProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE),
    decide("VALIDATE", null, { ...VALIDATE, assessmentOutcome: "NOT_SATISFIED" })]).size, 4);
  for (const [bad, reason] of [
    [{ ...VALIDATE, assessmentOutcome: "WAIVED" }, "CONTROL_ASSESSMENT_WAIVED_UNSUPPORTED"],
    [{ ...VALIDATE, assessmentOutcome: "UNKNOWN" }, "CONTROL_ASSESSMENT_OUTCOME_UNKNOWN"],
    [{ ...VALIDATE, controlApplicabilityStateId: "latest" }, "CONTROL_APPLICABILITY_STATE_REQUIRED"],
    [{ ...VALIDATE, controlApplicabilityStateId: null }, "CONTROL_APPLICABILITY_STATE_REQUIRED"],
    [{ ...VALIDATE, requestedValidUntil: null }, "VALID_UNTIL_REQUIRED"],
    [{ ...REVOKE, requestedValidUntil: UNTIL }, "VALID_UNTIL_NOT_PERMITTED"],
    [{ ...VALIDATE, requestedValidUntil: "2026-12-31" }, "VALID_UNTIL_NOT_CANONICAL"],
    [{ ...VALIDATE, requestedEffectiveFrom: UNTIL }, "EFFECTIVE_INTERVAL_INVALID"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2027-01-01T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
    [{ ...VALIDATE, sourceClass: "SYSTEM_SEED" }, "SOURCE_CLASS_NOT_EXECUTABLE"], [{ ...VALIDATE, sourceClass: "LLM" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
  ] as const) {
    assert.throws(() => submit(bad as unknown as L14ControlAssessmentProposalContent),
      (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  // The SQL frames the same parts in the same order.
  for (const [tag, head] of [["submit_control_assessment", "'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'CONTROL_ASSESSMENT', p_intent,\n          p_source_class, p_control_applicability_state_id::text, p_assessment_outcome]"],
    ["decide_control_assessment", "'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'CONTROL_ASSESSMENT', v_proposal.intent, v_proposal.source_class,\n          v_proposal.control_applicability_state_id::text, v_proposal.assessment_outcome]"]] as const) {
    const body = rpcBody(tag);
    assert.ok(body.includes(head), tag);
    const order = ["'IMMEDIATE'", "'NO_VALID_UNTIL'", "'NO_TARGET_STATE'"].map(s => body.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `${tag}: temporal → valid_until → target order`);
  }
});

test("the additive S1C.5 migration: one transaction, two new definers, one GRANT, one widened guard, closed framework widening, no S1C.4 / F2 / hosted change", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(code.match(/CREATE OR REPLACE FUNCTION gov_repo\.\w+/g), ["CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1"],
    "the only replaced routine is the fact guard; every S1C.4 routine (resolver, current read, encoder, guards) stays unchanged");
  assert.ok(!/CREATE FUNCTION gov_repo\.(l14_control_applicability\w*|l14_resolve_relationship_state_target_v1|l14_evaluate_\w+|l14_lock_control_definition_dependency_guard_shared_v1)\(/
    .test(code), "the S1C.4 / S1C.3 / S1C.1 helpers are REUSED, never re-created");
  assert.deepEqual([...new Set(executable.match(/^ALTER TABLE gov_repo\.(?!l14_control_assessment)\w+/gm) ?? [])].sort(),
    ["ALTER TABLE gov_repo.l14_authorization_decisions", "ALTER TABLE gov_repo.l14_command_results", "ALTER TABLE gov_repo.l14_fact_states",
      "ALTER TABLE gov_repo.l14_governance_decisions"], "only the four closed framework / envelope tables are widened; no S1C.4 table is altered");
  assert.equal(executable.match(/ADD COLUMN/g), null, "no column is added to any historical table");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 2, "submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_control_assessment_proposal_v1(", "gov_repo.l14_decide_control_assessment_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_control_assessment_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; a renewal never UPDATEs its predecessor; nothing is written to S1C.4");
  assert.ok(!/INSERT INTO gov_repo\.l14_control_applicability/.test(executable), "no S1C.4 row is ever written");
  assert.equal((executable.match(/canonical_relationships/g) ?? []).length, 0, "F2: never named in executable SQL");
  assert.ok(!/(ALTER|CREATE (UNIQUE )?INDEX|CREATE TRIGGER|REFERENCES)\s[^;]*canonical_relationships/i.test(code), "no F2 DDL / FK / index / trigger");
  assert.ok(!/(^|[^A-Za-z0-9_$])(governance_policies|policy_versions|control_assessments|control_findings)([^A-Za-z0-9_$]|$)/.test(executable),
    "no policy content store and no quarantined legacy assessment / finding table is touched");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|risk|confidence|rationale|metadata|similarity|scanner|llm|cg_\w+|control_code|title|description)\b/i
    .test(executable), "never a score, coverage, waiver, rationale, control content or scanner surface");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|vercel)/i.test(migration), "no hosted database / deployment reference");
  const decide = rpcBody("decide_control_assessment");
  assert.ok(decide.includes("gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_CONTROL_ASSESSMENT_VALIDATE', p_outcome,"));
  assert.ok(decide.includes("gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_CONTROL_ASSESSMENT_VALIDATE', p_outcome,"));
  assert.ok(!/l14_evaluate_|l14_authorization_decisions|l14_governance_decisions|l14_fact_states \(|l14_control_assessment_heads \(|l14_control_applicability_valid_state_v1/
    .test(rpcBody("submit_control_assessment")), "SUBMIT is never authority");
  for (const tag of ["submit_control_assessment", "decide_control_assessment"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_fact_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  const locks = ["l14_lock_authority_policy_guard_shared_v1(v_org)", "l14_lock_control_definition_dependency_guard_shared_v1(v_org,",
    "l14_lock_control_applicability_dependency_guard_shared_v1(v_org,",
    "l14_lock_fact_subject_guard_v1(v_org, 'CONTROL_ASSESSMENT',\n    ARRAY['KEY', v_proposal.control_applicability_state_id::text])",
    "l14_lock_command_guard_v1(v_org, p_command_id)"].map(s => decide.indexOf(s));
  assert.ok(locks.every((i, n) => i > 0 && (n === 0 || i > locks[n - 1]!)), `decide lock order ${locks}`);
  assert.ok(decide.indexOf("CONTROL_APPLICABILITY_DEPENDENCY_NOT_VALID") > decide.indexOf("v_deny IS NOT NULL"), "dependency checked under the guards");
  const shared = fnBody("l14_lock_control_applicability_dependency_guard_shared_v1");
  assert.ok(shared.includes("pg_advisory_xact_lock_shared(") && !shared.includes("pg_advisory_xact_lock("));
  assert.ok(shared.replace(/\s+/g, " ").includes("ARRAY[p_organisation_id::text, 'l14-fact-subject-guard-v1', 'CONTROL_APPLICABILITY', 'KEY', p_target_key, p_control_definition_id::text]"),
    "the shared guard is the exact S1C.4 fact KEY guard key (no new namespace)");
  const s1c4 = repo("supabase/migrations/20261009220000_m16_s1c4_control_applicability_v1.sql");
  assert.ok(s1c4.includes("ARRAY['KEY', v_proposal.target_key, v_proposal.control_definition_id::text]"), "the S1C.4 key producer is unchanged");
  assert.ok(code.includes("<> 43 OR pg_catalog.cardinality(v_frozen) <> 33"));
  const resolver = fnBody("l14_control_assessment_valid_state_v1");
  assert.ok(resolver.includes("AND v.effective_to IS NOT NULL AND p_effective_at < v.effective_to"), "valid_until gates validity; a head never overrides expiry");
  assert.ok(resolver.includes("WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at"));
  assert.ok(resolver.includes("WHERE ca.fact_state_id = c.control_applicability_state_id AND ca.applicability = 'APPLIES'"),
    "the exact pinned applicability must be the valid APPLIES state at the same coordinates (no carry-over)");
  assert.ok(!/latest|current_version|successor|inherit|parent/i.test(resolver.replace(/--.*$/gm, "")));
  const signature = (name: string) => migration.slice(migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`), migration.indexOf("RETURNS TABLE", migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`)));
  for (const name of ["l14_submit_control_assessment_proposal_v1", "l14_decide_control_assessment_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role\b|p_email|p_label|p_title|p_control_code|p_cg_|p_rationale|p_comment|p_status|p_score|p_metadata|p_target_type|p_control_definition|p_finding|p_waiver|p_effective_to/
      .test(signature(name).replace(/--.*$/gm, "")), `${name}: no caller-chosen tenant / actor / target / control version / score / finding / second end`);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-control-assessment-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "DECIDE_PROPOSAL", subject_kind: "CONTROL_ASSESSMENT",
  outcome: "VALIDATED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  expectation_kind: "EXPECTED_CURRENT", expected_current_state_id: STATE, proposal_id: PROPOSAL, governance_decision_id: "g",
  control_applicability_state_id: APPLICABILITY, control_definition_id: CONTROL, control_definition_version_id: VERSION, content_hash: HASH,
  assessment_outcome: "PARTIALLY_SATISFIED", fact_state_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state_kind: "VALIDATED", predecessor_state_id: STATE,
  effective_from: "2026-10-10T00:00:00.000001+00:00", valid_until: "2026-12-31T00:00:00+00:00", recorded_at: "2026-10-10T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-control-assessment-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; only the applicability pin + outcome + interval; mirror fingerprints", async () => {
  calls = []; nextError = null; nextBody = null;
  await adapter.submitControlAssessmentProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  const decided = await adapter.decideControlAssessmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE,
    outcome: "REVOKE", expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual([decided.outcome, decided.controlApplicabilityStateId, decided.assessmentOutcome, decided.validUntil, decided.predecessorStateId,
    decided.controlDefinitionVersionId], ["VALIDATED", APPLICABILITY, "PARTIALLY_SATISFIED", "2026-12-31T00:00:00+00:00", STATE, VERSION]);
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_control_assessment_proposal_v1", "l14_decide_control_assessment_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS);
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_control_applicability_state_id",
    "p_assessment_outcome", "p_requested_effective_from", "p_requested_valid_until", "p_target_state_id", "p_prior_proposal_id", "p_support_status",
    "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[0]!.args.p_control_applicability_state_id, calls[0]!.args.p_assessment_outcome, calls[0]!.args.p_requested_valid_until],
    [APPLICABILITY, "SATISFIED", UNTIL]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, submitControlAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: VALIDATE, priorProposalId: null, support: NONE }));
  assert.deepEqual([calls[1]!.args.p_outcome, calls[1]!.args.p_reason_code, calls[1]!.args.p_expected_current_state_id],
    ["REVOKE", "CONTROL_ASSESSMENT_REVOKED", STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, decideControlAssessmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    outcome: "REVOKE", proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs preserved; WAIVED / missing valid_until refused before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "SCOPE_NOT_AUTHORIZED", governance_decision_id: null,
    fact_state_id: null, state_kind: null, predecessor_state_id: null, effective_from: null, valid_until: null }];
  const denied = await adapter.decideControlAssessmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE,
    outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.factStateId, denied.validUntil], ["DENIED", "SCOPE_NOT_AUTHORIZED", null, null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitControlAssessmentProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => error instanceof GovernedWriteError && (error as InstanceType<typeof GovernedWriteError>).code === sqlstate);
  }
  nextError = null;
  calls = [];
  for (const proposal of [{ ...VALIDATE, assessmentOutcome: "WAIVED" }, { ...VALIDATE, requestedValidUntil: null },
    { ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }, { ...VALIDATE, controlApplicabilityStateId: "CG-AG-001" }]) {
    await assert.rejects(adapter.submitControlAssessmentProposal(PRINCIPAL, { commandId: "x", proposal: proposal as unknown as L14ControlAssessmentProposalContent,
      priorProposalId: null, support: NONE }), L14ContractError);
  }
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1C.5", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-control-assessment-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-control-assessment-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-control-assessment-persistence|l14_(submit|decide)_control_assessment_proposal_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
