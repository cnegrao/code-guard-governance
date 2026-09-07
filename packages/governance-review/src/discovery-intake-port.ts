import type {
  AcquisitionRun,
  Evidence,
  EvidenceId,
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

export interface DiscoveryIntakePersistencePort {
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
}
