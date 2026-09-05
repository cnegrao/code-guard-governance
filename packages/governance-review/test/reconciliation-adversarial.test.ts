import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OBJECT_KIND,
  RECONCILIATION_OUTCOME,
} from "@council/canonical-contracts";

import {
  AuthorizationScopeMismatchError,
  CanonicalReconciliationRejectedError,
  IdempotencyConflictError,
  MachineAuthorityForbiddenError,
  REVIEW_STATE,
  SubjectMismatchError,
  asReviewSubjectId,
  certify,
  confirm,
  createReviewSubject,
  invokeObjectReconciliation,
  invokeRelationshipReconciliation,
  propose,
} from "../src/index.ts";
import {
  HUMAN_ALICE,
  HUMAN_BOB,
  LATER_AT,
  MACHINE_RULE,
  OBSERVED_AT,
  ORG_A,
  ORG_B,
  makeAgentFinding,
  makeCanonicalObjectIdentity,
  makeFixedResultAuthorizationPort,
  makeObjectCandidate,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

/**
 * Phase 8: try to break the reconciliation gate. Each case here corresponds
 * 1:1 to the adversarial checklist. No second review cycle - only demonstrated
 * defects were fixed after this pass ran once.
 */

function certifiedAgent(seed: string) {
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

describe("adversarial: forged HUMAN authority", () => {
  it("a fabricated HUMAN actor object with an empty actorReference is rejected before any authorization check", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-forged-human");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:should-not-be-reached",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: "",
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-forged-human:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: { authorityKind: "HUMAN", actorReference: "" },
          authorizationPort: port,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-forged-human"),
          },
        }),
      MachineAuthorityForbiddenError,
    );
  });
});

describe("adversarial: fake authorization object supplied directly instead of through the Port", () => {
  it("a caller cannot pass a hand-built ALLOW result in place of authorizationPort - the field does not exist on the command", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-fake-authz");
    const forgedResult = {
      authorizationDecisionId: "authz:forged",
      result: "ALLOW" as const,
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE" as const, candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    };

    const command = {
      commandId: "cmd:adv-fake-authz:reconcile",
      organisationId: ORG_A,
      reviewSubject: subject,
      finding,
      candidate,
      actor: HUMAN_ALICE,
      // No authorizationPort supplied - only a bare result object, which is not a Port.
      authorization: forgedResult,
      reasonCode: "ATTEMPT",
      requestedAt: LATER_AT,
      requestedDecision: {
        outcome: "CREATE_NEW" as const,
        subject: { subjectKind: "CANDIDATE" as const, candidateId: candidate.candidateId, candidateKind: "AGENT" as const },
        canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-fake-authz"),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await assert.rejects(() => invokeObjectReconciliation(command), /AuthorizationPortRequired/);
  });
});

describe("adversarial: authorization produced for another tenant", () => {
  it("an ALLOW minted for ORG_B never authorizes reconciliation for ORG_A", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-other-tenant");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:other-tenant",
      result: "ALLOW",
      organisationId: ORG_B,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-other-tenant:reconcile",
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
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-other-tenant"),
          },
        }),
      AuthorizationScopeMismatchError,
    );
  });
});

describe("adversarial: candidate substitution after certification", () => {
  it("a different AGENT candidate (same org, different findingId) swapped in at invocation time is rejected", async () => {
    const { finding, subject } = certifiedAgent("adv-candidate-swap");
    const otherFinding = makeAgentFinding("adv-candidate-swap-other");
    const otherCandidate = makeObjectCandidate(otherFinding, "adv-candidate-swap-other");

    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:swap",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: otherCandidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-candidate-swap:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding, // the ORIGINAL, certified finding
          candidate: otherCandidate, // a DIFFERENT candidate substituted in
          actor: HUMAN_ALICE,
          authorizationPort: port,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: otherCandidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-candidate-swap"),
          },
        }),
      SubjectMismatchError,
    );
  });
});

