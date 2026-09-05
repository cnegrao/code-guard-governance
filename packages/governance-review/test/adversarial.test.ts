import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ContextMismatchError,
  HumanActorRequiredError,
  InvalidActorError,
  InvalidReviewTransitionError,
  REVIEW_STATE,
  StaleReviewStateError,
  SubjectMismatchError,
  asReviewSubjectId,
  certify,
  confirm,
  createReviewSubject,
  propose,
  reject,
} from "../src/index.ts";
import {
  HUMAN_ALICE,
  LATER_AT,
  MACHINE_RULE,
  OBSERVED_AT,
  ORG_A,
  ORG_B,
  makeAgentFinding,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

/** Phase 6: try to break the lifecycle. Each case here corresponds 1:1 to the adversarial checklist. */
describe("adversarial: direct certification", () => {
  it("DETECTED cannot jump straight to CERTIFIED", () => {
    const finding = makeAgentFinding("adv-1");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-1"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        certify(subject, {
          commandId: "cmd:adv:1",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: HUMAN_ALICE,
          occurredAt: OBSERVED_AT,
          reasonCode: "SKIP_THE_LINE",
        }),
      InvalidReviewTransitionError,
    );
  });

  it("PROPOSED cannot jump straight to CERTIFIED, skipping CONFIRMED", () => {
    const finding = makeAgentFinding("adv-2");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-2"),
      organisationId: ORG_A,
      finding,
    });
    const proposed = propose(subject, {
      commandId: "cmd:adv:2:propose",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: MACHINE_RULE,
      occurredAt: OBSERVED_AT,
    });
    assert.equal(proposed.kind, "APPLIED");

    assert.throws(
      () =>
        certify(proposed.subject, {
          commandId: "cmd:adv:2:certify",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.PROPOSED,
          actor: HUMAN_ALICE,
          occurredAt: LATER_AT,
          reasonCode: "SKIP_THE_LINE",
        }),
      InvalidReviewTransitionError,
    );
  });
});

describe("adversarial: forged and absent actors", () => {
  it("rejects a HUMAN actor with an empty actorReference", () => {
    const finding = makeAgentFinding("adv-3");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-3"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        propose(subject, {
          commandId: "cmd:adv:3",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: { authorityKind: "HUMAN", actorReference: "" },
          occurredAt: OBSERVED_AT,
        }),
      InvalidActorError,
    );
  });

  it("rejects an entirely absent actor", () => {
    const finding = makeAgentFinding("adv-4");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-4"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        propose(subject, {
          commandId: "cmd:adv:4",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actor: undefined as any,
          occurredAt: OBSERVED_AT,
        }),
      InvalidActorError,
    );
  });
});

describe("adversarial: machine actor on a human-only transition", () => {
  it("a machine cannot reject", () => {
    const finding = makeAgentFinding("adv-5");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-5"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        reject(subject, {
          commandId: "cmd:adv:5",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: MACHINE_RULE,
          occurredAt: OBSERVED_AT,
          reasonCode: "AUTOMATED_DISMISSAL",
        }),
      HumanActorRequiredError,
    );
  });
});

describe("adversarial: stale previous state", () => {
  it("a command built against an already-superseded state is rejected", () => {
    const finding = makeAgentFinding("adv-6");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-6"),
      organisationId: ORG_A,
      finding,
    });
    const proposed = propose(subject, {
      commandId: "cmd:adv:6:propose",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: MACHINE_RULE,
      occurredAt: OBSERVED_AT,
    });
    assert.equal(proposed.kind, "APPLIED");

    assert.throws(
      () =>
        confirm(proposed.subject, {
          commandId: "cmd:adv:6:confirm",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: HUMAN_ALICE,
          occurredAt: LATER_AT,
        }),
      StaleReviewStateError,
    );
  });
});

describe("adversarial: candidate from a different source/tenant context", () => {
  it("a relationship candidate whose endpoint belongs to a different connection is rejected at creation", () => {
    const finding = makeRelationshipFinding("adv-7");
    const candidate = makeRelationshipCandidate(finding, "adv-7", {
      targetConnectionId: "connection:repository:different-tenant",
    });

    assert.throws(
      () =>
        createReviewSubject({
          reviewSubjectId: asReviewSubjectId("review-subject:adv-7"),
          organisationId: ORG_A,
          finding,
          candidate,
        }),
      SubjectMismatchError,
    );
  });

  it("a transition command from a different tenant context is rejected", () => {
    const finding = makeAgentFinding("adv-8");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-8"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        propose(subject, {
          commandId: "cmd:adv:8",
          organisationId: ORG_B,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.DETECTED,
          actor: MACHINE_RULE,
          occurredAt: OBSERVED_AT,
        }),
      ContextMismatchError,
    );
  });
});

describe("adversarial: transition after rejection", () => {
  it("REJECTED is terminal", () => {
    const finding = makeAgentFinding("adv-9");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-9"),
      organisationId: ORG_A,
      finding,
    });
    const rejected = reject(subject, {
      commandId: "cmd:adv:9:reject",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: HUMAN_ALICE,
      occurredAt: OBSERVED_AT,
      reasonCode: "FALSE_POSITIVE",
    });
    assert.equal(rejected.kind, "APPLIED");

    assert.throws(
      () =>
        reject(rejected.subject, {
          commandId: "cmd:adv:9:reject-again",
          organisationId: ORG_A,
          findingId: finding.findingId,
          expectedState: REVIEW_STATE.REJECTED,
          actor: HUMAN_ALICE,
          occurredAt: LATER_AT,
          reasonCode: "STILL_FALSE_POSITIVE",
        }),
      InvalidReviewTransitionError,
    );
  });
});

describe("adversarial: attempted mutation of a historical audit event", () => {
  it("the emitted audit event is frozen and cannot be mutated", () => {
    const finding = makeAgentFinding("adv-10");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:adv-10"),
      organisationId: ORG_A,
      finding,
    });
    const proposed = propose(subject, {
      commandId: "cmd:adv:10",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.DETECTED,
      actor: MACHINE_RULE,
      occurredAt: OBSERVED_AT,
    });
    assert.equal(proposed.kind, "APPLIED");
    assert.equal(Object.isFrozen(proposed.event), true);
    assert.throws(() => {
      "use strict";
      (proposed.event as { newState: string }).newState = REVIEW_STATE.CERTIFIED;
    }, TypeError);
    assert.equal(proposed.event.newState, REVIEW_STATE.PROPOSED);
  });
});
