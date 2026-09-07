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

/**
 * Current coarse authority ceiling: the dashboard's session JWT carries a
 * single verified role ("org_admin" | "user"), resolved fail-closed at login
 * from a persisted GOVERNANCE_ADMIN system role
 * (apps/dashboard/lib/auth/legacy-authorization.ts). There is no
 * per-transition permission model wired at this layer today, and building
 * one is out of this milestone's scope (broad RBAC redesign) — so every
 * human governance review action (propose/confirm/certify/reject) is gated
 * on this same verified role, never on an unverified client-supplied value.
 */
const GOVERNANCE_REVIEWER_ROLE = "org_admin";

export function hasGovernanceReviewAuthority(sessionRole: string): boolean {
  return sessionRole === GOVERNANCE_REVIEWER_ROLE;
}
