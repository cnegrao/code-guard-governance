import type {
  AcquisitionRun,
  DiscoveryCandidateKind,
  DiscoveryFinding,
  DiscoveryFindingId,
  Evidence,
  EvidenceId,
  NormalizedCandidate,
  NormalizedCandidateId,
  NormalizedRelationshipCandidate,
  RelationshipDiscoveryFinding,
  OrganisationId,
  SourceAssertion,
  SourceAssertionId,
} from "@council/canonical-contracts";

/**
 * Discovery Intake V1.
 *
 * Narrow persistence boundary (Port/Repository pattern), the same shape as
 * GovernanceReviewPersistencePort and MaterializationPersistencePort: this
 * package never implements durable storage itself, never talks to
 * Supabase/Postgres, and never invents a generic privileged db.read/db.write
 * escape hatch. A trusted server-only adapter (see apps/dashboard) implements
 * this interface.
 *
 * This Port exists to close one specific gap: a persisted ReviewSubject must
 * never point to an EvidenceId or SourceAssertionId that exists only in
 * TypeScript memory. It durably records exactly the canonical-contracts
 * Evidence / SourceAssertion / AcquisitionRun shapes the scanner discovery
 * pipeline already produces — never a redesigned or scanner-local shape —
 * and confers no governance authority: recording evidence or an acquisition
 * run is never itself a review, proposal, confirmation, certification,
 * authorization, or materialization.
 *
 * Discovery Governance Input Persistence V1 extends this same discipline to
 * the DiscoveryFinding and NormalizedCandidate the ReviewSubject itself is
 * derived from (review-subject.ts intentionally never copies or re-derives
 * this content — see its own doc comment). Once a ReviewSubject is CERTIFIED,
 * these are the exact objects invokeObjectReconciliation /
 * invokeRelationshipReconciliation require; without durable storage of them
 * here, that content only ever existed in the TypeScript memory of the
 * original intake call. recordNormalizedCandidate is called for an
 * object-kind finding whenever Object Candidate Normalization V1
 * (packages/scanner/src/discovery/object-candidate-normalization.ts)
 * actually produces a NormalizedObjectCandidate for it (today: MODEL and
 * TOOL); a finding whose kind has no safe, evidence-backed identity yet
 * (today: AGENT, and every other CanonicalObjectKind with no detector) is
 * left without a durable candidate, exactly like RelationshipCorrelationStrategy
 * always produces a real NormalizedRelationshipCandidate, always 1:1 with its
 * finding. This Port never fabricates a candidate to fill either gap.
 */

export interface AcquisitionRunPersistenceResult {
  /** true when an identical AcquisitionRun already existed under this runId (idempotent replay). */
  readonly replay: boolean;
  readonly runId: AcquisitionRun["runId"];
  readonly status: AcquisitionRun["status"];
}

export interface AcquisitionRunCounts {
  readonly artifactsScanned: number;
  readonly findingsDetected: number;
  readonly objectCandidates: number;
  readonly relationshipCandidates: number;
  readonly reviewSubjectsCreated: number;
  readonly proposalsCreated: number;
  readonly alreadyGoverned: number;
  readonly itemFailures: number;
}

export interface EvidencePersistenceResult {
  /** true when identical Evidence already existed under this evidenceId (idempotent replay). */
  readonly replay: boolean;
  readonly evidenceId: EvidenceId;
}

export interface SourceAssertionPersistenceResult {
  /** true when an identical SourceAssertion already existed under this assertionId (idempotent replay). */
  readonly replay: boolean;
  readonly assertionId: SourceAssertionId;
}

export interface DiscoveryFindingPersistenceResult {
  /** true when identical DiscoveryFinding content already existed under this findingId (idempotent replay). */
  readonly replay: boolean;
  readonly findingId: DiscoveryFindingId;
}

export interface NormalizedCandidatePersistenceResult {
  /** true when identical NormalizedCandidate content already existed under this candidateId (idempotent replay). */
  readonly replay: boolean;
  readonly candidateId: NormalizedCandidateId;
}

