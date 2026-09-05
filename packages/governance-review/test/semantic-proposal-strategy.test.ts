import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINDING_REVIEW_STATUS,
  RECONCILIATION_AUTHORITY_KIND,
} from "@council/canonical-contracts";

import {
  IneligibleFindingError,
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  asReviewSubjectId,
} from "../src/index.ts";
import { OBSERVED_AT, ORG_A, makeAgentFinding, makeRelationshipCandidate, makeRelationshipFinding } from "./fixtures.ts";

describe("PassThroughSemanticProposalStrategy", () => {
  it("converts an eligible finding straight to PROPOSED under DETERMINISTIC_RULE authority", () => {
    const finding = makeAgentFinding("sps-1");
    const strategy = new PassThroughSemanticProposalStrategy();

    const result = strategy.propose(finding, {
      organisationId: ORG_A,
      reviewSubjectId: asReviewSubjectId("review-subject:sps-1"),
      commandId: "cmd:sps:1",
      occurredAt: OBSERVED_AT,
    });

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.state, REVIEW_STATE.PROPOSED);
    assert.equal(result.subject.findingId, finding.findingId);
    assert.equal(result.event.actor.authorityKind, RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE);
    // Provenance preserved unchanged.
    assert.deepEqual(result.subject.evidenceIds, finding.evidenceIds);
    assert.deepEqual(result.subject.assertionIds, finding.assertionIds);
  });

  it("preserves provenance for a relationship finding + candidate pair", () => {
    const finding = makeRelationshipFinding("sps-2");
    const candidate = makeRelationshipCandidate(finding, "sps-2");
    const strategy = new PassThroughSemanticProposalStrategy();

    const result = strategy.propose(
      finding,
      {
        organisationId: ORG_A,
        reviewSubjectId: asReviewSubjectId("review-subject:sps-2"),
        commandId: "cmd:sps:2",
        occurredAt: OBSERVED_AT,
      },
      candidate,
    );

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.subject.candidateKind, "RELATIONSHIP");
  });

  it("refuses an already-reviewed finding (not eligible for a non-authoritative proposal)", () => {
    const finding = { ...makeAgentFinding("sps-3"), reviewStatus: FINDING_REVIEW_STATUS.ACCEPTED };
    const strategy = new PassThroughSemanticProposalStrategy();

    assert.throws(
      () =>
        strategy.propose(finding, {
          organisationId: ORG_A,
          reviewSubjectId: asReviewSubjectId("review-subject:sps-3"),
          commandId: "cmd:sps:3",
          occurredAt: OBSERVED_AT,
        }),
      IneligibleFindingError,
    );
  });

  it("never confirms or certifies - it only exposes propose()", () => {
    const strategy = new PassThroughSemanticProposalStrategy();
    assert.equal((strategy as unknown as { confirm?: unknown }).confirm, undefined);
    assert.equal((strategy as unknown as { certify?: unknown }).certify, undefined);
  });
});
