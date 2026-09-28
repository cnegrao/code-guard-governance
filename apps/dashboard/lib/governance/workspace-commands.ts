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
import { deriveAllowedGovernanceActions } from "./workspace-actions";
import { GovernedWriteError } from "./governed-write-errors";
import type { GovernanceWritePrincipal } from "../auth/governance-write-principal";

/**
 * Governance Workspace command side (CQRS write path). This module is the
 * ONLY place the dashboard invokes the closed governance-review human
 * transitions (confirm/certify/reject) and the human-eligible branch of
 * propose. It never invents a transition the domain package does not
 * already expose, and it never accepts organisationId, actor identity, or a
 * target state from the client — every one of those is server-derived
 * (organisationId, actorUserId, writePrincipal) or a fixed semantic action
 * name mapped in code to one specific domain function.
 *
 * M16-S0.3.3C-R1: current-role authority is NOT decided here. State-
 * transition validity remains enforced domain logic; the sole write
 * authority is apply_review_transition_governed_v1's own transactional
 * require_governed_write_eligibility_v1 check (GV006 otherwise).
 */

export type GovernanceActionName = "PROPOSE" | "CONFIRM" | "CERTIFY" | "REJECT";

export interface ExecuteGovernanceActionInput {
  /** Server-derived from the trusted session context — never client-supplied. */
  readonly organisationId: OrganisationId;
  /** Server-derived from the trusted session context — never client-supplied. */
  readonly actorUserId: string;
  /** Server-derived from the trusted verified session — never client-supplied.
   * The route already binds this into the governed `port` it passes explicitly;
   * carried here too only so callers/tests can observe it uniformly with the
   * other four governed routes, never independently trusted by this function. */
  readonly writePrincipal: GovernanceWritePrincipal;
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

  // M16-S0.3.3C-R1: current-role authority is decided transactionally by the
  // governed DB wrapper (GV006 otherwise), never here. Passing true
  // unconditionally yields pure state-transition validity, decoupled from
  // any role read — deriveAllowedGovernanceActions(state, false) would
  // otherwise deny every action regardless of state.
  const allowed = deriveAllowedGovernanceActions(subject.state, true);
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
    // M16-S0.3.3C-R1: ONLY the two explicitly known business conflicts from
    // apply_review_transition(_governed_v1)'s own contract become a
    // structured outcome here, classified by exact SQLSTATE — never by a
    // substring match against arbitrary DB diagnostics. Everything else,
    // including any unrecognized GovernedWriteError code (security,
    // infrastructure, unexpected catalog/permission failures) and any
    // non-DB transport error, propagates unchanged: the route maps a
    // recognized GV*/55P03 code to its frozen class and anything else to a
    // generic 500. Never a blanket PERSISTENCE_CONFLICT.
    if (error instanceof GovernedWriteError) {
      // The RPC's own SELECT ... FOR UPDATE + previous-state precondition
      // (Governance Persistence V1, closed) is the true concurrency backstop
      // for a genuine DB-level race between two simultaneous submissions;
      // this never overwrites and never applies a false success.
      if (error.code === "40001") {
        const refreshed = await port.getReviewSubject(input.organisationId, input.reviewSubjectId);
        return { kind: "STALE_REVIEW_SUBJECT", currentState: refreshed?.state ?? subject.state };
      }
      // A reused commandId with materially different content (Governance
      // Persistence V1's own idempotency guard) is a genuine, expected
      // business conflict, never a false success.
      if (error.code === "23514" && error.message.includes("IDEMPOTENCY_CONFLICT")) {
        return { kind: "PERSISTENCE_CONFLICT", message: "Unable to record the governance decision. Please retry." };
      }
    }
    throw error;
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
