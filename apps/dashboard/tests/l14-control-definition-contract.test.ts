import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, GOVERNED_RELATIONSHIP_TYPE, L14_CONTROL_DEFINITION_CONTENT_BOUNDS, L14_REGISTRY_ADMIT_COMMAND_SUBJECTS,
  L14_REGISTRY_REASON_CODES, L14_REGISTRY_SUBJECT_KINDS, type L14ControlDefinitionProposalContent, type L14ControlDefinitionVersionContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, admitControlDefinitionVersionFingerprint, controlDefinitionContentHash, controlDefinitionReasonCode,
  decideControlDefinitionProposalFingerprint, l14ControlCode, l14ControlDescription, l14ControlTitle, submitControlDefinitionProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1B.6 — closed CONTROL_DEFINITION registry contract + TypeScript mirror + server-only persistence adapter +
 * migration-text invariants + the CG-AG legacy boundary, without a database. The PG17 suites
 * (tests/postgres-m16/l14-control-definition-registry*.test.ts) prove PostgreSQL computes identical content hashes and
 * fingerprints (a mismatch would be GV010 / GV008) and enforces the same rules.
 */
const MIGRATION = "20261008200000_m16_s1b6_control_definition_registry_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const CDID = "44444444-4444-4444-8444-444444444444";
const VID = "55555555-5555-4555-8555-555555555555";
const VID2 = "88888888-8888-4888-8888-888888888888";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const CONTENT: L14ControlDefinitionVersionContent = { controlCode: "AC-01", title: "Access review", description: "Quarterly access review.\n\tService accounts." };
const HASH = controlDefinitionContentHash(CONTENT);
const VALIDATE: L14ControlDefinitionProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", controlDefinitionId: CDID,
  controlDefinitionVersionId: VID, contentHash: HASH, requestedEffectiveFrom: null, targetStateId: null };
const REVOKE: L14ControlDefinitionProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
const rpcBody = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  assert.ok(start > 0, tag);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};

test("closed vocabularies: CONTROL_DEFINITION is a registry subject, never a canonical kind; reserved command / reason codes reused", () => {
  assert.ok((L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes("CONTROL_DEFINITION"));
  assert.equal(L14_REGISTRY_ADMIT_COMMAND_SUBJECTS.ADMIT_CONTROL_DEFINITION_VERSION, "CONTROL_DEFINITION");
  for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
    assert.equal(controlDefinitionReasonCode(outcome), L14_REGISTRY_REASON_CODES.CONTROL_DEFINITION[outcome]);
    assert.ok(rpcBody("decide_control_definition").includes(`'${L14_REGISTRY_REASON_CODES.CONTROL_DEFINITION[outcome]}'`));
  }
  assert.throws(() => controlDefinitionReasonCode("APPROVE" as never), L14ContractError);
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.equal(Object.values(GOVERNED_RELATIONSHIP_TYPE).length, 12);
  assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /CONTROL/.test(kind)), "a control definition is never a canonical object kind");
  assert.ok(!(Object.values(GOVERNED_RELATIONSHIP_TYPE) as string[]).some(type => /CONTROL/.test(type)), "no control relationship type");
  assert.deepEqual({ ...L14_CONTROL_DEFINITION_CONTENT_BOUNDS }, { controlCode: 128, title: 512, description: 8192 });
});

