import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ContextMismatchError,
  EvidenceMismatchError,
  HumanActorRequiredError,
  InvalidActorError,
  InvalidReviewTransitionError,
  MissingEvidenceError,
  MissingReasonCodeError,
  REVIEW_STATE,
  StaleReviewStateError,
  SubjectMismatchError,
  asReviewSubjectId,
  certify,
  confirm,
  createReviewSubject,
  propose,
  reject,
  type CertifyCommand,
  type ConfirmCommand,
  type ProposeCommand,
  type RejectCommand,
} from "../src/index.ts";
import {
  HUMAN_ALICE,
  LATER_AT,
  MACHINE_RULE,
  OBSERVED_AT,
  ORG_A,
  ORG_B,
  makeAgentFinding,
  makeEvidencelessAgentFinding,
} from "./fixtures.ts";

function newSubject(seed: string) {
  const finding = makeAgentFinding(seed);
  const subject = createReviewSubject({
    reviewSubjectId: asReviewSubjectId(`review-subject:${seed}`),
    organisationId: ORG_A,
    finding,
  });
  return { finding, subject };
}

function proposeCommand(
  finding: ReturnType<typeof makeAgentFinding>,
  overrides: Partial<ProposeCommand> = {},
): ProposeCommand {
  return {
    commandId: "cmd:propose:1",
    organisationId: ORG_A,
    findingId: finding.findingId,
    expectedState: REVIEW_STATE.DETECTED,
    actor: MACHINE_RULE,
    occurredAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("propose: DETECTED -> PROPOSED", () => {
  it("is valid for both a machine and a human actor", () => {
    const { finding, subject } = newSubject("propose-1");
    const result = propose(subject, proposeCommand(finding));
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.state, REVIEW_STATE.PROPOSED);
    assert.equal(result.event.previousState, REVIEW_STATE.DETECTED);
    assert.equal(result.event.newState, REVIEW_STATE.PROPOSED);
    assert.equal(result.event.actor, MACHINE_RULE);
  });

  it("rejects a stale expectedState", () => {
    const { finding, subject } = newSubject("propose-2");
    const proposed = propose(subject, proposeCommand(finding));
    assert.equal(proposed.kind, "APPLIED");

    assert.throws(
      () =>
        propose(
          proposed.subject,
          proposeCommand(finding, { commandId: "cmd:propose:2-again" }),
        ),
      StaleReviewStateError,
    );
  });

  it("rejects a context/tenant mismatch", () => {
    const { finding, subject } = newSubject("propose-3");
    assert.throws(
      () => propose(subject, proposeCommand(finding, { organisationId: ORG_B })),
      ContextMismatchError,
    );
  });

  it("rejects a subject/candidate mismatch (wrong findingId)", () => {
    const { subject } = newSubject("propose-4");
    const otherFinding = makeAgentFinding("propose-4-other");
    assert.throws(
      () => propose(subject, proposeCommand(otherFinding)),
      SubjectMismatchError,
    );
  });

  it("rejects a forged actor (empty ruleCode)", () => {
    const { finding, subject } = newSubject("propose-5");
    assert.throws(
      () =>
        propose(
          subject,
          proposeCommand(finding, {
            actor: { authorityKind: "DETERMINISTIC_RULE", ruleCode: "", ruleVersion: "1.0" },
          }),
        ),
      InvalidActorError,
    );
  });

  it("is idempotent for a repeated commandId", () => {
    const { finding, subject } = newSubject("propose-6");
    const command = proposeCommand(finding, { commandId: "cmd:propose:idem" });
    const first = propose(subject, command);
    assert.equal(first.kind, "APPLIED");

    const second = propose(first.subject, command);
    assert.equal(second.kind, "REPLAYED");
    assert.equal(second.subject.state, REVIEW_STATE.PROPOSED);
    assert.equal(second.event.eventId, first.event.eventId);
  });
});

describe("confirm: PROPOSED -> CONFIRMED", () => {
  function proposedSubject(seed: string) {
    const { finding, subject } = newSubject(seed);
    const proposed = propose(subject, proposeCommand(finding));
    assert.equal(proposed.kind, "APPLIED");
    return { finding, subject: proposed.subject };
  }

  function confirmCommand(
    finding: ReturnType<typeof makeAgentFinding>,
    overrides: Partial<ConfirmCommand> = {},
  ): ConfirmCommand {
    return {
      commandId: "cmd:confirm:1",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
      ...overrides,
    };
  }

  it("requires an explicit human actor", () => {
    const { finding, subject } = proposedSubject("confirm-1");
    assert.throws(
      () => confirm(subject, confirmCommand(finding, { actor: MACHINE_RULE })),
      HumanActorRequiredError,
    );
  });

  it("succeeds for a human actor with evidence present", () => {
    const { finding, subject } = proposedSubject("confirm-2");
    const result = confirm(subject, confirmCommand(finding));
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.state, REVIEW_STATE.CONFIRMED);
  });

  it("rejects a direct DETECTED -> CONFIRMED attempt", () => {
    const { finding, subject } = newSubject("confirm-3");
    assert.throws(
      () =>
        confirm(subject, confirmCommand(finding, { expectedState: REVIEW_STATE.DETECTED })),
      InvalidReviewTransitionError,
    );
  });

  it("rejects confirmation when the subject carries no evidence", () => {
    const finding = makeEvidencelessAgentFinding("confirm-5");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:confirm-5"),
      organisationId: ORG_A,
      finding,
    });
    const proposed = propose(subject, proposeCommand(finding));
    assert.equal(proposed.kind, "APPLIED");

    assert.throws(
      () => confirm(proposed.subject, confirmCommand(finding)),
      MissingEvidenceError,
    );
  });

  it("rejects confirmation citing evidence belonging to another subject", () => {
    const { finding, subject } = proposedSubject("confirm-4");
    const otherFinding = makeAgentFinding("confirm-4-other");
    assert.throws(
      () =>
        confirm(
          subject,
          confirmCommand(finding, { evidenceIds: otherFinding.evidenceIds }),
        ),
      EvidenceMismatchError,
    );
  });
});

