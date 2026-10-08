import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  CANONICAL_OBJECT_KIND, L14_DOMAIN_ID_MAX_LENGTH, L14_DOMAIN_SUBJECT_KINDS, L14_REGISTRY_REASON_CODES, L14_REGISTRY_SUBJECT_KINDS,
  SEMANTIC_IDENTITY_KIND, asBusinessDomainId, asInformationDomainId, asOrganisationId, l14DomainSubjectOf, type L14DomainProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, admitDomainFingerprint, decideDomainProposalFingerprint, domainContentHash, domainReasonCode, l14DomainId,
  submitDomainProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1B.5 — closed BUSINESS_DOMAIN / INFORMATION_DOMAIN registry contract + TypeScript mirror + server-only persistence
 * adapter + migration-text invariants, without a database. The PG17 suites (tests/postgres-m16/l14-domain-registry*.test.ts)
 * prove PostgreSQL computes identical fingerprints (a mismatch would be GV008) and enforces the same rules.
 */
const MIGRATION = "20261008180000_m16_s1b5_domain_registries_v1.sql";
const migration = readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url)), "utf8");
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const executable = noStrings.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STATE = "77777777-7777-4777-8777-777777777777";
const DOMAIN = "business-domain:customer";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const VALIDATE: L14DomainProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", subjectKind: "BUSINESS_DOMAIN", domainId: DOMAIN,
  requestedEffectiveFrom: null, targetStateId: null };
const REVOKE: L14DomainProposalContent = { ...VALIDATE, intent: "REVOKE", targetStateId: STATE };
const rpcBody = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  assert.ok(start > 0, tag);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};

test("closed vocabularies: exactly the two L6 domain kinds; one reason code per kind x outcome; the registry identity IS the L6 identity", () => {
  assert.deepEqual([...L14_DOMAIN_SUBJECT_KINDS], ["BUSINESS_DOMAIN", "INFORMATION_DOMAIN"]);
  for (const kind of L14_DOMAIN_SUBJECT_KINDS) {
    assert.ok((L14_REGISTRY_SUBJECT_KINDS as readonly string[]).includes(kind));
    assert.ok((Object.values(SEMANTIC_IDENTITY_KIND) as string[]).includes(kind), `${kind} is an existing L6 semantic identity kind`);
    for (const outcome of ["VALIDATE", "REJECT", "DEFER", "REVOKE"] as const) {
      assert.equal(domainReasonCode(kind, outcome), L14_REGISTRY_REASON_CODES[kind][outcome]);
      assert.ok(rpcBody("decide_domain").includes(`'${L14_REGISTRY_REASON_CODES[kind][outcome]}'`));
    }
  }
  assert.throws(() => domainReasonCode("GOVERNANCE_PARTY" as never, "VALIDATE"), L14ContractError);
  assert.throws(() => domainReasonCode("BUSINESS_DOMAIN", "APPROVE" as never), L14ContractError);
  const org = asOrganisationId(ORG);
  assert.deepEqual(l14DomainSubjectOf({ semanticIdentityKind: "BUSINESS_DOMAIN", organisationId: org, businessDomainId: asBusinessDomainId(DOMAIN) }),
    { subjectKind: "BUSINESS_DOMAIN", domainId: DOMAIN });
  assert.deepEqual(l14DomainSubjectOf({ semanticIdentityKind: "INFORMATION_DOMAIN", organisationId: org, informationDomainId: asInformationDomainId("information-domain:pii") }),
    { subjectKind: "INFORMATION_DOMAIN", domainId: "information-domain:pii" });
  assert.equal(Object.values(CANONICAL_OBJECT_KIND).length, 11);
  assert.ok(!(Object.values(CANONICAL_OBJECT_KIND) as string[]).some(kind => /DOMAIN/.test(kind)), "a domain is never a canonical object kind");
});

