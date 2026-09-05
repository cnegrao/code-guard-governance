import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OBJECT_KIND,
  RECONCILIATION_OUTCOME,
  RELATIONSHIP_RECONCILIATION_OUTCOME,
  asAgentId,
  asAgentVersionId,
  asRelationshipId,
  asRelationshipStateId,
  type AgentIdentity,
  type AgentVersionIdentity,
  type GovernedRelationshipDraft,
} from "@council/canonical-contracts";

import {
  ActorAuthorizationMismatchError,
  AuthorizationDeniedError,
  AuthorizationPortRequiredError,
  AuthorizationScopeMismatchError,
  ContextMismatchError,
  IdempotencyConflictError,
  MachineAuthorityForbiddenError,
  REVIEW_STATE,
  ReviewSubjectNotCertifiedError,
  SubjectMismatchError,
  asReviewSubjectId,
  certify,
  confirm,
  createReviewSubject,
  invokeMergeCandidatesReconciliation,
  invokeObjectReconciliation,
  invokeRelationshipReconciliation,
  propose,
  reject,
  type ObjectReconciliationInvocationCommand,
  type ReconciliationInvocationAuditEvent,
  type RelationshipReconciliationInvocationCommand,
} from "../src/index.ts";
import {
  DENY_ALL_AUTHORIZATION_PORT,
  HUMAN_ALICE,
  HUMAN_BOB,
  LATER_AT,
  MACHINE_RULE,
  OBSERVED_AT,
  ORG_A,
  ORG_B,
  makeAgentFinding,
  makeAllowingAuthorizationPort,
  makeCanonicalObjectIdentity,
  makeFixedResultAuthorizationPort,
  makeObjectCandidate,
  makeObjectFinding,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

/** Drives a fresh finding through the full HITL lifecycle to CERTIFIED, human-gated at every step. */
function certifyAgentCandidate(seed: string) {
  const finding = makeAgentFinding(seed);
  const candidate = makeObjectCandidate(finding, seed);
  let subject = createReviewSubject({
    reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
    organisationId: ORG_A,
    finding,
    candidate,
  });

  subject = propose(subject, {
    commandId: `cmd:${seed}:propose`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.DETECTED,
    actor: MACHINE_RULE,
    occurredAt: OBSERVED_AT,
  }).subject;
  subject = confirm(subject, {
    commandId: `cmd:${seed}:confirm`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.PROPOSED,
    actor: HUMAN_ALICE,
    occurredAt: LATER_AT,
  }).subject;
  subject = certify(subject, {
    commandId: `cmd:${seed}:certify`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.CONFIRMED,
    actor: HUMAN_BOB,
    occurredAt: LATER_AT,
    reasonCode: "GOVERNANCE_BOARD_APPROVED",
  }).subject;

  return { finding, candidate, subject };
}

function certifyRelationshipCandidate(
  seed: string,
  candidateOptions: Parameters<typeof makeRelationshipCandidate>[2] = {},
) {
  const finding = makeRelationshipFinding(seed);
  const candidate = makeRelationshipCandidate(finding, seed, candidateOptions);
  let subject = createReviewSubject({
    reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
    organisationId: ORG_A,
    finding,
    candidate,
  });

  subject = propose(subject, {
    commandId: `cmd:${seed}:propose`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.DETECTED,
    actor: MACHINE_RULE,
    occurredAt: OBSERVED_AT,
  }).subject;
  subject = confirm(subject, {
    commandId: `cmd:${seed}:confirm`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.PROPOSED,
    actor: HUMAN_ALICE,
    occurredAt: LATER_AT,
  }).subject;
  subject = certify(subject, {
    commandId: `cmd:${seed}:certify`,
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.CONFIRMED,
    actor: HUMAN_BOB,
    occurredAt: LATER_AT,
    reasonCode: "GOVERNANCE_BOARD_APPROVED",
  }).subject;

  return { finding, candidate, subject };
}

function baseObjectCommand(seed: string): ObjectReconciliationInvocationCommand<"AGENT"> {
  const { finding, candidate, subject } = certifyAgentCandidate(seed);
  const canonicalObject = makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, seed);
  const port = makeAllowingAuthorizationPort({
    organisationId: ORG_A,
    subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
    requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
    actor: HUMAN_ALICE,
  });

  return {
    commandId: `cmd:${seed}:reconcile`,
    organisationId: ORG_A,
    reviewSubject: subject,
    finding,
    candidate,
    actor: HUMAN_ALICE,
    authorizationPort: port,
    reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
    requestedAt: LATER_AT,
    requestedDecision: {
      outcome: "CREATE_NEW",
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
      canonicalObject,
    },
  };
}