describe("adversarial: relationship endpoint substitution", () => {
  it("a relationship candidate re-anchored to a different source connection after certification is rejected", async () => {
    const finding = makeRelationshipFinding("adv-endpoint-swap");
    const originalCandidate = makeRelationshipCandidate(finding, "adv-endpoint-swap");
    let subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-endpoint-swap"),
      organisationId: ORG_A,
      finding,
      candidate: originalCandidate,
    });
    subject = propose(subject, {
      commandId: "cmd:adv-endpoint-swap:propose",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: MACHINE_RULE,
      occurredAt: OBSERVED_AT,
    }).subject;
    subject = confirm(subject, {
      commandId: "cmd:adv-endpoint-swap:confirm",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
    }).subject;
    subject = certify(subject, {
      commandId: "cmd:adv-endpoint-swap:certify",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.CONFIRMED,
      actor: HUMAN_BOB,
      occurredAt: LATER_AT,
      reasonCode: "GOVERNANCE_BOARD_APPROVED",
    }).subject;

    const substitutedCandidate = makeRelationshipCandidate(finding, "adv-endpoint-swap", {
      targetConnectionId: "connection:repository:attacker-controlled",
    });

    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:endpoint-swap",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: substitutedCandidate.candidateId },
      requestedAction: "REJECT",
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeRelationshipReconciliation({
          commandId: "cmd:adv-endpoint-swap:reconcile",
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
});

describe("adversarial: stale certified subject", () => {
  it("a review subject snapshot certified under a stale command is still just CERTIFIED - reconciliation itself must be re-authorized, it cannot ride on the certify reasonCode", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-stale-certified");

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-stale-certified:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: HUMAN_ALICE,
          authorizationPort: undefined as never,
          reasonCode: subject.lastTransition?.reasonCode ?? "GOVERNANCE_BOARD_APPROVED",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-stale-certified"),
          },
        }),
      /AuthorizationPortRequired/,
    );
  });
});

describe("adversarial: reused idempotency key with a changed requested outcome", () => {
  it("CREATE_NEW then REJECT under the same commandId fails closed", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-idempotency-swap");
    const allowCreate = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:create",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    const first = await invokeObjectReconciliation({
      commandId: "cmd:adv-idempotency-swap:reconcile",
      organisationId: ORG_A,
      reviewSubject: subject,
      finding,
      candidate,
      actor: HUMAN_ALICE,
      authorizationPort: allowCreate,
      reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
      requestedAt: LATER_AT,
      requestedDecision: {
        outcome: "CREATE_NEW",
        subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
        canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-idempotency-swap"),
      },
    });

    const allowReject = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:reject",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.REJECT,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-idempotency-swap:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: HUMAN_ALICE,
          authorizationPort: allowReject,
          reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "REJECT",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
          },
          priorInvocation: first.audit,
        }),
      IdempotencyConflictError,
    );
  });
});

