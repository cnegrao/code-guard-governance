import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asOrganisationId,
  type OrganisationId,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type DiscoveryFindingId,
  type Evidence,
  type NormalizedCandidate,
  type SourceAssertion,
  type AcquisitionRun,
} from "@council/canonical-contracts";
import {
  createReviewSubject,
  normalizedObjectIdentity,
  asReviewSubjectId,
  recoverReconciliationInput,
  RECONCILIATION_INPUT_STATUS,
  REVIEW_STATE,
  type AcquisitionRunCounts,
  type AcquisitionRunPersistenceResult,
  type ActiveObjectSourceMapping,
  type AgentVersionTechnicalProfileMaterializationInput,
  type AgentVersionTechnicalProfileMaterializationResult,
  type AgentVersionTechnicalProfilePersistencePort,
  type AgentVersionTechnicalProfileProposalInput,
  type AgentVersionTechnicalProfileProposalResult,
  type DiscoveryFindingPersistenceResult,
  type DiscoveryIntakePersistencePort,
  type EvidencePersistenceResult,
  type GovernanceReviewPersistencePort,
  type MaterializationPersistencePort,
  type NormalizedCandidatePersistenceResult,
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
import { deriveReconciliationReadiness } from "@/lib/governance/reconciliation-readiness";

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
  readonly findings = new Map<string, DiscoveryFinding<DiscoveryCandidateKind>>();
  // Keyed by tenantKey(organisationId, findingId) — mirrors the real schema's
  // UNIQUE (organisation_id, finding_id) on gov_repo.discovery_candidates
  // (at most one durable candidate per finding, the real current cardinality).
  readonly candidatesByFinding = new Map<string, NormalizedCandidate>();
  evidenceCallCount = 0;
  assertionCallCount = 0;
  findingCallCount = 0;
  candidateCallCount = 0;

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

  async recordDiscoveryFinding(
    organisationId: OrganisationId,
    finding: DiscoveryFinding<DiscoveryCandidateKind>,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<DiscoveryFindingPersistenceResult> {
    this.findingCallCount += 1;
    // Mirrors gov_repo.discovery_findings_run_fkey: the cited acquisition run
    // must already be durable.
    if (!this.runs.has(acquisitionRunId)) {
      throw new Error(`FK_VIOLATION: acquisition run ${acquisitionRunId} is not durable yet`);
    }
    for (const assertionId of finding.assertionIds) {
      if (!this.hasDurableAssertion(organisationId, assertionId)) {
        throw new Error(`FK_VIOLATION: assertion ${assertionId} is not durable for this tenant yet`);
      }
    }
    for (const evidenceId of finding.evidenceIds) {
      if (!this.hasDurableEvidence(organisationId, evidenceId)) {
        throw new Error(`FK_VIOLATION: evidence ${evidenceId} is not durable for this tenant yet`);
      }
    }

    // Mirrors gov_repo.record_discovery_finding: findingId already excludes
    // detectedAt (the only field expected to vary across a rescan of
    // unchanged content, exactly like evidenceId/assertionId exclude their
    // own wall-clock fields) — a reused finding_id always replays, first
    // insert wins, no content comparison.
    const key = tenantKey(organisationId, finding.findingId);
    const existing = this.findings.get(key);
    if (existing) {
      return { replay: true, findingId: finding.findingId };
    }
    this.findings.set(key, finding);
    return { replay: false, findingId: finding.findingId };
  }

  async getDiscoveryFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<DiscoveryFinding<DiscoveryCandidateKind> | undefined> {
    return this.findings.get(tenantKey(organisationId, findingId));
  }

  async recordNormalizedCandidate(
    organisationId: OrganisationId,
    candidate: NormalizedCandidate,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<NormalizedCandidatePersistenceResult> {
    this.candidateCallCount += 1;
    if (!this.hasDurableFinding(organisationId, candidate.findingId)) {
      throw new Error(`FK_VIOLATION: finding ${candidate.findingId} is not durable for this tenant yet`);
    }
    if (!this.runs.has(acquisitionRunId)) {
      throw new Error(`FK_VIOLATION: acquisition run ${acquisitionRunId} is not durable yet`);
    }
    const finding = this.findings.get(tenantKey(organisationId, candidate.findingId))!;
    if (finding.candidateKind !== candidate.candidateKind) {
      throw new Error(`DISCOVERY_CANDIDATE_KIND_MISMATCH: ${candidate.candidateId}`);
    }
    if (JSON.stringify(finding.sourceObject) !== JSON.stringify(candidate.sourceObject)) {
      throw new Error(`DISCOVERY_CANDIDATE_SOURCE_MISMATCH: ${candidate.candidateId}`);
    }

    const findingKey = tenantKey(organisationId, candidate.findingId);
    const existing = this.candidatesByFinding.get(findingKey);
    if (existing) {
      if (existing.candidateId !== candidate.candidateId) {
        throw new Error(`DISCOVERY_CANDIDATE_FINDING_ALREADY_HAS_CANDIDATE: ${candidate.findingId}`);
      }
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new Error(`DISCOVERY_CANDIDATE_CONFLICT: ${candidate.candidateId}`);
      }
      return { replay: true, candidateId: candidate.candidateId };
    }
    this.candidatesByFinding.set(findingKey, candidate);
    return { replay: false, candidateId: candidate.candidateId };
  }

  async getNormalizedCandidateForFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<NormalizedCandidate | undefined> {
    return this.candidatesByFinding.get(tenantKey(organisationId, findingId));
  }

  hasDurableEvidence(organisationId: OrganisationId, evidenceId: string): boolean {
    return this.evidence.has(tenantKey(organisationId, evidenceId));
  }

  hasDurableAssertion(organisationId: OrganisationId, assertionId: string): boolean {
    return this.assertions.has(tenantKey(organisationId, assertionId));
  }

  hasDurableFinding(organisationId: OrganisationId, findingId: string): boolean {
    return this.findings.has(tenantKey(organisationId, findingId));
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

    // Hard gate mirror: a ReviewSubject must never be creatable while its
    // backing DiscoveryFinding is not already durable — exactly what
    // review_subjects_finding_fkey enforces in the real migration (Discovery
    // Governance Input Persistence V1).
    if (!this.intake.hasDurableFinding(subject.organisationId, subject.findingId)) {
      throw new Error(`HARD_GATE_VIOLATION: finding ${subject.findingId} is not durable for this tenant yet`);
    }

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
    return [input.organisationId, input.sourceConnectionId, input.sourceExternalType, input.sourceExternalId, input.canonicalObjectKind ?? "LEGACY", input.normalizedObjectIdentity ?? "LEGACY"].join("::");
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

class FakeAgentVersionTechnicalProfilePersistence implements AgentVersionTechnicalProfilePersistencePort {
  readonly proposals = new Map<string, AgentVersionTechnicalProfileProposalInput>();
  readonly materializations = new Map<string, AgentVersionTechnicalProfileMaterializationInput>();

  private key(organisationId: string, id: string): string {
    return `${organisationId}::${id}`;
  }

  async recordAgentVersionTechnicalProfileProposal(
    input: AgentVersionTechnicalProfileProposalInput,
  ): Promise<AgentVersionTechnicalProfileProposalResult> {
    const key = this.key(input.organisationId, input.proposalId);
    const replay = this.proposals.has(key);
    if (!replay) this.proposals.set(key, input);
    return { replay, proposalId: input.proposalId };
  }

  async materializeAgentVersionTechnicalProfile(
    input: AgentVersionTechnicalProfileMaterializationInput,
  ): Promise<AgentVersionTechnicalProfileMaterializationResult> {
    const key = this.key(input.organisationId, `${input.canonicalObjectId}::${input.proposalId}`);
    const replay = this.materializations.has(key);
    if (!replay) this.materializations.set(key, input);
    return { replay, status: "APPLIED", canonicalObjectId: input.canonicalObjectId };
  }
}

function makePorts(intake = new FakeIntakePersistence()) {
  const review = new FakeReviewPersistence(intake);
  const materialization = new FakeMaterializationPersistence();
  const agentVersionTechnicalProfile = new FakeAgentVersionTechnicalProfilePersistence();
  return { review, materialization, intake, agentVersionTechnicalProfile };
}

describe("Milestone 9: column lineage through existing governed intake", () => {
  const sql = "INSERT INTO target (id) SELECT s.id FROM source s;";
  const scan = (root: string, ports: ReturnType<typeof makePorts>, organisationId = ORG_A) => runGovernanceDiscoveryScan({
    executionContext: { organisationId }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root },
  }, ports);
  const prepare = async (root: string) => {
    await writeFile(join(root, "schema.sql"), "CREATE TABLE source (id INT); CREATE TABLE target (id INT);");
    await writeFile(join(root, "load.sql"), sql);
  };
  const relationships = (ports: ReturnType<typeof makePorts>) => [...ports.intake.candidatesByFinding.values()]
    .filter(candidate => candidate.candidateKind === "RELATIONSHIP");

  test("exact DATA_ELEMENT lineage retains durable transformation evidence, PROPOSED review and M7 recovery", async () => {
    await withFixtureRepository(async root => {
      await prepare(root);
      const ports = makePorts();
      const result = await scan(root, ports);
      assert.equal(result.status, "SUCCEEDED");
      assert.deepEqual(result.failures, []);
      assert.equal(result.relationshipCandidates, 1);
      assert.equal(result.relationshipSubjectsCreated, 1);
      const [candidate] = relationships(ports);
      assert.equal(candidate.relationshipTypeCode, "DERIVED_FROM");
      assert.equal(candidate.sourceObject.externalId, "load.sql");
      const { rehydrateNormalizedCandidate } = await import("@/lib/governance/discovery-intake-persistence");
      assert.deepEqual(rehydrateNormalizedCandidate(JSON.parse(JSON.stringify(candidate))), candidate);
      const subject = [...ports.review.subjects.values()].find(item => item.findingId === candidate.findingId)!;
      assert.equal(subject.state, "PROPOSED");
      assert.equal(recoverReconciliationInput({ reviewSubject: subject,
        finding: await ports.intake.getDiscoveryFinding(ORG_A, candidate.findingId), candidate }).status,
      RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE);
      for (const [ref, expectedAsset] of [[candidate.sourceEndpoint, "target"], [candidate.targetEndpoint, "source"]] as const) {
        assert.equal(ref.referenceKind, "CANDIDATE");
        if (ref.referenceKind !== "CANDIDATE") throw new Error("missing exact endpoint");
        const element = [...ports.intake.candidatesByFinding.values()].find(item => item.candidateId === ref.candidateId)!;
        assert.equal(element.candidateKind, "DATA_ELEMENT");
        if (element.candidateKind !== "DATA_ELEMENT") throw new Error("wrong endpoint");
        const parentRef = element.proposedIdentity.parentDataAsset;
        if (parentRef.referenceKind !== "CANDIDATE") throw new Error("wrong parent");
        const parent = [...ports.intake.candidatesByFinding.values()].find(item => item.candidateId === parentRef.candidateId)!;
        assert.equal(parent.candidateKind, "DATA_ASSET");
        if (parent.candidateKind !== "DATA_ASSET") throw new Error("wrong parent kind");
        assert.equal(parent.proposedIdentity.sourceReference, expectedAsset);
        assert.ok(normalizedObjectIdentity(element, parent));
      }
      const support = candidate.assertionIds.map(id => ports.intake.assertions.get(tenantKey(ORG_A, id))!);
      const transformation = support.find(item => item.method.code === "sql-insert-select-column-lineage")!;
      assert.equal(transformation.trustState, "DECLARED");
      assert.equal(transformation.method.version, "1.0.0");
      assert.equal(transformation.snapshot!.sourceObject.externalId, "load.sql");
      const evidence = ports.intake.evidence.get(tenantKey(ORG_A, transformation.evidenceIds[0]))!;
      assert.equal(evidence.hashes.length, 2);
      assert.match(evidence.redactedExcerpt!, /INSERT INTO target/);
      assert.ok(candidate.evidenceIds.includes(evidence.evidenceId));
      for (const id of candidate.evidenceIds) assert.ok(ports.intake.hasDurableEvidence(ORG_A, id));
      assert.ok(support.every(item => item.trustState === "DECLARED"));
      // All canonical, authorization and reconciliation write ports throw.
    });
  });
  test("identical replay creates no duplicate relationship candidate or review", async () => {
    await withFixtureRepository(async root => {
      await prepare(root);
      const ports = makePorts();
      await scan(root, ports);
      const first = relationships(ports);
      const second = await scan(root, ports);
      assert.deepEqual(second.failures, []);
      assert.equal(second.relationshipSubjectsCreated, 0);
      assert.deepEqual(relationships(ports), first);
    });
  });
  test("changed evidence for the same semantic edge preserves history and reports existing immutable-candidate conflict", async () => {
    await withFixtureRepository(async root => {
      await prepare(root);
      const ports = makePorts();
      await scan(root, ports);
      const [first] = relationships(ports);
      const evidenceCount = ports.intake.evidence.size;
      await writeFile(join(root, "load.sql"), "-- moved\n" + sql);
      const changed = await scan(root, ports);
      assert.equal(changed.status, "FAILED");
      assert.ok(changed.failures.some(failure => failure.reason.includes("DISCOVERY_CANDIDATE_CONFLICT")));
      assert.deepEqual(relationships(ports), [first]);
      assert.ok(ports.intake.evidence.size > evidenceCount);
      assert.equal(changed.relationshipSubjectsCreated, 0);
    });
  });
  test("missing durable transformation support cannot produce a relationship review", async () => {
    await withFixtureRepository(async root => {
      await prepare(root);
      const ports = makePorts();
      const record = ports.intake.recordSourceAssertion.bind(ports.intake);
      ports.intake.recordSourceAssertion = async (org, assertion) => {
        if (assertion.method.code === "sql-insert-select-column-lineage") throw new Error("TRANSFORMATION_SUPPORT_UNAVAILABLE");
        return record(org, assertion);
      };
      const result = await scan(root, ports);
      assert.equal(result.status, "PARTIAL");
      assert.equal(result.relationshipSubjectsCreated, 0);
      assert.deepEqual(relationships(ports), []);
    });
  });
  test("foreign tenant endpoint durability cannot satisfy lineage review", async () => {
    await withFixtureRepository(async root => {
      await prepare(root);
      const ports = makePorts();
      await scan(root, ports, ORG_B);
      const get = ports.intake.getNormalizedCandidateForFinding.bind(ports.intake);
      ports.intake.getNormalizedCandidateForFinding = async (org, id) => {
        const candidate = await get(org, id);
        return org === ORG_A && candidate?.candidateKind === "DATA_ELEMENT" ? undefined : candidate;
      };
      const result = await scan(root, ports, ORG_A);
      assert.equal(result.relationshipSubjectsCreated, 0);
      assert.ok(result.failures.some(failure => failure.reason === "L9_ENDPOINT_CANDIDATE_NOT_DURABLE"));
      assert.equal([...ports.review.subjects.values()].filter(item => item.organisationId === ORG_A && item.candidateKind === "RELATIONSHIP").length, 0);
    });
  });
});

describe("Milestone 8: strict SQL discovery through existing intake", () => {
  const dataCandidates = (ports: ReturnType<typeof makePorts>) => [...ports.intake.candidatesByFinding.values()]
    .filter(c => c.candidateKind === "DATA_ASSET" || c.candidateKind === "DATA_ELEMENT");
  const scanSql = (root: string, ports: ReturnType<typeof makePorts>, organisationId = ORG_A) => runGovernanceDiscoveryScan({
    executionContext: { organisationId }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root },
  }, ports);

  test("SQL assets/elements preserve exact parents, durable support, normalized envelopes and PROPOSED review continuity", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE a (id INT, name TEXT); CREATE TABLE b (id INT);");
      const ports = makePorts();
      const result = await scanSql(root, ports);
      assert.equal(result.status, "SUCCEEDED");
      assert.deepEqual(result.failures, []);
      assert.equal(result.relationshipCandidates, 0);
      const candidates = dataCandidates(ports);
      assert.equal(candidates.length, 5);
      const { rehydrateNormalizedCandidate } = await import("@/lib/governance/discovery-intake-persistence");
      for (const candidate of candidates) {
        assert.deepEqual(rehydrateNormalizedCandidate(JSON.parse(JSON.stringify(candidate))), candidate);
        const subject = [...ports.review.subjects.values()].find(s => s.findingId === candidate.findingId)!;
        assert.equal(subject.state, "PROPOSED");
        const finding = await ports.intake.getDiscoveryFinding(ORG_A, candidate.findingId);
        assert.equal(recoverReconciliationInput({ reviewSubject: subject, finding, candidate }).status,
          RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);
        for (const id of candidate.evidenceIds) assert.ok(ports.intake.hasDurableEvidence(ORG_A, id));
        for (const id of candidate.assertionIds) {
          assert.equal(ports.intake.assertions.get(tenantKey(ORG_A, id))!.trustState, "DECLARED");
        }
        if (candidate.candidateKind === "DATA_ELEMENT") {
          const ref = candidate.proposedIdentity.parentDataAsset;
          assert.equal(ref.referenceKind, "CANDIDATE");
          if (ref.referenceKind !== "CANDIDATE") throw new Error("missing exact parent");
          const parent = candidates.find(c => c.candidateId === ref.candidateId);
          assert.equal(parent?.candidateKind, "DATA_ASSET");
          assert.ok(normalizedObjectIdentity(candidate, parent));
        }
      }
      assert.equal(ports.agentVersionTechnicalProfile.proposals.size, 0);
      // All canonical/authorization/reconciliation write ports throw in these fakes.
    });
  });

  test("identical SQL rescans replay without duplicate candidates/reviews", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE t (id INT);");
      const ports = makePorts();
      await scanSql(root, ports);
      const first = dataCandidates(ports);
      const result = await scanSql(root, ports);
      assert.deepEqual(result.failures, []);
      assert.equal(result.reviewSubjectsCreated, 0);
      assert.deepEqual(dataCandidates(ports), first);
    });
  });

  test("exact M7 asset/element mappings survive movement/datatype changes and do not suppress other same-file objects", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE a (id INT); CREATE TABLE b (id INT);");
      const probe = makePorts();
      await scanSql(root, probe);
      const initial = dataCandidates(probe);
      const parent = initial.find(c => c.candidateKind === "DATA_ASSET" && c.proposedIdentity.sourceReference === "a")!;
      const child = initial.find(c => c.candidateKind === "DATA_ELEMENT" &&
        c.proposedIdentity.parentDataAsset.referenceKind === "CANDIDATE" &&
        c.proposedIdentity.parentDataAsset.candidateId === parent.candidateId)!;
      const ports = makePorts();
      for (const candidate of [parent, child]) {
        ports.materialization.seedMapping({ organisationId: ORG_A,
          sourceConnectionId: candidate.sourceObject.connectionId, sourceExternalType: candidate.sourceObject.externalType,
          sourceExternalId: candidate.sourceObject.externalId, canonicalObjectKind: candidate.candidateKind,
          normalizedObjectIdentity: normalizedObjectIdentity(candidate, parent),
        }, { mappingId: `mapping:${candidate.candidateKind}`, canonicalObjectId: `canonical:${candidate.candidateKind}`,
          canonicalObjectKind: candidate.candidateKind });
      }
      await writeFile(join(root, "schema.sql"), "-- moved\nCREATE TABLE b (id INT);\nCREATE TABLE a (id TEXT);");
      const result = await scanSql(root, ports);
      assert.deepEqual(result.failures, []);
      assert.equal(result.alreadyGoverned, 2);
      assert.equal(dataCandidates(ports).length, 4, "mapped parent/child remain durable");
      const subjects = [...ports.review.subjects.values()].filter(s => s.candidateKind === "DATA_ASSET" || s.candidateKind === "DATA_ELEMENT");
      assert.equal(subjects.length, 2, "only table b and its column enter review");
    });
  });

  for (const [label, firstTable, firstColumn, nextTable, nextColumn, mapped] of [
    ["unquoted schema/table/column case", 'CRM.Customer', 'ID', 'crm.customer', 'id', 2],
    ["quoted lowercase equivalence", '"crm"."customer"', '"id"', 'crm.customer', 'id', 2],
    ["quoted table case differs", '"Customer"', 'id', 'customer', 'id', 0],
    ["quoted schema case differs", '"CRM".Customer', 'id', 'crm.customer', 'id', 0],
    ["quoted column case differs", 't', '"ID"', 't', 'id', 1],
  ] as const) {
    test(`M7 physical SQL identity gate: ${label}`, async () => {
      await withFixtureRepository(async root => {
        await writeFile(join(root, "schema.sql"), `CREATE TABLE ${firstTable} (${firstColumn} INT);`);
        const probe = makePorts();
        assert.deepEqual((await scanSql(root, probe)).failures, []);
        const initial = dataCandidates(probe);
        const parent = initial.find(c => c.candidateKind === "DATA_ASSET")!;
        const ports = makePorts();
        for (const candidate of initial) {
          ports.materialization.seedMapping({ organisationId: ORG_A,
            sourceConnectionId: candidate.sourceObject.connectionId, sourceExternalType: candidate.sourceObject.externalType,
            sourceExternalId: candidate.sourceObject.externalId, canonicalObjectKind: candidate.candidateKind,
            normalizedObjectIdentity: normalizedObjectIdentity(candidate, parent),
          }, { mappingId: `mapping:${candidate.candidateKind}`, canonicalObjectId: `canonical:${candidate.candidateKind}`,
            canonicalObjectKind: candidate.candidateKind });
        }
        await writeFile(join(root, "schema.sql"), `CREATE TABLE ${nextTable} (${nextColumn} INT);`);
        const result = await scanSql(root, ports);
        assert.deepEqual(result.failures, []);
        assert.equal(result.alreadyGoverned, mapped);
        assert.equal(dataCandidates(ports).length, 2, "both snapshot candidates stay durable");
        const subjects = [...ports.review.subjects.values()].filter(s => s.candidateKind === "DATA_ASSET" || s.candidateKind === "DATA_ELEMENT");
        assert.equal(subjects.length, 2 - mapped);
        assert.equal(result.relationshipCandidates, 0);
      });
    });
  }

  test("tenant A cannot borrow a durable SQL parent from tenant B", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE t (id INT);");
      const ports = makePorts();
      assert.deepEqual((await scanSql(root, ports, ORG_B)).failures, []);
      const record = ports.intake.recordNormalizedCandidate.bind(ports.intake);
      ports.intake.recordNormalizedCandidate = async (org, candidate, run) => {
        if (org === ORG_A && candidate.candidateKind === "DATA_ASSET") throw new Error("parent persistence unavailable");
        return record(org, candidate, run);
      };
      const result = await scanSql(root, ports);
      assert.equal(result.status, "PARTIAL");
      assert.ok(result.failures.some(f => f.reason === "DATA_ELEMENT_PARENT_NOT_DURABLE"));
      assert.equal([...ports.review.subjects.values()].filter(s => s.organisationId === ORG_A && s.candidateKind === "DATA_ELEMENT").length, 0);
      assert.equal(dataCandidates(ports).length, 2, "only tenant B's data candidates persisted");
    });
  });

  test("same-source data rows remain tenant-scoped and foreign mappings do not suppress review", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE t (id INT);");
      const ports = makePorts();
      await scanSql(root, ports, ORG_A);
      const parent = dataCandidates(ports).find(c => c.candidateKind === "DATA_ASSET")!;
      ports.materialization.seedMapping({ organisationId: ORG_A, sourceConnectionId: parent.sourceObject.connectionId,
        sourceExternalType: parent.sourceObject.externalType, sourceExternalId: parent.sourceObject.externalId,
        canonicalObjectKind: "DATA_ASSET", normalizedObjectIdentity: normalizedObjectIdentity(parent),
      }, { mappingId: "mapping:a", canonicalObjectId: "canonical:a", canonicalObjectKind: "DATA_ASSET" });
      const result = await scanSql(root, ports, ORG_B);
      assert.deepEqual(result.failures, []);
      assert.equal(result.alreadyGoverned, 0);
      assert.equal(dataCandidates(ports).length, 4);
      assert.equal([...ports.review.subjects.values()].filter(s => s.organisationId === ORG_B &&
        (s.candidateKind === "DATA_ASSET" || s.candidateKind === "DATA_ELEMENT")).length, 2);
    });
  });

  test("a durable parent with substituted support cannot back element review", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "CREATE TABLE t (id INT);");
      const ports = makePorts();
      const read = ports.intake.getNormalizedCandidateForFinding.bind(ports.intake);
      ports.intake.getNormalizedCandidateForFinding = async (org, findingId) => {
        const candidate = await read(org, findingId);
        return candidate?.candidateKind === "DATA_ASSET" ? { ...candidate, evidenceIds: [] } : candidate;
      };
      const result = await scanSql(root, ports);
      assert.ok(result.failures.some(f => f.reason === "DATA_ELEMENT_PARENT_NOT_DURABLE"));
      assert.equal(dataCandidates(ports).filter(c => c.candidateKind === "DATA_ELEMENT").length, 0);
      assert.equal([...ports.review.subjects.values()].filter(s => s.candidateKind === "DATA_ELEMENT").length, 0);
    });
  });

  test("unsupported SQL creates no data review, lineage or canonical operation", async () => {
    await withFixtureRepository(async root => {
      await writeFile(join(root, "schema.sql"), "-- CREATE TABLE fake (id INT);\nCREATE TABLE t AS SELECT id FROM source; SELECT 'CREATE TABLE hidden (id INT);';");
      const ports = makePorts();
      const result = await scanSql(root, ports);
      assert.deepEqual(result.failures, []);
      assert.deepEqual(dataCandidates(ports), []);
      assert.equal(result.relationshipCandidates, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Legacy fixture: bare Agent marker plus module-level Model and Tool list.
// L9 fails closed: no identifiable AgentVersion or direct declaration binding.
// Three object findings remain — matching the exact literal content
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
  test("REAL DISCOVERY: legacy copresence reaches object review only, never behavior relationships", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.artifactsScanned, 1);
      assert.equal(result.objectCandidates, 3, "expected AGENT + MODEL + TOOL");
      assert.equal(result.relationshipCandidates, 0, "unidentifiable Agent and copresence cannot bind behavior");
      assert.equal(result.reviewSubjectsCreated, 3);
      assert.equal(result.relationshipSubjectsCreated, 0);
      assert.equal(result.proposalsCreated, 3, "every UNREVIEWED object finding is eligible under PASS_THROUGH_V1");
      assert.equal(result.alreadyGoverned, 0);
      assert.deepEqual(result.failures, []);

      assert.equal(ports.intake.evidence.size, 3, "one Evidence per object candidate");
      assert.equal(ports.intake.assertions.size, 3, "one SourceAssertion per object candidate");
      assert.equal(ports.review.subjects.size, 3, "3 object review subjects");
      for (const subject of ports.review.subjects.values()) {
        assert.equal(subject.state, "PROPOSED");
        assert.equal(subject.organisationId, ORG_A);
      }

      // Durable acquisition run reflects the real scan's executive counts.
      const runRow = [...ports.intake.runs.values()][0];
      assert.equal(runRow.run.status, "SUCCEEDED");
      assert.equal(runRow.counts?.objectCandidates, 3);
      assert.equal(runRow.counts?.relationshipCandidates, 0);
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

  test("ALREADY GOVERNED: source mapping suppresses duplicate objects but cannot supply missing version binding evidence", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();

      // Only the exact MODEL mapping suppresses its review. The same-file
      // AGENT/TOOL remain independent, and the MODEL candidate stays durable.
      const probe = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        probe,
      );
      const model = [...probe.intake.candidatesByFinding.values()].find(c => c.candidateKind === "MODEL")!;
      if (model.candidateKind !== "MODEL") throw new Error("missing model");
      ports.materialization.seedMapping(
        { organisationId: ORG_A, sourceConnectionId: model.sourceObject.connectionId,
          sourceExternalType: model.sourceObject.externalType, sourceExternalId: model.sourceObject.externalId,
          canonicalObjectKind: "MODEL", normalizedObjectIdentity: normalizedObjectIdentity(model) },
        { mappingId: "mapping:model", canonicalObjectId: "canonical:model", canonicalObjectKind: "MODEL" },
      );

      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.alreadyGoverned, 1, "only the exact typed MODEL mapping is already governed");
      assert.equal(result.reviewSubjectsCreated, 2, "same-file AGENT and TOOL still require review");
      assert.deepEqual([...ports.intake.candidatesByFinding.values()].find(c => c.candidateKind === "MODEL"), model);
      assert.equal(
        result.relationshipSubjectsCreated,
        0,
        "a source mapping cannot manufacture behavior binding evidence",
      );
      // Evidence/assertions for every already-governed object are still preserved for future drift analysis.
      assert.equal(ports.intake.evidence.size, 3);
      assert.equal(ports.intake.assertions.size, 3);
      // Only the unmapped objects enter review.
      assert.equal(
        [...ports.review.subjects.values()].filter((s) => s.candidateKind !== "RELATIONSHIP").length,
        2,
      );
      assert.equal(
        [...ports.review.subjects.values()].filter((s) => s.candidateKind === "RELATIONSHIP").length,
        0,
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
      // Legacy fixture has no behavior bindings; MODEL/TOOL stay independent.
      assert.equal(result.failures.length, 1);
      assert.match(result.failures[0].reason, /simulated malformed evidence/);
      assert.equal(result.failures[0].candidateKind, "AGENT");
      assert.equal(result.reviewSubjectsCreated, 2, "MODEL and TOOL are wholly independent of AGENT's failure and still succeed");
      assert.equal(result.relationshipSubjectsCreated, 0, "no binding evidence");
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

    await ports.intake.recordDiscoveryFinding(ORG_A, findingA, "acquisition-run:x" as never);
    const subjectA = createReviewSubject({ reviewSubjectId: sharedReviewSubjectId, organisationId: ORG_A, finding: findingA });
    const firstResult = await ports.review.createReviewSubject(subjectA);
    assert.equal(firstResult.replay, false);

    await ports.intake.recordDiscoveryFinding(ORG_A, findingB, "acquisition-run:x" as never);
    const subjectB = createReviewSubject({ reviewSubjectId: sharedReviewSubjectId, organisationId: ORG_A, finding: findingB });
    await assert.rejects(
      () => ports.review.createReviewSubject(subjectB),
      /REVIEW_SUBJECT_ID_CONFLICT/,
      "reusing a reviewSubjectId with different underlying finding content must fail closed, never silently replay",
    );
  });
});

describe("Discovery Governance Input Persistence V1: durable Finding/Candidate continuity into reconciliation input recovery", () => {
  test("legacy copresence persists object findings and safely normalizable MODEL/TOOL only", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(ports.intake.findings.size, 3);
      // The bare AGENT marker still has no safe declaration identity.
      assert.equal(ports.intake.candidatesByFinding.size, 2);

      for (const subject of ports.review.subjects.values()) {
        const finding = await ports.intake.getDiscoveryFinding(ORG_A, subject.findingId);
        assert.ok(finding, `expected a durable finding for review subject ${subject.reviewSubjectId}`);
        assert.equal(finding!.findingId, subject.findingId);

        const candidate = await ports.intake.getNormalizedCandidateForFinding(ORG_A, subject.findingId);
        const recovered = recoverReconciliationInput({ reviewSubject: subject, finding, candidate });
        if (subject.candidateKind === "RELATIONSHIP") {
          assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE);
        } else if (subject.candidateKind === "MODEL" || subject.candidateKind === "TOOL") {
          assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);
        } else {
          assert.equal(subject.candidateKind, "AGENT");
          assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.FINDING_ONLY, "AGENT identity is not safely derivable from current evidence — this is real, not unavailable");
        }
      }
    });
  });

  test("IDEMPOTENT RE-SCAN: an identical rerun does not duplicate durable Finding/Candidate rows", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const findingCountAfterFirst = ports.intake.findings.size;
      const candidateCountAfterFirst = ports.intake.candidatesByFinding.size;
      const findingCallsAfterFirst = ports.intake.findingCallCount;

      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(ports.intake.findings.size, findingCountAfterFirst, "rescan must not create any new durable finding row");
      assert.equal(ports.intake.candidatesByFinding.size, candidateCountAfterFirst, "rescan must not create any new durable candidate row");
      // recordDiscoveryFinding is still called on every rescan (it's cheap and
      // idempotent — see ensureReviewSubjectAndPropose's own doc comment) but
      // must never grow the durable row count.
      assert.ok(ports.intake.findingCallCount > findingCallsAfterFirst);
    });
  });

  test("TENANT ISOLATION: another organisation cannot read this tenant's durable Finding, even with the identical findingId", async () => {
    await withFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [someFindingId] = [...ports.intake.findings.keys()].map((key) => key.split("::")[1]!);

      const crossTenantRead = await ports.intake.getDiscoveryFinding(ORG_B, someFindingId as never);
      assert.equal(crossTenantRead, undefined, "a findingId guessed/reused under a different organisationId must never resolve");
    });
  });

  test("LEGACY: a pre-milestone ReviewSubject with no durable Finding recovers as INPUT_UNAVAILABLE, never fabricated", async () => {
    const finding = {
      findingId: "discovery-finding:legacy:1" as never,
      findingNature: "CANDIDATE" as const,
      candidateKind: "AGENT" as const,
      sourceObject: { connectionId: "source-connection:legacy" as never, externalType: "file", externalId: "legacy.py" as never },
      assertionIds: [],
      evidenceIds: [],
      confidence: 0.9,
      reviewStatus: "UNREVIEWED" as const,
      requiresReview: true as const,
      createsCanonicalObject: false as const,
      detectedAt: "2026-01-01T00:00:00.000Z" as never,
    };
    // A subject that predates Discovery Governance Input Persistence V1: it
    // exists (governance-review's createReviewSubject never required a
    // durable Finding to exist), but this milestone's intake integration was
    // never run for it, so no gov_repo.discovery_findings row exists.
    const legacySubject = createReviewSubject({
      reviewSubjectId: asReviewSubjectId("review-subject:legacy:1"),
      organisationId: ORG_A,
      finding,
    });

    const recovered = recoverReconciliationInput({ reviewSubject: legacySubject, finding: undefined, candidate: undefined });
    assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.INPUT_UNAVAILABLE);
  });
});

