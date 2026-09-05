import { createHash } from "node:crypto";

import {
  RECONCILIATION_AUTHORITY_KIND,
  type DiscoveryFindingId,
  type EvidenceId,
  type IsoTimestamp,
  type OrganisationId,
  type ReconciliationAuthority,
} from "@council/canonical-contracts";

import {
  ContextMismatchError,
  EvidenceMismatchError,
  HumanActorRequiredError,
  InvalidActorError,
  InvalidReviewTransitionError,
  MissingEvidenceError,
  MissingReasonCodeError,
  StaleReviewStateError,
  SubjectMismatchError,
} from "./errors";
import { asReviewTransitionId } from "./identifiers";
import {
  REJECTABLE_REVIEW_STATES,
  REVIEW_STATE,
  type ReviewState,
} from "./review-state";
import type { ReviewAuditEvent, ReviewSubject } from "./review-subject";

/** Every transition command shares this shape; the fields exist specifically so validation can catch the adversarial cases this domain must fail closed against. */
export interface TransitionCommandBase {
  /** Caller-supplied idempotency key: replaying the same commandId against the subject it produced is a no-op, never a second transition. */
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly findingId: DiscoveryFindingId;
  /** Optimistic-concurrency guard against a stale previous state. */
  readonly expectedState: ReviewState;
  readonly actor: ReconciliationAuthority;
  readonly occurredAt: IsoTimestamp;
  /** Evidence cited for this decision; if supplied, must be a subset of the subject's own evidenceIds. */
  readonly evidenceIds?: readonly EvidenceId[];
  readonly reasonCode?: string;
}

export type ProposeCommand = TransitionCommandBase;
export type ConfirmCommand = TransitionCommandBase;
export type CertifyCommand = TransitionCommandBase & { readonly reasonCode: string };
export type RejectCommand = TransitionCommandBase & { readonly reasonCode: string };

export type TransitionResult =
  | { readonly kind: "APPLIED"; readonly subject: ReviewSubject; readonly event: ReviewAuditEvent }
  | { readonly kind: "REPLAYED"; readonly subject: ReviewSubject; readonly event: ReviewAuditEvent };