export interface DiscoveryIntakePersistencePort {
  /** Optional capability for SQL lineage adapters. Atomically preserves the
   * origin candidate/finding and attaches a separately identified observation.
   * Returned envelopes are always the immutable origin used by review/M7.
   * Implementations without this capability must fail closed for lineage.
   */
  recordLineageObservation?(
    organisationId: OrganisationId,
    finding: RelationshipDiscoveryFinding,
    candidate: NormalizedRelationshipCandidate,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<{ readonly finding: RelationshipDiscoveryFinding; readonly candidate: NormalizedRelationshipCandidate }>;
  /** Idempotent: identical content under an already-used runId replays; conflicting content fails closed. */
  startAcquisitionRun(
    organisationId: OrganisationId,
    run: AcquisitionRun,
  ): Promise<AcquisitionRunPersistenceResult>;

  /**
   * Idempotent: completes a RUNNING/PENDING run with its terminal status and
   * final executive counts. An already-terminal run with identical content
   * replays; different content fails closed.
   */
  completeAcquisitionRun(
    organisationId: OrganisationId,
    run: AcquisitionRun,
    counts: AcquisitionRunCounts,
  ): Promise<AcquisitionRunPersistenceResult>;

  /** Idempotent: identical content under an already-used evidenceId replays; conflicting content fails closed. */
  recordEvidence(
    organisationId: OrganisationId,
    evidence: Evidence,
  ): Promise<EvidencePersistenceResult>;

  /**
   * Idempotent: identical content under an already-used assertionId replays;
   * conflicting content fails closed. Every cited evidenceId must already be
   * durable (see recordEvidence) — this call must always follow recording
   * every evidence it cites, never precede or substitute for it.
   */
  recordSourceAssertion(
    organisationId: OrganisationId,
    assertion: SourceAssertion,
  ): Promise<SourceAssertionPersistenceResult>;

  /**
   * Idempotent: identical content under an already-used findingId replays;
   * conflicting content (same findingId, different semantic envelope) fails
   * closed — this is the authoritative Discovery Engine observation and must
   * never be silently overwritten. Every cited assertionId/evidenceId must
   * already be durable (see recordSourceAssertion/recordEvidence). Every
   * DiscoveryFinding a ReviewSubject will ever reference must be recorded
   * here first — a ReviewSubject created after this milestone must never
   * point to a findingId that exists only in TypeScript memory.
   */
  recordDiscoveryFinding(
    organisationId: OrganisationId,
    finding: DiscoveryFinding<DiscoveryCandidateKind>,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<DiscoveryFindingPersistenceResult>;

  /** Returns the exact durable DiscoveryFinding, or undefined if none was ever recorded for this tenant/findingId (including every pre-milestone ReviewSubject). */
  getDiscoveryFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<DiscoveryFinding<DiscoveryCandidateKind> | undefined>;

  /**
   * Idempotent: identical content under an already-used candidateId replays;
   * conflicting content fails closed. The cited findingId must already be
   * durable (see recordDiscoveryFinding), and must belong to the same
   * candidate/finding association (kind + source object) — never recorded
   * after the fact for an unrelated finding. Today this is only ever called
   * for a RELATIONSHIP candidate (see this file's own doc comment); it exists
   * for every candidate kind so a future object-candidate producer needs no
   * persistence redesign.
   */
  recordNormalizedCandidate(
    organisationId: OrganisationId,
    candidate: NormalizedCandidate,
    acquisitionRunId: AcquisitionRun["runId"],
  ): Promise<NormalizedCandidatePersistenceResult>;

  /** Returns the exact durable NormalizedCandidate backing this finding, or undefined when no candidate was ever recorded for it (the current, real state for every OBJECT-kind finding). */
  getNormalizedCandidateForFinding(
    organisationId: OrganisationId,
    findingId: DiscoveryFindingId,
  ): Promise<NormalizedCandidate | undefined>;
}
