import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OBJECT_KIND,
  RECONCILIATION_OUTCOME,
  RELATIONSHIP_RECONCILIATION_OUTCOME,
  asAgentId,
  asAgentVersionId,
  asOrganisationId,
  asRelationshipId,
  asRelationshipStateId,
  type AgentIdentity,
  type CanonicalObjectKind,
  type AgentVersionIdentity,
  type GovernedRelationshipDraft,
  type MergeCandidatesReconciliationDecision,
  type OrganisationId,
  type ReconciliationDecision,
  type RelationshipMatchReference,
  type RelationshipReconciliationDecision,
} from "@council/canonical-contracts";

import {
  HUMAN_ALICE,
  HUMAN_BOB,
  LATER_AT,
  MACHINE_RULE,
  OBSERVED_AT,
  ORG_A,
  makeAllowingAuthorizationPort,
  makeCanonicalObjectIdentity,
  makeObjectCandidate,
  makeObjectFinding,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

import {
  certify,
  confirm,
  createReviewSubject,
  invokeMergeCandidatesReconciliation,
  invokeObjectReconciliation,
  invokeRelationshipReconciliation,
  propose,
  REVIEW_STATE,
  asReviewSubjectId,
  MaterializationAuthorityError,
  materializeReconciliationDecision,
  type GovernanceReviewPersistencePort,
  type MaterializationPersistencePort,
  type MaterializationPorts,
  type ObjectMaterializationInput,
  type ObjectMaterializationResult,
  type ReconciliationAuditChainEntry,
  type RelationshipMaterializationInput,
  type RelationshipMaterializationResult,
  type ReviewSubject,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function certifyObjectCandidate(seed: string, org: OrganisationId = ORG_A) {
  const finding = makeObjectFinding("AGENT", seed);
  const candidate = makeObjectCandidate(finding, seed);
  let subject = createReviewSubject({
    reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
    organisationId: org,
    finding,
    candidate,
  });
  subject = propose(subject, {
    commandId: `cmd:${seed}:propose`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.DETECTED,
    actor: MACHINE_RULE,
    occurredAt: OBSERVED_AT,
  }).subject;
  subject = confirm(subject, {
    commandId: `cmd:${seed}:confirm`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.PROPOSED,
    actor: HUMAN_ALICE,
    occurredAt: LATER_AT,
  }).subject;
  subject = certify(subject, {
    commandId: `cmd:${seed}:certify`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.CONFIRMED,
    actor: HUMAN_BOB,
    occurredAt: LATER_AT,
    reasonCode: "GOVERNANCE_BOARD_APPROVED",
  }).subject;
  return { finding, candidate, subject };
}

async function buildObjectDecisionChain(
  seed: string,
  outcome: "CREATE_NEW" | "MATCH_EXISTING" | "REJECT" | "DEFER",
  org: OrganisationId = ORG_A,
): Promise<{ chain: ReconciliationAuditChainEntry; subject: ReviewSubject }> {
  const { finding, candidate, subject } = certifyObjectCandidate(seed, org);
  const canonicalObject = makeCanonicalObjectIdentity(org, CANONICAL_OBJECT_KIND.AGENT, seed);
  const port = makeAllowingAuthorizationPort({
    organisationId: org,
    subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
    requestedAction: outcome,
    actor: HUMAN_ALICE,
  });

  const requestedDecision =
    outcome === "CREATE_NEW" || outcome === "MATCH_EXISTING"
      ? {
          outcome,
          subject: { subjectKind: "CANDIDATE" as const, candidateId: candidate.candidateId, candidateKind: "AGENT" as const },
          canonicalObject,
        }
      : {
          outcome,
          subject: { subjectKind: "CANDIDATE" as const, candidateId: candidate.candidateId, candidateKind: "AGENT" as const },
        };

  const result = await invokeObjectReconciliation({
    commandId: `cmd:${seed}:reconcile`,
    organisationId: org,
    reviewSubject: subject,
    finding,
    candidate,
    actor: HUMAN_ALICE,
    authorizationPort: port,
    reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
    requestedAt: LATER_AT,
    requestedDecision,
  });
  assert.equal(result.kind, "APPLIED");

  const chain: ReconciliationAuditChainEntry = {
    family: "OBJECT",
    authorization: result.authorization,
    invocation: result.audit,
    decision: result.decision as ReconciliationDecision,
  };
  return { chain, subject };
}

async function buildRelationshipDecisionChain(
  seed: string,
  outcome: "CREATE_NEW" | "MATCH_EXISTING" | "REJECT" | "DEFER",
  org: OrganisationId = ORG_A,
): Promise<{ chain: ReconciliationAuditChainEntry; state: GovernedRelationshipDraft<"HANDOFF_TO"> }> {
  const finding = makeRelationshipFinding(seed);
  const candidate = makeRelationshipCandidate(finding, seed, {
    relationshipTypeCode: "HANDOFF_TO",
    sourceCandidateKind: CANONICAL_OBJECT_KIND.AGENT_VERSION,
    targetCandidateKind: CANONICAL_OBJECT_KIND.AGENT,
  });
  let subject = createReviewSubject({
    reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
    organisationId: org,
    finding,
    candidate,
  });
  subject = propose(subject, {
    commandId: `cmd:${seed}:propose`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.DETECTED,
    actor: MACHINE_RULE,
    occurredAt: OBSERVED_AT,
  }).subject;
  subject = confirm(subject, {
    commandId: `cmd:${seed}:confirm`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.PROPOSED,
    actor: HUMAN_ALICE,
    occurredAt: LATER_AT,
  }).subject;
  subject = certify(subject, {
    commandId: `cmd:${seed}:certify`,
    organisationId: org,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.CONFIRMED,
    actor: HUMAN_BOB,
    occurredAt: LATER_AT,
    reasonCode: "GOVERNANCE_BOARD_APPROVED",
  }).subject;

  const sourceAgent: AgentIdentity = {
    canonicalObject: makeCanonicalObjectIdentity(org, CANONICAL_OBJECT_KIND.AGENT, `${seed}-source-agent`),
    agentId: asAgentId(`agent:${seed}-source`),
    agentCode: "SOURCE_AGENT",
  };
  const source: AgentVersionIdentity = {
    canonicalObject: makeCanonicalObjectIdentity(org, CANONICAL_OBJECT_KIND.AGENT_VERSION, `${seed}-source-version`),
    agent: sourceAgent,
    agentVersionId: asAgentVersionId(`agent-version:${seed}`),
    versionCode: "v1",
  };
  const target: AgentIdentity = {
    canonicalObject: makeCanonicalObjectIdentity(org, CANONICAL_OBJECT_KIND.AGENT, `${seed}-target`),
    agentId: asAgentId(`agent:${seed}-target`),
    agentCode: "TARGET_AGENT",
  };
  const authorizedState: GovernedRelationshipDraft<"HANDOFF_TO"> = {
    relationshipId: asRelationshipId(`relationship:${seed}`),
    relationshipStateId: asRelationshipStateId(`relationship-state:${seed}`),
    organisationId: org,
    relationshipType: "HANDOFF_TO",
    source,
    target,
    support: { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds },
    validFrom: LATER_AT,
    recordedAt: LATER_AT,
  };
  const matchedState: RelationshipMatchReference<"HANDOFF_TO"> = {
    relationshipId: authorizedState.relationshipId,
    relationshipStateId: authorizedState.relationshipStateId,
    organisationId: org,
    relationshipType: "HANDOFF_TO",
    source,
    target,
  };

  const port = makeAllowingAuthorizationPort({
    organisationId: org,
    subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
    requestedAction: outcome,
    actor: HUMAN_ALICE,
  });

  const requestedDecision =
    outcome === "CREATE_NEW"
      ? { outcome: "CREATE_NEW" as const, authorizedState }
      : outcome === "MATCH_EXISTING"
        ? { outcome: "MATCH_EXISTING" as const, matchedState }
        : { outcome };

  const result = await invokeRelationshipReconciliation({
    commandId: `cmd:${seed}:reconcile`,
    organisationId: org,
    reviewSubject: subject,
    finding,
    candidate,
    actor: HUMAN_ALICE,
    authorizationPort: port,
    reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
    requestedAt: LATER_AT,
    requestedDecision,
  });
  assert.equal(result.kind, "APPLIED");

  const chain: ReconciliationAuditChainEntry = {
    family: "RELATIONSHIP",
    authorization: result.authorization,
    invocation: result.audit,
    decision: result.decision as RelationshipReconciliationDecision,
  };
  return { chain, state: authorizedState };
}

interface FakeMaterializationState {
  readonly canonicalObjects: Map<string, string>; // "org:objectId" -> kind
  readonly sourceMappings: Map<string, string>; // "org:conn:type:extId" -> objectId
  readonly relationships: Map<string, { type: string; source: string; target: string }>; // "org:relationshipId"
  readonly activeEdges: Set<string>; // "org:type:source:target"
  readonly operations: Map<string, { fingerprint: string; result: unknown }>; // "org:decisionId"
  readonly objectCalls: ObjectMaterializationInput[];
  readonly relationshipCalls: RelationshipMaterializationInput[];
}

function makeFakeMaterializationPort(): { port: MaterializationPersistencePort; state: FakeMaterializationState } {
  const state: FakeMaterializationState = {
    canonicalObjects: new Map(),
    sourceMappings: new Map(),
    relationships: new Map(),
    activeEdges: new Set(),
    operations: new Map(),
    objectCalls: [],
    relationshipCalls: [],
  };

  const port: MaterializationPersistencePort = {
    async materializeObjectReconciliation(input): Promise<ObjectMaterializationResult> {
      state.objectCalls.push(input);
      const opKey = `${input.organisationId}:${input.reconciliationDecisionId}`;
      const existingOp = state.operations.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== input.idempotencyFingerprint) {
          throw new Error("MATERIALIZATION_IDEMPOTENCY_CONFLICT");
        }
        return { replay: true, ...(existingOp.result as Omit<ObjectMaterializationResult, "replay">) };
      }

      const objKey = `${input.organisationId}:${input.canonicalObjectId}`;
      if (input.outcome === "CREATE_NEW") {
        if (state.canonicalObjects.has(objKey)) {
          throw new Error("CANONICAL_OBJECT_IDENTITY_CONFLICT");
        }
        state.canonicalObjects.set(objKey, input.canonicalObjectKind);
      } else {
        const existingKind = state.canonicalObjects.get(objKey);
        if (existingKind === undefined || existingKind !== input.canonicalObjectKind) {
          throw new Error("MATCH_EXISTING_TARGET_NOT_FOUND");
        }
      }

      const sourceKey = `${input.organisationId}:${input.sourceConnectionId}:${input.sourceExternalType}:${input.sourceExternalId}`;
      const existingMapping = state.sourceMappings.get(sourceKey);
      if (existingMapping !== undefined && existingMapping !== input.canonicalObjectId) {
        throw new Error("SOURCE_IDENTITY_ALREADY_MAPPED");
      }
      state.sourceMappings.set(sourceKey, input.canonicalObjectId);

      const result: Omit<ObjectMaterializationResult, "replay"> = {
        status: "APPLIED",
        canonicalObjectId: input.canonicalObjectId,
        mappingId: `mapping:${input.reconciliationDecisionId}`,
      };
      state.operations.set(opKey, { fingerprint: input.idempotencyFingerprint, result });
      return { replay: false, ...result };
    },

    async materializeRelationshipReconciliation(input): Promise<RelationshipMaterializationResult> {
      state.relationshipCalls.push(input);
      const opKey = `${input.organisationId}:${input.reconciliationDecisionId}`;
      const existingOp = state.operations.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== input.idempotencyFingerprint) {
          throw new Error("MATERIALIZATION_IDEMPOTENCY_CONFLICT");
        }
        return { replay: true, ...(existingOp.result as Omit<RelationshipMaterializationResult, "replay">) };
      }

      if (input.outcome === "CREATE_NEW") {
        const sourceKey = `${input.organisationId}:${input.sourceCanonicalObjectId}`;
        const targetKey = `${input.organisationId}:${input.targetCanonicalObjectId}`;
        if (
          state.canonicalObjects.get(sourceKey) !== input.sourceKind ||
          state.canonicalObjects.get(targetKey) !== input.targetKind
        ) {
          throw new Error("RELATIONSHIP_ENDPOINT_NOT_FOUND");
        }
        const edgeKey = `${input.organisationId}:${input.relationshipType}:${input.sourceCanonicalObjectId}:${input.targetCanonicalObjectId}`;
        if (state.activeEdges.has(edgeKey)) {
          throw new Error("DUPLICATE_GOVERNED_RELATIONSHIP_EDGE");
        }
        state.activeEdges.add(edgeKey);
        state.relationships.set(`${input.organisationId}:${input.relationshipId}`, {
          type: input.relationshipType,
          source: input.sourceCanonicalObjectId,
          target: input.targetCanonicalObjectId,
        });
      } else {
        const existing = state.relationships.get(`${input.organisationId}:${input.relationshipId}`);
        if (
          !existing ||
          existing.type !== input.relationshipType ||
          existing.source !== input.sourceCanonicalObjectId ||
          existing.target !== input.targetCanonicalObjectId
        ) {
          throw new Error("MATCH_EXISTING_RELATIONSHIP_NOT_FOUND");
        }
      }

      const result: Omit<RelationshipMaterializationResult, "replay"> = {
        status: "APPLIED",
        relationshipId: input.relationshipId,
      };
      state.operations.set(opKey, { fingerprint: input.idempotencyFingerprint, result });
      return { replay: false, ...result };
    },

    async findActiveObjectSourceMapping(input) {
      const sourceKey = `${input.organisationId}:${input.sourceConnectionId}:${input.sourceExternalType}:${input.sourceExternalId}`;
      const canonicalObjectId = state.sourceMappings.get(sourceKey);
      if (canonicalObjectId === undefined) return undefined;
      const canonicalObjectKind = state.canonicalObjects.get(`${input.organisationId}:${canonicalObjectId}`) as
        | CanonicalObjectKind
        | undefined;
      if (canonicalObjectKind === undefined) return undefined;
      return { mappingId: `mapping:${sourceKey}`, canonicalObjectId, canonicalObjectKind };
    },
  };

  return { port, state };
}

