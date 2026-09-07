import "server-only";
import { createHash, randomUUID } from "node:crypto";

import {
  DiscoveryPipeline,
  LocalRepositoryAdapter,
  RelationshipCorrelationStrategy,
  AgentKindDeclarationSpecification,
  ModelReferenceDeclarationSpecification,
  ToolListDeclarationSpecification,
  createSourceConnection,
  createSourceSystem,
  type DiscoveryCandidate,
  type DiscoveryRunResult,
  type RelationshipCorrelationResult,
} from "@council/scanner";
import {
  IneligibleFindingError,
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  asReviewSubjectId,
  createReviewSubject,
  type AcquisitionRunCounts,
  type DiscoveryIntakePersistencePort,
  type GovernanceReviewPersistencePort,
  type MaterializationPersistencePort,
  type ReviewSubjectId,
  type TransitionResult,
} from "@council/governance-review";
import {
  asAcquisitionRunId,
  asIsoTimestamp,
  type AcquisitionRun,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type NormalizedCandidate,
  type OrganisationId,
} from "@council/canonical-contracts";

import { governanceReviewPersistence } from "./persistence";
import { materializationPersistence } from "./materialization";
import { discoveryIntakePersistence } from "./discovery-intake-persistence";

/**
 * Discovery Intake V1 — the trusted server-side application service that
 * connects the existing, closed Discovery Engine (packages/scanner) to the
 * existing, closed Governance Review persistence boundary
 * (GovernanceReviewPersistencePort / MaterializationPersistencePort).
 *
 * This is the ONLY composition boundary added by this milestone. It:
 *   - never gives packages/scanner a dependency on governance-review or
 *     Supabase (it only imports scanner's public discovery exports here, in
 *     apps/dashboard, exactly where governance-review + Supabase already
 *     meet for the review/materialization adapters);
 *   - never lets a machine-authored ReviewSubject reach CONFIRMED or
 *     CERTIFIED (the only transition ever invoked here is the existing
 *     PassThroughSemanticProposalStrategy's DETECTED -> PROPOSED);
 *   - never calls authorization, reconciliation, or materialization RPCs to
 *     create governed truth — findActiveObjectSourceMapping is a read-only
 *     lookup, never a write;
 *   - never persists a ReviewSubject before its cited Evidence/SourceAssertion
 *     are themselves already durable (see discovery-intake-persistence.ts and
 *     the DB-level hard gate added by the accompanying migration).
 */

// ---------------------------------------------------------------------------
// Trusted execution context. organisationId must already be a branded
// OrganisationId constructed by trusted server code from an authoritative
// session/auth source — this module never accepts a raw string, an HTTP
// header, or scanner-observed content as tenant identity.
// ---------------------------------------------------------------------------

export interface GovernanceExecutionContext {
  readonly organisationId: OrganisationId;
  readonly correlationId?: string;
}

export interface LocalRepositorySourceConfiguration {
  readonly kind: "LOCAL_REPOSITORY";
  readonly rootPath: string;
}

/** V1 supports exactly one adapter kind. Do not expand connector scope here. */
export type DiscoverySourceConfiguration = LocalRepositorySourceConfiguration;

export interface RunGovernanceDiscoveryScanInput {
  readonly executionContext: GovernanceExecutionContext;
  readonly sourceConfiguration: DiscoverySourceConfiguration;
}

export type GovernanceDiscoveryScanStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface DiscoveryIntakeItemFailure {
  readonly findingId?: string;
  /** Absent for a source-level failure (e.g. the source could not be enumerated at all), never a fabricated candidate kind. */
  readonly candidateKind?: DiscoveryCandidateKind;
  readonly reason: string;
}