test("content mirror: exact bounds in code points; descriptive content only; the canonical hash binds every field and never normalizes", () => {
  assert.equal(l14ControlCode("c".repeat(128)), "c".repeat(128));
  assert.equal(l14ControlTitle("é".repeat(512)), "é".repeat(512), "PostgreSQL counts characters, not UTF-16 units / bytes");
  assert.equal(l14ControlDescription("a\n\tb"), "a\n\tb", "LF / TAB allowed inside a description");
  for (const [fn, bad, reason] of [
    [l14ControlCode, "", "CONTROL_CODE_MALFORMED"], [l14ControlCode, " x", "CONTROL_CODE_MALFORMED"], [l14ControlCode, "a\nb", "CONTROL_CODE_MALFORMED"],
    [l14ControlCode, "c".repeat(129), "CONTROL_CODE_MALFORMED"], [l14ControlTitle, "t\u0001", "CONTROL_TITLE_MALFORMED"],
    [l14ControlTitle, "t".repeat(513), "CONTROL_TITLE_MALFORMED"], [l14ControlDescription, "", "CONTROL_DESCRIPTION_MALFORMED"],
    [l14ControlDescription, "d\n", "CONTROL_DESCRIPTION_MALFORMED"], [l14ControlDescription, "\td", "CONTROL_DESCRIPTION_MALFORMED"],
    [l14ControlDescription, "a\rb", "CONTROL_DESCRIPTION_MALFORMED"], [l14ControlDescription, "d".repeat(8193), "CONTROL_DESCRIPTION_MALFORMED"],
  ] as const) {
    assert.throws(() => (fn as (v: string) => string)(bad), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), JSON.stringify(bad));
  }
  assert.match(HASH, /^[0-9a-f]{64}$/);
  const hashes = [HASH, controlDefinitionContentHash({ ...CONTENT, controlCode: "AC-02" }), controlDefinitionContentHash({ ...CONTENT, title: "Access review!" }),
    controlDefinitionContentHash({ ...CONTENT, description: "Quarterly access review." }),
    controlDefinitionContentHash({ controlCode: "AC-01Access", title: "review", description: CONTENT.description }),
    controlDefinitionContentHash({ ...CONTENT, title: "Access Review" }), controlDefinitionContentHash({ ...CONTENT, title: "Accéss review" })];
  assert.equal(new Set(hashes).size, hashes.length, "every field binds the hash; framing prevents field-boundary collisions; no case / Unicode normalization");
  // The SQL bounds and hash framing are the same.
  for (const fragment of ["pg_catalog.length(p_control_code) NOT BETWEEN 1 AND 128", "pg_catalog.length(p_title) NOT BETWEEN 1 AND 512",
    "pg_catalog.length(p_description) NOT BETWEEN 1 AND 8192", "p_description <> pg_catalog.btrim(p_description, E' \\n\\t')",
    "pg_catalog.translate(p_description, E'\\n\\t', '') ~ '[[:cntrl:]]'",
    "gov_repo.l14_sha256_frame_v1(ARRAY['L14_CONTROL_DEFINITION_CONTENT_V1', p_control_code, p_title, p_description])"]) {
    assert.ok(code.includes(fragment), fragment);
  }
});

