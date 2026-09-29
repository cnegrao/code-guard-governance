import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  L14_AUTHORITY_POLICY_REASON_CODES, L14_AUTHORIZATION_DENY_REASONS, L14_PERMISSIONS, L14_PROPOSAL_SUBJECT_KINDS,
  L14_REQUESTED_ACTIONS, L14_SCOPE_TAGS, L14_SOURCE_CLASSES, L14_SOURCE_DISPOSITIONS, L14_SQLSTATES, L14_SUPPORT_STATUSES,
  type L14AuthorityPolicyRule,
} from "@council/canonical-contracts";
import {
  L14ContractError, admitAuthorityPolicyVersionFingerprint, authorityPolicyContentHash, authorityPolicyRuleFrame,
  decideProposalFingerprint, submitProposalFingerprint, supportParts,
} from "@council/governance-review";

/**
 * M16-S1A.1 — closed L14 contract + TypeScript fingerprint mirror + server-only persistence
 * adapter, without a database. The PG17 suites (tests/postgres-m16/l14-authority-policy-*.test.ts)
 * prove that PostgreSQL computes the identical values and rejects a wrong one (GV008).
 */

const ADMIN = "aaaaaaaa-1111-4111-8111-11111111abcd";
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const rule = (overrides: Partial<L14AuthorityPolicyRule> = {}): L14AuthorityPolicyRule => ({
  roleId: ADMIN, permission: "L14_AUTHORITY_POLICY_ADMIN", requestedAction: "VALIDATE", sourceClass: "LOCAL_HUMAN",
  sourceDisposition: "AUTHORITATIVE", scopeTag: "ALL_ALLOWED_TARGETS", scopeCanonicalKind: null, scopeCanonicalObjectId: null,
  scopeRelationshipType: null, scopeRelationshipId: null, scopeRelationshipStateId: null, allowSelfValidation: false,
  allowFutureDating: false, allowBackdating: false, ...overrides,
});
const NONE = { status: "NONE", evidenceIds: [] } as const;

test("closed vocabularies are exactly the frozen M16 sets", () => {
  assert.deepEqual([...L14_PERMISSIONS].sort(), [
    "L14_AUTHORITY_POLICY_ADMIN", "L14_AUTHORITY_POLICY_ADMIT", "L14_BUSINESS_CONTEXT_VALIDATE", "L14_CONTROL_APPLICABILITY_VALIDATE",
    "L14_CONTROL_ASSESSMENT_VALIDATE", "L14_CONTROL_DEFINITION_ADMIT", "L14_CONTROL_DEFINITION_VALIDATE", "L14_DOMAIN_ADMIT",
    "L14_DOMAIN_VALIDATE", "L14_PARTY_ADMIT", "L14_PARTY_VALIDATE", "L14_POLICY_APPLICABILITY_VALIDATE", "L14_POLICY_CONTENT_ADMIT",
    "L14_POLICY_VERSION_VALIDATE", "L14_RESPONSIBILITY_VALIDATE"]);
  assert.deepEqual([...L14_REQUESTED_ACTIONS], ["ADMIT", "VALIDATE", "REJECT", "DEFER", "REVOKE"]);
  assert.deepEqual([...L14_SCOPE_TAGS], ["ALL_ALLOWED_TARGETS", "CANONICAL_KIND", "CANONICAL_OBJECT", "RELATIONSHIP_TYPE", "RELATIONSHIP_STATE"]);
  assert.deepEqual([...L14_SOURCE_CLASSES], ["SYSTEM_SEED", "LOCAL_HUMAN", "SOURCE_CONNECTION"]);
  assert.deepEqual([...L14_SOURCE_DISPOSITIONS], ["AUTHORITATIVE", "CONTRIBUTING", "NON_AUTHORITATIVE"]);
  assert.deepEqual([...L14_SUPPORT_STATUSES], ["NONE", "PRESENT"]);
  assert.equal(L14_PROPOSAL_SUBJECT_KINDS.length, 11);
  assert.deepEqual(Object.values(L14_AUTHORITY_POLICY_REASON_CODES),
    ["AUTHORITY_POLICY_VALIDATED", "AUTHORITY_POLICY_REJECTED", "AUTHORITY_POLICY_DEFERRED", "AUTHORITY_POLICY_REVOKED"]);
  assert.deepEqual([...L14_AUTHORIZATION_DENY_REASONS], ["BOOTSTRAP_ROLE_REQUIRED", "BOOTSTRAP_ACTION_NOT_PERMITTED",
    "NO_EFFECTIVE_AUTHORITY", "NO_MATCHING_AUTHORITY_RULE", "SELF_VALIDATION_NOT_PERMITTED", "SOURCE_NOT_AUTHORIZED",
    "SCOPE_NOT_AUTHORIZED", "TEMPORAL_ACTION_NOT_AUTHORIZED", "SUCCESSOR_SELF_AUTHORIZATION_FORBIDDEN"]);
  assert.deepEqual(L14_SQLSTATES, { REPLAY_CONFLICT: "GV007", FINGERPRINT_MISMATCH: "GV008", STALE_EXPECTATION: "GV009",
    INVALID_COMMAND: "GV010", CONTINUITY_VIOLATION: "GV011" });
});

