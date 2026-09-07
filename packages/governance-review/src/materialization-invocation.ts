import { createHash } from "node:crypto";

import type {
  GovernedRelationshipDraft,
  ObjectSourceMatchMethod,
  OrganisationId,
  ReconciliationDecision,
  RelationshipMatchReference,
  RelationshipReconciliationDecision,
} from "@council/canonical-contracts";

import type {
  GovernanceReviewPersistencePort,
  ReconciliationAuditChainEntry,
} from "./persistence-port";
import type {
  MaterializationPersistencePort,
  ObjectMaterializationResult,
  RelationshipMaterializationResult,
} from "./materialization-port";

/**
 * Canonical Materialization V1 application service.
 *
 * The critical invariant this module enforces: ONLY an already persisted,
 * valid canonical reconciliation decision — reached through
 * GovernanceReviewPersistencePort.getReconciliationAuditChain, which itself
 * re-verifies envelope_hash and rehydrates the decision through
 * canonical-contracts, and which fails if no matching invocation exists —
 * may cause canonical materialization. A discovery candidate, a bare
 * ReviewSubject, a CERTIFIED state alone, or an AuthorizationDecision alone
 * can never reach this path; they are never even shaped like a
 * reconciliationDecisionId.
 *
 * This module never talks to Supabase/Postgres directly: it composes the
 * existing GovernanceReviewPersistencePort (reads only: the audit chain and
 * the certified ReviewSubject it references) with the new, narrow
 * MaterializationPersistencePort (the one write).
 */

export class MaterializationAuthorityError extends Error {}

export type MaterializationApplicationResult =
  | {
      readonly applicable: true;
      readonly family: "OBJECT";
      readonly result: ObjectMaterializationResult;
    }
  | {
      readonly applicable: true;
      readonly family: "RELATIONSHIP";
      readonly result: RelationshipMaterializationResult;
    }
  | {
      readonly applicable: false;
      readonly reason:
        | "NOT_MATERIALIZING_OUTCOME"
        | "CANDIDATE_MERGE_HAS_NO_OBJECT_TARGET";
    };

export interface MaterializationPorts {
  readonly governance: GovernanceReviewPersistencePort;
  readonly materialization: MaterializationPersistencePort;
}

export interface MaterializeReconciliationDecisionInput {
  readonly organisationId: OrganisationId;
  readonly reconciliationDecisionId: string;
}

