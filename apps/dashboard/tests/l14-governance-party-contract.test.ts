import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  L14_GOVERNANCE_PARTY_KINDS, L14_PARTY_PROFILE_ERASURE_STATES, L14_PARTY_PROFILE_PII_FIELDS, L14_REGISTRY_REASON_CODES,
  type L14GovernancePartyProposalContent,
} from "@council/canonical-contracts";
import {
  L14ContractError, admitGovernancePartyFingerprint, decideGovernancePartyProposalFingerprint, governancePartyContentHash,
  governancePartyReasonCode, submitGovernancePartyProposalFingerprint,
} from "@council/governance-review";

/**
 * M16-S1B.1 — closed GovernanceParty contract + TypeScript fingerprint mirror + server-only
 * persistence adapter + migration-text invariants, without a database. The PG17 suites
 * (tests/postgres-m16/l14-governance-party*.test.ts) prove PostgreSQL computes identical values.
 */
const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260930130000_m16_s1b1_l14_governance_party_v1.sql", import.meta.url)), "utf8");
const code = migration.replace(/--.*$/gm, "");
const noStrings = code.replace(/'[^']*'/g, "");
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const PARTY = "44444444-4444-4444-8444-444444444444";
const STATE = "55555555-5555-4555-8555-555555555555";
const NONE = { status: "NONE", evidenceIds: [] } as const;
const proposal: L14GovernancePartyProposalContent = { intent: "VALIDATE", sourceClass: "LOCAL_HUMAN", governancePartyId: PARTY, partyKind: "PERSON",
  requestedEffectiveFrom: null, targetStateId: null };

test("closed Party vocabularies are exactly the frozen sets and match the migration CHECKs", () => {
  assert.deepEqual([...L14_GOVERNANCE_PARTY_KINDS], ["PERSON", "GROUP", "ORGANISATIONAL_UNIT"]);
  assert.deepEqual([...L14_PARTY_PROFILE_ERASURE_STATES], ["ACTIVE", "PSEUDONYMISED", "ERASED"]);
  assert.deepEqual([...L14_PARTY_PROFILE_PII_FIELDS], ["display_name", "email", "phone", "profile_text", "governance_user_id", "external_identity_ref"]);
  for (const value of [...L14_GOVERNANCE_PARTY_KINDS, ...L14_PARTY_PROFILE_ERASURE_STATES, ...Object.values(L14_REGISTRY_REASON_CODES.GOVERNANCE_PARTY),
    "ADMIT_GOVERNANCE_PARTY", "L14_PARTY_ADMIT", "L14_PARTY_VALIDATE", "L14_GOVERNANCE_PARTY_CONTENT_V1", "EXPECTED_NONE",
    "REVOKE_NOT_AFTER_TARGET_EFFECTIVE", "REVALIDATION_OVERLAPS_PRIOR_INTERVAL", "PARTY_ALREADY_VALIDATED", "TARGET_ALREADY_REVOKED"]) {
    assert.ok(code.includes(`'${value}'`), `migration lacks ${value}`);
  }
  for (const field of L14_PARTY_PROFILE_PII_FIELDS) {
    assert.ok(new RegExp(`^  ${field} (text|uuid)`, "m").test(code), `${field} exists only as a profile column`);
  }
  assert.equal(governancePartyReasonCode("REVOKE"), "GOVERNANCE_PARTY_REVOKED");
});