describe("adversarial: direct CREATE_NEW without a valid canonical decision", () => {
  it("an authorizedState with an endpoint kind that violates the relationship's own constraints is rejected by the canonical validator", async () => {
    const finding = makeRelationshipFinding("adv-invalid-canonical");
    const candidate = makeRelationshipCandidate(finding, "adv-invalid-canonical", {
      relationshipTypeCode: "HANDOFF_TO",
      sourceCandidateKind: CANONICAL_OBJECT_KIND.AGENT_VERSION,
      targetCandidateKind: CANONICAL_OBJECT_KIND.AGENT,
    });
    let subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-invalid-canonical"),
      organisationId: ORG_A,
      finding,
      candidate,
    });
    subject = propose(subject, {
      commandId: "cmd:adv-invalid-canonical:propose",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: MACHINE_RULE,
      occurredAt: OBSERVED_AT,
    }).subject;
    subject = confirm(subject, {
      commandId: "cmd:adv-invalid-canonical:confirm",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
    }).subject;
    subject = certify(subject, {
      commandId: "cmd:adv-invalid-canonical:certify",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.CONFIRMED,
      actor: HUMAN_BOB,
      occurredAt: LATER_AT,
      reasonCode: "GOVERNANCE_BOARD_APPROVED",
    }).subject;

    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:invalid-canonical",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: HUMAN_ALICE.actorReference,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: "CREATE_NEW",
      evaluatedAt: OBSERVED_AT,
    });

    // HANDOFF_TO requires source=AGENT_VERSION, target=AGENT. Supplying a
    // MODEL target must be rejected by canonical-contracts' own validator,
    // not silently accepted by this package.
    const invalidAuthorizedState = {
      relationshipId: "relationship:adv-invalid-canonical",
      relationshipStateId: "relationship-state:adv-invalid-canonical",
      organisationId: ORG_A,
      relationshipType: "HANDOFF_TO",
      source: {
        canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT_VERSION, "adv-invalid-canonical-source"),
        agent: {
          canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-invalid-canonical-agent"),
          agentId: "agent:adv-invalid-canonical",
          agentCode: "FIXTURE",
        },
        agentVersionId: "agent-version:adv-invalid-canonical",
        versionCode: "v1",
      },
      target: {
        canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.MODEL, "adv-invalid-canonical-target"),
        modelId: "model:adv-invalid-canonical",
      },
      support: { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds },
      validFrom: LATER_AT,
      recordedAt: LATER_AT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await assert.rejects(
      () =>
        invokeRelationshipReconciliation({
          commandId: "cmd:adv-invalid-canonical:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: HUMAN_ALICE,
          authorizationPort: port,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: { outcome: "CREATE_NEW", authorizedState: invalidAuthorizedState },
        }),
      CanonicalReconciliationRejectedError,
    );
  });
});

describe("adversarial: deterministic/machine actor pretending to be human", () => {
  it("a DETERMINISTIC_RULE authority is never treated as HUMAN, however it is labeled", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-machine-pretend");
    const port = makeFixedResultAuthorizationPort({
      authorizationDecisionId: "authz:machine-pretend",
      result: "ALLOW",
      organisationId: ORG_A,
      actorReference: "rule:pretend-human",
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: RECONCILIATION_OUTCOME.CREATE_NEW,
      evaluatedAt: OBSERVED_AT,
    });

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-machine-pretend:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: { authorityKind: "DETERMINISTIC_RULE", ruleCode: "pretend-human", ruleVersion: "1.0" },
          authorizationPort: port,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-machine-pretend"),
          },
        }),
      MachineAuthorityForbiddenError,
    );
  });
});

describe("adversarial: bypass of the authorization Port", () => {
  it("omitting authorizationPort entirely fails closed rather than defaulting to permissive", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-bypass-port");

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-bypass-port:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: HUMAN_ALICE,
          authorizationPort: undefined as never,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-bypass-port"),
          },
        }),
      /AuthorizationPortRequired/,
    );
  });

  it("a Port whose authorize() throws fails the gate closed rather than proceeding", async () => {
    const { finding, candidate, subject } = certifiedAgent("adv-port-throws");
    const throwingPort = {
      authorize(): never {
        throw new Error("simulated authorization infrastructure failure");
      },
    };

    await assert.rejects(
      () =>
        invokeObjectReconciliation({
          commandId: "cmd:adv-port-throws:reconcile",
          organisationId: ORG_A,
          reviewSubject: subject,
          finding,
          candidate,
          actor: HUMAN_ALICE,
          authorizationPort: throwingPort,
          reasonCode: "ATTEMPT",
          requestedAt: LATER_AT,
          requestedDecision: {
            outcome: "CREATE_NEW",
            subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
            canonicalObject: makeCanonicalObjectIdentity(ORG_A, CANONICAL_OBJECT_KIND.AGENT, "adv-port-throws"),
          },
        }),
      /simulated authorization infrastructure failure/,
    );
  });
});