test("the migration CHECK vocabularies match the TypeScript contract", () => {
  const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260929120000_m16_s1a_l14_authority_policy_v1.sql", import.meta.url)), "utf8");
  for (const value of [...L14_PERMISSIONS, ...L14_AUTHORIZATION_DENY_REASONS, ...L14_PROPOSAL_SUBJECT_KINDS,
    ...Object.values(L14_AUTHORITY_POLICY_REASON_CODES), ...Object.values(L14_SQLSTATES).filter(code => code !== "GV011")]) {
    assert.ok(migration.includes(`'${value}'`), `migration lacks ${value}`);
  }
  assert.ok(!/DO INSTEAD NOTHING/i.test(migration.replace(/--.*$/gm, "")), "no silent rule-based immutability");
  assert.ok(!/canonical_relationships\s+(SET|ADD|DROP)|UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships/i.test(migration),
    "F2: no canonical_relationships DDL/DML");
  assert.ok(!/gov_repo\.evidence\b/.test(migration), "no legacy gov_repo.evidence reference");
  assert.ok(!/require_governed_write_eligibility_v1\(/.test(migration.replace(/--.*$/gm, "")), "legacy GV006 guard is not reused");
});

test("the additive S1A.2 migration: no S1A.1 edit, GV011 continuity, no silent immutability, no F2, same three RPC signatures", () => {
  const successor = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260929130000_m16_s1a2_l14_authority_policy_successor_v1.sql", import.meta.url)), "utf8");
  const code = successor.replace(/--.*$/gm, "");
  assert.ok(code.includes("'GV011'") && code.includes("L14_CONTINUITY_VIOLATION"));
  assert.ok(!/DO INSTEAD NOTHING/i.test(code));
  assert.ok(!/canonical_relationships/i.test(code), "F2: the successor migration never touches canonical_relationships");
  assert.ok(!/gov_repo\.evidence\b/.test(code));
  assert.ok(!/require_governed_write_eligibility_v1/.test(code));
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION gov_repo\.l14_(admit_authority_policy_version|submit_proposal|decide_authority_policy_proposal)_v1\(/g) ?? []).length, 3);
  assert.ok(!/CREATE (OR REPLACE )?FUNCTION gov_repo\.l14_\w*(eligibility|governed)/.test(code));
  for (const reason of L14_AUTHORIZATION_DENY_REASONS.filter(r => !r.startsWith("BOOTSTRAP_"))) {
    assert.ok(code.includes(`'${reason}'`), `successor migration lacks ${reason}`);
  }
});

test("the additive S1A.2R1 corrective: recorded-time-aware continuity, closed F-2 error, obsolete helper dropped, no F2", () => {
  const corrective = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260929140000_m16_s1a2r1_l14_no_resurrection_v1.sql", import.meta.url)), "utf8");
  const code = corrective.replace(/--.*$/gm, "");
  for (const detail of ["BACKDATED_REVOKE_WOULD_RESURRECT", "EFFECTIVE_INSTANT_ALREADY_USED", "NO_EFFECTIVE_AUTHORITY_AT_CUTOVER"]) {
    assert.ok(code.includes(`'${detail}'`), detail);
  }
  assert.ok(code.includes("DROP FUNCTION gov_repo.l14_authority_policy_schedule_continuous_v1("));
  assert.ok(code.includes("v.effective_from > r.revoked_recorded_at"), "cancellation depends on the tombstone's recorded_at");
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION gov_repo\.l14_\w+_v1\(/g) ?? []).length, 1, "only the decide RPC body is replaced");
  assert.ok(!/canonical_relationships|DO INSTEAD NOTHING/i.test(code));
});