test("domain id mirror: the L6 value verbatim within the PostgreSQL bounds; malformed ids fail before the network", () => {
  assert.equal(l14DomainId(DOMAIN), DOMAIN);
  assert.equal(l14DomainId("x".repeat(L14_DOMAIN_ID_MAX_LENGTH)), "x".repeat(500));
  assert.equal(l14DomainId("é".repeat(500)), "é".repeat(500), "PostgreSQL counts characters, not UTF-16 units / bytes");
  assert.equal(l14DomainId("tab\tinside".replace("\t", "-")), "tab-inside");
  for (const bad of ["", " lead", "trail ", "x".repeat(501), "ctl\u0001", "nl\n", "del\u007f"]) {
    assert.throws(() => l14DomainId(bad), (error: Error) => error instanceof L14ContractError && error.message.includes("DOMAIN_ID_MALFORMED"), JSON.stringify(bad));
  }
  assert.ok(code.includes("pg_catalog.length(p_domain_id) NOT BETWEEN 1 AND 500"));
  assert.ok(code.includes("p_domain_id <> pg_catalog.btrim(p_domain_id) OR p_domain_id ~ '[[:cntrl:]]'"));
});

test("mirror framing: kind, id, intent, source, temporal intent, target, prior, expectation and support all bind the fingerprint", () => {
  const admit = (kind = "BUSINESS_DOMAIN" as const, id = DOMAIN, org = ORG, actor = ACTOR) =>
    admitDomainFingerprint({ organisationId: org, actorUserId: actor, subjectKind: kind, domainId: id, sourceClass: "LOCAL_HUMAN", support: NONE });
  const admits = [admit(), admit("INFORMATION_DOMAIN" as never), admit(undefined, `${DOMAIN}2`), admit(undefined, undefined, ACTOR), admit(undefined, undefined, ORG, ORG),
    admitDomainFingerprint({ organisationId: ORG, actorUserId: ACTOR, subjectKind: "BUSINESS_DOMAIN", domainId: DOMAIN, sourceClass: "LOCAL_HUMAN",
      support: { status: "PRESENT", evidenceIds: ["e1"] } })];
  assert.equal(new Set(admits).size, admits.length, "every ADMIT field changes the fingerprint (the kind is a namespace)");
  assert.notEqual(domainContentHash("BUSINESS_DOMAIN", DOMAIN), domainContentHash("INFORMATION_DOMAIN", DOMAIN));
  const submit = (p: L14DomainProposalContent, prior: string | null = null) =>
    submitDomainProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: p, priorProposalId: prior, support: NONE });
  const base = submit(VALIDATE);
  const variants = [submit({ ...VALIDATE, subjectKind: "INFORMATION_DOMAIN" }), submit({ ...VALIDATE, domainId: `${DOMAIN}2` }),
    submit({ ...VALIDATE, sourceClass: "SOURCE_CONNECTION" }), submit({ ...VALIDATE, requestedEffectiveFrom: "2026-10-09T00:00:00.000000Z" }),
    submit(REVOKE), submit(VALIDATE, PROPOSAL), admit()];
  assert.equal(new Set([base, ...variants]).size, variants.length + 1);
  const decide = (outcome: "VALIDATE" | "REJECT", expected: string | null, proposal = VALIDATE) => decideDomainProposalFingerprint({
    organisationId: ORG, actorUserId: ACTOR, outcome, proposalId: PROPOSAL, proposal, expectedCurrentStateId: expected, support: NONE });
  assert.equal(new Set([decide("VALIDATE", null), decide("REJECT", null), decide("VALIDATE", STATE),
    decide("VALIDATE", null, { ...VALIDATE, subjectKind: "INFORMATION_DOMAIN" })]).size, 4);
  for (const [bad, reason] of [[{ ...VALIDATE, targetStateId: STATE }, "TARGET_STATE_NOT_PERMITTED"], [{ ...REVOKE, targetStateId: null }, "TARGET_STATE_REQUIRED"],
    [{ ...VALIDATE, intent: "APPROVE" }, "PROPOSAL_VOCABULARY_UNKNOWN"], [{ ...VALIDATE, subjectKind: "CONTROL_DEFINITION" }, "PROPOSAL_VOCABULARY_UNKNOWN"],
    [{ ...VALIDATE, domainId: " x" }, "DOMAIN_ID_MALFORMED"], [{ ...VALIDATE, requestedEffectiveFrom: "2026-10-09" }, "EFFECTIVE_FROM_NOT_CANONICAL"]] as const) {
    assert.throws(() => submit(bad as L14DomainProposalContent), (error: Error) => error instanceof L14ContractError && error.message.includes(reason), reason);
  }
  assert.throws(() => admit("GOVERNANCE_PARTY" as never), (error: Error) => error instanceof L14ContractError && error.message.includes("DOMAIN_KIND_UNKNOWN"));
  // The SQL frames the same parts in the same order.
  assert.ok(rpcBody("admit_domain").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', v_command_kind, v_org::text, v_actor::text,\n          'ADMIT', p_subject_kind, p_domain_id, p_source_class, 'EXPECTED_NONE']"));
  assert.ok(rpcBody("admit_domain").includes("v_command_kind := 'ADMIT_' || p_subject_kind;"));
  assert.ok(rpcBody("submit_domain").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, p_subject_kind, p_intent,\n          p_source_class, p_domain_id]"));
  assert.ok(rpcBody("decide_domain").includes("ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,\n          v_proposal.proposal_id::text, v_proposal.subject_kind, v_proposal.intent, v_proposal.source_class,\n          v_proposal.domain_id]"));
  assert.ok(code.includes("gov_repo.l14_sha256_frame_v1(ARRAY['L14_DOMAIN_CONTENT_V1', p_subject_kind, p_domain_id])"));
});

