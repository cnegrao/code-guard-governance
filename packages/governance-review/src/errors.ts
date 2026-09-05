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
