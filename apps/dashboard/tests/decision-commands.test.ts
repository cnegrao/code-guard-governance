import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

import {
  asDiscoveryFindingId,
  asEvidenceId,
  asExternalId,
  asIsoTimestamp,
  asOrganisationId,
  asSourceConnectionId,
} from "@council/canonical-contracts";
import {
  RECONCILIATION_INPUT_STATUS,
  normalizedObjectIdentity,
  EndpointResolutionError,
  REVIEW_STATE,
  asReviewSubjectId,
  type GovernanceReviewPersistencePort,
  type ReviewSubject,
} from "@council/governance-review";
import { GovernedWriteError } from "@/lib/governance/governed-write-errors";

const ORG = asOrganisationId("org-1");
const SUBJECT_ID = asReviewSubjectId("review-subject:test:1");
const TEST_WRITE_PRINCIPAL = {
  organisationId: ORG,
  actorUserId: "user-1",
  issuedAtSeconds: 1_700_000_000,
  expiresAtSeconds: 1_700_028_800,
  credentialEpoch: "2026-01-01T00:00:00.000000+00:00",
};

function buildSubject(overrides: Partial<ReviewSubject> = {}): ReviewSubject {
  return Object.freeze({
    reviewSubjectId: SUBJECT_ID,
    organisationId: ORG,
    candidateKind: "MODEL",
    findingId: asDiscoveryFindingId("finding-1"),
    sourceObject: {
      connectionId: asSourceConnectionId("conn-1"),
      externalType: "repo",
      externalId: asExternalId("ext-1"),
    },
    assertionIds: [],
    evidenceIds: [asEvidenceId("evidence-1")],
    state: REVIEW_STATE.CERTIFIED,
    detectedAt: asIsoTimestamp(new Date().toISOString()),
    ...overrides,
  }) as ReviewSubject;
}

function objectFinding(kind: "MODEL" | "TOOL" | "AGENT" = "MODEL") {
  return {
    findingId: asDiscoveryFindingId("finding-1"),
    candidateKind: kind,
    sourceObject: buildSubject().sourceObject,
    assertionIds: [],
    evidenceIds: [asEvidenceId("evidence-1")],
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: asIsoTimestamp(new Date().toISOString()),
  };
}

function objectCandidate(kind: "MODEL" | "TOOL" = "MODEL") {
  return {
    candidateId: "candidate-1",
    candidateKind: kind,
    sourceObject: buildSubject().sourceObject,
    findingId: asDiscoveryFindingId("finding-1"),
    assertionIds: [],
    evidenceIds: [asEvidenceId("evidence-1")],
    confidence: 1,
    requiresReconciliation: true,
    proposedIdentity: kind === "MODEL" ? { modelReference: "m-1" } : { declarationKey: "t-1" },
  };
}

function relationshipFinding() {
  return {
    findingId: asDiscoveryFindingId("finding-1"),
    candidateKind: "RELATIONSHIP",
    sourceObject: buildSubject().sourceObject,
    assertionIds: [],
    evidenceIds: [asEvidenceId("evidence-1")],
    requiresReview: true,
    createsCanonicalObject: false,
    detectedAt: asIsoTimestamp(new Date().toISOString()),
  };
}

function relationshipCandidate() {
  return {
    candidateId: "candidate-rel-1",
    candidateKind: "RELATIONSHIP",
    sourceObject: buildSubject().sourceObject,
    findingId: asDiscoveryFindingId("finding-1"),
    assertionIds: [],
    evidenceIds: [asEvidenceId("evidence-1")],
    confidence: 1,
    requiresReconciliation: true,
    relationshipTypeCode: "USES_MODEL",
    sourceEndpoint: { referenceKind: "SOURCE_OBJECT", candidateKind: "AGENT_VERSION", sourceObject: buildSubject().sourceObject },
    targetEndpoint: { referenceKind: "SOURCE_OBJECT", candidateKind: "MODEL", sourceObject: buildSubject().sourceObject },
  };
}

interface RecoveryState {
  status: string;
  reviewSubject: ReviewSubject;
  finding?: unknown;
  candidate?: unknown;
}

