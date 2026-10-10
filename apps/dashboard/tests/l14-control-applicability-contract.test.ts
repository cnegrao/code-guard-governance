import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_EXECUTABLE_FACT_SUBJECT_KINDS, L14_FACT_STATE_SUPPORT_OWNER_KIND,
  L14_CONTROL_APPLICABILITY_OBJECT_KINDS, L14_CONTROL_APPLICABILITY_OUTCOMES, L14_CONTROL_APPLICABILITY_REASON_CODES,
  L14_CONTROL_APPLICABILITY_SUBJECT_KIND, L14_CONTROL_APPLICABILITY_TARGET_TYPES, L14_POLICY_APPLICABILITY_TARGET_TYPES, L14_PROPOSAL_SUBJECT_KINDS,
  L14_REGISTRY_SUBJECT_KINDS, type L14ControlApplicabilityProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, controlApplicabilityReasonCode, controlApplicabilityTargetParts, decideControlApplicabilityProposalFingerprint,
  l14ControlApplicabilityOutcome, submitControlApplicabilityProposalFingerprint, submitPolicyApplicabilityProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1C.4 — closed CONTROL_APPLICABILITY contract + TypeScript mirror + server-only persistence adapter + migration-text
 * invariants, without a database. The PG17 suites (tests/postgres-m16/l14-control-applicability*.test.ts) prove PostgreSQL computes
 * identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261009220000_m16_s1c4_control_applicability_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const CONTROL = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const VERSION2 = "88888888-8888-4888-8888-888888888888";
const CD_STATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CD_STATE2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const HASH = "c".repeat(64);
const AGENT = "canonical-object:agent-1";
const REL = "canonical-relationship:r1";
const REL_STATE = "canonical-relationship:r1:initial";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const DEP = { controlDefinitionId: CONTROL, controlDefinitionVersionId: VERSION, contentHash: HASH, controlDefinitionValidatedStateId: CD_STATE };
const VALIDATE: L14ControlApplicabilityProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN",
  target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: AGENT }, dependency: DEP, applicability: "APPLIES",
  requestedEffectiveFrom: null, requestedEffectiveTo: null, targetStateId: null };
const REL_VALIDATE: L14ControlApplicabilityProposalContent = { ...VALIDATE,
  target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: REL_STATE } };
const REVOKE: L14ControlApplicabilityProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
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

test("closed vocabularies: the fourth fact family; the S1C.3 target union over all 11 kinds; APPLIES | DOES_NOT_APPLY; reason codes; never canonical", () => {
  assert.equal(L14_CONTROL_APPLICABILITY_SUBJECT_KIND, "CONTROL_APPLICABILITY");
  assert.ok((L14_PROPOSAL_SUBJECT_KINDS as readonly string[]).includes("CONTROL_APPLICABILITY"));
  assert.ok(!(L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("CONTROL_APPLICABILITY"), "a fact family, not a registry subject");
  assert.deepEqual([...L14_EXECUTABLE_FACT_SUBJECT_KINDS],
    ["RESPONSIBILITY_ASSIGNMENT", "BUSINESS_CONTEXT_ASSIGNMENT", "POLICY_APPLICABILITY", "CONTROL_APPLICABILITY"],
    "exactly four implemented families (S1C.4 adds CONTROL_APPLICABILITY); CONTROL_ASSESSMENT stays unimplemented");
  assert.ok(!(L14_EXECUTABLE_FACT_SUBJECT_KINDS as readonly string[]).includes("CONTROL_ASSESSMENT"));
  assert.deepEqual([...L14_CONTROL_APPLICABILITY_TARGET_TYPES], [...L14_POLICY_APPLICABILITY_TARGET_TYPES], "the same closed target union as S1C.3");
  assert.equal(L14_FACT_STATE_SUPPORT_OWNER_KIND, "FACT_STATE");
  assert.deepEqual([...L14_CONTROL_APPLICABILITY_TARGET_TYPES], ["CANONICAL_OBJECT", "RELATIONSHIP_STATE"]);
  assert.deepEqual([...L14_CONTROL_APPLICABILITY_OBJECT_KINDS].sort(), Object.values(CANONICAL_OBJECT_KIND).sort(), "every existing kind, nothing else");
  assert.deepEqual([...L14_CONTROL_APPLICABILITY_OUTCOMES], ["APPLIES", "DOES_NOT_APPLY"], "UNKNOWN is a read outcome, never stored");
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(controlApplicabilityReasonCode(outcome), L14_CONTROL_APPLICABILITY_REASON_CODES[outcome]);
    assert.equal(L14_CONTROL_APPLICABILITY_REASON_CODES[outcome],
      `CONTROL_APPLICABILITY_${{ VALIDATE: "VALIDATED", REJECT: "REJECTED", DEFER: "DEFERRED", REVOKE: "REVOKED" }[outcome]}`);
    assert.ok(rpcBody("decide_control_applicability").includes(`'${L14_CONTROL_APPLICABILITY_REASON_CODES[outcome]}'`));
  }
  assert.throws(() => controlApplicabilityReasonCode("WAIVE" as never), L14ContractError);
  for (const bad of ["UNKNOWN", "PARTIAL", "CONDITIONAL", "WAIVED", "EXEMPT", "NOT_APPLICABLE", "DEFAULT", "INHERITED"]) {
    assert.throws(() => l14ControlApplicabilityOutcome(bad), L14ContractError, bad);
  }
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL|APPLIES|SUBJECT_TO/.test(type)),
    "no CONTROLLED_BY / APPLIES_CONTROL / SUBJECT_TO_CONTROL type");
  for (const fragment of ["CHECK (applicability IN ('APPLIES','DOES_NOT_APPLY'))",
    "CHECK (target_type IN ('CANONICAL_OBJECT','RELATIONSHIP_STATE'))",
    "CHECK (subject_kind IN (\n    'RESPONSIBILITY_ASSIGNMENT','BUSINESS_CONTEXT_ASSIGNMENT','POLICY_APPLICABILITY','CONTROL_APPLICABILITY'))",
    "PRIMARY KEY (organisation_id, target_key, control_definition_id)"]) {
    assert.ok(code.includes(fragment), fragment);
  }
});

