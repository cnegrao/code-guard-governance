import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

/**
 * M16-S0.3.3C — application cutover regression.
 *
 * Proves, without a real database, that:
 *  (1) [static] outside the four persistence-adapter files, no production
 *      dashboard source calls any of the six legacy RPC names — the five
 *      HUMAN write surfaces now resolve exclusively to the *_governed_v1
 *      wrapper names (§17, §22 production-caller inventory);
 *  (2) [static] inside each adapter file, the createGoverned* factory's own
 *      source slice calls ONLY the governed RPC name, never the bare legacy
 *      one (the legacy name may still appear elsewhere in the same file —
 *      that is the still-legitimate machine/legacy path this slice does not
 *      touch or revoke);
 *  (3) [runtime, mocked RPC transport] each governed factory calls the exact
 *      governed RPC name with the exact five p_verified_* arguments taken
 *      from the GovernanceWritePrincipal, verbatim — credentialEpoch is the
 *      identical string, never round-tripped through a JS Date (§18), and no
 *      flat actor/organisation column is accepted from the caller;
 *  (4) [runtime] GV001-GV006/55P03/unrecognized-code classification maps to
 *      the frozen HTTP status, and the mapped response body never contains
 *      the raw DB message/DETAIL (§19).
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ADAPTER_FILES = [
  "lib/governance/persistence.ts",
  "lib/governance/materialization.ts",
  "lib/governance/technical-fact-persistence.ts",
  "lib/governance/execution-context-persistence.ts",
];
const LEGACY_RPC_NAMES = [
  "apply_review_transition",
  "record_authorized_reconciliation",
  "materialize_object_reconciliation",
  "materialize_relationship_reconciliation",
  "record_technical_field_decision",
  "record_execution_field_decision",
];
const GOVERNED_RPC_NAMES = LEGACY_RPC_NAMES.map(name => `${name}_governed_v1`);

function listProductionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["tests", "node_modules", ".next", ".git"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listProductionSources(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

test("static: outside the four persistence adapters, no production source calls a legacy RPC name (bare, quoted)", () => {
  const files = listProductionSources(ROOT);
  assert.ok(files.length > 100, "scan must cover the full application");
  const adapterAbsolute = new Set(ADAPTER_FILES.map(f => join(ROOT, f)));
  for (const file of files) {
    if (adapterAbsolute.has(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const legacyName of LEGACY_RPC_NAMES) {
      // Match the exact bare name quoted as an RPC call target, never as a
      // substring of the (always longer) governed name.
      const pattern = new RegExp(`rpc\\(\\s*['"\`]${legacyName}['"\`]`);
      assert.doesNotMatch(source, pattern, `${file} must not call legacy RPC ${legacyName} directly`);
    }
  }
});

test("static: each createGoverned* factory's own source slice calls ONLY the governed RPC name", () => {
  const factories: Array<{ file: string; factory: string; governedName: string; legacyName: string }> = [
    { file: "lib/governance/persistence.ts", factory: "createGovernedReviewPersistence", governedName: "apply_review_transition_governed_v1", legacyName: "apply_review_transition" },
    { file: "lib/governance/materialization.ts", factory: "createGovernedMaterializationPersistence", governedName: "materialize_object_reconciliation_governed_v1", legacyName: "materialize_object_reconciliation" },
    { file: "lib/governance/materialization.ts", factory: "createGovernedMaterializationPersistence", governedName: "materialize_relationship_reconciliation_governed_v1", legacyName: "materialize_relationship_reconciliation" },
    { file: "lib/governance/technical-fact-persistence.ts", factory: "createGovernedTechnicalFactPersistence", governedName: "record_technical_field_decision_governed_v1", legacyName: "record_technical_field_decision" },
    { file: "lib/governance/execution-context-persistence.ts", factory: "createGovernedExecutionContextPersistence", governedName: "record_execution_field_decision_governed_v1", legacyName: "record_execution_field_decision" },
  ];
  for (const { file, factory, governedName, legacyName } of factories) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const start = source.indexOf(`export function ${factory}(`);
    assert.ok(start >= 0, `${file} must export ${factory}`);
    const slice = source.slice(start);
    assert.match(slice, new RegExp(`rpc\\(\\s*['"\`]${governedName}['"\`]`), `${factory} must call ${governedName}`);
    assert.doesNotMatch(slice, new RegExp(`rpc\\(\\s*['"\`]${legacyName}['"\`]`), `${factory} must never call the bare legacy ${legacyName}`);
  }
  // record_authorized_reconciliation_governed_v1 lives inside the SAME override
  // in persistence.ts as apply_review_transition_governed_v1 (one factory
  // overrides both persistReviewTransition and persistAuthorizedReconciliation).
  const persistenceSource = readFileSync(join(ROOT, "lib/governance/persistence.ts"), "utf8");
  const start = persistenceSource.indexOf("export function createGovernedReviewPersistence(");
  const slice = persistenceSource.slice(start);
  assert.match(slice, /rpc\(\s*['"`]record_authorized_reconciliation_governed_v1['"`]/);
  assert.doesNotMatch(slice, /rpc\(\s*['"`]record_authorized_reconciliation['"`]/);
});

test("static: every legacy RPC name still resolves (it is not orphaned/renamed) — sanity for the two static checks above", () => {
  for (const file of ADAPTER_FILES) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const anyLegacyPresent = LEGACY_RPC_NAMES.some(name => source.includes(`'${name}'`) || source.includes(`"${name}"`));
    const anyGovernedPresent = GOVERNED_RPC_NAMES.some(name => source.includes(`'${name}'`) || source.includes(`"${name}"`));
    assert.ok(anyLegacyPresent || anyGovernedPresent, `${file} should reference at least one of the six RPC families`);
  }
});

/**
 * M16-S0.3.3C-R1 (Finding C-R1-01, §14) — the app must never deny a HUMAN
 * write before the governed DB wrapper has had a chance to authorize it.
 * This is a repo-wide scan of the active production HUMAN write call graph —
 * not just route files, and not just RPC names — for the exact anti-pattern
 * the audit found: an authoritative `role !== 'org_admin'` branch, or a
 * `hasGovernanceReviewAuthority(currentRole)` denial, reachable ahead of a
 * governed persistence call. GET/read/UI-only role checks (e.g. review's GET
 * allowedActions) are explicitly out of scope and must not be flagged.
 */