interface WorldState {
  subject: ReviewSubject | undefined;
  recovery: RecoveryState;
  existingDecisionId: string | undefined;
  materializationSummary: unknown;
  matchCandidate: unknown;
  persistCalls: Array<{ family: string; decision: unknown; invocation: unknown; authorization: unknown }>;
  persistReplay: boolean;
  persistAuthorizedReconciliationError: Error | undefined;
  reconciliationAuditChain: unknown;
  materializeObjectResult: unknown;
  materializeObjectError: string | undefined;
  materializeObjectFullError: Error | undefined;
}

const world: WorldState = {
  subject: buildSubject(),
  recovery: { status: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE, reviewSubject: buildSubject(), finding: objectFinding(), candidate: objectCandidate() },
  existingDecisionId: undefined,
  materializationSummary: undefined,
  matchCandidate: undefined,
  persistCalls: [],
  persistReplay: false,
  persistAuthorizedReconciliationError: undefined,
  reconciliationAuditChain: undefined,
  materializeObjectResult: undefined,
  materializeObjectError: undefined,
  materializeObjectFullError: undefined,
};

function notImplemented(name: string) {
  return async () => {
    throw new Error(`${name} should not be called in this test`);
  };
}

const fakeGovernancePort: GovernanceReviewPersistencePort = {
  createReviewSubject: notImplemented("createReviewSubject") as never,
  getReviewSubject: async () => world.subject,
  persistReviewTransition: notImplemented("persistReviewTransition") as never,
  getReviewAuditChain: notImplemented("getReviewAuditChain") as never,
  persistAuthorizationDecision: notImplemented("persistAuthorizationDecision") as never,
  persistAuthorizedReconciliation: async (input) => {
    if (world.persistAuthorizedReconciliationError) throw world.persistAuthorizedReconciliationError;
    world.persistCalls.push({ family: input.family, decision: input.decision, invocation: input.invocation, authorization: input.authorization });
    return {
      replay: world.persistReplay,
      authorizationDecisionId: input.authorization.authorizationDecisionId,
      invocationId: input.invocation.invocationId,
      reconciliationDecisionId: input.decision.decisionId,
    };
  },
  getReconciliationAuditChain: async () => world.reconciliationAuditChain as never,
};

mock.module("@/lib/governance/persistence", {
  namedExports: {
    governanceReviewPersistence: fakeGovernancePort,
    privilegedDb: {},
    // M16-S0.3.3C: production code now calls this factory instead of the
    // legacy governanceReviewPersistence.persist* methods directly for the
    // human write paths; return the SAME fake port so world tracking is
    // exercised identically regardless of which name production calls.
    createGovernedReviewPersistence: () => fakeGovernancePort,
  },
});

const fakeMaterializationPort = {
  materializeObjectReconciliation: async () => {
    if (world.materializeObjectFullError) throw world.materializeObjectFullError;
    if (world.materializeObjectError) throw new Error(world.materializeObjectError);
    if (!world.materializeObjectResult) throw new Error("materializeObjectReconciliation should not be called in this test");
    return world.materializeObjectResult;
  },
  materializeRelationshipReconciliation: notImplemented("materializeRelationshipReconciliation"),
  findActiveObjectSourceMapping: notImplemented("findActiveObjectSourceMapping"),
};

mock.module("@/lib/governance/materialization", {
  namedExports: {
    materializationPersistence: fakeMaterializationPort,
    createGovernedMaterializationPersistence: () => fakeMaterializationPort,
  },
});

mock.module("@/lib/governance/reconciliation-input", {
  namedExports: {
    getReconciliationInputForReviewSubject: async () => world.recovery,
  },
});

mock.module("@/lib/governance/canonical-object-lookup", {
  namedExports: {
    getCanonicalObjectForMatch: async () => world.matchCandidate,
    listCanonicalObjectsForMatch: async () => [],
  },
});

mock.module("@/lib/governance/legacy-object-mapping", {
  namedExports: { assertLegacyObjectCompatibility: async () => {}, LegacyObjectMappingConflict: class extends Error {} },
});

mock.module("@/lib/governance/relationship-resolution", {
  namedExports: {
    objectMappingIdentity: async (_org: unknown, candidate: Parameters<typeof normalizedObjectIdentity>[0]) => normalizedObjectIdentity(candidate),
    canonicalEndpointResolution: { getRelationshipCandidate: async () => world.recovery.candidate },
    relationshipRequestedDecision: async () => { throw new EndpointResolutionError("ENDPOINT_NOT_CANONICAL"); },
  },
});

