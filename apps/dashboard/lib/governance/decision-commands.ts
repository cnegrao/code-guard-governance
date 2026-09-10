import "server-only";
import { createHash } from "node:crypto";

import { asCanonicalObjectId, asIsoTimestamp, type OrganisationId } from "@council/canonical-contracts";
import {
  ActorAuthorizationMismatchError,
  AuthorizationDeniedError,
  AuthorizationPortRequiredError,
  AuthorizationScopeMismatchError,
  CanonicalReconciliationRejectedError,
  ContextMismatchError,
  EvidenceMismatchError,
  IdempotencyConflictError,
  MachineAuthorityForbiddenError,
  RECONCILIATION_INPUT_STATUS,
  ReviewSubjectNotCertifiedError,
  SubjectMismatchError,
  invokeObjectReconciliation,
  invokeRelationshipReconciliation,
  type ObjectReconciliationInvocationCommand,
  type ObjectReconciliationRequestedDecision,
  type RelationshipReconciliationRequestedDecision,
  type ReviewSubjectId,
} from "@council/governance-review";
import {
  MaterializationAuthorityError,
  materializeReconciliationDecision,
  type MaterializationApplicationResult,
} from "@council/governance-review";

import { assertLegacyObjectCompatibility, LegacyObjectMappingConflict } from "./legacy-object-mapping";
import { canonicalEndpointResolution, relationshipRequestedDecision, objectMappingIdentity } from "./relationship-resolution";
import { governanceReviewPersistence } from "./persistence";
import { materializationPersistence } from "./materialization";
import { getReconciliationInputForReviewSubject } from "./reconciliation-input";
import { createSessionReconciliationAuthorizationPort } from "./reconciliation-authorization-port";
import { getCanonicalObjectForMatch } from "./canonical-object-lookup";
import { hasGovernanceReviewAuthority } from "./workspace-actions";
import { deriveReconciliationReadiness, type ReconciliationReadinessReason } from "./reconciliation-readiness";
import { findReconciliationDecisionIdForReviewSubject, findMaterializationForDecision } from "./decision-query";

/**
 * GovernanceDecisionCommandService (Reconciliation & Materialization
 * Workspace V1) — CQRS write side. Server-only. The ONLY place the dashboard
 * invokes the closed Authorized Reconciliation Gate
 * (invokeObjectReconciliation / invokeRelationshipReconciliation) and the
 * closed Canonical Materialization gate (materializeReconciliationDecision).
 *
 * Mirrors workspace-commands.ts's own discipline exactly: organisationId,
 * actor identity, and session role are always server-derived, never
 * client-supplied; the client submits only a semantic requested outcome
 * (CREATE_NEW/MATCH_EXISTING/REJECT/DEFER) plus, for MATCH_EXISTING, a
 * candidate target id that is independently re-verified server-side
 * (getCanonicalObjectForMatch) before it can be used — never trusted merely
 * because the client sent it.
 */

export type RequestedReconciliationOutcome = "CREATE_NEW" | "MATCH_EXISTING" | "REJECT" | "DEFER";

export interface SubmitReconciliationDecisionInput {
  readonly organisationId: OrganisationId;
  readonly actorUserId: string;
  readonly sessionRole: string;
  readonly reviewSubjectId: ReviewSubjectId;
  readonly requestedOutcome: RequestedReconciliationOutcome;
  /** Required only for MATCH_EXISTING; re-verified against gov_repo.canonical_objects before use. */
  readonly matchCanonicalObjectId?: string;
  readonly matchCanonicalRelationshipId?: string;
  readonly reasonCode: string;
}

export type SubmitReconciliationDecisionOutcome =
  | { readonly kind: "APPLIED" | "REPLAYED"; readonly reconciliationDecisionId: string; readonly outcome: RequestedReconciliationOutcome }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "FORBIDDEN"; readonly message: string }
  | { readonly kind: "NOT_READY"; readonly reason: ReconciliationReadinessReason }
  | { readonly kind: "INVALID_REQUEST"; readonly message: string }
  | { readonly kind: "PERSISTENCE_CONFLICT"; readonly message: string };

