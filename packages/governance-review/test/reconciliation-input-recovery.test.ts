import { relationshipEndpointFixture } from "./fixtures.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  asAgentId,
  asAgentVersionId,
  asRelationshipId,
  asRelationshipStateId,
  type AgentIdentity,
  type AgentVersionIdentity,
  type GovernedRelationshipDraft,
} from "@council/canonical-contracts";

import {
  RECONCILIATION_INPUT_STATUS,
  recoverReconciliationInput,
  createReviewSubject,
  asReviewSubjectId,
  invokeObjectReconciliation,
  invokeRelationshipReconciliation,
} from "../src/index";
import {
  ORG_A,
  ORG_B,
  OBSERVED_AT,
  HUMAN_ALICE,
  makeAgentFinding,
  makeObjectCandidate,
  makeRelationshipFinding,
  makeRelationshipCandidate,
  makeAllowingAuthorizationPort,
  makeCanonicalObjectIdentity,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Discovery Governance Input Persistence V1: proves that whatever a
// persistence adapter recovers (an already hash-verified DiscoveryFinding
// plus, when one exists, a NormalizedCandidate) is either shaped correctly
// for direct use by invokeObjectReconciliation / invokeRelationshipReconciliation
// (the "hard success proof"), correctly reported as FINDING_ONLY (the real,
// current state of every OBJECT-kind finding — no fabrication), or correctly
// reported as INPUT_UNAVAILABLE (the honest legacy/pre-milestone case) — and
// fails closed on every internal incoherence rather than silently proceeding.
// ---------------------------------------------------------------------------

describe("recoverReconciliationInput", () => {
  test("INPUT_UNAVAILABLE: no durable finding at all (the legacy / pre-milestone case) is reported, never fabricated", () => {
    const finding = makeAgentFinding("legacy-1");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:legacy-1"),
      organisationId: ORG_A,
      finding,
    });

    const result = recoverReconciliationInput({ reviewSubject, finding: undefined, candidate: undefined });
    assert.equal(result.status, RECONCILIATION_INPUT_STATUS.INPUT_UNAVAILABLE);
  });

  test("FINDING_ONLY: an OBJECT-kind finding with no durable candidate is reported as FINDING_ONLY, not as unavailable and not fabricated", () => {
    const finding = makeAgentFinding("object-1");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:object-1"),
      organisationId: ORG_A,
      finding,
    });

    const result = recoverReconciliationInput({ reviewSubject, finding, candidate: undefined });
    assert.equal(result.status, RECONCILIATION_INPUT_STATUS.FINDING_ONLY);
    if (result.status === "FINDING_ONLY") {
      assert.equal(result.finding.findingId, finding.findingId);
    }
  });

  test("OBJECT_INPUT_AVAILABLE: an object finding with a durable candidate recovers both exactly", () => {
    const finding = makeAgentFinding("object-2");
    const candidate = makeObjectCandidate(finding, "object-2");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:object-2"),
      organisationId: ORG_A,
      finding,
      candidate,
    });

    const result = recoverReconciliationInput({ reviewSubject, finding, candidate });
    assert.equal(result.status, RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);
    if (result.status === "OBJECT_INPUT_AVAILABLE") {
      assert.deepEqual(result.candidate, candidate);
    }
  });

  test("RELATIONSHIP_INPUT_AVAILABLE: a relationship finding+candidate recovers both exactly", () => {
    const finding = makeRelationshipFinding("rel-1");
    const candidate = makeRelationshipCandidate(finding, "rel-1");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:rel-1"),
      organisationId: ORG_A,
      finding,
      candidate,
    });

    const result = recoverReconciliationInput({ reviewSubject, finding, candidate });
    assert.equal(result.status, RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE);
    if (result.status === "RELATIONSHIP_INPUT_AVAILABLE") {
      assert.deepEqual(result.candidate, candidate);
    }
  });

  test("FAIL CLOSED: recovered finding.findingId not matching the review subject throws, never silently substitutes", () => {
    const finding = makeAgentFinding("mismatch-1");
    const otherFinding = makeAgentFinding("mismatch-2");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:mismatch-1"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () => recoverReconciliationInput({ reviewSubject, finding: otherFinding, candidate: undefined }),
      /SubjectMismatchError|does not match/,
    );
  });

  test("FAIL CLOSED: a candidate substituted from a different finding is rejected", () => {
    const finding = makeRelationshipFinding("rel-2");
    const otherFinding = makeRelationshipFinding("rel-3");
    const otherCandidate = makeRelationshipCandidate(otherFinding, "rel-3");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:rel-2"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () => recoverReconciliationInput({ reviewSubject, finding, candidate: otherCandidate }),
      /does not back the recovered finding/,
    );
  });

  test("FAIL CLOSED: a RELATIONSHIP candidate substituted for what the finding declares as an OBJECT kind is rejected", () => {
    const finding = makeAgentFinding("swap-1");
    const relationshipFinding = makeRelationshipFinding("swap-1");
    const relationshipCandidate = makeRelationshipCandidate(relationshipFinding, "swap-1");
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:swap-1"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () =>
        recoverReconciliationInput({
          reviewSubject,
          finding,
          candidate: { ...relationshipCandidate, findingId: finding.findingId } as never,
        }),
      /candidateKind does not match/,
    );
  });

  test("FAIL CLOSED: a relationship candidate endpoint anchored to a different source connection than the recovered finding is rejected", () => {
    const finding = makeRelationshipFinding("rel-endpoint-1");
    const candidate = makeRelationshipCandidate(finding, "rel-endpoint-1", {
      sourceCandidateKind: "TOOL",
    });
    const tamperedCandidate = {
      ...candidate,
      sourceEndpoint: {
        referenceKind: "SOURCE_OBJECT" as const,
        sourceObject: { ...candidate.sourceEndpoint, connectionId: "connection:forged" } as never,
        candidateKind: "TOOL" as const,
      },
    };
    const reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:rel-endpoint-1"),
      organisationId: ORG_A,
      finding,
    });

    assert.throws(
      () => recoverReconciliationInput({ reviewSubject, finding, candidate: tamperedCandidate as never }),
      /anchored to a different source connection/,
    );
  });

  // ---------------------------------------------------------------------------
  // RECONCILIATION CONTINUITY PROOF (hard success proof, section 20): the
  // recovered objects must be usable, unchanged, by the existing
  // invoke*Reconciliation gates — no fabricated candidateId, no reconstructed
  // proposedIdentity, no weakened domain contract.
  // ---------------------------------------------------------------------------

  test("RECONCILIATION CONTINUITY: recovered RELATIONSHIP input is accepted unchanged by invokeRelationshipReconciliation", async () => {
    const finding = makeRelationshipFinding("continuity-rel-1");
    const candidate = makeRelationshipCandidate(finding, "continuity-rel-1", {
      relationshipTypeCode: "HANDOFF_TO",
      sourceCandidateKind: "AGENT_VERSION",
      targetCandidateKind: "AGENT",
    });
    let reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:continuity-rel-1"),
      organisationId: ORG_A,
      finding,
      candidate,
    });
    reviewSubject = { ...reviewSubject, state: "CERTIFIED" } as typeof reviewSubject;

    const recovered = recoverReconciliationInput({ reviewSubject, finding, candidate });
    assert.equal(recovered.status, "RELATIONSHIP_INPUT_AVAILABLE");
    if (recovered.status !== "RELATIONSHIP_INPUT_AVAILABLE") return;

    const authorizationPort = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: "CREATE_NEW",
      actor: HUMAN_ALICE,
    });

    const sourceAgent: AgentIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, "AGENT", "continuity-rel-1-source-agent"),
      agentId: asAgentId("agent:continuity-rel-1-source"),
      agentCode: "SOURCE_AGENT",
    };
    const source: AgentVersionIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, "AGENT_VERSION", "continuity-rel-1-source-version"),
      agent: sourceAgent,
      agentVersionId: asAgentVersionId("agent-version:continuity-rel-1"),
      versionCode: "v1",
    };
    const target: AgentIdentity = {
      canonicalObject: makeCanonicalObjectIdentity(ORG_A, "AGENT", "continuity-rel-1-target"),
      agentId: asAgentId("agent:continuity-rel-1-target"),
      agentCode: "TARGET_AGENT",
    };
    const authorizedState: GovernedRelationshipDraft<"HANDOFF_TO"> = {
      relationshipId: asRelationshipId("relationship:continuity-rel-1"),
      relationshipStateId: asRelationshipStateId("relationship-state:continuity-rel-1"),
      organisationId: ORG_A,
      relationshipType: "HANDOFF_TO",
      source,
      target,
      support: { assertionIds: candidate.assertionIds, evidenceIds: candidate.evidenceIds },
      validFrom: OBSERVED_AT,
      recordedAt: OBSERVED_AT,
    };

    const result = await invokeRelationshipReconciliation({
    endpointResolution: relationshipEndpointFixture(candidate, source.canonicalObject, target.canonicalObject),
      commandId: "cmd:continuity-rel-1",
      organisationId: ORG_A,
      reviewSubject: recovered.reviewSubject,
      finding: recovered.finding,
      candidate: recovered.candidate,
      actor: HUMAN_ALICE,
      authorizationPort,
      reasonCode: "test-continuity",
      requestedAt: OBSERVED_AT,
      requestedDecision: { outcome: "CREATE_NEW", authorizedState },
    });

    assert.equal(result.kind, "APPLIED");
    assert.equal(result.decision.relationshipCandidateId, candidate.candidateId);
  });

  test("RECONCILIATION CONTINUITY: recovered OBJECT input is accepted unchanged by invokeObjectReconciliation", async () => {
    const finding = makeAgentFinding("continuity-obj-1");
    const candidate = makeObjectCandidate(finding, "continuity-obj-1");
    let reviewSubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:continuity-obj-1"),
      organisationId: ORG_A,
      finding,
      candidate,
    });
    reviewSubject = { ...reviewSubject, state: "CERTIFIED" } as typeof reviewSubject;

    const recovered = recoverReconciliationInput({ reviewSubject, finding, candidate });
    assert.equal(recovered.status, "OBJECT_INPUT_AVAILABLE");
    if (recovered.status !== "OBJECT_INPUT_AVAILABLE") return;

    const canonicalObject = makeCanonicalObjectIdentity(ORG_A, "AGENT", "continuity-obj-1");
    const authorizationPort = makeAllowingAuthorizationPort({
      organisationId: ORG_A,
      subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId },
      requestedAction: "CREATE_NEW",
      actor: HUMAN_ALICE,
    });

    const result = await invokeObjectReconciliation({
      commandId: "cmd:continuity-obj-1",
      organisationId: ORG_A,
      reviewSubject: recovered.reviewSubject,
      finding: recovered.finding as never,
      candidate: recovered.candidate as never,
      actor: HUMAN_ALICE,
      authorizationPort,
      reasonCode: "test-continuity",
      requestedAt: OBSERVED_AT,
      requestedDecision: {
        outcome: "CREATE_NEW",
        subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "AGENT" },
        canonicalObject,
      },
    });

    assert.equal(result.kind, "APPLIED");
  });

  test("TENANT SAFETY: recovery never trusts an org argument implicitly — a caller must fetch by the review subject's own organisationId (documented boundary, enforced by every adapter call site)", () => {
    const finding = makeAgentFinding("tenant-1");
    const reviewSubjectOrgA = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:tenant-1"),
      organisationId: ORG_A,
      finding,
    });
    const reviewSubjectOrgB = { ...reviewSubjectOrgA, organisationId: ORG_B };

    // A finding recovered under the wrong tenant's review subject still
    // matches identity fields (findingId/candidateKind/sourceObject are not
    // tenant-scoped values themselves) — cross-tenant isolation is enforced
    // by the persistence adapter's own (organisation_id, finding_id) lookup
    // key, never by this pure function alone. This test documents that this
    // function is not itself the tenant boundary.
    const result = recoverReconciliationInput({ reviewSubject: reviewSubjectOrgB, finding, candidate: undefined });
    assert.equal(result.status, RECONCILIATION_INPUT_STATUS.FINDING_ONLY);
  });
});
