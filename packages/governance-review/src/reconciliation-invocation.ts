import { createHash } from "node:crypto";

import {
  RECONCILIATION_AUTHORITY_KIND,
  RECONCILIATION_OUTCOME,
  asReconciliationDecisionId,
  createCandidateMergeRecord,
  createObjectReconciliationDecision,
  createRelationshipReconciliationDecision,
  sourceObjectIdentityKey,
  type CandidateMergeId,
  type CandidateMergeRecord,
  type CanonicalObjectIdentity,
  type CanonicalObjectKind,
  type DiscoveryFinding,
  type EvidenceId,
  type GovernedRelationship,
  type GovernedRelationshipDraft,
  type GovernedRelationshipType,
  type IsoTimestamp,
  type MergeCandidatesReconciliationDecision,
  type NormalizedObjectCandidate,
  type NormalizedRelationshipCandidate,
  type ObjectReconciliationDecisionDraft,
  type OrganisationId,
  type ReconciliationAuthority,
  type ReconciliationDecision,
  type ReconciliationDecisionId,
  type ReconciliationSubjectReference,
  type RelationshipDiscoveryFinding,
  type RelationshipMatchReference,
  type RelationshipReconciliationDecision,
} from "@council/canonical-contracts";

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
  ReviewSubjectNotCertifiedError,
  SubjectMismatchError,
} from "./errors";
import { asReconciliationInvocationId, type ReviewSubjectId } from "./identifiers";
import {
  AUTHORIZATION_RESULT,
  type HumanReconciliationAuthority,
  type ReconciliationAction,
  type ReconciliationAuthorizationPort,
  type ReconciliationAuthorizationRequest,
  type ReconciliationAuthorizationResult,
  type ReconciliationAuthorizationSubject,
} from "./reconciliation-authorization";
import { REVIEW_STATE } from "./review-state";
import type { ReviewSubject } from "./review-subject";

/**
 * Reconciliation Invocation Gate (Phase 4/5 of the reconciliation
 * reconciliation lifecycle: DISCOVERY -> HITL REVIEW -> CERTIFIED ->
 * AUTHORIZATION GATE -> CANONICAL RECONCILIATION DECISION).
 *
 * CERTIFIED is necessary but never sufficient: a certified, HUMAN-authored
 * ReviewSubject only proves the finding is eligible to enter authorized
 * reconciliation. The functions below additionally require an explicit,
 * exact-scope ALLOW from a caller-supplied ReconciliationAuthorizationPort
 * before they will construct a canonical-contracts reconciliation decision.
 * They never persist anything, never call an LLM, and never decide
 * organisation permissions themselves.
 */

