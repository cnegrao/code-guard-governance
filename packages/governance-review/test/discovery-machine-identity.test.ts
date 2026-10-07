import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RECONCILIATION_AUTHORITY_KIND, asOrganisationId } from "@council/canonical-contracts";

import {
  ACQUISITION_RUN_ID_PATTERN,
  DISCOVERY_FINDING_ID_PATTERN,
  MACHINE_PROPOSAL_RULE,
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  deriveProposeCommandId,
  deriveProposeEventId,
  deriveReviewSubjectId,
  type ReviewSubjectId,
} from "../src/index.ts";
import { OBSERVED_AT, ORG_A, ORG_B, makeAgentFinding } from "./fixtures.ts";

interface ReviewIdentityVector {
  readonly organisationId: string;
  readonly findingId: string;
  readonly reviewSubjectId: string;
  readonly commandId: string;
  readonly eventId: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/discovery-machine-identity-vectors.json", import.meta.url), "utf8"),
) as { readonly schema: string; readonly reviewIdentities: readonly ReviewIdentityVector[] };

// Pre-S1 formulas, copied verbatim from apps/dashboard/lib/governance/discovery-intake.ts
// and packages/governance-review/src/transitions.ts, as the compatibility oracle.
const legacyStableHex = (parts: readonly string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const legacyReviewSubjectId = (org: string, findingId: string) => `review-subject:discovery:${legacyStableHex([org, findingId])}`;
const legacyCommandId = (rsid: string) => `cmd:discovery-intake:propose:${legacyStableHex([rsid, "PASS_THROUGH_V1"])}`;
const legacyEventId = (rsid: string, cmd: string) =>
  `review-transition:${legacyStableHex([rsid, cmd, "DETECTED", "PROPOSED"]).slice(0, 32)}`;

describe("discovery machine identity", () => {
  it("reproduces every golden review identity vector", () => {
    assert.equal(vectors.schema, "govia.discovery-machine.identity-vectors.v1");
    assert.ok(vectors.reviewIdentities.length >= 8);
    for (const vector of vectors.reviewIdentities) {
      const reviewSubjectId = deriveReviewSubjectId(asOrganisationId(vector.organisationId), vector.findingId);
      const commandId = deriveProposeCommandId(reviewSubjectId);
      assert.equal(reviewSubjectId, vector.reviewSubjectId);
      assert.equal(commandId, vector.commandId);
      assert.equal(deriveProposeEventId(reviewSubjectId, commandId), vector.eventId);
    }
  });

  it("is byte-identical to the pre-S1 derivations across a varied corpus", () => {
    const orgs = [String(ORG_A), String(ORG_B), randomUUID(), "", "org:\"quoted\"\\slash", "ünïcødé-org"];
    const findings = ["discovery-finding:x", "", "finding\u0000with-nul", "€uro/\"json\"", randomUUID()];
    for (const org of orgs) {
      for (const findingId of findings) {
        const rsid = deriveReviewSubjectId(asOrganisationId(org || "x"), findingId);
        assert.equal(rsid, legacyReviewSubjectId(org || "x", findingId));
        const cmd = deriveProposeCommandId(rsid);
        assert.equal(cmd, legacyCommandId(rsid));
        assert.equal(deriveProposeEventId(rsid, cmd), legacyEventId(rsid, cmd));
      }
    }
  });

  it("is deterministic and tenant-scoped", () => {
    const finding = "discovery-finding:0123456789abcdef0123456789abcdef";
    assert.equal(deriveReviewSubjectId(ORG_A, finding), deriveReviewSubjectId(ORG_A, finding));
    assert.notEqual(deriveReviewSubjectId(ORG_A, finding), deriveReviewSubjectId(ORG_B, finding));
  });

  it("eventId equals the event Governance Review's own propose() emits (no second namespace)", () => {
    const finding = makeAgentFinding("dm-identity-1");
    const reviewSubjectId = deriveReviewSubjectId(ORG_A, finding.findingId);
    const commandId = deriveProposeCommandId(reviewSubjectId);
    const result = new PassThroughSemanticProposalStrategy().propose(finding, {
      organisationId: ORG_A,
      reviewSubjectId,
      commandId,
      occurredAt: OBSERVED_AT,
    });

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.event.eventId, deriveProposeEventId(reviewSubjectId, commandId));
    assert.equal(result.event.commandId, commandId);
    assert.equal(result.event.previousState, REVIEW_STATE.DETECTED);
    assert.equal(result.event.newState, REVIEW_STATE.PROPOSED);
    assert.deepEqual(result.event.actor, {
      authorityKind: RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE,
      ruleCode: MACHINE_PROPOSAL_RULE.code,
      ruleVersion: MACHINE_PROPOSAL_RULE.version,
    });
  });

  it("eventId depends on subject and command only, never on observation time", () => {
    const rsid = "review-subject:discovery:abc" as ReviewSubjectId;
    assert.equal(deriveProposeEventId(rsid, "cmd:1"), deriveProposeEventId(rsid, "cmd:1"));
    assert.notEqual(deriveProposeEventId(rsid, "cmd:1"), deriveProposeEventId(rsid, "cmd:2"));
  });

  it("accepts every existing Discovery finding-id namespace and rejects other shapes", () => {
    for (const vector of vectors.reviewIdentities) {
      assert.match(vector.findingId, DISCOVERY_FINDING_ID_PATTERN);
    }
    for (const bad of [
      "",
      "discovery-finding:",
      "discovery-finding:0123456789ABCDEF0123456789ABCDEF",
      "discovery-finding:0123",
      "discovery-finding:other:0123456789abcdef0123456789abcdef",
      " discovery-finding:0123456789abcdef0123456789abcdef",
      "purview-finding:0123456789abcdef0123456789abcdef",
      "finding:github:agent-candidate",
    ]) {
      assert.doesNotMatch(bad, DISCOVERY_FINDING_ID_PATTERN, bad);
    }
    assert.match(`acquisition-run:${randomUUID()}`, ACQUISITION_RUN_ID_PATTERN);
    assert.doesNotMatch("run:github:fixture", ACQUISITION_RUN_ID_PATTERN);
  });
});