describe("success paths", () => {
  it("CERTIFIED object candidate + authorized human -> valid CREATE_NEW reconciliation decision", async () => {
    const command = baseObjectCommand("obj-success-1");
    const result = await invokeObjectReconciliation(command);

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.decision.outcome, "CREATE_NEW");
    assert.equal(result.decision.candidateKind, "AGENT");
    assert.equal(result.decision.authority.authorityKind, "HUMAN");
    assert.equal(result.authorization.result, "ALLOW");
    assert.equal(result.audit.reconciliationDecisionId, result.decision.decisionId);
  });

  it("CERTIFIED relationship candidate + authorized human -> valid CREATE_NEW reconciliation decision", async () => {
    const { finding, candidate, subject } = certifyRelationshipCandidate("rel-success-1", {
      relationshipTypeCode: "HANDOFF_TO",
      sourceCandidateKind: CANONICAL_OBJECT_KIND.AGENT_VERSION,
      targetCandidateKind: CANONICAL_OBJECT_KIND.AGENT,
    });

    const sourceAgent: AgentIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "rel-success-1-source-agent"),
      agentId: asAgentId("agent:rel-success-1-source"),
      agentCode: "SOURCE_AGENT",
    };
    const source: AgentVersionIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT_VERSION, "rel-success-1-source-version"),
      agent: sourceAgent,
      agentVersionId: asAgentVersionId("agent-version:rel-success-1"),
      versionCode: "v1",
    };
    const target: AgentIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "rel-success-1-target"),
      agentId: asAgentId("agent:rel-success-1-target"),
      agentCode: "TARGET_AGENT",
    };

    const authorizedState: GovernedRelationshipDraft<"HANDOFF_TO"> = {
      relationshipId: asRelationshipId("relationship:rel-success-1"),
      relationshipStateId: asRelationshipStateId("relationship-state:rel-success-1"),
      organisationId: ORG_A,
      relationshipType: "HANDOFF_TO",
      source,
      target,
      support: { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds },
      validFrom: LATER_AT,
      recordedAt: LATER_AT,
    };

    const port = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RELATIONSHIP_RECONCILIATION_OUTCOME.CREATE_NEW,
      actor: HUMAN_ALICE,
    });

    const command: RelationshipReconciliationInvocationCommand<"HANDOFF_TO"> = {
      commandId: "cmd:rel-success-1:reconcile",
      organisationId: ORG_A,
      reviewSubject: subject,
      finding,
      candidate,
      actor: HUMAN_ALICE,
      authorizationPort: port,
      reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
      requestedAt: LATER_AT,
      requestedDecision: { outcome: "CREATE_NEW", authorizedState },
    };

    const result = await invokeRelationshipReconciliation(command);
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.decision.outcome, "CREATE_NEW");
    assert.equal(result.decision.relationshipTypeCode, "HANDOFF_TO");
  });

  it("exact existing canonical reconciliation outcomes remain valid (object taxonomy)", async () => {
    for (const outcome of Object.values(RECONCILIATION_OUTCOME)) {
      if (outcome === "MERGE_CANDIDATES") continue;
      const command = baseObjectCommand(`obj-outcome-${outcome.toLowerCase()}`);
      const canonicalObject = makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, `outcome-${outcome}`);
      const port = makeAllowingAuthorizationPort({
        organisationId: ORG_A,
        subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId },
        requestedAction: outcome,
        actor: HUMAN_ALICE,
      });
      const requestedDecision =
        outcome === "CREATE_NEW" || outcome === "MATCH_EXISTING"
          ? {
              outcome,
              subject: { subjectKind: "CANDIDATE" as const, candidateId: command.candidate.candidateId, candidateKind: "AGENT" as const },
              canonicalObject,
            }
          : {
              outcome: outcome as "REJECT" | "DEFER",
              subject: { subjectKind: "CANDIDATE" as const, candidateId: command.candidate.candidateId, candidateKind: "AGENT" as const },
            };

      const result = await invokeObjectReconciliation({ ...command, authorizationPort: port, requestedDecision });
      assert.equal(result.kind, "APPLIED");
      assert.equal(result.decision.outcome, outcome);
    }
  });

  it("MERGE_CANDIDATES outcome remains valid for two certified contributors", async () => {
    const left = certifyAgentCandidate("merge-left");
    const right = certifyAgentCandidate("merge-right");
    const candidateMergeId = "candidate-merge:test-1" as never;

    const port = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE_MERGE", candidateMergeId },
      requestedAction: RECONCILIATION_OUTCOME.MERGE_CANDIDATES,
      actor: HUMAN_ALICE,
    });

    const result = await invokeMergeCandidatesReconciliation({
      commandId: "cmd:merge:reconcile",
      organisationId: ORG_A,
      candidateMergeId,
      contributors: [
        { reviewSubject: left.subject, finding: left.finding, candidate: left.candidate },
        { reviewSubject: right.subject, finding: right.finding, candidate: right.candidate },
      ],
      actor: HUMAN_ALICE,
      authorizationPort: port,
      reasonCode: "DUPLICATE_DISCOVERY_MERGED",
      requestedAt: LATER_AT,
    });

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.decision.outcome, "MERGE_CANDIDATES");
    assert.equal(result.decision.contributingCandidateIds.length, 2);
  });
});

