/**
 * Governance lifecycle for a ReviewSubject.
 *
 * This is deliberately distinct from canonical-contracts' FindingReviewStatus
 * and does not duplicate it: FindingReviewStatus labels the trust of a
 * DiscoveryFinding itself (UNREVIEWED/ACCEPTED/REJECTED/DUPLICATE/SUPERSEDED)
 * and that field is never mutated by this package. ReviewState instead
 * tracks this package's stricter, actor-gated workflow that a finding travels
 * through on its way to becoming eligible for reconciliation
 * (ReconciliationDecision remains the sole authority that creates canonical
 * objects/relationships; this package never invokes it).
 */
export const REVIEW_STATE = {
  DETECTED: "DETECTED",
  PROPOSED: "PROPOSED",
  CONFIRMED: "CONFIRMED",
  CERTIFIED: "CERTIFIED",
  REJECTED: "REJECTED",
} as const;

export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];

/** CERTIFIED and REJECTED are terminal: no further transition is valid. */
export const TERMINAL_REVIEW_STATES: ReadonlySet<ReviewState> = new Set([
  REVIEW_STATE.CERTIFIED,
  REVIEW_STATE.REJECTED,
]);

/** States a reject command may be applied from. */
export const REJECTABLE_REVIEW_STATES: ReadonlySet<ReviewState> = new Set([
  REVIEW_STATE.DETECTED,
  REVIEW_STATE.PROPOSED,
  REVIEW_STATE.CONFIRMED,
]);
