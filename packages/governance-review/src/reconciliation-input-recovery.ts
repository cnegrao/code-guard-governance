import {
  sourceObjectIdentityKey,
  type CanonicalObjectKind,
  type DiscoveryCandidateKind,
  type DiscoveryFinding,
  type NormalizedCandidate,
  type NormalizedObjectCandidate,
  type NormalizedRelationshipCandidate,
  type RelationshipDiscoveryFinding,
} from "@council/canonical-contracts";

import { SubjectMismatchError } from "./errors";
import type { ReviewSubject } from "./review-subject";

/**
 * Discovery Governance Input Persistence V1.
 *
 * Pure domain boundary: given a ReviewSubject and whatever durable
 * DiscoveryFinding/NormalizedCandidate a persistence adapter recovered for
 * it, decides whether the exact original reconciliation input is available,
 * and shapes it into the precise types invokeObjectReconciliation /
 * invokeRelationshipReconciliation require. It never performs I/O, never
 * recomputes or trusts an envelope hash (that is the adapter's job, before
 * this function is ever called), and never fabricates a missing candidate.
 *
 * FINDING_ONLY is a normal, expected outcome for an OBJECT-kind ReviewSubject
 * whose finding could not be safely normalized (today: AGENT — see
 * object-candidate-normalization.ts) and must never be confused with
 * INPUT_UNAVAILABLE, which means no durable Finding was ever recorded at all
 * (exclusively a pre-milestone ReviewSubject; see docs on legacy policy).
 */

export const RECONCILIATION_INPUT_STATUS = {
  OBJECT_INPUT_AVAILABLE: "OBJECT_INPUT_AVAILABLE",
  RELATIONSHIP_INPUT_AVAILABLE: "RELATIONSHIP_INPUT_AVAILABLE",
  FINDING_ONLY: "FINDING_ONLY",
  INPUT_UNAVAILABLE: "INPUT_UNAVAILABLE",
} as const;

export type ReconciliationInputStatus =
  (typeof RECONCILIATION_INPUT_STATUS)[keyof typeof RECONCILIATION_INPUT_STATUS];

export type ReconciliationInputRecovery =
  | {
      readonly status: "OBJECT_INPUT_AVAILABLE";
      readonly reviewSubject: ReviewSubject;
      readonly finding: DiscoveryFinding<CanonicalObjectKind>;
      readonly candidate: NormalizedObjectCandidate;
    }
  | {
      readonly status: "RELATIONSHIP_INPUT_AVAILABLE";
      readonly reviewSubject: ReviewSubject;
      readonly finding: RelationshipDiscoveryFinding;
      readonly candidate: NormalizedRelationshipCandidate;
    }
  | {
      readonly status: "FINDING_ONLY";
      readonly reviewSubject: ReviewSubject;
      readonly finding: DiscoveryFinding<DiscoveryCandidateKind>;
    }
  | {
      readonly status: "INPUT_UNAVAILABLE";
      readonly reviewSubject: ReviewSubject;
    };

export interface RecoverReconciliationInputParams {
  readonly reviewSubject: ReviewSubject;
  /** Already hash-verified by the caller (see persistence adapter); undefined means no durable Finding was ever recorded — the legacy/pre-milestone case. */
  readonly finding: DiscoveryFinding<DiscoveryCandidateKind> | undefined;
  /** Already hash-verified by the caller; undefined means no durable Candidate exists for this finding (the current, real state for every OBJECT-kind finding). */
  readonly candidate: NormalizedCandidate | undefined;
}

function assertIdSetSubset(
  citing: readonly string[],
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const id of citing) {
    if (!allowedSet.has(id)) {
      throw new SubjectMismatchError(`Recovered candidate cites ${label} ${id} that its recovered finding does not itself cite`);
    }
  }
}

/**
 * Recovers the exact reconciliation input for one ReviewSubject, or reports
 * why it is unavailable. Fails closed (throws SubjectMismatchError) on any
 * internal incoherence between the recovered rows — that is a persistence
 * defect or tampering, never a legitimate "missing" outcome — and only ever
 * returns INPUT_UNAVAILABLE for the one legitimate case: no durable Finding
 * was ever recorded for this ReviewSubject at all.
 */
export function recoverReconciliationInput(
  params: RecoverReconciliationInputParams,
): ReconciliationInputRecovery {
  const { reviewSubject, finding, candidate } = params;

  if (!finding) {
    return { status: RECONCILIATION_INPUT_STATUS.INPUT_UNAVAILABLE, reviewSubject };
  }

  if (finding.findingId !== reviewSubject.findingId) {
    throw new SubjectMismatchError("Recovered finding does not match the review subject's findingId");
  }
  if (finding.candidateKind !== reviewSubject.candidateKind) {
    throw new SubjectMismatchError("Recovered finding candidateKind does not match the review subject");
  }
  if (sourceObjectIdentityKey(finding.sourceObject) !== sourceObjectIdentityKey(reviewSubject.sourceObject)) {
    throw new SubjectMismatchError("Recovered finding sourceObject does not match the review subject");
  }

  if (!candidate) {
    return { status: RECONCILIATION_INPUT_STATUS.FINDING_ONLY, reviewSubject, finding };
  }

  if (candidate.findingId !== finding.findingId) {
    throw new SubjectMismatchError("Recovered candidate does not back the recovered finding");
  }
  if (candidate.candidateKind !== finding.candidateKind) {
    throw new SubjectMismatchError("Recovered candidate candidateKind does not match the recovered finding");
  }
  if (sourceObjectIdentityKey(candidate.sourceObject) !== sourceObjectIdentityKey(finding.sourceObject)) {
    throw new SubjectMismatchError("Recovered candidate sourceObject does not match the recovered finding");
  }
  assertIdSetSubset(candidate.assertionIds, finding.assertionIds, "assertionId");
  assertIdSetSubset(candidate.evidenceIds, finding.evidenceIds, "evidenceId");

  if (candidate.candidateKind === "RELATIONSHIP") {
    const relationshipCandidate = candidate as NormalizedRelationshipCandidate;
    for (const endpoint of [relationshipCandidate.sourceEndpoint, relationshipCandidate.targetEndpoint]) {
      if (endpoint.referenceKind === "SOURCE_OBJECT" && endpoint.sourceObject.connectionId !== finding.sourceObject.connectionId) {
        throw new SubjectMismatchError(
          "Recovered relationship candidate endpoint is anchored to a different source connection than the recovered finding",
        );
      }
    }
    return {
      status: RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE,
      reviewSubject,
      finding: finding as RelationshipDiscoveryFinding,
      candidate: relationshipCandidate,
    };
  }

  return {
    status: RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE,
    reviewSubject,
    finding: finding as DiscoveryFinding<CanonicalObjectKind>,
    candidate: candidate as NormalizedObjectCandidate,
  };
}