// Write-only production files: the anti-pattern must not appear ANYWHERE in
// the file (there is no GET/read handler in these to carve out an exception for).
const HUMAN_WRITE_ONLY_PRODUCTION_FILES = [
  "app/api/governance/workspace/reviews/[id]/decision/route.ts",
  "app/api/governance/workspace/reviews/[id]/materialize/route.ts",
  "app/api/governance/workspace/technical-facts/route.ts",
  "app/api/governance/workspace/execution-context/route.ts",
  "lib/governance/workspace-commands.ts",
  "lib/governance/decision-commands.ts",
  "lib/governance/multivendor-exchange.ts",
  "lib/governance/execution-context-review.ts",
  "lib/governance/reconciliation-authorization-port.ts",
];
// Mixed GET+PUT route: only its PUT handler is a HUMAN write; its GET may
// legitimately resolve a role for its own allowedActions read-model.
const REVIEW_ROUTE = "app/api/governance/workspace/reviews/[id]/route.ts";

function assertNoWriteAuthorityGate(source: string, label: string) {
  assert.doesNotMatch(source, /hasGovernanceReviewAuthority\s*\(/, `${label}: hasGovernanceReviewAuthority must not gate a write`);
  assert.doesNotMatch(source, /currentRole\s*!==\s*['"]org_admin['"]/, `${label}: no currentRole!=='org_admin' deny`);
  assert.doesNotMatch(source, /role\s*!==\s*['"]org_admin['"]/, `${label}: no role!=='org_admin' deny`);
  assert.doesNotMatch(source, /\bcurrentRole\b/, `${label}: currentRole must not appear at all on this write path`);
}

test("HUMAN write path: no production write handler contains an app-level role-authority deny ahead of the governed DB wrapper", () => {
  for (const file of HUMAN_WRITE_ONLY_PRODUCTION_FILES) {
    assertNoWriteAuthorityGate(readFileSync(join(ROOT, file), "utf8"), file);
  }
  // reviews/[id]/route.ts's GET handler alone may still resolve a role, but
  // only to build the read-model allowedActions — never to gate its PUT.
  const reviewRoute = readFileSync(join(ROOT, REVIEW_ROUTE), "utf8");
  const putIndex = reviewRoute.indexOf("export async function PUT");
  assert.notEqual(putIndex, -1, `${REVIEW_ROUTE} must still export PUT`);
  const putSource = reviewRoute.slice(putIndex);
  assertNoWriteAuthorityGate(putSource, `${REVIEW_ROUTE} (PUT)`);
  assert.doesNotMatch(putSource, /resolveCurrentGovernanceRole/, `${REVIEW_ROUTE} (PUT) must not resolve a role at all`);
});

/**
 * M16-S0.3.3C-R2 — a replay of an already-persisted RELATIONSHIP
 * reconciliation decision must pass through the governed persistence
 * boundary exactly like a first-time decision; it must never short-circuit
 * to REPLAYED before record_authorized_reconciliation_governed_v1 has had a
 * chance to re-check the actor's CURRENT authority. This is bounded to the
 * specific existing-decision branch (not a brittle whole-file token scan)
 * and checks call-before-return ORDER, so a future edit that reintroduces
 * an early `return { kind: "REPLAYED" }` ahead of the governed call is
 * caught even if the call is still present somewhere else in the function.
 */
test("static: a successful RELATIONSHIP reconciliation replay always reaches the governed persistence boundary before REPLAYED is returned", () => {
  const source = readFileSync(join(ROOT, "lib/governance/decision-commands.ts"), "utf8");
  const branchMarker = "RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE) {";
  const branchStart = source.indexOf(branchMarker);
  assert.notEqual(branchStart, -1, "the existing-relationship-decision replay branch must still exist");
  const branchEnd = source.indexOf("Read-before-write concurrency guard", branchStart);
  assert.notEqual(branchEnd, -1, "could not bound the replay branch against the next section");
  const branch = source.slice(branchStart, branchEnd);

  const persistIndex = branch.indexOf("persistAuthorizedReconciliation(");
  const replayIndex = branch.indexOf('kind: "REPLAYED"');
  assert.notEqual(persistIndex, -1, "the existing-decision branch must invoke the governed persistence boundary (persistAuthorizedReconciliation)");
  assert.notEqual(replayIndex, -1, "the existing-decision branch must still return REPLAYED on a successful replay");
  assert.ok(
    persistIndex < replayIndex,
    "REPLAYED must only be returned AFTER the governed persistence boundary has run — a replay must never bypass require_governed_write_eligibility_v1",
  );
});

// ---------------------------------------------------------------------------
// Runtime: exact RPC name + exact p_verified_* args + error classification.
// ---------------------------------------------------------------------------

interface Call { name: string; args: Record<string, unknown> }
let calls: Call[];
let nextError: { code?: string; message: string } | null;
const SUCCESS_ROW = { replay: false, revision: 1, state: "CONFIRMED", status: "APPLIED", canonical_object_id: "c-1",
  mapping_id: "m-1", relationship_id: "r-1", state_id: "s-1", authorization_decision_id: "a-1",
  invocation_id: "i-1", reconciliation_decision_id: "d-1" };

let createGovernedReviewPersistence: typeof import("@/lib/governance/persistence").createGovernedReviewPersistence;
let createGovernedMaterializationPersistence: typeof import("@/lib/governance/materialization").createGovernedMaterializationPersistence;
let createGovernedTechnicalFactPersistence: typeof import("@/lib/governance/technical-fact-persistence").createGovernedTechnicalFactPersistence;
let createGovernedExecutionContextPersistence: typeof import("@/lib/governance/execution-context-persistence").createGovernedExecutionContextPersistence;
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;
let mapGovernedWriteSecurityError: typeof import("@/lib/governance/governed-write-errors").mapGovernedWriteSecurityError;
let governedWriteErrorResponse: typeof import("@/lib/governance/governed-write-errors").governedWriteErrorResponse;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  const { mock } = await import("node:test");
  // persistence.ts's own createGovernedReviewPersistence (and materialization.ts
  // /technical-fact-persistence.ts/execution-context-persistence.ts, which all
  // import the REAL privilegedDb FROM persistence.ts) are the code under test,
  // so none of those modules is mocked; only the network transport underneath
  // the real @supabase/supabase-js client is intercepted — the same technique
  // session-consumer-security.test.ts already uses.
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    assert.match(url.pathname, /^\/rest\/v1\/rpc\//, `unexpected non-RPC request: ${url.pathname}`);
    const name = url.pathname.replace(/^\/rest\/v1\/rpc\//, "");
    const args = JSON.parse(await request.text());
    calls.push({ name, args });
    if (nextError) return Response.json(nextError, { status: 400 });
    return Response.json([SUCCESS_ROW], { status: 200 });
  });
  ({ createGovernedReviewPersistence } = await import("@/lib/governance/persistence"));
  ({ createGovernedMaterializationPersistence } = await import("@/lib/governance/materialization"));
  ({ createGovernedTechnicalFactPersistence } = await import("@/lib/governance/technical-fact-persistence"));
  ({ createGovernedExecutionContextPersistence } = await import("@/lib/governance/execution-context-persistence"));
  ({ GovernedWriteError, mapGovernedWriteSecurityError, governedWriteErrorResponse } = await import("@/lib/governance/governed-write-errors"));
});

const WRITE_PRINCIPAL = Object.freeze({
  organisationId: "11111111-1111-1111-1111-111111111111",
  actorUserId: "22222222-2222-2222-2222-222222222222",
  issuedAtSeconds: 1_700_000_000,
  expiresAtSeconds: 1_700_028_800,
  credentialEpoch: "2026-09-25T00:00:00.000001+00:00",
});

function resetCalls() { calls = []; nextError = null; }

const REVIEW_TRANSITION_RESULT = {
  subject: { organisationId: WRITE_PRINCIPAL.organisationId, reviewSubjectId: "review:1", findingId: "finding:1" },
  event: {
    actor: { authorityKind: "HUMAN", actorReference: WRITE_PRINCIPAL.actorUserId },
    previousState: "PROPOSED", newState: "CONFIRMED", occurredAt: "2026-09-25T00:00:00.000Z",
    evidenceIds: [], reasonCode: undefined, commandId: "cmd:1", eventId: "evt:1",
  },
} as never;

const RECONCILIATION_INPUT = {
  family: "OBJECT",
  authorization: { authorizationDecisionId: "authz:1", actorReference: WRITE_PRINCIPAL.actorUserId,
    subject: { subjectKind: "CANDIDATE", candidateId: "candidate:1" }, requestedAction: "CREATE_NEW",
    evaluatedAt: "2026-09-25T00:00:00.000Z" },
  invocation: { invocationId: "invocation:1", commandId: "cmd:1", commandFingerprint: "fp:1",
    reviewSubjectId: "review:1", actor: { authorityKind: "HUMAN", actorReference: WRITE_PRINCIPAL.actorUserId },
    requestedAt: "2026-09-25T00:00:00.000Z", reasonCode: "reason" },
  decision: { decisionId: "decision:1", organisationId: WRITE_PRINCIPAL.organisationId, outcome: "CREATE_NEW",
    candidateKind: "MODEL", subject: { subjectKind: "CANDIDATE", candidateId: "candidate:1" },
    canonicalObject: { objectId: "canonical-object:1", kind: "MODEL" },
    assertionIds: [], evidenceIds: [], decidedAt: "2026-09-25T00:00:00.000Z" },
} as never;

const OBJECT_MATERIALIZATION_INPUT = {
  organisationId: WRITE_PRINCIPAL.organisationId, reconciliationDecisionId: "decision:1", invocationId: "invocation:1",
  outcome: "CREATE_NEW", canonicalObjectId: "canonical-object:1", canonicalObjectKind: "MODEL",
  sourceConnectionId: "conn-1", sourceExternalType: "source", sourceExternalId: "ext-1",
  matchMethod: "MANUAL", idempotencyFingerprint: "f".repeat(64), occurredAt: "2026-09-25T00:00:00.000Z",
} as never;

const RELATIONSHIP_MATERIALIZATION_INPUT = {
  organisationId: WRITE_PRINCIPAL.organisationId, reconciliationDecisionId: "decision:1", invocationId: "invocation:1",
  outcome: "CREATE_NEW", relationshipId: "canonical-relationship:1", relationshipStateId: "canonical-relationship:1:initial",
  relationshipType: "EXPOSES", sourceCanonicalObjectId: "canonical-object:src", sourceKind: "MCP_SERVER",
  targetCanonicalObjectId: "canonical-object:tgt", targetKind: "TOOL",
  validFrom: "2026-09-25T00:00:00.000Z", recordedAt: "2026-09-25T00:00:00.000Z", idempotencyFingerprint: "e".repeat(64),
} as never;

const TECHNICAL_FIELD_DECISION = {
  organisationId: WRITE_PRINCIPAL.organisationId, decisionId: "decision:1",
  canonicalObject: { organisationId: WRITE_PRINCIPAL.organisationId, objectId: "canonical-object:1", kind: "DATA_ASSET" },
  field: "technicalName", proposalId: "proposal:1", observationIds: ["observation:1"],
  expectedSourceObservationId: "observation:1", expectedSourceSnapshotId: "snapshot:1", outcome: "DEFER",
  actor: { authorityKind: "HUMAN", actorReference: WRITE_PRINCIPAL.actorUserId }, decidedAt: "2026-09-25T00:00:00.000Z",
} as never;

const EXECUTION_FIELD_DECISION = {
  organisationId: WRITE_PRINCIPAL.organisationId, decisionId: "decision:1",
  canonicalObject: { organisationId: WRITE_PRINCIPAL.organisationId, kind: "AGENT_VERSION", objectId: "canonical-object:1" },
  snapshotId: "snapshot:1", field: "PRINCIPAL", outcome: "ACCEPT_PROPOSED", policyId: "policy:1", policyVersion: "1",
  actor: { authorityKind: "HUMAN", actorReference: WRITE_PRINCIPAL.actorUserId }, decidedAt: "2026-09-25T00:00:00.000Z",
} as never;

interface Scenario { readonly name: string; readonly rpcName: string; readonly run: () => Promise<unknown> }
function scenarios(): Scenario[] {
  return [
    { name: "A apply_review_transition_governed_v1", rpcName: "apply_review_transition_governed_v1",
      run: () => createGovernedReviewPersistence(WRITE_PRINCIPAL).persistReviewTransition(REVIEW_TRANSITION_RESULT) },
    { name: "B record_authorized_reconciliation_governed_v1", rpcName: "record_authorized_reconciliation_governed_v1",
      run: () => createGovernedReviewPersistence(WRITE_PRINCIPAL).persistAuthorizedReconciliation(RECONCILIATION_INPUT) },
    { name: "C materialize_object_reconciliation_governed_v1", rpcName: "materialize_object_reconciliation_governed_v1",
      run: () => createGovernedMaterializationPersistence(WRITE_PRINCIPAL).materializeObjectReconciliation(OBJECT_MATERIALIZATION_INPUT) },
    { name: "C materialize_relationship_reconciliation_governed_v1", rpcName: "materialize_relationship_reconciliation_governed_v1",
      run: () => createGovernedMaterializationPersistence(WRITE_PRINCIPAL).materializeRelationshipReconciliation(RELATIONSHIP_MATERIALIZATION_INPUT) },
    { name: "D record_technical_field_decision_governed_v1", rpcName: "record_technical_field_decision_governed_v1",
      run: () => createGovernedTechnicalFactPersistence(WRITE_PRINCIPAL).recordDecision(TECHNICAL_FIELD_DECISION) },
    { name: "E record_execution_field_decision_governed_v1", rpcName: "record_execution_field_decision_governed_v1",
      run: () => createGovernedExecutionContextPersistence(WRITE_PRINCIPAL).recordDecision(EXECUTION_FIELD_DECISION) },
  ];
}

for (const scenario of scenarios()) {
  test(`${scenario.name}: calls exactly the governed RPC name with the exact five verified args`, async () => {
    resetCalls();
    await scenario.run();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, scenario.rpcName);
    const args = calls[0].args;
    assert.equal(args.p_verified_organisation_id, WRITE_PRINCIPAL.organisationId);
    assert.equal(args.p_verified_actor_user_id, WRITE_PRINCIPAL.actorUserId);
    assert.equal(args.p_verified_session_iat, WRITE_PRINCIPAL.issuedAtSeconds);
    assert.equal(args.p_verified_session_exp, WRITE_PRINCIPAL.expiresAtSeconds);
    // Exact string identity, never reconstructed through a JS Date round-trip.
    assert.equal(args.p_verified_credential_epoch, WRITE_PRINCIPAL.credentialEpoch);
    assert.equal(typeof args.p_verified_credential_epoch, "string");
    // No flat identity/session authority may be caller-supplied instead.
    for (const forbidden of ["p_organisation_id", "p_actor_kind", "p_actor_reference", "p_authority_reference", "p_authorization_actor_reference"]) {
      assert.equal(forbidden in args, false, `${scenario.rpcName} must not accept ${forbidden} from the caller`);
    }
  });
}

const SECURITY_CASES: Array<{ code: string; status: number; retryAfter?: string }> = [
  { code: "GV001", status: 401 }, { code: "GV002", status: 401 },
  { code: "GV003", status: 403 }, { code: "GV006", status: 403 },
  { code: "GV004", status: 500 }, { code: "GV005", status: 500 },
  { code: "55P03", status: 503, retryAfter: "1" },
];

for (const scenario of scenarios()) {
  for (const { code, status, retryAfter } of SECURITY_CASES) {
    test(`${scenario.name}: SQLSTATE ${code} classifies to ${status}, never leaking DB DETAIL`, async () => {
      resetCalls();
      nextError = { code, message: `${scenario.rpcName} failed: PRIVATE_DB_DETAIL_${code}` };
      let caught: unknown;
      try { await scenario.run(); assert.fail("expected the governed call to reject"); } catch (error) { caught = error; }
      assert.ok(caught instanceof GovernedWriteError || caught instanceof Error);
      const mapping = mapGovernedWriteSecurityError(caught);
      assert.ok(mapping, `${scenario.name}/${code} must classify as a security/infra error`);
      assert.equal(mapping!.status, status);
      assert.doesNotMatch(mapping!.body.error, /PRIVATE_DB_DETAIL/, "the mapped body must never contain the raw DB message");
      const response = governedWriteErrorResponse(caught);
      assert.ok(response);
      assert.equal(response!.status, status);
      if (retryAfter) assert.equal(response!.headers.get("Retry-After"), retryAfter);
      assert.doesNotMatch(JSON.stringify(await response!.clone().json()), /PRIVATE_DB_DETAIL/);
    });
  }
  test(`${scenario.name}: an unrecognized code (e.g. 42501) is NOT classified — falls through to the caller's own generic handling`, async () => {
    resetCalls();
    nextError = { code: "42501", message: `${scenario.rpcName} failed: permission denied for table PRIVATE_TABLE_NAME` };
    let caught: unknown;
    try { await scenario.run(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(mapGovernedWriteSecurityError(caught), undefined);
    assert.equal(governedWriteErrorResponse(caught), undefined);
  });
}