function stableCommandId(parts: readonly unknown[]): string {
  return `cmd:decision-workspace:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export async function submitReconciliationDecision(
  input: SubmitReconciliationDecisionInput,
): Promise<SubmitReconciliationDecisionOutcome> {
  const hasAuthority = hasGovernanceReviewAuthority(input.sessionRole);
  if (!hasAuthority) {
    return { kind: "FORBIDDEN", message: "Your role does not permit reconciliation actions." };
  }

  const subject = await governanceReviewPersistence.getReviewSubject(input.organisationId, input.reviewSubjectId);
  if (!subject) return { kind: "NOT_FOUND" };

  const recovery = await getReconciliationInputForReviewSubject(input.organisationId, subject);
  const existingDecisionId = await findReconciliationDecisionIdForReviewSubject(input.organisationId, input.reviewSubjectId);
  const materialization = existingDecisionId
    ? await findMaterializationForDecision(input.organisationId, existingDecisionId)
    : undefined;

  if (existingDecisionId && recovery.status === RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE) {
    const chain = await governanceReviewPersistence.getReconciliationAuditChain(input.organisationId, existingDecisionId);
    const decision = chain?.family === "RELATIONSHIP" ? chain.decision as import("@council/canonical-contracts").RelationshipReconciliationDecision : undefined;
    if (decision && decision.organisationId === input.organisationId && decision.decisionId === existingDecisionId &&
        decision.relationshipCandidateId === recovery.candidate.candidateId && decision.outcome === input.requestedOutcome &&
        decision.reasonCode === input.reasonCode && decision.authority.authorityKind === "HUMAN" &&
        decision.authority.actorReference === input.actorUserId &&
        (decision.outcome !== "MATCH_EXISTING" || decision.matchedState.relationshipId === input.matchCanonicalRelationshipId)) {
      return { kind: "REPLAYED", reconciliationDecisionId: existingDecisionId, outcome: input.requestedOutcome };
    }
    return { kind: "PERSISTENCE_CONFLICT", message: "This relationship review already has a different finalized decision." };
  }

  // Read-before-write concurrency guard: another operator (or another tab)
  // may already have reconciled or materialized this exact review subject
  // since the screen was loaded. Never issue a second reconciliation command
  // against a subject that already has one.
  const readiness = deriveReconciliationReadiness({
    reviewState: subject.state,
    recoveryStatus: recovery.status,
    hasExistingReconciliationDecision: !!existingDecisionId,
    isMaterializedApplied: materialization?.status === "APPLIED",
  });
  if (!readiness.ready) {
    return { kind: "NOT_READY", reason: readiness.reason };
  }

  if (!input.reasonCode || input.reasonCode.trim().length === 0) {
    return { kind: "INVALID_REQUEST", message: "A non-empty reasonCode is required." };
  }

  const requestedAt = asIsoTimestamp(new Date().toISOString());
  const actor = { authorityKind: "HUMAN" as const, actorReference: input.actorUserId };
  const authorizationPort = createSessionReconciliationAuthorizationPort({
    organisationId: input.organisationId,
    actorReference: input.actorUserId,
  });

  try {
    if (recovery.status === RECONCILIATION_INPUT_STATUS.RELATIONSHIP_INPUT_AVAILABLE) {
      const requestedDecision: RelationshipReconciliationRequestedDecision =
        input.requestedOutcome === "CREATE_NEW" || input.requestedOutcome === "MATCH_EXISTING"
          ? await relationshipRequestedDecision(input.organisationId, recovery.candidate, input.requestedOutcome, requestedAt, input.matchCanonicalRelationshipId)
          : { outcome: input.requestedOutcome };
      const commandId = stableCommandId([
        "RELATIONSHIP",
        input.organisationId,
        input.reviewSubjectId,
        input.requestedOutcome,
        input.reasonCode,
        input.actorUserId,
        input.matchCanonicalRelationshipId ?? null,
      ]);

      const result = await invokeRelationshipReconciliation({
        endpointResolution: canonicalEndpointResolution,
        commandId,
        organisationId: input.organisationId,
        reviewSubject: recovery.reviewSubject,
        finding: recovery.finding,
        candidate: recovery.candidate,
        actor,
        authorizationPort,
        reasonCode: input.reasonCode,
        requestedAt,
        requestedDecision,
      });

      const persisted = await governanceReviewPersistence.persistAuthorizedReconciliation({
        family: "RELATIONSHIP",
        decision: result.decision,
        authorization: result.authorization,
        invocation: result.audit,
      });

      return {
        kind: persisted.replay ? "REPLAYED" : "APPLIED",
        reconciliationDecisionId: persisted.reconciliationDecisionId,
        outcome: input.requestedOutcome,
      };
    }

    if (recovery.status !== RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE) {
      return { kind: "NOT_READY", reason: readiness.reason };
    }

    const candidate = recovery.candidate;
    const subjectRef = {
      subjectKind: "CANDIDATE" as const,
      candidateId: candidate.candidateId,
      candidateKind: candidate.candidateKind,
    };

    if (input.requestedOutcome === "CREATE_NEW" || input.requestedOutcome === "MATCH_EXISTING") {
      await assertLegacyObjectCompatibility(input.organisationId, candidate, input.requestedOutcome, input.matchCanonicalObjectId);
    }
    let requestedDecision: ObjectReconciliationRequestedDecision;
    if (input.requestedOutcome === "CREATE_NEW") {
      const normalizedIdentity = await objectMappingIdentity(input.organisationId, candidate);
      const objectId = asCanonicalObjectId(
        `canonical-object:${createHash("sha256")
          .update(JSON.stringify([input.organisationId, candidate.sourceObject.connectionId, candidate.sourceObject.externalType, candidate.sourceObject.externalId, candidate.candidateKind, normalizedIdentity]))
          .digest("hex")}`,
      );
      requestedDecision = {
        outcome: "CREATE_NEW",
        subject: subjectRef,
        canonicalObject: { organisationId: input.organisationId, objectId, kind: candidate.candidateKind },
      };
    } else if (input.requestedOutcome === "MATCH_EXISTING") {
      if (!input.matchCanonicalObjectId) {
        return { kind: "INVALID_REQUEST", message: "MATCH_EXISTING requires a matchCanonicalObjectId." };
      }
      const existing = await getCanonicalObjectForMatch(
        input.organisationId,
        candidate.candidateKind,
        input.matchCanonicalObjectId,
      );
      if (!existing) {
        return {
          kind: "INVALID_REQUEST",
          message: "The selected canonical object no longer exists for this organisation and kind.",
        };
      }
      requestedDecision = {
        outcome: "MATCH_EXISTING",
        subject: subjectRef,
        canonicalObject: {
          organisationId: input.organisationId,
          objectId: asCanonicalObjectId(existing.canonicalObjectId),
          kind: existing.kind,
        },
      };
    } else {
      requestedDecision = { outcome: input.requestedOutcome, subject: subjectRef };
    }

    const commandId = stableCommandId([
      "OBJECT",
      input.organisationId,
      input.reviewSubjectId,
      input.requestedOutcome,
      input.matchCanonicalObjectId ?? null,
      input.reasonCode,
      input.actorUserId,
    ]);

    // recovery.candidate/finding are the recovered NormalizedObjectCandidate /
    // DiscoveryFinding union, not narrowed to one literal CanonicalObjectKind
    // at compile time (the actual kind is only known at runtime) — the same
    // situation object-candidate-reconciliation-continuity.test.ts casts
    // through `as never` for, since invokeObjectReconciliation's generic Kind
    // cannot be soundly inferred from an already-recovered, kind-erased pair.
    const command: ObjectReconciliationInvocationCommand = {
      commandId,
      organisationId: input.organisationId,
      reviewSubject: recovery.reviewSubject,
      finding: recovery.finding as never,
      candidate: candidate as never,
      actor,
      authorizationPort,
      reasonCode: input.reasonCode,
      requestedAt,
      requestedDecision: requestedDecision as never,
    };
    const result = await invokeObjectReconciliation(command);

    const persisted = await governanceReviewPersistence.persistAuthorizedReconciliation({
      family: "OBJECT",
      decision: result.decision,
      authorization: result.authorization,
      invocation: result.audit,
    });

    return {
      kind: persisted.replay ? "REPLAYED" : "APPLIED",
      reconciliationDecisionId: persisted.reconciliationDecisionId,
      outcome: input.requestedOutcome,
    };
  } catch (error) {
    if (error instanceof ReviewSubjectNotCertifiedError) {
      return { kind: "NOT_READY", reason: "NOT_CERTIFIED" };
    }
    if (
      error instanceof MachineAuthorityForbiddenError ||
      error instanceof AuthorizationDeniedError ||
      error instanceof AuthorizationPortRequiredError ||
      error instanceof AuthorizationScopeMismatchError ||
      error instanceof ActorAuthorizationMismatchError
    ) {
      return { kind: "FORBIDDEN", message: "Reconciliation authorization was not granted." };
    }
    if (
      error instanceof SubjectMismatchError ||
      error instanceof ContextMismatchError ||
      error instanceof EvidenceMismatchError ||
      error instanceof CanonicalReconciliationRejectedError
    ) {
      return { kind: "INVALID_REQUEST", message: error.message };
    }
    if (error instanceof LegacyObjectMappingConflict) {
      return { kind: "PERSISTENCE_CONFLICT", message: error.message };
    }
    if (error instanceof IdempotencyConflictError) {
      return { kind: "PERSISTENCE_CONFLICT", message: "This reconciliation command conflicts with a prior one." };
    }
    if (error instanceof Error && /FINALIZED_REVIEW_DECISION_CONFLICT|FINALIZED_REVIEW_CANDIDATE_MISMATCH|IDEMPOTENCY_CONFLICT/.test(error.message)) {
      return { kind: "PERSISTENCE_CONFLICT", message: "This review conflicts with an already finalized decision." };
    }
    throw error;
  }
}

export type TriggerMaterializationOutcome =
  | { readonly kind: "APPLIED" | "REPLAYED"; readonly result: MaterializationApplicationResult & { applicable: true } }
  | { readonly kind: "NOT_APPLICABLE"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "FORBIDDEN"; readonly message: string }
  | { readonly kind: "NOT_READY"; readonly message: string }
  | { readonly kind: "PERSISTENCE_CONFLICT"; readonly message: string };

export interface TriggerMaterializationInput {
  readonly organisationId: OrganisationId;
  readonly sessionRole: string;
  readonly reviewSubjectId: ReviewSubjectId;
}

/**
 * Materializes exactly the canonical truth already authorized by a persisted
 * reconciliation decision for this review subject. Never accepts a
 * reconciliationDecisionId from the client — it is resolved server-side from
 * the review subject the URL already names, using the same lookup the query
 * side uses.
 */
export async function triggerMaterialization(
  input: TriggerMaterializationInput,
): Promise<TriggerMaterializationOutcome> {
  const hasAuthority = hasGovernanceReviewAuthority(input.sessionRole);
  if (!hasAuthority) {
    return { kind: "FORBIDDEN", message: "Your role does not permit materialization actions." };
  }

  const subject = await governanceReviewPersistence.getReviewSubject(input.organisationId, input.reviewSubjectId);
  if (!subject) return { kind: "NOT_FOUND" };

  const reconciliationDecisionId = await findReconciliationDecisionIdForReviewSubject(
    input.organisationId,
    input.reviewSubjectId,
  );
  if (!reconciliationDecisionId) {
    return { kind: "NOT_READY", message: "This review subject has no persisted reconciliation decision yet." };
  }

  // materializeReconciliationDecision -> ports.materialization.materialize*Reconciliation
  // is itself idempotent on reconciliationDecisionId (materialization_operations_decision_unique,
  // Canonical Materialization V1, closed): calling it again for an
  // already-APPLIED decision is a safe, correct replay that returns the exact
  // existing canonical result, never a second materialization. No separate
  // pre-check is needed here.
  try {
    const result = await materializeReconciliationDecision(
      { governance: governanceReviewPersistence, materialization: materializationPersistence },
      { organisationId: input.organisationId, reconciliationDecisionId },
    );
    if (!result.applicable) {
      return { kind: "NOT_APPLICABLE", reason: result.reason };
    }
    return {
      kind: result.result.replay ? "REPLAYED" : "APPLIED",
      result: result as MaterializationApplicationResult & { applicable: true },
    };
  } catch (error) {
    if (error instanceof MaterializationAuthorityError) {
      return { kind: "PERSISTENCE_CONFLICT", message: error.message };
    }
    // gov_repo.materialize_object_reconciliation's own business-rule
    // rejection (Canonical Materialization V1, closed): the certified
    // candidate's source file is already bound to a different governed
    // canonical object (canonical_object_source_mappings_active_source_uidx
    // — one active mapping per source identity per tenant). A real, expected
    // outcome (e.g. a file that declares both a model reference and a tools
    // list, discovered as two separate candidates sharing one source
    // identity) — surfaced as a controlled conflict, never a raw 500.
    const message = error instanceof Error ? error.message : String(error);
    if (/LEGACY_OBJECT_|ENDPOINT_|RELATIONSHIP_.*MISMATCH|RELATIONSHIP_.*MISSING|NORMALIZED_MAPPING_CONFLICT|PARENT_NOT_CANONICAL|DUPLICATE_GOVERNED_RELATIONSHIP_EDGE|CANONICAL_OBJECT_IDENTITY_CONFLICT|MATERIALIZATION_IDEMPOTENCY_CONFLICT|OBJECT_CANDIDATE_BINDING_MISMATCH/.test(message)) {
      return { kind: "PERSISTENCE_CONFLICT", message: "The governed binding is missing, ambiguous, or conflicts with canonical truth." };
    }
    if (/SOURCE_IDENTITY_ALREADY_MAPPED/i.test(message)) {
      return {
        kind: "PERSISTENCE_CONFLICT",
        message: "This candidate's source is already bound to a different governed canonical object.",
      };
    }
    throw error;
  }
}
