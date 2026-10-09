import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_BUSINESS_CONTEXT_ASSIGNMENT_SUBJECT_KIND, L14_BUSINESS_CONTEXT_REASON_CODES,
  L14_BUSINESS_CONTEXT_SEMANTIC_KINDS, L14_BUSINESS_CONTEXT_SEMANTIC_KIND_MATRIX, L14_BUSINESS_CONTEXT_TARGET_KINDS, L14_DOMAIN_SUBJECT_KINDS,
  L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_FACT_STATE_SUPPORT_OWNER_KIND, L14_PROPOSAL_SUBJECT_KINDS, L14_REGISTRY_SUBJECT_KINDS,
  type L14BusinessContextAssignmentProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, businessContextReasonCode, decideBusinessContextAssignmentProposalFingerprint, isLegalBusinessContextPairing,
  l14BusinessContextSemanticKind, l14BusinessContextTargetKind, l14BusinessContextTargetObjectId,
  submitBusinessContextAssignmentProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1C.2 — closed BUSINESS_CONTEXT_ASSIGNMENT contract + TypeScript mirror + server-only persistence adapter + migration-text
 * invariants + the legacy-domain boundary, without a database. The PG17 suites (tests/postgres-m16/l14-business-context-*.test.ts)
 * prove PostgreSQL computes identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261009120000_m16_s1c2_business_context_assignment_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const DOMAIN_STATE = "55555555-5555-4555-8555-555555555555";
const DOMAIN_STATE2 = "88888888-8888-4888-8888-888888888888";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const ASSET = "canonical-object:asset-1";
const DOMAIN = "business-domain:finance";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const VALIDATE: L14BusinessContextAssignmentProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", targetKind: "DATA_ASSET",
  targetCanonicalObjectId: ASSET, semanticKind: "BUSINESS_DOMAIN", domainId: DOMAIN, domainValidatedStateId: DOMAIN_STATE,
  requestedEffectiveFrom: null, requestedEffectiveTo: null, targetStateId: null };
const REVOKE: L14BusinessContextAssignmentProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
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

