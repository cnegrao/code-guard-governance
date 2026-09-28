import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import {
  asOrganisationId, asSourceConnectionId, asExternalId, asCanonicalObjectId, asIsoTimestamp,
  createBehaviorFingerprint, sourceObjectIdentityKey,
  type ExecutionSourceSnapshot, type FieldReconciliationDecision, type TechnicalFactProposal, type TechnicalFactObservation,
  type FieldAuthorityPolicy, type FieldAuthorityPolicyHead,
} from "@council/canonical-contracts";
import { executionDigest, type FieldReviewContext } from "@council/governance-review";

/**
 * M16-S0.3.3R3 — closes the confirmed HIGH finding H-1: reconcileTechnicalFact
 * and reconcileExecutionField used to short-circuit an exact replay straight
 * to `{replay: true}` BEFORE ever calling the supplied persistence port. In
 * production that port is `createGovernedTechnicalFactPersistence`/
 * `createGovernedExecutionContextPersistence` — so a HUMAN actor whose
 * GOVERNANCE_ADMIN role, org/user status, or credential epoch had changed
 * since the decision was first recorded could still "replay" the identical
 * command and receive success without the governed wrapper's
 * require_governed_write_eligibility_v1 guard ever re-checking current
 * authority. These tests drive `submitTechnicalFieldDecision` and
 * `submitExecutionDecision` (the real production entry points) against a
 * fully mocked persistence layer, proving D1-D7 / E1-E7 from the corrective
 * prompt: replay reaches the governed port exactly once, a governed GV006/
 * GV002/55P03 failure propagates unchanged (never converted to a replay
 * success), and a mismatched existing decision never reaches the governed
 * port at all.
 */

const ORG = asOrganisationId("11111111-1111-1111-1111-111111111111");
const WRITE_PRINCIPAL = Object.freeze({
  organisationId: ORG, actorUserId: "human-1",
  issuedAtSeconds: 1_700_000_000, expiresAtSeconds: 1_700_028_800,
  credentialEpoch: "2026-01-01T00:00:00.000000+00:00",
});

// ---------------------------------------------------------------------------
// D — submitTechnicalFieldDecision (packages/governance-review/src/technical-facts.ts)
// ---------------------------------------------------------------------------

const technicalProposal = {
  proposalId: "proposal-1", organisationId: ORG, candidateId: "candidate-1",
  fact: { objectKind: "DATA_ELEMENT", field: "technicalName", value: "ref" },
  support: { assertionIds: ["assertion-1"], evidenceIds: ["evidence-1"] },
  sourceAttribute: { code: "code", path: "path" },
  sourceSystem: { sourceSystemId: "system-1", family: "CATALOG", displayName: "Sys", provider: { providerCode: "fixture", resolution: "EXPLICIT" } },
  sourceObject: { connectionId: "conn-1", externalType: "file", externalId: "ext-1" },
  normalizedObjectIdentity: "norm-1", trustState: "IMPORTED",
} as unknown as TechnicalFactProposal;
const technicalObservation = {
  organisationId: ORG, observationId: "obs-1", proposalId: "proposal-1", candidateId: "candidate-1",
  support: { assertionIds: ["assertion-1"], evidenceIds: ["evidence-1"] },
  observedAt: asIsoTimestamp("2026-01-01T00:00:00.000Z"), snapshotId: "snapshot-1",
} as unknown as TechnicalFactObservation;
const technicalCanonicalObject = { organisationId: ORG, objectId: asCanonicalObjectId("canonical-1"), kind: "DATA_ELEMENT" as const };
const technicalPolicy = {
  organisationId: ORG, policyId: "policy-1", version: "1", objectKind: "DATA_ELEMENT", field: "technicalName",
  sourceSystemId: "system-1", providerCode: "fixture", disposition: "AUTHORITATIVE",
} as unknown as FieldAuthorityPolicy;
const technicalPolicyHead = { organisationId: ORG, policyId: "policy-1", version: "1" } as unknown as FieldAuthorityPolicyHead;

function technicalReviewContext(): FieldReviewContext {
  return {
    proposal: technicalProposal, observations: [technicalObservation], canonicalObjects: [technicalCanonicalObject],
    policies: [technicalPolicy], policyHeads: [technicalPolicyHead],
    currentSourceObservationId: "obs-1", currentSourceSnapshotId: "snapshot-1",
  };
}
const technicalInput = {
  decisionId: "decision-1", canonicalObject: technicalCanonicalObject, field: "technicalName", proposalId: "proposal-1",
  observationIds: ["obs-1"], expectedSourceObservationId: "obs-1", expectedSourceSnapshotId: "snapshot-1",
  policyId: "policy-1", policyVersion: "1", outcome: "ACCEPT_PROPOSED",
};