test("content hash is deterministic, order-independent, UTF-8 byte ordered, and rejects duplicates/unknown values", () => {
  const rules = [rule(), rule({ permission: "L14_AUTHORITY_POLICY_ADMIT", requestedAction: "ADMIT" }),
    rule({ roleId: "44444444-4444-4444-8444-444444444444", permission: "L14_PARTY_VALIDATE", scopeTag: "CANONICAL_OBJECT",
      scopeCanonicalKind: "AGENT", scopeCanonicalObjectId: "canonical-object:é-ü-😀" })];
  const hash = authorityPolicyContentHash(rules);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(authorityPolicyContentHash([...rules].reverse()), hash);
  assert.notEqual(authorityPolicyContentHash([...rules.slice(0, 2), { ...rules[2]!, allowBackdating: true }]), hash);
  assert.notEqual(authorityPolicyContentHash([]), authorityPolicyContentHash([rule()]));
  assert.ok(authorityPolicyRuleFrame(rule()).includes("1:N"), "absent operands are framed explicitly");
  assert.throws(() => authorityPolicyContentHash([rule(), rule()]), L14ContractError);
  for (const bad of [
    { permission: "*.*.*" }, { requestedAction: "APPROVE" }, { scopeTag: "EVERYTHING" },
    { scopeTag: "CANONICAL_KIND" }, { requestedAction: "ADMIT" }, { scopeTag: "CANONICAL_KIND", scopeCanonicalKind: "AGENT" },
    { permission: "L14_AUTHORITY_POLICY_ADMIT", requestedAction: "ADMIT", allowSelfValidation: true },
    { roleId: ADMIN.toUpperCase() }, { scopeCanonicalKind: "POLICY", scopeTag: "CANONICAL_KIND" },
  ] as Array<Partial<L14AuthorityPolicyRule>>) {
    assert.throws(() => authorityPolicyRuleFrame(rule(bad)), L14ContractError, JSON.stringify(bad));
  }
});

test("support framing: NONE is exactly empty; PRESENT sorted by bytes; malformed rejected", () => {
  assert.deepEqual(supportParts(NONE), ["NONE", "0"]);
  assert.deepEqual(supportParts({ status: "PRESENT", evidenceIds: ["b", "a", "é"] }), ["PRESENT", "3", "a", "b", "é"]);
  for (const bad of [{ status: "NONE", evidenceIds: ["a"] }, { status: "PRESENT", evidenceIds: [] },
    { status: "PRESENT", evidenceIds: ["a", "a"] }, { status: "MAYBE", evidenceIds: [] }, { status: "PRESENT", evidenceIds: [" a"] }]) {
    assert.throws(() => supportParts(bad as never), L14ContractError);
  }
});