test("closed vocabularies: the second fact family; exact semantic-kind matrix; L6 kinds reused; reason codes; never a canonical kind / relationship", () => {
  assert.equal(L14_BUSINESS_CONTEXT_ASSIGNMENT_SUBJECT_KIND, "BUSINESS_CONTEXT_ASSIGNMENT");
  assert.ok((L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes("BUSINESS_CONTEXT_ASSIGNMENT"));
  assert.ok(!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("BUSINESS_CONTEXT_ASSIGNMENT"), "a fact family, not a registry subject");
  assert.deepEqual([...L14_EXECUTABLE_FACT_SUBJECT_KINDS], ["RESPONSIBILITY_ASSIGNMENT", "BUSINESS_CONTEXT_ASSIGNMENT", "POLICY_APPLICABILITY"],
    "exactly the implemented families (S1C.3 adds POLICY_APPLICABILITY); CONTROL_APPLICABILITY / CONTROL_ASSESSMENT stay unimplemented");
  assert.equal(L14_FACT_STATE_SUPPORT_OWNER_KIND, "FACT_STATE");
  assert.deepEqual([...L14_BUSINESS_CONTEXT_TARGET_KINDS], ["AGENT", "DATA_ASSET", "DATA_ELEMENT"]);
  assert.deepEqual([...L14_BUSINESS_CONTEXT_SEMANTIC_KINDS], [...L14_DOMAIN_SUBJECT_KINDS], "the existing L6 / S1B.5 semantic identity kinds, no parallel namespace");
  assert.deepEqual(JSON.parse(JSON.stringify(L14_BUSINESS_CONTEXT_SEMANTIC_KIND_MATRIX)), { AGENT: ["BUSINESS_DOMAIN"],
    DATA_ASSET: ["BUSINESS_DOMAIN", "INFORMATION_DOMAIN"], DATA_ELEMENT: ["INFORMATION_DOMAIN"] });
  const legal: string[] = [];
  for (const kind of [...Object.values(CANONICAL_OBJECT_KIND), "DOMAIN"]) {
    for (const sk of [...L14_BUSINESS_CONTEXT_SEMANTIC_KINDS, "DOMAIN", "DATA_DOMAIN", "BUSINESS_TERM", "business_domain"]) {
      if (isLegalBusinessContextPairing(kind, sk)) legal.push(`${kind}:${sk}`);
    }
  }
  assert.deepEqual(legal, ["AGENT:BUSINESS_DOMAIN", "DATA_ASSET:BUSINESS_DOMAIN", "DATA_ASSET:INFORMATION_DOMAIN", "DATA_ELEMENT:INFORMATION_DOMAIN"],
    "exactly the four legal pairings; AGENT_VERSION and every other kind excluded");
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(businessContextReasonCode(outcome), L14_BUSINESS_CONTEXT_REASON_CODES[outcome]);
    assert.equal(L14_BUSINESS_CONTEXT_REASON_CODES[outcome],
      `BUSINESS_CONTEXT_ASSIGNMENT_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    assert.ok(rpcBody("decide_business_context").includes(`'${L14_BUSINESS_CONTEXT_REASON_CODES[outcome]}'`));
  }
  assert.throws(() => businessContextReasonCode("APPROVE" as never), L14ContractError);
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /DOMAIN|CONTEXT|TERM/.test(kind)));
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /DOMAIN|CONTEXT|BELONGS/.test(type)), "no BELONGS_TO_DOMAIN / IN_DOMAIN");
  for (const fragment of ["CHECK (target_kind IN ('AGENT','DATA_ASSET','DATA_ELEMENT'))",
    "CHECK (semantic_kind IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN'))",
    "(target_kind = 'AGENT' AND semantic_kind = 'BUSINESS_DOMAIN')\n    OR (target_kind = 'DATA_ASSET' AND semantic_kind IN ('BUSINESS_DOMAIN','INFORMATION_DOMAIN'))\n    OR (target_kind = 'DATA_ELEMENT' AND semantic_kind = 'INFORMATION_DOMAIN')",
    "CHECK (subject_kind IN ('RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT'))",
    "PRIMARY KEY (organisation_id, target_kind, target_canonical_object_id, semantic_kind)"]) {
    assert.ok(code.includes(fragment), fragment);
  }
});

test("mirror framing: key, domain, dependency, intent, temporal intent, explicit end, target, prior and support all bind the fingerprint; illegal shapes refused", () => {
  const submit = (p: L14BusinessContextAssignmentProposalContent, prior: string | null = null) =>
    submitBusinessContextAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit({ ...VALIDATE, targetCanonicalObjectId: "canonical-object:asset-2" }), submit({ ...VALIDATE, semanticKind: "INFORMATION_DOMAIN" }),
    submit({ ...VALIDATE, targetKind: "AGENT" }), submit({ ...VALIDATE, domainId: "business-domain:retail" }),
    submit({ ...VALIDATE, domainValidatedStateId: DOMAIN_STATE2 }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }),
    submit({ ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }), submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitBusinessContextAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } }),
    submitBusinessContextAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: DOMAIN_STATE, proposal: VALIDATE, priorProposalId: null, support: NONE })];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every semantic field changes the fingerprint");
  assert.equal(submit({ ...VALIDATE, domainValidatedStateId: DOMAIN_STATE.toUpperCase() }), base, "UUIDs are canonicalized to lowercase text exactly like PostgreSQL");
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideBusinessContextAssignmentProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE), decide("VALIDATE", null, { ...VALIDATE, domainId: "x" }),
    decide("VALIDATE", null, { ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" })]).size, 5);
  for (const [bad, reason] of [
    [{ ...VALIDATE, targetKind: "AGENT_VERSION" }, "BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL"], [{ ...VALIDATE, targetKind: "MODEL" }, "BUSINESS_CONTEXT_TARGET_KIND_ILLEGAL"],
    [{ ...VALIDATE, semanticKind: "DOMAIN" }, "BUSINESS_CONTEXT_SEMANTIC_KIND_UNKNOWN"], [{ ...VALIDATE, semanticKind: "BUSINESS_TERM" }, "BUSINESS_CONTEXT_SEMANTIC_KIND_UNKNOWN"],
    [{ ...VALIDATE, targetKind: "AGENT", semanticKind: "INFORMATION_DOMAIN" }, "BUSINESS_CONTEXT_SEMANTIC_KIND_TARGET_ILLEGAL"],
    [{ ...VALIDATE, targetKind: "DATA_ELEMENT", semanticKind: "BUSINESS_DOMAIN" }, "BUSINESS_CONTEXT_SEMANTIC_KIND_TARGET_ILLEGAL"],
    [{ ...VALIDATE, targetCanonicalObjectId: " x" }, "TARGET_OBJECT_ID_MALFORMED"], [{ ...VALIDATE, targetCanonicalObjectId: "" }, "TARGET_OBJECT_ID_MALFORMED"],
    [{ ...VALIDATE, domainId: " finance" }, "DOMAIN_ID_MALFORMED"], [{ ...VALIDATE, domainId: "" }, "DOMAIN_ID_MALFORMED"],
    [{ ...VALIDATE, domainId: "fin\u0007ance" }, "DOMAIN_ID_MALFORMED"], [{ ...VALIDATE, domainValidatedStateId: "latest" }, "DOMAIN_DEPENDENCY_REQUIRED"],
    [{ ...VALIDATE, sourceClass: "SYSTEM_SEED" }, "SOURCE_CLASS_NOT_EXECUTABLE"], [{ ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }, "SOURCE_CLASS_NOT_EXECUTABLE"],
    [{ ...VALIDATE, sourceClass: "SCANNER" }, "PROPOSAL_VOCABULARY_UNKNOWN"], [{ ...VALIDATE, intent: "ASSIGN" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...REVOKE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_TO_NOT_PERMITTED"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09" }, "EFFECTIVE_FROM_NOT_CANONICAL"], [{ ...VALIDATE, requestedEffectiveTo: "tomorrow" }, "EFFECTIVE_TO_NOT_CANONICAL"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000001Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
  ] as const) {
    assert.throws(() => submit(bad as L14BusinessContextAssignmentProposalContent), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  assert.equal(l14BusinessContextTargetObjectId("é".repeat(500)), "é".repeat(500), "PostgreSQL counts characters");
  assert.throws(() => l14BusinessContextTargetObjectId("x".repeat(501)), L14ContractError);
  assert.throws(() => l14BusinessContextTargetKind("AGENT_VERSION"), L14ContractError);
  assert.throws(() => l14BusinessContextSemanticKind("SEMANTIC_DOMAIN"), L14ContractError);
  // The SQL frames the same parts in the same order.
  assert.ok(rpcBody("submit_business_context").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'BUSINESS_CONTEXT_ASSIGNMENT', p_intent,\n          p_source_class, p_target_kind, p_target_canonical_object_id, p_semantic_kind, p_domain_id,\n          p_domain_validated_state_id::text]"));
  assert.ok(rpcBody("decide_business_context").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'BUSINESS_CONTEXT_ASSIGNMENT', v_proposal.intent, v_proposal.source_class,\n          v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.semantic_kind,\n          v_proposal.domain_id, v_proposal.domain_validated_state_id::text]"));
  for (const tag of ["submit_business_context", "decide_business_context"]) {
    const body = rpcBody(tag);
    const order = ["'IMMEDIATE'", "'NO_EFFECTIVE_TO'", "'NO_TARGET_STATE'"].map(s => body.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `${tag}: temporal → end → target order`);
  }
});

test("the additive S1C.2 migration: one transaction, two new definers, one GRANT, one widened guard, closed framework widening only, no JSON / label / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(code.match(/CREATE OR REPLACE FUNCTION gov_repo\.\w+/g), ["CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1"],
    "the only replaced routine is the S1C.1 fact guard (closed vocabulary widened); the S1C.1 evaluator / RPCs stay unchanged");
  assert.deepEqual([...new Set(executable.match(/^ALTER TABLE gov_repo\.(?!l14_business_context_assignment)\w+/gm) ?? [])].sort(),
    ["ALTER TABLE gov_repo.l14_authorization_decisions", "ALTER TABLE gov_repo.l14_command_results", "ALTER TABLE gov_repo.l14_fact_states",
      "ALTER TABLE gov_repo.l14_governance_decisions"], "only the four closed framework / envelope tables are widened");
  assert.deepEqual(executable.match(/DROP CONSTRAINT \w+/g)?.sort(), ["DROP CONSTRAINT l14_command_results_shape_check",
    "DROP CONSTRAINT l14_command_results_subject_kind_check", "DROP CONSTRAINT l14_fact_states_subject_kind_check",
    "DROP CONSTRAINT l14_governance_decisions_reason_code_check", "DROP CONSTRAINT l14_governance_decisions_subject_kind_check"],
  "only closed CHECKs are re-stated (wider, same names)");
  assert.equal(executable.match(/ADD COLUMN/g), null, "no column is added to any historical table (FACT_STATE support owner reused)");
  assert.ok(!/l14_support_links_owner|support_owner_kind|CREATE TABLE gov_repo\.l14_\w*fact_states/i.test(executable), "no new support owner kind, no second fact envelope");
  assert.ok(!/\bUPDATE\s+gov_repo\.l14_(command_results|support_links|governance_decisions|authorization_decisions|fact_states|domain_)/i.test(executable),
    "no historical row is rewritten");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 2, "submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_business_context_assignment_proposal_v1(", "gov_repo.l14_decide_business_context_assignment_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/canonical_relationships/.test(executable), "F2: the executable SQL never names canonical_relationships");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_business_context_assignment_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; nothing is ever deleted; a supersession never UPDATEs its predecessor");
  assert.ok(!/\b(label|description|display_name|email|phone|profile_text|directory_profiles|governance_users|full_name)\b/i.test(executable),
    "no label / description / PII / governance-user identity is read or stored");
  assert.ok(!/\b(business_domain|information_domain|department|industry_sector|tags|classification|classifier)\b/.test(executable),
    "no legacy domain column / tag / classification is read, promoted or migrated");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|risk|confidence|rationale|metadata|similarity|scanner|llm|cg_\w+)\b/i.test(executable),
    "no score / risk / confidence / rationale / metadata / similarity / scanner / LLM / cg_* surface");
  assert.ok(!/\bgovernance_policies\b|\bpolicy_versions\b|l14_policy_|current_version_id|l14_control_definition|l14_domain_proposals|l14_domain_heads|semantic_representation/
    .test(executable), "no policy store, control-definition registry or domain proposal / head surface is touched");
  assert.ok(!/APPLICABILITY|ASSESSMENT|l14_responsibility_/.test(executable), "no other fact family is implemented or reached");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // Authority = ONLY the S1C.1 typed-target evaluator (reused) over the CURRENT effective Authority Policy, exact permission, action = outcome.
  const decide = rpcBody("decide_business_context");
  assert.ok(decide.includes("gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_BUSINESS_CONTEXT_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,\n      v_proposal.target_kind, v_proposal.target_canonical_object_id)"));
  assert.ok(decide.includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"));
  assert.ok(!/CREATE FUNCTION gov_repo\.l14_evaluate/.test(code), "the evaluator is reused, never duplicated");
  assert.ok(!/l14_evaluate_|l14_effective_authority_basis_v1|l14_authorization_decisions|l14_governance_decisions|l14_fact_states \(|l14_business_context_assignment_heads \(|l14_domain_valid_state_v1/
    .test(rpcBody("submit_business_context")), "SUBMIT is never authority: no evaluation, authorization, decision, fact or head write");
  // Replay-first order in every RPC: guards → replay arbitration → resolution → authority.
  for (const tag of ["submit_business_context", "decide_business_context"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_fact_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  // Documented lock order in DECIDE: AP SHARED → exact domain registry subject guard SHARED → exact fact KEY → command.
  const locks = ["l14_lock_authority_policy_guard_shared_v1(v_org)", "l14_lock_domain_dependency_guard_shared_v1(v_org, v_proposal.semantic_kind, v_proposal.domain_id)",
    "l14_lock_fact_subject_guard_v1(v_org, 'BUSINESS_CONTEXT_ASSIGNMENT',\n    ARRAY['KEY', v_proposal.target_kind, v_proposal.target_canonical_object_id, v_proposal.semantic_kind])",
    "l14_lock_command_guard_v1(v_org, p_command_id)"].map(s => decide.indexOf(s));
  assert.ok(locks.every((i, n) => i > 0 && (n === 0 || i > locks[n - 1]!)), `decide lock order ${locks}`);
  assert.ok(!decide.includes("'CARDINALITY'"), "the domain is never part of the key: no per-domain or cardinality guard");
  assert.ok(decide.indexOf("DOMAIN_DEPENDENCY_NOT_VALID") > decide.indexOf("v_deny IS NOT NULL"), "the dependency is checked under the guards, after authorization");
  const shared = fnBody("l14_lock_domain_dependency_guard_shared_v1");
  assert.ok(shared.includes("pg_advisory_xact_lock_shared") && shared.includes("ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', p_semantic_kind, p_domain_id]"),
    "the shared guard uses the exact S1B.5 registry subject key");
  assert.ok(code.includes("<> 37 OR pg_catalog.cardinality(v_frozen) <> 27"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_submit_business_context_assignment_proposal_v1", "l14_decide_business_context_assignment_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role\b|p_email|p_label|p_name|p_description|p_rationale|p_comment|p_status|p_user|p_score|p_confidence|p_metadata|p_cg|p_tag/
      .test(signature(name)), `${name}: no caller-chosen tenant / actor / role / label / rationale / score`);
  }
  // The resolver pins own state (closure from a VISIBLE successor) + exact target + exact domain dependency at the SAME coordinates.
  const resolver = fnBody("l14_business_context_assignment_valid_state_v1");
  assert.ok(resolver.includes("gov_repo.l14_domain_valid_state_v1(p_organisation_id, p_semantic_kind, c.domain_id,\n                  p_effective_at, p_recorded_cutoff)"));
  assert.ok(resolver.includes("WHERE ds.state_id = c.domain_validated_state_id"));
  assert.ok(resolver.includes("s.recorded_at <= p_recorded_cutoff") && resolver.includes("(v.effective_to IS NULL OR p_effective_at < v.effective_to)"));
  assert.ok(resolver.includes("WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at"), "closure derived from a visible successor");
  assert.ok(!/canonical_relationships|label|parent|inherit/i.test(resolver.replace(/--.*$/gm, "")));
});

test("legacy / discovery boundary: legacy domain strings and scanner classifications exist only as non-authoritative inputs; nothing in S1C.2 reads or promotes them", () => {
  assert.match(repo("supabase/migrations/20260818004009_agent_registry_graph_part_1.sql"), /business_domain varchar\(100\)/, "legacy agents.business_domain");
  assert.match(repo("supabase/migrations/20260818004217_regulatory_and_systems_part_1.sql"), /business_domain varchar\(100\)/, "legacy ai_systems.business_domain");
  assert.match(repo("packages/scanner/src/codeguard/classifier.ts"), /DOMAIN_PATTERNS/, "the scanner infers free-text domains");
  const s1c2 = [repo("packages/canonical-contracts/src/l14-business-context-assignment.ts"), repo("packages/governance-review/src/l14-business-context-assignment.ts"),
    repo("apps/dashboard/lib/governance/l14-business-context-assignment-persistence.ts")];
  for (const text of s1c2) {
    assert.ok(!/business_domain|businessDomain\b|information_domain|DOMAIN_PATTERNS|classif|gov_repo\.agents|ai_systems|@council\/scanner|label|description|similarity/.test(
      text.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no S1C.2 TypeScript reads a legacy domain field, the scanner, a label or a similarity");
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-business-context-assignment-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "DECIDE_PROPOSAL", subject_kind: "BUSINESS_CONTEXT_ASSIGNMENT",
  outcome: "VALIDATED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  expectation_kind: "EXPECTED_CURRENT", expected_current_state_id: STATE, proposal_id: PROPOSAL, governance_decision_id: "g", target_kind: "DATA_ASSET",
  target_canonical_object_id: ASSET, semantic_kind: "BUSINESS_DOMAIN", domain_id: DOMAIN, domain_validated_state_id: DOMAIN_STATE,
  fact_state_id: "99999999-9999-4999-8999-999999999999", state_kind: "VALIDATED", predecessor_state_id: STATE,
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
  adapter = await import("@/lib/governance/l14-business-context-assignment-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; key / domain / dependency verbatim; reason code + fingerprint from the mirror", async () => {
  calls = []; nextError = null; nextBody = null;
  const withEnd = { ...VALIDATE, requestedEffectiveTo: "2026-12-31T00:00:00.000000Z" };
  await adapter.submitBusinessContextAssignmentProposal(PRINCIPAL, { commandId: "s", proposal: withEnd, priorProposalId: null, support: NONE });
  const decided = await adapter.decideBusinessContextAssignmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE,
    outcome: "REVOKE", expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual([decided.outcome, decided.semanticKind, decided.domainId, decided.domainValidatedStateId, decided.predecessorStateId, decided.effectiveTo],
    ["VALIDATED", "BUSINESS_DOMAIN", DOMAIN, DOMAIN_STATE, STATE, null]);
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_business_context_assignment_proposal_v1", "l14_decide_business_context_assignment_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).slice(5).some(key => /role_id|email|label|description|name|score|risk|rationale|comment|^p_organisation|^p_actor|tag|metadata/i
      .test(key)), JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_target_kind", "p_target_canonical_object_id",
    "p_semantic_kind", "p_domain_id", "p_domain_validated_state_id", "p_requested_effective_from", "p_requested_effective_to",
    "p_target_state_id", "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[0]!.args.p_target_kind, calls[0]!.args.p_target_canonical_object_id, calls[0]!.args.p_semantic_kind,
    calls[0]!.args.p_domain_id, calls[0]!.args.p_domain_validated_state_id, calls[0]!.args.p_requested_effective_to],
  ["DATA_ASSET", ASSET, "BUSINESS_DOMAIN", DOMAIN, DOMAIN_STATE, "2026-12-31T00:00:00.000000Z"]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, submitBusinessContextAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: withEnd, priorProposalId: null, support: NONE }));
  assert.deepEqual(Object.keys(calls[1]!.args).slice(5), ["p_command_id", "p_proposal_id", "p_outcome", "p_reason_code", "p_expected_current_state_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[1]!.args.p_outcome, calls[1]!.args.p_reason_code, calls[1]!.args.p_expected_current_state_id],
    ["REVOKE", "BUSINESS_CONTEXT_ASSIGNMENT_REVOKED", STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, decideBusinessContextAssignmentProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    outcome: "REVOKE", proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "SCOPE_NOT_AUTHORIZED", governance_decision_id: null,
    fact_state_id: null, state_kind: null, predecessor_state_id: null, effective_from: null }];
  const denied = await adapter.decideBusinessContextAssignmentProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE,
    outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.factStateId, denied.governanceDecisionId], ["DENIED", "SCOPE_NOT_AUTHORIZED", null, null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV002", "GV003", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitBusinessContextAssignmentProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => {
        assert.ok(error instanceof GovernedWriteError);
        assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
        return true;
      });
  }
  nextError = null;
  calls = [];
  for (const proposal of [{ ...VALIDATE, targetKind: "AGENT_VERSION" }, { ...VALIDATE, targetKind: "AGENT", semanticKind: "INFORMATION_DOMAIN" },
    { ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }, { ...VALIDATE, semanticKind: "DATA_DOMAIN" }, { ...VALIDATE, domainValidatedStateId: "Finance" }]) {
    await assert.rejects(adapter.submitBusinessContextAssignmentProposal(PRINCIPAL, { commandId: "x", proposal: proposal as L14BusinessContextAssignmentProposalContent,
      priorProposalId: null, support: NONE }), L14ContractError);
  }
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1C.2", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-business-context-assignment-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-business-context-assignment-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-business-context-assignment-persistence|l14_(submit_business_context_assignment_proposal|decide_business_context_assignment_proposal)_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