test("mirror framing: ids, content hash, source, expectation, intent, temporal intent, target, prior and support all bind the fingerprint", () => {
  const admit = (over: Partial<Parameters<typeof admitControlDefinitionVersionFingerprint>[0]> = {}) => admitControlDefinitionVersionFingerprint({
    organisationId: ORG, actorUserId: ACTOR, controlDefinitionId: CDID, controlDefinitionVersionId: VID, expectation: { kind: "EXPECTED_NONE" },
    content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE, ...over });
  const admits = [admit(), admit({ controlDefinitionId: STATE }), admit({ controlDefinitionVersionId: VID2 }), admit({ content: { ...CONTENT, title: "x" } }),
    admit({ expectation: { kind: "EXPECTED_CURRENT", latestVersionId: VID2 } }), admit({ sourceClass: "SOURCE_CONNECTION" }), admit({ actorUserId: ORG }),
    admit({ support: { status: "PRESENT", evidenceIds: ["e1"] } })];
  assert.equal(new Set(admits).size, admits.length, "every ADMIT field changes the fingerprint");
  assert.equal(admit({ controlDefinitionId: CDID.toUpperCase() }), admit(), "UUIDs are canonicalized to lowercase text exactly like PostgreSQL");
  for (const [over, reason] of [[{ controlDefinitionId: "CG-AG-001" }, "CONTROL_DEFINITION_IDS_REQUIRED"], [{ controlDefinitionVersionId: CDID }, "CONTROL_DEFINITION_IDS_REQUIRED"],
    [{ expectation: { kind: "EXPECTED_CURRENT", latestVersionId: VID } }, "EXPECTATION_MALFORMED"], [{ expectation: { kind: "LATEST" } }, "EXPECTATION_MALFORMED"],
    [{ content: { ...CONTENT, controlCode: "" } }, "CONTROL_CODE_MALFORMED"], [{ sourceClass: "SCANNER" }, "SOURCE_CLASS_UNKNOWN"]] as const) {
    assert.throws(() => admit(over as never), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  const submit = (p: L14ControlDefinitionProposalContent, prior: string | null = null) =>
    submitControlDefinitionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit({ ...VALIDATE, controlDefinitionId: STATE }), submit({ ...VALIDATE, controlDefinitionVersionId: VID2 }),
    submit({ ...VALIDATE, contentHash: "a".repeat(64) }), submit({ ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }),
    submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }), submit(REVOKE), submit(VALIDATE, PROPOSAL), admit()];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1);
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideControlDefinitionProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE),
    decide("VALIDATE", null, { ...VALIDATE, controlDefinitionVersionId: VID2 })]).size, 4);
  for (const [bad, reason] of [[{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...VALIDATE, intent: "APPROVE" }, "PROPOSAL_VOCABULARY_UNKNOWN"], [{ ...VALIDATE, contentHash: "A".repeat(64) }, "CONTENT_HASH_MALFORMED"],
    [{ ...VALIDATE, controlDefinitionVersionId: "v1" }, "CONTROL_DEFINITION_IDS_REQUIRED"],
    [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09" }, "EFFECTIVE_FROM_NOT_CANONICAL"]] as const) {
    assert.throws(() => submit(bad as L14ControlDefinitionProposalContent), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  // The SQL frames the same parts in the same order.
  assert.ok(rpcBody("admit_control_definition").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_CONTROL_DEFINITION_VERSION', v_org::text, v_actor::text,\n          'ADMIT', 'CONTROL_DEFINITION', p_control_definition_id::text, p_control_definition_version_id::text,\n          v_content_hash, p_source_class]"));
  assert.ok(rpcBody("submit_control_definition").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'CONTROL_DEFINITION', p_intent,\n          p_source_class, p_control_definition_id::text, p_control_definition_version_id::text, p_content_hash]"));
  assert.ok(rpcBody("decide_control_definition").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, 'CONTROL_DEFINITION', v_proposal.intent, v_proposal.source_class,\n          v_proposal.control_definition_id::text, v_proposal.control_definition_version_id::text, v_proposal.content_hash]"));
});

test("the additive S1B.6 migration: one transaction, three new definers, one GRANT, nothing replaced, no minted / derived id, no JSON / score / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no historical routine is replaced");
  assert.equal((code.match(/^DROP\b/gim) ?? []).length, 0, "nothing is dropped");
  assert.equal((code.match(/^ALTER TABLE gov_repo\.(?!l14_control_definition)/gm) ?? []).length, 0, "no pre-existing table is altered");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 3, "admit, submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_admit_control_definition_version_v1(", "gov_repo.l14_submit_control_definition_proposal_v1(",
    "gov_repo.l14_decide_control_definition_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code), "F2");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_control_definition_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical validation head CAS; nothing is ever deleted");
  assert.ok(!/gen_random_uuid\(\)[^\n]*control_definition(_version)?_id|control_definition(_version)?_id[^\n]*DEFAULT/i.test(executable),
    "PostgreSQL never mints a control definition / version id");
  assert.ok(!/control_definition(_version)?_id\s*:?=\s*[^,;\n]*(sha256|md5|uuid_generate_v[35]|control_code|title|description)/i.test(executable),
    "no identity derived from content");
  assert.ok(!/uuid_generate_v[35]|gen_random_uuid\(\)[^\n]*(control_code|title|description)/i.test(executable), "no content-derived UUID");
  assert.ok(!/\b(score|weight|severity|maturity|coverage|waiver|effectiveness|risk|parent_control|hierarchy|metadata|attributes|cg_\w+)\b/i.test(executable),
    "no score / weight / severity / maturity / coverage / waiver / effectiveness / risk / hierarchy / metadata / cg_* surface");
  assert.ok(!/governance_policies|policy_versions|l14_policy_|current_version_id|canonical_objects|semantic_representation/.test(executable),
    "no policy store / lineage, canonical object or L6 representation is touched");
  assert.ok(!/APPLICABILITY|_ASSIGNMENT|ASSESSMENT/.test(executable), "no applicability / assignment / assessment");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // Authority = ONLY the evaluator over the CURRENT effective Authority Policy, exact permission, action = outcome.
  assert.ok(rpcBody("admit_control_definition").includes("'L14_CONTROL_DEFINITION_ADMIT', 'ADMIT', false, 'IMMEDIATE'"));
  assert.ok(rpcBody("decide_control_definition").includes("'L14_CONTROL_DEFINITION_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal"));
  for (const tag of ["admit_control_definition", "decide_control_definition"]) {
    assert.ok(rpcBody(tag).includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"), tag);
  }
  assert.ok(!/l14_evaluate_authority_rules_v1|l14_effective_authority_basis_v1/.test(rpcBody("submit_control_definition")), "SUBMIT is not validation authority");
  assert.ok(!/l14_control_definition_states|l14_control_definition_heads|l14_governance_decisions|l14_registry_states/.test(rpcBody("admit_control_definition")),
    "ADMIT never touches decisions, states or validation heads (ADMITTED != VALIDATED)");
  // Replay-first order in every RPC: guards → replay arbitration → resolution → authority.
  for (const tag of ["admit_control_definition", "submit_control_definition", "decide_control_definition"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_registry_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  assert.ok(rpcBody("admit_control_definition").indexOf("CONTENT_HASH_MISMATCH") < rpcBody("admit_control_definition").indexOf("L14_FINGERPRINT_MISMATCH"),
    "the DB content hash is computed before (and bound into) the fingerprint");
  assert.ok(code.includes("<> 33 OR pg_catalog.cardinality(v_frozen) <> 23"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_admit_control_definition_version_v1", "l14_submit_control_definition_proposal_v1", "l14_decide_control_definition_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role|p_email|p_label|p_name|p_rationale|p_status|p_parent|p_score|p_weight|p_severity|p_risk|p_domain|p_metadata|p_cg/.test(signature(name)),
      `${name}: no caller-chosen tenant / actor / role / rationale / score / scanner domain / CG-AG flag`);
  }
});

test("CG-AG legacy boundary: scanner catalogue and cg_* flags are proposal input only; nothing in S1B.6 reads, maps or scores them", () => {
  const scanner = repo("packages/scanner/src/core/cg-ag-controls.ts");
  const ids = [...scanner.matchAll(/id: '(CG-AG-\d{3})'/g)].map(m => m[1]!);
  assert.equal(ids.length, 12, "CG-AG 001..012 exist only as legacy scanner material");
  for (const id of ids) {
    assert.throws(() => admitControlDefinitionVersionFingerprint({ organisationId: ORG, actorUserId: ACTOR, controlDefinitionId: id,
      controlDefinitionVersionId: VID, expectation: { kind: "EXPECTED_NONE" }, content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE }),
    L14ContractError, `${id} can never be a control_definition_id`);
  }
  // A catalogue entry may only be proposal input: its descriptive text hashes like any other content, nothing more.
  const first = /'CG-AG-001': \{\s*id: '([^']+)',\s*dbFlag: '[^']+',\s*name: '([^']+)',\s*description: '([^']+)'/.exec(scanner);
  assert.ok(first);
  assert.match(controlDefinitionContentHash({ controlCode: first[1]!, title: first[2]!, description: first[3]! }), /^[0-9a-f]{64}$/);
  const s1b6 = [migration, repo("packages/canonical-contracts/src/l14-control-definition.ts"), repo("packages/governance-review/src/l14-control-definition.ts"),
    repo("apps/dashboard/lib/governance/l14-control-definition-persistence.ts")];
  for (const text of s1b6.slice(1)) {
    assert.ok(!/@council\/scanner|cg-ag-controls|CG_AG_CONTROLS|getCGAGScore|isCGAGImplemented|dbFlag|\bcg_\w+/.test(text.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
      "no S1B.6 TypeScript imports the scanner catalogue, a cg_* flag or a CG-AG score");
  }
  assert.ok(!/\bcg_\w+|CG_AG|getCGAGScore|gov_repo\.agents\b|agent_resource_links|ai_systems|agent_compliance_gaps/.test(executable),
    "no S1B.6 SQL reads a cg_* flag, the legacy agent registry or a CG-AG score function");
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-control-definition-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "ADMIT_CONTROL_DEFINITION_VERSION", subject_kind: "CONTROL_DEFINITION",
  outcome: "ADMITTED", command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null,
  attempted_content_hash: HASH, expectation_kind: "EXPECTED_NONE", expected_latest_version_id: null, proposal_id: null, governance_decision_id: null,
  control_definition_id: CDID, control_definition_version_id: VID, predecessor_version_id: null, content_hash: HASH, registry_state_id: null,
  state_kind: null, effective_from: null, recorded_at: "2026-10-09T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-control-definition-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; caller ids verbatim; content hash + reason code from the mirror", async () => {
  calls = []; nextError = null; nextBody = null;
  const admitted = await adapter.admitControlDefinitionVersion(PRINCIPAL, { commandId: "a", controlDefinitionId: CDID, controlDefinitionVersionId: VID,
    expectation: { kind: "EXPECTED_NONE" }, content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([admitted.outcome, admitted.controlDefinitionId, admitted.controlDefinitionVersionId, admitted.contentHash, admitted.proposalId],
    ["ADMITTED", CDID, VID, HASH, null]);
  await adapter.admitControlDefinitionVersion(PRINCIPAL, { commandId: "a2", controlDefinitionId: CDID, controlDefinitionVersionId: VID2,
    expectation: { kind: "EXPECTED_CURRENT", latestVersionId: VID }, content: { ...CONTENT, title: "v2" }, sourceClass: "LOCAL_HUMAN", support: NONE });
  await adapter.submitControlDefinitionProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  await adapter.decideControlDefinitionProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: REVOKE, outcome: "REVOKE",
    expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual(calls.map(call => call.name), ["l14_admit_control_definition_version_v1", "l14_admit_control_definition_version_v1",
    "l14_submit_control_definition_proposal_v1", "l14_decide_control_definition_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).some(key => /role|email|owner|^p_status$|label|score|weight|severity|risk|domain|rationale|^p_organisation|^p_actor|cg_/i.test(key)),
      JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_control_definition_id", "p_control_definition_version_id",
    "p_expectation_kind", "p_expected_latest_version_id", "p_control_code", "p_title", "p_description", "p_content_hash", "p_source_class",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[0]!.args.p_expectation_kind, calls[0]!.args.p_expected_latest_version_id, calls[0]!.args.p_content_hash,
    calls[0]!.args.p_control_definition_id, calls[0]!.args.p_control_definition_version_id], ["EXPECTED_NONE", null, HASH, CDID, VID]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, admitControlDefinitionVersionFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    controlDefinitionId: CDID, controlDefinitionVersionId: VID, expectation: { kind: "EXPECTED_NONE" }, content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE }));
  assert.deepEqual([calls[1]!.args.p_expectation_kind, calls[1]!.args.p_expected_latest_version_id], ["EXPECTED_CURRENT", VID]);
  assert.deepEqual(Object.keys(calls[2]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_control_definition_id",
    "p_control_definition_version_id", "p_content_hash", "p_requested_effective_from", "p_target_state_id", "p_prior_proposal_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.equal(calls[2]!.args.p_caller_fingerprint, submitControlDefinitionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE,
    priorProposalId: null, support: NONE }));
  assert.deepEqual(Object.keys(calls[3]!.args).slice(5), ["p_command_id", "p_proposal_id", "p_outcome", "p_reason_code", "p_expected_current_state_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[3]!.args.p_outcome, calls[3]!.args.p_reason_code, calls[3]!.args.p_expected_current_state_id],
    ["REVOKE", "CONTROL_DEFINITION_REVOKED", STATE]);
  assert.equal(calls[3]!.args.p_caller_fingerprint, decideControlDefinitionProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome: "REVOKE",
    proposalId: PROPOSAL, proposal: REVOKE, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "NO_MATCHING_AUTHORITY_RULE", control_definition_id: null,
    control_definition_version_id: null, content_hash: null }];
  const denied = await adapter.admitControlDefinitionVersion(PRINCIPAL, { commandId: "a", controlDefinitionId: CDID, controlDefinitionVersionId: VID,
    expectation: { kind: "EXPECTED_NONE" }, content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.controlDefinitionId, denied.attemptedContentHash], ["DENIED", "NO_MATCHING_AUTHORITY_RULE", null, HASH]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV002", "GV003", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitControlDefinitionProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => {
        assert.ok(error instanceof GovernedWriteError);
        assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
        return true;
      });
  }
  nextError = null;
  calls = [];
  await assert.rejects(adapter.admitControlDefinitionVersion(PRINCIPAL, { commandId: "x", controlDefinitionId: "CG-AG-001", controlDefinitionVersionId: VID,
    expectation: { kind: "EXPECTED_NONE" }, content: CONTENT, sourceClass: "LOCAL_HUMAN", support: NONE }), L14ContractError);
  await assert.rejects(adapter.admitControlDefinitionVersion(PRINCIPAL, { commandId: "x", controlDefinitionId: CDID, controlDefinitionVersionId: VID,
    expectation: { kind: "EXPECTED_NONE" }, content: { ...CONTENT, title: " padded" }, sourceClass: "LOCAL_HUMAN", support: NONE }), L14ContractError);
  await assert.rejects(adapter.submitControlDefinitionProposal(PRINCIPAL, { commandId: "x", proposal: { ...VALIDATE, contentHash: "nothex" },
    priorProposalId: null, support: NONE }), L14ContractError);
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1B.6", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-control-definition-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-control-definition-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-control-definition-persistence|l14_(admit_control_definition_version|submit_control_definition_proposal|decide_control_definition_proposal)_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
