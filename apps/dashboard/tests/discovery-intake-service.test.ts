import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { asOrganisationId, type OrganisationId, type Evidence, type SourceAssertion, type AcquisitionRun } from "@council/canonical-contracts";
import {
  createReviewSubject,
  asReviewSubjectId,
  type AcquisitionRunCounts,
  type AcquisitionRunPersistenceResult,
  type ActiveObjectSourceMapping,
  type DiscoveryIntakePersistencePort,
  type EvidencePersistenceResult,
  type GovernanceReviewPersistencePort,
  type MaterializationPersistencePort,
  type ObjectMaterializationInput,
  type ObjectMaterializationResult,
  type ObjectSourceMappingLookupInput,
  type RelationshipMaterializationInput,
  type RelationshipMaterializationResult,
  type ReviewAuditChain,
  type ReviewSubject,
  type ReviewSubjectId,
  type ReviewSubjectPersistenceResult,
  type ReviewTransitionPersistenceResult,
  type SourceAssertionPersistenceResult,
  type TransitionResult,
} from "@council/governance-review";

// lib/governance/discovery-intake.ts transitively imports lib/governance/persistence.ts,
// which reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at module-load time — a static
// top-level import would be hoisted ahead of any same-file assignment (mirrors
// tests/governance-persistence-domain.test.ts). Every test below always passes its own
// fake ports explicitly, so the real (dummy-configured) Supabase client is never invoked.
let runGovernanceDiscoveryScan: typeof import("@/lib/governance/discovery-intake").runGovernanceDiscoveryScan;

before(async () => {
  process.env.SUPABASE_URL ??= "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ runGovernanceDiscoveryScan } = await import("@/lib/governance/discovery-intake"));
});

const ORG_A = asOrganisationId("org:11111111-1111-1111-1111-111111111111");
const ORG_B = asOrganisationId("org:22222222-2222-2222-2222-222222222222");

// ---------------------------------------------------------------------------
// In-memory fakes. Every "must never be called" method throws unconditionally
// so the machine-authority-ceiling and no-bypass adversarial tests below are
// proven by the orchestration code path actually never reaching them, not by
// inspection alone. FakeIntakePersistence enforces the same evidence-before-
// assertion, assertion/evidence-before-ReviewSubject ordering the real
// migration's FKs enforce, so a regression in discovery-intake.ts's call
// order fails these tests exactly as it would fail against the real database.
// ---------------------------------------------------------------------------

function tenantKey(organisationId: OrganisationId, id: string): string {
  return `${organisationId}::${id}`;
}

class FakeIntakePersistence implements DiscoveryIntakePersistencePort {
  readonly runs = new Map<string, { run: AcquisitionRun; counts?: AcquisitionRunCounts }>();
  // Keyed by (organisationId, id) — evidenceId/assertionId are scanner-generated content
  // hashes with no tenant concept at all, so the real schema's primary key (and this fake)
  // must be tenant-scoped to avoid one tenant's write colliding with another's.
  readonly evidence = new Map<string, Evidence>();
  readonly assertions = new Map<string, SourceAssertion>();
  evidenceCallCount = 0;
  assertionCallCount = 0;

  async startAcquisitionRun(organisationId: OrganisationId, run: AcquisitionRun): Promise<AcquisitionRunPersistenceResult> {
    const existing = this.runs.get(run.runId);
    if (existing) return { replay: true, runId: run.runId, status: existing.run.status };
    this.runs.set(run.runId, { run });
    return { replay: false, runId: run.runId, status: run.status };
  }

  async completeAcquisitionRun(
    organisationId: OrganisationId,
    run: AcquisitionRun,
    counts: AcquisitionRunCounts,
  ): Promise<AcquisitionRunPersistenceResult> {
    const existing = this.runs.get(run.runId);
    if (existing?.counts) return { replay: true, runId: run.runId, status: existing.run.status };
    this.runs.set(run.runId, { run, counts });
    return { replay: false, runId: run.runId, status: run.status };
  }