function stableSuffix(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function isHuman(
  actor: ReconciliationAuthority,
): actor is HumanReconciliationAuthority {
  return (
    !!actor &&
    typeof actor === "object" &&
    actor.authorityKind === RECONCILIATION_AUTHORITY_KIND.HUMAN
  );
}

/** Rule 7 / check H: machine authority can never authorize canonical reconciliation. Fails before any authorization Port is even consulted. */
function assertHumanActor(
  actor: ReconciliationAuthority,
): asserts actor is HumanReconciliationAuthority {
  if (!isHuman(actor)) {
    throw new MachineAuthorityForbiddenError();
  }
  if (!actor.actorReference || actor.actorReference.trim().length === 0) {
    throw new MachineAuthorityForbiddenError();
  }
}

/** Checks A/B: CERTIFIED is required, and REJECTED (or any other non-terminal state) is never eligible. */
function assertCertified(reviewSubject: ReviewSubject): void {
  if (reviewSubject.state !== REVIEW_STATE.CERTIFIED) {
    throw new ReviewSubjectNotCertifiedError(reviewSubject.state);
  }
}

function assertOrganisationMatches(
  organisationId: OrganisationId,
  reviewSubject: ReviewSubject,
): void {
  if (organisationId !== reviewSubject.organisationId) {
    throw new ContextMismatchError(
      `Command organisationId does not match certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
}

/** Check C/D: the original finding must be the exact finding the review subject was certified against. */
function assertFindingMatchesSubject(
  reviewSubject: ReviewSubject,
  finding: DiscoveryFinding,
): void {
  if (finding.findingId !== reviewSubject.findingId) {
    throw new SubjectMismatchError(
      `Finding ${finding.findingId} does not match certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
  if (finding.candidateKind !== reviewSubject.candidateKind) {
    throw new SubjectMismatchError(
      `Finding candidateKind does not match certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
}

/** Check C/D/F: the candidate must back the same finding, share its kind, and remain anchored to the same source object as certification time. */
function assertCandidateMatchesSubject(
  reviewSubject: ReviewSubject,
  candidate: { readonly findingId: DiscoveryFinding["findingId"]; readonly candidateKind: DiscoveryFinding["candidateKind"]; readonly sourceObject: DiscoveryFinding["sourceObject"] },
): void {
  if (candidate.findingId !== reviewSubject.findingId) {
    throw new SubjectMismatchError(
      `Candidate does not back the finding of certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
  if (candidate.candidateKind !== reviewSubject.candidateKind) {
    throw new SubjectMismatchError(
      `Candidate candidateKind does not match certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
  if (sourceObjectIdentityKey(candidate.sourceObject) !== sourceObjectIdentityKey(reviewSubject.sourceObject)) {
    throw new SubjectMismatchError(
      `Candidate sourceObject does not match certified review subject ${reviewSubject.reviewSubjectId}`,
    );
  }
}

/** Check G: a relationship candidate substituted after certification with a differently anchored endpoint is rejected, mirroring createReviewSubject's own check. */
function assertRelationshipEndpointsConsistent(
  reviewSubject: ReviewSubject,
  candidate: NormalizedRelationshipCandidate,
): void {
  for (const endpoint of [candidate.sourceEndpoint, candidate.targetEndpoint]) {
    if (
      endpoint.referenceKind === "SOURCE_OBJECT" &&
      endpoint.sourceObject.connectionId !== reviewSubject.sourceObject.connectionId
    ) {
      throw new SubjectMismatchError(
        `Relationship candidate endpoint is anchored to a different source connection than certified review subject ${reviewSubject.reviewSubjectId}`,
      );
    }
  }
}

/** Check F: any evidence explicitly cited on the command must remain part of the certified subject's own evidence. */
function assertEvidenceBound(
  reviewSubject: ReviewSubject,
  evidenceIds: readonly EvidenceId[] | undefined,
): void {
  if (!evidenceIds) return;
  const allowed = new Set(reviewSubject.evidenceIds);
  for (const evidenceId of evidenceIds) {
    if (!allowed.has(evidenceId)) {
      throw new EvidenceMismatchError();
    }
  }
}

function subjectsEqual(
  left: ReconciliationAuthorizationSubject,
  right: ReconciliationAuthorizationSubject,
): boolean {
  if (left.subjectKind !== right.subjectKind) return false;
  if (left.subjectKind === "CANDIDATE" && right.subjectKind === "CANDIDATE") {
    return left.candidateId === right.candidateId;
  }
  if (left.subjectKind === "CANDIDATE_MERGE" && right.subjectKind === "CANDIDATE_MERGE") {
    return left.candidateMergeId === right.candidateMergeId;
  }
  return false;
}

/**
 * Checks H/I/J: consults the Port and requires an explicit ALLOW for the
 * exact organisation, action, and subject requested, authorized for the
 * exact actor presented on this command. No permissive default exists: a
 * missing Port, a Port returning no usable result, or any scope mismatch all
 * fail closed with a typed error - never a silent pass.
 */
async function authorize(
  port: ReconciliationAuthorizationPort | undefined,
  request: ReconciliationAuthorizationRequest,
): Promise<ReconciliationAuthorizationResult> {
  if (!port || typeof port.authorize !== "function") {
    throw new AuthorizationPortRequiredError();
  }

  const result = await port.authorize(request);

  if (!result || typeof result !== "object") {
    throw new AuthorizationDeniedError("Authorization port returned no result");
  }
  if (result.result !== AUTHORIZATION_RESULT.ALLOW) {
    throw new AuthorizationDeniedError();
  }
  if (result.organisationId !== request.organisationId) {
    throw new AuthorizationScopeMismatchError("organisationId");
  }
  if (result.requestedAction !== request.requestedAction) {
    throw new AuthorizationScopeMismatchError("requestedAction");
  }
  if (!subjectsEqual(result.subject, request.subject)) {
    throw new AuthorizationScopeMismatchError("subject");
  }
  if (result.actorReference !== request.actor.actorReference) {
    throw new ActorAuthorizationMismatchError();
  }

  return result;
}

/**
 * Lightweight, non-canonical audit envelope (Phase 6). It references
 * canonical/governance-review identities by ID only - it never copies
 * canonical decision content - and exists solely so a future orchestrator can
 * detect a reused idempotency key (see checkPriorInvocation below).
 */
export interface ReconciliationInvocationAuditEvent {
  readonly invocationId: string;
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly reviewSubjectId: ReviewSubjectId | undefined;
  readonly authorizationDecisionId: string;
  readonly reconciliationDecisionId: ReconciliationDecisionId;
  readonly requestedAction: ReconciliationAction;
  readonly actor: ReconciliationAuthority;
  readonly requestedAt: IsoTimestamp;
  readonly reasonCode: string;
  /** Stable hash of every semantically relevant input; a replay with the same commandId but a different fingerprint fails closed. */
  readonly commandFingerprint: string;
}

export type ReconciliationInvocationResult<Decision> =
  | {
      readonly kind: "APPLIED";
      readonly decision: Decision;
      readonly authorization: ReconciliationAuthorizationResult;
      readonly audit: ReconciliationInvocationAuditEvent;
    }
  | {
      readonly kind: "REPLAYED";
      readonly decision: Decision;
      readonly authorization: ReconciliationAuthorizationResult;
      readonly audit: ReconciliationInvocationAuditEvent;
    };

/** Checks K (idempotency half): same commandId + same fingerprint replays deterministically; same commandId + a different fingerprint fails closed. */
function checkPriorInvocation(
  commandId: string,
  fingerprint: string,
  prior: ReconciliationInvocationAuditEvent | undefined,
): "NEW" | "REPLAY" {
  if (!prior || prior.commandId !== commandId) {
    return "NEW";
  }
  if (prior.commandFingerprint !== fingerprint) {
    throw new IdempotencyConflictError(commandId);
  }
  return "REPLAY";
}

function buildAuditEvent(input: {
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly reviewSubjectId: ReviewSubjectId | undefined;
  readonly authorizationDecisionId: string;
  readonly reconciliationDecisionId: ReconciliationDecisionId;
  readonly requestedAction: ReconciliationAction;
  readonly actor: ReconciliationAuthority;
  readonly requestedAt: IsoTimestamp;
  readonly reasonCode: string;
  readonly commandFingerprint: string;
}): ReconciliationInvocationAuditEvent {
  return Object.freeze({
    invocationId: asReconciliationInvocationId(
      `reconciliation-invocation:${stableSuffix([input.organisationId, input.commandId, input.commandFingerprint])}`,
    ),
    ...input,
  });
}

function newDecisionId(parts: readonly unknown[]): ReconciliationDecisionId {
  return asReconciliationDecisionId(`reconciliation-decision:${stableSuffix(parts)}`);
}

// ---------------------------------------------------------------------------
// Object candidates (every CanonicalObjectKind except RELATIONSHIP)
// ---------------------------------------------------------------------------

export type ObjectReconciliationRequestedDecision<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> =
  | {
      readonly outcome: "CREATE_NEW";
      readonly subject: ReconciliationSubjectReference<Kind>;
      readonly canonicalObject: CanonicalObjectIdentity<Kind>;
    }
  | {
      readonly outcome: "MATCH_EXISTING";
      readonly subject: ReconciliationSubjectReference<Kind>;
      readonly canonicalObject: CanonicalObjectIdentity<Kind>;
    }
  | { readonly outcome: "REJECT"; readonly subject: ReconciliationSubjectReference<Kind> }
  | { readonly outcome: "DEFER"; readonly subject: ReconciliationSubjectReference<Kind> };

export interface ObjectReconciliationInvocationCommand<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> {
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly reviewSubject: ReviewSubject;
  readonly finding: DiscoveryFinding<Kind>;
  readonly candidate: NormalizedObjectCandidate & { readonly candidateKind: Kind };
  readonly actor: ReconciliationAuthority;
  readonly authorizationPort: ReconciliationAuthorizationPort;
  readonly reasonCode: string;
  readonly requestedAt: IsoTimestamp;
  readonly requestedDecision: ObjectReconciliationRequestedDecision<Kind>;
  readonly evidenceIds?: readonly EvidenceId[];
  /** Supplied by a future orchestrator that looks up the last invocation for this commandId; absent means "first attempt". */
  readonly priorInvocation?: ReconciliationInvocationAuditEvent;
}

function assertSubjectReferenceMatchesCandidate(
  subjectRef: ReconciliationSubjectReference,
  candidate: NormalizedObjectCandidate,
): void {
  if (subjectRef.subjectKind !== "CANDIDATE") {
    throw new SubjectMismatchError(
      "Object reconciliation request subject must directly reference the certified candidate",
    );
  }
  if (subjectRef.candidateId !== candidate.candidateId) {
    throw new SubjectMismatchError(
      "Requested decision subject candidateId does not match the certified candidate",
    );
  }
  if (subjectRef.candidateKind !== candidate.candidateKind) {
    throw new SubjectMismatchError(
      "Requested decision subject candidateKind does not match the certified candidate",
    );
  }
}

function assertCanonicalObjectMatchesContext(
  canonicalObject: CanonicalObjectIdentity,
  organisationId: OrganisationId,
  candidateKind: CanonicalObjectKind,
): void {
  if (canonicalObject.organisationId !== organisationId) {
    throw new ContextMismatchError(
      "Requested canonicalObject organisationId does not match the reconciliation command",
    );
  }
  if (canonicalObject.kind !== candidateKind) {
    throw new SubjectMismatchError(
      "Requested canonicalObject kind does not match the certified candidate kind",
    );
  }
}

/**
 * Object-candidate reconciliation gate. This function proves check K's
 * caller-scoped bindings (the requested subject/canonicalObject match the
 * exact certified candidate and command context) and then delegates
 * construction and structural/tenant validation of the
 * CreateNew/MatchExisting/Reject/Defer ReconciliationDecision itself to
 * canonical-contracts' createObjectReconciliationDecision - mirroring the
 * relationship and semantic-assignment variants. It never constructs a
 * ReconciliationDecision directly and never invents a parallel decision
 * model.
 */
export async function invokeObjectReconciliation<Kind extends CanonicalObjectKind>(
  command: ObjectReconciliationInvocationCommand<Kind>,
): Promise<ReconciliationInvocationResult<ReconciliationDecision>> {
  const {
    commandId,
    organisationId,
    reviewSubject,
    finding,
    candidate,
    actor,
    authorizationPort,
    reasonCode,
    requestedAt,
    requestedDecision,
    evidenceIds,
    priorInvocation,
  } = command;

  assertHumanActor(actor);
  assertCertified(reviewSubject);
  assertOrganisationMatches(organisationId, reviewSubject);
  assertFindingMatchesSubject(reviewSubject, finding);
  assertCandidateMatchesSubject(reviewSubject, candidate);
  assertEvidenceBound(reviewSubject, evidenceIds);

  if (finding.findingId !== candidate.findingId) {
    throw new SubjectMismatchError(
      "Candidate does not back the same finding as the certified review subject",
    );
  }

  assertSubjectReferenceMatchesCandidate(requestedDecision.subject, candidate);
  if (requestedDecision.outcome === "CREATE_NEW" || requestedDecision.outcome === "MATCH_EXISTING") {
    assertCanonicalObjectMatchesContext(
      requestedDecision.canonicalObject,
      organisationId,
      candidate.candidateKind,
    );
  }

  const requestedAction: ReconciliationAction = requestedDecision.outcome;
  const authorizationSubject: ReconciliationAuthorizationSubject = {
    subjectKind: "CANDIDATE",
    candidateId: candidate.candidateId,
  };

  const fingerprint = stableSuffix([
    "OBJECT",
    organisationId,
    reviewSubject.reviewSubjectId,
    finding.findingId,
    candidate.candidateId,
    actor.actorReference,
    reasonCode,
    requestedDecision,
  ]);
  const replay = checkPriorInvocation(commandId, fingerprint, priorInvocation);

  const authorization = await authorize(authorizationPort, {
    organisationId,
    reviewSubjectId: reviewSubject.reviewSubjectId,
    candidateKind: candidate.candidateKind,
    subject: authorizationSubject,
    requestedAction,
    actor,
  });

  const decisionId = newDecisionId([organisationId, reviewSubject.reviewSubjectId, commandId]);
  const decidedEvidenceIds = Object.freeze([...(evidenceIds ?? reviewSubject.evidenceIds)]);

  const decisionBase = {
    decisionId,
    organisationId,
    candidateKind: candidate.candidateKind,
    authority: actor as ReconciliationAuthority,
    reasonCode,
    assertionIds: Object.freeze([...candidate.assertionIds]),
    evidenceIds: decidedEvidenceIds,
    decidedAt: requestedAt,
  };

  const decisionDraft: ObjectReconciliationDecisionDraft =
    requestedDecision.outcome === "CREATE_NEW" || requestedDecision.outcome === "MATCH_EXISTING"
      ? ({
          ...decisionBase,
          outcome: requestedDecision.outcome,
          subject: requestedDecision.subject,
          canonicalObject: requestedDecision.canonicalObject,
        } as ObjectReconciliationDecisionDraft)
      : ({
          ...decisionBase,
          outcome: requestedDecision.outcome,
          subject: requestedDecision.subject,
        } as ObjectReconciliationDecisionDraft);

  let decision: ReconciliationDecision;
  try {
    decision = createObjectReconciliationDecision(decisionDraft);
  } catch (cause) {
    throw new CanonicalReconciliationRejectedError(cause);
  }

  const audit = buildAuditEvent({
    commandId,
    organisationId,
    reviewSubjectId: reviewSubject.reviewSubjectId,
    authorizationDecisionId: authorization.authorizationDecisionId,
    reconciliationDecisionId: decisionId,
    requestedAction,
    actor,
    requestedAt,
    reasonCode,
    commandFingerprint: fingerprint,
  });

  return { kind: replay === "REPLAY" ? "REPLAYED" : "APPLIED", decision, authorization, audit };
}

// ---------------------------------------------------------------------------
// Relationship candidates
// ---------------------------------------------------------------------------

export type RelationshipReconciliationRequestedDecision<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> =
  | {
      readonly outcome: "CREATE_NEW";
      readonly authorizedState: GovernedRelationshipDraft<Type>;
      readonly supersededState?: GovernedRelationship;
    }
  | { readonly outcome: "MATCH_EXISTING"; readonly matchedState: RelationshipMatchReference<Type> }
  | { readonly outcome: "REJECT" }
  | { readonly outcome: "DEFER" };

export interface RelationshipReconciliationInvocationCommand<
  Type extends GovernedRelationshipType = GovernedRelationshipType,
> {
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly reviewSubject: ReviewSubject;
  readonly finding: RelationshipDiscoveryFinding;
  readonly candidate: NormalizedRelationshipCandidate;
  readonly actor: ReconciliationAuthority;
  readonly authorizationPort: ReconciliationAuthorizationPort;
  readonly reasonCode: string;
  readonly requestedAt: IsoTimestamp;
  readonly requestedDecision: RelationshipReconciliationRequestedDecision<Type>;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly priorInvocation?: ReconciliationInvocationAuditEvent;
}

/**
 * Relationship-candidate reconciliation gate. Unlike the plain object
 * decision, canonical-contracts already ships a validated, branded
 * constructor (createRelationshipReconciliationDecision) for this family -
 * check K is satisfied by delegating to it directly rather than
 * re-implementing its endpoint/supersession validation.
 */
export async function invokeRelationshipReconciliation<Type extends GovernedRelationshipType>(
  command: RelationshipReconciliationInvocationCommand<Type>,
): Promise<ReconciliationInvocationResult<RelationshipReconciliationDecision>> {
  const {
    commandId,
    organisationId,
    reviewSubject,
    finding,
    candidate,
    actor,
    authorizationPort,
    reasonCode,
    requestedAt,
    requestedDecision,
    evidenceIds,
    priorInvocation,
  } = command;

  assertHumanActor(actor);
  assertCertified(reviewSubject);
  assertOrganisationMatches(organisationId, reviewSubject);
  assertFindingMatchesSubject(reviewSubject, finding);
  assertCandidateMatchesSubject(reviewSubject, candidate);
  assertRelationshipEndpointsConsistent(reviewSubject, candidate);
  assertEvidenceBound(reviewSubject, evidenceIds);

  if (finding.findingId !== candidate.findingId) {
    throw new SubjectMismatchError(
      "Relationship candidate does not back the same finding as the certified review subject",
    );
  }

  const requestedAction: ReconciliationAction = requestedDecision.outcome;
  const authorizationSubject: ReconciliationAuthorizationSubject = {
    subjectKind: "CANDIDATE",
    candidateId: candidate.candidateId,
  };

  const fingerprint = stableSuffix([
    "RELATIONSHIP",
    organisationId,
    reviewSubject.reviewSubjectId,
    finding.findingId,
    candidate.candidateId,
    actor.actorReference,
    reasonCode,
    requestedDecision,
  ]);
  const replay = checkPriorInvocation(commandId, fingerprint, priorInvocation);

  const authorization = await authorize(authorizationPort, {
    organisationId,
    reviewSubjectId: reviewSubject.reviewSubjectId,
    candidateKind: "RELATIONSHIP",
    subject: authorizationSubject,
    requestedAction,
    actor,
  });

  const decisionId = newDecisionId([organisationId, reviewSubject.reviewSubjectId, commandId]);
  const decidedEvidenceIds = Object.freeze([...(evidenceIds ?? reviewSubject.evidenceIds)]);
  const assertionIds = Object.freeze([...candidate.assertionIds]);

  let decision: RelationshipReconciliationDecision;
  try {
    if (requestedDecision.outcome === "CREATE_NEW") {
      decision = createRelationshipReconciliationDecision({
        decisionId,
        organisationId,
        relationshipCandidateId: candidate.candidateId,
        relationshipCandidate: candidate,
        outcome: "CREATE_NEW",
        authority: actor,
        reasonCode,
        assertionIds,
        evidenceIds: decidedEvidenceIds,
        decidedAt: requestedAt,
        authorizedState: requestedDecision.authorizedState,
        ...(requestedDecision.supersededState === undefined
          ? {}
          : { supersededState: requestedDecision.supersededState }),
      });
    } else if (requestedDecision.outcome === "MATCH_EXISTING") {
      decision = createRelationshipReconciliationDecision({
        decisionId,
        organisationId,
        relationshipCandidateId: candidate.candidateId,
        relationshipCandidate: candidate,
        outcome: "MATCH_EXISTING",
        authority: actor,
        reasonCode,
        assertionIds,
        evidenceIds: decidedEvidenceIds,
        decidedAt: requestedAt,
        matchedState: requestedDecision.matchedState,
      });
    } else if (requestedDecision.outcome === "REJECT") {
      decision = createRelationshipReconciliationDecision({
        decisionId,
        organisationId,
        relationshipCandidateId: candidate.candidateId,
        relationshipCandidate: candidate,
        outcome: "REJECT",
        authority: actor,
        reasonCode,
        assertionIds,
        evidenceIds: decidedEvidenceIds,
        decidedAt: requestedAt,
      });
    } else {
      decision = createRelationshipReconciliationDecision({
        decisionId,
        organisationId,
        relationshipCandidateId: candidate.candidateId,
        relationshipCandidate: candidate,
        outcome: "DEFER",
        authority: actor,
        reasonCode,
        assertionIds,
        evidenceIds: decidedEvidenceIds,
        decidedAt: requestedAt,
      });
    }
  } catch (cause) {
    throw new CanonicalReconciliationRejectedError(cause);
  }

  const audit = buildAuditEvent({
    commandId,
    organisationId,
    reviewSubjectId: reviewSubject.reviewSubjectId,
    authorizationDecisionId: authorization.authorizationDecisionId,
    reconciliationDecisionId: decisionId,
    requestedAction,
    actor,
    requestedAt,
    reasonCode,
    commandFingerprint: fingerprint,
  });

  return { kind: replay === "REPLAY" ? "REPLAYED" : "APPLIED", decision, authorization, audit };
}

// ---------------------------------------------------------------------------
// Candidate merges (MERGE_CANDIDATES is only ever an object-candidate outcome)
// ---------------------------------------------------------------------------

export interface MergeCandidatesContributorContext<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> {
  readonly reviewSubject: ReviewSubject;
  readonly finding: DiscoveryFinding<Kind>;
  readonly candidate: NormalizedObjectCandidate & { readonly candidateKind: Kind };
}

export interface MergeCandidatesReconciliationInvocationCommand<
  Kind extends CanonicalObjectKind = CanonicalObjectKind,
> {
  readonly commandId: string;
  readonly organisationId: OrganisationId;
  readonly candidateMergeId: CandidateMergeId;
  readonly contributors: readonly MergeCandidatesContributorContext<Kind>[];
  readonly actor: ReconciliationAuthority;
  readonly authorizationPort: ReconciliationAuthorizationPort;
  readonly reasonCode: string;
  readonly requestedAt: IsoTimestamp;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly priorInvocation?: ReconciliationInvocationAuditEvent;
}

/**
 * MERGE_CANDIDATES reconciliation gate: every contributing candidate must
 * individually satisfy the same CERTIFIED + identity + context checks as a
 * single-candidate decision (checks A-G apply per contributor), and
 * canonical-contracts' own createCandidateMergeRecord remains authoritative
 * over the merge shape itself (check K).
 */
export async function invokeMergeCandidatesReconciliation<Kind extends CanonicalObjectKind>(
  command: MergeCandidatesReconciliationInvocationCommand<Kind>,
): Promise<ReconciliationInvocationResult<MergeCandidatesReconciliationDecision>> {
  const {
    commandId,
    organisationId,
    candidateMergeId,
    contributors,
    actor,
    authorizationPort,
    reasonCode,
    requestedAt,
    evidenceIds,
    priorInvocation,
  } = command;

  assertHumanActor(actor);

  if (contributors.length < 2) {
    throw new SubjectMismatchError("Candidate merge requires at least two certified contributors");
  }

  const candidateKind = contributors[0]!.candidate.candidateKind;
  for (const { reviewSubject, finding, candidate } of contributors) {
    assertCertified(reviewSubject);
    assertOrganisationMatches(organisationId, reviewSubject);
    assertFindingMatchesSubject(reviewSubject, finding);
    assertCandidateMatchesSubject(reviewSubject, candidate);
    assertEvidenceBound(reviewSubject, evidenceIds);

    if (finding.findingId !== candidate.findingId) {
      throw new SubjectMismatchError(
        "Candidate does not back the same finding as its certified review subject",
      );
    }
    if (candidate.candidateKind !== candidateKind) {
      throw new SubjectMismatchError("Candidate merge cannot mix candidate kinds");
    }
  }

  const requestedAction: ReconciliationAction = RECONCILIATION_OUTCOME.MERGE_CANDIDATES;
  const authorizationSubject: ReconciliationAuthorizationSubject = {
    subjectKind: "CANDIDATE_MERGE",
    candidateMergeId,
  };

  const fingerprint = stableSuffix([
    "MERGE_CANDIDATES",
    organisationId,
    candidateMergeId,
    actor.actorReference,
    reasonCode,
    [...contributors.map((contributor) => contributor.candidate.candidateId)].sort(),
  ]);
  const replay = checkPriorInvocation(commandId, fingerprint, priorInvocation);

  const authorization = await authorize(authorizationPort, {
    organisationId,
    reviewSubjectId: contributors[0]!.reviewSubject.reviewSubjectId,
    candidateKind,
    subject: authorizationSubject,
    requestedAction,
    actor,
  });

  const decisionId = newDecisionId([organisationId, candidateMergeId, commandId]);

  let mergeRecord: CandidateMergeRecord;
  try {
    mergeRecord = createCandidateMergeRecord({
      candidateMergeId,
      organisationId,
      candidateKind,
      contributors: contributors.map(({ reviewSubject, candidate }) => ({
        contributorKind: "CANDIDATE" as const,
        organisationId: reviewSubject.organisationId,
        candidate,
      })),
      createdByDecisionId: decisionId,
      createdAt: requestedAt,
    });
  } catch (cause) {
    throw new CanonicalReconciliationRejectedError(cause);
  }

  const decidedEvidenceIds = Object.freeze([
    ...(evidenceIds ?? contributors.flatMap((contributor) => contributor.reviewSubject.evidenceIds)),
  ]);
  const assertionIds = Object.freeze(
    contributors.flatMap((contributor) => contributor.candidate.assertionIds),
  );

  const decision: MergeCandidatesReconciliationDecision = Object.freeze({
    decisionId,
    organisationId,
    outcome: RECONCILIATION_OUTCOME.MERGE_CANDIDATES,
    candidateKind,
    authority: actor,
    reasonCode,
    assertionIds,
    evidenceIds: decidedEvidenceIds,
    decidedAt: requestedAt,
    contributingCandidateIds: mergeRecord.contributingCandidateIds,
    candidateMergeId,
  });

  const audit = buildAuditEvent({
    commandId,
    organisationId,
    reviewSubjectId: contributors[0]!.reviewSubject.reviewSubjectId,
    authorizationDecisionId: authorization.authorizationDecisionId,
    reconciliationDecisionId: decisionId,
    requestedAction,
    actor,
    requestedAt,
    reasonCode,
    commandFingerprint: fingerprint,
  });

  return { kind: replay === "REPLAY" ? "REPLAYED" : "APPLIED", decision, authorization, audit };
}
