import "server-only";

import { RECONCILIATION_INPUT_STATUS, REVIEW_STATE, type ReconciliationInputStatus, type ReviewState } from "@council/governance-review";

/**
 * ReconciliationReadinessPolicy (Reconciliation & Materialization Workspace
 * V1). Pure, server-only projection — never invents a new governance state,
 * only derives a presentation-safe readiness verdict from facts the domain
 * package and persisted state already prove:
 *
 *   ReviewSubject.state (must be CERTIFIED — governance-review's own
 *   assertCertified rule, mirrored here only for presentation)
 *   + ReconciliationInputRecovery.status (packages/governance-review
 *     reconciliation-input-recovery.ts, closed)
 *   + whether a reconciliation decision / materialization already exists for
 *     this review subject (decision-query.ts).
 *
 * This is never implemented client-side: a browser is never trusted to
 * decide whether a subject is reconciliation-ready.
 */
export const RECONCILIATION_READINESS_REASON = {
  READY: "READY",
  NOT_CERTIFIED: "NOT_CERTIFIED",
  FINDING_ONLY: "FINDING_ONLY",
  INPUT_UNAVAILABLE: "INPUT_UNAVAILABLE",
  ALREADY_RECONCILED: "ALREADY_RECONCILED",
  ALREADY_MATERIALIZED: "ALREADY_MATERIALIZED",
} as const;
export type ReconciliationReadinessReason =
  (typeof RECONCILIATION_READINESS_REASON)[keyof typeof RECONCILIATION_READINESS_REASON];

export interface ReconciliationReadiness {
  readonly ready: boolean;
  readonly reason: ReconciliationReadinessReason;
}

export interface DeriveReconciliationReadinessInput {
  readonly reviewState: ReviewState;
  readonly recoveryStatus: ReconciliationInputStatus;
  readonly hasExistingReconciliationDecision: boolean;
  readonly isMaterializedApplied: boolean;
}

export function deriveReconciliationReadiness(
  input: DeriveReconciliationReadinessInput,
): ReconciliationReadiness {
  if (input.reviewState !== REVIEW_STATE.CERTIFIED) {
    return { ready: false, reason: RECONCILIATION_READINESS_REASON.NOT_CERTIFIED };
  }
  if (input.isMaterializedApplied) {
    return { ready: false, reason: RECONCILIATION_READINESS_REASON.ALREADY_MATERIALIZED };
  }
  if (input.hasExistingReconciliationDecision) {
    return { ready: false, reason: RECONCILIATION_READINESS_REASON.ALREADY_RECONCILED };
  }
  if (input.recoveryStatus === RECONCILIATION_INPUT_STATUS.FINDING_ONLY) {
    return { ready: false, reason: RECONCILIATION_READINESS_REASON.FINDING_ONLY };
  }
  if (input.recoveryStatus === RECONCILIATION_INPUT_STATUS.INPUT_UNAVAILABLE) {
    return { ready: false, reason: RECONCILIATION_READINESS_REASON.INPUT_UNAVAILABLE };
  }
  return { ready: true, reason: RECONCILIATION_READINESS_REASON.READY };
}