  async recordEvidence(organisationId: OrganisationId, evidence: Evidence): Promise<EvidencePersistenceResult> {
    this.evidenceCallCount += 1;
    // evidenceId already excludes the wall-clock capture moment from its own
    // identity (it hashes only source connection, locator, method, and match
    // content) — a rescan of unchanged content legitimately reproduces the
    // same id with a different capturedAt, and that is always a plain
    // replay, never a content conflict (mirrors the real migration's
    // record_discovery_evidence: first insert wins, no comparison).
    const key = tenantKey(organisationId, evidence.evidenceId);
    if (this.evidence.has(key)) {
      return { replay: true, evidenceId: evidence.evidenceId };
    }
    this.evidence.set(key, evidence);
    return { replay: false, evidenceId: evidence.evidenceId };
  }

  async recordSourceAssertion(organisationId: OrganisationId, assertion: SourceAssertion): Promise<SourceAssertionPersistenceResult> {
    this.assertionCallCount += 1;
    const key = tenantKey(organisationId, assertion.assertionId);
    if (this.assertions.has(key)) {
      return { replay: true, assertionId: assertion.assertionId };
    }
    // Mirrors source_assertion_evidence_evidence_fkey: every cited evidenceId
    // must already be durable for this same tenant.
    for (const evidenceId of assertion.evidenceIds) {
      if (!this.evidence.has(tenantKey(organisationId, evidenceId))) {
        throw new Error(`FK_VIOLATION: evidence ${evidenceId} is not durable for this tenant yet`);
      }
    }
    this.assertions.set(key, assertion);
    return { replay: false, assertionId: assertion.assertionId };
  }

  hasDurableEvidence(organisationId: OrganisationId, evidenceId: string): boolean {
    return this.evidence.has(tenantKey(organisationId, evidenceId));
  }

  hasDurableAssertion(organisationId: OrganisationId, assertionId: string): boolean {
    return this.assertions.has(tenantKey(organisationId, assertionId));
  }
}

class FakeReviewPersistence implements GovernanceReviewPersistencePort {
  readonly subjects = new Map<string, ReviewSubject>();
  readonly transitionsByKey = new Map<string, { subject: ReviewSubject; event: ReviewSubject["lastTransition"] }>();
  createCallCount = 0;
  transitionCallCount = 0;

  constructor(private readonly intake: FakeIntakePersistence) {}

  async createReviewSubject(subject: ReviewSubject): Promise<ReviewSubjectPersistenceResult> {
    this.createCallCount += 1;

    // Hard gate mirror: a ReviewSubject must never be creatable while any of
    // its cited assertionIds/evidenceIds are not already durable — exactly
    // what review_subject_assertions_assertion_fkey / review_subject_evidence_evidence_fkey
    // enforce in the real migration.
    for (const assertionId of subject.assertionIds) {
      if (!this.intake.hasDurableAssertion(subject.organisationId, assertionId)) {
        throw new Error(`HARD_GATE_VIOLATION: assertion ${assertionId} is not durable for this tenant yet`);
      }
    }
    for (const evidenceId of subject.evidenceIds) {
      if (!this.intake.hasDurableEvidence(subject.organisationId, evidenceId)) {
        throw new Error(`HARD_GATE_VIOLATION: evidence ${evidenceId} is not durable for this tenant yet`);
      }
    }

    const existing = this.subjects.get(subject.reviewSubjectId);
    if (existing) {
      const sameContent =
        existing.organisationId === subject.organisationId &&
        existing.findingId === subject.findingId &&
        existing.candidateKind === subject.candidateKind &&
        JSON.stringify(existing.sourceObject) === JSON.stringify(subject.sourceObject) &&
        existing.detectedAt === subject.detectedAt &&
        JSON.stringify([...existing.assertionIds].sort()) === JSON.stringify([...subject.assertionIds].sort()) &&
        JSON.stringify([...existing.evidenceIds].sort()) === JSON.stringify([...subject.evidenceIds].sort());
      if (!sameContent) throw new Error(`REVIEW_SUBJECT_ID_CONFLICT: ${subject.reviewSubjectId}`);
      return { replay: true, subject };
    }

    this.subjects.set(subject.reviewSubjectId, subject);
    return { replay: false, subject };
  }

  async getReviewSubject(organisationId: OrganisationId, reviewSubjectId: ReviewSubjectId): Promise<ReviewSubject | undefined> {
    const subject = this.subjects.get(reviewSubjectId);
    if (!subject || subject.organisationId !== organisationId) return undefined;
    return subject;
  }

