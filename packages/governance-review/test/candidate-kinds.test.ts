import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  asReviewSubjectId,
  certify,
  confirm,
} from "../src/index.ts";
import { HUMAN_ALICE, LATER_AT, OBSERVED_AT, ORG_A, makeObjectFinding } from "./fixtures.ts";

/**
 * Agent, Model, and Tool discovery findings (the exact canonical-contracts
 * shape scanner's evidence-assembly.ts already produces for
 * CANONICAL_OBJECT_KIND.AGENT/MODEL/TOOL) all enter and traverse the review
 * lifecycle identically. Nothing in this package special-cases a
 * candidateKind, so no scanner code changes are required to plug any of
 * these three (or any other DiscoveryCandidateKind) into governance review.
 */
describe("candidate kinds enter review without scanner changes", () => {
  for (const kind of ["AGENT", "MODEL", "TOOL"] as const) {
    it(`${kind} finding travels DETECTED -> PROPOSED -> CONFIRMED -> CERTIFIED`, () => {
      const finding = makeObjectFinding(kind, `kind-${kind.toLowerCase()}`);

      const proposed = new PassThroughSemanticProposalStrategy().propose(finding, {
        organisationId: ORG_A,
        reviewSubjectId: asReviewSubjectId(`review-subject:kind-${kind.toLowerCase()}`),
        commandId: `cmd:kind-${kind.toLowerCase()}:propose`,
        occurredAt: OBSERVED_AT,
      });
      assert.equal(proposed.kind, "APPLIED");
      assert.equal(proposed.subject.candidateKind, kind);

      const confirmed = confirm(proposed.subject, {
        commandId: `cmd:kind-${kind.toLowerCase()}:confirm`,
        organisationId: ORG_A,
        findingId: finding.findingId,
        expectedState: REVIEW_STATE.PROPOSED,
        actor: HUMAN_ALICE,
        occurredAt: LATER_AT,
      });
      assert.equal(confirmed.kind, "APPLIED");

      const certified = certify(confirmed.subject, {
        commandId: `cmd:kind-${kind.toLowerCase()}:certify`,
        organisationId: ORG_A,
        findingId: finding.findingId,
        expectedState: REVIEW_STATE.CONFIRMED,
        actor: HUMAN_ALICE,
        occurredAt: LATER_AT,
        reasonCode: "GOVERNANCE_BOARD_APPROVED",
      });
      assert.equal(certified.kind, "APPLIED");
      assert.equal(certified.subject.state, REVIEW_STATE.CERTIFIED);
      assert.equal(certified.subject.candidateKind, kind);
    });
  }
});
