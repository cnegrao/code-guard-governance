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

const ORG = asOrganisationId("org-1");
const SUBJECT_ID = asReviewSubjectId("review-subject:test:1");

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
  persistCalls: Array<{ family: string; decision: unknown; invocation: unknown }>;
  persistReplay: boolean;
  reconciliationAuditChain: unknown;
  materializeObjectResult: unknown;
  materializeObjectError: string | undefined;
}

const world: WorldState = {
  subject: buildSubject(),
  recovery: { status: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE, reviewSubject: buildSubject(), finding: objectFinding(), candidate: objectCandidate() },
  existingDecisionId: undefined,
  materializationSummary: undefined,
  matchCandidate: undefined,
  persistCalls: [],
  persistReplay: false,
  reconciliationAuditChain: undefined,
  materializeObjectResult: undefined,
  materializeObjectError: undefined,
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
    world.persistCalls.push({ family: input.family, decision: input.decision, invocation: input.invocation });
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
  namedExports: { governanceReviewPersistence: fakeGovernancePort, privilegedDb: {} },
});

mock.module("@/lib/governance/materialization", {
  namedExports: {
    materializationPersistence: {
      materializeObjectReconciliation: async () => {
        if (world.materializeObjectError) throw new Error(world.materializeObjectError);
        if (!world.materializeObjectResult) throw new Error("materializeObjectReconciliation should not be called in this test");
        return world.materializeObjectResult;
      },
      materializeRelationshipReconciliation: notImplemented("materializeRelationshipReconciliation"),
      findActiveObjectSourceMapping: notImplemented("findActiveObjectSourceMapping"),
    },
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
  sessionRole: "org_admin",
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
  world.reconciliationAuditChain = undefined;
  world.materializeObjectResult = undefined;
  world.materializeObjectError = undefined;
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

test("submitReconciliationDecision: RELATIONSHIP CERTIFIED + RELATIONSHIP_INPUT_AVAILABLE with REJECT applies and persists a RELATIONSHIP-family decision", async () => {
  resetWorld();
  world.subject = buildSubject({ candidateKind: "RELATIONSHIP" });
  world.recovery = {
    status: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
    reviewSubject: buildSubject({ candidateKind: "RELATIONSHIP" }),
    finding: relationshipFinding(),
    candidate: relationshipCandidate(),
  };
  const outcome = await submitReconciliationDecision({ ...baseInput, requestedOutcome: "REJECT" });
  assert.equal(outcome.kind, "APPLIED");
  assert.equal(world.persistCalls[0]!.family, "RELATIONSHIP");
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

test("submitReconciliationDecision: a session role other than org_admin is forbidden, checked before any subject lookup", async () => {
  resetWorld();
  const outcome = await submitReconciliationDecision({ ...baseInput, sessionRole: "user", requestedOutcome: "CREATE_NEW" });
  assert.equal(outcome.kind, "FORBIDDEN");
  assert.equal(world.persistCalls.length, 0);
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

  const outcome = await triggerMaterialization({ organisationId: ORG, sessionRole: "org_admin", reviewSubjectId: SUBJECT_ID });
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
  world.materializeObjectError = "materialize_object_reconciliation failed: SOURCE_IDENTITY_ALREADY_MAPPED";
  const outcome = await triggerMaterialization({ organisationId: ORG, sessionRole: "org_admin", reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
  assert.equal(JSON.stringify(outcome).includes("SOURCE_IDENTITY_ALREADY_MAPPED"), false);
});

test("triggerMaterialization: a review subject with no persisted reconciliation decision cannot materialize", async () => {
  resetWorld();
  const outcome = await triggerMaterialization({ organisationId: ORG, sessionRole: "org_admin", reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "NOT_READY");
});

test("triggerMaterialization: a non-org_admin session role is forbidden, checked before any decision lookup", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:1";
  const outcome = await triggerMaterialization({ organisationId: ORG, sessionRole: "user", reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "FORBIDDEN");
});

test("triggerMaterialization: a cross-tenant/nonexistent decision id (audit chain lookup returns nothing for this org — getReconciliationAuditChain is itself organisation-scoped) fails closed, never materializing", async () => {
  resetWorld();
  world.existingDecisionId = "reconciliation-decision:other-org";
  // fakeGovernancePort.getReconciliationAuditChain already defaults to
  // returning undefined, which is exactly what the real tenant-scoped query
  // returns for a decision id belonging to another organisation.
  const outcome = await triggerMaterialization({ organisationId: ORG, sessionRole: "org_admin", reviewSubjectId: SUBJECT_ID });
  assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
});