function computeIdempotencyFingerprint(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Every current object/relationship reconciliation decision requires HUMAN
 * authority (assertHumanActor in reconciliation-invocation.ts): a person
 * reviewed and approved the binding, so the ObjectSourceMapping this
 * produces always records MANUAL, never an unattended DETERMINISTIC/HEURISTIC
 * match — canonical-contracts defines no field on the decision itself that
 * would say otherwise.
 */
const HUMAN_AUTHORIZED_MATCH_METHOD: ObjectSourceMatchMethod = "MANUAL";

async function materializeObjectFamily(
  ports: MaterializationPorts,
  chain: ReconciliationAuditChainEntry,
): Promise<MaterializationApplicationResult> {
  const decision = chain.decision as ReconciliationDecision;
  // Captured as plain locals before any narrowing: ReconciliationDecision is
  // a large distributive conditional union (mapped over every
  // CanonicalObjectKind for two of its five outcome branches), and TypeScript
  // control-flow narrowing on such a type can otherwise collapse it to
  // `never` after a couple of sequential guards on its own properties.
  const decisionId = decision.decisionId;
  const outcome = decision.outcome;
  const organisationId = decision.organisationId;
  const decidedAt = decision.decidedAt;
  const canonicalObject = (
    decision as unknown as {
      readonly canonicalObject?: ReconciliationDecision["canonicalObject"];
    }
  ).canonicalObject;

  if (outcome !== "CREATE_NEW" && outcome !== "MATCH_EXISTING") {
    return { applicable: false, reason: "NOT_MATERIALIZING_OUTCOME" };
  }
  if (!canonicalObject) {
    throw new MaterializationAuthorityError(
      `Materializing object decision ${decisionId} is missing its canonicalObject identity`,
    );
  }

  const reviewSubjectId = chain.invocation.reviewSubjectId;
  if (!reviewSubjectId) {
    throw new MaterializationAuthorityError(
      `Object reconciliation invocation ${chain.invocation.invocationId} is missing its reviewSubjectId`,
    );
  }

  const reviewSubject = await ports.governance.getReviewSubject(organisationId, reviewSubjectId);
  if (!reviewSubject) {
    throw new MaterializationAuthorityError(
      `Certified review subject ${reviewSubjectId} not found for materialization of decision ${decisionId}`,
    );
  }
  if (reviewSubject.organisationId !== organisationId) {
    throw new MaterializationAuthorityError(
      `Review subject ${reviewSubjectId} organisation does not match reconciliation decision ${decisionId}`,
    );
  }

  const matchMethod = HUMAN_AUTHORIZED_MATCH_METHOD;
  const idempotencyFingerprint = computeIdempotencyFingerprint([
    decisionId,
    outcome,
    canonicalObject.objectId,
    canonicalObject.kind,
    reviewSubject.sourceObject.connectionId,
    reviewSubject.sourceObject.externalType,
    reviewSubject.sourceObject.externalId,
    matchMethod,
  ]);

  const result = await ports.materialization.materializeObjectReconciliation({
    organisationId,
    reconciliationDecisionId: decisionId,
    invocationId: chain.invocation.invocationId,
    outcome,
    canonicalObjectId: canonicalObject.objectId,
    canonicalObjectKind: canonicalObject.kind,
    sourceConnectionId: reviewSubject.sourceObject.connectionId,
    sourceExternalType: reviewSubject.sourceObject.externalType,
    sourceExternalId: reviewSubject.sourceObject.externalId,
    matchMethod,
    idempotencyFingerprint,
    occurredAt: decidedAt,
  });

  return { applicable: true, family: "OBJECT", result };
}

async function materializeRelationshipFamily(
  ports: MaterializationPorts,
  chain: ReconciliationAuditChainEntry,
): Promise<MaterializationApplicationResult> {
  const decision = chain.decision as RelationshipReconciliationDecision;
  // Same defensive local-capture pattern as materializeObjectFamily: avoid
  // depending on TypeScript to keep narrowing this decision's branch after
  // an outcome guard, since RelationshipReconciliationDecision is likewise a
  // multi-branch union.
  const decisionId = decision.decisionId;
  const outcome = decision.outcome;
  const organisationId = decision.organisationId;
  const decidedAt = decision.decidedAt;
  const widened = decision as unknown as {
    readonly authorizedState?: GovernedRelationshipDraft;
    readonly matchedState?: RelationshipMatchReference;
  };

  if (outcome !== "CREATE_NEW" && outcome !== "MATCH_EXISTING") {
    return { applicable: false, reason: "NOT_MATERIALIZING_OUTCOME" };
  }

  const draft = outcome === "CREATE_NEW" ? widened.authorizedState : undefined;
  const matched = outcome === "MATCH_EXISTING" ? widened.matchedState : undefined;
  const state = draft ?? matched;
  if (!state) {
    throw new MaterializationAuthorityError(
      `Materializing relationship decision ${decisionId} is missing its governed state`,
    );
  }

  const idempotencyFingerprint = computeIdempotencyFingerprint([
    decisionId,
    outcome,
    state.relationshipId,
    state.relationshipStateId,
    state.relationshipType,
    state.source.canonicalObject.objectId,
    state.source.canonicalObject.kind,
    state.target.canonicalObject.objectId,
    state.target.canonicalObject.kind,
  ]);

  const result = await ports.materialization.materializeRelationshipReconciliation({
    organisationId,
    reconciliationDecisionId: decisionId,
    invocationId: chain.invocation.invocationId,
    outcome,
    relationshipId: state.relationshipId,
    relationshipStateId: state.relationshipStateId,
    relationshipType: state.relationshipType,
    sourceCanonicalObjectId: state.source.canonicalObject.objectId,
    sourceKind: state.source.canonicalObject.kind,
    targetCanonicalObjectId: state.target.canonicalObject.objectId,
    targetKind: state.target.canonicalObject.kind,
    validFrom: draft ? draft.validFrom : decidedAt,
    recordedAt: draft ? draft.recordedAt : decidedAt,
    idempotencyFingerprint,
  });

  return { applicable: true, family: "RELATIONSHIP", result };
}

/**
 * Materializes exactly the canonical truth already authorized by a persisted
 * reconciliation decision. Fails closed (throws MaterializationAuthorityError)
 * if no such decision exists, if it belongs to a different organisation, or
 * if its invocation record does not actually point back at it.
 */
export async function materializeReconciliationDecision(
  ports: MaterializationPorts,
  input: MaterializeReconciliationDecisionInput,
): Promise<MaterializationApplicationResult> {
  const chain = await ports.governance.getReconciliationAuditChain(
    input.organisationId,
    input.reconciliationDecisionId,
  );
  if (!chain) {
    throw new MaterializationAuthorityError(
      `No persisted reconciliation decision ${input.reconciliationDecisionId} for organisation ${input.organisationId}`,
    );
  }
  if (chain.decision.organisationId !== input.organisationId) {
    throw new MaterializationAuthorityError(
      `Reconciliation decision ${input.reconciliationDecisionId} organisation does not match the requested organisation`,
    );
  }
  if (chain.invocation.reconciliationDecisionId !== input.reconciliationDecisionId) {
    throw new MaterializationAuthorityError(
      `Reconciliation invocation ${chain.invocation.invocationId} does not match requested decision ${input.reconciliationDecisionId}`,
    );
  }

  if (chain.family === "OBJECT") {
    return materializeObjectFamily(ports, chain);
  }
  if (chain.family === "RELATIONSHIP") {
    return materializeRelationshipFamily(ports, chain);
  }

  // CANDIDATE_MERGE is deliberately out of scope for canonical-object
  // materialization: canonical-contracts' CandidateMergeRecord carries no
  // sourceObject/canonicalObject/proposed identity, and MERGE_CANDIDATES is
  // never produced through the object/relationship reconciliation factories.
  // The merged reconciliation identity itself is already fully durable in
  // gov_repo.reconciliation_decisions / reconciliation_decision_merge_members.
  return { applicable: false, reason: "CANDIDATE_MERGE_HAS_NO_OBJECT_TARGET" };
}