mock.module("@/lib/governance/decision-query", {
  namedExports: {
    findReconciliationDecisionIdForReviewSubject: async () => world.existingDecisionId,
    findMaterializationForDecision: async () => world.materializationSummary,
  },
});

let submitReconciliationDecision: typeof import("@/lib/governance/decision-commands").submitReconciliationDecision;
let triggerMaterialization: typeof import("@/lib/governance/decision-commands").triggerMaterialization;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ submitReconciliationDecision, triggerMaterialization } = await import("@/lib/governance/decision-commands"));
});

const baseInput = {
  organisationId: ORG,
  actorUserId: "user-1",
  writePrincipal: TEST_WRITE_PRINCIPAL,
  reviewSubjectId: SUBJECT_ID,
  reasonCode: "governance board approved",
};

function resetWorld() {
  world.subject = buildSubject();
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE,
    reviewSubject: buildSubject(),
    finding: objectFinding(),
    candidate: objectCandidate(),
  };
  world.existingDecisionId = undefined;
  world.materializationSummary = undefined;
  world.matchCandidate = undefined;
  world.persistCalls = [];
  world.persistReplay = false;
  world.persistAuthorizedReconciliationError = undefined;
  world.reconciliationAuditChain = undefined;
  world.materializeObjectResult = undefined;
  world.materializeObjectError = undefined;
  world.materializeObjectFullError = undefined;
}

test("submitReconciliationDecision: MODEL CERTIFIED + OBJECT_INPUT_AVAILABLE with CREATE_NEW applies and persists an OBJECT-family decision", async () => {
  resetWorld();
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "APPLIED");
  assert.equal(world.persistCalls.length, 1);
  assert.equal(world.persistCalls[0]!.family, "OBJECT");
});

test("submitReconciliationDecision: TOOL CERTIFIED + OBJECT_INPUT_AVAILABLE with CREATE_NEW applies", async () => {
  resetWorld();
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE,
    reviewSubject: buildSubject({ candidateKind: "TOOL" }),
    finding: objectFinding("TOOL"),
    candidate: objectCandidate("TOOL"),
  };
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "APPLIED");
});

for (const requestedOutcome of ["REJECT", "DEFER"] as const) test(`submitReconciliationDecision: RELATIONSHIP CERTIFIED + RELATIONSHIP_INPUT_AVAILABLE with ${requestedOutcome} applies and persists a RELATIONSHIP-family decision`, async () => {
  resetWorld();
  world.subject = buildSubject({ candidateKind: "RELATIONSHIP" });
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
    reviewSubject: buildSubject({ candidateKind: "RELATIONSHIP" }),
    finding: relationshipFinding(),
    candidate: relationshipCandidate(),
  };
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome });
  assert.equal(outcome.kind, "APPLIED");
  assert.equal(world.persistCalls[0]!.family, "RELATIONSHIP");
});

// M16-S0.3.3C-R2: an exact-match replay of an already-persisted RELATIONSHIP
// decision used to short-circuit straight to REPLAYED without ever invoking
// record_authorized_reconciliation_governed_v1 — a HUMAN actor whose
// GOVERNANCE_ADMIN role had since been revoked could still "replay" the
// identical command and receive REPLAYED, because the governed wrapper's own
// require_governed_write_eligibility_v1 guard was never given the chance to
// re-check CURRENT authority. These tests set up a real, production-built
// RelationshipReconciliationDecision/authorization/invocation chain (from a
// first genuine APPLIED call) and then drive the identical command again,
// simulating the review subject now having a persisted decision.
function setUpRelationshipScenario() {
  world.subject = buildSubject({ candidateKind: "RELATIONSHIP" });
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
    reviewSubject: buildSubject({ candidateKind: "RELATIONSHIP" }),
    finding: relationshipFinding(),
    candidate: relationshipCandidate(),
  };
}