function makeFakeGovernancePort(
  chains: readonly ReconciliationAuditChainEntry[],
  subjects: readonly ReviewSubject[],
): GovernanceReviewPersistencePort {
  const chainMap = new Map(chains.map((c) => [`${c.decision.organisationId}:${c.decision.decisionId}`, c]));
  const subjectMap = new Map(subjects.map((s) => [`${s.organisationId}:${s.reviewSubjectId}`, s]));
  const notImplemented = () => {
    throw new Error("not implemented in this fake");
  };
  return {
    createReviewSubject: notImplemented,
    getReviewSubject: async (organisationId, reviewSubjectId) => subjectMap.get(`${organisationId}:${reviewSubjectId}`),
    persistReviewTransition: notImplemented,
    getReviewAuditChain: notImplemented,
    persistAuthorizationDecision: notImplemented,
    persistAuthorizedReconciliation: notImplemented,
    getReconciliationAuditChain: async (organisationId, reconciliationDecisionId) =>
      chainMap.get(`${organisationId}:${reconciliationDecisionId}`),
  };
}

function makePorts(
  chains: readonly ReconciliationAuditChainEntry[],
  subjects: readonly ReviewSubject[],
): { ports: MaterializationPorts; materializationState: FakeMaterializationState } {
  const { port: materialization, state: materializationState } = makeFakeMaterializationPort();
  return {
    ports: { governance: makeFakeGovernancePort(chains, subjects), materialization },
    materializationState,
  };
}

