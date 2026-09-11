import "server-only";
import { createHash, randomUUID } from "node:crypto";

import {
  AgentVersionCorrelationStrategy,
  DiscoveryPipeline,
  LocalRepositoryAdapter,
  RelationshipCorrelationStrategy,
  AgentKindDeclarationSpecification,
  ModelReferenceDeclarationSpecification,
  ToolListDeclarationSpecification,
  PromptDeclarationSpecification,
  McpServerDeclarationSpecification,
  ApiDeclarationSpecification,
  KnowledgeBaseDeclarationSpecification,
  SkillListDeclarationSpecification,
  SqlCreateTableSpecification,
  SqlInsertSelectSpecification,
  FrameworkImportSignalSpecification,
  OrchestrationFrameworkSignalSpecification,
  createSourceConnection,
  createSourceSystem,
  normalizeObjectCandidate,
  type AgentVersionCorrelationResult,
  type DiscoveryCandidate,
  type DiscoveryRunResult,
  type ObjectNormalizationContext,
  type RelationshipCorrelationResult,
  type TechnicalProfileSignal,
} from "@council/scanner";
import {
  IneligibleFindingError,
  normalizedObjectIdentity,
  PassThroughSemanticProposalStrategy,
  REVIEW_STATE,
  asReviewSubjectId,
  createReviewSubject,
  type AcquisitionRunCounts,
  type AgentVersionTechnicalProfilePersistencePort,
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
import { discoveryIntakePersistence, normalizedCandidateEnvelopeHash } from "./discovery-intake-persistence";
import { agentVersionTechnicalProfilePersistence } from "./agent-version-technical-profile-persistence";

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
 *     the DB-level hard gate added by the accompanying migration);
 *   - never persists a ReviewSubject before its exact backing DiscoveryFinding
 *     (and, when Object Candidate Normalization V1 or relationship
 *     correlation actually produced one, its NormalizedCandidate) is itself
 *     already durable (Discovery Governance Input Persistence V1; see
 *     review_subjects_finding_fkey and ensureReviewSubjectAndPropose below).
 *     This is what lets a CERTIFIED ReviewSubject's exact original
 *     reconciliation input be recovered later, rather than existing only in
 *     this call's TypeScript memory.
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
  readonly agentVersionTechnicalProfile: AgentVersionTechnicalProfilePersistencePort;
}