test("mirror framing: target union, control tuple, dependency, outcome, temporal intent, target, prior and support all bind the fingerprint; illegal shapes refused", () => {
  const submit = (p: L14ControlApplicabilityProposalContent, prior: string | null = null) =>
    submitControlApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit(REL_VALIDATE), submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "MODEL", targetCanonicalObjectId: AGENT } }),
    submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "canonical-object:agent-2" } }),
    submit({ ...REL_VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: `${REL}:v2` } }),
    submit({ ...VALIDATE, dependency: { ...DEP, controlDefinitionVersionId: VERSION2 } }), submit({ ...VALIDATE, dependency: { ...DEP, contentHash: "d".repeat(64) } }),
    submit({ ...VALIDATE, dependency: { ...DEP, controlDefinitionValidatedStateId: CD_STATE2 } }),
    submit({ ...VALIDATE, dependency: { ...DEP, controlDefinitionId: STATE } }),
    submit({ ...VALIDATE, applicability: "DOES_NOT_APPLY" }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }),
    submit({ ...VALIDATE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }), submit(REVOKE), submit(VALIDATE, PROPOSAL),
    submitControlApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE, priorProposalId: null,
      support: { status: "PRESENT", evidenceIds: ["e1"] } })];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1, "every semantic field changes the fingerprint");
  assert.equal(submit({ ...VALIDATE, dependency: { ...DEP, controlDefinitionValidatedStateId: CD_STATE.toUpperCase() } }), base, "UUIDs canonicalized like PostgreSQL");
  // Family-scoped framing: the identical shape framed as POLICY_APPLICABILITY never collides with CONTROL_APPLICABILITY.
  assert.notEqual(base, submitPolicyApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, priorProposalId: null, support: NONE,
    proposal: { ...VALIDATE, dependency: { policyId: CONTROL, versionId: VERSION, contentHash: HASH, policyVersionValidatedStateId: CD_STATE } } }));
  // The two branches are framed distinctly even when operand strings coincide (branch tag + positions).
  assert.notEqual(submit({ ...VALIDATE, target: { targetType: "CANONICAL_OBJECT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "x" } }),
    submit({ ...VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: "AGENT", relationshipStateId: "x" } }));
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideControlApplicabilityProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE), decide("VALIDATE", null, REL_VALIDATE),
    decide("VALIDATE", null, { ...VALIDATE, applicability: "DOES_NOT_APPLY" })]).size, 5);
  const objT = (o: Record<string, unknown>) => ({ ...VALIDATE, target: { ...VALIDATE.target, ...o } });
  const relT = (o: Record<string, unknown>) => ({ ...REL_VALIDATE, target: { ...REL_VALIDATE.target, ...o } });
  for (const [bad, reason] of [
    [objT({ targetType: "RELATIONSHIP" }), "CONTROL_APPLICABILITY_TARGET_TYPE_UNKNOWN"], [objT({ targetType: "CONTROL" }), "CONTROL_APPLICABILITY_TARGET_TYPE_UNKNOWN"],
    [objT({ targetCanonicalKind: "BUSINESS_DOMAIN" }), "TARGET_CANONICAL_KIND_UNKNOWN"], [objT({ targetCanonicalObjectId: " x" }), "TARGET_OBJECT_ID_MALFORMED"],
    [objT({ relationshipId: REL }), "CONTROL_APPLICABILITY_TARGET_UNION_INVALID"],
    [relT({ targetCanonicalKind: "TOOL" }), "CONTROL_APPLICABILITY_TARGET_UNION_INVALID"],
    [relT({ relationshipId: null }), "TARGET_RELATIONSHIP_ID_MALFORMED"], [relT({ relationshipStateId: undefined }), "TARGET_RELATIONSHIP_STATE_ID_MALFORMED"],
    [relT({ relationshipStateId: "" }), "TARGET_RELATIONSHIP_STATE_ID_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, contentHash: HASH.toUpperCase() } }, "CONTENT_HASH_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, contentHash: "c".repeat(63) } }, "CONTENT_HASH_MALFORMED"],
    [{ ...VALIDATE, dependency: { ...DEP, controlDefinitionVersionId: "latest" } }, "CONTROL_DEFINITION_VERSION_REQUIRED"],
    [{ ...VALIDATE, dependency: { ...DEP, controlDefinitionId: "CG-AG-001" } }, "CONTROL_DEFINITION_VERSION_REQUIRED"],
    [{ ...VALIDATE, dependency: { ...DEP, controlDefinitionValidatedStateId: "current" } }, "CONTROL_DEFINITION_DEPENDENCY_REQUIRED"],
    [{ ...VALIDATE, applicability: "UNKNOWN" }, "CONTROL_APPLICABILITY_OUTCOME_UNKNOWN"],
    [{ ...VALIDATE, applicability: "SATISFIED" }, "CONTROL_APPLICABILITY_OUTCOME_UNKNOWN"],
    [{ ...VALIDATE, sourceClass: "SYSTEM_SEED" }, "SOURCE_CLASS_NOT_EXECUTABLE"], [{ ...VALIDATE, sourceClass: "SCANNER" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...REVOKE, requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_TO_NOT_PERMITTED"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z", requestedEffectiveTo: "2026-10-09T00:00:00.000000Z" }, "EFFECTIVE_INTERVAL_INVALID"],
  ] as const) {
    assert.throws(() => submit(bad as unknown as L14ControlApplicabilityProposalContent),
      (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  assert.deepEqual(controlApplicabilityTargetParts(REL_VALIDATE.target), ["RELATIONSHIP_STATE", REL, REL_STATE]);
  // The SQL frames the same parts in the same order.
  for (const [tag, head] of [["submit_control_applicability", "'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'CONTROL_APPLICABILITY', p_intent,\n          p_source_class, p_target_type]"],
    ["decide_control_applicability", "'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'CONTROL_APPLICABILITY', v_proposal.intent, v_proposal.source_class,\n          v_proposal.target_type]"]] as const) {
    const body = rpcBody(tag);
    assert.ok(body.includes(head), tag);
    const order = ["'IMMEDIATE'", "'NO_EFFECTIVE_TO'", "'NO_TARGET_STATE'"].map(s => body.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `${tag}: temporal → end → target order`);
  }
});

test("the additive S1C.4 migration: one transaction, two new definers, one GRANT, one widened guard, closed framework widening, no JSON / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(code.match(/CREATE OR REPLACE FUNCTION gov_repo\.\w+/g), ["CREATE OR REPLACE FUNCTION gov_repo.l14_lock_fact_subject_guard_v1"],
    "the only replaced routine is the fact guard (closed vocabulary widened); every S1C.1 / S1C.1R1 / S1C.2 / S1C.3 routine stays unchanged");
  assert.ok(!/CREATE FUNCTION gov_repo\.(l14_resolve_relationship_state_target_v1|l14_evaluate_relationship_state_authority_rules_v1|l14_evaluate_target_authority_rules_v1)/
    .test(code), "the S1C.3 relationship-state resolver / evaluator and the S1C.1 object evaluator are REUSED, never re-created");
  assert.deepEqual([...new Set(executable.match(/^ALTER TABLE gov_repo\.(?!l14_control_applicability)\w+/gm) ?? [])].sort(),
    ["ALTER TABLE gov_repo.l14_authorization_decisions", "ALTER TABLE gov_repo.l14_command_results", "ALTER TABLE gov_repo.l14_fact_states",
      "ALTER TABLE gov_repo.l14_governance_decisions"], "only the four closed framework / envelope tables are widened");
  assert.equal(executable.match(/ADD COLUMN/g), null, "no column is added to any historical table");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 2, "submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_submit_control_applicability_proposal_v1(", "gov_repo.l14_decide_control_applicability_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_control_applicability_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; a supersession never UPDATEs its predecessor");
  // F2: S1C.4 never names canonical_relationships in executable SQL (the exact triple is resolved by the reused S1C.3 helper).
  assert.equal((executable.match(/canonical_relationships/g) ?? []).length, 0);
  assert.ok(!/(ALTER|CREATE (UNIQUE )?INDEX|CREATE TRIGGER|REFERENCES)\s[^;]*canonical_relationships/i.test(code), "no F2 DDL / FK / index / trigger");
  assert.ok(!/(^|[^A-Za-z0-9_$])(governance_policies|policy_versions)([^A-Za-z0-9_$]|$)|current_version_id|content_markdown|policy_mandate_mappings/.test(executable),
    "no policy content store, legacy pointer or mapping table is touched");
  assert.ok(!/CONTROL_ASSESSMENT|l14_responsibility_|l14_business_context_|l14_domain_|l14_policy_|POLICY_APPLICABILITY_VALIDATE/.test(
    executable.replace(/'POLICY_APPLICABILITY'/g, "")), "no other fact family / registry is implemented or reached");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|risk|confidence|rationale|metadata|similarity|scanner|llm|cg_\w+|control_code|title|description)\b/i
    .test(executable), "never a control code / title / description, cg_* flag, score or scanner surface");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|auth\.email|auth\.jwt|current_setting\('request/.test(code));
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|vercel)/i.test(migration), "no hosted database / deployment reference");
  const decide = rpcBody("decide_control_applicability");
  // Authority: the S1C.1 object evaluator for objects, the S1C.3 bounded relationship-state evaluator for relationship states (both reused).
  assert.ok(decide.includes("gov_repo.l14_evaluate_target_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_CONTROL_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,"));
  assert.ok(decide.includes("gov_repo.l14_evaluate_relationship_state_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,\n      'L14_CONTROL_APPLICABILITY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal,\n      v_relationship_type,"));
  assert.ok(decide.includes("SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash"),
    "the Authority Policy basis is the effective AP version (never a control version)");
  assert.ok(!/l14_evaluate_|l14_authorization_decisions|l14_governance_decisions|l14_fact_states \(|l14_control_applicability_heads \(|l14_control_definition_valid_state_v1/
    .test(rpcBody("submit_control_applicability")), "SUBMIT is never authority: no evaluation, authorization, decision, fact or head write");
  for (const tag of ["submit_control_applicability", "decide_control_applicability"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_fact_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  // Lock order of DECIDE VALIDATE: AP SHARED → exact CONTROL_DEFINITION dependency SHARED → exact fact KEY → command.
  const locks = ["l14_lock_authority_policy_guard_shared_v1(v_org)",
    "IF p_outcome = 'VALIDATE' THEN\n    PERFORM gov_repo.l14_lock_control_definition_dependency_guard_shared_v1(v_org, v_proposal.control_definition_id,",
    "l14_lock_fact_subject_guard_v1(v_org, 'CONTROL_APPLICABILITY',\n    ARRAY['KEY', v_proposal.target_key, v_proposal.control_definition_id::text])",
    "l14_lock_command_guard_v1(v_org, p_command_id)"].map(s => decide.indexOf(s));
  assert.ok(locks.every((i, n) => i > 0 && (n === 0 || i > locks[n - 1]!)), `decide lock order ${locks}`);
  assert.ok(decide.indexOf("CONTROL_DEFINITION_DEPENDENCY_NOT_VALID") > decide.indexOf("v_deny IS NOT NULL"), "dependency checked under the guards");
  assert.equal((decide.match(/l14_lock_control_definition_dependency_guard_shared_v1/g) ?? []).length, 1, "only VALIDATE takes the dependency guard");
  const shared = fnBody("l14_lock_control_definition_dependency_guard_shared_v1");
  assert.ok(shared.includes("pg_advisory_xact_lock_shared(") && !shared.includes("pg_advisory_xact_lock("));
  assert.ok(shared.replace(/\s+/g, " ").includes("ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', 'CONTROL_DEFINITION', "
    + "'CONTROL_DEFINITION_VALIDATION:' || p_control_definition_id::text || ':' || p_control_definition_version_id::text || ':' || p_content_hash]"),
  "the shared guard uses the exact S1B.6 registry subject key (no new namespace)");
  assert.ok(!/state_id/.test(shared), "the pinned VALIDATED state id is NOT part of the lock key (byte-identical to S1B.6)");
  const s1b6 = repo("supabase/migrations/20261008200000_m16_s1b6_control_definition_registry_v1.sql");
  assert.ok(s1b6.includes("'CONTROL_DEFINITION_VALIDATION:' || v_proposal.control_definition_id::text || ':'\n    || v_proposal.control_definition_version_id::text || ':' || v_proposal.content_hash);"));
  assert.ok(s1b6.includes("'CONTROL_DEFINITION_VALIDATION:' || p_control_definition_id::text || ':' || p_control_definition_version_id::text\n    || ':' || p_content_hash);"));
  assert.ok(s1b6.includes("ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', p_subject_kind, p_subject_key]")
    || repo("supabase/migrations/20260930120000_m16_s1b0_l14_registry_framework_v1.sql")
      .includes("ARRAY[p_organisation_id::text, 'l14-registry-subject-guard-v1', p_subject_kind, p_subject_key]"));
  assert.ok(code.includes("<> 41 OR pg_catalog.cardinality(v_frozen) <> 31"));
  // The resolver: own state (closure from a VISIBLE successor) + exact target + exact CONTROL_DEFINITION dependency at the SAME coordinates.
  const resolver = fnBody("l14_control_applicability_valid_state_v1");
  assert.ok(resolver.includes("gov_repo.l14_control_definition_valid_state_v1(p_organisation_id, c.control_definition_id,\n                  c.control_definition_version_id, c.content_hash::text, p_effective_at, p_recorded_cutoff)"));
  assert.ok(resolver.includes("WHERE cd.state_id = c.control_definition_validated_state_id"));
  assert.ok(resolver.includes("WHERE n.predecessor_state_id = v.fact_state_id AND n.effective_from <= p_effective_at"));
  assert.ok(resolver.includes("WHERE r.match_count = 1"), "an ambiguous relationship-state target resolves nothing");
  assert.ok(!/latest|current_version|inherit|parent|control_code/i.test(resolver.replace(/--.*$/gm, "")), "never selects a version or a code");
  const signature = (name: string) => migration.slice(migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`), migration.indexOf("RETURNS TABLE", migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`)));
  for (const name of ["l14_submit_control_applicability_proposal_v1", "l14_decide_control_applicability_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role\b|p_email|p_label|p_name|p_description|p_title|p_control_code|p_cg_|p_rationale|p_comment|p_status|p_score|p_metadata|p_relationship_type|p_target_relationship_type/
      .test(signature(name).replace(/--.*$/gm, "")), `${name}: no caller-chosen tenant / actor / role / code / title / cg_* / rationale / relationship type`);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-control-applicability-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "DECIDE_PROPOSAL", subject_kind: "CONTROL_APPLICABILITY",
  outcome: "VALIDATED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  expectation_kind: "EXPECTED_CURRENT", expected_current_state_id: STATE, proposal_id: PROPOSAL, governance_decision_id: "g",
  target_type: "RELATIONSHIP_STATE", target_canonical_kind: null, target_canonical_object_id: null, target_relationship_id: REL,
  target_relationship_state_id: REL_STATE, control_definition_id: CONTROL, control_definition_version_id: VERSION, content_hash: HASH,
  control_definition_validated_state_id: CD_STATE,
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
  adapter = await import("@/lib/governance/l14-control-applicability-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; closed target union + dependency verbatim; mirror fingerprints", async () => {
  calls = []; nextError = null; nextBody = null;
  await adapter.submitControlApplicabilityProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  await adapter.submitControlApplicabilityProposal(PRINCIPAL, { commandId: "s2", proposal: REL_VALIDATE, priorProposalId: null, support: NONE });
  const decided = await adapter.decideControlApplicabilityProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE,
    outcome: "REVOKE", expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual([decided.outcome, decided.target, decided.dependency, decided.applicability, decided.predecessorStateId],
    ["VALIDATED", { targetType: "RELATIONSHIP_STATE", relationshipId: REL, relationshipStateId: REL_STATE }, DEP, "DOES_NOT_APPLY", STATE]);
  assert.deepEqual(calls.map(call => call.name), ["l14_submit_control_applicability_proposal_v1", "l14_submit_control_applicability_proposal_v1",
    "l14_decide_control_applicability_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).slice(5).some(key => /role_id|email|label|description|title|control_code|cg_|name|score|rationale|metadata|relationship_type|^p_organisation|^p_actor/i
      .test(key)), JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_target_type", "p_target_canonical_kind",
    "p_target_canonical_object_id", "p_target_relationship_id", "p_target_relationship_state_id", "p_control_definition_id",
    "p_control_definition_version_id", "p_content_hash", "p_control_definition_validated_state_id", "p_applicability", "p_requested_effective_from", "p_requested_effective_to", "p_target_state_id",
    "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual(["p_target_type", "p_target_canonical_kind", "p_target_canonical_object_id", "p_target_relationship_id", "p_target_relationship_state_id"]
    .map(k => [calls[0]!.args[k], calls[1]!.args[k]]), [["CANONICAL_OBJECT", "RELATIONSHIP_STATE"], ["AGENT", null], [AGENT, null], [null, REL], [null, REL_STATE]]);
  assert.deepEqual([calls[0]!.args.p_control_definition_id, calls[0]!.args.p_control_definition_version_id, calls[0]!.args.p_content_hash,
    calls[0]!.args.p_control_definition_validated_state_id], [CONTROL, VERSION, HASH, CD_STATE]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, submitControlApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: REL_VALIDATE, priorProposalId: null, support: NONE }));
  assert.deepEqual([calls[2]!.args.p_outcome, calls[2]!.args.p_reason_code, calls[2]!.args.p_expected_current_state_id],
    ["REVOKE", "CONTROL_APPLICABILITY_REVOKED", STATE]);
  assert.equal(calls[2]!.args.p_caller_fingerprint, decideControlApplicabilityProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    outcome: "REVOKE", proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "SCOPE_NOT_AUTHORIZED", governance_decision_id: null,
    fact_state_id: null, state_kind: null, predecessor_state_id: null, effective_from: null }];
  const denied = await adapter.decideControlApplicabilityProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: VALIDATE,
    outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.factStateId, denied.governanceDecisionId], ["DENIED", "SCOPE_NOT_AUTHORIZED", null, null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitControlApplicabilityProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => error instanceof GovernedWriteError && (error as InstanceType<typeof GovernedWriteError>).code === sqlstate);
  }
  nextError = null;
  calls = [];
  for (const proposal of [{ ...VALIDATE, applicability: "UNKNOWN" }, { ...VALIDATE, sourceClass: "SOURCE_CONNECTION" },
    { ...VALIDATE, dependency: { ...DEP, contentHash: "not-a-hash" } }, { ...REL_VALIDATE, target: { targetType: "RELATIONSHIP_STATE", relationshipId: REL } }]) {
    await assert.rejects(adapter.submitControlApplicabilityProposal(PRINCIPAL, { commandId: "x", proposal: proposal as unknown as L14ControlApplicabilityProposalContent,
      priorProposalId: null, support: NONE }), L14ContractError);
  }
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1C.4", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-control-applicability-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-control-applicability-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-control-applicability-persistence|l14_(submit|decide)_control_applicability_proposal_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