interface TechnicalWorld {
  previous: { decision: FieldReconciliationDecision; stateId?: string } | undefined;
  recordCalls: FieldReconciliationDecision[];
  recordError: Error | undefined;
  recordReplayOverride: boolean | undefined;
}
const dWorld: TechnicalWorld = { previous: undefined, recordCalls: [], recordError: undefined, recordReplayOverride: undefined };
function resetDWorld() {
  dWorld.previous = undefined; dWorld.recordCalls = []; dWorld.recordError = undefined; dWorld.recordReplayOverride = undefined;
}
const technicalGovernedPort = {
  recordProposal: async () => { throw new Error("recordProposal should not be called from submitTechnicalFieldDecision"); },
  getReviewContext: async () => technicalReviewContext(),
  getDecision: async () => dWorld.previous,
  async recordDecision(d: FieldReconciliationDecision) {
    dWorld.recordCalls.push(d);
    if (dWorld.recordError) throw dWorld.recordError;
    const isReplay = dWorld.recordReplayOverride ?? dWorld.previous !== undefined;
    const stateId = isReplay ? dWorld.previous?.stateId : "state-1";
    dWorld.previous = { decision: d, ...(stateId ? { stateId } : {}) };
    return { replay: isReplay, ...(stateId ? { stateId } : {}) };
  },
};

mock.module("@/lib/governance/technical-fact-persistence", {
  namedExports: {
    configuredTechnicalConnection: async () => { throw new Error("not used"); },
    technicalFactPersistence: { ...technicalGovernedPort, getDecision: async () => dWorld.previous },
    createGovernedTechnicalFactPersistence: () => technicalGovernedPort,
    listTechnicalFactProposalIds: async () => [],
    technicalFieldDecisionHistory: async () => [],
    startExchangeAcquisitionRun: async () => { throw new Error("not used"); },
  },
});
mock.module("@/lib/governance/discovery-intake-persistence", { namedExports: { discoveryIntakePersistence: {} } });
mock.module("@/lib/governance/persistence", { namedExports: { governanceReviewPersistence: {}, createGovernedReviewPersistence: () => ({}) } });
mock.module("@/lib/governance/materialization", { namedExports: { materializationPersistence: {}, createGovernedMaterializationPersistence: () => ({}) } });

let submitTechnicalFieldDecision: typeof import("@/lib/governance/multivendor-exchange").submitTechnicalFieldDecision;
let submitExecutionDecision: typeof import("@/lib/governance/execution-context-review").submitExecutionDecision;
let GovernedWriteError: typeof import("@/lib/governance/governed-write-errors").GovernedWriteError;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ submitTechnicalFieldDecision } = await import("@/lib/governance/multivendor-exchange"));
  ({ submitExecutionDecision } = await import("@/lib/governance/execution-context-review"));
  ({ GovernedWriteError } = await import("@/lib/governance/governed-write-errors"));
});
beforeEach(() => { resetDWorld(); resetEWorld(); });

const dContext = { organisationId: ORG, actorReference: "human-1", writePrincipal: WRITE_PRINCIPAL };

test("D1: submitTechnicalFieldDecision — first valid decision reaches the governed recordDecision", async () => {
  const result = await submitTechnicalFieldDecision(technicalInput as never, dContext);
  assert.equal(result.replay, false);
  assert.equal(dWorld.recordCalls.length, 1);
});

test("D2: submitTechnicalFieldDecision — an exact replay also reaches the governed recordDecision exactly once (never a package-level short-circuit)", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  assert.equal(dWorld.recordCalls.length, 1);
  const result = await submitTechnicalFieldDecision(technicalInput as never, dContext);
  assert.equal(result.replay, true);
  assert.equal(dWorld.recordCalls.length, 2, "the replay must reach recordDecision a second time");
});

test("D3: submitTechnicalFieldDecision — governed recordDecision returning replay=true makes the service return replay=true", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  dWorld.recordReplayOverride = true;
  const result = await submitTechnicalFieldDecision(technicalInput as never, dContext);
  assert.equal(result.replay, true);
});

test("D4: submitTechnicalFieldDecision — governed recordDecision throwing GV006 propagates on replay; it is never converted to a replay success", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  dWorld.recordError = new GovernedWriteError("record_technical_field_decision_governed_v1 failed: M16_WRITE_AUTHORITY_DENIED", "GV006");
  await assert.rejects(
    submitTechnicalFieldDecision(technicalInput as never, dContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV006",
  );
});

