import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  asIsoTimestamp,
  asOrganisationId,
  CANONICAL_OBJECT_KIND,
  RECONCILIATION_OUTCOME,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type NormalizedObjectCandidate,
  type OrganisationId,
} from "@council/canonical-contracts";
import {
  AUTHORIZATION_RESULT,
  asReviewSubjectId,
  certify,
  confirm,
  createReviewSubject,
  invokeObjectReconciliation,
  propose,
  RECONCILIATION_INPUT_STATUS,
  recoverReconciliationInput,
  REVIEW_STATE,
  type ReconciliationAuthorizationPort,
  type ReconciliationAuthorizationRequest,
  type ReconciliationAuthorizationResult,
  type ObjectReconciliationInvocationCommand,
} from "@council/governance-review";
import {
  DiscoveryPipeline,
  LocalRepositoryAdapter,
  ModelReferenceDeclarationSpecification,
  normalizeObjectCandidate,
  ToolListDeclarationSpecification,
} from "@council/scanner";

/**
 * HARD CONTINUITY PROOF (Object Candidate Normalization V1).
 *
 * Proves the full product chain end to end for every currently-normalizable
 * production object kind (MODEL, TOOL):
 *
 *   real LocalRepositoryAdapter scan
 *   -> real DiscoveryFinding
 *   -> normalizeObjectCandidate -> real NormalizedObjectCandidate
 *   -> createReviewSubject -> DETECTED -> PROPOSED -> CONFIRMED -> CERTIFIED
 *   -> recoverReconciliationInput -> OBJECT_INPUT_AVAILABLE (exact pair)
 *   -> invokeObjectReconciliation accepts the recovered pair unchanged (APPLIED)
 *
 * This never touches Supabase/persistence adapters (pure domain composition
 * of @council/scanner + @council/governance-review), and never invokes
 * authorization, reconciliation, or materialization automatically outside of
 * this test's own explicit, human-actor invocation at the very end.
 */

const ORG_A: OrganisationId = asOrganisationId("org:11111111-1111-1111-1111-111111111111");
const OBSERVED_AT = asIsoTimestamp("2026-01-01T00:00:00.000Z");
const LATER_AT = asIsoTimestamp("2026-01-01T01:00:00.000Z");

const HUMAN_ALICE = {
  authorityKind: "HUMAN" as const,
  actorReference: "user:alice@example.test",
};

function makeAllowingAuthorizationPort(expected: {
  readonly organisationId: OrganisationId;
  readonly candidateId: string;
}): ReconciliationAuthorizationPort {
  return {
    authorize(request: ReconciliationAuthorizationRequest): ReconciliationAuthorizationResult {
      assert.equal(request.organisationId, expected.organisationId);
      assert.equal(request.subject.subjectKind, "CANDIDATE");
      if (request.subject.subjectKind === "CANDIDATE") {
        assert.equal(request.subject.candidateId, expected.candidateId);
      }
      return {
        authorizationDecisionId: `authz:${expected.candidateId}`,
        result: AUTHORIZATION_RESULT.ALLOW,
        organisationId: request.organisationId,
        actorReference: request.actor.actorReference,
        subject: request.subject,
        requestedAction: request.requestedAction,
        evaluatedAt: LATER_AT,
      };
    },
  };
}

function makeCanonicalObjectIdentity<Kind extends CanonicalObjectKind>(
  kind: Kind,
  seed: string,
): CanonicalObjectIdentity<Kind> {
  return {
    organisationId: ORG_A,
    objectId: `canonical-object:${seed}` as never,
    kind,
  };
}

async function withTempRepository(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "object-candidate-continuity-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(root, name), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Drives a fresh, real ReviewSubject through the full HITL lifecycle to CERTIFIED. */
function driveToCertified(
  seed: string,
  finding: Parameters<typeof createReviewSubject>[0]["finding"],
  candidate: NormalizedObjectCandidate,
) {
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
    actor: { authorityKind: "DETERMINISTIC_RULE", ruleCode: "PASS_THROUGH_V1", ruleVersion: "1.0" },
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
    actor: HUMAN_ALICE,
    occurredAt: LATER_AT,
    reasonCode: "GOVERNANCE_BOARD_APPROVED",
  }).subject;

  return subject;
}