// ---------------------------------------------------------------------------
// OBJECT CREATE_NEW / MATCH_EXISTING
// ---------------------------------------------------------------------------

describe("object materialization", () => {
  it("valid CREATE_NEW decision materializes a canonical object with kind, identity, and tenant preserved", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-create-1", "CREATE_NEW");
    const { ports, materializationState } = makePorts([chain], [subject]);

    const outcome = await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });

    assert.equal(outcome.applicable, true);
    if (!outcome.applicable) throw new Error("unreachable");
    assert.equal(outcome.family, "OBJECT");
    assert.equal(outcome.result.replay, false);
    assert.equal(outcome.result.status, "APPLIED");
    const call = materializationState.objectCalls[0]!;
    assert.equal(call.canonicalObjectKind, "AGENT");
    assert.equal(call.organisationId, ORG_A);
    assert.equal(materializationState.sourceMappings.size, 1);
  });

  it("replaying the same decision returns the same result without a second conflicting write", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-replay-1", "CREATE_NEW");
    const { ports } = makePorts([chain], [subject]);

    const input = { organisationId: ORG_A, reconciliationDecisionId: chain.decision.decisionId };
    const first = await materializeReconciliationDecision(ports, input);
    const second = await materializeReconciliationDecision(ports, input);

    assert.equal(first.applicable, true);
    assert.equal(second.applicable, true);
    if (!first.applicable || !second.applicable) throw new Error("unreachable");
    assert.equal(second.result.replay, true);
    assert.deepEqual(
      first.family === "OBJECT" ? first.result.canonicalObjectId : undefined,
      second.family === "OBJECT" ? second.result.canonicalObjectId : undefined,
    );
  });

  it("MATCH_EXISTING binds to the existing object without creating a second one", async () => {
    const { chain: createChain, subject: createSubject } = await buildObjectDecisionChain(
      "obj-match-1-create",
      "CREATE_NEW",
    );
    const { ports, materializationState } = makePorts([createChain], [createSubject]);
    await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: createChain.decision.decisionId,
    });
    assert.equal(materializationState.canonicalObjects.size, 1);

    // A second certified candidate, reconciled as MATCH_EXISTING against the
    // same canonical object identity that CREATE_NEW just materialized.
    const { finding, candidate, subject: matchSubject } = certifyObjectCandidate("obj-match-1-match", ORG_A);
    const canonicalObject = makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "obj-match-1-create");
    const port = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.MATCH_EXISTING,
      actor: HUMAN_ALICE,
    });
    const invoked = await invokeObjectReconciliation({
      commandId: "cmd:obj-match-1-match:reconcile",
      organisationId: ORG_A,
      reviewSubject: matchSubject,
      finding,
      candidate,
      actor: HUMAN_ALICE,
      authorizationPort: port,
      reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
      requestedAt: LATER_AT,
      requestedDecision: {
        outcome: "MATCH_EXISTING",
        subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
        canonicalObject,
      },
    });
    assert.equal(invoked.kind, "APPLIED");
    const matchChain: ReconciliationAuditChainEntry = {
      family: "OBJECT",
      authorization: invoked.authorization,
      invocation: invoked.audit,
      decision: invoked.decision as ReconciliationDecision,
    };

    const portsWithBoth: MaterializationPorts = {
      governance: makeFakeGovernancePort([createChain, matchChain], [createSubject, matchSubject]),
      materialization: ports.materialization,
    };

    const result = await materializeReconciliationDecision(portsWithBoth, {
      organisationId: ORG_A,
      reconciliationDecisionId: matchChain.decision.decisionId,
    });

    assert.equal(result.applicable, true);
    if (!result.applicable) throw new Error("unreachable");
    assert.equal(result.family, "OBJECT");
    assert.equal(result.result.replay, false);
    assert.equal(materializationState.canonicalObjects.size, 1, "no second canonical object was created");
    assert.equal(materializationState.sourceMappings.size, 2, "a second, distinct source mapping was created");
  });

  it("MATCH_EXISTING against a target that was never created fails closed", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-match-missing-1", "MATCH_EXISTING");
    const { ports } = makePorts([chain], [subject]);

    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      /MATCH_EXISTING_TARGET_NOT_FOUND/,
    );
  });

  it("REJECT never creates a canonical object", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-reject-1", "REJECT");
    const { ports, materializationState } = makePorts([chain], [subject]);

    const result = await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });

    assert.equal(result.applicable, false);
    assert.equal(materializationState.canonicalObjects.size, 0);
    assert.equal(materializationState.objectCalls.length, 0);
  });

  it("DEFER never creates a canonical object and is not converted into a failure", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-defer-1", "DEFER");
    const { ports, materializationState } = makePorts([chain], [subject]);

    const result = await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });

    assert.equal(result.applicable, false);
    assert.equal(materializationState.canonicalObjects.size, 0);
  });
});