test("command fingerprints distinguish every semantic input, absence vs presence, and IMMEDIATE vs explicit time", () => {
  const admit = { organisationId: ORG, actorUserId: ACTOR, expected: null, sourceClass: "LOCAL_HUMAN" as const, rules: [rule()], support: NONE };
  const base = admitAuthorityPolicyVersionFingerprint(admit);
  assert.equal(admitAuthorityPolicyVersionFingerprint({ ...admit, organisationId: ORG.toUpperCase() }), base, "UUID text canonicalised");
  for (const variant of [{ actorUserId: ADMIN }, { expected: { authorityPolicyId: ADMIN, latestVersionId: ACTOR } },
    { sourceClass: "SYSTEM_SEED" as const }, { rules: [rule({ allowSelfValidation: true })] },
    { support: { status: "PRESENT" as const, evidenceIds: ["e"] } }]) {
    assert.notEqual(admitAuthorityPolicyVersionFingerprint({ ...admit, ...variant }), base, JSON.stringify(variant));
  }
  const proposal = { subjectKind: "AUTHORITY_POLICY_VERSION" as const, intent: "VALIDATE" as const, sourceClass: "LOCAL_HUMAN" as const,
    authorityPolicyId: ADMIN, versionId: ACTOR, contentHash: "a".repeat(64), requestedEffectiveFrom: null, targetStateId: null };
  const submit = submitProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: null, support: NONE });
  assert.notEqual(submitProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: { ...proposal, requestedEffectiveFrom: "2030-01-01T00:00:00.000000Z" }, priorProposalId: null, support: NONE }), submit);
  assert.notEqual(submitProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: ADMIN, support: NONE }), submit);
  assert.throws(() => submitProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    proposal: { ...proposal, requestedEffectiveFrom: "2030-01-01T00:00:00Z" }, priorProposalId: null, support: NONE }), L14ContractError,
    "explicit time must be canonical UTC microseconds, never a re-sampled clock");
  const decide = { organisationId: ORG, actorUserId: ACTOR, outcome: "VALIDATE" as const, proposalId: ADMIN, proposal,
    expectedCurrentStateId: null, support: NONE };
  const decided = decideProposalFingerprint(decide);
  assert.notEqual(decideProposalFingerprint({ ...decide, outcome: "DEFER" }), decided);
  assert.notEqual(decideProposalFingerprint({ ...decide, expectedCurrentStateId: ACTOR }), decided);
  assert.equal(new Set([base, submit, decided]).size, 3, "operations never collide");
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let adapter: typeof import("@/lib/governance/l14-authority-policy-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
let governedWriteErrorResponse: typeof import("@/lib/governance/governed-write-errors").governedWriteErrorResponse;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "ADMIT_AUTHORITY_POLICY_VERSION", outcome: "ADMITTED",
  command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null, proposal_id: null,
  governance_decision_id: null, authority_policy_id: "p", version_id: "v", content_hash: "c".repeat(64), state_id: null,
  effective_from: null, recorded_at: "2026-09-29T00:00:00.000001+00:00" };

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
    return Response.json([RESULT_ROW], { status: 200 });
  });
  adapter = await import("@/lib/governance/l14-authority-policy-persistence");
  ({ GovernedWriteError, governedWriteErrorResponse } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names, five verified principal values verbatim, TS fingerprint assertion, no role/email", async () => {
  calls = []; nextError = null;
  const result = await adapter.admitAuthorityPolicyVersion(PRINCIPAL, { commandId: "cmd", expected: null, sourceClass: "LOCAL_HUMAN", rules: [rule()], support: NONE });
  assert.equal(result.outcome, "ADMITTED");
  assert.equal(result.recordedAt, RESULT_ROW.recorded_at);
  const proposal = { subjectKind: "AUTHORITY_POLICY_VERSION" as const, intent: "VALIDATE" as const, sourceClass: "LOCAL_HUMAN" as const,
    authorityPolicyId: ADMIN, versionId: ACTOR, contentHash: "a".repeat(64), requestedEffectiveFrom: null, targetStateId: null };
  await adapter.submitAuthorityPolicyProposal(PRINCIPAL, { commandId: "s", proposal, priorProposalId: null, support: NONE });
  await adapter.decideAuthorityPolicyProposal(PRINCIPAL, { commandId: "d", proposalId: ADMIN, proposal, outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual(calls.map(call => call.name),
    ["l14_admit_authority_policy_version_v1", "l14_submit_proposal_v1", "l14_decide_authority_policy_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.match(String(call.args.p_caller_fingerprint), /^[0-9a-f]{64}$/);
    assert.ok(!Object.keys(call.args).some(key => /role|email|actor_reference/i.test(key) && !key.startsWith("p_verified")));
  }
  assert.equal(calls[0]!.args.p_caller_fingerprint, admitAuthorityPolicyVersionFingerprint({ organisationId: ORG, actorUserId: ACTOR,
    expected: null, sourceClass: "LOCAL_HUMAN", rules: [rule()], support: NONE }));
  assert.equal(calls[2]!.args.p_reason_code, "AUTHORITY_POLICY_VALIDATED");
});

test("adapter preserves typed SQLSTATEs (GV007-GV010, GV001-GV005, 55P03); S1A.1 adds no HTTP mapping for GV007-GV011", async () => {
  for (const code of ["GV007", "GV008", "GV009", "GV010", "GV001", "GV003", "55P03"]) {
    calls = []; nextError = { code, message: `db ${code}` };
    await assert.rejects(adapter.admitAuthorityPolicyVersion(PRINCIPAL, { commandId: "e", expected: null, sourceClass: "LOCAL_HUMAN", rules: [rule()], support: NONE }),
      (error: unknown) => { assert.ok(error instanceof GovernedWriteError); assert.equal((error as InstanceType<typeof GovernedWriteError>).code, code); return true; });
  }
  nextError = null;
  for (const code of ["GV007", "GV008", "GV009", "GV010", "GV011"]) {
    assert.equal(governedWriteErrorResponse(new GovernedWriteError("x", code)), undefined, `${code} must not gain an HTTP mapping in S1A.1`);
  }
});

test("no HTTP route or UI consumes the L14 adapter in S1A.1", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-authority-policy-persistence.ts")
        && readFileSync(path, "utf8").includes("l14-authority-policy-persistence")) offenders.push(path);
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});
