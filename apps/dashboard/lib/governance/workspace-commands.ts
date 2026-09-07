import "server-only";
import { randomUUID } from "node:crypto";

import { RECONCILIATION_AUTHORITY_KIND, asIsoTimestamp, type OrganisationId } from "@council/canonical-contracts";
import {
  HumanActorRequiredError,
  InvalidActorError,
  InvalidReviewTransitionError,
  MissingEvidenceError,
  MissingReasonCodeError,
  StaleReviewStateError,
  certify,
  confirm,
  propose,
  reject,
  type GovernanceReviewPersistencePort,
  type ReviewState,
  type ReviewSubject,
  type ReviewSubjectId,
  type TransitionCommandBase,
} from "@council/governance-review";

import { governanceReviewPersistence } from "./persistence";
import { deriveAllowedGovernanceActions, hasGovernanceReviewAuthority } from "./workspace-actions";

/**
 * Governance Workspace command side (CQRS write path). This module is the
 * ONLY place the dashboard invokes the closed governance-review human
 * transitions (confirm/certify/reject) and the human-eligible branch of
 * propose. It never invents a transition the domain package does not
 * already expose, and it never accepts organisationId, actor identity, or a
 * target state from the client — every one of those is either server-derived
 * (organisationId, actorUserId, sessionRole) or a fixed semantic action name
 * mapped in code to one specific domain function.
 */

export type GovernanceActionName = "PROPOSE" | "CONFIRM" | "CERTIFY" | "REJECT";

export interface ExecuteGovernanceActionInput {
  /** Server-derived from the trusted session context — never client-supplied. */
  readonly organisationId: OrganisationId;
  /** Server-derived from the trusted session context — never client-supplied. */
  readonly actorUserId: string;
  /** Server-derived from the trusted session context — never client-supplied. */
  readonly sessionRole: string;
  readonly reviewSubjectId: ReviewSubjectId;
  /** The state the client observed when it loaded the screen — the optimistic-concurrency precondition. */
  readonly expectedState: ReviewState;
  readonly reasonCode?: string;
}

export type GovernanceActionOutcome =
  | { readonly kind: "APPLIED"; readonly subject: ReviewSubject }
  | { readonly kind: "REPLAYED"; readonly subject: ReviewSubject }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "FORBIDDEN"; readonly message: string }
  | { readonly kind: "STALE_REVIEW_SUBJECT"; readonly currentState: ReviewState }
  | { readonly kind: "INVALID_TRANSITION"; readonly message: string }
  | { readonly kind: "PERSISTENCE_CONFLICT"; readonly message: string };

const ACTION_FLAG: Record<GovernanceActionName, keyof AllowedFlags> = {
  PROPOSE: "canPropose",
  CONFIRM: "canConfirm",
  CERTIFY: "canCertify",
  REJECT: "canReject",
};

type AllowedFlags = ReturnType<typeof deriveAllowedGovernanceActions>;

const ACTION_REQUIRES_REASON: Record<GovernanceActionName, boolean> = {
  PROPOSE: false,
  CONFIRM: false,
  CERTIFY: true,
  REJECT: true,
};

function buildBaseCommand(input: ExecuteGovernanceActionInput, subject: ReviewSubject): TransitionCommandBase {
  return {
    commandId: `cmd:governance-workspace:${randomUUID()}`,
    organisationId: input.organisationId,
    findingId: subject.findingId,
    expectedState: subject.state,
    actor: { authorityKind: RECONCILIATION_AUTHORITY_KIND.HUMAN, actorReference: input.actorUserId },
    occurredAt: asIsoTimestamp(new Date().toISOString()),
  };
}

function runTransition(action: GovernanceActionName, subject: ReviewSubject, input: ExecuteGovernanceActionInput) {
  const base = buildBaseCommand(input, subject);
  switch (action) {
    case "PROPOSE":
      return propose(subject, base);
    case "CONFIRM":
      return confirm(subject, base);
    case "CERTIFY":
      return certify(subject, { ...base, reasonCode: input.reasonCode! });
    case "REJECT":
      return reject(subject, { ...base, reasonCode: input.reasonCode! });
  }
}