test("submitReconciliationDecision: RELATIONSHIP replay CASE A (current admin) — the governed persistence boundary is invoked exactly once, reusing the EXISTING chain verbatim, before REPLAYED is returned", async () => {
  resetWorld();
  setUpRelationshipScenario();
  const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(first.kind, "APPLIED");
  assert.equal(world.persistCalls.length, 1);
  const existing = world.persistCalls[0]!;

  // Simulate the review subject now having exactly this persisted decision.
  world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
  world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
  world.persistCalls = [];
  world.persistReplay = true; // the real governed wrapper's own idempotent replay reports true

  const replay = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(replay.kind, "REPLAYED");
  assert.equal(replay.kind === "REPLAYED" && replay.reconciliationDecisionId, world.existingDecisionId);

  assert.equal(world.persistCalls.length, 1, "the governed persistence boundary is invoked exactly once for the replay");
  const call = world.persistCalls[0]!;
  // Strict object identity: the EXISTING chain is reused verbatim, never
  // reconstructed, and no new AuthorizationDecision/commandId is synthesized.
  assert.equal(call.decision, existing.decision, "the existing persisted decision object is reused, not reconstructed");
  assert.equal(call.authorization, existing.authorization, "the existing AuthorizationDecision is reused; no new one is synthesized");
  assert.equal(call.invocation, existing.invocation, "the existing invocation (same commandId/fingerprint) is reused; no new commandId is minted");
});

test("submitReconciliationDecision: RELATIONSHIP replay CASE B (admin revoked) — GV006 from the governed wrapper propagates; it is NEVER converted to REPLAYED", async () => {
  resetWorld();
  setUpRelationshipScenario();
  const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(first.kind, "APPLIED");
  const existing = world.persistCalls[0]!;
  world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
  world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
  world.persistCalls = [];
  world.persistAuthorizedReconciliationError = new GovernedWriteError(
    "record_authorized_reconciliation_governed_v1 failed: M16_WRITE_AUTHORITY_DENIED", "GV006");

  await assert.rejects(
    submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" }),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV006",
  );
  assert.equal(world.persistCalls.length, 0, "no business-success result was produced");
});

for (const code of ["GV002", "GV001"]) {
  test(`submitReconciliationDecision: RELATIONSHIP replay propagates ${code} unchanged (never converted to REPLAYED or any business outcome)`, async () => {
    resetWorld();
    setUpRelationshipScenario();
    const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
    assert.equal(first.kind, "APPLIED");
    const existing = world.persistCalls[0]!;
    world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
    world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
    world.persistCalls = [];
    world.persistAuthorizedReconciliationError = new GovernedWriteError(
      `record_authorized_reconciliation_governed_v1 failed: session check failed (${code})`, code);

    await assert.rejects(
      submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" }),
      (error: unknown) => error instanceof GovernedWriteError && error.code === code,
    );
    assert.equal(world.persistCalls.length, 0);
  });
}

test("submitReconciliationDecision: RELATIONSHIP replay propagates a lock-timeout (55P03) unchanged", async () => {
  resetWorld();
  setUpRelationshipScenario();
  const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(first.kind, "APPLIED");
  const existing = world.persistCalls[0]!;
  world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
  world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
  world.persistCalls = [];
  world.persistAuthorizedReconciliationError = new GovernedWriteError(
    "record_authorized_reconciliation_governed_v1 failed: lock not obtained", "55P03");

  await assert.rejects(
    submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" }),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "55P03",
  );
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: RELATIONSHIP replay — an impossible replay=false from the governed wrapper (persisted chain known, but the DB disagrees) fails closed with no fabricated success and no raw internal detail", async () => {
  resetWorld();
  setUpRelationshipScenario();
  const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(first.kind, "APPLIED");
  const existing = world.persistCalls[0]!;
  world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
  world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
  world.persistCalls = [];
  world.persistReplay = false; // simulates the governed wrapper disagreeing with the known persisted chain

  await assert.rejects(
    submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" }),
    (error: unknown) => error instanceof Error && !(error instanceof GovernedWriteError) &&
      !/DETAIL|SQLSTATE|postgres|constraint/i.test(error.message),
  );
});

test("submitReconciliationDecision: RELATIONSHIP replay — a mismatched existing decision remains PERSISTENCE_CONFLICT and never calls the governed persistence boundary", async () => {
  resetWorld();
  setUpRelationshipScenario();
  const first = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(first.kind, "APPLIED");
  const existing = world.persistCalls[0]!;
  world.existingDecisionId = (existing.decision as { decisionId: string }).decisionId;
  // A different semantic command (DEFER, not the persisted REJECT) against the same existing decision.
  world.reconciliationAuditChain = { family: "RELATIONSHIP", decision: existing.decision, authorization: existing.authorization, invocation: existing.invocation };
  world.persistCalls = [];

  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "DEFER" });
  assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
  assert.equal(world.persistCalls.length, 0, "the governed persistence boundary must never be called for a mismatched existing decision");
});

