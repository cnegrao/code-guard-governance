import {
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type DiscoveryFindingId,
  type EvidenceId,
  type IsoTimestamp,
  type NormalizedCandidate,
  type OrganisationId,
  type ReconciliationAuthority,
  type SourceAssertionId,
  type SourceObjectIdentity,
} from "@council/canonical-contracts";

import { SubjectMismatchError } from "./errors";
import type { ReviewSubjectId, ReviewTransitionId } from "./identifiers";
import { REVIEW_STATE, type ReviewState } from "./review-state";

/** Immutable record of one successful state transition. */
export interface ReviewAuditEvent {
  readonly eventId: ReviewTransitionId;
  readonly reviewSubjectId: ReviewSubjectId;
  readonly findingId: DiscoveryFindingId;
  readonly organisationId: OrganisationId;
  readonly previousState: ReviewState;
  readonly newState: ReviewState;
  /** HUMAN authority identifies a person; DETERMINISTIC_RULE identifies machine origin (never a substitute for HUMAN on a human-gated transition). */
  readonly actor: ReconciliationAuthority;
  readonly occurredAt: IsoTimestamp;
  readonly evidenceIds: readonly EvidenceId[];
  readonly reasonCode?: string;
  readonly commandId: string;
}

/**
 * A review subject references an existing DiscoveryFinding (or
 * RelationshipDiscoveryFinding, which is just DiscoveryFinding<"RELATIONSHIP">)
 * by identity; it never copies or re-derives the finding's governed content.
 * Findings/candidates/evidence/reconciliation remain fully owned by
 * canonical-contracts.
 */
export interface ReviewSubject {
  readonly reviewSubjectId: ReviewSubjectId;
  /** Trusted orchestration context, supplied by the caller - never derived from the finding. */
  readonly organisationId: OrganisationId;
  readonly candidateKind: DiscoveryCandidateKind;
  readonly findingId: DiscoveryFindingId;
  readonly sourceObject: SourceObjectIdentity;
  readonly assertionIds: readonly SourceAssertionId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly state: ReviewState;
  readonly detectedAt: IsoTimestamp;
  /** Present once at least one transition has been applied; enables idempotent replay detection (see transitions.ts). */
  readonly lastTransition?: ReviewAuditEvent;
}

export interface CreateReviewSubjectInput {
  readonly reviewSubjectId: ReviewSubjectId;
  readonly organisationId: OrganisationId;
  readonly finding: DiscoveryFinding<DiscoveryCandidateKind>;
  /**
   * Optional cross-check context for a normalized candidate backing the same
   * finding (e.g. NormalizedRelationshipCandidate). Validated, never copied.
   */
  readonly candidate?: NormalizedCandidate;
}

function relationshipEndpointConnectionIds(
  candidate: NormalizedCandidate,
): readonly string[] {
  if (candidate.candidateKind !== "RELATIONSHIP") {
    return [];
  }

  const ids: string[] = [];
  for (const endpoint of [candidate.sourceEndpoint, candidate.targetEndpoint]) {
    if (endpoint.referenceKind === "SOURCE_OBJECT") {
      ids.push(endpoint.sourceObject.connectionId);
    }
  }
  return ids;
}

/**
 * Creates a new ReviewSubject at DETECTED, referencing an existing
 * DiscoveryFinding. Fails closed on any inconsistency between the finding and
 * an optionally supplied candidate (identity mismatch, kind mismatch, or -
 * for relationship candidates - an endpoint anchored to a different source
 * connection than the finding itself).
 */
export function createReviewSubject(
  input: CreateReviewSubjectInput,
): ReviewSubject {
  const { reviewSubjectId, organisationId, finding, candidate } = input;

  if (candidate) {
    if (candidate.findingId !== finding.findingId) {
      throw new SubjectMismatchError(
        "Candidate findingId does not match the finding backing this review subject",
      );
    }
    if (candidate.candidateKind !== finding.candidateKind) {
      throw new SubjectMismatchError(
        "Candidate candidateKind does not match the finding backing this review subject",
      );
    }
    for (const connectionId of relationshipEndpointConnectionIds(candidate)) {
      if (connectionId !== finding.sourceObject.connectionId) {
        throw new SubjectMismatchError(
          "Relationship candidate endpoint is anchored to a different source connection than the finding",
        );
      }
    }
  }

  return Object.freeze({
    reviewSubjectId,
    organisationId,
    candidateKind: finding.candidateKind,
    findingId: finding.findingId,
    sourceObject: finding.sourceObject,
    assertionIds: Object.freeze([...finding.assertionIds]),
    evidenceIds: Object.freeze([...finding.evidenceIds]),
    state: REVIEW_STATE.DETECTED,
    detectedAt: finding.detectedAt,
  });
}
