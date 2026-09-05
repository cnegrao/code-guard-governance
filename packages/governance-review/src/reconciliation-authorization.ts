import type {
  CandidateMergeId,
  DiscoveryCandidateKind,
  IsoTimestamp,
  NormalizedCandidateId,
  OrganisationId,
  ReconciliationAuthority,
  ReconciliationOutcome,
  RelationshipReconciliationOutcome,
} from "@council/canonical-contracts";

import type { ReviewSubjectId } from "./identifiers";

/**
 * The reconciliation action being requested. This is deliberately the exact
 * union of canonical-contracts' own outcome taxonomies (ReconciliationOutcome
 * for object/merge candidates, RelationshipReconciliationOutcome for
 * relationship candidates) - never an invented vocabulary.
 */
export type ReconciliationAction =
  | ReconciliationOutcome
  | RelationshipReconciliationOutcome;

/** The only ReconciliationAuthority variant ever presented for authorization; machine/deterministic-rule authority never reaches this boundary (see assertHumanActor in reconciliation-invocation.ts). */
export type HumanReconciliationAuthority = Extract<
  ReconciliationAuthority,
  { readonly authorityKind: "HUMAN" }
>;

/** Mirrors canonical-contracts' ReconciliationSubjectReference discriminant, widened to cover relationship candidates (which are never merged). */
export type ReconciliationAuthorizationSubject =
  | { readonly subjectKind: "CANDIDATE"; readonly candidateId: NormalizedCandidateId }
  | { readonly subjectKind: "CANDIDATE_MERGE"; readonly candidateMergeId: CandidateMergeId };

/**
 * Everything a trusted external authorization adapter needs to decide
 * whether a HUMAN actor is organisationally authorized to invoke
 * reconciliation. This package never reads JWTs, cookies, roles, database
 * tables, Supabase Auth, or dashboard Auth - it only describes the question.
 */
export interface ReconciliationAuthorizationRequest {
  readonly organisationId: OrganisationId;
  readonly reviewSubjectId: ReviewSubjectId;
  readonly candidateKind: DiscoveryCandidateKind;
  readonly subject: ReconciliationAuthorizationSubject;
  readonly requestedAction: ReconciliationAction;
  readonly actor: HumanReconciliationAuthority;
}

export const AUTHORIZATION_RESULT = {
  ALLOW: "ALLOW",
  DENY: "DENY",
} as const;
export type AuthorizationResultCode =
  (typeof AUTHORIZATION_RESULT)[keyof typeof AUTHORIZATION_RESULT];

/**
 * Audit-sufficient evidence of one authorization evaluation. actorReference
 * is the HUMAN identity the grant actually applies to: the reconciliation
 * gate cross-checks it against the command's own actor rather than trusting
 * the command's actor/reasonCode fields alone as proof of authorization.
 */
export interface ReconciliationAuthorizationResult {
  readonly authorizationDecisionId: string;
  readonly result: AuthorizationResultCode;
  readonly organisationId: OrganisationId;
  readonly actorReference: string;
  readonly subject: ReconciliationAuthorizationSubject;
  readonly requestedAction: ReconciliationAction;
  readonly evaluatedAt: IsoTimestamp;
  readonly policyReference?: string;
}

/**
 * Narrow authorization boundary (Port/Capability pattern). governance-review
 * never implements this itself and never decides organisation permissions -
 * a trusted external adapter (dashboard Auth, a policy engine, ...) does. A
 * missing Port, a Port that throws, or a Port that returns anything other
 * than an exact-scope ALLOW all fail the reconciliation gate closed; there is
 * no permissive/default implementation anywhere in this package.
 */
export interface ReconciliationAuthorizationPort {
  authorize(
    request: ReconciliationAuthorizationRequest,
  ): ReconciliationAuthorizationResult | Promise<ReconciliationAuthorizationResult>;
}