export interface GovernanceDiscoveryScanResult {
  readonly scanRunId: string;
  readonly sourceConnectionId: string;
  readonly sourceType: string;
  readonly status: GovernanceDiscoveryScanStatus;
  readonly artifactsScanned: number;
  readonly findingsDetected: number;
  readonly objectCandidates: number;
  readonly relationshipCandidates: number;
  readonly reviewSubjectsCreated: number;
  readonly relationshipSubjectsCreated: number;
  readonly proposalsCreated: number;
  readonly alreadyGoverned: number;
  readonly failures: readonly DiscoveryIntakeItemFailure[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface DiscoveryIntakePorts {
  readonly review: GovernanceReviewPersistencePort;
  readonly materialization: MaterializationPersistencePort;
  readonly intake: DiscoveryIntakePersistencePort;
}

const defaultPorts: DiscoveryIntakePorts = {
  review: governanceReviewPersistence,
  materialization: materializationPersistence,
  intake: discoveryIntakePersistence,
};

interface ScanTally {
  reviewSubjectsCreated: number;
  relationshipSubjectsCreated: number;
  proposalsCreated: number;
  alreadyGoverned: number;
  failures: DiscoveryIntakeItemFailure[];
}

function zeroCounts(): AcquisitionRunCounts {
  return {
    artifactsScanned: 0,
    findingsDetected: 0,
    objectCandidates: 0,
    relationshipCandidates: 0,
    reviewSubjectsCreated: 0,
    proposalsCreated: 0,
    alreadyGoverned: 0,
    itemFailures: 0,
  };
}

// ---------------------------------------------------------------------------
// Deterministic idempotency identities. Both are derived only from already
// content-addressed, deterministic upstream identity (organisationId +
// DiscoveryFinding.findingId, itself a stable hash of source connection,
// locator, detection method, and match content — see
// packages/scanner/src/discovery/evidence-assembly.ts). An unchanged rescan
// therefore always re-derives the exact same reviewSubjectId/commandId, so
// the existing create_review_subject / apply_review_transition RPC
// idempotency guards (Governance Persistence V1) do the rest: no random
// runtime identity is ever the sole duplicate-prevention mechanism here.
// ---------------------------------------------------------------------------

function stableHex(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function deriveReviewSubjectId(organisationId: OrganisationId, findingId: string): ReviewSubjectId {
  return asReviewSubjectId(`review-subject:discovery:${stableHex([organisationId, findingId])}`);
}

function deriveProposeCommandId(reviewSubjectId: ReviewSubjectId): string {
  return `cmd:discovery-intake:propose:${stableHex([reviewSubjectId, "PASS_THROUGH_V1"])}`;
}

// ---------------------------------------------------------------------------
// DETECTED -> optional PROPOSED. This is the single authority ceiling for
// every code path in this file: it only ever calls createReviewSubject and
// PassThroughSemanticProposalStrategy.propose (both from governance-review),
// never confirm/certify/reject, and never authorization/reconciliation/
// materialization. A subject already advanced beyond DETECTED (by a prior
// intake run's own proposal, or by a human) is read back authoritatively via
// getReviewSubject and left untouched — the machine ceiling is enforced by
// never invoking a transition function capable of reaching past PROPOSED,
// not merely by hoping one fails.
// ---------------------------------------------------------------------------

async function ensureReviewSubjectAndPropose(
  finding: DiscoveryFinding<DiscoveryCandidateKind>,
  candidate: NormalizedCandidate | undefined,
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
  countAs: "object" | "relationship",
): Promise<void> {
  const reviewSubjectId = deriveReviewSubjectId(ctx.organisationId, finding.findingId);

  // Read before create. finding.detectedAt reflects *this* scan's real wall-
  // clock observation time, which legitimately differs from an earlier scan
  // of the exact same unchanged content (reviewSubjectId/findingId are
  // content-addressed and stable, but detectedAt is not). The existing
  // gov_repo.create_review_subject RPC (Governance Persistence V1, closed —
  // never redesigned here) treats detected_at as content that must match
  // exactly to count as a replay, so blindly re-submitting create with a
  // fresh timestamp on every rescan would turn an idempotent no-op into a
  // spurious conflict. Checking for an already-durable subject first, and
  // only ever calling createReviewSubject on a genuine first sighting, keeps
  // every subsequent rescan from ever presenting a second, differently-timed
  // "creation" for the same finding at all.
  let currentSubject = await ports.review.getReviewSubject(ctx.organisationId, reviewSubjectId);

  if (!currentSubject) {
    const freshSubject = createReviewSubject({
      reviewSubjectId,
      organisationId: ctx.organisationId,
      finding,
      candidate,
    });
    const created = await ports.review.createReviewSubject(freshSubject);
    if (!created.replay) {
      if (countAs === "object") tally.reviewSubjectsCreated += 1;
      else tally.relationshipSubjectsCreated += 1;
    }
    // A concurrent first-sighting race could still replay here with content
    // that does not match what this call just observed; re-read
    // authoritatively rather than trusting the port's echoed-back value.
    currentSubject = created.replay
      ? await ports.review.getReviewSubject(ctx.organisationId, reviewSubjectId)
      : created.subject;
  }

  if (!currentSubject || currentSubject.state !== REVIEW_STATE.DETECTED) {
    return; // Already proposed or advanced further: nothing more for machine intake to do.
  }

  const commandId = deriveProposeCommandId(reviewSubjectId);
  let proposal: TransitionResult;
  try {
    proposal = new PassThroughSemanticProposalStrategy().propose(
      finding,
      {
        organisationId: ctx.organisationId,
        reviewSubjectId,
        commandId,
        occurredAt: finding.detectedAt,
      },
      candidate,
    );
  } catch (error) {
    if (error instanceof IneligibleFindingError) return; // Not eligible for machine proposal: staying DETECTED is a valid result, not an error.
    throw error;
  }

  const persisted = await ports.review.persistReviewTransition(proposal);
  if (!persisted.replay) tally.proposalsCreated += 1;
}

async function processObjectCandidate(
  candidate: DiscoveryCandidate,
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  const { finding } = candidate;
  try {
    // Evidence and its SourceAssertion are made durable before anything ever
    // references their ids from a ReviewSubject — the DB-level hard gate
    // (source_assertions/evidence FKs on review_subject_assertions/
    // review_subject_evidence) makes any other ordering fail closed anyway.
    await ports.intake.recordEvidence(ctx.organisationId, candidate.evidence);
    await ports.intake.recordSourceAssertion(ctx.organisationId, candidate.assertion);

    // ALREADY_GOVERNED: consult the durable canonical source mapping
    // (Canonical Materialization V1) as a read-only signal only. A mapping
    // never mutates, never suppresses a relationship finding, and is always
    // organisation-scoped so another tenant's mapping can never suppress
    // this one's finding.
    const mapping = await ports.materialization.findActiveObjectSourceMapping({
      organisationId: ctx.organisationId,
      sourceConnectionId: finding.sourceObject.connectionId,
      sourceExternalType: finding.sourceObject.externalType,
      sourceExternalId: finding.sourceObject.externalId,
    });
    if (mapping) {
      tally.alreadyGoverned += 1;
      return;
    }

    await ensureReviewSubjectAndPropose(finding, undefined, ctx, ports, tally, "object");
  } catch (error) {
    tally.failures.push({
      findingId: finding.findingId,
      candidateKind: finding.candidateKind,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processRelationshipCandidate(
  result: RelationshipCorrelationResult,
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  try {
    // Relationship findings reuse the Evidence/SourceAssertion already made
    // durable while processing their endpoint object candidates (relationship
    // correlation runs after every object candidate in this same scan has
    // already been processed); no new evidence is fabricated for the edge
    // itself. Already-governed endpoints never suppress a relationship.
    await ensureReviewSubjectAndPropose(result.finding, result.candidate, ctx, ports, tally, "relationship");
  } catch (error) {
    tally.failures.push({
      findingId: result.finding.findingId,
      candidateKind: "RELATIONSHIP",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Runs one real discovery scan against a trusted, server-configured source
 * and places every reviewable result into the governed review queue at
 * DETECTED (or PROPOSED, where the existing deterministic policy allows).
 * Never invokes CONFIRMED, CERTIFIED, authorization, reconciliation, or
 * materialization: those remain exclusively human-gated, downstream, and out
 * of scope for this milestone.
 */
export async function runGovernanceDiscoveryScan(
  input: RunGovernanceDiscoveryScanInput,
  ports: DiscoveryIntakePorts = defaultPorts,
): Promise<GovernanceDiscoveryScanResult> {
  const { executionContext: ctx, sourceConfiguration } = input;
  const adapter = new LocalRepositoryAdapter(sourceConfiguration.rootPath);
  const pipeline = new DiscoveryPipeline(adapter, [
    new AgentKindDeclarationSpecification(),
    new ModelReferenceDeclarationSpecification(),
    new ToolListDeclarationSpecification(),
  ]);

  let runResult: DiscoveryRunResult;
  try {
    runResult = await pipeline.run();
  } catch (error) {
    // Fail closed, matching DiscoveryPipeline's own posture: an unenumerable
    // source produces no candidates, no ReviewSubjects, and no PROPOSED
    // transitions. pipeline.run() does not expose its own internal (already
    // FAILED) AcquisitionRun value on this path, so a durable run record is
    // reconstructed here from adapter identity alone using the same
    // deterministic connection/system derivation the pipeline itself uses.
    const now = asIsoTimestamp(new Date().toISOString());
    const descriptor = adapter.describeSource();
    const system = createSourceSystem(descriptor);
    const connection = createSourceConnection(system, descriptor);
    const failedRun: AcquisitionRun = {
      runId: asAcquisitionRunId(`acquisition-run:${randomUUID()}`),
      connection,
      mode: "FULL",
      status: "FAILED",
      adapterName: adapter.adapterName,
      adapterVersion: adapter.adapterVersion,
      startedAt: now,
      completedAt: now,
    };
    await ports.intake.startAcquisitionRun(ctx.organisationId, failedRun);
    await ports.intake.completeAcquisitionRun(ctx.organisationId, failedRun, zeroCounts());

    return {
      scanRunId: failedRun.runId,
      sourceConnectionId: connection.connectionId,
      sourceType: descriptor.family,
      status: "FAILED",
      artifactsScanned: 0,
      findingsDetected: 0,
      objectCandidates: 0,
      relationshipCandidates: 0,
      reviewSubjectsCreated: 0,
      relationshipSubjectsCreated: 0,
      proposalsCreated: 0,
      alreadyGoverned: 0,
      failures: [{ reason: `Source enumeration failed: ${error instanceof Error ? error.message : String(error)}` }],
      startedAt: now,
      completedAt: now,
    };
  }

  const { run, candidates } = runResult;
  await ports.intake.startAcquisitionRun(ctx.organisationId, run);

  // LocalRepositoryAdapter.listArtifacts() is a deterministic, side-effect-
  // free directory walk; calling it once more for an accurate executive
  // count does not duplicate any governance-relevant work and does not
  // require changing DiscoveryPipeline's own result shape.
  const artifactsScanned = (await adapter.listArtifacts()).length;

  const relationshipResults = new RelationshipCorrelationStrategy().correlate(
    candidates,
    run.completedAt ?? run.startedAt,
  );

  const tally: ScanTally = {
    reviewSubjectsCreated: 0,
    relationshipSubjectsCreated: 0,
    proposalsCreated: 0,
    alreadyGoverned: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    await processObjectCandidate(candidate, ctx, ports, tally);
  }
  for (const relationshipResult of relationshipResults) {
    await processRelationshipCandidate(relationshipResult, ctx, ports, tally);
  }

  const counts: AcquisitionRunCounts = {
    artifactsScanned,
    findingsDetected: candidates.length + relationshipResults.length,
    objectCandidates: candidates.length,
    relationshipCandidates: relationshipResults.length,
    reviewSubjectsCreated: tally.reviewSubjectsCreated,
    proposalsCreated: tally.proposalsCreated,
    alreadyGoverned: tally.alreadyGoverned,
    itemFailures: tally.failures.length,
  };
  await ports.intake.completeAcquisitionRun(ctx.organisationId, run, counts);

  const totalOutcomes = tally.reviewSubjectsCreated + tally.relationshipSubjectsCreated + tally.alreadyGoverned;
  // This is the Discovery Intake layer's own outcome vocabulary, distinct
  // from the AcquisitionRun's persisted scanner-level status (always
  // SUCCEEDED here, since pipeline.run() itself did not throw): a scan can
  // fully succeed at the scanner layer while some items still fail to reach
  // governance review, which this status must still surface as PARTIAL.
  const status: GovernanceDiscoveryScanStatus =
    tally.failures.length === 0 ? "SUCCEEDED" : totalOutcomes > 0 ? "PARTIAL" : "FAILED";

  return {
    scanRunId: run.runId,
    sourceConnectionId: run.connection.connectionId,
    sourceType: adapter.describeSource().family,
    status,
    artifactsScanned,
    findingsDetected: counts.findingsDetected,
    objectCandidates: candidates.length,
    relationshipCandidates: relationshipResults.length,
    reviewSubjectsCreated: tally.reviewSubjectsCreated,
    relationshipSubjectsCreated: tally.relationshipSubjectsCreated,
    proposalsCreated: tally.proposalsCreated,
    alreadyGoverned: tally.alreadyGoverned,
    failures: tally.failures,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? run.startedAt,
  };
}
