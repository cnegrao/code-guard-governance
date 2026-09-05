import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  asReviewSubjectId,
  certify,
  confirm,
} from "../src/index.ts";
import {
  HUMAN_ALICE,
  HUMAN_BOB,
  LATER_AT,
  OBSERVED_AT,
  ORG_A,
  makeAgentFinding,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

describe("end-to-end: discovery candidate -> PROPOSED -> CONFIRMED -> CERTIFIED", () => {
  it("carries an Agent finding through the full lifecycle while the original finding stays untouched", () => {
    const finding = makeAgentFinding("e2e-1");
    const frozenFindingSnapshot = JSON.stringify(finding);

    const proposal = new PassThroughSemanticProposalStrategy().propose(finding, {
      organisationId: ORG_A,
      reviewSubjectId: asReviewSubjectId("review-subject:e2e-1"),
      commandId: "cmd:e2e:propose",
      occurredAt: OBSERVED_AT,
    });
    assert.equal(proposal.kind, "APPLIED");
    assert.equal(proposal.subject.state, REVIEW_STATE.PROPOSED);

    const confirmed = confirm(proposal.subject, {
      commandId: "cmd:e2e:confirm",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
    });
    assert.equal(confirmed.kind, "APPLIED");
    assert.equal(confirmed.subject.state, REVIEW_STATE.CONFIRMED);

    const certified = certify(confirmed.subject, {
      commandId: "cmd:e2e:certify",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.CONFIRMED,
      actor: HUMAN_BOB,
      occurredAt: LATER_AT,
      reasonCode: "GOVERNANCE_BOARD_APPROVED",
    });
    assert.equal(certified.kind, "APPLIED");
    assert.equal(certified.subject.state, REVIEW_STATE.CERTIFIED);

    // Every intermediate subject is a distinct, still-valid snapshot: no
    // in-place mutation happened anywhere along the chain.
    assert.equal(proposal.subject.state, REVIEW_STATE.PROPOSED);
    assert.equal(confirmed.subject.state, REVIEW_STATE.CONFIRMED);

    // An audit event exists for every successful transition, chained by state.
    assert.equal(proposal.event.previousState, REVIEW_STATE.DETECTED);
    assert.equal(proposal.event.newState, REVIEW_STATE.PROPOSED);
    assert.equal(confirmed.event.previousState, REVIEW_STATE.PROPOSED);
    assert.equal(confirmed.event.newState, REVIEW_STATE.CONFIRMED);
    assert.equal(certified.event.previousState, REVIEW_STATE.CONFIRMED);
    assert.equal(certified.event.newState, REVIEW_STATE.CERTIFIED);

    // The original DiscoveryFinding was never mutated by any of this.
    assert.equal(JSON.stringify(finding), frozenFindingSnapshot);
    assert.equal(finding.reviewStatus, "UNREVIEWED");
    assert.equal(finding.requiresReview, true);
    assert.equal(finding.createsCanonicalObject, false);
  });

  it("applies the identical authority rules to a RelationshipDiscoveryFinding", () => {
    const finding = makeRelationshipFinding("e2e-2");
    const candidate = makeRelationshipCandidate(finding, "e2e-2");

    const proposal = new PassThroughSemanticProposalStrategy().propose(
      finding,
      {
        organisationId: ORG_A,
        reviewSubjectId: asReviewSubjectId("review-subject:e2e-2"),
        commandId: "cmd:e2e-rel:propose",
        occurredAt: OBSERVED_AT,
      },
      candidate,
    );
    assert.equal(proposal.kind, "APPLIED");

    const confirmed = confirm(proposal.subject, {
      commandId: "cmd:e2e-rel:confirm",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.PROPOSED,
      actor: HUMAN_ALICE,
      occurredAt: LATER_AT,
    });
    assert.equal(confirmed.kind, "APPLIED");

    const certified = certify(confirmed.subject, {
      commandId: "cmd:e2e-rel:certify",
      organisationId: ORG_A,
      findingId: finding.findingId,
      expectedState: REVIEW_STATE.CONFIRMED,
      actor: HUMAN_BOB,
      occurredAt: LATER_AT,
      reasonCode: "GOVERNANCE_BOARD_APPROVED",
    });
    assert.equal(certified.kind, "APPLIED");
    assert.equal(certified.subject.state, REVIEW_STATE.CERTIFIED);
    assert.equal(certified.subject.candidateKind, "RELATIONSHIP");

    assert.equal(finding.candidateKind, "RELATIONSHIP");
    assert.equal(finding.requiresReview, true);
    assert.equal(candidate.requiresReconciliation, true);
  });
});