test("D5: submitTechnicalFieldDecision — governed recordDecision throwing GV002 propagates on replay", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  dWorld.recordError = new GovernedWriteError("record_technical_field_decision_governed_v1 failed: M16_ELIGIBILITY_CREDENTIAL_STALE", "GV002");
  await assert.rejects(
    submitTechnicalFieldDecision(technicalInput as never, dContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV002",
  );
});

test("D6: submitTechnicalFieldDecision — governed recordDecision throwing 55P03 propagates on replay", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  dWorld.recordError = new GovernedWriteError("record_technical_field_decision_governed_v1 failed: lock not obtained", "55P03");
  await assert.rejects(
    submitTechnicalFieldDecision(technicalInput as never, dContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "55P03",
  );
});

test("D7: submitTechnicalFieldDecision — a mismatched existing decision is FIELD_DECISION_REPLAY_CONFLICT and never calls the governed recordDecision", async () => {
  await submitTechnicalFieldDecision(technicalInput as never, dContext);
  assert.equal(dWorld.recordCalls.length, 1);
  await assert.rejects(
    submitTechnicalFieldDecision({ ...technicalInput, outcome: "DEFER" } as never, dContext),
    /FIELD_DECISION_REPLAY_CONFLICT/,
  );
  assert.equal(dWorld.recordCalls.length, 1, "the mismatched command must never reach the governed persistence boundary");
});

// ---------------------------------------------------------------------------
// E — submitExecutionDecision (packages/governance-review/src/execution-context.ts)
// ---------------------------------------------------------------------------

const time = asIsoTimestamp("2026-09-15T00:00:00.000Z");
const executionSourceObject = { connectionId: asSourceConnectionId("repo"), externalType: "file", externalId: asExternalId("agent.ts") };
const executionSourceScope = executionDigest([sourceObjectIdentityKey(executionSourceObject), "triageAgent"]);
const executionCandidate = `candidate:agent-version:${"a".repeat(32)}`;
const executionFacts: ExecutionSourceSnapshot["facts"] = [{
  fact: { field: "PRINCIPAL", principal: { kind: "SERVICE_ACCOUNT", providerCode: "fixture", authorityReference: "realm", principalReference: "account" } },
  assertionId: "a", evidenceId: "e",
}];
const executionSnapshot: ExecutionSourceSnapshot = {
  organisationId: ORG, sourceScope: executionSourceScope, agentVersionCandidateId: executionCandidate, sourceObject: executionSourceObject,
  sourceSystemId: "system", providerCode: "fixture", declarationKey: "triageAgent", sourceSnapshotId: "snapshot",
  snapshotId: `execution-snapshot:${executionDigest([ORG, executionSourceScope, executionCandidate, "snapshot", executionFacts])}`,
  behaviorFingerprint: createBehaviorFingerprint({ algorithm: "sha256", schemaVersion: "1.0", value: "b".repeat(32) }),
  recordedAt: time, authorizationState: "UNKNOWN", facts: executionFacts,
};
const executionObject = { organisationId: ORG, kind: "AGENT_VERSION" as const, objectId: asCanonicalObjectId("version") };
function executionReviewContext() {
  return {
    snapshot: executionSnapshot, object: executionObject, currentSourceSnapshotId: executionSnapshot.snapshotId,
    policies: [{ organisationId: ORG, objectKind: "AGENT_VERSION" as const, policyId: "policy", version: "1", field: "PRINCIPAL" as const,
      sourceSystemId: "system", providerCode: "fixture", disposition: "CONTRIBUTING" as const }],
    policyHeads: [{ organisationId: ORG, policyId: "policy", version: "1" }],
  };
}
const executionInput = {
  decisionId: "decision-1", canonicalObjectId: "version", snapshotId: executionSnapshot.snapshotId, field: "PRINCIPAL",
  outcome: "ACCEPT_PROPOSED", policyId: "policy", policyVersion: "1",
};