test("submitReconciliationDecision: RELATIONSHIP CREATE_NEW/MATCH_EXISTING fail closed when exact canonical endpoints are unavailable", async () => {
  resetWorld();
  world.subject = buildSubject({ candidateKind: "RELATIONSHIP" });
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
    reviewSubject: buildSubject({ candidateKind: "RELATIONSHIP" }),
    finding: relationshipFinding(),
    candidate: relationshipCandidate(),
  };
  for (const requestedOutcome of ["CREATE_NEW", "MATCH_EXISTING"] as const) {
    const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome });
    assert.equal(outcome.kind, "INVALID_REQUEST");
  }
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: AGENT FINDING_ONLY cannot reconcile — fails closed as NOT_READY without ever invoking authorization/reconciliation", async () => {
  resetWorld();
  world.subject = buildSubject({ candidateKind: "AGENT" });
  world.recovery = { status: RECONCILIATION_INPUT_STATUS.FINDING_ONLY, reviewSubject: buildSubject({ candidateKind: "AGENT" }), finding: objectFinding("AGENT") };
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "NOT_READY");
  assert.equal(outcome.kind === "NOT_READY" && outcome.reason, "FINDING_ONLY");
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: a non-CERTIFIED review subject cannot reconcile", async () => {
  resetWorld();
  world.subject = buildSubject({ state: REVIEW_STATE.CONFIRMED });
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "NOT_READY");
  assert.equal(outcome.kind === "NOT_READY" && outcome.reason, "NOT_CERTIFIED");
  assert.equal(world.persistCalls.length, 0);
});

// M16-S0.3.3C-R1: SubmitReconciliationDecisionInput carries no currentRole/
// advisory-role field — there is nothing here for a stale or forged role
// value to deny with. CASE 1 (current DB authority ALLOW reaches the adapter
// without any app role allow) is exercised by the "applies and persists"
// tests above, which needed no role of any kind to reach persistence.
test("submitReconciliationDecision: SubmitReconciliationDecisionInput has no currentRole/advisory-role field to deny or allow with", () => {
  assert.equal("currentRole" in baseInput, false);
});

test("submitReconciliationDecision: current DB authority DENY (GV006 from the governed wrapper) propagates for the route to classify as 403 — it is never a FORBIDDEN outcome fabricated here, and no business-success result is produced", async () => {
  resetWorld();
  world.persistAuthorizedReconciliationError = new GovernedWriteError(
    "record_authorized_reconciliation_governed_v1 failed: M16_WRITE_AUTHORITY_DENIED", "GV006");
  await assert.rejects(
    submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" }),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV006",
  );
  assert.equal(world.persistCalls.length, 0, "no business-success result was produced");
});

test("submitReconciliationDecision: a review subject that already has a reconciliation decision is ALREADY_RECONCILED, never reconciled twice", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:existing";
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "NOT_READY");
  assert.equal(outcome.kind === "NOT_READY" && outcome.reason, "ALREADY_RECONCILED");
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: MATCH_EXISTING re-verifies the client-selected canonical object server-side and never trusts a target that no longer exists", async () => {
  resetWorld();
  world.matchCandidate = undefined; // simulates a stale/forged/cross-tenant id
  const outcome = await submitReconciliationDecision({
    ...baseInput,
    requestedOutcome: "MATCH_EXISTING",
    matchCanonicalObjectId: "canonical-object:forged",
  });
  assert.equal(outcome.kind, "INVALID_REQUEST");
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: MATCH_EXISTING against a server-verified existing canonical object applies, using the verified identity, not the raw client string", async () => {
  resetWorld();
  world.matchCandidate = { canonicalObjectId: "canonical-object:real", kind: "MODEL", createdAt: new Date().toISOString(), sourceMappings: [] };
  const outcome = await submitReconciliationDecision({
    ...baseInput,
    requestedOutcome: "MATCH_EXISTING",
    matchCanonicalObjectId: "canonical-object:real",
  });
  assert.equal(outcome.kind, "APPLIED");
  const decision = world.persistCalls[0]!.decision as { canonicalObject?: { objectId: string } };
  assert.equal(decision.canonicalObject?.objectId, "canonical-object:real");
});

