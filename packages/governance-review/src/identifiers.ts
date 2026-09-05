/**
 * Opaque identifiers owned by this package. ReviewSubject and its audit
 * events are a new bounded context introduced by the HITL review lifecycle;
 * they reference canonical-contracts identity (DiscoveryFindingId,
 * OrganisationId, EvidenceId, ...) by foreign key but are never persisted
 * inside canonical-contracts itself.
 */

declare const opaqueIdentifierBrand: unique symbol;

type OpaqueIdentifier<Name extends string> = string & {
  readonly [opaqueIdentifierBrand]: Name;
};

export type ReviewSubjectId = OpaqueIdentifier<"ReviewSubjectId">;
export type ReviewTransitionId = OpaqueIdentifier<"ReviewTransitionId">;
/** Identifies one reconciliation invocation audit envelope (see reconciliation-invocation.ts), never a canonical-contracts identity. */
export type ReconciliationInvocationId =
  OpaqueIdentifier<"ReconciliationInvocationId">;

function asNonEmptyOpaque<Name extends string>(
  value: string,
  label: Name,
): OpaqueIdentifier<Name> {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value as OpaqueIdentifier<Name>;
}

export const asReviewSubjectId = (value: string): ReviewSubjectId =>
  asNonEmptyOpaque(value, "ReviewSubjectId");

export const asReviewTransitionId = (value: string): ReviewTransitionId =>
  asNonEmptyOpaque(value, "ReviewTransitionId");

export const asReconciliationInvocationId = (
  value: string,
): ReconciliationInvocationId =>
  asNonEmptyOpaque(value, "ReconciliationInvocationId");
