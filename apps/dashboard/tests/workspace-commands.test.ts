import { test, before } from "node:test";
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
  REVIEW_STATE,
  asReviewSubjectId,
  type GovernanceReviewPersistencePort,
  type ReviewSubject,
} from "@council/governance-review";

// workspace-commands.ts transitively imports lib/governance/persistence.ts,
// which reads SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY at module-load time. A
// static top-level import would execute that module body before this file's
// own env-var setup ever runs (ESM loads and evaluates the imported module
// graph before the importing module's own statements) — so this must be a
// dynamic import inside `before()`, matching this repo's established
// convention (see governance-persistence-boundary.test.ts).
let workspaceCommands: typeof import("@/lib/governance/workspace-commands").workspaceCommands;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ workspaceCommands } = await import("@/lib/governance/workspace-commands"));
});

const ORG = asOrganisationId("org-1");
const OTHER_ORG = asOrganisationId("org-2");
const SUBJECT_ID = asReviewSubjectId("review-subject:test:1");

function buildSubject(overrides: Partial<ReviewSubject> = {}): ReviewSubject {
  return Object.freeze({
    reviewSubjectId: SUBJECT_ID,
    organisationId: ORG,
    candidateKind: "AGENT",
    findingId: asDiscoveryFindingId("finding-1"),
    sourceObject: {
      connectionId: asSourceConnectionId("conn-1"),
      externalType: "repo",
      externalId: asExternalId("ext-1"),
    },
    assertionIds: [],
    evidenceIds: [],
    state: REVIEW_STATE.PROPOSED,
    detectedAt: asIsoTimestamp(new Date().toISOString()),
    ...overrides,
  }) as ReviewSubject;
}

function notImplemented(name: string) {
  return async () => {
    throw new Error(`${name} should not be called in this test`);
  };
}

interface FakePortOptions {
  subject: ReviewSubject | undefined;
  persistReviewTransition?: GovernanceReviewPersistencePort["persistReviewTransition"];
}

function fakePort(options: FakePortOptions): GovernanceReviewPersistencePort {
  return {
    createReviewSubject: notImplemented("createReviewSubject"),
    getReviewSubject: async () => options.subject,
    persistReviewTransition:
      options.persistReviewTransition ??
      (async (result) => ({ replay: result.kind === "REPLAYED", subject: result.subject, event: result.event })),
    getReviewAuditChain: notImplemented("getReviewAuditChain"),
    persistAuthorizationDecision: notImplemented("persistAuthorizationDecision"),
    persistAuthorizedReconciliation: notImplemented("persistAuthorizedReconciliation"),
    getReconciliationAuditChain: notImplemented("getReconciliationAuditChain"),
  };
}

const baseInput = {
  organisationId: ORG,
  actorUserId: "user-1",
  sessionRole: "org_admin",
  reviewSubjectId: SUBJECT_ID,
};

test("workspace-commands: acting on a missing review subject fails closed as NOT_FOUND", async () => {
  const port = fakePort({ subject: undefined });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "NOT_FOUND");
});

test("workspace-commands: cross-tenant lookup (port returns undefined for another org) is indistinguishable from not found", async () => {
  const port = fakePort({ subject: undefined });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, organisationId: OTHER_ORG, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "NOT_FOUND");
});

test("workspace-commands: a stale client-supplied expectedState is rejected before any transition is attempted, and never overwrites", async () => {
  let persistCalled = false;
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.CONFIRMED }),
    persistReviewTransition: async (result) => {
      persistCalled = true;
      return { replay: false, subject: result.subject, event: result.event };
    },
  });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "STALE_REVIEW_SUBJECT");
  assert.equal(outcome.kind === "STALE_REVIEW_SUBJECT" && outcome.currentState, REVIEW_STATE.CONFIRMED);
  assert.equal(persistCalled, false, "a stale expectedState must never reach the persistence layer");
});

test("workspace-commands: a session role other than the verified org_admin role is forbidden from every action", async () => {
  const port = fakePort({ subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [] }) });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, sessionRole: "user", expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "FORBIDDEN");
});

test("workspace-commands: an action not legal for the current state is rejected as INVALID_TRANSITION, not silently coerced", async () => {
  const port = fakePort({ subject: buildSubject({ state: REVIEW_STATE.DETECTED }) });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.DETECTED },
    port,
  );
  assert.equal(outcome.kind, "INVALID_TRANSITION");
});