function stableSuffix(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function isHuman(actor: ReconciliationAuthority): boolean {
  return actor.authorityKind === RECONCILIATION_AUTHORITY_KIND.HUMAN;
}

function validateActorShape(actor: ReconciliationAuthority): void {
  if (!actor || typeof actor !== "object") {
    throw new InvalidActorError("Transition actor must be present");
  }
  if (actor.authorityKind === RECONCILIATION_AUTHORITY_KIND.HUMAN) {
    if (!actor.actorReference || actor.actorReference.trim().length === 0) {
      throw new InvalidActorError("HUMAN actor requires a non-empty actorReference");
    }
    return;
  }
  if (actor.authorityKind === RECONCILIATION_AUTHORITY_KIND.DETERMINISTIC_RULE) {
    if (!actor.ruleCode || actor.ruleCode.trim().length === 0 || !actor.ruleVersion || actor.ruleVersion.trim().length === 0) {
      throw new InvalidActorError("DETERMINISTIC_RULE actor requires a non-empty ruleCode and ruleVersion");
    }
    return;
  }
  throw new InvalidActorError("Transition actor has an unrecognized authorityKind");
}

function checkReplay(
  subject: ReviewSubject,
  command: TransitionCommandBase,
): TransitionResult | undefined {
  if (subject.lastTransition && subject.lastTransition.commandId === command.commandId) {
    return { kind: "REPLAYED", subject, event: subject.lastTransition };
  }
  return undefined;
}

function validateCommon(subject: ReviewSubject, command: TransitionCommandBase): void {
  validateActorShape(command.actor);

  if (command.organisationId !== subject.organisationId) {
    throw new ContextMismatchError(
      `Command organisationId does not match review subject ${subject.reviewSubjectId}`,
    );
  }
  if (command.findingId !== subject.findingId) {
    throw new SubjectMismatchError(
      `Command findingId does not match review subject ${subject.reviewSubjectId}`,
    );
  }
  if (command.expectedState !== subject.state) {
    throw new StaleReviewStateError(command.expectedState, subject.state);
  }
  if (command.evidenceIds) {
    const allowed = new Set(subject.evidenceIds);
    for (const evidenceId of command.evidenceIds) {
      if (!allowed.has(evidenceId)) {
        throw new EvidenceMismatchError();
      }
    }
  }
}

function applyTransition(
  subject: ReviewSubject,
  command: TransitionCommandBase,
  toState: ReviewState,
): TransitionResult {
  const event: ReviewAuditEvent = Object.freeze({
    eventId: asReviewTransitionId(
      `review-transition:${stableSuffix([
        subject.reviewSubjectId,
        command.commandId,
        subject.state,
        toState,
      ])}`,
    ),
    reviewSubjectId: subject.reviewSubjectId,
    findingId: subject.findingId,
    organisationId: subject.organisationId,
    previousState: subject.state,
    newState: toState,
    actor: command.actor,
    occurredAt: command.occurredAt,
    evidenceIds: Object.freeze([...(command.evidenceIds ?? subject.evidenceIds)]),
    ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
    commandId: command.commandId,
  });

  const nextSubject: ReviewSubject = Object.freeze({
    ...subject,
    state: toState,
    lastTransition: event,
  });

  return { kind: "APPLIED", subject: nextSubject, event };
}

/**
 * DETECTED -> PROPOSED. Machine-assisted: the actor may be HUMAN or
 * DETERMINISTIC_RULE (see semantic-proposal-strategy.ts). A proposal is
 * still non-authoritative regardless of who/what proposes it.
 */
export function propose(subject: ReviewSubject, command: ProposeCommand): TransitionResult {
  const replay = checkReplay(subject, command);
  if (replay) return replay;

  validateCommon(subject, command);

  if (subject.state !== REVIEW_STATE.DETECTED) {
    throw new InvalidReviewTransitionError(subject.state, REVIEW_STATE.PROPOSED);
  }

  return applyTransition(subject, command, REVIEW_STATE.PROPOSED);
}

/**
 * PROPOSED -> CONFIRMED. Requires an explicit HUMAN actor and at least one
 * evidence reference; machine code MUST NOT confirm.
 */
export function confirm(subject: ReviewSubject, command: ConfirmCommand): TransitionResult {
  const replay = checkReplay(subject, command);
  if (replay) return replay;

  validateCommon(subject, command);

  if (subject.state !== REVIEW_STATE.PROPOSED) {
    throw new InvalidReviewTransitionError(subject.state, REVIEW_STATE.CONFIRMED);
  }
  if (!isHuman(command.actor)) {
    throw new HumanActorRequiredError("confirm");
  }
  if (subject.evidenceIds.length === 0) {
    throw new MissingEvidenceError();
  }

  return applyTransition(subject, command, REVIEW_STATE.CONFIRMED);
}

/**
 * CONFIRMED -> CERTIFIED. Requires an explicit, *authorized* HUMAN action:
 * beyond the HUMAN-actor and evidence requirements shared with confirm, an
 * explicit non-empty reasonCode is mandatory - the recorded authorization
 * basis for turning a confirmed finding into one certified for
 * reconciliation. Machine code MUST NOT certify.
 */
export function certify(subject: ReviewSubject, command: CertifyCommand): TransitionResult {
  const replay = checkReplay(subject, command);
  if (replay) return replay;

  validateCommon(subject, command);

  if (subject.state !== REVIEW_STATE.CONFIRMED) {
    throw new InvalidReviewTransitionError(subject.state, REVIEW_STATE.CERTIFIED);
  }
  if (!isHuman(command.actor)) {
    throw new HumanActorRequiredError("certify");
  }
  if (subject.evidenceIds.length === 0) {
    throw new MissingEvidenceError();
  }
  if (!command.reasonCode || command.reasonCode.trim().length === 0) {
    throw new MissingReasonCodeError("certify");
  }

  return applyTransition(subject, command, REVIEW_STATE.CERTIFIED);
}

/**
 * DETECTED | PROPOSED | CONFIRMED -> REJECTED. An explicit negative outcome;
 * requires an explicit HUMAN actor and a non-empty reasonCode. REJECTED is
 * terminal: rejecting is itself a governance decision, so it is human-gated
 * exactly like confirm/certify (machine code may detect/propose but never
 * render any authoritative verdict, positive or negative).
 */
export function reject(subject: ReviewSubject, command: RejectCommand): TransitionResult {
  const replay = checkReplay(subject, command);
  if (replay) return replay;

  validateCommon(subject, command);

  if (!REJECTABLE_REVIEW_STATES.has(subject.state)) {
    throw new InvalidReviewTransitionError(subject.state, REVIEW_STATE.REJECTED);
  }
  if (!isHuman(command.actor)) {
    throw new HumanActorRequiredError("reject");
  }
  if (!command.reasonCode || command.reasonCode.trim().length === 0) {
    throw new MissingReasonCodeError("reject");
  }

  return applyTransition(subject, command, REVIEW_STATE.REJECTED);
}