test("submitReconciliationDecision: an empty reasonCode is rejected before any domain invocation", async () => {
  resetWorld();
  const outcome = await submitReconciliationDecision({ ...baseInput, reasonCode: "   ", requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "INVALID_REQUEST");
  assert.equal(world.persistCalls.length, 0);
});

test("submitReconciliationDecision: identical resubmission (double-click) produces the same commandId, so the persistence layer's own idempotency handles the replay deterministically", async () => {
  resetWorld();
  await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  const firstInvocation = world.persistCalls[0]!.invocation as { commandId: string };

  resetWorld();
  world.subject = buildSubject(); // fresh identical subject/candidate content
  await submitReconciliationDecision({ ...baseInput, requestedOutcome: "CREATE_NEW" });
  const secondInvocation = world.persistCalls[0]!.invocation as { commandId: string };

  assert.equal(firstInvocation.commandId, secondInvocation.commandId);
});

test("triggerMaterialization: a valid CREATE_NEW OBJECT decision materializes, returning the exact canonical object/mapping the existing materialization gate produced", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:1";
  world.reconciliationAuditChain = {
    family: "OBJECT",
    authorization: {
      authorizationDecisionId: "authz-1",
      result: "ALLOW",
      organisationId: ORG,
      actorReference: "user-1",
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1" },
      requestedAction: "CREATE_NEW",
      evaluatedAt: asIsoTimestamp(new Date().toISOString()),
    },
    invocation: {
      invocationId: "invocation-1",
      commandId: "cmd-1",
      organisationId: ORG,
      reviewSubjectId: SUBJECT_ID,
      authorizationDecisionId: "authz-1",
      reconciliationDecisionId: "reconciliation-decision:1",
      requestedAction: "CREATE_NEW",
      actor: { authorityKind: "HUMAN", actorReference: "user-1" },
      requestedAt: asIsoTimestamp(new Date().toISOString()),
      reasonCode: "x",
      commandFingerprint: "fp",
    },
    decision: {
      decisionId: "reconciliation-decision:1",
      organisationId: ORG,
      outcome: "CREATE_NEW",
      candidateKind: "MODEL",
      authority: { authorityKind: "HUMAN", actorReference: "user-1" },
      reasonCode: "x",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: asIsoTimestamp(new Date().toISOString()),
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1", candidateKind: "MODEL" },
      canonicalObject: { organisationId: ORG, objectId: "canonical-object:1", kind: "MODEL" },
    },
  };
  world.materializeObjectResult = { replay: false, status: "APPLIED", canonicalObjectId: "canonical-object:1", mappingId: "mapping-1" };

  const outcome = await triggerMaterialization({ organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "APPLIED");
  assert.equal(outcome.kind === "APPLIED" && outcome.result.applicable, true);
});

test("triggerMaterialization: a SOURCE_IDENTITY_ALREADY_MAPPED rejection from the closed materialization RPC (e.g. a file that already backs a different governed canonical object) is surfaced as a sanitized PERSISTENCE_CONFLICT, never a raw 500", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:1";
  world.reconciliationAuditChain = {
    family: "OBJECT",
    authorization: {
      authorizationDecisionId: "authz-1",
      result: "ALLOW",
      organisationId: ORG,
      actorReference: "user-1",
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1" },
      requestedAction: "CREATE_NEW",
      evaluatedAt: asIsoTimestamp(new Date().toISOString()),
    },
    invocation: {
      invocationId: "invocation-1",
      commandId: "cmd-1",
      organisationId: ORG,
      reviewSubjectId: SUBJECT_ID,
      authorizationDecisionId: "authz-1",
      reconciliationDecisionId: "reconciliation-decision:1",
      requestedAction: "CREATE_NEW",
      actor: { authorityKind: "HUMAN", actorReference: "user-1" },
      requestedAt: asIsoTimestamp(new Date().toISOString()),
      reasonCode: "x",
      commandFingerprint: "fp",
    },
    decision: {
      decisionId: "reconciliation-decision:1",
      organisationId: ORG,
      outcome: "CREATE_NEW",
      candidateKind: "TOOL",
      authority: { authorityKind: "HUMAN", actorReference: "user-1" },
      reasonCode: "x",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: asIsoTimestamp(new Date().toISOString()),
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1", candidateKind: "TOOL" },
      canonicalObject: { organisationId: ORG, objectId: "canonical-object:2", kind: "TOOL" },
    },
  };
  for (const code of ["SOURCE_IDENTITY_ALREADY_MAPPED", "LEGACY_OBJECT_ALREADY_CANONICAL", "LEGACY_OBJECT_MAPPING_AMBIGUOUS", "LEGACY_OBJECT_MATCH_MISMATCH"]) {
    world.materializeObjectError = `materialize_object_reconciliation failed: ${code}`;
    const outcome = await triggerMaterialization({ organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID });
    assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
    assert.equal(JSON.stringify(outcome).includes(code), false);
  }
});

