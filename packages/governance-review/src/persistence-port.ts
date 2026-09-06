import type {
  MergeCandidatesReconciliationDecision,
  OrganisationId,
  ReconciliationDecision,
  RelationshipReconciliationDecision,
} from "@council/canonical-contracts";

import type { ReviewSubjectId } from "./identifiers";
import type {
  ReconciliationAuthorizationResult,
  AuthorizationResultCode,
} from "./reconciliation-authorization";
import type { ReconciliationInvocationAuditEvent } from "./reconciliation-invocation";
import type { ReviewAuditEvent, ReviewSubject } from "./review-subject";
import type { TransitionResult } from "./transitions";

/**
 * Governance Persistence V1.
 *
 * Narrow persistence boundary (Port/Repository pattern), mirroring
 * ReconciliationAuthorizationPort in spirit: this package never implements
 * durable storage itself, never talks to Supabase/Postgres/any store, and
 * never invents a generic privileged db.read/db.write escape hatch. A
 * trusted server-only adapter (see apps/dashboard) implements this interface.
 *
 * Persisting a canonical reconciliation decision is never the same as
 * materializing a governed canonical object: an implementation of this Port
 * must not create governed objects as a side effect of persistence.
 */

export type PersistedReconciliationFamily =
  | "OBJECT"
  | "RELATIONSHIP"
  | "CANDIDATE_MERGE";

export interface ReviewSubjectPersistenceResult {
  /** true when an identical ReviewSubject already existed under this reviewSubjectId (idempotent replay). */
  readonly replay: boolean;
  readonly subject: ReviewSubject;
}

export interface ReviewTransitionPersistenceResult {
  /** true when this exact commandId was already applied as the subject's current transition (idempotent replay). */
  readonly replay: boolean;
  readonly subject: ReviewSubject;
  readonly event: ReviewAuditEvent;
}

export interface ReviewAuditChain {
  readonly subject: ReviewSubject;
  /** Full transition history, oldest first. */
  readonly events: readonly ReviewAuditEvent[];
}

export interface AuthorizationDecisionPersistenceResult {
  readonly replay: boolean;
  readonly authorizationDecisionId: string;
  readonly result: AuthorizationResultCode;
}

interface AuthorizedReconciliationPersistenceInputBase {
  readonly authorization: ReconciliationAuthorizationResult;
  readonly invocation: ReconciliationInvocationAuditEvent;
}

export interface ObjectReconciliationPersistenceInput
  extends AuthorizedReconciliationPersistenceInputBase {
  readonly family: "OBJECT";
  readonly decision: ReconciliationDecision;
}

export interface RelationshipReconciliationPersistenceInput
  extends AuthorizedReconciliationPersistenceInputBase {
  readonly family: "RELATIONSHIP";
  readonly decision: RelationshipReconciliationDecision;
}

export interface CandidateMergeReconciliationPersistenceInput
  extends AuthorizedReconciliationPersistenceInputBase {
  readonly family: "CANDIDATE_MERGE";
  readonly decision: MergeCandidatesReconciliationDecision;
}

/**
 * Bundles exactly what Transaction B (AuthorizationDecision[ALLOW] +
 * ReconciliationInvocation + canonical ReconciliationDecision + Outbox event)
 * needs, already computed by governance-review's pure invoke*Reconciliation
 * gates. The Port never re-derives or re-validates domain legality itself —
 * it durably records what the domain package already proved.
 */
export type AuthorizedReconciliationPersistenceInput =
  | ObjectReconciliationPersistenceInput
  | RelationshipReconciliationPersistenceInput
  | CandidateMergeReconciliationPersistenceInput;

export interface AuthorizedReconciliationPersistenceResult {
  readonly replay: boolean;
  readonly authorizationDecisionId: string;
  readonly invocationId: string;
  readonly reconciliationDecisionId: string;
}

export type PersistedReconciliationDecision =
  | ReconciliationDecision
  | RelationshipReconciliationDecision
  | MergeCandidatesReconciliationDecision;

export interface ReconciliationAuditChainEntry {
  readonly family: PersistedReconciliationFamily;
  readonly authorization: ReconciliationAuthorizationResult;
  readonly invocation: ReconciliationInvocationAuditEvent;
  readonly decision: PersistedReconciliationDecision;
}

export interface GovernanceReviewPersistencePort {
  /** Idempotent: identical content under an already-used reviewSubjectId replays; conflicting content fails closed. */
  createReviewSubject(subject: ReviewSubject): Promise<ReviewSubjectPersistenceResult>;

  getReviewSubject(
    organisationId: OrganisationId,
    reviewSubjectId: ReviewSubjectId,
  ): Promise<ReviewSubject | undefined>;

  /** Transaction A: persists one already-computed TransitionResult (subject + event) atomically, with its own tenant/concurrency/idempotency guards. */
  persistReviewTransition(
    result: TransitionResult,
  ): Promise<ReviewTransitionPersistenceResult>;

  getReviewAuditChain(
    organisationId: OrganisationId,
    reviewSubjectId: ReviewSubjectId,
  ): Promise<ReviewAuditChain | undefined>;

  /** Standalone recording of one ALLOW or DENY authorization result (a DENY never reaches persistAuthorizedReconciliation). */
  persistAuthorizationDecision(
    result: ReconciliationAuthorizationResult,
    context: { readonly reviewSubjectId: ReviewSubjectId | undefined },
  ): Promise<AuthorizationDecisionPersistenceResult>;

  /** Transaction B: persists AuthorizationDecision[ALLOW] + canonical ReconciliationDecision + ReconciliationInvocation + Outbox event atomically. */
  persistAuthorizedReconciliation(
    input: AuthorizedReconciliationPersistenceInput,
  ): Promise<AuthorizedReconciliationPersistenceResult>;

  getReconciliationAuditChain(
    organisationId: OrganisationId,
    reconciliationDecisionId: string,
  ): Promise<ReconciliationAuditChainEntry | undefined>;
}