test("workspace-commands: certify without a reason is rejected before the domain layer is ever invoked", async () => {
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.CONFIRMED, evidenceIds: [asEvidenceId("evidence-1")] }),
  });
  const outcome = await workspaceCommands.certifyReview(
    { ...baseInput, expectedState: REVIEW_STATE.CONFIRMED, reasonCode: "  " },
    port,
  );
  assert.equal(outcome.kind, "INVALID_TRANSITION");
});

test("workspace-commands: confirm on a subject with no evidence fails closed via the domain layer's own MissingEvidenceError", async () => {
  const port = fakePort({ subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [] }) });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "INVALID_TRANSITION");
});

test("workspace-commands: a legal confirm applies, records a HUMAN actor derived only from server-side session identity, and returns the new state", async () => {
  let capturedActor: unknown;
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [asEvidenceId("evidence-1")] }),
    persistReviewTransition: async (result) => {
      capturedActor = result.event.actor;
      return { replay: false, subject: result.subject, event: result.event };
    },
  });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, actorUserId: "user-42", expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "APPLIED");
  assert.equal(outcome.kind === "APPLIED" && outcome.subject.state, REVIEW_STATE.CONFIRMED);
  assert.deepEqual(capturedActor, { authorityKind: "HUMAN", actorReference: "user-42" });
});

test("workspace-commands: a replayed persistence result is surfaced as REPLAYED, not a second APPLIED", async () => {
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [asEvidenceId("evidence-1")] }),
    persistReviewTransition: async (result) => ({ replay: true, subject: result.subject, event: result.event }),
  });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "REPLAYED");
});

test("workspace-commands: a concurrent-race stale-state error surfaced by the persistence RPC is mapped to STALE_REVIEW_SUBJECT, never a false success", async () => {
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [asEvidenceId("evidence-1")] }),
    persistReviewTransition: async () => {
      throw new Error("apply_review_transition failed: Stale review state: expected PROPOSED but found CONFIRMED");
    },
  });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "STALE_REVIEW_SUBJECT");
});

test("workspace-commands: an unrecognized persistence failure is sanitized as PERSISTENCE_CONFLICT, never a raw internal error", async () => {
  const port = fakePort({
    subject: buildSubject({ state: REVIEW_STATE.PROPOSED, evidenceIds: [asEvidenceId("evidence-1")] }),
    persistReviewTransition: async () => {
      throw new Error("connection to postgres://internal-host:5432 refused");
    },
  });
  const outcome = await workspaceCommands.confirmReview(
    { ...baseInput, expectedState: REVIEW_STATE.PROPOSED },
    port,
  );
  assert.equal(outcome.kind, "PERSISTENCE_CONFLICT");
  assert.equal(JSON.stringify(outcome).includes("postgres://"), false);
});

test("workspace-commands: reject is available from DETECTED, PROPOSED, and CONFIRMED but certify only from CONFIRMED", async () => {
  for (const state of [REVIEW_STATE.DETECTED, REVIEW_STATE.PROPOSED, REVIEW_STATE.CONFIRMED]) {
    const port = fakePort({ subject: buildSubject({ state }) });
    const outcome = await workspaceCommands.rejectReview({ ...baseInput, expectedState: state, reasonCode: "policy violation" }, port);
    assert.equal(outcome.kind, "APPLIED", `expected reject to be legal from ${state}`);
  }

  for (const state of [REVIEW_STATE.DETECTED, REVIEW_STATE.PROPOSED]) {
    const port = fakePort({ subject: buildSubject({ state }) });
    const outcome = await workspaceCommands.certifyReview({ ...baseInput, expectedState: state, reasonCode: "n/a" }, port);
    assert.equal(outcome.kind, "INVALID_TRANSITION", `expected certify to be illegal from ${state}`);
  }
});

test("workspace-commands: certify and reject are never reachable on a terminal (CERTIFIED/REJECTED) subject", async () => {
  for (const state of [REVIEW_STATE.CERTIFIED, REVIEW_STATE.REJECTED]) {
    const port = fakePort({ subject: buildSubject({ state }) });
    const rejectOutcome = await workspaceCommands.rejectReview(
      { ...baseInput, expectedState: state, reasonCode: "x" },
      port,
    );
    assert.equal(rejectOutcome.kind, "INVALID_TRANSITION");
    const certifyOutcome = await workspaceCommands.certifyReview(
      { ...baseInput, expectedState: state, reasonCode: "x" },
      port,
    );
    assert.equal(certifyOutcome.kind, "INVALID_TRANSITION");
  }
});