// ---------------------------------------------------------------------------
// RELATIONSHIP CREATE_NEW / MATCH_EXISTING
// ---------------------------------------------------------------------------

describe("relationship materialization", () => {
  async function materializeEndpoints(ports: MaterializationPorts, state: GovernedRelationshipDraft<"HANDOFF_TO">) {
    await ports.materialization.materializeObjectReconciliation({
      organisationId: state.organisationId,
      reconciliationDecisionId: `seed-decision:${state.source.canonicalObject.objectId}`,
      invocationId: "seed-invocation",
      outcome: "CREATE_NEW",
      canonicalObjectId: state.source.canonicalObject.objectId,
      canonicalObjectKind: state.source.canonicalObject.kind,
      sourceConnectionId: "connection:seed",
      sourceExternalType: "seed",
      sourceExternalId: `seed:${state.source.canonicalObject.objectId}`,
      matchMethod: "MANUAL",
      idempotencyFingerprint: "0".repeat(64),
      occurredAt: OBSERVED_AT,
    });
    await ports.materialization.materializeObjectReconciliation({
      organisationId: state.organisationId,
      reconciliationDecisionId: `seed-decision:${state.target.canonicalObject.objectId}`,
      invocationId: "seed-invocation",
      outcome: "CREATE_NEW",
      canonicalObjectId: state.target.canonicalObject.objectId,
      canonicalObjectKind: state.target.canonicalObject.kind,
      sourceConnectionId: "connection:seed",
      sourceExternalType: "seed",
      sourceExternalId: `seed:${state.target.canonicalObject.objectId}`,
      matchMethod: "MANUAL",
      idempotencyFingerprint: "1".repeat(64),
      occurredAt: OBSERVED_AT,
    });
  }

  it("valid CREATE_NEW creates a governed edge with direction and endpoints preserved", async () => {
    const { chain, state } = await buildRelationshipDecisionChain("rel-create-1", "CREATE_NEW");
    const { ports, materializationState } = makePorts([chain], []);
    await materializeEndpoints(ports, state);

    const result = await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });

    assert.equal(result.applicable, true);
    if (!result.applicable) throw new Error("unreachable");
    assert.equal(result.family, "RELATIONSHIP");
    const call = materializationState.relationshipCalls[0]!;
    assert.equal(call.relationshipType, "HANDOFF_TO");
    assert.equal(call.sourceCanonicalObjectId, state.source.canonicalObject.objectId);
    assert.equal(call.targetCanonicalObjectId, state.target.canonicalObject.objectId);
  });

  it("CREATE_NEW fails when an endpoint was never materialized as a canonical object", async () => {
    const { chain } = await buildRelationshipDecisionChain("rel-missing-endpoint-1", "CREATE_NEW");
    const { ports } = makePorts([chain], []);
    // Endpoints deliberately not seeded via materializeEndpoints.

    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      /RELATIONSHIP_ENDPOINT_NOT_FOUND/,
    );
  });

  it("MATCH_EXISTING binds without duplicating the edge", async () => {
    const { chain: createChain, state } = await buildRelationshipDecisionChain("rel-match-1-create", "CREATE_NEW");
    const { ports, materializationState } = makePorts([createChain], []);
    await materializeEndpoints(ports, state);
    await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: createChain.decision.decisionId,
    });
    assert.equal(materializationState.activeEdges.size, 1);

    const { chain: matchChain } = await buildRelationshipDecisionChain("rel-match-1-match", "MATCH_EXISTING");
    // MATCH_EXISTING references a *different* relationshipId by construction
    // in this fixture helper (each seed derives its own), so directly assert
    // the no-duplication behavior against the same relationshipId instead:
    // reconcile a MATCH_EXISTING decision whose matchedState points at the
    // edge CREATE_NEW already materialized.
    const sameEdgeMatch: ReconciliationAuditChainEntry = {
      family: "RELATIONSHIP",
      authorization: matchChain.authorization,
      invocation: matchChain.invocation,
      decision: {
        ...(matchChain.decision as RelationshipReconciliationDecision),
        matchedState: {
          relationshipId: state.relationshipId,
          relationshipStateId: state.relationshipStateId,
          organisationId: state.organisationId,
          relationshipType: state.relationshipType,
          source: state.source,
          target: state.target,
        },
      } as RelationshipReconciliationDecision,
    };

    const portsWithBoth: MaterializationPorts = {
      governance: makeFakeGovernancePort([sameEdgeMatch], []),
      materialization: ports.materialization,
    };

    const result = await materializeReconciliationDecision(portsWithBoth, {
      organisationId: ORG_A,
      reconciliationDecisionId: sameEdgeMatch.decision.decisionId,
    });

    assert.equal(result.applicable, true);
    if (!result.applicable) throw new Error("unreachable");
    assert.equal(materializationState.activeEdges.size, 1, "no duplicate edge was created");
  });

  it("REJECT and DEFER create no edge", async () => {
    for (const outcome of ["REJECT", "DEFER"] as const) {
      const { chain } = await buildRelationshipDecisionChain(`rel-${outcome.toLowerCase()}-1`, outcome);
      const { ports, materializationState } = makePorts([chain], []);

      const result = await materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      });

      assert.equal(result.applicable, false);
      assert.equal(materializationState.activeEdges.size, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// AUTHORITY CHAIN
// ---------------------------------------------------------------------------

describe("authority chain", () => {
  it("fails when no persisted reconciliation decision exists", async () => {
    const { ports } = makePorts([], []);
    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: "reconciliation-decision:does-not-exist",
      }),
      MaterializationAuthorityError,
    );
  });

  it("fails when the invocation does not point back at the requested decision", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-bad-invocation-1", "CREATE_NEW");
    const forgedChain: ReconciliationAuditChainEntry = {
      ...chain,
      invocation: { ...chain.invocation, reconciliationDecisionId: "reconciliation-decision:forged" as never },
    };
    const { ports } = makePorts([forgedChain], [subject]);

    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      MaterializationAuthorityError,
    );
  });

  it("fails when the decision belongs to a different organisation than requested", async () => {
    const orgB = asOrganisationId("org:other-tenant");
    const { chain, subject } = await buildObjectDecisionChain("obj-wrong-org-1", "CREATE_NEW", orgB);
    const { ports } = makePorts([chain], [subject]);

    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      MaterializationAuthorityError,
    );
  });

  it("fails when the certified review subject behind the decision cannot be found", async () => {
    const { chain } = await buildObjectDecisionChain("obj-missing-subject-1", "CREATE_NEW");
    const { ports } = makePorts([chain], []); // subject deliberately not registered

    await assert.rejects(
      materializeReconciliationDecision(ports, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      MaterializationAuthorityError,
    );
  });

  it("MERGE_CANDIDATES has no canonical-object materialization target", async () => {
    const left = await buildLeftMergeContributor("merge-left-1");
    const right = await buildLeftMergeContributor("merge-right-1");
    const port = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE_MERGE", candidateMergeId: "candidate-merge:test-1" as never },
      requestedAction: RECONCILIATION_OUTCOME.MERGE_CANDIDATES,
      actor: HUMAN_ALICE,
    });
    const result = await invokeMergeCandidatesReconciliation({
      commandId: "cmd:merge-1:reconcile",
      organisationId: ORG_A,
      candidateMergeId: "candidate-merge:test-1" as never,
      contributors: [
        { reviewSubject: left.subject, finding: left.finding, candidate: left.candidate },
        { reviewSubject: right.subject, finding: right.finding, candidate: right.candidate },
      ],
      actor: HUMAN_ALICE,
      authorizationPort: port,
      reasonCode: "GOVERNANCE_BOARD_APPROVED_MERGE",
      requestedAt: LATER_AT,
    });
    assert.equal(result.kind, "APPLIED");

    const chain: ReconciliationAuditChainEntry = {
      family: "CANDIDATE_MERGE",
      authorization: result.authorization,
      invocation: result.audit,
      decision: result.decision as MergeCandidatesReconciliationDecision,
    };
    const { ports } = makePorts([chain], [left.subject, right.subject]);

    const outcome = await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });
    assert.equal(outcome.applicable, false);
    if (outcome.applicable) throw new Error("unreachable");
    assert.equal(outcome.reason, "CANDIDATE_MERGE_HAS_NO_OBJECT_TARGET");
  });

  async function buildLeftMergeContributor(seed: string) {
    const { finding, candidate, subject } = certifyObjectCandidate(seed);
    return { finding, candidate, subject };
  }
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("a decision replayed with the same effective source identity replays cleanly", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-idem-1", "CREATE_NEW");
    const { ports } = makePorts([chain], [subject]);
    const input = { organisationId: ORG_A, reconciliationDecisionId: chain.decision.decisionId };

    const [first, second] = await Promise.all([
      materializeReconciliationDecision(ports, input),
      materializeReconciliationDecision(ports, input),
    ]);
    assert.equal(first.applicable, true);
    assert.equal(second.applicable, true);
    // Exactly one of the two calls should observe replay=false (the "winner"); this fake port is not itself concurrency-safe across a race the way the real RPC lock is, but exercises the same replay contract.
    const replays = [first, second].map((r) => (r.applicable ? r.result.replay : undefined));
    assert.ok(replays.includes(false));
  });

  it("a decision whose underlying review subject source identity changed between calls fails closed", async () => {
    const { chain, subject } = await buildObjectDecisionChain("obj-idem-conflict-1", "CREATE_NEW");
    const mutatedSubject: ReviewSubject = {
      ...subject,
      sourceObject: {
        ...subject.sourceObject,
        externalId: "repo/mutated-target.ts" as never,
      },
    };
    const { ports } = makePorts([chain], [subject]);

    await materializeReconciliationDecision(ports, {
      organisationId: ORG_A,
      reconciliationDecisionId: chain.decision.decisionId,
    });

    const mutatedPorts: MaterializationPorts = {
      governance: makeFakeGovernancePort([chain], [mutatedSubject]),
      materialization: ports.materialization,
    };

    await assert.rejects(
      materializeReconciliationDecision(mutatedPorts, {
        organisationId: ORG_A,
        reconciliationDecisionId: chain.decision.decisionId,
      }),
      /MATERIALIZATION_IDEMPOTENCY_CONFLICT/,
    );
  });
});