test("Party fingerprints distinguish every semantic input, never collide across operations, and refuse shape-invalid content", () => {
  const admit = { organisationId: ORG, actorUserId: ACTOR, partyKind: "PERSON" as const, sourceClass: "LOCAL_HUMAN" as const, support: NONE };
  const base = admitGovernancePartyFingerprint(admit);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(admitGovernancePartyFingerprint({ ...admit, actorUserId: ACTOR.toUpperCase() }), base, "UUID text canonicalised");
  for (const variant of [{ organisationId: PARTY }, { actorUserId: PARTY }, { partyKind: "GROUP" as const }, { sourceClass: "SYSTEM_SEED" as const },
    { support: { status: "PRESENT" as const, evidenceIds: ["e"] } }]) {
    assert.notEqual(admitGovernancePartyFingerprint({ ...admit, ...variant }), base, JSON.stringify(variant));
  }
  assert.throws(() => admitGovernancePartyFingerprint({ ...admit, partyKind: "ROBOT" as never }), L14ContractError);
  const submit = submitGovernancePartyProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: null, support: NONE });
  for (const variant of [{ partyKind: "GROUP" as const }, { governancePartyId: STATE }, { requestedEffectiveFrom: "2030-01-01T00:00:00.000000Z" },
    { intent: "REVOKE" as const, targetStateId: STATE }]) {
    assert.notEqual(submitGovernancePartyProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: { ...proposal, ...variant },
      priorProposalId: null, support: NONE }), submit, JSON.stringify(variant));
  }
  assert.notEqual(submitGovernancePartyProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal, priorProposalId: STATE, support: NONE }), submit);
  for (const bad of [{ targetStateId: STATE }, { intent: "REVOKE" as const }, { requestedEffectiveFrom: "2030-01-01T00:00:00Z" }, { partyKind: "ROBOT" as never }]) {
    assert.throws(() => submitGovernancePartyProposalFingerprint({ organisationId: ORG, actorUserId: ACTOR, proposal: { ...proposal, ...bad },
      priorProposalId: null, support: NONE }), L14ContractError, JSON.stringify(bad));
  }
  const decide = { organisationId: ORG, actorUserId: ACTOR, outcome: "VALIDATE" as const, proposalId: STATE, proposal, expectedCurrentStateId: null, support: NONE };
  const decided = decideGovernancePartyProposalFingerprint(decide);
  assert.notEqual(decideGovernancePartyProposalFingerprint({ ...decide, outcome: "DEFER" }), decided);
  assert.notEqual(decideGovernancePartyProposalFingerprint({ ...decide, expectedCurrentStateId: PARTY }), decided);
  assert.equal(new Set([base, submit, decided]).size, 3, "operations never collide");
  assert.match(governancePartyContentHash("PERSON"), /^[0-9a-f]{64}$/);
  assert.notEqual(governancePartyContentHash("PERSON"), governancePartyContentHash("GROUP"));
  // The fingerprint inputs are structurally PII-free: no field for a name, email, phone, profile or mapping exists.
  assert.deepEqual(Object.keys(admit).sort(), ["actorUserId", "organisationId", "partyKind", "sourceClass", "support"]);
  assert.deepEqual(Object.keys(proposal).sort(), ["governancePartyId", "intent", "partyKind", "requestedEffectiveFrom", "sourceClass", "targetStateId"]);
});

test("the additive S1B.1 migration: one transaction, no replaced routine, only the three Party RPC grants, no JSON, no F2, no hosted target", () => {
  assert.equal((code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal((code.match(/CREATE OR REPLACE/gi) ?? []).length, 0, "no existing routine is replaced");
  assert.ok(!/CREATE (OR REPLACE )?FUNCTION gov_repo\.l14_(admit_authority_policy_version|submit_proposal|decide_authority_policy_proposal|parse_authority_policy_rules|evaluate_authority_rules|snapshot_policy_rules|support_syntactic_parts|resolve_support|lock_registry_subject_guard|lock_authority_policy_guard_shared)_v1/.test(code));
  assert.deepEqual(noStrings.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)?.map(g => g.match(/gov_repo\.(\w+)\(/g)), [[
    "gov_repo.l14_admit_governance_party_v1(", "gov_repo.l14_submit_governance_party_proposal_v1(", "gov_repo.l14_decide_governance_party_proposal_v1("]]);
  assert.equal((noStrings.match(/\bGRANT\b/g) ?? []).length, 1, "exactly one GRANT statement");
  assert.equal((code.match(/SECURITY DEFINER/g) ?? []).length, 3, "exactly the three Party RPCs are definers");
  assert.ok(!/\bjsonb?\b/i.test(noStrings.replace(/'json'::regtype, 'jsonb'::regtype/g, "")), "no JSON column / JSON transport");
  assert.ok(!/DO INSTEAD NOTHING/i.test(code));
  assert.ok(!/canonical_relationships\s+(SET|ADD|DROP)|UPDATE\s+gov_repo\.canonical_relationships|DELETE\s+FROM\s+gov_repo\.canonical_relationships|ALTER\s+TABLE\s+gov_repo\.canonical_relationships|REFERENCES\s+gov_repo\.canonical_relationships/i.test(code));
  assert.ok(!/gov_repo\.evidence\b/.test(code));
  assert.ok(!/require_governed_write_eligibility_v1|SYSTEM_BOOTSTRAP_L14_AUTHORITY_V1|has_bootstrap_role/.test(code), "no legacy GV006 guard, no bootstrap");
  for (const table of ["governance_policies", "policy_versions", "policy_mandate_mappings"]) assert.ok(!new RegExp(`gov_repo\\.${table}\\b`).test(code), table);
  assert.deepEqual(code.match(/ALTER TABLE gov_repo\.governance_users[\s\S]*?;/g), [
    "ALTER TABLE gov_repo.governance_users\n  ADD CONSTRAINT governance_users_organisation_user_unique UNIQUE (organisation_id, user_id);"],
    "governance_users only gains the tenant-consistent candidate key");
  const admitSignature = migration.slice(migration.indexOf("CREATE FUNCTION gov_repo.l14_admit_governance_party_v1("), migration.indexOf("RETURNS TABLE", migration.indexOf("CREATE FUNCTION gov_repo.l14_admit_governance_party_v1(")));
  assert.ok(!admitSignature.includes("p_governance_party_id"), "ADMIT takes no caller Party id");
  assert.ok(!/p_(display_name|email|phone|profile_text|external_identity_ref|governance_user_id)\b/.test(code), "no RPC parameter can carry PII");
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com)/i.test(migration), "no hosted database / OpenAI reference");
});

