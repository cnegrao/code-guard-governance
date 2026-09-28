import "server-only";

import { REJECTABLE_REVIEW_STATES, REVIEW_STATE, type ReviewState } from "@council/governance-review";

/**
 * Read-only derivation of "what governance actions are currently allowed" for
 * one ReviewSubject. This is new code built on top of the existing, closed
 * governance-review state machine (packages/governance-review/src/transitions.ts) —
 * it never encodes a transition rule the domain package does not already
 * enforce; it only projects those same rules for the UI to consume, so a
 * button can be disabled/hidden without the client having to guess.
 */
export interface AllowedGovernanceActions {
  readonly canPropose: boolean;
  readonly canConfirm: boolean;
  readonly canCertify: boolean;
  readonly canReject: boolean;
}

export const NO_ALLOWED_GOVERNANCE_ACTIONS: AllowedGovernanceActions = Object.freeze({
  canPropose: false,
  canConfirm: false,
  canCertify: false,
  canReject: false,
});

export function deriveAllowedGovernanceActions(
  state: ReviewState,
  hasReviewAuthority: boolean,
): AllowedGovernanceActions {
  if (!hasReviewAuthority) return NO_ALLOWED_GOVERNANCE_ACTIONS;
  return Object.freeze({
    canPropose: state === REVIEW_STATE.DETECTED,
    canConfirm: state === REVIEW_STATE.PROPOSED,
    canCertify: state === REVIEW_STATE.CONFIRMED,
    canReject: REJECTABLE_REVIEW_STATES.has(state),
  });
}

/** Existing coarse reviewer ceiling. The input must come from
 * resolveCurrentGovernanceRole's current persisted assignments, never a JWT
 * or caller value. Per-transition L14 policy is outside this slice. */
const GOVERNANCE_REVIEWER_ROLE = "org_admin";

export function hasGovernanceReviewAuthority(currentRole: string): boolean {
  return currentRole === GOVERNANCE_REVIEWER_ROLE;
}