describe("Object Candidate Normalization V1: HARD CONTINUITY PROOF", () => {
  test("MODEL: real scan -> normalized candidate -> CERTIFIED -> OBJECT_INPUT_AVAILABLE -> invokeObjectReconciliation APPLIED", async () => {
    await withTempRepository({ "model.py": 'MODEL_REFERENCE = "prod-continuity-model"\n' }, async (root) => {
      const pipeline = new DiscoveryPipeline(
        new LocalRepositoryAdapter(root),
        [new ModelReferenceDeclarationSpecification()],
        { clock: { now: () => "2026-01-01T00:00:00.000Z" } },
      );
      const { candidates } = await pipeline.run();
      assert.equal(candidates.length, 1);
      const discovered = candidates[0]!;

      const normalization = normalizeObjectCandidate(discovered);
      assert.equal(normalization.status, "NORMALIZED");
      if (normalization.status !== "NORMALIZED") return;
      const candidate = normalization.candidate;
      assert.equal(candidate.candidateKind, "MODEL");
      assert.deepEqual((candidate as { proposedIdentity: { modelReference?: string } }).proposedIdentity, {
        modelReference: "prod-continuity-model",
      });

      const certified = driveToCertified("model-continuity", discovered.finding, candidate);
      assert.equal(certified.state, REVIEW_STATE.CERTIFIED);

      const recovered = recoverReconciliationInput({
        reviewSubject: certified,
        finding: discovered.finding,
        candidate,
      });
      assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);
      if (recovered.status !== RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE) return;
      assert.equal(recovered.finding, discovered.finding);
      assert.equal(recovered.candidate, candidate);

      const port = makeAllowingAuthorizationPort({ organisationId: ORG_A, candidateId: candidate.candidateId });
      const command: ObjectReconciliationInvocationCommand<"MODEL"> = {
        commandId: "cmd:model-continuity:reconcile",
        organisationId: ORG_A,
        reviewSubject: recovered.reviewSubject,
        finding: recovered.finding as never,
        candidate: recovered.candidate as never,
        actor: HUMAN_ALICE,
        authorizationPort: port,
        reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
        requestedAt: LATER_AT,
        requestedDecision: {
          outcome: "CREATE_NEW",
          subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "MODEL" },
          canonicalObject: makeCanonicalObjectIdentity(CANONICAL_OBJECT_KIND.MODEL, "model-continuity"),
        },
      };

      const result = await invokeObjectReconciliation(command);
      assert.equal(result.kind, "APPLIED");
      assert.equal(result.decision.outcome, RECONCILIATION_OUTCOME.CREATE_NEW);
      assert.equal(result.decision.candidateKind, "MODEL");
      assert.equal(result.authorization.result, "ALLOW");
    });
  });

  test("TOOL: real scan -> normalized candidate -> CERTIFIED -> OBJECT_INPUT_AVAILABLE -> invokeObjectReconciliation APPLIED", async () => {
    await withTempRepository({ "agent.py": "tools = [prod_continuity_tool]\n" }, async (root) => {
      const pipeline = new DiscoveryPipeline(
        new LocalRepositoryAdapter(root),
        [new ToolListDeclarationSpecification()],
        { clock: { now: () => "2026-01-01T00:00:00.000Z" } },
      );
      const { candidates } = await pipeline.run();
      assert.equal(candidates.length, 1);
      const discovered = candidates[0]!;

      const normalization = normalizeObjectCandidate(discovered);
      assert.equal(normalization.status, "NORMALIZED");
      if (normalization.status !== "NORMALIZED") return;
      const candidate = normalization.candidate;
      assert.equal(candidate.candidateKind, "TOOL");
      assert.deepEqual((candidate as { proposedIdentity: { declarationKey?: string } }).proposedIdentity, {
        declarationKey: "prod_continuity_tool",
      });

      const certified = driveToCertified("tool-continuity", discovered.finding, candidate);
      assert.equal(certified.state, REVIEW_STATE.CERTIFIED);

      const recovered = recoverReconciliationInput({
        reviewSubject: certified,
        finding: discovered.finding,
        candidate,
      });
      assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);
      if (recovered.status !== RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE) return;

      const port = makeAllowingAuthorizationPort({ organisationId: ORG_A, candidateId: candidate.candidateId });
      const command: ObjectReconciliationInvocationCommand<"TOOL"> = {
        commandId: "cmd:tool-continuity:reconcile",
        organisationId: ORG_A,
        reviewSubject: recovered.reviewSubject,
        finding: recovered.finding as never,
        candidate: recovered.candidate as never,
        actor: HUMAN_ALICE,
        authorizationPort: port,
        reasonCode: "GOVERNANCE_BOARD_APPROVED_RECONCILIATION",
        requestedAt: LATER_AT,
        requestedDecision: {
          outcome: "CREATE_NEW",
          subject: { subjectKind: "CANDIDATE", candidateId: candidate.candidateId, candidateKind: "TOOL" },
          canonicalObject: makeCanonicalObjectIdentity(CANONICAL_OBJECT_KIND.TOOL, "tool-continuity"),
        },
      };

      const result = await invokeObjectReconciliation(command);
      assert.equal(result.kind, "APPLIED");
      assert.equal(result.decision.outcome, RECONCILIATION_OUTCOME.CREATE_NEW);
      assert.equal(result.decision.candidateKind, "TOOL");
    });
  });

  // AGENT's NOT_SAFELY_NORMALIZABLE outcome (real AgentKindDeclarationSpecification
  // evidence has no derivable identity) is proven directly against a real
  // scanner DiscoveryCandidate in packages/scanner/test/discovery-engine/
  // object-candidate-normalization.test.ts, and its dashboard-visible
  // consequence (no NormalizedObjectCandidate ever reaches Discovery Intake
  // for AGENT, staying FINDING_ONLY on recovery) is proven end to end in
  // apps/dashboard/tests/discovery-intake-service.test.ts.
});