// ---------------------------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;
let adapter: typeof import("@/lib/governance/l14-governance-party-persistence");
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
const RESULT_ROW = { replay: false, command_id: "cmd", command_kind: "ADMIT_GOVERNANCE_PARTY", subject_kind: "GOVERNANCE_PARTY", outcome: "ADMITTED",
  command_fingerprint: "f".repeat(64), authorization_decision_id: "a", authorization_result: "ALLOW", deny_reason: null, proposal_id: null,
  governance_decision_id: null, governance_party_id: PARTY, party_kind: "PERSON", registry_state_id: null, state_kind: null, effective_from: null,
  recorded_at: "2026-09-30T00:00:00.000001+00:00" };

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
  adapter = await import("@/lib/governance/l14-governance-party-persistence");
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});

const PRINCIPAL = Object.freeze({ organisationId: ORG, actorUserId: ACTOR, issuedAtSeconds: 1_800_000_000,
  expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
const PRINCIPAL_KEYS = ["p_verified_organisation_id", "p_verified_actor_user_id", "p_verified_session_iat",
  "p_verified_session_exp", "p_verified_credential_epoch"];

test("adapter: exact RPC names, five verified principal values first and verbatim, TS fingerprint, no caller Party id on ADMIT, no PII/role/email", async () => {
  calls = []; nextError = null;
  const result = await adapter.admitGovernanceParty(PRINCIPAL, { commandId: "cmd", partyKind: "PERSON", sourceClass: "LOCAL_HUMAN", support: NONE });
  assert.deepEqual([result.outcome, result.governancePartyId, result.subjectKind, result.partyKind], ["ADMITTED", PARTY, "GOVERNANCE_PARTY", "PERSON"]);
  await adapter.submitGovernancePartyProposal(PRINCIPAL, { commandId: "s", proposal, priorProposalId: null, support: NONE });
  await adapter.decideGovernancePartyProposal(PRINCIPAL, { commandId: "d", proposalId: STATE, proposal, outcome: "VALIDATE", expectedCurrentStateId: null, support: NONE });
  assert.deepEqual(calls.map(call => call.name),
    ["l14_admit_governance_party_v1", "l14_submit_governance_party_proposal_v1", "l14_decide_governance_party_proposal_v1"]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args).slice(0, 5), PRINCIPAL_KEYS, "the five verified principal values come first");
    assert.deepEqual(PRINCIPAL_KEYS.map(key => call.args[key]),
      [PRINCIPAL.organisationId, PRINCIPAL.actorUserId, PRINCIPAL.issuedAtSeconds, PRINCIPAL.expiresAtSeconds, PRINCIPAL.credentialEpoch]);
    assert.match(String(call.args.p_caller_fingerprint), /^[0-9a-f]{64}$/);
    assert.ok(!Object.keys(call.args).some(key => /role|email|name|phone|profile|external|governance_user/i.test(key)), JSON.stringify(Object.keys(call.args)));
  }
  assert.ok(!("p_governance_party_id" in calls[0]!.args), "PostgreSQL mints the Party id");
  assert.equal(calls[0]!.args.p_expectation_kind, "EXPECTED_NONE");
  assert.equal(calls[0]!.args.p_caller_fingerprint, admitGovernancePartyFingerprint({ organisationId: ORG, actorUserId: ACTOR, partyKind: "PERSON",
    sourceClass: "LOCAL_HUMAN", support: NONE }));
  assert.equal(calls[1]!.args.p_governance_party_id, PARTY);
  assert.equal(calls[2]!.args.p_reason_code, "GOVERNANCE_PARTY_VALIDATED");
});