describe("authorization", () => {
  it("fails closed when no authorization port is supplied", async () => {
    const command = baseObjectCommand("auth-no-port");
    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: undefined as never }),
      AuthorizationPortRequiredError,
    );
  });

  it("fails closed on an explicit DENY", async () => {
    const command = baseObjectCommand("auth-deny");
    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: DENY_ALL_AUTHORIZATION_PORT }),
      AuthorizationDeniedError,
    );
  });

  it("fails closed for a machine actor, before the authorization port is even consulted", async () => {
    const command = baseObjectCommand("auth-machine");
    let portCalled = false;
    const port = {
      authorize() {
        portCalled = true;
        return {
          authorizationDecisionId: "should-not-be-used",
          result: "ALLOW" as const,
          organisationId: ORG_A,
          actorReference: "rule:whatever",
          subject: { subjectKind: "CANDIDATE" as const, candidateId: command.candidate.candidateId },
          requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
          evaluatedAt: OBSERVED_AT,
        };
      },
    };

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, actor: MACHINE_RULE, authorizationPort: port }),
      MachineAuthorityForbiddenError,
    );
    assert.equal(portCalled, false);
  });

  it("fails closed when the ALLOW is scoped to a different actor", async () => {
    const command = baseObjectCommand("auth-different-actor");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:wrong-actor",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_BOB.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: port }),
      ActorAuthorizationMismatchError,
    );
  });

  it("fails closed when the ALLOW is scoped to a different organisation", async () => {
    const command = baseObjectCommand("auth-different-org");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:wrong-org",
      result: "ALLOW",
      organisationId: ORG_B,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: port }),
      AuthorizationScopeMismatchError,
    );
  });

  it("fails closed when the ALLOW is scoped to a different subject/action", async () => {
    const command = baseObjectCommand("auth-different-subject");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:wrong-action",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.REJECT,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: port }),
      AuthorizationScopeMismatchError,
    );
  });
});

describe("lifecycle", () => {
  function eachNonCertifiedState() {
    return [REVIEW_STATE.DETECTED, REVIEW_STATE.PROPOSED, REVIEW_STATE.CONFIRMED, REVIEW_STATE.REJECTED] as const;
  }

  for (const targetState of eachNonCertifiedState()) {
    it(`${targetState} cannot reconcile`, async () => {
      const seed = `lifecycle-${targetState.toLowerCase()}`;
      const finding = makeObjectFinding("AGENT", seed);
      const candidate = makeObjectCandidate(finding, seed);
      let subject = createReviewSubject({
        reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
        organisationId: ORG_A,
        finding,
        candidate,
      });

      if (targetState !== REVIEW_STATE.DETECTED) {
        subject = propose(subject, {
          commandId: `cmd:${seed}:propose`,
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: MACHINE_RULE,
          occurredAt: OBSERVED_AT,
        }).subject;
      }
      if (targetState === REVIEW_STATE.CONFIRMED) {
        subject = confirm(subject, {
          commandId: `cmd:${seed}:confirm`,
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.PROPOSED,
          actor: HUMAN_ALICE,
          occurredAt: LATER_AT,
        }).subject;
      }
      if (targetState === REVIEW_STATE.REJECTED) {
        subject = reject(subject, {
          commandId: `cmd:${seed}:reject`,
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: subject.state,
          actor: HUMAN_ALICE,
          occurredAt: LATER_AT,
          reasonCode: "FALSE_POSITIVE",
        }).subject;
      }

      const port = makeAllowingAuthorizationPort({
        organisationId: ORG_A,
        subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
        requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
        actor: HUMAN_ALICE,
      });

      await assert.rejects(
        () =>
          invokeObjectReconciliation({
            commandId: `cmd:${seed}:reconcile`,
            organisationId: ORG_A,
            reviewSubject: subject,
            finding,
            candidate,
            actor: HUMAN_ALICE,
            authorizationPort: port,
            reasonCode: "ATTEMPT",
            requestedAt: LATER_AT,
            requestedDecision: {
              outcome: "CREATE_NEW",
              subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
              canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, seed),
            },
          }),
        ReviewSubjectNotCertifiedError,
      );
    });
  }

  it("CERTIFIED is required but not sufficient without authorization", async () => {
    const command = baseObjectCommand("lifecycle-certified-insufficient");
    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: DENY_ALL_AUTHORIZATION_PORT }),
      AuthorizationDeniedError,
    );
  });
});