  async persistReviewTransition(result: TransitionResult): Promise<ReviewTransitionPersistenceResult> {
    this.transitionCallCount += 1;
    const { subject, event } = result;
    const key = `${subject.reviewSubjectId}:${event.commandId}`;
    const existing = this.transitionsByKey.get(key);
    if (existing) {
      return { replay: true, subject: existing.subject, event: existing.event as ReviewSubject["lastTransition"] & object };
    }

    const stored = this.subjects.get(subject.reviewSubjectId);
    if (stored && stored.lastTransition && stored.lastTransition.commandId !== event.commandId && stored.state !== event.previousState) {
      throw new Error("STALE_REVIEW_STATE");
    }

    const updatedSubject: ReviewSubject = Object.freeze({ ...subject, state: event.newState, lastTransition: event });
    this.subjects.set(subject.reviewSubjectId, updatedSubject);
    this.transitionsByKey.set(key, { subject: updatedSubject, event });
    return { replay: false, subject: updatedSubject, event };
  }

  async getReviewAuditChain(): Promise<ReviewAuditChain | undefined> {
    throw new Error("NOT_IMPLEMENTED_IN_FAKE: getReviewAuditChain is not part of the Discovery Intake flow");
  }

  async persistAuthorizationDecision(): Promise<never> {
    throw new Error("FORBIDDEN: Discovery Intake must never call persistAuthorizationDecision (authorization is out of scope)");
  }

  async persistAuthorizedReconciliation(): Promise<never> {
    throw new Error("FORBIDDEN: Discovery Intake must never call persistAuthorizedReconciliation (reconciliation is out of scope)");
  }

  async getReconciliationAuditChain(): Promise<undefined> {
    throw new Error("FORBIDDEN: Discovery Intake must never call getReconciliationAuditChain");
  }
}

class FakeMaterializationPersistence implements MaterializationPersistencePort {
  readonly mappings = new Map<string, ActiveObjectSourceMapping>();

  seedMapping(input: ObjectSourceMappingLookupInput, mapping: ActiveObjectSourceMapping): void {
    this.mappings.set(this.key(input), mapping);
  }

  private key(input: ObjectSourceMappingLookupInput): string {
    return [input.organisationId, input.sourceConnectionId, input.sourceExternalType, input.sourceExternalId].join("::");
  }

  async materializeObjectReconciliation(_input: ObjectMaterializationInput): Promise<ObjectMaterializationResult> {
    throw new Error("FORBIDDEN: Discovery Intake must never call materializeObjectReconciliation");
  }

  async materializeRelationshipReconciliation(_input: RelationshipMaterializationInput): Promise<RelationshipMaterializationResult> {
    throw new Error("FORBIDDEN: Discovery Intake must never call materializeRelationshipReconciliation");
  }

  async findActiveObjectSourceMapping(input: ObjectSourceMappingLookupInput): Promise<ActiveObjectSourceMapping | undefined> {
    return this.mappings.get(this.key(input));
  }
}

function makePorts(intake = new FakeIntakePersistence()) {
  const review = new FakeReviewPersistence(intake);
  const materialization = new FakeMaterializationPersistence();
  return { review, materialization, intake };
}

// ---------------------------------------------------------------------------
// Fixture repository: one file declares an Agent that references a Model and
// a Tool list, so relationship correlation (USES_MODEL + USES_TOOL) fires
// alongside the three object candidates — matching the exact literal content
// shapes packages/scanner's own tests already use (kind = "agent",
// modelReference = "...", tools = [...]).
// ---------------------------------------------------------------------------

