import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { L14_CONFLICT_READ_OUTCOMES } from "@council/canonical-contracts";

/**
 * M16 read-projection closure (O32 / O41) — migration-text invariants and the server-only read adapter, without a database. The
 * PG17 suites (tests/postgres-m16/l14-read-projection*.test.ts) prove the same properties on the live catalog.
 */
const MIGRATION = "20261012120000_m16_read_projection_closure_v1.sql";
const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const migration = repo(`supabase/migrations/${MIGRATION}`);
const code = migration.replace(/--.*$/gm, "");
const executable = code.replace(/'[^']*'/g, "").replace(/COMMENT ON[\s\S]*?;/g, "").replace(/DO \$(preflight|postflight)\$[\s\S]*?\$\1\$;/g, "");
const body = (tag: string) => {
  const start = migration.indexOf(`AS $${tag}$`);
  assert.ok(start > 0, tag);
  return migration.slice(start, migration.indexOf(`$${tag}$;`, start + 1));
};

test("migration is additive and read-only: no store, no grant on authority tables, no write, F2 untouched, historical migrations unchanged", () => {
  assert.equal((executable.match(/CREATE FUNCTION/g) ?? []).length, 2, "exactly the two projections");
  assert.doesNotMatch(executable, /CREATE (TABLE|VIEW|MATERIALIZED|SEQUENCE|TYPE|TRIGGER|INDEX|POLICY|SCHEMA)|ALTER TABLE|CREATE OR REPLACE|DROP /i);
  assert.doesNotMatch(executable, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|ALL)/i, "no table privilege is granted");
  assert.deepEqual([...executable.matchAll(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO\s+(\w+);/g)].map(m => m[1]), ["service_role"]);
  assert.match(executable, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/);
  assert.doesNotMatch(executable, /canonical_relationships/, "F2 untouched");
  for (const tag of ["read_passport", "read_conflict"]) {
    const text = body(tag).replace(/--.*$/gm, "");
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY|EXECUTE)\b|FOR (UPDATE|SHARE)|advisory/i, `${tag} writes or locks`);
    assert.doesNotMatch(text, /_heads\b|\bagents\b|\bbusiness_domain\b|\bowner_(user_id|name|email|id)\b|\bcg_(ag|sys)_|governance_policies|policy_versions/,
      `${tag} reads a head / legacy / policy content surface`);
    assert.doesNotMatch(text, /confidence|score|coverage|risk|llm|scanner|recency/i, `${tag} ranks or scores`);
    assert.ok(text.indexOf("PERFORM 1 FROM gov_repo.l14_session_basis_v1(p_verified_organisation_id") < text.indexOf("RETURN QUERY"),
      `${tag} revalidates the verified session before reading`);
  }
  assert.match(migration, /SECURITY DEFINER\nSET search_path = pg_catalog, pg_temp\nSET lock_timeout = '5s'\nAS \$read_passport\$/);
  assert.match(migration, /SECURITY DEFINER\nSET search_path = pg_catalog, pg_temp\nSET lock_timeout = '5s'\nAS \$read_conflict\$/);
  // The conflict vocabulary in SQL is exactly the closed TypeScript one.
  assert.deepEqual([...new Set([...body("read_conflict").matchAll(/'(RESOLVED|CONFLICT|INSUFFICIENT_EVIDENCE)'/g)].map(m => m[1]))].sort(),
    [...L14_CONFLICT_READ_OUTCOMES].sort());
  // No ranking: proposals are ordered by the opaque proposal id only.
  assert.match(body("read_conflict"), /ORDER BY x\.c_ord, x\.c_proposal;\s*END;\s*$/);
});

type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let nextBody: unknown = null;
let nextError: { code?: string; message: string } | null = null;
let read: typeof import("@/lib/governance/passport-governance-read");
const PRINCIPAL = Object.freeze({ organisationId: "22222222-2222-4222-8222-222222222222", actorUserId: "33333333-3333-4333-8333-333333333333",
  issuedAtSeconds: 1_800_000_000, expiresAtSeconds: 1_800_028_800, credentialEpoch: "2026-09-25T00:00:00.000001+00:00" });
before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const { mock } = await import("node:test");
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    assert.match(url.pathname, /^\/rest\/v1\/rpc\//, "only RPC reads");
    calls.push({ name: url.pathname.replace(/^\/rest\/v1\/rpc\//, ""), args: JSON.parse(await request.text()) });
    if (nextError) return Response.json(nextError, { status: 400 });
    return Response.json(nextBody ?? [], { status: 200 });
  });
  read = await import("@/lib/governance/passport-governance-read");
});
const at = "2026-10-12T00:00:00+00:00";
const outcomeRow = (outcome: string, live: number, distinct: number) => ({ conflict_outcome: outcome, row_kind: "OUTCOME",
  subject_kind: "BUSINESS_CONTEXT_ASSIGNMENT", live_proposal_count: live, distinct_content_count: distinct, read_effective_at: at, read_recorded_cutoff: at });
const proposalRow = (outcome: string, id: string, digest: string) => ({ conflict_outcome: outcome, row_kind: "LIVE_PROPOSAL",
  subject_kind: "BUSINESS_CONTEXT_ASSIGNMENT", proposal_id: id, proposal_submitted_at: at, proposal_source_class: "LOCAL_HUMAN",
  proposal_support_status: "NONE", proposal_support_evidence_ids: [], proposal_deferred: false, asserted_content_digest: digest });