test("the additive S1B.5 migration: one transaction, three new definers, one GRANT, nothing replaced, no minted id, no label, no JSON / F2 / hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no historical routine is replaced");
  assert.equal((code.match(/^DROP\b/gim) ?? []).length, 0, "nothing is dropped");
  assert.equal((code.match(/^ALTER TABLE gov_repo\.(?!l14_domain_)/gm) ?? []).length, 0, "no pre-existing table is altered");
  assert.equal((code.match(/SECURITY DEFINER\n/g) ?? []).length, 3, "admit, submit, decide");
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_admit_domain_v1(", "gov_repo.l14_submit_domain_proposal_v1(", "gov_repo.l14_decide_domain_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code), "F2");
  assert.deepEqual(executable.match(/^\s*(UPDATE|DELETE)\b.*$/gim)?.map(s => s.trim()), ["UPDATE gov_repo.l14_domain_heads AS h SET latest_state_id = v_state"],
    "the only UPDATE is the technical head CAS; nothing is ever deleted");
  assert.ok(!/gen_random_uuid\(\)[^\n]*domain_id|domain_id[^\n]*DEFAULT/i.test(executable), "PostgreSQL never mints a domain id (no parallel namespace)");
  assert.ok(!/\b(label|description|display_name|title|rationale|parent_domain|hierarchy)\b/i.test(executable), "no label / description / hierarchy as identity or content");
  assert.ok(!/governance_policies|policy_versions|l14_policy_|current_version_id|canonical_objects|semantic_representation/.test(executable),
    "no policy store / lineage, canonical object or L6 representation is touched");
  assert.ok(!/BUSINESS_CONTEXT|APPLICABILITY|_ASSIGNMENT/.test(code.replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "")),
    "validating a domain validates no assignment / applicability (ADR §4)");
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role|auth\.email|auth\.jwt|current_setting\('request/.test(code),
    "no legacy guard, bootstrap, JWT or request-claim authority");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com|vercel)/i.test(migration), "no hosted database / deployment reference");
  // Authority = ONLY the evaluator over the CURRENT effective Authority Policy, exact permission, action = outcome.
  assert.ok(rpcBody("admit_domain").includes("'L14_DOMAIN_ADMIT', 'ADMIT', false, 'IMMEDIATE'"));
  assert.ok(rpcBody("decide_domain").includes("'L14_DOMAIN_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal"));
  for (const tag of ["admit_domain", "decide_domain"]) assert.ok(rpcBody(tag).includes("gov_repo.l14_effective_authority_basis_v1(v_org, v_now)"), tag);
  assert.ok(!/l14_evaluate_authority_rules_v1|l14_effective_authority_basis_v1/.test(rpcBody("submit_domain")), "SUBMIT is not validation authority");
  // Replay-first order in every RPC: guards → replay arbitration → resolution → authority.
  for (const tag of ["admit_domain", "submit_domain", "decide_domain"]) {
    const body = rpcBody(tag);
    const order = ["l14_session_basis_v1", "l14_support_syntactic_parts_v1", "L14_FINGERPRINT_MISMATCH", "l14_lock_authority_policy_guard_shared_v1",
      "l14_lock_registry_subject_guard_v1", "l14_lock_command_guard_v1", "l14_replay_arbitrate_v1", "l14_resolve_support_v1"].map(s => body.indexOf(s));
    assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), `${tag}: replay-first order ${order}`);
  }
  assert.ok(code.includes("<> 30 OR pg_catalog.cardinality(v_frozen) <> 20"));
  const signature = (name: string) => {
    const start = migration.indexOf(`CREATE FUNCTION gov_repo.${name}(`);
    assert.ok(start > 0, name);
    return migration.slice(start, migration.indexOf("RETURNS TABLE", start));
  };
  for (const name of ["l14_admit_domain_v1", "l14_submit_domain_proposal_v1", "l14_decide_domain_proposal_v1"]) {
    assert.ok(!/p_organisation_id|p_actor_user_id|p_role|p_email|p_label|p_description|p_name|p_rationale|p_status|p_parent/.test(signature(name)),
      `${name}: no caller-chosen tenant / actor / role / label / description / rationale`);
  }
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let nextBody: unknown = null;
let adapter: typeof import("@/lib/governance/l14-domain-registry-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "ADMIT_BUSINESS_DOMAIN", subject_kind: "BUSINESS_DOMAIN", outcome: "ADMITTED",
  command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null, proposal_id: null,
  governance_decision_id: null, domain_id: DOMAIN, registry_state_id: null, state_kind: null, effective_from: null,
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
  adapter = await import("@/lib/governance/l14-domain-registry-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names; five verified principal values first and verbatim; L6 identity verbatim; reason code from kind x outcome", async () => {
  calls = []; nextError = null; nextBody = null;
  const subject = { subjectKind: "BUSINESS_DOMAIN", domainId: DOMAIN } as const;
  const admitted = await adapter.admitDomain(PRINCIPAL, { commandId: "a", subject, sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([admitted.outcome, admitted.subjectKind, admitted.domainId, admitted.proposalId], ["ADMITTED", "BUSINESS_DOMAIN", DOMAIN, null]);
  await adapter.submitDomainProposal(PRINCIPAL, { commandId: "s", proposal: VALIDATE, priorProposalId: null, support: NONE });
  const info = { ...REVOKE, subjectKind: "INFORMATION_DOMAIN" } as const;
  await adapter.decideDomainProposal(PRINCIPAL, { commandId: "d", proposalId: PROPOSAL, proposal: info, outcome: "REVOKE",
    expectedCurrentStateId: STATE, support: NONE });
  assert.deepEqual(calls.map(call => call.name), ["l14_admit_domain_v1", "l14_submit_domain_proposal_v1", "l14_decide_domain_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.ok(!Object.keys(call.args).some(key => /role|email|owner|^p_status$|label|description|name|^p_organisation|^p_actor|rationale/i.test(key)),
      JSON.stringify(Object.keys(call.args)));
  }
  assert.deepEqual(Object.keys(calls[0]!.args).slice(5), ["p_command_id", "p_expectation_kind", "p_subject_kind", "p_domain_id", "p_source_class",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[0]!.args.p_expectation_kind, calls[0]!.args.p_subject_kind, calls[0]!.args.p_domain_id], ["EXPECTED_NONE", "BUSINESS_DOMAIN", DOMAIN]);
  assert.equal(calls[0]!.args.p_caller_fingerprint, admitDomainFingerprint({ organisationId: ORG, actorUserId: ACTOR, subjectKind: "BUSINESS_DOMAIN",
    domainId: DOMAIN, sourceClass: "LOCAL_HUMAN", support: NONE }));
  assert.deepEqual(Object.keys(calls[1]!.args).slice(5), ["p_command_id", "p_intent", "p_source_class", "p_subject_kind", "p_domain_id",
    "p_requested_effective_from", "p_target_state_id", "p_prior_proposal_id", "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.equal(calls[1]!.args.p_caller_fingerprint, submitDomainProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: VALIDATE,
    priorProposalId: null, support: NONE }));
  assert.deepEqual(Object.keys(calls[2]!.args).slice(5), ["p_command_id", "p_proposal_id", "p_outcome", "p_reason_code", "p_expected_current_state_id",
    "p_support_status", "p_support_evidence_ids", "p_caller_fingerprint"]);
  assert.deepEqual([calls[2]!.args.p_outcome, calls[2]!.args.p_reason_code, calls[2]!.args.p_expected_current_state_id],
    ["REVOKE", "INFORMATION_DOMAIN_REVOKED", STATE]);
  assert.equal(calls[2]!.args.p_caller_fingerprint, decideDomainProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, outcome: "REVOKE",
    proposalId: PROPOSAL, proposal: info, expectedCurrentStateId: STATE, support: NONE }));
});