test("adapter preserves typed SQLSTATEs (GV001-GV011, 55P03); a DENY is a result, not an error", async () => {
  for (const sqlstate of ["GV007", "GV008", "GV009", "GV010", "GV011", "GV001", "GV002", "GV003", "55P03"]) {
    calls = []; nextError = { code: sqlstate, message: `db ${sqlstate}` };
    await assert.rejects(adapter.admitGovernanceParty(PRINCIPAL, { commandId: "e", partyKind: "GROUP", sourceClass: "LOCAL_HUMAN", support: NONE }),
      (error: unknown) => { assert.ok(error instanceof GovernedWriteError); assert.equal((error as InstanceType<typeof GovernedWriteError>).code, sqlstate); return true; });
  }
  nextError = null;
});

test("no HTTP route or UI consumes the Party adapter in S1B.1; no profile write surface exists in the app", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("l14-governance-party-persistence.ts")) {
        const text = readFileSync(path, "utf8");
        if (text.includes("l14-governance-party-persistence") || text.includes("governance_party_directory_profiles")) offenders.push(path);
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(offenders, []);
});

test("the additive S1B.1R1 corrective: only the state guard and the decide RPC are replaced (same signatures); equality legal; no other surface", () => {
  const r1 = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260930140000_m16_s1b1r1_governance_party_pending_cancel_v1.sql", import.meta.url)), "utf8");
  const r1Code = r1.replace(/--.*$/gm, "");
  const r1NoStrings = r1Code.replace(/'[^']*'/g, "");
  assert.equal((r1Code.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((r1Code.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.deepEqual(r1Code.match(/CREATE (OR REPLACE )?FUNCTION gov_repo\.\w+/g),
    ["CREATE OR REPLACE FUNCTION gov_repo.l14_governance_party_state_guard_v1", "CREATE OR REPLACE FUNCTION gov_repo.l14_decide_governance_party_proposal_v1"]);
  assert.ok(!/\b(CREATE|ALTER|DROP) (TABLE|INDEX|TRIGGER|VIEW|SEQUENCE)\b/i.test(r1NoStrings), "no DDL beyond the two replaced routines");
  assert.equal((r1NoStrings.match(/\bGRANT\b/g) ?? []).length, 1);
  assert.ok(/GRANT EXECUTE ON FUNCTION\s+gov_repo\.l14_decide_governance_party_proposal_v1\(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text\[\], text\)\s+TO service_role;/.test(r1Code));
  assert.equal((r1Code.match(/SECURITY DEFINER/g) ?? []).length, 1, "only the (existing) decide RPC is a definer");
  assert.ok(r1Code.includes("IF NEW.state_kind = 'REVOKED' AND v_envelope.effective_from < v_related_from THEN"));
  assert.ok(r1Code.includes("IF p_outcome = 'REVOKE' AND v_effective_from < v_latest_from THEN"));
  assert.equal((r1Code.match(/DETAIL = 'REVOKE_BEFORE_TARGET_EFFECTIVE'/g) ?? []).length, 2, "both layers raise the same closed detail");
  assert.ok(!/DETAIL = 'REVOKE_NOT_AFTER_TARGET_EFFECTIVE'/.test(r1Code));
  assert.ok(!/canonical_relationships|DO INSTEAD NOTHING|require_governed_write_eligibility_v1/i.test(r1Code));
  assert.ok(!/(postgres(ql)?:\/\/|supabase\.co|api\.openai\.com)/i.test(r1));
  // The audited S1B.1 migration still carries its original (historical) strict rule text.
  assert.ok(code.includes("DETAIL = 'REVOKE_NOT_AFTER_TARGET_EFFECTIVE'"));
});