const defaultPorts: DiscoveryIntakePorts = {
  review: governanceReviewPersistence,
  materialization: materializationPersistence,
  intake: discoveryIntakePersistence,
  agentVersionTechnicalProfile: agentVersionTechnicalProfilePersistence,
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
  acquisitionRunId: AcquisitionRun["runId"],
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
  countAs: "object" | "relationship",
): Promise<void> {
  // Discovery Governance Input Persistence V1: the exact DiscoveryFinding
  // (and, when Discovery Intake actually produces one — today only for
  // RELATIONSHIP kind, see discovery-intake-port.ts) NormalizedCandidate must
  // be durable before any ReviewSubject can reference them. Both calls are
  // idempotent (identical content under a reused id replays), so recording
  // them unconditionally on every scan — even one that later turns out to be
  // a full ReviewSubject replay — is always safe and keeps this invariant
  // unconditional rather than dependent on which branch runs below.
  await ports.intake.recordDiscoveryFinding(ctx.organisationId, finding, acquisitionRunId);
  if (candidate) {
    await ports.intake.recordNormalizedCandidate(ctx.organisationId, candidate, acquisitionRunId);
  }

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
  acquisitionRunId: AcquisitionRun["runId"],
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
  normalizationContext: ObjectNormalizationContext,
): Promise<void> {
  const { finding } = candidate;
  try {
    // Evidence and its SourceAssertion are made durable before anything ever
    // references their ids from a ReviewSubject — the DB-level hard gate
    // (source_assertions/evidence FKs on review_subject_assertions/
    // review_subject_evidence) makes any other ordering fail closed anyway.
    await ports.intake.recordEvidence(ctx.organisationId, candidate.evidence);
    await ports.intake.recordSourceAssertion(ctx.organisationId, candidate.assertion);

    const normalization = normalizeObjectCandidate(candidate, normalizationContext);
    const normalizedCandidate = normalization.status === "NORMALIZED" ? normalization.candidate : undefined;
    if ((finding.candidateKind === "DATA_ASSET" || finding.candidateKind === "DATA_ELEMENT") && !normalizedCandidate) {
      throw new Error("DATA_DECLARATION_NOT_SAFELY_NORMALIZABLE");
    }
    const parent = normalization.status === "NORMALIZED" ? normalization.parentDataAsset : undefined;
    if (normalizedCandidate?.candidateKind === "DATA_ELEMENT") {
      const durable = parent ? await ports.intake.getNormalizedCandidateForFinding(ctx.organisationId, parent.findingId) : undefined;
      if (!parent || durable?.candidateKind !== "DATA_ASSET" ||
        normalizedCandidateEnvelopeHash(durable) !== normalizedCandidateEnvelopeHash(parent)) {
        throw new Error("DATA_ELEMENT_PARENT_NOT_DURABLE");
      }
    }
    // Retain exact durable endpoint inputs even when object governance already happened.
    const mapping = normalizedCandidate ? await ports.materialization.findActiveObjectSourceMapping({
      organisationId: ctx.organisationId,
      sourceConnectionId: finding.sourceObject.connectionId,
      sourceExternalType: finding.sourceObject.externalType,
      sourceExternalId: finding.sourceObject.externalId,
      canonicalObjectKind: normalizedCandidate.candidateKind,
      normalizedObjectIdentity: normalizedObjectIdentity(normalizedCandidate, parent),
    }) : undefined;
    if (mapping) {
      await ports.intake.recordDiscoveryFinding(ctx.organisationId, finding, acquisitionRunId);
      await ports.intake.recordNormalizedCandidate(ctx.organisationId, normalizedCandidate!, acquisitionRunId);
      tally.alreadyGoverned += 1;
      return;
    }

    await ensureReviewSubjectAndPropose(finding, normalizedCandidate, acquisitionRunId, ctx, ports, tally, "object");
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
  endpointCandidates: ReadonlyMap<string, NormalizedCandidate>,
  acquisitionRunId: AcquisitionRun["runId"],
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  try {
    for (const endpoint of [result.candidate.sourceEndpoint, result.candidate.targetEndpoint]) {
      if (endpoint.referenceKind !== "CANDIDATE") throw new Error("L9_ENDPOINT_REQUIRES_CANDIDATE");
      const expected = endpointCandidates.get(endpoint.candidateId);
      const durable = expected
        ? await ports.intake.getNormalizedCandidateForFinding(ctx.organisationId, expected.findingId)
        : undefined;
      if (!durable || durable.candidateId !== endpoint.candidateId || durable.candidateKind !== endpoint.candidateKind) {
        throw new Error("L9_ENDPOINT_CANDIDATE_NOT_DURABLE");
      }
    }
    // Relationship findings cite support already made durable from endpoints
    // and, for SQL lineage, the explicit transformation statement. No governed
    // endpoint resolution or reconciliation is performed.
    if (result.candidate.relationshipTypeCode === "DERIVED_FROM") {
      if (!ports.intake.recordLineageObservation) throw new Error("LINEAGE_OBSERVATION_PERSISTENCE_UNAVAILABLE");
      const origin = await ports.intake.recordLineageObservation(ctx.organisationId, result.finding, result.candidate, acquisitionRunId);
      await ensureReviewSubjectAndPropose(origin.finding, origin.candidate, acquisitionRunId, ctx, ports, tally, "relationship");
    } else {
      await ensureReviewSubjectAndPropose(result.finding, result.candidate, acquisitionRunId, ctx, ports, tally, "relationship");
    }
  } catch (error) {
    tally.failures.push({
      findingId: result.finding.findingId,
      candidateKind: "RELATIONSHIP",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * AgentVersion technical-profile signals (Framework/Orchestration — see
 * technical-profile-signal.ts) are structurally NOT DiscoveryCandidates
 * of any CanonicalObjectKind and therefore never flow through
 * processObjectCandidate/normalizeObjectCandidate/ensureReviewSubjectAndPropose
 * at all — there is no candidateKind to normalize or to back a ReviewSubject
 * with. Their Evidence/SourceAssertion are still made durable here — the
 * same "durable before referenced" invariant processObjectCandidate
 * enforces — because AgentVersion correlation's own ReviewSubject
 * (processAgentVersionCandidate below) may cite their assertionIds/
 * evidenceIds in its own union.
 */
async function processTechnicalProfileSignal(
  signal: TechnicalProfileSignal,
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  try {
    await ports.intake.recordEvidence(ctx.organisationId, signal.evidence);
    await ports.intake.recordSourceAssertion(ctx.organisationId, signal.assertion);
  } catch (error) {
    tally.failures.push({
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processAgentVersionCandidate(
  result: AgentVersionCorrelationResult,
  acquisitionRunId: AcquisitionRun["runId"],
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  try {
    // AGENT_VERSION is an OBJECT-kind finding, but (like RELATIONSHIP) it is
    // a correlation product, not a single detector's own match: it reuses
    // the Evidence/SourceAssertion already made durable while processing its
    // parent AGENT and correlated MODEL/TOOL candidates (AGENT_VERSION
    // correlation runs after every object candidate in this same scan has
    // already been processed); no new evidence is fabricated for it.
    await ensureReviewSubjectAndPropose(result.finding, result.candidate, acquisitionRunId, ctx, ports, tally, "object");
  } catch (error) {
    tally.failures.push({
      findingId: result.finding.findingId,
      candidateKind: "AGENT_VERSION",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const AGENT_VERSION_TECHNICAL_PROFILE_CONTRACT_VERSION = "1.0";
const EMPTY_TECHNICAL_PROFILE_FIELD_SUPPORT = Object.freeze({ assertionIds: [], evidenceIds: [] });

/**
 * Technical Profile Persistence V1 (ADR-GOVIA-TECHNICAL-PROFILE-PERSISTENCE-v1).
 * Durably records a typed, pre-canonical AgentVersionTechnicalProfile
 * proposal for every correlated AGENT_VERSION result — never a canonical
 * write, never certification, and requires the AGENT_VERSION's own
 * NormalizedCandidate to already be durable (recordNormalizedCandidate,
 * called inside ensureReviewSubjectAndPropose above, must run first — see
 * the ordering in runGovernanceDiscoveryScan below). behaviorFingerprint is
 * always populated (the same technicalRevisionFingerprint already folded
 * into candidate.candidateId, never a second competing fingerprint).
 * buildReference/entrypointReference/configurationReference have no
 * detector in this round and are always left absent (UNKNOWN, never FALSE).
 * runtimeFrameworkReference is proposed only when the correlation itself
 * found exactly one unambiguous same-file Framework signal.
 */
async function processAgentVersionTechnicalProfileProposal(
  result: AgentVersionCorrelationResult,
  ctx: GovernanceExecutionContext,
  ports: DiscoveryIntakePorts,
  tally: ScanTally,
): Promise<void> {
  try {
    const proposalId = `agent-version-technical-profile-proposal:${stableHex([
      "agent-version-technical-profile-proposal",
      result.candidate.candidateId,
    ])}`;

    await ports.agentVersionTechnicalProfile.recordAgentVersionTechnicalProfileProposal({
      organisationId: ctx.organisationId,
      proposalId,
      agentVersionCandidateId: result.candidate.candidateId,
      behaviorFingerprintAlgorithm: "sha256",
      behaviorFingerprintSchemaVersion: "1.0",
      behaviorFingerprintValue: result.technicalRevisionFingerprint,
      runtimeFrameworkReference: result.runtimeFrameworkReference,
      support: {
        behaviorFingerprint: { assertionIds: result.finding.assertionIds, evidenceIds: result.finding.evidenceIds },
        buildReference: EMPTY_TECHNICAL_PROFILE_FIELD_SUPPORT,
        runtimeFrameworkReference: result.runtimeFrameworkReferenceSupport ?? EMPTY_TECHNICAL_PROFILE_FIELD_SUPPORT,
        entrypointReference: EMPTY_TECHNICAL_PROFILE_FIELD_SUPPORT,
        configurationReference: EMPTY_TECHNICAL_PROFILE_FIELD_SUPPORT,
      },
      contractVersion: AGENT_VERSION_TECHNICAL_PROFILE_CONTRACT_VERSION,
    });
  } catch (error) {
    tally.failures.push({
      findingId: result.finding.findingId,
      candidateKind: "AGENT_VERSION",
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
  const pipeline = new DiscoveryPipeline(
    adapter,
    [
      new AgentKindDeclarationSpecification(),
      new ModelReferenceDeclarationSpecification(),
      new ToolListDeclarationSpecification(),
      new PromptDeclarationSpecification(),
      new McpServerDeclarationSpecification(),
      new ApiDeclarationSpecification(),
      new KnowledgeBaseDeclarationSpecification(),
      new SkillListDeclarationSpecification(),
      new SqlCreateTableSpecification("DATA_ASSET"),
      new SqlCreateTableSpecification("DATA_ELEMENT"),
      new SqlInsertSelectSpecification(),
    ],
    {
      // AgentVersion technical-profile signal detectors: structurally
      // separate from `specifications` above (never a DiscoveryCandidate of
      // any CanonicalObjectKind — see technical-profile-signal.ts). They
      // only ever contribute evidence to AgentVersion correlation's own
      // technical revision (agent-version-correlation.ts), never their own
      // ReviewSubject (see processTechnicalProfileSignal below).
      signalSpecifications: [new FrameworkImportSignalSpecification(), new OrchestrationFrameworkSignalSpecification()],
    },
  );

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

  const { run, candidates, technicalProfileSignals } = runResult;
  await ports.intake.startAcquisitionRun(ctx.organisationId, run);

  // LocalRepositoryAdapter.listArtifacts() is a deterministic, side-effect-
  // free directory walk; calling it once more for an accurate executive
  // count does not duplicate any governance-relevant work and does not
  // require changing DiscoveryPipeline's own result shape.
  const artifactsScanned = (await adapter.listArtifacts()).length;

  // AGENT_VERSION, like RELATIONSHIP, is a correlation product rather than a
  // single detector's own match (see agent-version-correlation.ts); it is
  // computed before relationshipResults but only ever processed
  // below once its parent AGENT/MODEL/TOOL evidence and every correlated
  // technical-profile signal have already been made durable.
  const agentVersionResults: readonly AgentVersionCorrelationResult[] = new AgentVersionCorrelationStrategy().correlate(
    candidates,
    technicalProfileSignals,
    run.completedAt ?? run.startedAt,
  );
  const relationshipResults = new RelationshipCorrelationStrategy().correlate(
    candidates,
    run.completedAt ?? run.startedAt,
    { organisationId: ctx.organisationId, connectionId: run.connection.connectionId,
      agentVersions: agentVersionResults, technicalProfileSignals },
  );

  const tally: ScanTally = {
    reviewSubjectsCreated: 0,
    relationshipSubjectsCreated: 0,
    proposalsCreated: 0,
    alreadyGoverned: 0,
    failures: [],
  };

  // Parent durability precedes child review, independently of detector/traversal order.
  const normalizationContext = { candidates };
  const objectCandidates = candidates.filter(c => c.finding.candidateKind !== "RELATIONSHIP");
  const orderedCandidates = [...objectCandidates.filter(c => c.finding.candidateKind !== "DATA_ELEMENT"),
    ...objectCandidates.filter(c => c.finding.candidateKind === "DATA_ELEMENT")];
  for (const candidate of orderedCandidates) {
    await processObjectCandidate(candidate, run.runId, ctx, ports, tally, normalizationContext);
  }
  for (const signal of technicalProfileSignals) {
    await processTechnicalProfileSignal(signal, ctx, ports, tally);
  }
  // Explicit SQL transformation support is durable before any edge cites it.
  // The raw statement match is not a separate review subject or object.
  for (const declaration of candidates.filter(c => c.finding.candidateKind === "RELATIONSHIP")) {
    try {
      await ports.intake.recordEvidence(ctx.organisationId, declaration.evidence);
      await ports.intake.recordSourceAssertion(ctx.organisationId, declaration.assertion);
    } catch (error) {
      tally.failures.push({ candidateKind: "RELATIONSHIP", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const agentVersionResult of agentVersionResults) {
    await processAgentVersionCandidate(agentVersionResult, run.runId, ctx, ports, tally);
    // Requires the AGENT_VERSION's own NormalizedCandidate to already be
    // durable (recordNormalizedCandidate, called inside
    // ensureReviewSubjectAndPropose above) — must run strictly after.
    await processAgentVersionTechnicalProfileProposal(agentVersionResult, ctx, ports, tally);
  }
  const endpointCandidates = new Map<string, NormalizedCandidate>();
  for (const item of candidates) {
    const normalized = normalizeObjectCandidate(item, normalizationContext);
    if (normalized.status === "NORMALIZED") endpointCandidates.set(normalized.candidate.candidateId, normalized.candidate);
  }
  for (const item of agentVersionResults) endpointCandidates.set(item.candidate.candidateId, item.candidate);
  for (const relationshipResult of relationshipResults) {
    await processRelationshipCandidate(relationshipResult, endpointCandidates, run.runId, ctx, ports, tally);
  }

  const objectCandidateCount = objectCandidates.length + agentVersionResults.length;
  const counts: AcquisitionRunCounts = {
    artifactsScanned,
    findingsDetected: objectCandidateCount + relationshipResults.length,
    objectCandidates: objectCandidateCount,
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
    objectCandidates: objectCandidateCount,
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