test("triggerMaterialization: a review subject with no persisted reconciliation decision cannot materialize", async () => {
  resetWorld();
  const outcome = await triggerMaterialization({ organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "NOT_READY");
});

// M16-S0.3.3C-R1: TriggerMaterializationInput carries no currentRole/
// advisory-role field — there is nothing here for a stale or forged role
// value to deny with. CASE 1 (current DB authority ALLOW reaches the adapter
// without any app role allow) is exercised by the "a valid CREATE_NEW OBJECT
// decision materializes" test above, which needed no role of any kind.
test("triggerMaterialization: TriggerMaterializationInput has no currentRole/advisory-role field to deny or allow with", () => {
  assert.equal("currentRole" in { organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID }, false);
});

test("triggerMaterialization: current DB authority DENY (GV006 from the governed wrapper) propagates for the route to classify as 403 — it is never a FORBIDDEN outcome fabricated here, and no business-success result is produced", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:1";
  world.reconciliationAuditChain = {
    family: "OBJECT",
    authorization: {
      authorizationDecisionId: "authz-1",
      result: "ALLOW",
      organisationId: ORG,
      actorReference: "user-1",
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1" },
      requestedAction: "CREATE_NEW",
      evaluatedAt: asIsoTimestamp(new Date().toISOString()),
    },
    invocation: {
      invocationId: "invocation-1",
      commandId: "cmd-1",
      organisationId: ORG,
      reviewSubjectId: SUBJECT_ID,
      authorizationDecisionId: "authz-1",
      reconciliationDecisionId: "reconciliation-decision:1",
      requestedAction: "CREATE_NEW",
      actor: { authorityKind: "HUMAN", actorReference: "user-1" },
      requestedAt: asIsoTimestamp(new Date().toISOString()),
      reasonCode: "x",
      commandFingerprint: "fp",
    },
    decision: {
      decisionId: "reconciliation-decision:1",
      organisationId: ORG,
      outcome: "CREATE_NEW",
      candidateKind: "MODEL",
      authority: { authorityKind: "HUMAN", actorReference: "user-1" },
      reasonCode: "x",
      assertionIds: [],
      evidenceIds: [],
      decidedAt: asIsoTimestamp(new Date().toISOString()),
      subject: { subjectKind: "CANDIDATE", candidateId: "candidate-1", candidateKind: "MODEL" },
      canonicalObject: { organisationId: ORG, objectId: "canonical-object:1", kind: "MODEL" },
    },
  };
  world.materializeObjectFullError = new GovernedWriteError(
    "materialize_object_reconciliation_governed_v1 failed: M16_WRITE_AUTHORITY_DENIED", "GV006");
  await assert.rejects(
    triggerMaterialization({ organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID }),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV006",
  );
  assert.equal(world.persistCalls.length, 0, "no business-success result was produced");
});

test("triggerMaterialization: a cross-tenant/nonexistent decision id (audit chain lookup returns nothing for this org — getReconciliationAuditChain is itself organisation-scoped) fails closed, never materializing", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:other-org";
  // fakeGovernancePort.getReconciliationAuditChain already defaults to
  // returning undefined, which is exactly what the real tenant-scoped query
  // returns for a decision id belonging to another organisation.
  const outcome = await triggerMaterialization({ organisationId: ORG, writePrincipal: TEST_WRITE_PRINCIPAL, reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
});