test("adapter: a DENY is a durable result; typed SQLSTATEs (GV001-GV011, 55P03) preserved; the mirror refuses bad shapes before the network", async () => {
  calls = []; nextError = null;
  nextBody = [{ ...RESULT_ROW, outcome: "DENIED", authorization_result: "DENY", deny_reason: "NO_MATCHING_AUTHORITY_RULE", domain_id: null }];
  const denied = await adapter.admitDomain(PRINCIPAL, { commandId: "a", subject: { subjectKind: "INFORMATION_DOMAIN", domainId: "i" },
    sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([denied.outcome, denied.denyReason, denied.domainId], ["DENIED", "NO_MATCHING_AUTHORITY_RULE", null]);
  nextBody = null;
  for (const sqlstate of ["GV001", "GV002", "GV003", "GV007", "GV008", "GV009", "GV010", "GV011", "55P03"]) {
    nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.submitDomainProposal(PRINCIPAL, { commandId: "e", proposal: VALIDATE, priorProposalId: null, support: NONE }),
      (error: unknown) => {
        assert.ok(error instanceof GovernedWriteError);
        assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate);
        return true;
      });
  }
  nextError = null;
  calls = [];
  await assert.rejects(adapter.admitDomain(PRINCIPAL, { commandId: "x", subject: { subjectKind: "BUSINESS_DOMAIN", domainId: " padded" },
    sourceClass: "LOCAL_HUMAN", support: NONE }), L14ContractError);
  await assert.rejects(adapter.submitDomainProposal(PRINCIPAL, { commandId: "x", proposal: { ...VALIDATE, subjectKind: "GOVERNANCE_PARTY" as never },
    priorProposalId: null, support: NONE }), L14ContractError);
  assert.equal(calls.length, 0);
});

test("server-only adapter; no HTTP route, UI or other module consumes it in S1B.5", () => {
  const adapterSource = readFileSync(fileURLToPath(new URL("../lib/governance/l14-domain-registry-persistence.ts", import.meta.url)), "utf8");
  assert.match(adapterSource, /^import "server-only";/);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-domain-registry-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (/l14-domain-registry-persistence|l14_(admit_domain|submit_domain_proposal|decide_domain_proposal)_v1/.test(text)) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