async function executeGovernanceAction(
  action: GovernanceActionName,
  input: ExecuteGovernanceActionInput,
  port: GovernanceReviewPersistencePort = governanceReviewPersistence,
): Promise<GovernanceActionOutcome> {
  const subject = await port.getReviewSubject(input.organisationId, input.reviewSubjectId);
  if (!subject) return { kind: "NOT_FOUND" };

  // Optimistic concurrency: the client's belief about the current state must
  // still hold. A mismatch means another operator (or another tab) already
  // changed this review subject — never overwrite; tell the caller to refresh.
  if (subject.state !== input.expectedState) {
    return { kind: "STALE_REVIEW_SUBJECT", currentState: subject.state };
  }

  const hasAuthority = hasGovernanceReviewAuthority(input.sessionRole);
  if (!hasAuthority) {
    return { kind: "FORBIDDEN", message: "Your role does not permit governance review actions." };
  }

  const allowed = deriveAllowedGovernanceActions(subject.state, hasAuthority);
  if (!allowed[ACTION_FLAG[action]]) {
    return {
      kind: "INVALID_TRANSITION",
      message: `Action ${action} is not currently available for review subject state ${subject.state}.`,
    };
  }

  if (ACTION_REQUIRES_REASON[action] && (!input.reasonCode || input.reasonCode.trim().length === 0)) {
    return { kind: "INVALID_TRANSITION", message: `Action ${action} requires a non-empty reason.` };
  }

  let result;
  try {
    result = runTransition(action, subject, input);
  } catch (error) {
    if (error instanceof StaleReviewStateError) {
      return { kind: "STALE_REVIEW_SUBJECT", currentState: error.actual };
    }
    if (error instanceof InvalidReviewTransitionError) {
      return { kind: "INVALID_TRANSITION", message: error.message };
    }
    if (error instanceof HumanActorRequiredError || error instanceof InvalidActorError) {
      return { kind: "FORBIDDEN", message: error.message };
    }
    if (error instanceof MissingEvidenceError || error instanceof MissingReasonCodeError) {
      return { kind: "INVALID_TRANSITION", message: error.message };
    }
    throw error;
  }

  try {
    const persisted = await port.persistReviewTransition(result);
    return { kind: persisted.replay ? "REPLAYED" : "APPLIED", subject: persisted.subject };
  } catch (error) {
    // The RPC's own SELECT ... FOR UPDATE + previous-state precondition
    // (Governance Persistence V1, closed) is the true concurrency backstop
    // for a genuine DB-level race between two simultaneous submissions; this
    // never overwrites and never applies a false success.
    const message = error instanceof Error ? error.message : String(error);
    if (/stale review state/i.test(message)) {
      const refreshed = await port.getReviewSubject(input.organisationId, input.reviewSubjectId);
      return { kind: "STALE_REVIEW_SUBJECT", currentState: refreshed?.state ?? subject.state };
    }
    return { kind: "PERSISTENCE_CONFLICT", message: "Unable to record the governance decision." };
  }
}

export const workspaceCommands = {
  proposeReview: (input: ExecuteGovernanceActionInput, port?: GovernanceReviewPersistencePort) =>
    executeGovernanceAction("PROPOSE", input, port),
  confirmReview: (input: ExecuteGovernanceActionInput, port?: GovernanceReviewPersistencePort) =>
    executeGovernanceAction("CONFIRM", input, port),
  certifyReview: (input: ExecuteGovernanceActionInput, port?: GovernanceReviewPersistencePort) =>
    executeGovernanceAction("CERTIFY", input, port),
  rejectReview: (input: ExecuteGovernanceActionInput, port?: GovernanceReviewPersistencePort) =>
    executeGovernanceAction("REJECT", input, port),
};