interface ExecutionWorld {
  previous: { decision: unknown; stateId?: string } | undefined;
  recordCalls: unknown[];
  recordError: Error | undefined;
  recordReplayOverride: boolean | undefined;
}
const eWorld: ExecutionWorld = { previous: undefined, recordCalls: [], recordError: undefined, recordReplayOverride: undefined };
function resetEWorld() { eWorld.previous = undefined; eWorld.recordCalls = []; eWorld.recordError = undefined; eWorld.recordReplayOverride = undefined; }
const executionGovernedPort = {
  recordSnapshot: async () => { throw new Error("recordSnapshot should not be called from submitExecutionDecision"); },
  getReviewContext: async () => executionReviewContext(),
  getDecision: async () => eWorld.previous,
  async recordDecision(d: unknown) {
    eWorld.recordCalls.push(d);
    if (eWorld.recordError) throw eWorld.recordError;
    const isReplay = eWorld.recordReplayOverride ?? eWorld.previous !== undefined;
    const stateId = isReplay ? eWorld.previous?.stateId : "state-1";
    eWorld.previous = { decision: d, ...(stateId ? { stateId } : {}) };
    return { replay: isReplay, ...(stateId ? { stateId } : {}) };
  },
};
mock.module("@/lib/governance/execution-context-persistence", {
  namedExports: { createGovernedExecutionContextPersistence: () => executionGovernedPort },
});
mock.module("@/lib/governance/execution-context-read", {
  namedExports: {
    executionRows: async () => [],
    readExecutionReview: async () => { throw new Error("not used"); },
    // Mirrors real readExecutionDecision: reuses the persisted decidedAt on a
    // retry/replay, exactly like the technical-fact mock below already does —
    // otherwise a fresh Date.now() each call could itself look like a content
    // mismatch to reconcileExecutionField's own stableCandidateContent check.
    readExecutionDecision: async () => eWorld.previous,
  },
});

const eContext = { organisationId: ORG, actorReference: "human-1", writePrincipal: WRITE_PRINCIPAL };

test("E1: submitExecutionDecision — first valid decision reaches the governed recordDecision", async () => {
  const result = await submitExecutionDecision(executionInput, eContext);
  assert.equal(result.replay, false);
  assert.equal(eWorld.recordCalls.length, 1);
});

test("E2: submitExecutionDecision — an exact replay also reaches the governed recordDecision exactly once", async () => {
  await submitExecutionDecision(executionInput, eContext);
  assert.equal(eWorld.recordCalls.length, 1);
  const result = await submitExecutionDecision(executionInput, eContext);
  assert.equal(result.replay, true);
  assert.equal(eWorld.recordCalls.length, 2, "the replay must reach recordDecision a second time");
});

test("E3: submitExecutionDecision — governed recordDecision returning replay=true makes the service return replay=true", async () => {
  await submitExecutionDecision(executionInput, eContext);
  eWorld.recordReplayOverride = true;
  const result = await submitExecutionDecision(executionInput, eContext);
  assert.equal(result.replay, true);
});

test("E4: submitExecutionDecision — governed recordDecision throwing GV006 propagates on replay; it is never converted to a replay success", async () => {
  await submitExecutionDecision(executionInput, eContext);
  eWorld.recordError = new GovernedWriteError("record_execution_field_decision_governed_v1 failed: M16_WRITE_AUTHORITY_DENIED", "GV006");
  await assert.rejects(
    submitExecutionDecision(executionInput, eContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV006",
  );
});

test("E5: submitExecutionDecision — governed recordDecision throwing GV002 propagates on replay", async () => {
  await submitExecutionDecision(executionInput, eContext);
  eWorld.recordError = new GovernedWriteError("record_execution_field_decision_governed_v1 failed: M16_ELIGIBILITY_CREDENTIAL_STALE", "GV002");
  await assert.rejects(
    submitExecutionDecision(executionInput, eContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "GV002",
  );
});

test("E6: submitExecutionDecision — governed recordDecision throwing 55P03 propagates on replay", async () => {
  await submitExecutionDecision(executionInput, eContext);
  eWorld.recordError = new GovernedWriteError("record_execution_field_decision_governed_v1 failed: lock not obtained", "55P03");
  await assert.rejects(
    submitExecutionDecision(executionInput, eContext),
    (error: unknown) => error instanceof GovernedWriteError && error.code === "55P03",
  );
});

test("E7: submitExecutionDecision — a mismatched existing decision is EXECUTION_REPLAY_CONFLICT and never calls the governed recordDecision", async () => {
  await submitExecutionDecision(executionInput, eContext);
  assert.equal(eWorld.recordCalls.length, 1);
  await assert.rejects(
    submitExecutionDecision({ ...executionInput, outcome: "DEFER" }, eContext),
    /EXECUTION_REPLAY_CONFLICT/,
  );
  assert.equal(eWorld.recordCalls.length, 1, "the mismatched command must never reach the governed persistence boundary");
});