describe("identity and context", () => {
  it("fails on a finding mismatch", async () => {
    const command = baseObjectCommand("identity-finding-mismatch");
    const otherFinding = makeObjectFinding("AGENT", "identity-finding-mismatch-other");

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, finding: otherFinding }),
      SubjectMismatchError,
    );
  });

  it("fails on a candidate mismatch", async () => {
    const command = baseObjectCommand("identity-candidate-mismatch");
    const otherFinding = makeObjectFinding("AGENT", "identity-candidate-mismatch-other");
    const otherCandidate = makeObjectCandidate(otherFinding, "identity-candidate-mismatch-other");

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, candidate: otherCandidate }),
      SubjectMismatchError,
    );
  });

  it("fails on a tenant/organisation mismatch", async () => {
    const command = baseObjectCommand("identity-org-mismatch");

    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, organisationId: ORG_B }),
      ContextMismatchError,
    );
  });

  it("fails on a relationship endpoint context mismatch (candidate substitution after certification)", async () => {
    const { finding, subject } = certifyRelationshipCandidate("identity-endpoint-mismatch");
    const substitutedCandidate = makeRelationshipCandidate(finding, "identity-endpoint-mismatch", {
      targetConnectionId: "connection:repository:different-tenant",
    });

    const port = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: substitutedCandidate.candidateId },
      requestedAction: RELATIONSHIP_RECONCILIATION_OUTCOME.REJECT,
      actor: HUMAN_ALICE,
    });

    await assert.rejects(
      () =>
        invokeRelationshipReconciliation({
          commandId: "cmd:identity-endpoint-mismatch:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate: substitutedCandidate,
          actor: HUMAN_ALICE,
          authorizationPort: port,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: { outcome: "REJECT" },
        }),
      SubjectMismatchError,
    );
  });

  it("fails on unrelated evidence cited on the command", async () => {
    const command = baseObjectCommand("identity-unrelated-evidence");
    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          ...command,
          evidenceIds: ["evidence:not-part-of-this-subject" as never],
        }),
      Error,
    );
  });
});

describe("security and governance invariants", () => {
  it("reasonCode alone never counts as authorization", async () => {
    const command = baseObjectCommand("security-reason-code");
    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          ...command,
          reasonCode: "I_AM_DEFINITELY_AUTHORIZED_TRUST_ME",
          authorizationPort: DENY_ALL_AUTHORIZATION_PORT,
        }),
      AuthorizationDeniedError,
    );
  });

  it("a HUMAN actorReference alone never counts as authorization", async () => {
    const command = baseObjectCommand("security-actor-alone");
    await assert.rejects(
      () => invokeObjectReconciliation({ ...command, authorizationPort: DENY_ALL_AUTHORIZATION_PORT }),
      AuthorizationDeniedError,
    );
  });

  it("no code path directly materializes governed truth (the gate returns a value object only)", async () => {
    const command = baseObjectCommand("security-value-object");
    const result = await invokeObjectReconciliation(command);
    assert.equal(Object.isFrozen(result.decision), true);
  });
});

describe("idempotency", () => {
  it("the same command replayed produces a deterministic, equivalent decision", async () => {
    const command = baseObjectCommand("idempotency-replay");
    const first = await invokeObjectReconciliation(command);
    assert.equal(first.kind, "APPLIED");

    const second = await invokeObjectReconciliation({ ...command, priorInvocation: first.audit });
    assert.equal(second.kind, "REPLAYED");
    assert.deepEqual(second.decision, first.decision);
  });

  it("a reused idempotency key with a materially different requested outcome fails closed", async () => {
    const command = baseObjectCommand("idempotency-conflict");
    const first = await invokeObjectReconciliation(command);
    assert.equal(first.kind, "APPLIED");

    const alteredPort = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.REJECT,
      actor: HUMAN_ALICE,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          ...command,
          authorizationPort: alteredPort,
          requestedDecision: {
            outcome: "REJECT",
            subject: { subjectKind: "CANDIDATE", candidateId: command.candidate.candidateId, candidateKind: "AGENT" },
          },
          priorInvocation: first.audit as ReconciliationInvocationAuditEvent,
        }),
      IdempotencyConflictError,
    );
  });
});
