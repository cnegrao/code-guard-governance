import "server-only";

import type { CanonicalObjectKind, DiscoveryCandidateKind, OrganisationId } from "@council/canonical-contracts";
import {
  RECONCILIATION_INPUT_STATUS,
  type PersistedReconciliationFamily,
  type ReconciliationAuditChainEntry,
  type ReviewSubjectId,
} from "@council/governance-review";

import { governanceReviewPersistence, privilegedDb } from "./persistence";
import { getReconciliationInputForReviewSubject } from "./reconciliation-input";
import {
  deriveReconciliationReadiness,
  type ReconciliationReadiness,
} from "./reconciliation-readiness";
import { listCanonicalObjectsForMatch, type CanonicalObjectMatchCandidate } from "./canonical-object-lookup";

/**
 * GovernanceDecisionQueryService (Reconciliation & Materialization Workspace
 * V1) — CQRS read side. Server-only. Composes exactly one bounded read per
 * Review detail page load: the certified ReviewSubject, its recovered
 * reconciliation input, any already-persisted reconciliation decision, and
 * any already-persisted materialization — never more than the existing
 * closed persistence surfaces already expose, and never a second privileged
 * client.
 */

export type MaterializationStatus = "PENDING" | "APPLIED" | "FAILED";

export interface MaterializationSummary {
  readonly status: MaterializationStatus;
  readonly outcome: "CREATE_NEW" | "MATCH_EXISTING";
  readonly family: "OBJECT" | "RELATIONSHIP";
  readonly canonicalObjectId?: string;
  readonly relationshipId?: string;
  readonly appliedAt?: string;
  readonly failureClassification?: string;
}

export interface ReconciliationDecisionSummary {
  readonly reconciliationDecisionId: string;
  readonly family: PersistedReconciliationFamily;
  readonly outcome: string;
  readonly decidedAt: string;
  readonly actorReference: string;
  readonly reasonCode: string;
  readonly canonicalObject?: { readonly objectId: string; readonly kind: CanonicalObjectKind };
}

export type RequestableReconciliationOutcome = "CREATE_NEW" | "MATCH_EXISTING" | "REJECT" | "DEFER";

export interface GovernanceDecisionDetail {
  readonly reviewSubjectId: string;
  readonly candidateKind: DiscoveryCandidateKind;
  readonly readiness: ReconciliationReadiness;
  readonly availableOutcomes: readonly RequestableReconciliationOutcome[];
  readonly matchCandidates?: readonly CanonicalObjectMatchCandidate[];
  readonly reconciliation?: ReconciliationDecisionSummary;
  readonly materialization?: MaterializationSummary;
}

interface ReconciliationInvocationLookupRow {
  reconciliation_decision_id: string;
}

/** Read-before-write anchor: the one authoritative fact both this query service and decision-commands.ts's concurrency guard depend on. */
export async function findReconciliationDecisionIdForReviewSubject(
  organisationId: OrganisationId,
  reviewSubjectId: ReviewSubjectId,
): Promise<string | undefined> {
  const { data, error } = await privilegedDb
    .from("reconciliation_invocations")
    .select("reconciliation_decision_id")
    .eq("organisation_id", organisationId)
    .eq("review_subject_id", reviewSubjectId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`reconciliation_invocations lookup failed: ${error.message}`);
  return (data as ReconciliationInvocationLookupRow | null)?.reconciliation_decision_id;
}

interface MaterializationOperationRow {
  status: MaterializationStatus;
  outcome: "CREATE_NEW" | "MATCH_EXISTING";
  decision_family: "OBJECT" | "RELATIONSHIP";
  resulting_canonical_object_id: string | null;
  resulting_relationship_id: string | null;
  applied_at: string | null;
  failure_classification: string | null;
}

export async function findMaterializationForDecision(
  organisationId: OrganisationId,
  reconciliationDecisionId: string,
): Promise<MaterializationSummary | undefined> {
  const { data, error } = await privilegedDb
    .from("materialization_operations")
    .select(
      "status, outcome, decision_family, resulting_canonical_object_id, resulting_relationship_id, applied_at, failure_classification",
    )
    .eq("organisation_id", organisationId)
    .eq("reconciliation_decision_id", reconciliationDecisionId)
    .maybeSingle();
  if (error) throw new Error(`materialization_operations lookup failed: ${error.message}`);
  if (!data) return undefined;

  const row = data as MaterializationOperationRow;
  return {
    status: row.status,
    outcome: row.outcome,
    family: row.decision_family,
    ...(row.resulting_canonical_object_id ? { canonicalObjectId: row.resulting_canonical_object_id } : {}),
    ...(row.resulting_relationship_id ? { relationshipId: row.resulting_relationship_id } : {}),
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.failure_classification ? { failureClassification: row.failure_classification } : {}),
  };
}