describe("certify: CONFIRMED -> CERTIFIED", () => {
  function confirmedSubject(seed: string) {
    const { finding, subject } = newSubject(seed);
    const proposed = propose(subject, proposeCommand(finding));
    assert.equal(proposed.kind, "APPLIED");
    const confirmed = confirm(proposed.subject, {
      commandId: "cmd:confirm:for-certify",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
    });
    assert.equal(confirmed.kind, "APPLIED");
    return { finding, subject: confirmed.subject };
  }

  function certifyCommand(
    finding: ReturnType<typeof makeAgentFinding>,
    overrides: Partial<CertifyCommand> = {},
  ): CertifyCommand {
    return {
      commandId: "cmd:certify:1",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.CONFIRMED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
      reasonCode: "AUTHORIZED_FOR_RECONCILIATION",
      ...overrides,
    };
  }

  it("requires an explicit human actor", () => {
    const { finding, subject } = confirmedSubject("certify-1");
    assert.throws(
      () => certify(subject, certifyCommand(finding, { actor: MACHINE_RULE })),
      HumanActorRequiredError,
    );
  });

  it("requires a non-empty reasonCode (the authorization basis)", () => {
    const { finding, subject } = confirmedSubject("certify-2");
    assert.throws(
      () => certify(subject, certifyCommand(finding, { reasonCode: "" })),
      MissingReasonCodeError,
    );
  });

  it("succeeds for an authorized human actor with evidence and a reasonCode", () => {
    const { finding, subject } = confirmedSubject("certify-3");
    const result = certify(subject, certifyCommand(finding));
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.state, REVIEW_STATE.CERTIFIED);
    assert.equal(result.event.reasonCode, "AUTHORIZED_FOR_RECONCILIATION");
  });

  it("rejects a direct DETECTED -> CERTIFIED attempt", () => {
    const { finding, subject } = newSubject("certify-4");
    assert.throws(
      () =>
        certify(subject, certifyCommand(finding, { expectedState: REVIEW_STATE.DETECTED })),
      InvalidReviewTransitionError,
    );
  });
});

describe("reject", () => {
  function rejectCommand(
    finding: ReturnType<typeof makeAgentFinding>,
    expectedState: (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE],
    overrides: Partial<RejectCommand> = {},
  ): RejectCommand {
    return {
      commandId: "cmd:reject:1",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
      reasonCode: "FALSE_POSITIVE",
      ...overrides,
    };
  }

  it("rejects a DETECTED subject explicitly", () => {
    const { finding, subject } = newSubject("reject-1");
    const result = reject(subject, rejectCommand(finding, REVIEW_STATE.DETECTED));
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.state, REVIEW_STATE.REJECTED);
  });

  it("requires a human actor", () => {
    const { finding, subject } = newSubject("reject-2");
    assert.throws(
      () =>
        reject(
          subject,
          rejectCommand(finding, REVIEW_STATE.DETECTED, { actor: MACHINE_RULE }),
        ),
      HumanActorRequiredError,
    );
  });

  it("is terminal: no transition is valid after rejection", () => {
    const { finding, subject } = newSubject("reject-3");
    const rejected = reject(subject, rejectCommand(finding, REVIEW_STATE.DETECTED));
    assert.equal(rejected.kind, "APPLIED");

    assert.throws(
      () =>
        propose(
          rejected.subject,
          proposeCommand(finding, {
            commandId: "cmd:propose:after-reject",
            expectedState: REVIEW_STATE.REJECTED,
          }),
        ),
      InvalidReviewTransitionError,
    );
  });

  it("never mutates the subject passed in", () => {
    const { finding, subject } = newSubject("reject-4");
    const before = { ...subject };
    const result = reject(subject, rejectCommand(finding, REVIEW_STATE.DETECTED));
    assert.equal(result.kind, "APPLIED");
    assert.deepEqual(subject, before);
    assert.equal(subject.state, REVIEW_STATE.DETECTED);
  });
});