const KEY = { subjectKind: "BUSINESS_CONTEXT_ASSIGNMENT", targetCanonicalKind: "AGENT", targetCanonicalObjectId: "agent", semanticKind: "BUSINESS_DOMAIN" } as const;

test("conflict adapter: verified principal verbatim; exact typed key operands (others NULL); closed outcomes; no ranking", async () => {
  calls = []; nextError = null;
  nextBody = [outcomeRow("CONFLICT", 2, 2), proposalRow("CONFLICT", "p1", "d1"), proposalRow("CONFLICT", "p2", "d2")];
  const result = await read.readFactConflict(PRINCIPAL, KEY);
  assert.deepEqual([result.outcome, result.liveProposalCount, result.distinctContentCount, result.governedFact, result.liveProposals.map(p => p.proposalId)],
    ["CONFLICT", 2, 2, null, ["p1", "p2"]]);
  assert.equal(calls[0].name, "l14_read_fact_conflict_v1");
  assert.deepEqual(calls[0].args, { p_verified_organisation_id: PRINCIPAL.organisationId, p_verified_actor_user_id: PRINCIPAL.actorUserId,
    p_verified_session_iat: PRINCIPAL.issuedAtSeconds, p_verified_session_exp: PRINCIPAL.expiresAtSeconds, p_verified_credential_epoch: PRINCIPAL.credentialEpoch,
    p_subject_kind: "BUSINESS_CONTEXT_ASSIGNMENT", p_target_type: "CANONICAL_OBJECT", p_target_canonical_kind: "AGENT", p_target_canonical_object_id: "agent",
    p_target_relationship_id: null, p_target_relationship_state_id: null, p_responsibility_role: null, p_governance_party_id: null,
    p_semantic_kind: "BUSINESS_DOMAIN", p_policy_id: null, p_control_definition_id: null, p_control_applicability_state_id: null,
    p_effective_at: null, p_recorded_cutoff: null });
  assert.ok(!("winner" in result) && result.liveProposals.every(p => !("rank" in p)));
  calls = [];
  nextBody = [{ ...outcomeRow("INSUFFICIENT_EVIDENCE", 0, 0), subject_kind: "CONTROL_ASSESSMENT" }];
  await read.readFactConflict(PRINCIPAL, { subjectKind: "CONTROL_ASSESSMENT", controlApplicabilityStateId: "state:1" });
  assert.deepEqual([calls[0].args.p_target_type, calls[0].args.p_control_applicability_state_id, calls[0].args.p_policy_id], [null, "state:1", null]);
  calls = [];
  nextBody = [{ ...outcomeRow("INSUFFICIENT_EVIDENCE", 0, 0), subject_kind: "POLICY_APPLICABILITY" }];
  await read.readFactConflict(PRINCIPAL, { subjectKind: "POLICY_APPLICABILITY", definitionId: "policy:1",
    target: { targetType: "RELATIONSHIP_STATE", relationshipId: "rel", relationshipStateId: "rel:state" } });
  assert.deepEqual([calls[0].args.p_target_type, calls[0].args.p_target_relationship_id, calls[0].args.p_target_relationship_state_id,
    calls[0].args.p_target_canonical_kind, calls[0].args.p_policy_id, calls[0].args.p_control_definition_id],
    ["RELATIONSHIP_STATE", "rel", "rel:state", null, "policy:1", null]);
});

test("conflict adapter fails closed on any shape outside the closed contract (never fabricates a winner)", async () => {
  nextError = null;
  for (const body of [
    [],                                                                                                 // no OUTCOME row
    [outcomeRow("WINNER", 1, 1)],                                                                       // open vocabulary
    [outcomeRow("CONFLICT", 1, 1), proposalRow("CONFLICT", "p1", "d1")],                               // CONFLICT needs >= 2 proposals
    [outcomeRow("RESOLVED", 0, 0)],                                                                     // RESOLVED without the fact
    [outcomeRow("INSUFFICIENT_EVIDENCE", 1, 1), proposalRow("CONFLICT", "p1", "d1")],                  // mixed outcomes
    [{ ...outcomeRow("INSUFFICIENT_EVIDENCE", 0, 0), subject_kind: "POLICY_APPLICABILITY" }],           // another family
  ]) {
    nextBody = body;
    await assert.rejects(read.readFactConflict(PRINCIPAL, KEY), /PASSPORT_GOVERNANCE_ROW_INVALID/, JSON.stringify(body));
  }
  nextError = { code: "GV003", message: "ineligible" };
  await assert.rejects(read.readFactConflict(PRINCIPAL, KEY), /PASSPORT_GOVERNANCE_READ_FAILED/);
  nextError = null;
});

test("the conflict adapter has no HTTP route / UI consumer in this slice; the Passport adapter is consumed only by the Passport query", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const consumers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith("passport-governance-read.ts")) {
        const text = readFileSync(path, "utf8");
        if (/passport-governance-read|l14_read_(passport_governance|fact_conflict)_v1|readFactConflict/.test(text)) consumers.push(path.slice(root.length));
      }
    }
  };
  walk(`${root}app`); walk(`${root}lib`); walk(`${root}components`);
  assert.deepEqual(consumers, ["lib/governance/passport-query.ts"]);
  assert.doesNotMatch(readFileSync(`${root}lib/governance/passport-query.ts`, "utf8"), /readFactConflict/);
});