function summarizeChainEntry(chain: ReconciliationAuditChainEntry): ReconciliationDecisionSummary {
  const decision = chain.decision;
  const canonicalObject = (decision as unknown as { canonicalObject?: { objectId: string; kind: CanonicalObjectKind } })
    .canonicalObject;
  return {
    reconciliationDecisionId: decision.decisionId,
    family: chain.family,
    outcome: decision.outcome,
    decidedAt: decision.decidedAt,
    actorReference: decision.authority.authorityKind === "HUMAN" ? decision.authority.actorReference : "",
    reasonCode: decision.reasonCode,
    ...(canonicalObject ? { canonicalObject } : {}),
  };
}

/**
 * RELATIONSHIP CREATE_NEW/MATCH_EXISTING both require a governed source
 * endpoint of kind AGENT_VERSION or DATA_ELEMENT (canonical-contracts'
 * RELATIONSHIP_ENDPOINT_CONSTRAINTS — every one of the twelve governed
 * relationship types requires one of those two source kinds). Neither kind
 * has a production normalizer yet (Object Candidate Normalization V1, closed,
 * proves only MODEL/TOOL/RELATIONSHIP), so no relationship's source endpoint
 * can currently resolve to an existing canonical object. REJECT/DEFER need no
 * endpoint and remain fully safe to offer.
 */
function availableOutcomesFor(candidateKind: DiscoveryCandidateKind): RequestableReconciliationOutcome[] {
  if (candidateKind === "RELATIONSHIP") return ["REJECT", "DEFER"];
  return ["CREATE_NEW", "MATCH_EXISTING", "REJECT", "DEFER"];
}

export async function getGovernanceDecisionDetail(
  organisationId: OrganisationId,
  reviewSubjectId: ReviewSubjectId,
): Promise<GovernanceDecisionDetail | undefined> {
  const subject = await governanceReviewPersistence.getReviewSubject(organisationId, reviewSubjectId);
  if (!subject) return undefined;

  const recovery = await getReconciliationInputForReviewSubject(organisationId, subject);

  const existingDecisionId = await findReconciliationDecisionIdForReviewSubject(organisationId, reviewSubjectId);
  let reconciliation: ReconciliationDecisionSummary | undefined;
  let materialization: MaterializationSummary | undefined;
  if (existingDecisionId) {
    const chain = await governanceReviewPersistence.getReconciliationAuditChain(organisationId, existingDecisionId);
    if (chain) {
      reconciliation = summarizeChainEntry(chain);
      materialization = await findMaterializationForDecision(organisationId, existingDecisionId);
    }
  }

  const readiness = deriveReconciliationReadiness({
    reviewState: subject.state,
    recoveryStatus: recovery.status,
    hasExistingReconciliationDecision: !!reconciliation,
    isMaterializedApplied: materialization?.status === "APPLIED",
  });

  const availableOutcomes = readiness.ready ? availableOutcomesFor(subject.candidateKind) : [];
  const matchCandidates =
    readiness.ready &&
    subject.candidateKind !== "RELATIONSHIP" &&
    recovery.status === RECONCILIATION_INPUT_STATUS.OBJECT_INPUT_AVAILABLE
      ? await listCanonicalObjectsForMatch(organisationId, subject.candidateKind as CanonicalObjectKind)
      : undefined;

  return {
    reviewSubjectId: subject.reviewSubjectId,
    candidateKind: subject.candidateKind,
    readiness,
    availableOutcomes,
    ...(matchCandidates ? { matchCandidates } : {}),
    ...(reconciliation ? { reconciliation } : {}),
    ...(materialization ? { materialization } : {}),
  };
}

// Exported for direct unit testing of otherwise-pure logic, matching this
// repo's established test-layering convention (see workspace-query.ts /
// persistence.ts's own exports) — actual privilegedDb query/RPC behavior is
// proven separately by the controlled Supabase runtime gate.
export { availableOutcomesFor, summarizeChainEntry };