// ---------------------------------------------------------------------------
// Agent Identity & Version Discovery V1: an identifiable Agent (a real
// enclosing class/const declaration around `kind = "agent"`, see
// packages/scanner/src/discovery/strategies/agent-kind-declaration.ts) now
// normalizes, and a correlated Model/Tool alongside it produces an
// evidence-backed AGENT_VERSION candidate — proving the same governance
// continuity (Discovery -> Finding -> NormalizedCandidate -> Governance
// Intake -> reconciliation readiness) MODEL/TOOL already had, without any
// change to governance-review or the persistence adapter.
// ---------------------------------------------------------------------------

async function withIdentifiableAgentFixtureRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "discovery-intake-agent-version-"));
  try {
    await writeFile(
      join(root, "agent.py"),
      [
        "class CustomerSupportAgent:",
        '    kind = "agent"',
        '    modelReference = "gpt-x"',
        "    tools = [alpha]",
        "",
      ].join("\n"),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Agent Identity & Version Discovery V1: AGENT and AGENT_VERSION governance continuity", () => {
  test("L9: persists exact version/target candidates before proposed relationship review, isolated by tenant", async () => {
    await withIdentifiableAgentFixtureRepository(async (root) => {
      const ports = makePorts();
      const scanFor = (organisationId: OrganisationId) => runGovernanceDiscoveryScan(
        { executionContext: { organisationId }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } }, ports);
      const first = await scanFor(ORG_A);
      assert.equal(first.relationshipCandidates, 2);
      assert.equal(first.relationshipSubjectsCreated, 2);
      assert.deepEqual(first.failures, []);
      const aSubjects = [...ports.review.subjects.values()].filter((s) => s.candidateKind === "RELATIONSHIP");
      for (const subject of aSubjects) {
        assert.equal(subject.state, "PROPOSED");
        const candidate = await ports.intake.getNormalizedCandidateForFinding(ORG_A, subject.findingId);
        assert.ok(candidate?.candidateKind === "RELATIONSHIP");
        assert.equal(candidate.sourceEndpoint.candidateKind, "AGENT_VERSION");
        for (const endpoint of [candidate.sourceEndpoint, candidate.targetEndpoint]) {
          assert.equal(endpoint.referenceKind, "CANDIDATE");
          if (endpoint.referenceKind !== "CANDIDATE") throw new Error("wrong endpoint");
          const durable = [...ports.intake.candidatesByFinding.values()].find((item) => item.candidateId === endpoint.candidateId);
          assert.ok(durable, "endpoint must be durable");
          assert.equal(durable.candidateKind, endpoint.candidateKind);
        }
        assert.equal(await ports.intake.getNormalizedCandidateForFinding(ORG_B, subject.findingId), undefined);
      }
      const replay = await scanFor(ORG_A);
      assert.equal(replay.relationshipSubjectsCreated, 0);
      assert.deepEqual(replay.failures, []);
      const other = await scanFor(ORG_B);
      assert.deepEqual(other.failures, []);
      assert.equal(other.relationshipSubjectsCreated, 2);
      const bIds = [...ports.review.subjects.values()].filter((s) => s.organisationId === ORG_B && s.candidateKind === "RELATIONSHIP").map((s) => s.findingId);
      assert.ok(aSubjects.every((s) => !bIds.includes(s.findingId)));
    });
  });

  for (const missingKind of ["AGENT_VERSION", "MODEL", "TOOL"] as const) {
    test(`L9: missing durable ${missingKind} endpoint fails closed`, async () => {
      await withIdentifiableAgentFixtureRepository(async (root) => {
        const ports = makePorts();
        const original = ports.intake.recordNormalizedCandidate.bind(ports.intake);
        ports.intake.recordNormalizedCandidate = async (organisationId, candidate, runId) => {
          if (candidate.candidateKind === missingKind) throw new Error("simulated endpoint failure");
          return original(organisationId, candidate, runId);
        };
        const result = await runGovernanceDiscoveryScan(
          { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } }, ports);
        assert.equal(result.status, "PARTIAL");
        assert.equal(result.relationshipSubjectsCreated, missingKind === "AGENT_VERSION" ? 0 : 1);
        assert.ok(result.failures.some((item) => item.reason === "L9_ENDPOINT_CANDIDATE_NOT_DURABLE"));
      });
    });
  }

  for (const targetKind of ["MODEL", "TOOL"] as const) {
    test(`L9: an exact ${targetKind} candidate persisted only for another tenant cannot back this tenant's relationship`, async () => {
      await withIdentifiableAgentFixtureRepository(async (root) => {
        const ports = makePorts();
        const scanFor = (organisationId: OrganisationId) => runGovernanceDiscoveryScan(
          { executionContext: { organisationId }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } }, ports);
        assert.equal((await scanFor(ORG_B)).status, "SUCCEEDED");
        const foreignSubject = [...ports.review.subjects.values()].find((s) => s.organisationId === ORG_B && s.candidateKind === targetKind)!;
        const foreignTarget = await ports.intake.getNormalizedCandidateForFinding(ORG_B, foreignSubject.findingId);
        assert.ok(foreignTarget);
        const original = ports.intake.recordNormalizedCandidate.bind(ports.intake);
        ports.intake.recordNormalizedCandidate = async (organisationId, candidate, runId) => {
          if (organisationId === ORG_A && candidate.candidateKind === targetKind) {
            assert.equal(candidate.candidateId, foreignTarget.candidateId, 'exact ID exists in B, not A');
            throw new Error('target unavailable in tenant A');
          }
          return original(organisationId, candidate, runId);
        };
        const result = await scanFor(ORG_A);
        assert.equal(result.status, "PARTIAL");
        assert.equal(result.relationshipSubjectsCreated, 1, 'the independent same-tenant binding still succeeds');
        assert.ok(result.failures.some((item) => item.reason === "L9_ENDPOINT_CANDIDATE_NOT_DURABLE"));
        assert.equal(await ports.intake.getNormalizedCandidateForFinding(ORG_A, foreignSubject.findingId), undefined);
        const subjects = [...ports.review.subjects.values()].filter((s) => s.organisationId === ORG_A && s.candidateKind === "RELATIONSHIP");
        for (const subject of subjects) {
          const candidate = await ports.intake.getNormalizedCandidateForFinding(ORG_A, subject.findingId);
          assert.ok(candidate?.candidateKind === "RELATIONSHIP");
          assert.notEqual(candidate.targetEndpoint.candidateKind, targetKind);
        }
      });
    });
  }

  test("a real scan normalizes AGENT and produces a correlated AGENT_VERSION candidate, both reconciliation-ready once CERTIFIED", async () => {
    await withIdentifiableAgentFixtureRepository(async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.status, "SUCCEEDED");
      assert.deepEqual(result.failures, []);
      // AGENT + MODEL + TOOL (per-artifact) + AGENT_VERSION (correlated) = 4.
      assert.equal(result.objectCandidates, 4, "expected AGENT + MODEL + TOOL + AGENT_VERSION");

      const agentSubject = [...ports.review.subjects.values()].find((s) => s.candidateKind === "AGENT");
      const agentVersionSubject = [...ports.review.subjects.values()].find((s) => s.candidateKind === "AGENT_VERSION");
      assert.ok(agentSubject, "expected a durable AGENT review subject");
      assert.ok(agentVersionSubject, "expected a durable AGENT_VERSION review subject");
      assert.equal(agentSubject!.state, "PROPOSED");
      assert.equal(agentVersionSubject!.state, "PROPOSED");

      for (const subject of [agentSubject!, agentVersionSubject!]) {
        const finding = await ports.intake.getDiscoveryFinding(ORG_A, subject.findingId);
        const candidate = await ports.intake.getNormalizedCandidateForFinding(ORG_A, subject.findingId);
        assert.ok(finding);
        assert.ok(candidate, `expected a durable NormalizedCandidate for ${subject.candidateKind}`);

        const recovered = recoverReconciliationInput({ reviewSubject: subject, finding, candidate });
        assert.equal(recovered.status, RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE);

        // CERTIFIED is a human-only transition, out of scope for this
        // machine-intake service; readiness is proven at the pure-function
        // boundary exactly as reconciliation-readiness.test.ts does.
        const readiness = deriveReconciliationReadiness({
          reviewState: REVIEW_STATE.CERTIFIED,
          recoveryStatus: recovered.status,
          hasExistingReconciliationDecision: false,
          isMaterializedApplied: false,
        });
        assert.equal(readiness.ready, true, `expected ${subject.candidateKind} to be reconciliation-ready`);
      }

      if (agentVersionSubject) {
        const candidate = await ports.intake.getNormalizedCandidateForFinding(ORG_A, agentVersionSubject.findingId);
        assert.ok(candidate && candidate.candidateKind === "AGENT_VERSION");
        if (candidate && candidate.candidateKind === "AGENT_VERSION") {
          assert.equal(candidate.proposedIdentity.agent.candidateKind, "AGENT");
          assert.equal(candidate.proposedIdentity.agent.referenceKind, "SOURCE_OBJECT");
          assert.equal(candidate.proposedIdentity.versionCode, undefined, "no fabricated version is ever produced");
        }
      }
    });
  });

  test("IDEMPOTENT RE-SCAN: rescanning the identical Agent/Model/Tool fixture creates no duplicate AGENT_VERSION subject", async () => {
    await withIdentifiableAgentFixtureRepository(async (root) => {
      const ports = makePorts();
      const first = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const second = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(second.reviewSubjectsCreated, 0, "rescan must not report any NEW review subjects");
      const agentVersionSubjects = [...ports.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");
      assert.equal(agentVersionSubjects.length, 1, "exactly one durable AGENT_VERSION subject across both scans");
      assert.ok(first.objectCandidates > 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Agent Technical Profile — L4 Round 1 (corrected): the five newly-supported
// canonical object kinds (PROMPT/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL) reach
// the exact same DETECTED -> PROPOSED governance-intake boundary MODEL/TOOL
// already use — no new bypass, no new authority ceiling. Every fixture below
// uses the REAL, Golden-Repository-precedented convention for each kind
// (read, never modified — see each detector's own doc comment), not an
// invented declaration syntax. AgentVersion technical-profile signals
// (Framework/Orchestration) are the deliberate structural exception:
// they are never a DiscoveryCandidate of any CanonicalObjectKind at all (see
// technical-profile-signal.ts) — their Evidence/SourceAssertion become
// durable, but they never receive their own ReviewSubject; only the real,
// correlation-produced AGENT_VERSION ReviewSubject cites their assertion/
// evidence ids.
// ---------------------------------------------------------------------------

async function withL4RoundOneFixtureRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "discovery-intake-l4-round1-"));
  try {
    await writeFile(
      join(root, "agent.py"),
      [
        "class CustomerSupportAgent:",
        '    kind = "agent"',
        '    modelReference = "gpt-x"',
        "    tools = [alpha]",
        "",
        'SUPPORT_PROMPT = "Assist with account questions."',
        "BILLING_API = {",
        '    "id": "billing-api",',
        "}",
        "from langgraph import StateGraph",
        "",
      ].join("\n"),
    );
    await writeFile(join(root, "mcp.json"), JSON.stringify({ serverIdentity: "filesystem-mcp" }));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "knowledge-base.yaml"), "knowledge_base:\n  identity: product-docs-index\n");
    await mkdir(join(root, ".claude", "skills", "summarize-ticket"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "summarize-ticket", "SKILL.md"), "# Summarize Ticket\n");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Agent Technical Profile L4 Round 1: new canonical object kinds + AgentVersion technical-profile signals", () => {
  test("PROMPT/MCP_SERVER/API/KNOWLEDGE_BASE/SKILL each reach a PROPOSED review subject, same governance ceiling as MODEL/TOOL", async () => {
    await withL4RoundOneFixtureRepository(async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(result.status, "SUCCEEDED");
      assert.deepEqual(result.failures, []);

      for (const kind of ["PROMPT", "MCP_SERVER", "API", "KNOWLEDGE_BASE", "SKILL"] as const) {
        const subject = [...ports.review.subjects.values()].find((s) => s.candidateKind === kind);
        assert.ok(subject, `expected a durable ${kind} review subject`);
        assert.equal(subject!.state, "PROPOSED");
        assert.equal(subject!.organisationId, ORG_A);
      }
    });
  });

  test("Framework technical-profile signal is durably evidenced (INFERRED trust) but never creates its own ReviewSubject", async () => {
    await withL4RoundOneFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      // No ReviewSubject anywhere is backed by a technical-profile signal —
      // exactly one AGENT_VERSION subject exists (the real, correlation-
      // produced one), and technical-profile signals are structurally never
      // a DiscoveryCandidate of any CanonicalObjectKind (see
      // technical-profile-signal.ts), so they can never masquerade as one.
      const agentVersionSubjects = [...ports.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");
      assert.equal(agentVersionSubjects.length, 1, "technical-profile signals never create their own AGENT_VERSION subject");

      // Their Evidence/SourceAssertion are still durable: the correlated
      // AGENT_VERSION subject's own finding cites more assertion/evidence
      // ids than just its parent AGENT + Model/Tool would alone (the
      // same-file Framework signal and Prompt/API are folded in too;
      // MCP_SERVER/KNOWLEDGE_BASE/SKILL live in separate files and correctly
      // do NOT fold into this AgentVersion).
      const [agentVersionSubject] = agentVersionSubjects;
      const finding = await ports.intake.getDiscoveryFinding(ORG_A, agentVersionSubject.findingId);
      assert.ok(finding);
      assert.ok(
        finding!.assertionIds.length >= 5,
        "AGENT + MODEL + TOOL + PROMPT + API + FRAMEWORK evidence all contribute",
      );
    });
  });

  test("changing the correlated API id changes the AGENT_VERSION technical revision (new AgentVersion)", async () => {
    // Same temp root (same SourceConnection) for both scans — a second,
    // independent mkdtemp root would legitimately differ in sourceScope
    // alone, which would prove nothing about the API-id change specifically.
    await withL4RoundOneFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [firstSubject] = [...ports.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");

      await writeFile(
        join(root, "agent.py"),
        [
          "class CustomerSupportAgent:",
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          "    tools = [alpha]",
          "",
          'SUPPORT_PROMPT = "Assist with account questions."',
          "BILLING_API = {",
          '    "id": "billing-api-v2",', // identity changed — must change identity
          "}",
          "from langgraph import StateGraph",
          "",
        ].join("\n"),
      );
      const secondPorts = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        secondPorts,
      );
      const [secondSubject] = [...secondPorts.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");
      assert.notEqual(secondSubject.findingId, firstSubject.findingId, "a changed API id produces a different AGENT_VERSION identity");
    });
  });

  test("DEFECT #2 CORRECTION: changing only the Prompt's own string content (same declaration key) DOES change the AGENT_VERSION technical revision", async () => {
    await withL4RoundOneFixtureRepository(async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [firstSubject] = [...ports.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");

      await writeFile(
        join(root, "agent.py"),
        [
          "class CustomerSupportAgent:",
          '    kind = "agent"',
          '    modelReference = "gpt-x"',
          "    tools = [alpha]",
          "",
          'SUPPORT_PROMPT = "Assist with account questions, revised wording."', // content changed, same constant name
          "BILLING_API = {",
          '    "id": "billing-api",',
          "}",
          "from langgraph import StateGraph",
          "",
        ].join("\n"),
      );
      const secondPorts = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        secondPorts,
      );
      const [secondSubject] = [...secondPorts.review.subjects.values()].filter((s) => s.candidateKind === "AGENT_VERSION");
      assert.notEqual(
        secondSubject.findingId,
        firstSubject.findingId,
        "changing the Prompt's own effective content must produce a different AGENT_VERSION technical revision, even with the same declaration key",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Technical Profile Persistence V1 (ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1).
// Pre-canonical AgentVersionTechnicalProfile proposal recording — the FIRST
// instance of the global typed, per-canonical-object-kind TechnicalProfile
// persistence pattern, scoped to AgentVersion only in this milestone (see
// the ADR). Canonical materialization itself lives entirely in
// gov_repo.materialize_agent_version_technical_profile (SQL, gated on a
// governed AGENT_VERSION already existing) and is exercised only via the
// fake port's own recording behavior here — this suite proves the
// service-layer (Discovery Intake) side: what gets proposed, with what
// support, and that Discovery Intake itself never reaches materialization.
// ---------------------------------------------------------------------------

async function withFrameworkFixtureRepository(
  frameworkImportLine: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-version-technical-profile-proposal-"));
  try {
    await writeFile(
      join(root, "agent.py"),
      ["class CustomerSupportAgent:", '    kind = "agent"', '    modelReference = "gpt-x"', frameworkImportLine, ""].join("\n"),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Technical Profile Persistence V1: pre-canonical AgentVersion proposal", () => {
  test("1: persists typed semantic values — behaviorFingerprint always present, runtimeFrameworkReference present only when unambiguous; unsupported dimensions stay absent (TEST #21)", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );

      assert.equal(ports.agentVersionTechnicalProfile.proposals.size, 1);
      const [proposal] = ports.agentVersionTechnicalProfile.proposals.values();
      assert.equal(proposal.organisationId, ORG_A);
      assert.equal(proposal.behaviorFingerprintAlgorithm, "sha256");
      assert.ok(proposal.behaviorFingerprintValue.length > 0);
      assert.equal(proposal.runtimeFrameworkReference, "LangGraph");
      assert.equal(proposal.buildReference, undefined);
      assert.equal(proposal.entrypointReference, undefined);
      assert.equal(proposal.configurationReference, undefined);
    });
  });

  test("2 / 22: preserves independent per-field assertion/evidence support — behaviorFingerprint gets the whole union, runtimeFrameworkReference gets only its own signal's ids", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [proposal] = ports.agentVersionTechnicalProfile.proposals.values();

      assert.ok(proposal.support.behaviorFingerprint.assertionIds.length >= 2, "AGENT + MODEL + Framework all contribute to behaviorFingerprint");
      assert.equal(proposal.support.runtimeFrameworkReference.assertionIds.length, 1);
      assert.deepEqual(proposal.support.buildReference, { assertionIds: [], evidenceIds: [] });
      assert.deepEqual(proposal.support.entrypointReference, { assertionIds: [], evidenceIds: [] });
      assert.deepEqual(proposal.support.configurationReference, { assertionIds: [], evidenceIds: [] });
      assert.notDeepEqual(
        [...proposal.support.behaviorFingerprint.assertionIds].sort(),
        [...proposal.support.runtimeFrameworkReference.assertionIds].sort(),
      );
    });
  });

  test("3: identical rescan replays the same proposal (idempotent), no duplicate proposal recorded", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      assert.equal(ports.agentVersionTechnicalProfile.proposals.size, 1, "an identical rescan must not append a second proposal");
    });
  });

  test("4: a materially different technical revision never collides — produces a different proposalId rather than overwriting the prior one", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const firstProposalId = [...ports.agentVersionTechnicalProfile.proposals.values()][0].proposalId;

      await writeFile(
        join(root, "agent.py"),
        ["class CustomerSupportAgent:", '    kind = "agent"', '    modelReference = "gpt-x"', "from crewai import Crew", ""].join("\n"),
      );
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      assert.equal(ports.agentVersionTechnicalProfile.proposals.size, 2, "both the original and the changed proposal remain durable, neither overwritten");
      const secondProposal = [...ports.agentVersionTechnicalProfile.proposals.values()].find((p) => p.proposalId !== firstProposalId);
      assert.ok(secondProposal, "the changed Framework must produce a genuinely different proposalId");
    });
  });

  test("5 / 26: recording a proposal creates no canonical object and never invokes canonical profile materialization", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      const result = await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      assert.deepEqual(result.failures, [], "FakeMaterializationPersistence throws on any object/relationship materialization call — a clean run proves it never happened");
      assert.equal(ports.agentVersionTechnicalProfile.materializations.size, 0, "Discovery Intake must never call materializeAgentVersionTechnicalProfile");
    });
  });

  test("6 / 28: recording a proposal never advances the AGENT_VERSION ReviewSubject past PROPOSED (no automatic certification, scanner ceiling holds)", async () => {
    await withFrameworkFixtureRepository("from langgraph import StateGraph", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const agentVersionSubject = [...ports.review.subjects.values()].find((s) => s.candidateKind === "AGENT_VERSION");
      assert.ok(agentVersionSubject);
      assert.equal(agentVersionSubject!.state, "PROPOSED");
    });
  });

  test("19: Orchestration evidence never overloads configurationReference (no dedicated field exists; it must stay absent)", async () => {
    await withFrameworkFixtureRepository("from crewai import Crew", async (root) => {
      const ports = makePorts();
      await runGovernanceDiscoveryScan(
        { executionContext: { organisationId: ORG_A }, sourceConfiguration: { kind: "LOCAL_REPOSITORY", rootPath: root } },
        ports,
      );
      const [proposal] = ports.agentVersionTechnicalProfile.proposals.values();
      // CrewAI is both a Framework AND (via the same import) an
      // Orchestration signal — runtimeFrameworkReference legitimately
      // reflects the Framework half, but configurationReference must never
      // absorb the Orchestration half.
      assert.equal(proposal.runtimeFrameworkReference, "CrewAI");
      assert.equal(proposal.configurationReference, undefined);
    });
  });
});
