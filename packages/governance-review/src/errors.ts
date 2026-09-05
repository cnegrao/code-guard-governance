import type { ReviewState } from "./review-state";

/** Base of every typed, deterministic failure this package can raise. Fail closed: an unrecognized situation must throw one of these, never silently proceed. */
export abstract class ReviewLifecycleError extends Error {
  abstract readonly code: string;
}

export class InvalidReviewTransitionError extends ReviewLifecycleError {
  readonly code = "INVALID_TRANSITION";
  readonly fromState: ReviewState;
  readonly attemptedState: ReviewState;

  constructor(fromState: ReviewState, attemptedState: ReviewState) {
    super(
      `Cannot transition review subject from ${fromState} to ${attemptedState}`,
    );
    this.name = "InvalidReviewTransitionError";
    this.fromState = fromState;
    this.attemptedState = attemptedState;
  }
}

/** Raised when a MACHINE (or absent) actor attempts a human-only transition. */
export class HumanActorRequiredError extends ReviewLifecycleError {
  readonly code = "HUMAN_ACTOR_REQUIRED";
  readonly transition: string;

  constructor(transition: string) {
    super(`Transition "${transition}" requires an explicit HUMAN actor`);
    this.name = "HumanActorRequiredError";
    this.transition = transition;
  }
}

/** Raised when an actor reference is present but malformed (e.g. a forged/empty actorReference). */
export class InvalidActorError extends ReviewLifecycleError {
  readonly code = "INVALID_ACTOR";

  constructor(message: string) {
    super(message);
    this.name = "InvalidActorError";
  }
}

export class MissingEvidenceError extends ReviewLifecycleError {
  readonly code = "MISSING_EVIDENCE";

  constructor() {
    super("Transition requires the review subject to carry at least one evidence reference");
    this.name = "MissingEvidenceError";
  }
}

/** Raised when cited evidence is not part of the review subject's own evidence (e.g. evidence belonging to another subject). */
export class EvidenceMismatchError extends ReviewLifecycleError {
  readonly code = "EVIDENCE_MISMATCH";

  constructor() {
    super("Cited evidence is not part of this review subject's evidence");
    this.name = "EvidenceMismatchError";
  }
}

export class SubjectMismatchError extends ReviewLifecycleError {
  readonly code = "SUBJECT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "SubjectMismatchError";
  }
}

export class ContextMismatchError extends ReviewLifecycleError {
  readonly code = "CONTEXT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "ContextMismatchError";
  }
}

/** Raised when a command's expectedState no longer matches the subject's actual state (and the command is not a recognized idempotent replay). */
export class StaleReviewStateError extends ReviewLifecycleError {
  readonly code = "STALE_STATE";
  readonly expected: ReviewState;
  readonly actual: ReviewState;

  constructor(expected: ReviewState, actual: ReviewState) {
    super(`Expected review subject state ${expected} but found ${actual}`);
    this.name = "StaleReviewStateError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class MissingReasonCodeError extends ReviewLifecycleError {
  readonly code = "MISSING_REASON_CODE";
  readonly transition: string;

  constructor(transition: string) {
    super(`Transition "${transition}" requires an explicit non-empty reasonCode`);
    this.name = "MissingReasonCodeError";
    this.transition = transition;
  }
}

/** Raised by the semantic proposal boundary when a finding is not eligible for a non-authoritative proposal. */
export class IneligibleFindingError extends ReviewLifecycleError {
  readonly code = "INELIGIBLE_FINDING";

  constructor(message: string) {
    super(message);
    this.name = "IneligibleFindingError";
  }
}

/**
 * Raised when the reconciliation gate is invoked against a ReviewSubject that
 * is not CERTIFIED. CERTIFIED is necessary but never sufficient on its own -
 * see AuthorizationPortRequiredError and AuthorizationDeniedError below.
 */
export class ReviewSubjectNotCertifiedError extends ReviewLifecycleError {
  readonly code = "REVIEW_SUBJECT_NOT_CERTIFIED";
  readonly actualState: ReviewState;

  constructor(actualState: ReviewState) {
    super(
      `Reconciliation requires a CERTIFIED review subject, but found ${actualState}`,
    );
    this.name = "ReviewSubjectNotCertifiedError";
    this.actualState = actualState;
  }
}

/**
 * Raised when a non-HUMAN (or otherwise absent) actor attempts to invoke
 * reconciliation. Machine authority can never authorize canonical
 * reconciliation, regardless of what a reasonCode or authorization result
 * claims.
 */
export class MachineAuthorityForbiddenError extends ReviewLifecycleError {
  readonly code = "MACHINE_AUTHORITY_FORBIDDEN";

  constructor() {
    super("Canonical reconciliation requires an explicit HUMAN actor; machine/deterministic-rule authority is never sufficient");
    this.name = "MachineAuthorityForbiddenError";
  }
}

/** Raised when no ReconciliationAuthorizationPort is supplied, or the port returns no usable result. Missing authorization always fails closed. */
export class AuthorizationPortRequiredError extends ReviewLifecycleError {
  readonly code = "AUTHORIZATION_PORT_REQUIRED";

  constructor() {
    super("Reconciliation requires a ReconciliationAuthorizationPort; there is no permissive default");
    this.name = "AuthorizationPortRequiredError";
  }
}

/** Raised when the authorization port returns an explicit DENY, or a result this gate cannot treat as an ALLOW. */
export class AuthorizationDeniedError extends ReviewLifecycleError {
  readonly code = "AUTHORIZATION_DENIED";

  constructor(message = "Reconciliation authorization was not granted") {
    super(message);
    this.name = "AuthorizationDeniedError";
  }
}

/** Raised when an ALLOW result's organisation/action/subject does not match what was actually requested - an ALLOW for a different scope is not an ALLOW here. */
export class AuthorizationScopeMismatchError extends ReviewLifecycleError {
  readonly code = "AUTHORIZATION_SCOPE_MISMATCH";
  readonly field: string;

  constructor(field: string) {
    super(`Authorization result ${field} does not match the requested reconciliation scope`);
    this.name = "AuthorizationScopeMismatchError";
    this.field = field;
  }
}

/** Raised when an ALLOW result's actorReference does not match the actor presented on the reconciliation command - identity alone is never authorization. */
export class ActorAuthorizationMismatchError extends ReviewLifecycleError {
  readonly code = "ACTOR_AUTHORIZATION_MISMATCH";

  constructor() {
    super("Authorization result actorReference does not match the reconciliation command's actor");
    this.name = "ActorAuthorizationMismatchError";
  }
}

/** Raised when a commandId is reused with materially different reconciliation content - idempotency keys must not be reused across differing commands. */
export class IdempotencyConflictError extends ReviewLifecycleError {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly commandId: string;

  constructor(commandId: string) {
    super(`commandId ${commandId} was already used for a different reconciliation command`);
    this.name = "IdempotencyConflictError";
    this.commandId = commandId;
  }
}

/** Wraps a rejection from a canonical-contracts reconciliation validator/factory. Canonical validators remain authoritative; this package never overrides their verdict. */
export class CanonicalReconciliationRejectedError extends ReviewLifecycleError {
  readonly code = "CANONICAL_RECONCILIATION_REJECTED";
  override readonly cause?: unknown;

  constructor(cause: unknown) {
    super(
      `Canonical reconciliation contract rejected the requested decision: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "CanonicalReconciliationRejectedError";
    this.cause = cause;
  }
}