async function withFixtureRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "discovery-intake-service-"));
  try {
    await writeFile(
      join(root, "agent.py"),
      ['kind = "agent"', 'modelReference = "gpt-x"', "tools = [alpha]", ""].join("\n"),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Discovery Intake V1: real scan -> durable evidence -> governed review queue", () => {
  test("REAL DISCOVERY: a real LocalRepositoryAdapter scan reaches DETECTED/PROPOSED review subjects for Agent/Model/Tool and their relationships", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.artifactsScanned, 1);
      assert.equal(result.objectCandidates, 3, "expected AGENT + MODEL + TOOL");
      assert.equal(result.relationshipCandidates, 2, "expected USES_MODEL + USES_TOOL");
      assert.equal(result.reviewSubjectsCreated, 3);
      assert.equal(result.relationshipSubjectsCreated, 2);
      assert.equal(result.proposalsCreated, 5, "every UNREVIEWED finding is deterministically eligible under PASS_THROUGH_V1");
      assert.equal(result.alreadyGoverned, 0);
      assert.deepEqual(result.failures, []);

      assert.equal(ports.intake.evidence.size, 3, "one Evidence per object candidate");
      assert.equal(ports.intake.assertions.size, 3, "one SourceAssertion per object candidate");
      assert.equal(ports.review.subjects.size, 5, "3 object + 2 relationship review subjects");
      for (const subject of ports.review.subjects.values()) {
        assert.equal(subject.state, "PROPOSED");
        assert.equal(subject.organisationId, ORG_A);
      }

      // Durable acquisition run reflects the real scan's executive counts.
      const runRow = [...ports.intake.runs.values()][0];
      assert.equal(runRow.run.status, "SUCCEEDED");
      assert.equal(runRow.counts?.objectCandidates, 3);
      assert.equal(runRow.counts?.relationshipCandidates, 2);
    });
  });

  test("REVIEW: a non-eligible finding (already reviewed) is left DETECTED, not treated as an error", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      // Simulate a human having already advanced one subject beyond DETECTED
      // between scans by directly mutating the fake's stored state, then
      // rescan: the machine must never attempt to re-propose it, and must
      // never error trying.
      const [someId, someSubject] = [...ports.review.subjects.entries()][0];
      ports.review.subjects.set(someId, Object.freeze({ ...someSubject, state: "CONFIRMED" }));

      const second = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(second.status, "SUCCEEDED");
      assert.deepEqual(second.failures, []);
      assert.equal(ports.review.subjects.get(someId)?.state, "CONFIRMED", "machine intake never disturbs an already-advanced subject");
    });
  });

  test("IDEMPOTENT RE-SCAN: an identical rerun creates no duplicate ReviewSubject and no duplicate proposal audit", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      const first = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const subjectIdsAfterFirst = [...ports.review.subjects.keys()].sort();
      const transitionCountAfterFirst = ports.review.transitionCallCount;

      const second = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(second.reviewSubjectsCreated, 0, "rescan must not report any NEW review subjects");
      assert.equal(second.relationshipSubjectsCreated, 0);
      assert.equal(second.proposalsCreated, 0, "rescan must not report any NEW proposals");
      assert.deepEqual([...ports.review.subjects.keys()].sort(), subjectIdsAfterFirst, "identical set of review subject ids, no duplicates");
      assert.equal(ports.review.subjects.size, first.reviewSubjectsCreated + first.relationshipSubjectsCreated);

      // getReviewSubject was consulted on replay (transitionCallCount does
      // not grow past what a real "already PROPOSED" read-then-skip implies:
      // no new transition attempt was ever made).
      assert.equal(ports.review.transitionCallCount, transitionCountAfterFirst);
    });
  });

  test("EVIDENCE: identical scan rerun does not duplicate logical evidence or assertion identity", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const evidenceCountAfterFirst = ports.intake.evidence.size;
      const assertionCountAfterFirst = ports.intake.assertions.size;

      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(ports.intake.evidence.size, evidenceCountAfterFirst);
      assert.equal(ports.intake.assertions.size, assertionCountAfterFirst);
    });
  });

  test("ALREADY GOVERNED: a mapped source identity is recognized as ALREADY_GOVERNED and creates no duplicate object ReviewSubject, but its relationships remain reviewable", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();

      // Discover once to learn the real, content-addressed source identity
      // this single-file fixture's object candidates resolve to, then seed a
      // mapping for it exactly as Canonical Materialization V1 would have
      // already recorded. All three object candidates (AGENT/MODEL/TOOL) are
      // detected within the same one file, so — matching the real, closed
      // canonical_object_source_mappings' own granularity (organisation +
      // source connection + external type + external id, never candidate
      // kind) — they share one SourceObjectIdentity and one mapping
      // legitimately suppresses all three at once.
      const probe = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        probe,
      );
      const agentSubject = [...probe.review.subjects.values()].find((s) => s.candidateKind === "AGENT")!;

      ports.materialization.seedMapping(
        {
          organisationId: ORG_A,
          sourceConnectionId: agentSubject.sourceObject.connectionId,
          sourceExternalType: agentSubject.sourceObject.externalType,
          sourceExternalId: agentSubject.sourceObject.externalId,
        },
        { mappingId: "mapping:1", canonicalObjectId: "canonical-object:agent-1", canonicalObjectKind: "AGENT" },
      );

      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.alreadyGoverned, 3, "AGENT/MODEL/TOOL all share this fixture's one file-level source identity");
      assert.equal(result.reviewSubjectsCreated, 0, "no NEW object ReviewSubject for any already-governed identity");
      assert.equal(
        result.relationshipSubjectsCreated,
        2,
        "already-governed endpoints (even every endpoint) never suppress a relationship finding",
      );
      // Evidence/assertions for every already-governed object are still preserved for future drift analysis.
      assert.equal(ports.intake.evidence.size, 3);
      assert.equal(ports.intake.assertions.size, 3);
      // No object review subject exists at all for the mapped identity.
      assert.equal(
        [...ports.review.subjects.values()].filter((s) => s.candidateKind !== "RELATIONSHIP").length,
        0,
      );
      assert.equal(
        [...ports.review.subjects.values()].filter((s) => s.candidateKind === "RELATIONSHIP").length,
        2,
      );
    });
  });

  test("TENANT ISOLATION: a mapping recorded under a different organisation does not suppress this tenant's identical finding", async () => {
    await withFixtureRepository(async (root) => {
      const probe = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        probe,
      );
      const agentSubject = [...probe.review.subjects.values()].find((s) => s.candidateKind === "AGENT")!;

      const ports = makePorts();
      // Seed the mapping under ORG_B for the identical source identity
      // (LocalRepositoryAdapter derives connectionId purely from the
      // descriptor, so the same fixture path yields the same
      // sourceConnectionId regardless of which tenant scans it).
      ports.materialization.seedMapping(
        {
          organisationId: ORG_B,
          sourceConnectionId: agentSubject.sourceObject.connectionId,
          sourceExternalType: agentSubject.sourceObject.externalType,
          sourceExternalId: agentSubject.sourceObject.externalId,
        },
        { mappingId: "mapping:org-b", canonicalObjectId: "canonical-object:org-b-agent", canonicalObjectKind: "AGENT" },
      );

      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.alreadyGoverned, 0, "another tenant's mapping must never suppress this tenant's finding");
      assert.equal(result.reviewSubjectsCreated, 3);
      for (const subject of ports.review.subjects.values()) {
        assert.equal(subject.organisationId, ORG_A);
      }
    });
  });

  test("FAILURE ISOLATION: one item failure leaves successful sibling findings valid and is reported without corrupting the scan", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      const originalRecordEvidence = ports.intake.recordEvidence.bind(ports.intake);
      let calls = 0;
      ports.intake.recordEvidence = async (organisationId, evidence) => {
        calls += 1;
        if (calls === 1) throw new Error("simulated malformed evidence for the first item only");
        return originalRecordEvidence(organisationId, evidence);
      };

      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.status, "PARTIAL");
      // AGENT's own evidence failure is one direct failure; both relationship
      // candidates (USES_MODEL, USES_TOOL) cite AGENT's assertion/evidence as
      // part of their unioned provenance, so they correctly cascade-fail
      // closed too rather than being silently created without one endpoint's
      // durable evidence — this is correct dependency-aware failure
      // isolation, not corruption: the two genuinely independent siblings
      // (MODEL, TOOL) are wholly unaffected.
      assert.equal(result.failures.length, 3);
      assert.match(result.failures[0].reason, /simulated malformed evidence/);
      assert.equal(result.failures[0].candidateKind, "AGENT");
      for (const failure of result.failures.slice(1)) {
        assert.equal(failure.candidateKind, "RELATIONSHIP");
        assert.match(failure.reason, /not durable/);
      }
      assert.equal(result.reviewSubjectsCreated, 2, "MODEL and TOOL are wholly independent of AGENT's failure and still succeed");
      assert.equal(result.relationshipSubjectsCreated, 0, "both relationships depend on AGENT's evidence and correctly fail closed with it");
    });
  });

  test("ADVERSARIAL: machine intake never invokes authorization, reconciliation, or materialization — every forbidden port method would throw if called", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      // No failure was recorded, which is only possible if none of the
      // FORBIDDEN-throwing fake methods (persistAuthorizationDecision,
      // persistAuthorizedReconciliation, getReconciliationAuditChain,
      // materializeObjectReconciliation, materializeRelationshipReconciliation)
      // were ever reached.
      assert.deepEqual(result.failures, []);
      assert.equal(result.status, "SUCCEEDED");

      // Every persisted subject is at most PROPOSED — never CONFIRMED/CERTIFIED.
      for (const subject of ports.review.subjects.values()) {
        assert.ok(["DETECTED", "PROPOSED"].includes(subject.state));
      }
    });
  });

  test("ADVERSARIAL (static): the service module's source never references confirm/certify/reject or any authorization/reconciliation/materialization write RPC name", () => {
    const modulePath = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "governance", "discovery-intake.ts");
    const source = readFileSync(modulePath, "utf8");

    for (const forbidden of [
      "confirm(",
      "certify(",
      "reject(",
      "persistAuthorizationDecision",
      "persistAuthorizedReconciliation",
      "materializeObjectReconciliation",
      "materializeRelationshipReconciliation",
    ]) {
      assert.ok(!source.includes(forbidden), `discovery-intake.ts must never reference "${forbidden}"`);
    }
  });

  test("ADVERSARIAL: forged organisationId cannot read another tenant's review subject through this service's own port surface", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [reviewSubjectId] = [...ports.review.subjects.keys()];
      const crossTenantRead = await ports.review.getReviewSubject(ORG_B, reviewSubjectId as ReviewSubjectId);
      assert.equal(crossTenantRead, undefined, "a subject id guessed/reused under a different organisationId must never resolve");
    });
  });

  test("ADVERSARIAL: findingId reuse with materially different candidate semantics fails closed, never silently replays", async () => {
    // Simulates a reviewSubjectId collision carrying genuinely different
    // content (e.g. a hash collision, or a forged finding) — a scenario the
    // deterministic content-addressed id scheme should make practically
    // unreachable in real operation, but the persistence boundary must still
    // fail closed if it is ever reached, exactly as gov_repo.create_review_subject
    // does for a real conflicting reuse of review_subject_id.
    const ports = makePorts();
    const sharedReviewSubjectId = asReviewSubjectId("review-subject:collision-test");

    const findingA = {
      findingId: "discovery-finding:a" as never,
      findingNature: "CANDIDATE" as const,
      candidateKind: "AGENT" as const,
      sourceObject: { connectionId: "source-connection:x" as never, externalType: "file", externalId: "a.py" as never },
      assertionIds: ["source-assertion:a" as never],
      evidenceIds: ["evidence:a" as never],
      confidence: 0.9,
      reviewStatus: "UNREVIEWED" as const,
      requiresReview: true as const,
      createsCanonicalObject: false as const,
      detectedAt: "2026-01-01T00:00:00.000Z" as never,
    };
    const findingB = { ...findingA, findingId: "discovery-finding:b" as never, sourceObject: { ...findingA.sourceObject, externalId: "b.py" as never } };

    await ports.intake.recordEvidence(ORG_A, {
      evidenceId: "evidence:a" as never,
      handling: "NON_SENSITIVE" as never,
      locations: [],
      hashes: [],
      capturedAt: "2026-01-01T00:00:00.000Z" as never,
    });
    await ports.intake.startAcquisitionRun(ORG_A, {
      runId: "acquisition-run:x" as never,
      connection: { connectionId: "source-connection:x" as never, sourceSystemId: "source-system:x" as never },
      mode: "FULL",
      status: "RUNNING",
      adapterName: "test",
      adapterVersion: "1.0.0",
      startedAt: "2026-01-01T00:00:00.000Z" as never,
    });
    await ports.intake.recordSourceAssertion(ORG_A, {
      assertionId: "source-assertion:a" as never,
      sourceObject: findingA.sourceObject,
      runId: "acquisition-run:x" as never,
      method: { code: "test" },
      trustState: "INFERRED" as never,
      observedAt: "2026-01-01T00:00:00.000Z" as never,
      recordedAt: "2026-01-01T00:00:00.000Z" as never,
      evidenceIds: ["evidence:a" as never],
    });

    const subjectA = createReviewSubject({ reviewSubjectId: sharedReviewSubjectId, organisationId: ORG_A, finding: findingA });
    const firstResult = await ports.review.createReviewSubject(subjectA);
    assert.equal(firstResult.replay, false);

    const subjectB = createReviewSubject({ reviewSubjectId: sharedReviewSubjectId, organisationId: ORG_A, finding: findingB });
    await assert.rejects(
      () => ports.review.createReviewSubject(subjectB),
      /REVIEW_SUBJECT_ID_CONFLICT/,
      "reusing a reviewSubjectId with different underlying finding content must fail closed, never silently replay",
    );
  });
});
