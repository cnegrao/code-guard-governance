import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asReviewSubjectId, createReviewSubject, REVIEW_STATE, SubjectMismatchError } from "../src/index.ts";
import {
  ORG_A,
  makeAgentFinding,
  makeRelationshipCandidate,
  makeRelationshipFinding,
} from "./fixtures.ts";

describe("createReviewSubject", () => {
  it("creates a DETECTED subject referencing the finding without copying its governed content", () => {
    const finding = makeAgentFinding("1");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:1"),
      organisationId: ORG_A,
      finding,
    });

    assert.equal(subject.state, REVIEW_STATE.DETECTED);
    assert.equal(subject.findingId, finding.findingId);
    assert.equal(subject.candidateKind, "AGENT");
    assert.deepEqual(subject.evidenceIds, finding.evidenceIds);
    assert.deepEqual(subject.assertionIds, finding.assertionIds);
    assert.equal(subject.lastTransition, undefined);
  });

  it("accepts a consistent relationship candidate", () => {
    const finding = makeRelationshipFinding("2");
    const candidate = makeRelationshipCandidate(finding, "2");
    const subject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:2"),
      organisationId: ORG_A,
      finding,
      candidate,
    });

    assert.equal(subject.state, REVIEW_STATE.DETECTED);
    assert.equal(subject.candidateKind, "RELATIONSHIP");
  });

  it("rejects a candidate whose findingId does not match", () => {
    const finding = makeRelationshipFinding("3");
    const otherFinding = makeRelationshipFinding("3-other");
    const candidate = makeRelationshipCandidate(otherFinding, "3");

    assert.throws(
      () =>
        createReviewSubject({
          reviewSubjectId: asReviewSubjectId("review-subject:3"),
          organisationId: ORG_A,
          finding,
          candidate,
        }),
      SubjectMismatchError,
    );
  });

  it("rejects a relationship candidate with an endpoint anchored to a different source connection", () => {
    const finding = makeRelationshipFinding("4");
    const candidate = makeRelationshipCandidate(finding, "4", {
      targetConnectionId: "connection:repository:other-tenant",
    });

    assert.throws(
      () =>
        createReviewSubject({
          reviewSubjectId: asReviewSubjectId("review-subject:4"),
          organisationId: ORG_A,
          finding,
          candidate,
        }),
      SubjectMismatchError,
    );
  });
});
