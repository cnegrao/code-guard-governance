import "server-only";

import type { OrganisationId } from "@council/canonical-contracts";
import {
  recoverReconciliationInput,
  type DiscoveryIntakePersistencePort,
  type ReconciliationInputRecovery,
  type ReviewSubject,
} from "@council/governance-review";

import { discoveryIntakePersistence } from "./discovery-intake-persistence";

/**
 * Discovery Governance Input Persistence V1 — server-only composition
 * boundary (Reconciliation Input Recovery). Reads the exact durable
 * DiscoveryFinding (and, when Discovery Intake actually produced one — see
 * discovery-intake-port.ts) NormalizedCandidate backing a ReviewSubject, and
 * hands them to governance-review's pure recoverReconciliationInput for the
 * identity/kind/association cross-checks. The result is usable directly as
 * the finding/candidate fields of an ObjectReconciliationInvocationCommand or
 * RelationshipReconciliationInvocationCommand, with no fabricated or
 * reconstructed content.
 *
 * This function is read-only: it never invokes reconciliation, authorization,
 * or materialization, and confers no governance authority on its own.
 */
export async function getReconciliationInputForReviewSubject(
  organisationId: OrganisationId,
  reviewSubject: ReviewSubject,
  intake: DiscoveryIntakePersistencePort = discoveryIntakePersistence,
): Promise<ReconciliationInputRecovery> {
  const finding = await intake.getDiscoveryFinding(organisationId, reviewSubject.findingId);
  const candidate = finding
    ? await intake.getNormalizedCandidateForFinding(organisationId, reviewSubject.findingId)
    : undefined;

  return recoverReconciliationInput({ reviewSubject, finding, candidate });
}
